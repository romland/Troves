import type { Actions} from "./$types";
import { redirect } from "@sveltejs/kit";
import { db } from '$lib/server/database';
import { fail } from '@sveltejs/kit';

export const actions = {
    default: async ({ params, locals }) => {
        if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });

        await db.item.deleteMany({
            where: {
                id: Number(params.id),
                inventoryId: locals.activeInventoryId
            }
        });

        const { scrubEmptyCategories } = await import('$lib/server/categories');
        scrubEmptyCategories(locals.activeInventoryId).catch(console.error);

        return { deleted: true };
    }
} satisfies Actions;