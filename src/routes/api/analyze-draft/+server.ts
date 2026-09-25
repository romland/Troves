import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guessProductDetails, analyzePhoto } from '$lib/server/vision-classification';
import { processDraftPhotoBackground, activeDrafts } from '$lib/server/photouploads';
import { apiQueue } from '$lib/server/queue/index';
import { getActiveSchema } from '$lib/server/ontology';
import { getExistingCategoryNames } from '$lib/server/categories';
import { db } from '$lib/server/database';
import { findBestMatch, buildDuplicateDetails } from '$lib/server/matcher';
import { tokenizeAndStem } from '$lib/server/nlp';
import { MediaIngest } from '$lib/server/services/MediaIngest';
import fs from 'fs';

export const POST: RequestHandler = async ({ request, locals }) => {
    try {
        if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

        const data = await request.formData();
        const file = data.get('file') as File;
        const type = data.get('type') as string || 'product';
        
        if (!file || !file.size) {
            return json({ error: 'No file provided' }, { status: 400 });
        }
        
        // Save to the staging area immediately
		const { localPath, webPath, hash } = await MediaIngest.saveUploadedImage(file, 'draft');

        // Run the fast Gemini analysis for the UI
        let aiData = null;
        let classificationData = null;
        let isDuplicate = false;
        let duplicateItemDetails = null;
        let activeSchema: any[] = [];
        try {
            const inventory = await db.inventory.findUnique({ where: { id: locals.activeInventoryId }, select: { allowNewCategories: true, archetype: true } });
            const allowNew = inventory?.allowNewCategories ?? true;
            const archetype = inventory?.archetype || 'generic';
            const existingCategories = await getExistingCategoryNames(locals.activeInventoryId);
            activeSchema = await getActiveSchema(locals.activeInventoryId, null, true);

            const analyzePromise = apiQueue.add(() => analyzePhoto(localPath, existingCategories, allowNew, activeSchema, undefined, locals.activeInventoryId, archetype), { targetType: 'global', targetId: 0, description: 'Extracting physical traits and title' });

            activeDrafts.set(hash, { promise: analyzePromise, draftPath: webPath });
            setTimeout(() => activeDrafts.delete(hash), 5 * 60 * 1000); // 5 min TTL
            
            classificationData = await analyzePromise;
            
            if (classificationData) {
                const existingItems = await db.item.findMany({
                    where: { inventoryId: locals.activeInventoryId },
                    include: { attributes: true, locations: { include: { container: true } }, photos: true }
                });

                const scanTokens = tokenizeAndStem([
                    classificationData.title, 
                    classificationData.description, 
                    ...(classificationData.physical_traits || [])
                ]);

                const scanCtx = {
                    tokens: scanTokens,
                    colorMix: classificationData.color_mix,
                    title: classificationData.title || '',
                    description: classificationData.description || classificationData.subtitle || '',
                    rawText: '',
                    category: classificationData.subCategory,
                    prominentTextOrGraphic: classificationData.prominent_text_or_graphic,
                    distinctiveWear: classificationData.distinctive_blemishes_or_wear,
                    extractedAttributes: classificationData.extractedAttributes,
                    archetype
                };
                const bestMatch = findBestMatch(scanCtx, existingItems, undefined);
                
                if (bestMatch) {
                    isDuplicate = true;
                    console.log(`[DEBUG] ⚠️ BEST MATCH: ID ${bestMatch.dbItem.id} "${bestMatch.dbItem.title}" (Score: ${bestMatch.match.score})`);
                    console.log(`[DEBUG] Trace:\n  ` + bestMatch.match.debugTrace?.join('\n  '));
                    duplicateItemDetails = buildDuplicateDetails(bestMatch.dbItem, bestMatch.match);
                }
            }

            let snappedAttrs = classificationData?.extractedAttributes || {};
            if (classificationData && classificationData.extractedAttributes) {
                const { cleanAndSnapAttributes } = await import('$lib/server/services');
                snappedAttrs = await cleanAndSnapAttributes(classificationData.extractedAttributes, activeSchema);
                classificationData.extractedAttributes = snappedAttrs;
            }

            aiData = {
                title: classificationData?.title,
                description: classificationData?.description || classificationData?.subtitle || null,
                photoType: classificationData?.photoType,
                subCategory: classificationData?.subCategory,
                isDuplicate,
                duplicateItemDetails,
                extractedAttributes: snappedAttrs
            };

            if (classificationData) {
                const initialDraftData = {
                    title: classificationData.title || null,
                    description: classificationData.description || classificationData.subtitle || null,
                    llmAnalysis: JSON.stringify(classificationData),
                    categoryName: classificationData?.subCategory || null,
                    physical_traits: classificationData.physical_traits,
                    prominent_text_or_graphic: classificationData.prominent_text_or_graphic,
                    distinctive_blemishes_or_wear: classificationData.distinctive_blemishes_or_wear,
                    color_mix: classificationData.color_mix,
                    foregroundBox: classificationData.foregroundBox || null,
                    extractedAttributes: snappedAttrs
                };
                fs.writeFileSync(`${localPath}.json`, JSON.stringify(initialDraftData), 'utf8');
            }

    } catch (aiError: any) {
        if (aiError?.message?.includes('API Key missing') || aiError?.message?.includes('API key')) {
            console.warn("[Vision] Skipping Draft Analysis: Vision Engine API keys missing.");
        } else {
            console.warn("Draft Analysis failed:", aiError);
        }
        }
        
        // Kick off heavy processing in the background for ALL image types (Fire-and-forget)
        processDraftPhotoBackground(webPath, type, locals.activeInventoryId, classificationData).catch(e => console.error(e));
        
        // Return the fast UI updates immediately
        return json({
            success: true,
            draftPath: webPath,
            aiData,
            activeSchema
        });
        
    } catch (e) {
        console.error("Draft upload error:", e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};