import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { processDraftPhotoBackground } from '$lib/server/photouploads';
import { apiQueue } from '$lib/server/queue/index';
import { db } from '$lib/server/database';
import { withRetry } from '$lib/server/retry';
import { getActiveSchema } from '$lib/server/ontology';
import { computeMatch, normalizeStr, isUseless, buildDuplicateDetails, computeIdfMap, findBestMatchesForBatch } from '$lib/server/matcher';
import { BASE_COLORS } from '$lib/server/colors';
import { tokenizeAndStem } from '$lib/server/nlp';
import { MediaIngest } from '$lib/server/services/MediaIngest';
import fs from 'fs';
import { analyzeBulkCollection } from '$lib/server/gemini-classification';


export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    try {
        const data = await request.formData();
        const file = data.get('file') as File;

		const { localPath, webPath, mimeType } = await MediaIngest.saveUploadedImage(file, 'collection');
        processDraftPhotoBackground(webPath, 'information', locals.activeInventoryId).catch(e => console.error(e));

        const note = await db.timelineNote.create({
            data: {
                content: "Multi-Scan capture (Pending triage)",
                authorId: locals.user.id,
                inventoryId: locals.activeInventoryId,
                category: 'archive',
                photos: { create: [{ type: 'information', orgPath: webPath }] }
            }
        });

        const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);
		const hint = data.get('hint') as string;

        const aiResponse = await apiQueue.add(
            () => analyzeBulkCollection(localPath, mimeType, activeSchema, hint, { targetType: 'global', targetId: 0 }),
            { targetType: 'global', targetId: 0, description: 'Analyzing Multi-Scan items with Vision Model' }
        );

        const dbItems = await db.item.findMany({
            where: { inventoryId: locals.activeInventoryId },
            include: { attributes: true, locations: { include: { container: true } }, photos: { include: { category: true } }, tags: true }
        });
        const categories = await db.category.findMany({ where: { inventoryId: locals.activeInventoryId } });
        const vault = await db.inventory.findUnique({ where: { id: locals.activeInventoryId } });
        const defaultStrategy = vault?.duplicateStrategy || 'PROMPT';
        const archetype = vault?.archetype || 'generic';

        const { annotatedScannedItems } = findBestMatchesForBatch(aiResponse.items, dbItems, undefined, archetype);
        
        console.log(`[MATCH-DEBUG] analyze-multi-scan API: annotatedScannedItems length: ${annotatedScannedItems.length}`);

        for (const item of annotatedScannedItems) {
            item.duplicateStrategy = defaultStrategy;
            if (item.category) {
                const cat = categories.find((c: any) => c.name.toLowerCase() === item.category.toLowerCase());
                if (cat && cat.duplicateStrategy) item.duplicateStrategy = cat.duplicateStrategy;
            }
            console.log(`[MATCH-DEBUG] Returning to UI -> Item: "${item.title}" | isDuplicate: ${item.isDuplicate}`);
        }

        return json({ success: true, draftPath: webPath, noteId: note.id, totalVisibleCount: aiResponse.totalVisibleCount, collectionType: aiResponse.collectionType, items: annotatedScannedItems });
    } catch (e) {
        console.error("Multi-Scan analysis error:", e);
        const err = e as any;
        const is503 = err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('demand');
        const errorMessage = is503 
            ? "Vision service is currently experiencing high demand. Please wait a few moments and try again." 
            : "An unexpected error occurred while analyzing the image. Please try another photo.";

        return json({ success: false, error: errorMessage }, { status: is503 ? 503 : 500 });
    }
};