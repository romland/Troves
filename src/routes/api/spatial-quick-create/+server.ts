import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { assertCanMutate } from '$lib/server/security';
import { cropPolygon } from '$lib/server/vision/polygonCrop';
import { logActivity } from '$lib/server/logger';
import slugify from 'slugify';
import { taskManager } from '$lib/server/taskManager';
import fs from 'fs';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);
    const formData = await request.formData();
    const parentContainerId = Number(formData.get('parentContainerId'));
    const polygon = JSON.parse(formData.get('polygon') as string);
    const parentImagePath = formData.get('parentImagePath') as string;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const skipVision = formData.get('skipVision') === 'true';
    const removeBackground = formData.get('removeBackground') === 'true';
    const straightenPerspective = formData.get('straightenPerspective') === 'true';
    const fillStatus = formData.get('fillStatus') as string;
    const clientId = formData.get('clientId') as string;
    
    const taskId = taskManager.start('global', 0, `Creating item from spatial map...`);
    try {
        const localPath = `data${parentImagePath}`;
        let cropWebPath = null;
        
        if (fs.existsSync(localPath)) {
            taskManager.update(taskId, straightenPerspective ? 'Extracting and flattening compartment perspective...' : 'Extracting compartment crop...');
            // Route pixel manipulation through the heavy ML queue to protect the Node.js event loop
            const { heavyMlQueue } = await import('$lib/server/queue/index');
            cropWebPath = await heavyMlQueue.add(() => 
                cropPolygon(localPath, polygon, slugify(title || 'item', { lower: true, strict: true }), straightenPerspective)
            );
        }

        // If we are overriding the background removal, we inject it into the LLM Analysis payload
        // so `photouploads.ts` picks it up during background processing.
        const simulatedLlmAnalysis = JSON.stringify({
            photoType: 'product',
            subCategory: 'unknown',
            isNewCategory: false,
            description: description?.trim() || title?.trim() || 'New Item',
            bgRemovalEnabled: removeBackground
        });
        
        // We write the sidecar immediately so background jobs can grab our overrides, even if skipVision is true
        if (cropWebPath) {
            fs.writeFileSync(`data${cropWebPath}.json`, JSON.stringify({ bgRemovalEnabled: removeBackground }), 'utf8');
        }

        const safeTitle = title?.trim() || 'New Item';

        // Idempotency: Protect against outbox retries
        if (clientId) {
            const existing = await db.item.findUnique({ where: { clientId } });
            if (existing) return json({ success: true, item: existing });
        }

    const spatialMapData = fillStatus ? { polygon, fill_status: fillStatus } : polygon;
        const item = await db.item.create({
            data: {
                clientId,
                title: safeTitle,
                description: description?.trim() || "",
                slug: slugify(safeTitle, { lower: true, strict: true }) || 'new-item',
                inventoryId: locals.activeInventoryId,
                authorId: locals.user.id,
                photos: cropWebPath ? { create: [{ type: 'product', orgPath: cropWebPath, llmAnalysis: skipVision ? simulatedLlmAnalysis : undefined }] } : undefined,
                locations: {
                    create: [{
                        containerId: parentContainerId,
                    spatialMap: JSON.stringify(spatialMapData)
                    }]
                }
            }
        });

        // Trigger background ML pipeline on the newly cropped image
        const { processItemPhotosBackground } = await import('$lib/server/photouploads');
        const itemForBg = await db.item.findUnique({ where: { id: item.id }, include: { photos: true } });
        if (itemForBg) processItemPhotosBackground(itemForBg).catch(console.error);

        await logActivity(item.id, 'Creation', `Quick-created from spatial map.`, 'success');
        if (cropWebPath && straightenPerspective) {
            await logActivity(item.id, 'Image Processing', 'Mathematically flattened skewed compartment using Bilinear Perspective Warp.', 'info');
        }
        return json({ success: true, item });
    } catch (e: any) {
        console.error("Spatial quick create failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};