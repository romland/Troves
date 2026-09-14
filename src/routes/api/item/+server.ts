/*
Doc: https://kit.svelte.dev/docs/routing#server
*/
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { marked } from "marked";
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { json } from '@sveltejs/kit';
import slugify from 'slugify';
  import { cropPolygon } from '$lib/server/vision/polygonCrop';
import { logActivity } from '$lib/server/logger';
import { taskManager } from '$lib/server/taskManager';
import { assertCanMutate } from '$lib/server/security';

/*
TODO SECURITY: NEED TO IMPLEMENT AUTHORIZATION HERE (HOW IS IT DONE ELSEWHERE?)
*/

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, setHeaders, locals }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

	setHeaders({
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
	});

    const parsedId = Number(url.searchParams.get('id'));
    if (isNaN(parsedId) || parsedId === 0) error(400, 'Invalid ID');

    const item = await db.item.findFirst({
        where: {
            AND: [
                // { author: { id: locals.user.id } },
                // { id: Number(url.searchParams.get('id')) },
                { id: parsedId },
                { inventoryId: locals.activeInventoryId }
            ]
        },
        include: {
            inventory: true,
            photos: true,
            documents: true,
            tags: true,
            attributes: true,
            usage: true,
            locations: {
                include: {
                    container: {
                        include : { parent : true }
                    },
                }
            },
            logs: { orderBy: { createdAt: 'desc' } }
        }
    });

    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    const ret = {
        ...item,
        contentToHtml: purify.sanitize(await marked.parse(item.description!, {gfm:true,breaks:true}))
    }

	return new Response(JSON.stringify(ret));
}

export async function POST({ request, locals }) {
    assertCanMutate(locals);

    const formData = await request.formData();
    const title = (formData.get('title') as string) || 'Untitled Item';
    const description = (formData.get('description') as string) || '';
    let draftPath = (formData.get('draftPath') as string)?.split('?')[0].split('#')[0];
    
    // Strict anti-traversal check
    if (draftPath && (draftPath.includes('..') || !draftPath.startsWith('/images/'))) {
        draftPath = ''; 
    }
    const boxStr = formData.get('box') as string;
    const container = formData.get('container') as string;
    const extractedAttributesStr = formData.get('extractedAttributes') as string;
    const tagcsv = formData.get('tagcsv') as string;
    const categoryName = formData.get('categoryName') as string;

    // INTERCEPT: Check if this is a "Move" action routed through the offline queue
    if (formData.has('action') && formData.get('action') === 'move') {
        const moveItemId = Number(formData.get('itemId'));
        const newContainer = formData.get('newContainer') as string;
        const spatialMapStr = formData.get('spatialMap') as string;

        const itemBelongsToVault = await db.item.findFirst({ where: { id: moveItemId, inventoryId: locals.activeInventoryId } });
        if (!itemBelongsToVault) return json({ error: 'Item not found in current trove' }, { status: 404 });

        const exists = await db.container.findUnique({ where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: newContainer } }});
        
        if (exists) {
            await db.item.update({
                where: { id: moveItemId },
                data: {
                    locations: {
                        deleteMany: {},
                        create: [{ spatialMap: spatialMapStr || null, container: { connect: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: newContainer } } } }]
                    }
                }
            });
            await logActivity(moveItemId, 'Location', `Moved to '${newContainer}' via Audit Lens.`, 'success');
        } else {
            await logActivity(moveItemId, 'Location', `Failed quick-move: Location '${newContainer}' no longer exists.`, 'error');
        }
        return json({ success: true });
    }

    let finalPathForProduct = draftPath;

    if (draftPath && boxStr) {
        try {
            const box = JSON.parse(boxStr);
            const localDraftPath = `data${draftPath}`;
            const extracted = await cropPolygon(localDraftPath, box, title);
            if (extracted) finalPathForProduct = extracted;
        } catch (e) {
            console.error("Failed to crop image from box", e);
        }
    }

    let noteId = null;
    if (draftPath) {
        let note = await db.timelineNote.findFirst({
            where: { inventoryId: locals.activeInventoryId, category: 'archive', photos: { some: { orgPath: draftPath } } }
        });
        if (!note) {
            note = await db.timelineNote.create({
                data: { content: `Comparison Scan Source`, category: 'archive', inventoryId: locals.activeInventoryId, authorId: locals.user.id, photos: { create: [{ type: 'information', orgPath: draftPath }] } }
            });
        }
        noteId = note.id;
    }

    const vault = await db.inventory.findUnique({ where: { id: locals.activeInventoryId }});
    if (vault?.archiveSingleScans && !noteId && draftPath) {
        const note = await db.timelineNote.create({
            data: { content: `Quick Scan Capture`, category: 'archive', inventoryId: locals.activeInventoryId, authorId: locals.user.id, photos: { create: [{ type: 'product', orgPath: draftPath }] } }
        });
        noteId = note.id;
    }

    const { createItemEntity, getTagIds } = await import('$lib/server/services');
    const tagIds = tagcsv ? await getTagIds(tagcsv, locals.activeInventoryId) : undefined;
    
    let catId = undefined;
    if (categoryName) {
        const { getOrCreateCategory } = await import('$lib/server/categories');
        const cat = await getOrCreateCategory(categoryName, locals.activeInventoryId);
        catId = cat.id;
    }

    const item = await createItemEntity({
        title,
        description,
        inventoryId: locals.activeInventoryId,
        userId: locals.user.id,
        containers: container ? [container] : [],
        tagIds,
        extractedAttributes: extractedAttributesStr,
        photos: draftPath ? [{ type: 'product', orgPath: finalPathForProduct, ...(catId ? { categoryId: catId } : {}) }] : [],
        timelineNoteId: noteId
    });


    await logActivity(item.id, 'Creation', `Item added from Quick Action (Compare Lens)`, 'success');

    if (draftPath) {
        await logActivity(item.id, 'Extraction', `Cropped bounding box out of original scan`, 'info');
    }

    return json({ success: true, id: item.id });
}

