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
    
    const taskId = taskManager.start('global', 0, `Creating item from spatial map...`);
    try {
        const localPath = `data${parentImagePath}`;
        let cropWebPath = null;
        
        if (fs.existsSync(localPath)) {
            cropWebPath = await cropPolygon(localPath, polygon, slugify(title || 'item', { lower: true, strict: true }));
        }

        const simulatedLlmAnalysis = skipVision ? JSON.stringify({
            photoType: 'product',
            subCategory: 'unknown',
            isNewCategory: false,
            description: description?.trim() || title?.trim() || 'New Item'
        }) : undefined;

        const safeTitle = title?.trim() || 'New Item';
        const item = await db.item.create({
            data: {
                title: safeTitle,
                description: description?.trim() || "",
                slug: slugify(safeTitle, { lower: true, strict: true }) || 'new-item',
                inventoryId: locals.activeInventoryId,
                authorId: locals.user.id,
                photos: cropWebPath ? { create: [{ type: 'product', orgPath: cropWebPath, llmAnalysis: simulatedLlmAnalysis }] } : undefined,
                locations: {
                    create: [{
                        containerId: parentContainerId,
                        spatialMap: JSON.stringify(polygon)
                    }]
                }
            }
        });

        // Trigger background ML pipeline on the newly cropped image
        const { processItemPhotosBackground } = await import('$lib/server/photouploads');
        const itemForBg = await db.item.findUnique({ where: { id: item.id }, include: { photos: true } });
        if (itemForBg) processItemPhotosBackground(itemForBg).catch(console.error);

        await logActivity(item.id, 'Creation', `Quick-created from spatial map.`, 'success');
        return json({ success: true, item });
    } catch (e: any) {
        console.error("Spatial quick create failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};