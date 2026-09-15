import type { PageServerLoad, Actions } from "./$types";
import { db } from '$lib/server/database';
import { fail } from '@sveltejs/kit';
import { flagDuplicatesInList } from '$lib/server/matcher';
import { getActiveSchema } from '$lib/server/ontology';

export const load = (async ({ locals, url, fetch }) => {
    // Forward all URL parameters directly to our master API
    const apiUrl = new URL('/api/items', url.origin);
    url.searchParams.forEach((val, key) => apiUrl.searchParams.append(key, val));
    if (!apiUrl.searchParams.has('c')) apiUrl.searchParams.set('c', '12'); // Ensure standard grid sizing

    const res = await fetch(apiUrl.toString());
    const data = await res.json();

    let documentResults = data.documentResults || [];
    const docType = url.searchParams.get('docType');
    if (docType) {
        documentResults = documentResults.filter((d: any) => {
            if (docType === 'note') return d.type === 'note';
            if (docType === 'pdf') return d.path?.toLowerCase().endsWith('.pdf');
            if (docType === 'epub') return d.path?.toLowerCase().endsWith('.epub');
            if (docType === 'html') return d.path?.toLowerCase().endsWith('.html') || d.type === 'html';
            if (docType === 'video') return d.type === 'video';
            return true;
        });
    }

	const categories = await db.category.findMany({
		where: { inventoryId: locals.activeInventoryId },
		orderBy: { name: 'asc' }
	});

    // const catParam = url.searchParams.get('category') || '';
    // let selectedCatId = null;
    // if (catParam && catParam !== '_uncategorized') {
    //     const c = categories.find(c => c.name === catParam);
    //     if (c) selectedCatId = c.id;
    // }
    // const activeSchema = await getActiveSchema(locals.activeInventoryId, selectedCatId, !catParam);
    const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);

    const containers = await db.container.findMany({
        where: { inventoryId: locals.activeInventoryId },
        orderBy: { name: 'asc' }
    });

    const tags = await db.tag.findMany({
        where: { inventoryId: locals.activeInventoryId },
        orderBy: { name: 'asc' }
    });
	
    // Faceted Search: Get accurate counts for all populated attributes via a single optimized `groupBy`
    const kvpGroupRaw = await db.kVP.groupBy({
        by: ['key', 'value'],
        _count: { itemId: true },
        where: { item: { inventoryId: locals.activeInventoryId } }
    });
    const attributeCounts = kvpGroupRaw.reduce((acc: any, curr) => {
        if (!acc[curr.key]) acc[curr.key] = {};
        acc[curr.key][curr.value] = curr._count.itemId;
        return acc;
    }, {});

    return { 
        q: url.searchParams.get('q') || '', 
        cat: url.searchParams.get('category') || '', 
        tag: url.searchParams.get('tag') || '', 
        container: url.searchParams.get('container') || '', 
        unassigned: url.searchParams.get('unassigned') === 'true', 
        duplicateStatus: url.searchParams.get('duplicateStatus') || '', 
        color: url.searchParams.get('color') || '[]', 
        titleStr: url.searchParams.get('title') || '', 
        descStr: url.searchParams.get('desc') || '', 
        docStr: url.searchParams.get('doc') || '', 
        docType: docType || '',
        reasonStr: url.searchParams.get('reason') || '', 
        minAmount: url.searchParams.get('minAmount') || '', 
        maxAmount: url.searchParams.get('maxAmount') || '', 
        items: data.items, 
        documentResults,        
        totalCount: data.totalCount, 
        prevPage: data.prevPage, 
        nextPage: data.nextPage, 
        categories,
        containers,
        tags,
        activeSchema,
        attributeCounts
    };
}) satisfies PageServerLoad;

export const actions = {
	bulkEdit: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { message: 'Unauthorized' });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { message: 'Forbidden. Viewer access only.' });

		const data = await request.formData();
        const rawItemIds = data.getAll('itemIds[]').map(Number);
		const action = data.get('bulkAction') as string;
		const value = data.get('bulkValue') as string;

        if (rawItemIds.length === 0) return fail(400, { message: 'No items selected' });
		if (!value || value.trim() === '') return fail(400, { message: 'Value cannot be empty' });

        const validItems = await db.item.findMany({ where: { id: { in: rawItemIds }, inventoryId: locals.activeInventoryId }, select: { id: true } });
        const itemIds = validItems.map(i => i.id);
        if (itemIds.length === 0) return fail(400, { message: 'No valid items selected' });

		if (action === 'addTag') {
			const { getTagIds } = await import('$lib/server/services');
			const tagIds = await getTagIds(value, locals.activeInventoryId);
			for (const id of itemIds) {
				await db.item.update({ where: { id }, data: { tags: { connect: tagIds } } });
			}
        } else if (action === 'deleteItems') {
            await db.item.deleteMany({ where: { id: { in: itemIds }, inventoryId: locals.activeInventoryId } });
            const { scrubEmptyCategories } = await import('$lib/server/categories');
            scrubEmptyCategories(locals.activeInventoryId).catch(console.error);
		} else if (action === 'removeTag') {
			const tag = await db.tag.findFirst({ where: { name: value.trim(), inventoryId: locals.activeInventoryId } });
			if (tag) {
				for (const id of itemIds) {
					await db.item.update({ where: { id }, data: { tags: { disconnect: { id: tag.id } } } });
				}
			}
		} else if (action === 'addContainer') {
			const container = await db.container.findFirst({ where: { name: value.trim(), inventoryId: locals.activeInventoryId }});
			if (container) {
				for (const id of itemIds) {
					await db.itemsInContainer.upsert({
						where: { itemId_containerId: { itemId: id, containerId: container.id } },
						create: { itemId: id, containerId: container.id },
						update: {}
					});
				}
			}
		} else if (action === 'removeContainer') {
			const container = await db.container.findFirst({ where: { name: value.trim(), inventoryId: locals.activeInventoryId }});
			if (container) {
				await db.itemsInContainer.deleteMany({
					where: { itemId: { in: itemIds }, containerId: container.id }
				});
			}
		} else if (action === 'setCategory') {
			const { getOrCreateCategory } = await import('$lib/server/categories');
			const cat = await getOrCreateCategory(value.trim(), locals.activeInventoryId);
			await db.photo.updateMany({
                where: { itemId: { in: itemIds }, item: { inventoryId: locals.activeInventoryId } },
				data: { categoryId: cat.id }
			});

            const { scrubEmptyCategories } = await import('$lib/server/categories');
            scrubEmptyCategories(locals.activeInventoryId).catch(console.error);
        } else if (action === 'flagDuplicate') {
            await db.item.updateMany({ where: { id: { in: itemIds }, inventoryId: locals.activeInventoryId }, data: { duplicateStatus: 'FLAGGED' } });
        } else if (action === 'dismissDuplicate') {
            await db.item.updateMany({ where: { id: { in: itemIds }, inventoryId: locals.activeInventoryId }, data: { duplicateStatus: 'DISMISSED' } });
        } else if (action === 'clearDuplicate') {
            await db.item.updateMany({ where: { id: { in: itemIds }, inventoryId: locals.activeInventoryId }, data: { duplicateStatus: 'NONE' } });
		}

		return { success: true };
	}
} satisfies Actions;
