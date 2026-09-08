import { json } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.activeInventoryId) return json({ error: 'No Trove' }, { status: 404 });

    const containers = await db.container.findMany({
        where: { inventoryId: locals.activeInventoryId, parentId: null },
        include: { children: true },
        orderBy: { name: 'asc' }
    });
    return json(containers);
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.activeInventoryId) return json({ error: 'No Trove' }, { status: 404 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    try {
        const { name } = await request.json();
        
        if (!name || name.trim() === '') {
            return json({ error: 'Name is required' }, { status: 400 });
        }

        const container = await db.container.create({
            data: {
                name: name.trim(),
                description: "Created via quick-add",
                inventoryId: locals.activeInventoryId
            }
        });
        return json(container);
    } catch (e) {
        return json({ error: 'Failed to create container (it might already exist in this Trove)' }, { status: 400 });
    }
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.activeInventoryId) return json({ error: 'No Trove' }, { status: 404 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    try {
        const { name, parentName } = await request.json();
        if (!name) return json({ error: 'Container name required' }, { status: 400 });

        let parentId = null;
        if (parentName) {
            const parent = await db.container.findUnique({ where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: parentName } }});
            if (parent) {
                if (parent.name === name) return json({ error: 'Cannot move container inside itself' }, { status: 400 });
                parentId = parent.id;
            }
        }
        await db.container.updateMany({ where: { name, inventoryId: locals.activeInventoryId }, data: { parentId } });
        return json({ success: true, message: parentId ? `Moved into '${parentName}'` : "Detached to top level." });
    } catch (e) {
        return json({ error: 'Failed to move container' }, { status: 500 });
    }
};
