import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { extensionManager } from '$lib/server/extensions/ExtensionManager';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
    if (!locals.user) error(401, 'Unauthorized');
    if (!locals.activeInventoryId) error(404, 'No active Trove');

    const { actionId, itemId } = params;
    const parsedId = Number(itemId);
    if (isNaN(parsedId)) error(400, 'Invalid item ID');

    // Hydrate the core item so the plugin doesn't have to guess IDs
    const item = await db.item.findUnique({
        where: { id: parsedId, inventoryId: locals.activeInventoryId }
    });

    if (!item) error(404, 'Item not found');

    const url = await extensionManager.resolveItemAction(actionId, {
        entity: item,
        context: { user: locals.user, inventoryId: locals.activeInventoryId },
        intent: {}
    });

    if (!url || typeof url !== 'string') {
        error(500, 'Plugin failed to resolve a valid URL.');
    }

    // Magic redirect logic - sends browser natively to target!
    redirect(302, url);
};