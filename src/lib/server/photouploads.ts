import fs from 'fs';
import { writeFileSync, promises as fsPromises } from "fs";
import fetch from 'node-fetch';
import FormData from 'form-data';

import { getOCRdata } from '$lib/server/ocr';
import { generatePhotoDerivatives } from '$lib/server/imageProcessor';
import { apiQueue, ioQueue, heavyMlQueue, lightMlQueue } from '$lib/server/queue/index';
import { logActivity } from '$lib/server/logger';
import { db } from '$lib/server/database';
import { autoFill } from '$lib/server/autofill';
import { taskManager, type TaskContext } from '$lib/server/taskManager';
import sharp from 'sharp';
import crypto from 'crypto';
import { getSafeFilename } from './fsUtils';
import { isVideo, isImage } from '$lib/shared/fileutils';

// Global memory lock to synchronize fast-workflow draft uploads with background LLM tasks
export const activeDrafts = new Map<string, { promise: Promise<any>, draftPath: string }>();
// Global memory lock for the heavy background pipeline (OCR, RemBG, Crops)
export const activeHeavyTasks = new Map<string, Promise<void>>();

const ocrCircuitBreaker = {
    failures: 0,
    trippedUntil: 0,
    isTripped() { return Date.now() < this.trippedUntil; },
    trip() {
        this.failures++;
        if (this.failures >= 3) {
            this.trippedUntil = Date.now() + 5 * 60 * 1000; // Bypass for 5 minutes
            console.warn("[Circuit Breaker] 🛑 OCR service failed 3 times in a row. Bypassing OCR for 5 minutes to preserve pipeline speed.");
        }
    },
    reset() { this.failures = 0; this.trippedUntil = 0; }
};


import type { Item, Photo } from '@prisma/client';
import slugify from 'slugify';
import QRUrlDownloader from "$lib/server/urldownloader";
// import { analyzePhoto } from '$lib/server/gemini-classification';
// import { getExistingCategoryNames, getOrCreateCategory } from '$lib/server/categories';

export function readValidSidecar(jsonPath: string) {
    if (!fs.existsSync(jsonPath)) return null;
    try {
        const sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (sidecar.ocr || sidecar.thumbPath || sidecar.colors) return sidecar;
    } catch (e) {
        console.error(`[Background Task] Failed to read/parse sidecar at ${jsonPath}:`, e);
    }
    return null;
}


export async function enrichPhotoData(localPath: string, webPath: string, type: string, inventoryId: number, tracking?: TaskContext, skipLlm: boolean = false, precomputedBox?: number[] | null, bgRemovalOverride?: boolean): Promise<any> {
    const tempPhoto = { id: -1, orgPath: webPath, type } as any;
    
    let exifDataJson: string | null = null;
    let bgRemovalEnabled = true;
    let bgRemovalPreCrop = false;
    let bgRemovalModel = 'bria-rmbg';
    let enablePaddleOCR = true;
    try {
        const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { extractExif: true, bgRemovalEnabled: true, bgRemovalPreCrop: true, enablePaddleOCR: true, bgRemovalModel: true }});
        if (vault?.extractExif) {
            const metadata = await sharp(localPath).metadata();
            if (metadata.exif) {
                const exifReader = (await import('exif-reader')).default;
                const parsedExif: any = exifReader(metadata.exif);
                
                // Strip out thumbnails and huge proprietary binary blobs
                delete parsedExif.thumbnail;
                if (parsedExif.exif?.MakerNote) delete parsedExif.exif.MakerNote;
                if (parsedExif.exif?.UserComment) delete parsedExif.exif.UserComment;
                
                exifDataJson = JSON.stringify(parsedExif, (key, value) => {
                    // Drop any remaining raw buffers or huge byte arrays
                    if (Buffer.isBuffer(value) || (value && value.type === 'Buffer')) return undefined;
                    if (Array.isArray(value) && value.length > 50 && typeof value[0] === 'number') return undefined;
                    return value;
                });
            }
        }
        bgRemovalEnabled = bgRemovalOverride !== undefined ? bgRemovalOverride : (vault?.bgRemovalEnabled ?? true);
        bgRemovalPreCrop = vault?.bgRemovalPreCrop ?? false;
        bgRemovalModel = vault?.bgRemovalModel ?? 'bria-rmbg';
        enablePaddleOCR = vault?.enablePaddleOCR ?? true;
    } catch(e) { console.error("[Background Task] EXIF extraction failed:", e); }
    
    let finalOrgPath = webPath;
    let currentLocalPath = localPath;
    const isVideoFile = isVideo(localPath);
    if (!isVideoFile && !localPath.match(/\.webp$/i)) {
        let newLocalPath = localPath.replace(/\.[^/.]+$/, '.webp');
        let newWebPath = webPath.replace(/\.[^/.]+$/, '.webp');

        // Fallback: If slugify stripped the extension entirely, just append .webp
        if (newLocalPath === localPath) {
            newLocalPath = `${localPath}.webp`;
            newWebPath = `${webPath}.webp`;
        }

        await heavyMlQueue.add(
            () => sharp(localPath).rotate().webp({ quality: 85 }).toFile(newLocalPath),
            tracking ? { ...tracking, description: 'Converting image to WebP' } : undefined
        );
        fs.unlinkSync(localPath);
        finalOrgPath = newWebPath;
        tempPhoto.orgPath = finalOrgPath;
        currentLocalPath = newLocalPath;
    }
    
    let categoryName = null;
    let llmAnalysis = null;
    let extractedAttributes = null;
    let foregroundBox = precomputedBox || null;

    // 1. KICK OFF GEMINI (Network I/O, does not block local CPU)
    let geminiPromise = Promise.resolve<any>(null);
    if (!skipLlm && (type === 'product' || type === 'information' || type === 'other')) {
        geminiPromise = (async () => {
            try {
                const { analyzePhoto } = await import('$lib/server/gemini-classification');
                const { getExistingCategoryNames } = await import('$lib/server/categories');
                const { getActiveSchema } = await import('$lib/server/ontology');
                const existingCategories = await getExistingCategoryNames(inventoryId);
                const inv = await db.inventory.findUnique({ where: { id: inventoryId } });
                const allowNew = inv?.allowNewCategories ?? true;
                const activeSchema = await getActiveSchema(inventoryId, tempPhoto.categoryId);      

                const analysis = await apiQueue.add(
                    () => analyzePhoto(currentLocalPath, existingCategories, allowNew, activeSchema, tracking?.targetId as number | undefined),
                    tracking ? { ...tracking, description: 'Classifying image via ML' } : undefined
                );
                
                if (analysis.searchSynonyms && tempPhoto.itemId) {
                    const { getTagIds } = await import('$lib/server/services');
                    const tagIds = await getTagIds(analysis.searchSynonyms.join(','), inventoryId);
                    await db.item.update({ where: { id: tempPhoto.itemId }, data: { tags: { connect: tagIds } }});
                }
                return analysis;
            } catch (e) { 
                console.error("[Background Task] LLM classification failed:", e); 
                return null;
            }
        })();
    }

    // 2. KICK OFF LOCAL ML (Sequential to protect CPU, concurrent with Gemini)
    const localPipelinePromise = (async () => {
        const ocrResult = enablePaddleOCR ? await lightMlQueue.add(async () => {
            if (ocrCircuitBreaker.isTripped()) return null;
            try {
                const res = await Promise.race([
                    getOCRdata(currentLocalPath, undefined).catch(() => null),
                    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('OCR Timeout')), 10000))
                ]);
                ocrCircuitBreaker.reset();
                return res;
            } catch (e) {
                console.error(`[Background Task] OCR timed out or failed for ${currentLocalPath}`);
                ocrCircuitBreaker.trip();
                return null;
            }
        }, tracking ? { ...tracking, description: 'Extracting text (OCR)' } : undefined) : null;

        let boxToUse = null;
        if (bgRemovalPreCrop) {
            if (precomputedBox) {
                boxToUse = precomputedBox;
            } else if (!skipLlm) {
                // Will gracefully await Gemini only if pre-crop setting is actually turned on
                const analysis = await geminiPromise;
                boxToUse = analysis?.foregroundBox || null;
            }
        }
        
        const imgUpdates = await generatePhotoDerivatives(tempPhoto, currentLocalPath, true, tracking, boxToUse, bgRemovalEnabled, bgRemovalModel);
        
        return { ocrResult, imgUpdates };
    })();

    // 3. WAIT FOR BOTH PIPELINES TO FINISH
    const [analysisResult, { ocrResult, imgUpdates }] = await Promise.all([
        geminiPromise,
        localPipelinePromise
    ]);

    if (analysisResult) {
        llmAnalysis = JSON.stringify(analysisResult);
        categoryName = analysisResult.subCategory;
        foregroundBox = analysisResult.foregroundBox || null;
        if (analysisResult.extractedAttributes) extractedAttributes = JSON.stringify(analysisResult.extractedAttributes);
    }
    
    // 3. RUN INVOICE EXTRACTION (Must run after OCR completes)
    if (!skipLlm && type === 'invoice or receipt') {
        try {
            const { extractInvoiceData } = await import('$lib/server/llm');
            if (ocrResult) llmAnalysis = await extractInvoiceData(ocrResult, tracking);
        } catch (e) { console.error("[Background Task] Invoice extraction failed:", e); }
    }
    
    return {
        ocr: ocrResult ? JSON.stringify(ocrResult) : null,
        colors: imgUpdates.colors,
        cropPath: imgUpdates.cropPath,
        thumbPath: imgUpdates.thumbPath,
        llmAnalysis,
        categoryName,
        orgPath: finalOrgPath,
        exifData: exifDataJson,
        extractedAttributes
    };
}

export async function processDraftPhotoBackground(webPath: string, type: string, inventoryId: number, precomputedAi?: any) {
	const heavyPromise = (async () => {
		try {
			const tracking = { targetType: 'global' as const, targetId: 0 };
            const localPath = `data${webPath}`;
			const box = precomputedAi?.foregroundBox || precomputedAi?.box || null;
            
            let bgRemovalOverride = undefined;
            try {
                const sidecar = JSON.parse(fs.readFileSync(localPath + '.json', 'utf8'));
                if (sidecar.bgRemovalEnabled !== undefined) bgRemovalOverride = sidecar.bgRemovalEnabled;
            } catch(e) {}
            
            const data = await enrichPhotoData(localPath, webPath, type, inventoryId, tracking, !!precomputedAi, box, bgRemovalOverride);
			
			if (precomputedAi) {
				data.llmAnalysis = JSON.stringify(precomputedAi);
				data.categoryName = precomputedAi.subCategory;
				data.extractedAttributes = precomputedAi.extractedAttributes ? JSON.stringify(precomputedAi.extractedAttributes) : null;
				data.title = precomputedAi.title;
				data.description = precomputedAi.description || precomputedAi.subtitle || null;
			}
			
			fs.writeFileSync(`${localPath}.json`, JSON.stringify(data), 'utf8');
			console.log(`[Background Task] Finished heavy processing for draft image: ${webPath}`);
		} catch (error) {
			console.error(`[Background Task] Heavy processing failed for ${webPath}. Saving raw photo gracefully.`, error);
		} finally {
			activeHeavyTasks.delete(webPath);
		}
	})();

	activeHeavyTasks.set(webPath, heavyPromise);
	await heavyPromise;
}

export async function processItemPhotosBackground(item: any) {
    // Queue this entire item's processing to prevent DB/Network starvation during bulk imports
    const taskId = taskManager.start('item', item.id, 'Queued for processing...');
    return ioQueue.add(async () => {
        taskManager.update(taskId, 'Analyzing photos');
        try {
            let itemNeedsTitleUpdate = item.title === "New Item" || item.title === "";
            for (const photo of item.photos) {
                if (!photo.orgPath) continue;
                
                if (isVideo(photo.orgPath)) continue; // Bypass ML processing for videos
                
                if (photo.thumbPath && photo.ocr && photo.llmAnalysis) {
                    console.log(`[Background Task] Skipping post-save ML for Photo ${photo.id}, pre-processed via draft.`);
                    continue;
                }
                
                const webPath = photo.orgPath;
                const localPath = `data${webPath}`;
                const tracking = { targetType: 'item' as const, targetId: item.id };
                
                let skipEnrichPhotoData = false;
                let enriched: any = {};

                // FAST WORKFLOW FIX: Event-Driven Background Synchronization
                // If this photo is a draft, processDraftPhotoBackground might still be generating the heavy ML derivatives.
                if (photo.orgPath.includes('-draft-') && (!photo.thumbPath || !photo.ocr)) {
                    const jsonPath = `data${photo.orgPath}.json`;
                    console.log(`\n[Background Task] ⏳ Photo is a draft but missing ML data. Checking for sidecar...`);
                    
                    let sidecar = readValidSidecar(jsonPath);
                    
                    if (!sidecar) {
                        if (activeHeavyTasks.has(photo.orgPath)) {
                            console.log(`[Background Task] ⏳ Photo is a draft. Awaiting active heavy ML task directly for ${photo.orgPath}...`);
                            await activeHeavyTasks.get(photo.orgPath);
                            console.log(`[Background Task] 🟢 Heavy ML task resolved! Parsing sidecar...`);
                            sidecar = readValidSidecar(jsonPath);
                        } else {
                            console.warn(`\n[Background Task] ❌ No active task found for ${photo.orgPath}. Proceeding with redundant standard ML pipeline.\n`);
                        }
                    } else {
                        console.log(`[Background Task] 🟢 SUCCESS! Found fully populated draft sidecar instantly for ${photo.orgPath}! Parsing...`);
                    }

                    if (sidecar) {
                        photo.ocr = sidecar.ocr || photo.ocr;
                        photo.colors = sidecar.colors || photo.colors;
                        photo.cropPath = sidecar.cropPath || photo.cropPath;
                        photo.thumbPath = sidecar.thumbPath || photo.thumbPath;
                        photo.llmAnalysis = sidecar.llmAnalysis || photo.llmAnalysis;
                        photo.exifData = sidecar.exifData || photo.exifData;
                        
                        skipEnrichPhotoData = true;
                        enriched = {
                            ocr: photo.ocr,
                            colors: photo.colors,
                            cropPath: photo.cropPath,
                            thumbPath: photo.thumbPath,
                            llmAnalysis: photo.llmAnalysis,
                            categoryName: photo.llmAnalysis ? JSON.parse(photo.llmAnalysis).subCategory : null,
                            orgPath: photo.orgPath,
                            exifData: photo.exifData,
                            extractedAttributes: photo.llmAnalysis && JSON.parse(photo.llmAnalysis).extractedAttributes ? JSON.stringify(JSON.parse(photo.llmAnalysis).extractedAttributes) : null
                        };
                        await logActivity(item.id, 'Image Processing', `Reused ML results from draft sidecar for photo ID ${photo.id}`, 'success');
                    }
                }
                
                if (!skipEnrichPhotoData) {
                    console.log(`[Background Task] Running post-save ML for Photo ${photo.id}`);
                    await logActivity(item.id, 'Image Processing', `Started ML pipeline for photo ID ${photo.id}`);
                    const skipLlm = !!photo.llmAnalysis; // Skip LLM if we already analyzed it (e.g. Bulk Import)
                    let box = null;
                    let bgRemovalOverride = undefined;
                    if (photo.llmAnalysis) {
                        try { 
                            const parsed = JSON.parse(photo.llmAnalysis);
                            if (skipLlm) box = parsed.foregroundBox || parsed.box || null; 
                            if (parsed.bgRemovalEnabled !== undefined) bgRemovalOverride = parsed.bgRemovalEnabled;
                        } catch(e) {}
                    }
                    
                    // Also check sidecar for overrides
                    if (bgRemovalOverride === undefined) {
                        try {
                            const sidecar = JSON.parse(fs.readFileSync(localPath + '.json', 'utf8'));
                            if (sidecar.bgRemovalEnabled !== undefined) bgRemovalOverride = sidecar.bgRemovalEnabled;
                        } catch(e) {}
                    }
                    
                    console.log(`[Background Task] Calling heavy enrichPhotoData for photo ID ${photo.id}...`);
                    
                    if (enriched.ocr) await logActivity(item.id, 'OCR', `Successfully extracted text from photo ID ${photo.id}`, 'success');
                    enriched = await enrichPhotoData(localPath, webPath, photo.type, item.inventoryId, tracking, skipLlm, box, bgRemovalOverride);
                    if (enriched.colors) await logActivity(item.id, 'Colors', `Extracted color palette for photo ID ${photo.id}`, 'success');
                    if (enriched.llmAnalysis) await logActivity(item.id, 'Analysis', `Identified as: ${enriched.categoryName || 'Unknown'}`, 'success');
                    
                    photo.orgPath = enriched.orgPath || photo.orgPath;
                    photo.ocr = enriched.ocr || photo.ocr;
                    photo.colors = enriched.colors || photo.colors;
                    photo.cropPath = enriched.cropPath || photo.cropPath;
                    photo.thumbPath = enriched.thumbPath || photo.thumbPath;
                    photo.llmAnalysis = enriched.llmAnalysis || photo.llmAnalysis;
                    photo.exifData = enriched.exifData || photo.exifData;
                }
                
                // Background Semantic Extraction & Auto-Fill
                if (photo.type === 'product' && (enriched.orgPath || photo.orgPath)) {
                    let aiTitle = null;
                    let aiDesc = null;
                    let physTraits: string[] = [];
                    let colorMix: any = null;
                    let prominentGraphic: string | null = null;
                    let distinctiveWear: string | null = null;

                    if (photo.llmAnalysis) {
                        try {
                            const parsedAi = JSON.parse(photo.llmAnalysis);
                            aiTitle = parsedAi.title;
                            aiDesc = parsedAi.description || parsedAi.subtitle;
                            physTraits = parsedAi.physical_traits || [];
                            colorMix = parsedAi.color_mix || null;
                            prominentGraphic = parsedAi.prominent_text_or_graphic || null;
                            distinctiveWear = parsedAi.distinctive_blemishes_or_wear || null;
                        } catch(e) {}
                    }

                    if (item.title?.toLowerCase() === 'unknown') itemNeedsTitleUpdate = true;

                    if (itemNeedsTitleUpdate) {
                        try {
                            if (!aiTitle) {
                                await logActivity(item.id, 'Analysis', `Attempting to auto-generate missing Item title...`);
                                const currentLocalPath = `data${enriched.orgPath || photo.orgPath}`;
                                const { guessProductDetails } = await import('$lib/server/gemini-classification');
                                const details = await apiQueue.add(() => guessProductDetails(currentLocalPath, "", item.id));
                                aiTitle = details?.title;
                                aiDesc = details?.description;
                            }
                            
                            if (aiTitle) {
                                const { tokenizeAndStem } = await import('$lib/server/nlp');
                                const semanticTokens = JSON.stringify(tokenizeAndStem([
                                    aiTitle,
                                    item.description === "" && aiDesc ? aiDesc : item.description,
                                    ...physTraits
                                ]));

                                await db.item.update({
                                    where: { id: item.id },
                                    data: { 
                                        title: aiTitle, 
                                        slug: slugify(aiTitle.toLowerCase()),
                                        ...(item.description === "" && aiDesc ? { description: aiDesc } : {}),
                                        semanticTokens
                                    }
                                });
                                await logActivity(item.id, 'Analysis', `Auto-assigned title and description`, 'success');
                                itemNeedsTitleUpdate = false; // Prevent running for subsequent photos
                            }
                        } catch (e) { console.error("Auto-fill failed:", e); }
                    }

                    // Map extracted EAV attributes & root discriminators directly into structured DB KVPs
                    try {
                        const { getActiveSchema } = await import('$lib/server/ontology');
                        const { cleanAndSnapAttributes } = await import('$lib/server/services');
                        const activeSchema = await getActiveSchema(item.inventoryId, photo.categoryId, true);
                        
                        let fpObj = {};
                        if (enriched.extractedAttributes) {
                            fpObj = JSON.parse(enriched.extractedAttributes);
                        }
                        
                        const cleanAttrs = await cleanAndSnapAttributes(fpObj, activeSchema);
                        const kvps = Object.entries(cleanAttrs).map(([k, v]) => ({ key: k, value: String(v), isAutoGenerated: true }));
                        
                        // Extract root level discriminators which define uniqueness
                        if (colorMix) kvps.push({ key: 'color_mix', value: typeof colorMix === 'string' ? colorMix : JSON.stringify(colorMix), isAutoGenerated: true });
                        
                        const isValValid = (v: any) => v && !['null', 'none', 'n/a', 'undefined', 'unknown', '{}'].includes(String(v).trim().toLowerCase());
                        if (isValValid(prominentGraphic)) kvps.push({ key: 'prominent_text_or_graphic', value: prominentGraphic as string, isAutoGenerated: true });
                        if (isValValid(distinctiveWear)) kvps.push({ key: 'distinctive_blemishes_or_wear', value: distinctiveWear as string, isAutoGenerated: true });

                        if (kvps.length > 0) {
                            const itemWithAttrs = await db.item.findUnique({ where: { id: item.id }, include: { attributes: true } });
                            const existingKeys = new Set(itemWithAttrs?.attributes.map((a: any) => a.key) || []);
                            const newKvps = kvps.filter(kvp => !existingKeys.has(kvp.key));
                            
                            if (newKvps.length > 0) {
                                await db.item.update({ where: { id: item.id }, data: { attributes: { create: newKvps } }});
                                await logActivity(item.id, 'Semantic Extraction', `Structured ${newKvps.length} attributes into Key-Value Pairs`, 'success');
                            }
                        }
                    } catch (e) { console.error("Attribute extraction failed:", e); }
                }
                
                // Fallback: If we skipped the LLM to save quota, pull the category from the cached JSON block
                const finalCategoryName = enriched.categoryName || (photo.llmAnalysis ? JSON.parse(photo.llmAnalysis).subCategory : null);
                if (finalCategoryName) {
                    const { getOrCreateCategory } = await import('$lib/server/categories');
                    const cat = await getOrCreateCategory(finalCategoryName, item.inventoryId);
                    photo.categoryId = cat.id;
                }
                
                // Always check for and extract the debug payload for the activity log before saving
                if (photo.llmAnalysis) {
                    try {
                        const parsed = JSON.parse(photo.llmAnalysis);
                        if (parsed._debugPayload) {
                            const { logActivity } = await import('$lib/server/logger');
                            const { dev } = await import('$app/environment');
                            if (dev) await logActivity(item.id, 'LLM Debug', `Dev Mode: Vision Extraction Payload`, 'info', parsed._debugPayload);
                            delete parsed._debugPayload;
                            photo.llmAnalysis = JSON.stringify(parsed);
                        }
                    } catch(e) {}
                }

                await updatePhoto(photo.id, photo);
                
                if (photo.type !== 'invoice or receipt') {
                    await processQRcodeThenDownload(photo.orgPath!, photo, item);
                }
            }

            // After ALL background ML analysis is completed and written to the DB, run the duplicate sweep
            // Doing this here prevents the sweep from running on empty items before they are hydrated with discriminators
            const { runDuplicateSweep } = await import('$lib/server/matcher');
            await runDuplicateSweep(item.id, item.inventoryId);

        } finally {
            taskManager.end(taskId);
        }
        });
}

async function processQRcodeThenDownload(webFilePath: string, photo: Photo, item: Item) {
    const targetPath = photo.thumbPath ? `data${photo.thumbPath}` : `data${webFilePath.replace(/\.[^/.]+$/, '_thumb.webp')}`;
    const page = await QRUrlDownloader.fetchQRCodeDocument(targetPath);
    if (page !== null) {
        const pageData = JSON.parse(page);
        await fsPromises.writeFile(`data${webFilePath}_thumb.html`, pageData.html, { encoding: "utf8" });
        try {
            await db.document.create({
                data: {
                    itemId: item.id,
                    type: "uncategorized",
                    title: pageData.title,
                    source: pageData.url,
                    path: `${webFilePath}_thumb.html`,
                    extracts: JSON.stringify(pageData.extracts)
                }
            });
            await logActivity(item.id, 'QR Scanner', `Found and downloaded linked document: ${pageData.title}`, 'success');
        } catch (ex) { console.error("Error creating document in DB:", ex); }
    }
}

async function updatePhoto(id : number, data : Photo)
{
    try {
        await db.photo.update({
            where: { id: Number(id) },
            data : data
        });
    } catch(ex) {
        console.log(`Failed to update Photo ${id} - ${data}:`, ex);
    }
}

export async function downloadQRURLs(data: any, diskFolder: string, webFolder: string, formPrefix: string, remoteSite: string, item: any)
{
    const { photos: qrPhotos } = await savePhotos(data, diskFolder, webFolder, formPrefix);
    
    for (let i = 0; i < qrPhotos.length; i++) {
        const photo = qrPhotos[i];
        
        await generatePhotoDerivatives(photo, `${remoteSite}${photo.orgPath}`, false);
    }
}

export async function savePhotos(
    formData: any, 
    diskPath: string, 
    webPath: string, 
    fieldPrefix: string, 
    remoteURLlist: string = ""
): Promise<{ photos: Photo[], extractedAttributes: Record<string, string>, extractedTitle: string | null, extractedDescription: string | null, extractedCategoryName: string | null, physical_traits: string[], prominent_text_or_graphic: string | null, distinctive_blemishes_or_wear: string | null, color_mix: any }>
{
    const photos: Photo[] = [];
    const extractedAttributes: Record<string, string> = {};
    let extractedTitle: string | null = null;
    let extractedDescription: string | null = null;
    let extractedCategoryName: string | null = null;
    let physical_traits: string[] = [];
    let prominent_text_or_graphic: string | null = null;
    let distinctive_blemishes_or_wear: string | null = null;
    let color_mix: any = null;
    
    const filePromises = [];
    let i = 0;
    
    // Use an explicit infinite loop to avoid JavaScript closure bugs over async variables
    while (true) {
        const formFile = formData[`${fieldPrefix}${i}`] as File;
        if (!formFile) break;

        if (formFile.size > 0) {
            const currentFile = formFile;
            const currentIndex = i;
            
            const draftPathRaw = formData[`${fieldPrefix}draft.${currentIndex}`] as string;
            const photoType = formData[`${fieldPrefix}type.${currentIndex}`] as string;
            
            filePromises.push((async () => {
                const fileBuffer = Buffer.from(await currentFile.arrayBuffer());
                const hash = crypto.createHash('sha1').update(fileBuffer).digest('hex');

                console.log(`\n[DEBUG FAST-SAVE] --- NEW PHOTO UPLOAD RECEIVED ---`);
                console.log(`[DEBUG FAST-SAVE] File Hash: ${hash}`);
                console.log(`[DEBUG FAST-SAVE] Passed draftPath from UI: '${draftPathRaw}'`);
                console.log(`[DEBUG FAST-SAVE] Is hash currently processing in activeDrafts? ${activeDrafts.has(hash)}\n`);

                // SvelteKit's FormData stringifies undefined to 'undefined'. We must explicitly sanitize this.
                let draftPath = (!draftPathRaw || draftPathRaw === 'undefined' || draftPathRaw === 'null') ? null : draftPathRaw.split('?')[0].split('#')[0];
                if (draftPath && (draftPath.includes('..') || !draftPath.startsWith(webPath))) {
                    draftPath = null; // Security: Prevent directory traversal or malicious paths
                }
                let ocr = null, colors = null, llmAnalysis = null, cropPath = null, thumbPath = null;
                let finalOrgPath = draftPath;

                // FAST WORKFLOW FIX: Sync heavily with in-flight LLM calls using the raw file hash as a lock
                if (!llmAnalysis && activeDrafts.has(hash)) {
                    console.log(`[Fast Workflow] Synchronizing with in-flight LLM task for hash ${hash}`);
                    try {
                        const draftState = activeDrafts.get(hash)!;
                        
                        // Overwrite the missing path with the true server-side draft path!
                        if (!finalOrgPath) {
                            finalOrgPath = draftState.draftPath;
                            console.log(`[Fast Workflow] Restored missing draftPath from activeDrafts memory: ${finalOrgPath}`);
                        }

                        const classificationData = await draftState.promise;
                        if (classificationData) {
                            llmAnalysis = JSON.stringify(classificationData);
                            if (classificationData.extractedAttributes) {
                                Object.assign(extractedAttributes, typeof classificationData.extractedAttributes === 'string' ? JSON.parse(classificationData.extractedAttributes) : classificationData.extractedAttributes);
                            }
                            if (classificationData.title && !extractedTitle) extractedTitle = classificationData.title;
                            if (classificationData.description && !extractedDescription) extractedDescription = classificationData.description;
                            if (classificationData.subCategory && !extractedCategoryName) extractedCategoryName = classificationData.subCategory;
                            
                            if (classificationData.physical_traits) physical_traits = classificationData.physical_traits;
                            if (classificationData.prominent_text_or_graphic) prominent_text_or_graphic = classificationData.prominent_text_or_graphic;
                            if (classificationData.distinctive_blemishes_or_wear) distinctive_blemishes_or_wear = classificationData.distinctive_blemishes_or_wear;
                            if (classificationData.color_mix) color_mix = classificationData.color_mix;
                        }
                    } catch (e) {
                        console.error(`[Fast Workflow] Error syncing with in-flight task for ${hash}:`, e);
                    }
                }

                if (!finalOrgPath) {
                    console.log(`[DEBUG FAST-SAVE] No draftPath recovered. Saving as entirely new physical file.`);
                    const filename = getSafeFilename(currentFile.name, String(currentIndex));
                    const filePath = `${diskPath}/${filename}`;
                    await fsPromises.writeFile(filePath, fileBuffer);
                    finalOrgPath = `${webPath}/${filename}`;
                } else {
                    console.log(`[DEBUG FAST-SAVE] Reusing existing draft path: ${finalOrgPath}. Checking for sidecar...`);
                    const jsonPath = `data${finalOrgPath}.json`;
                    if (fs.existsSync(jsonPath)) {
                        console.log(`[DEBUG FAST-SAVE] Sidecar found at ${jsonPath}. Parsing...`);
                        try {
                            const sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                            ocr = sidecar.ocr || null;
                            colors = sidecar.colors || null;
                            llmAnalysis = sidecar.llmAnalysis || llmAnalysis;
                            cropPath = sidecar.cropPath || null;
                            thumbPath = sidecar.thumbPath || null;

                            if (sidecar.extractedAttributes) {
                                Object.assign(extractedAttributes, typeof sidecar.extractedAttributes === 'string' ? JSON.parse(sidecar.extractedAttributes) : sidecar.extractedAttributes);
                            }
                            
                            if (sidecar.title && !extractedTitle) extractedTitle = sidecar.title;
                            if (sidecar.description && !extractedDescription) extractedDescription = sidecar.description;
                            if (sidecar.categoryName && !extractedCategoryName) extractedCategoryName = sidecar.categoryName;
                            
                            if (sidecar.physical_traits) physical_traits = sidecar.physical_traits;
                            if (sidecar.prominent_text_or_graphic) prominent_text_or_graphic = sidecar.prominent_text_or_graphic;
                            if (sidecar.distinctive_blemishes_or_wear) distinctive_blemishes_or_wear = sidecar.distinctive_blemishes_or_wear;
                            if (sidecar.color_mix) color_mix = sidecar.color_mix;
                        } catch (e) {
                            console.error(`Error reading sidecar JSON for ${finalOrgPath}:`, e);
                        }
                    } else {
                        console.log(`[DEBUG FAST-SAVE] No sidecar found at ${jsonPath} yet. Background worker will poll for it.`);
                    }
                }
                
                // @ts-expect-error (missing DB fields that will be filled in)
                photos.push({
                    type: photoType,
                    orgPath: finalOrgPath,
                    thumbPath,
                    cropPath,
                    llmAnalysis,
                    ocr,
                    colors,
                    showOriginal: photoType === 'invoice or receipt'
                });
            })());
        }
        i++;
    }
    
    // separate logic to handle remote URL downloads
    let remoteFilesPromises: Promise<any>[] = [];
    if(remoteURLlist.trim().length > 0) {
        remoteURLlist = remoteURLlist.replace("\r\n", "\n");
        
        const externalUrls = remoteURLlist.trim().split('\n');
        remoteFilesPromises = externalUrls.map(async (urlWithType, index) => {
            const [type, url] = urlWithType.split(' ')
            try {
                if (!QRUrlDownloader.isURL(url)) {
                    throw new Error("Invalid or unsafe URL");
                }
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                
                if(!isImage(url) && !isVideo(url)) {
                    throw "Invalid file extension";
                }
                
                const filename = getSafeFilename(url.slice(-24), String(index));
                const filePath = `${diskPath}/${filename}`;
                
                // write file asynchronously 
                await fsPromises.writeFile(filePath, Buffer.from(arrayBuffer));
                
                // create the photo object and return 
                const photo =  {
                    type,
                    orgPath: `${webPath}/${filename}`,
                    thumbPath: null,
                    cropPath: null,
                    llmAnalysis: null,
                    ocr: null,
                    colors: null,
                };
                
                return photo;
                
            } catch (error) {
                console.error(`Error fetching and saving file from URL: ${url}, Error: ${error}`);
            }
        });
    }
    
    try {
        const remotePhotos = await Promise.all(remoteFilesPromises);
        await Promise.all(filePromises);
        
        // merge local file photos and remote file photos and return 
        if((photos.length + remotePhotos.length) === 0 ) {
            return { photos: [], extractedAttributes, extractedTitle, extractedDescription, extractedCategoryName, physical_traits, prominent_text_or_graphic, distinctive_blemishes_or_wear, color_mix };
        }
        return { photos: [...photos, ...remotePhotos], extractedAttributes, extractedTitle, extractedDescription, extractedCategoryName, physical_traits, prominent_text_or_graphic, distinctive_blemishes_or_wear, color_mix };
    } catch (error) {
        console.error("Error saving files:", error);
        return { photos: [], extractedAttributes: {}, extractedTitle: null, extractedDescription: null, extractedCategoryName: null, physical_traits: [], prominent_text_or_graphic: null, distinctive_blemishes_or_wear: null, color_mix: null };
    }
}