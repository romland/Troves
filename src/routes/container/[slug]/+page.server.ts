import type { PageServerLoad } from './$types';
import { db } from '$lib/server/database';
import { error, fail } from "@sveltejs/kit";

export const load = (async ({ locals, params, url, fetch }) => {
    const item = await db.container.findFirst({
        where: {
            AND: [
                // { author: { id: locals.user.id } },
                { name: params.slug },
                { inventoryId: locals.activeInventoryId }
            ]
        },
        include: {
            children : {
                select : {
                    id: true,
                    name : true,
                    parentId : true,
                    description : true,
                    spatialMap: true
                }
            },
        }
    });

    if (!item) {
        error(404, 'Container not found.');
    }

    const includeTrays = url.searchParams.get('includeTrays') === 'true';
    const apiUrl = new URL('/api/items', url.origin);
    url.searchParams.forEach((val, key) => apiUrl.searchParams.append(key, val));
    
    if (includeTrays && item.children.length > 0) {
        apiUrl.searchParams.set('container', [item.name, ...item.children.map((c: any) => c.name)].join(','));
    } else {
        apiUrl.searchParams.set('container', item.name);
    }

    const res = await fetch(apiUrl.toString());
    const data = await res.json();

    const apiPath = `/api/items${apiUrl.search}`;

    let polygons = [];
    if (item.spatialMap) {
        try {
            polygons = JSON.parse(item.spatialMap);
        } catch(e) {}
    }

    return {
        item: item,
        items: data.items,
        totalCount: data.totalCount || 0,
        includeTrays,
        prevPage: data.prevPage,
        nextPage: data.nextPage,
        apiPath: apiPath + (apiPath.includes('?') ? '&' : '?'),
        polygons
    };
}) satisfies PageServerLoad;

export const actions = {
    saveSpatialMap: async ({ request, locals, params }) => {
        if (!locals.user) return fail(401, { error: true, message: "Unauthorized" });
        const data = await request.formData();
        const spatialMap = data.get('spatialMap') as string;
        
        await db.container.updateMany({
            where: { name: params.slug, inventoryId: locals.activeInventoryId },
            data: { spatialMap }
        });
        
        return { success: true, message: "Spatial map updated." };
    },

    clearSpatialMap: async ({ locals, params }) => {
        if (!locals.user) return fail(401, { error: true, message: "Unauthorized" });
        await db.container.updateMany({
            where: { name: params.slug, inventoryId: locals.activeInventoryId },
            data: { spatialMap: null }
        });
        return { success: true, message: "Spatial map cleared." };
    }
};
