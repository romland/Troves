import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { mapContainerCompartments } from '$lib/server/vision/containerMapper';
import { assertCanMutate } from '$lib/server/security';
import { taskManager } from '$lib/server/taskManager';
import { logActivity } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);
    
    const { containerId } = await request.json();
    if (!containerId) return json({ error: 'Missing container ID' }, { status: 400 });

    const container = await db.container.findUnique({ 
        where: { id: containerId, inventoryId: locals.activeInventoryId } 
    });

    if (!container || !container.photoPath) {
        console.log(`[DEBUG-MAPPER] Container not found or has no photo. ID: ${containerId}`);
        return json({ error: 'Container not found or has no photo' }, { status: 404 });
    }

    let localFilePath = `data${container.photoPath}`;

    const taskId = taskManager.startDirect('global', 0, `Mapping compartments for ${container.name}`);
    console.log(`[DEBUG-MAPPER] POST /api/container-map hit. localFilePath: ${localFilePath}`);
    try {
        console.log(`[DEBUG-MAPPER] Calling mapContainerCompartments...`);
        const result = await mapContainerCompartments(localFilePath, { targetType: 'global', targetId: 0 });
        
        if (result && result.compartments && result.compartments.length > 0) {
            console.log(`[DEBUG-MAPPER] Mapping successful, updating DB with ${result.compartments.length} compartments.`);
            await db.container.update({
                where: { id: container.id },
                data: { spatialMap: JSON.stringify({ polygons: result.compartments, warpMap: result.warpMap, renderAsGrid: true }) }
            });

            await logActivity(null, 'Spatial Mapping', `mapped ${result.compartments.length} compartments in '${container.name}'`, 'success');
            return json({ success: true, polygons: result.compartments, warpMap: result.warpMap });
        } else {
            console.log(`[DEBUG-MAPPER] No compartments returned from mapper.`);
            return json({ success: false, message: 'No compartments detected. Ensure the photo is top-down.' });
        }
    } catch (e: any) {
        console.error("[DEBUG-MAPPER] Mapping failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};