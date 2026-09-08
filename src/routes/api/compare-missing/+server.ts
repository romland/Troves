import { json } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    const { scopeType, scopeValue, matchedIds } = await request.json();

    const dbItems = await db.item.findMany({
        where: { inventoryId: locals.activeInventoryId },
        include: { locations: { include: { container: true } }, tags: true, photos: { include: { category: true } } }
    });

    // Count how many times each ID was matched in the photo
    const idUsage = matchedIds.reduce((acc: any, id: number) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {});

    const missingFromScope = (scopeType !== 'all' ? dbItems.filter(i => {
        const used = idUsage[i.id] || 0;
        const available = i.amount || 1;
        if (used >= available) return false;

        if (scopeType === 'tag' && scopeValue) return i.tags.some(t => t.slug === scopeValue.toLowerCase().replace(/ /g, '-'));
        if (scopeType === 'category' && scopeValue) return i.photos?.some(p => p.category?.name === scopeValue);
        if (scopeType === 'container' && scopeValue) return i.locations.some(l => l.container.name === scopeValue);
        return false;
    }) : []).map(i => ({ 
        id: i.id, 
        title: i.title, 
        slug: i.slug, 
        locationName: i.locations?.[0]?.container?.name || null, 
        thumbPath: i.photos?.[0]?.thumbPath || i.photos?.[0]?.orgPath || null,
        spatialMap: i.locations?.[0]?.spatialMap || null
    }));

    return json({ missing: missingFromScope });
};
