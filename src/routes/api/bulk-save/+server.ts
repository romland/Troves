import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { ioQueue } from '$lib/server/queue/index';
import slugify from 'slugify';
import { taskManager } from '$lib/server/taskManager';
import { getTagIds } from '$lib/server/services';
  import { cropPolygon } from '$lib/server/vision/polygonCrop';
import { assertCanMutate } from '$lib/server/security';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);

    const payloadData = await request.json();
    const { draftPath, noteId, containers, items, globalCategory, tagcsv } = payloadData;
    const userId = locals.user.id;
    const inventoryId = payloadData.inventoryId ? Number(payloadData.inventoryId) : locals.activeInventoryId;
    
    const hasAccess = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId, userId } } });
    if (!hasAccess || hasAccess.role === 'VIEWER') return json({ error: 'Forbidden' }, { status: 403 });

    // Strict anti-traversal check
    if (draftPath && (draftPath.includes('..') || !draftPath.startsWith('/images/'))) {
        return json({ error: 'Invalid path' }, { status: 400 });
    }

    const inv = await db.inventory.findUnique({ where: { id: inventoryId }, select: { deepScanCollections: true } });
    const doDeepScan = inv?.deepScanCollections ?? false;

    // Fire and forget background worker
    ioQueue.add(async () => {
        const taskId = taskManager.start('global', 0, `Saving ${items.length} items from trove...`);
        try {
            // Pre-process tags
            const tagIds = tagcsv ? await getTagIds(tagcsv, inventoryId) : [];

            // 1. Context Preservation: Update the pre-created notebook entry
            if (noteId) {
                await db.timelineNote.updateMany({
                    where: { id: noteId, inventoryId },
                    data: {
                        content: `Collection Scan - ${containers?.length ? containers.join(', ') : 'Unassigned Location'}`,
                    }
                });
            }

            const localDraftPath = `data${draftPath}`;
            
            // 3. Process approved items
            for (const item of items) {
                if (item.resolution === 'merge' && item.duplicateItemDetails?.id) {
                    // SECURITY: Verify the target item belongs to the active inventory before mutating!
                    const targetItem = await db.item.findUnique({ where: { id: item.duplicateItemDetails.id }, select: { inventoryId: true } });
                    if (!targetItem || targetItem.inventoryId !== inventoryId) {
                        console.warn(`[Security] Blocked IDOR attempt: Tried to merge into item ${item.duplicateItemDetails.id} outside inventory ${inventoryId}`);
                        continue;
                    }
                    await db.item.update({
                        where: { id: item.duplicateItemDetails.id },
                        data: { amount: { increment: 1 } }
                    });
                    if (containers && containers.length > 0) {
                        for (const cName of containers) {
                            const container = await db.container.findUnique({ where: { inventoryId_name: { inventoryId, name: cName } } });
                            if (container) {
                                await db.itemsInContainer.upsert({
                                    where: { itemId_containerId: { itemId: item.duplicateItemDetails.id, containerId: container.id } },
                                    update: {},
                                    create: { itemId: item.duplicateItemDetails.id, containerId: container.id }
                                });
                            }
                        }
                    }
                    continue; // Skip creating a new row for this item
                }

                let cropWebPath = draftPath;
                if (item.box) {
                    const extracted = await cropPolygon(localDraftPath, item.box, slugify(item.title || 'item', { lower: true, strict: true }));
                    if (extracted) cropWebPath = extracted;
                }

                // Build KVP array dynamically
                const attributesToCreate = [];
                if (item.subtitle) attributesToCreate.push({ key: "Subtitle", value: item.subtitle });
                attributesToCreate.push({ key: "Source Scan", value: draftPath });

                // Respect item-level category unless user explicitly typed an override
                const finalCategoryName = globalCategory?.trim() || item.category || 'Unknown';
                
                // Formally categorize it like the standard upload pipeline does
                const { getOrCreateCategory } = await import('$lib/server/categories');
                const cat = await getOrCreateCategory(finalCategoryName, inventoryId);

                // Only mock the ML response if Deep Scan is off. If it's on, omitting this forces the background worker to analyze it.
                const simulatedLlmAnalysis = doDeepScan ? undefined : JSON.stringify({
                    photoType: 'product',
                    subCategory: finalCategoryName.toLowerCase(),
                    isNewCategory: false,
                    description: item.title || 'Collection item'
                });

                // Assemble the item
                const { createItemEntity } = await import('$lib/server/services');
                const createdItem = await createItemEntity({
                    title: item.title,
                    description: item.subtitle || "",
                    amount: 1,
                    inventoryId,
                    userId,
                    containers,
                    tagIds,
                    photos: [{
                        type: 'product',
                        orgPath: cropWebPath,
                        categoryId: cat.id,
                        ...(simulatedLlmAnalysis ? { llmAnalysis: simulatedLlmAnalysis } : {}), showOriginal: true
                    }] as any[],
                    attributes: attributesToCreate,
                    extractedAttributes: item.extractedAttributes,
                    physical_traits: item.physical_traits,
                    prominent_text_or_graphic: item.prominent_text_or_graphic,
                    distinctive_blemishes_or_wear: item.distinctive_blemishes_or_wear,
                    color_mix: item.color_mix,
                    timelineNoteId: noteId,
                    duplicateStatus: item.resolution === 'new' ? 'DISMISSED' : (item.isDuplicate ? 'FLAGGED' : 'NONE')
                });

                // QUEUE BACKGROUND REMOVAL & ML PROCESSING!
                const { processItemPhotosBackground } = await import('$lib/server/photouploads');
                const itemForBg = await db.item.findUnique({ where: { id: createdItem.id }, include: { photos: true } });
                if (itemForBg) processItemPhotosBackground(itemForBg).catch(e => console.error(e));
            }
        } catch (e) {
            console.error("Bulk processing failed:", e);
        } finally {
            taskManager.end(taskId);
        }
    });

    return json({ success: true });
};