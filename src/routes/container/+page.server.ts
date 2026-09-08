import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/database';
import { fail, redirect } from "@sveltejs/kit";

export const load = (async ({ locals, params }) => {

    const containers = await db.container.findMany({
        select : {
          id : true,
          name : true,
          parentId : true,
          photoPath : true,
          description : true,
          location : true,
          children : {
            select : {
              id : true,
              name : true,
              parentId : true,
            }
          },
        },
        where: {
                inventoryId: locals.activeInventoryId
        },
        orderBy: {
          name : "asc"
        }
    });
  
    if (!containers) {
        return fail(400, {
            error: true,
            message: '<strong>Container</strong> not found.'
        });
    }

    return {
        containers: containers
    };
}) satisfies PageServerLoad;

export const actions = {
    delete: async ({ request, locals }) => {
        const data = await request.formData();
        const name = data.get('name') as string;
        
        if (name) {
            await db.container.delete({ where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name } } });
        }
    }
} satisfies Actions;
