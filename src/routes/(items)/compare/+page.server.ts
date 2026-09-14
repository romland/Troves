import type { PageServerLoad } from './$types';
import { db } from '$lib/server/database';

export const load = (async ({ locals }) => {
    const containers = await db.container.findMany({
        select : { name: true, parentId: true, description: true, location: true },
        where: { inventoryId: locals.activeInventoryId, parentId: null },
        orderBy: { name: "asc" }
    });

    const categories = await db.category.findMany({
        where: { inventoryId: locals.activeInventoryId },
        orderBy: { name: 'asc' }
    });

    const tags = await db.tag.findMany({
        where: { inventoryId: locals.activeInventoryId },
        orderBy: { name: 'asc' }
    });

    return {
        containers,
        categories,
        tags
    };
}) satisfies PageServerLoad;