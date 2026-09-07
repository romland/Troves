import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { env } from '$env/dynamic/private';
import { MediaIngest } from '$lib/server/services/MediaIngest';
import fs from 'fs';
import { taskManager } from '$lib/server/taskManager';
import { apiQueue } from '$lib/server/queue/index';
import { getActiveSchema } from '$lib/server/ontology';
import { computeMatch, normalizeStr, findBestMatch, computeIdfMap, findBestMatchesForBatch } from '$lib/server/matcher';
import { withRetry } from '$lib/server/retry';
import { tokenizeAndStem } from '$lib/server/nlp';
import { analyzeBulkCollection } from '$lib/server/gemini-classification';


export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    const taskId = taskManager.start('global', 0, 'Analyzing comparison image');

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const scopeType = (formData.get('scopeType') as string) || 'all'; // 'all' | 'tag' | 'category' | 'container'
        const scopeValue = (formData.get('scopeValue') as string) || '';
        const hint = (formData.get('hint') as string) || '';

        const { localPath: localDiskPath, webPath, mimeType } = await MediaIngest.saveUploadedImage(file, 'compare-scan', { maxWidth: 1600 });
		
		const activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);

        const parsed = await apiQueue.add(
            () => analyzeBulkCollection(localDiskPath, mimeType, activeSchema, hint, { targetType: 'global', targetId: 0 }),
            { targetType: 'global', targetId: 0, description: 'Matching physical items against Trove' }
        );

        const detected = parsed.items || [];
        const totalVisibleCount = parsed.totalVisibleCount || detected.length;

        // Always fetch ALL items in the inventory so we can identify items from other locations
        const dbItems = await db.item.findMany({
            where: { inventoryId: locals.activeInventoryId },
            include: { locations: { include: { container: true } }, tags: true, attributes: true, photos: { include: { category: true } } }
        });

        const vault = await db.inventory.findUnique({ where: { id: locals.activeInventoryId }, select: { archetype: true } });
        const archetype = vault?.archetype || 'generic';

        const { inCollection, newToYou, idUsage } = findBestMatchesForBatch(detected, dbItems, undefined, archetype);

        const missingFromScope = (scopeType !== 'all' ? dbItems.filter(i => {
            const used = idUsage.get(i.id) || 0;
            const available = i.amount || 1;
            if (used >= available) return false; // Not missing!

            if (scopeType === 'tag' && scopeValue) return i.tags.some(t => t.slug === scopeValue.toLowerCase().replace(/ /g, '-'));
            if (scopeType === 'category' && scopeValue) return i.photos?.some(p => p.category?.name === scopeValue);
            if (scopeType === 'container' && scopeValue) return i.locations.some(l => l.container.name === scopeValue);
            return false;
        }) : []).map(i => ({ id: i.id, title: i.title, slug: i.slug, amount: i.amount, locationName: i.locations?.[0]?.container?.name || null, thumbPath: i.photos?.[0]?.thumbPath || i.photos?.[0]?.orgPath || null }));

        return json({ success: true, draftPath: webPath, totalDetected: detected.length, totalVisibleCount, inCollection, newToYou, missingFromScope, scopeType, scopeValue, activeSchema });
    } catch (e: any) {
        return json({ error: e.message || 'Comparison scan failed' }, { status: 500 });
    }
    finally {
        taskManager.end(taskId);
    }
};