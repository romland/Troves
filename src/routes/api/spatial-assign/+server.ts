import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { assertCanMutate } from '$lib/server/security';
import { logActivity } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);
    const { parentContainerId, entity, polygon } = await request.json();

    const spatialMapStr = JSON.stringify(polygon);

    if (entity.type === 'container') {
        // Child Tray
        await db.container.updateMany({
            where: { id: entity.id, inventoryId: locals.activeInventoryId, parentId: parentContainerId },
            data: { spatialMap: spatialMapStr }
        });
        await logActivity(null, 'Spatial Mapping', `Mapped tray '${entity.name}' to visual grid.`, 'success');
    } else {
        // Direct Item
        await db.itemsInContainer.update({
            where: { itemId_containerId: { itemId: entity.id, containerId: parentContainerId } },
            data: { spatialMap: spatialMapStr }
        });
        await logActivity(entity.id, 'Spatial Mapping', `Item mapped to physical visual location.`, 'success');
    }

    return json({ success: true });
};