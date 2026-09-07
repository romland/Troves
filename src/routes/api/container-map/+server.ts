import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { mapContainerCompartments } from '$lib/server/vision/containerMapper';
import { assertCanMutate } from '$lib/server/security';
import { deskewContainerImage } from '$lib/server/vision/deskewContainer';
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
        return json({ error: 'Container not found or has no photo' }, { status: 404 });
    }

    let localFilePath = `data${container.photoPath}`;
    const taskId = taskManager.start('global', 0, `Mapping compartments for ${container.name}`);

    // Phase 1: Deskew (Flatten the perspective) BEFORE attempting to map internal grids
    const deskewedPath = await deskewContainerImage(localFilePath);
    let newWebPath = null;
    if (deskewedPath !== localFilePath) {
        newWebPath = deskewedPath.replace(/^data/, '');
        await db.container.update({ where: { id: container.id }, data: { photoPath: newWebPath } });
        localFilePath = deskewedPath;
    }

    // NOTE: Vision LLMs currently struggle with "Spatial Hallucination" - tending to return 
    // perfectly symmetrical grids instead of accurately tracing skewed perspective lines.
    // We retain this AI auto-mapping pipeline as an option because model spatial grounding 
    // will inevitably improve, but the UI also provides a math-based Perspective Grid fallback.    
    try {
        const result = await mapContainerCompartments(localFilePath, { targetType: 'global', targetId: 0 });
        
        if (result && result.compartments && result.compartments.length > 0) {
            // Save the raw polygon array to the Container's new spatialMap field
            await db.container.update({
                where: { id: container.id },
                data: { spatialMap: JSON.stringify(result.compartments) }
            });

            await logActivity(null, 'Spatial Mapping', `AI mapped ${result.compartments.length} compartments in '${container.name}'`, 'success');
            return json({ success: true, polygons: result.compartments, newPhotoPath: newWebPath });
        } else {
            return json({ success: false, message: 'No compartments detected. Ensure the photo is top-down.' });
        }
    } catch (e: any) {
        console.error("Mapping failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};