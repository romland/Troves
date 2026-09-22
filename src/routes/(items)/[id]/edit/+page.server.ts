import { fail, redirect, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from "./$types";
import fs, { writeFileSync } from "fs";
import slugify from 'slugify';
import { db } from '$lib/server/database';
import type { Tag } from "@prisma/client";

import type { Item, Photo, Prisma } from '@prisma/client';
import { formKVPsToDBrows, getTagIds, consolidatePastedUrls } from "$lib/server/services";
import { uploadsDiskFolder, uploadsRemoteSite, uploadsWebFolder } from '$lib/server/constants';
import { downloadAndStoreDocuments } from "$lib/server/urldownloader";
import { savePhotos, processItemPhotosBackground } from '$lib/server/photouploads';
import { processFormDocuments } from '$lib/server/services';
import { logActivity } from '$lib/server/logger';
import { tokenizeAndStem } from '$lib/server/nlp';
import { getActiveSchema } from '$lib/server/ontology';
import { getAuthError } from '$lib/server/security';

export const load = (async ({ locals, params }) => {
    if (locals.role === 'VIEWER') throw error(403, 'Forbidden. Viewer access only.');
    const parsedId = Number(params.id);
    if (isNaN(parsedId)) error(404, 'Not found');

    const item = await db.item.findFirst({
        where: {
            AND: [
                { id: parsedId },
                { inventoryId: locals.activeInventoryId }
            ]
        },
        include: {
            inventory: true,
            photos: { include: { category: true } },
            documents: true,
            tags: true,
            locations: {
                include: {  
                    container: true,
                }
            },
            attributes: true,
            usage: true,
        }
    });

    if (!item) {
        redirect(302, '/');
    }

    const containers = await db.container.findMany({
        select : {
          name : true,
          parentId : true,
          photoPath : true,
          description : true,
          location : true,
          children : {
            select : {
              name : true,
              parentId : true,
              description : true,
            }
          },
        },
        where: {
            inventoryId: locals.activeInventoryId,
            parentId: null
        },
        orderBy: {
          name : "asc"
        }
    });

    return {
        item: {
            ...item,
            tagcsv: item.tags.map((tag: Tag, i: number) => i == 0 ? tag.name : ' ' + tag.name)
        },
        containers
    };
}) satisfies PageServerLoad;

/*
TODO:
x take care of refresh_images = essentially delete it, but then re-add it (orgPath) by running everything over it again,
  this is when we get happy that we populate other 'tables' (think: attributes) on client-side
x take care of delete_images
  Make sure to delete on disk too (or at least move away)
- ditto with delete/refresh_documents
x delete all containers (to be re-inserted)
x delete all attributes (to be re-inserted)
*/
export const actions = {
    default: async ({ request, params, locals }) => {
        const authErr = getAuthError(locals);
        if (authErr) return authErr;

        const orgData = await request.formData();
        const data = Object.fromEntries(orgData);
		const containers = [...new Set(orgData.getAll("containers").map(String).filter(c => c.trim().length > 0 && c !== 'undefined'))];

        const title = data.title as string;
        const description = data.description as string;
        const tagcsv = data.tagcsv as string;

        // if (title.length == 0) {
        //     return fail(400, {
        //         error: true,
        //         message: 'Field <strong>Title</strong> cannot be blank.'
        //     });
        // }
		const safeTitle = title.trim() || "New Item";

        /*
        if(containers.length === 0) {
            console.warn("Missing required field(s): containers");
            return fail(400, {
                error: true,
                message: 'You must have at least one <strong>Container</strong>.'
            });
        }
        */
  
          const { photos } = await savePhotos(data, uploadsDiskFolder, uploadsWebFolder, "file.", data.downloadImages as string);
		  const kvps: Prisma.KVPCreateWithoutItemInput[] = formKVPsToDBrows(data);
          const tagIds = await getTagIds(tagcsv, locals.activeInventoryId);


console.log("formData:", orgData);
// DEBUG
// return fail(400, {
//     error: true,
//     message: 'Debugging.'
// });
// DEBUG

        let item = await db.item.findUnique({
            where: {
                id: Number(params.id),
            },
            include: {
                photos: true,
                documents: true,
                    attributes: true,
            }
        });

        if (!item) return fail(404, { error: true, message: "Item not found." });

        const targetInventoryId = item.inventoryId;
        const hasAccess = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId: targetInventoryId, userId: locals.user.id } } });
        if (!hasAccess || hasAccess.role === 'VIEWER') return fail(403, { error: true, message: "Forbidden. Viewer access only." });

        // Holds all image IDs that existed before this item (new photos to be created are not here)
        const preExistingPhotoIds = item.photos.map(p=>p.id);
        const preExistingDocumentIds = item.documents.map(p=>p.id);

        // TODO: Wrap this in a Prisma transaction so we don't delete stuff without filling things back in.
        await db.item.update({
          where: { id: Number(params.id) },
          data: {
            attributes: {
              deleteMany: {}
            },
            locations: {
              deleteMany: {}
            },
          },
        });

        // Preserve the AI flag! If the human didn't change the value, it remains AI-generated.
        for (const kvp of kvps) {
            const existing = item.attributes.find(a => a.key === kvp.key);
            if (existing && existing.value === kvp.value) {
                kvp.isAutoGenerated = existing.isAutoGenerated;
            } else {
                kvp.isAutoGenerated = false;
            }
        }

		const parsedAmount = parseInt(data.amount as string, 10);

        // const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);
        // const subjectiveValues = kvps
        //     .filter(a => activeSchema.find((s: any) => s.name === a.key)?.matchWeight === 'SUBJECTIVE_TEXT')
        //     .map(a => a.value);
        // const semanticTokens = JSON.stringify(tokenizeAndStem([safeTitle, description.trim(), ...subjectiveValues]));
        const excludeKeys = new Set(['prominent_text_or_graphic', 'distinctive_blemishes_or_wear', 'color_mix', 'brand']);
        const descriptorValues = kvps.filter(a => !excludeKeys.has(a.key)).map(a => a.value);
        const semanticTokens = JSON.stringify(tokenizeAndStem([safeTitle, description.trim(), ...descriptorValues]));

        // Note: We overwrite the initial version of item here so that we have the new ID's
        //       of images, etc.
        item = await db.item.update({
            where: { id: Number(params.id) },
            data: {
				title: safeTitle,
                reason: data.reason as string || "",
				amount: isNaN(parsedAmount) ? null : parsedAmount,
                photos: {
                  create: photos
                },
                attributes: {
                  create: kvps,
                },
                semanticTokens,
                // valid (motherfucker)
                locations: {
                  create: containers.map((cont) => {
                    return {
                      container : {
                          connect: { inventoryId_name: { inventoryId: targetInventoryId, name: String(cont) } },
                      }
                    }
                  }),
                },
				slug: slugify(safeTitle.toLowerCase()) || "new-item",
                description: description.trim(),
                // authorId: locals.user.id,
                tags: {
                    set: [...tagIds]        // CHECK: set? on add: connect
                }
            },
            include: {
              photos : true,
              documents : true,
              attributes: true,
            }
        });

        const { takeSnapshot } = await import('$lib/server/itemHistory');
        await takeSnapshot(item.id, 'User Save');

        // Store all image IDs belonging to this item, including ones just created.
        const allExistingPhotoIds = item.photos.map(p=>p.id);
        const allExistingDocumentIds = item.documents.map(p=>p.id);

        data.urls = consolidatePastedUrls(orgData, data);

        // Fire and forget newly pasted document processing
        processFormDocuments(orgData, { itemId: item.id }, uploadsDiskFolder, uploadsWebFolder).catch(e => console.error(e));

        // Deal with refreshing and deleting documents and images.
        // Refresh takes presedence over delete (that is, if something is 
        // both deleted and refreshed, refresh wins)
        await refreshDeleteImages(data, allExistingPhotoIds, preExistingPhotoIds, item);
        data.urls += "\n" + await refreshDeleteDocuments(data, allExistingDocumentIds, preExistingDocumentIds, item);

        // Fire and forget heavy background scraping and ML analysis (Fast Ack)
		downloadAndStoreDocuments({ itemId: item.id }, uploadsRemoteSite, data, uploadsDiskFolder, uploadsWebFolder, "qr.").catch(e => console.error(e));
		processItemPhotosBackground(item, false).catch(e => console.error(e));

        const { extensionManager } = await import('$lib/server/extensions/ExtensionManager');
        extensionManager.trigger('onItemUpdated', {
            entity: item,
            context: { user: locals.user, inventoryId: item.inventoryId },
            intent: { isNew: false }
        });

		if (data.llm_attributes_used === 'true') {
            await logActivity(item.id, 'Attributes', 'Automatically structured messy attribute data using Smart Parsing', 'success');
		}

        const { ioQueue } = await import('$lib/server/queue/index');
        const { runDuplicateSweep, healDuplicateStatuses } = await import('$lib/server/matcher');
        ioQueue.add(async () => {
            await runDuplicateSweep(item.id, locals.activeInventoryId);
            await healDuplicateStatuses(locals.activeInventoryId);
        }, { targetType: 'item', targetId: item.id, description: 'Re-evaluating duplicates' }).catch(console.error);

        console.log("=== Done updating ===");

        redirect(302, `/${item?.id}/${item?.slug}`);
    }
} satisfies Actions;


async function refreshDeleteImages(data: { [k: string]: FormDataEntryValue; }, allExistingPhotoIds: number[], preExistingPhotoIds: number[], item: any)
{
    try {
        let imagesToDelete = JSON.parse((data.delete_images as string) || "[]");
        let imagesToRefresh = JSON.parse((data.refresh_images as string) || "[]");

        console.log({ imagesToDelete, imagesToRefresh });

        // Store the image IDs that were created this post (just now) (difference between before insert and now)
        const newPhotoIds = [...allExistingPhotoIds.filter(elem1 => preExistingPhotoIds.every(elem2 => elem2 != elem1))];

        // Remove all photos (from DB result array) that do not need a refresh.
        for (let i = item.photos?.length - 1; i >= 0; i--) {
            // Don't remove any photos we just created (they are still unprocessed)
            if (newPhotoIds.includes(item.photos[i].id) === false && imagesToRefresh.includes(item.photos[i].id) === false) {
                item.photos.splice(i, 1);
            } else {
                console.log("(Re)fresh photo:", item.photos[i].id);
            }
        }

        // Make sure the photos actually belong to this item.
        if (imagesToDelete.every(item => allExistingPhotoIds.includes(item))) {
            // Do not remove items that were flagged as both 'refresh' and 'delete'
            const toActuallyDelete = imagesToDelete.filter((el) => !imagesToRefresh.includes(el));

            console.log("Images to Actually DELETE:", toActuallyDelete);
            await db.item.update({
                where: {
                    id: item.id
                },
                data: {
                    photos: {
                        deleteMany: {
                            id: {
                                in: toActuallyDelete
                            }
                        }
                    }
                }
            });
            console.log("DELETED!");
        } else {
            throw "Illegal to delete one or more of images " + JSON.stringify(imagesToDelete);
        }

        // TODO?: delete files on disk for entities being refreshed
        console.log("Photos we will deal with going forward:", item.photos);
    } catch (ex) {
        console.error("Failed to deal with deletion/refresh of images", ex);
    }
}


async function refreshDeleteDocuments(data: { [k: string]: FormDataEntryValue; }, allExistingIds: number[], preExistingIds: number[], item: any)
{
    try {
        // let toDelete = JSON.parse(data.delete_documents as string);
        // let toRefresh = JSON.parse(data.refresh_documents as string);
        let toDelete = JSON.parse((data.delete_documents as string) || "[]");
        let toRefresh = JSON.parse((data.refresh_documents as string) || "[]");

        console.log({ toDelete, toRefresh });

        // Store the document IDs that were created this post (just now) (difference between before insert and now)
        const newIds = [...allExistingIds.filter(elt1 => preExistingIds.every(elt2 => elt2 != elt1))];

        // Remove all documents (from DB result array) that do not need a refresh.
        for (let i = item.documents?.length - 1; i >= 0; i--) {
            // Don't remove any documents we just created (they are still unprocessed)
            if (newIds.includes(item.documents[i].id) === false && toRefresh.includes(item.documents[i].id) === false) {
                item.documents.splice(i, 1);
            } else {
                console.log("(Re)fresh document:", item.documents[i].id);
            }
        }

        // Make sure the documents actually belong to this item.
        if (toDelete.every(item => allExistingIds.includes(item))) {
            // NOTE: This behaves differently than images, we will delete refreshed ones too
            const toActuallyDelete = [ ...toRefresh, ...toDelete ];

            console.log("Documents to Actually DELETE (which includes refresh ones):", toActuallyDelete);

            await db.item.update({
                where: {
                    id: item.id
                },
                data: {
                    documents: {
                        deleteMany: {
                            id: {
                                in: toActuallyDelete
                            }
                        }
                    }
                }
            });
            console.log("DELETED!");

        } else {
            throw "Illegal to delete one or more of documents " + JSON.stringify(toDelete);
        }

        // TODO?: delete files on disk for entities being refreshed
        const refreshUrls = item.documents.map((doc) => {
                if(toRefresh.includes(doc.id))
                    return /*doc.type + " " +*/ doc.source;
            }
        );

        // console.log("Documents we will deal with going forward:", item.documents);
        console.log("Documents we will deal with going forward:", refreshUrls);

        if(refreshUrls.length > 0) {
            return refreshUrls.join("\n");
        }

        return "";

    } catch (ex) {
        console.error("Failed to deal with deletion/refresh of documents", ex);
        return "";
    }
}


