import type { PageServerLoad, Actions } from './$types';

import slugify from 'slugify';
import fs from 'fs';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';

import type { Item, Photo, Prisma } from '@prisma/client';
import { createItemEntity, formKVPsToDBrows, getTagIds, processFormDocuments } from "$lib/server/services";
import { uploadsDiskFolder, uploadsRemoteSite, uploadsWebFolder } from '$lib/server/constants';
import { downloadAndStoreDocuments } from "$lib/server/urldownloader";
import { savePhotos } from '$lib/server/photouploads';
import { autoFill } from '$lib/server/autofill';
import { logActivity } from '$lib/server/logger';

export const actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
		if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });
		
		const orgData = await request.formData();
		const data = Object.fromEntries(orgData);
		
		const containers = [...new Set(orgData.getAll("containers").map(String).filter(c => c.trim().length > 0 && c !== 'undefined'))];
		const title = (data.title as string) || '';
		const description = (data.description as string) || '';
		const tagcsv = (data.tagcsv as string) || '';
		const clientId = data.clientId as string;
		
		const targetInventoryId = data.inventoryId ? Number(data.inventoryId) : locals.activeInventoryId;
		const hasAccess = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId: targetInventoryId, userId: locals.user.id } } });
		if (!hasAccess || hasAccess.role === 'VIEWER') return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });
		
		const { photos, extractedAttributes, extractedTitle, extractedDescription, extractedCategoryName, physical_traits, prominent_text_or_graphic, distinctive_blemishes_or_wear, color_mix } = await savePhotos(data, uploadsDiskFolder, uploadsWebFolder, "file.", data.downloadImages as string);
		const kvps: Prisma.KVPCreateWithoutItemInput[] = formKVPsToDBrows(data);
		const ids = await getTagIds(tagcsv, targetInventoryId);
		
		const safeTitle = (title.trim() || extractedTitle || "New Item").trim();
		const finalDesc = (description.trim() || extractedDescription || "").trim();
		
		if (extractedCategoryName && photos.length > 0) {
			const { getOrCreateCategory } = await import('$lib/server/categories');
			const cat = await getOrCreateCategory(extractedCategoryName, targetInventoryId);
			const prodPhoto: any = photos.find((p: any) => p.type === 'product');
			if (prodPhoto) prodPhoto.categoryId = cat.id;
		}
		
		let timelineNoteId = null;
		const vault = await db.inventory.findUnique({ where: { id: targetInventoryId }, select: { archiveSingleScans: true } });
		if (vault?.archiveSingleScans && photos.length > 0) {
			const prodPhoto = photos.find((p: any) => p.type === 'product') || photos[0];
			if (prodPhoto && prodPhoto.orgPath) {
				const note = await db.timelineNote.create({
					data: {
						content: `Item captured: ${safeTitle}`,
						category: 'archive',
						inventoryId: targetInventoryId,
						authorId: locals.user.id,
						photos: { create: [{ type: 'product', orgPath: prodPhoto.orgPath, showOriginal: true }] }
					}
				});
				timelineNoteId = note.id;
			}
		}
		
		
		const parsedAmount = parseInt(data.amount as string, 10);
		const item = await createItemEntity({
			title: safeTitle,
			description: finalDesc,
			clientId,
			reason: data.reason as string || "",
			amount: isNaN(parsedAmount) ? null : parsedAmount,
			inventoryId: targetInventoryId,
			userId: locals.user.id,
			containers,
			tagIds: ids,
			duplicateStatus: data.duplicateDismissed === 'true' ? 'DISMISSED' : (data.isDuplicateWarning === 'true' ? 'FLAGGED' : 'NONE'),
			photos,
			attributes: kvps,
			extractedAttributes,
			physical_traits,
			prominent_text_or_graphic,
			distinctive_blemishes_or_wear,
			color_mix,
			timelineNoteId
		});
		
		data.urls = data.urls || "";
		const pastedUrls = orgData.getAll("pasted_urls[]") as string[];
		if (pastedUrls.length > 0) {
			data.urls = (data.urls as string || "") + "\n" + pastedUrls.join("\n");
		}
		
		const preDocsRaw = orgData.getAll("preprocessed_docs[]");
		const preDocs = preDocsRaw.map(d => JSON.parse(d as string));
		const preprocessedSources = new Set(preDocs.map(d => d.source));
		
		if (data.urls) {
			data.urls = (data.urls as string)
			.split('\n')
			.filter(u => u.trim() && !preprocessedSources.has(u.trim()))
			.join('\n');
		}
		
		// Fire and forget heavy IO & ML tasks so the server returns "200 OK" to the outbox instantly
		processFormDocuments(orgData, { itemId: item.id }, uploadsDiskFolder, uploadsWebFolder).catch(e => console.error(e));
		downloadAndStoreDocuments({ itemId: item.id }, uploadsRemoteSite, data, uploadsDiskFolder, uploadsWebFolder, "qr.").catch(e => console.error(e));
		
		if (data.llm_attributes_used === 'true') {
			await logActivity(item.id, 'Attributes', 'Automatically structured messy attribute data using AI', 'success');
		}
		
		redirect(302, `/${item.id}/${item.slug}`);
	}
} satisfies Actions;


export const load = (async ({ locals, params }) => {
	const vault = await db.inventory.findUnique({
		where: { id: locals.activeInventoryId },
		include: { templateFields: true }
	});
	
	if (vault?.allowAutoTaxonomy && vault.templateFields.length === 0) {
		return { isBootstrapping: true, containers: [], categories: [], tags: [] };
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
	
	const categories = await db.category.findMany({
		where: { inventoryId: locals.activeInventoryId },
		orderBy: { name: 'asc' }
	});
	
	const tags = await db.tag.findMany({
		where: { inventoryId: locals.activeInventoryId },
		orderBy: { name: 'asc' }
	});
	
	return {
		containers,
		categories,
		tags
	};
}) satisfies PageServerLoad;
