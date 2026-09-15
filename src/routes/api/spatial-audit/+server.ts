import { json } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { assertCanMutate } from '$lib/server/security';
import { MediaIngest } from '$lib/server/services/MediaIngest';
import { verifySpatialGrid } from '$lib/server/gemini-classification';
import { taskManager } from '$lib/server/taskManager';
import { getActiveSchema } from '$lib/server/ontology';
import { alignPolygonsToNewImage } from '$lib/server/vision/pureCv';
import fs from 'fs';

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

    // 2. Fetch the container to get the spatial map AND the baseline photo
    const container = await db.container.findUnique({
        where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: scopeValue } }
    });

    if (!container || !container.spatialMap || !container.photoPath) {
        return json({ error: 'Container, spatial map, or baseline photo not found' }, { status: 404 });
    }

    const baselinePath = `data${container.photoPath}`;
    if (!fs.existsSync(baselinePath)) {
        return json({ error: 'Baseline photo missing from disk' }, { status: 404 });
    }

    let parsedMap;
    try { parsedMap = JSON.parse(container.spatialMap); } catch(e) {}
    const originalPolygons: number[][][] = Array.isArray(parsedMap) ? parsedMap : (parsedMap?.polygons || []);

    if (originalPolygons.length === 0) {
        return json({ error: 'No compartments in spatial map' }, { status: 400 });
    }

    const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);

    // Fetch existing mapped baseline
    const mappedItems = await db.itemsInContainer.findMany({
        where: { containerId: container.id, spatialMap: { not: null } },
        include: { item: true }
    });

    const inCollection: any[] = [];
    const missingFromScope: any[] = [];
    const newToYou: any[] = [];

    const taskId = taskManager.start('global', 0, `Spatial Audit: Aligning & Processing ${originalPolygons.length} compartments...`);

    try {
        // 3. Homography Alignment (Pure TS CV Engine)
        taskManager.update(taskId, 'Aligning perspective to baseline...');
        let warpedPolygons: number[][][];
        try {
            warpedPolygons = await alignPolygonsToNewImage(baselinePath, localDraftPath, originalPolygons);
        } catch (cvError: any) {
            console.error("Homography alignment failed:", cvError);
            return json({ error: "We couldn't align this photo with your original layout map. Try holding the camera at the same angle and ensure all outer edges of the container are visible." }, { status: 400 });
        }

        taskManager.update(taskId, 'Verifying contents...');

        // 4. Build the baseline map for the LLM using the newly WARPED polygons.
        // We filter OUT any polygon that lacks a mapped item in the database.
        const baselineMap: any[] = [];
        const activePolygons: any[] = [];
        
        for (let i = 0; i < originalPolygons.length; i++) {
            const origPoly = originalPolygons[i];
            const warpedPoly = warpedPolygons[i];
            const origPolyStr = JSON.stringify(origPoly);
            
        const expectedRecord = mappedItems.find(mi => {
            if (!mi.spatialMap) return false;
            try {
                const parsed = JSON.parse(mi.spatialMap);
                const p = Array.isArray(parsed) ? parsed : parsed.polygon;
                return JSON.stringify(p) === origPolyStr;
            } catch(e) { return false; }
        });
            if (!expectedRecord) continue;
            
            baselineMap.push({
                index: i,
                polygon: warpedPoly, // Tell Gemini where to look in the NEW skewed photo
                expectedTitle: expectedRecord.item.title,
                expectedDescription: expectedRecord.item.description
            });
            
            // Keep track of both formats: warped for the UI/crops, original string for DB linking
            activePolygons.push({ index: i, warpedPoly, origPolyStr, expectedItem: expectedRecord.item });
        }

        if (baselineMap.length === 0) {
            return json({ success: true, draftPath, activeSchema, totalDetected: 0, totalVisibleCount: originalPolygons.length, inCollection: [], missingFromScope: [], newToYou: [], scopeType: 'container', scopeValue: container.name });
        }

        // 5. Single batched API call to Gemini
        const llmPayload = await verifySpatialGrid(localDraftPath, baselineMap, { targetType: 'global', targetId: 0, description: `Auditing ${baselineMap.length} mapped slots` });
        const bulkResults = llmPayload.results || [];

        // 6. Local reconciliation
        for (let i = 0; i < activePolygons.length && i < bulkResults.length; i++) {
            const { warpedPoly, origPolyStr, expectedItem } = activePolygons[i];
            const llmResult = bulkResults[i];

            // Reconciliation Strategy
            if (llmResult.status === 'PRESENT') {
                inCollection.push({
                    title: expectedItem.title,
                    box: warpedPoly, // UI uses this to draw AR glowing box over the new photo
                    category: 'Matched',
                    fill_status: llmResult.fill_status,
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
                    box: warpedPoly,
                    isShortfall: true,
                    expected: 1,
                    count: 0,
                    fill_status: llmResult.fill_status,
                    spatialMap: origPolyStr // The DB needs the original string to repair/link the slot
                });

                if (llmResult.status === 'DIFFERENT') {
                    // New unexpected item! The bounding box handles the crop so we can instantly save it to the DB
                    newToYou.push({ title: llmResult.title || 'Unknown Unexpected Item', subtitle: llmResult.description || 'Found in occupied slot', box: warpedPoly, category: 'Anomaly', fill_status: llmResult.fill_status });
                }
            }
        }

        return json({ success: true, draftPath, activeSchema, totalDetected: inCollection.length + newToYou.length, totalVisibleCount: originalPolygons.length, inCollection, missingFromScope, newToYou, scopeType: 'container', scopeValue: container.name });
    } catch (e) {
        console.error("Spatial Audit failed", e);
        return json({ error: 'Spatial Audit failed due to an internal error' }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};
