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

    const categories = await db.category.findMany({
        where: { inventoryId: locals.activeInventoryId },
        orderBy: { name: 'asc' }
    });

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
    let warpMap = null;
    let renderAsGrid = false;
    if (item.spatialMap) {
        try {
            const parsed = JSON.parse(item.spatialMap);
            if (Array.isArray(parsed)) {
                polygons = parsed;
            } else {
                polygons = parsed.polygons || [];
                warpMap = parsed.warpMap || null;
                renderAsGrid = parsed.renderAsGrid || false;
            }
        } catch(e) {}
    }

    return {
        item: item,
        categories,
        items: data.items,
        totalCount: data.totalCount || 0,
        includeTrays,
        prevPage: data.prevPage,
        nextPage: data.nextPage,
        apiPath: apiPath + (apiPath.includes('?') ? '&' : '?'),
        polygons,
        warpMap,
        renderAsGrid
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
        const container = await db.container.findUnique({
            where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: params.slug } }
        });
        if (container) {
            await db.container.update({
                where: { id: container.id },
                data: { spatialMap: null }
            });
            await db.itemsInContainer.updateMany({
                where: { containerId: container.id },
                data: { spatialMap: null }
            });
            await db.container.updateMany({
                where: { parentId: container.id },
                data: { spatialMap: null }
            });
        }
        return { success: true, message: "Spatial map cleared." };
    },

    unmapEntity: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: true, message: "Unauthorized" });
        const data = await request.formData();
        const entityId = Number(data.get('entityId'));
        const entityType = data.get('entityType') as string;
        const parentContainerId = Number(data.get('parentContainerId'));

        if (entityType === 'container') {
            await db.container.updateMany({
                where: { id: entityId, inventoryId: locals.activeInventoryId, parentId: parentContainerId },
                data: { spatialMap: null }
            });
        } else {
            await db.itemsInContainer.updateMany({
                where: { itemId: entityId, containerId: parentContainerId },
                data: { spatialMap: null }
            });
        }
        return { success: true, message: "Unlinked from map." };
    }
};
