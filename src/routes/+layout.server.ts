import type { LayoutServerLoad } from "./$types";
import { db } from '$lib/server/database';

export const load = (async ({ locals, setHeaders }) => {
    try {
        setHeaders({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
    } catch (e) {}

    let inventories: any[] = [];
    if (locals.user) {
        const access = await db.userInventoryAccess.findMany({
            where: { userId: locals.user.id },
            include: { inventory: true }
        });
        inventories = access.map(a => a.inventory);
    }

    return { 
        user: locals.user, 
        activeInventoryId: locals.activeInventoryId,
        role: locals.role,
        activeSort: locals.activeSort || 'newest',
        activeViewMode: locals.activeViewMode || 'list',
        activeAddMode: locals.activeAddMode || 'single',
        inventories 
    };

}) satisfies LayoutServerLoad;
