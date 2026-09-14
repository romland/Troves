import { json } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { assertCanMutate } from '$lib/server/security';
import { MediaIngest } from '$lib/server/services/MediaIngest';
import { verifySpatialGrid } from '$lib/server/gemini-classification';
import { taskManager } from '$lib/server/taskManager';
import { getActiveSchema } from '$lib/server/ontology';

export const POST = async ({ request, locals }) => {
    assertCanMutate(locals);
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const scopeValue = formData.get('scopeValue') as string;

    if (!file || !scopeValue) {
        return json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Save the new bulk photo to disk
    const { localPath: localDraftPath, webPath: draftPath } = await MediaIngest.saveUploadedImage(file, 'audit');

    // 2. Fetch the container to get the spatial map from the server (secure & payload-light)
    const container = await db.container.findUnique({
        where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: scopeValue } }
    });

    if (!container || !container.spatialMap) {
        return json({ error: 'Container or spatial map not found' }, { status: 404 });
    }

    let parsedMap;
    try { parsedMap = JSON.parse(container.spatialMap); } catch(e) {}
    const polygons: number[][][] = Array.isArray(parsedMap) ? parsedMap : (parsedMap?.polygons || []);

    const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);

    // Fetch existing mapped baseline
    const mappedItems = await db.itemsInContainer.findMany({
        where: { containerId: container.id, spatialMap: { not: null } },
        include: { item: true }
    });

    const inCollection: any[] = [];
    const missingFromScope: any[] = [];
    const newToYou: any[] = [];

    const taskId = taskManager.start('global', 0, `Spatial Audit: Processing ${polygons.length} compartments...`);

    try {
        // 1. Build the baseline map for the LLM.
        // We intentionally filter OUT any polygon that lacks a mapped item in the database.
        // This prevents unlabelled compartments from constantly triggering as "New" anomalies.
        const baselineMap: any[] = [];
        const activePolygons: any[] = [];
        
        for (let i = 0; i < polygons.length; i++) {
            const poly = polygons[i];
            const expectedRecord = mappedItems.find(mi => mi.spatialMap === JSON.stringify(poly));
            if (!expectedRecord) continue;
            
            baselineMap.push({
                index: i,
                polygon: poly,
                expectedTitle: expectedRecord.item.title,
                expectedDescription: expectedRecord.item.description
            });
            activePolygons.push({ index: i, poly, expectedItem: expectedRecord.item });
        }

        if (baselineMap.length === 0) {
            return json({ success: true, draftPath, activeSchema, totalDetected: 0, totalVisibleCount: polygons.length, inCollection: [], missingFromScope: [], newToYou: [], scopeType: 'container', scopeValue: container.name });
        }

        // 2. Single batched API call
        const llmPayload = await verifySpatialGrid(localDraftPath, baselineMap, { targetType: 'global', targetId: 0, description: `Auditing ${baselineMap.length} mapped slots` });
        const bulkResults = llmPayload.results || [];

        // 3. Local reconciliation
        for (let i = 0; i < activePolygons.length && i < bulkResults.length; i++) {
            const { poly, expectedItem } = activePolygons[i];
            const polyStr = JSON.stringify(poly);
            const llmResult = bulkResults[i];

            // Reconciliation Strategy
            if (llmResult.status === 'PRESENT') {
                inCollection.push({
                    title: expectedItem.title,
                    box: poly,
                    category: 'Matched',
                    matchedItem: {
                        id: expectedItem.id,
                        title: expectedItem.title,
                        slug: expectedItem.slug,
                        locationName: container.name,
                        amount: expectedItem.amount
                    }
                });
            } else {
                missingFromScope.push({
                    id: expectedItem.id,
                    title: expectedItem.title,
                    slug: expectedItem.slug,
                    locationName: container.name,
                    amount: expectedItem.amount,
                    box: poly,
                    isShortfall: true,
                    expected: 1,
                    count: 0,
                    spatialMap: polyStr
                });

                if (llmResult.status === 'DIFFERENT') {
                    newToYou.push({ title: llmResult.title || 'Unknown Unexpected Item', subtitle: llmResult.description || 'Found in occupied slot', box: poly, category: 'Anomaly' });
                }
            }
        }

        return json({ success: true, draftPath, activeSchema, totalDetected: inCollection.length + newToYou.length, totalVisibleCount: polygons.length, inCollection, missingFromScope, newToYou, scopeType: 'container', scopeValue: container.name });
    } catch (e) {
        console.error("Spatial Audit failed", e);
        return json({ error: 'Spatial Audit failed due to an internal error' }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};