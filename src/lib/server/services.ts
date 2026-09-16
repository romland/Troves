import type { KVP, Prisma } from '@prisma/client';
import { db } from '$lib/server/database';
import slugify from 'slugify';
import fs from 'fs';
import { getSafeFilename } from '$lib/server/fsUtils';
import { logActivity } from '$lib/server/logger';

export const getTagIds = async (tagcsv: string, inventoryId: number) => {
    const ids: { id: number }[] = [];

    if (tagcsv) {
        const tagNames = tagcsv.split(',');

        const tags = tagNames.map(async (tagName) => {
            const name = tagName.trim().toLowerCase();
            const slug = slugify(name);

            let tag = await db.tag.findFirst({
                where: { slug: slug, inventoryId }
            });

            if (!tag) {
                tag = await db.tag.create({
                    data: { name, slug, inventoryId }
                });
            }

            return tag;
        });

        for (const tag of tags) {
            const resolved = await tag;
            if (resolved?.id) {
                ids.push({ id: resolved.id });
            }
        }
    }

    return ids;
}

/**
 * Standardizes URL extraction from form data, merging newly pasted URLs
 * and filtering out documents that have already been processed to prevent duplicates.
 */
export function consolidatePastedUrls(orgData: FormData, data: Record<string, any>) {
    data.urls = data.urls || "";
    const pastedUrls = orgData.getAll("pasted_urls[]") as string[];
    if (pastedUrls.length > 0) {
        data.urls = (data.urls as string || "") + "\n" + pastedUrls.join("\n");
    }

    const preDocsRaw = orgData.getAll("preprocessed_docs[]");
    const preDocs = preDocsRaw.map(d => JSON.parse(d as string));
    const preprocessedSources = new Set(preDocs.map(d => d.source));

    if (data.urls) {
        return (data.urls as string).split('\n').filter(u => u.trim() && !preprocessedSources.has(u.trim())).join('\n');
    }
    return data.urls;
}

export function formKVPsToDBrows(formData: Record<string, any>)
{
  const kvps: Prisma.KVPCreateWithoutItemInput[] = [];

  for(const key in formData) {
    if(key.startsWith("kvpK")) {
      const index = parseInt(key.split("-")[1], 10);
      kvps.push({
        key: String(formData[key] ?? ''),
        value: String(formData[`kvpV-${index}`] ?? '')
      })
    }
  }
  return kvps;
}

export async function processFormDocuments(formData: FormData, target: { itemId?: number, timelineNoteId?: number }, diskFolder: string, webFolder: string) {
    const pastedDocsRaw = formData.getAll("pasted_documents[]");
    const pastedDocs = pastedDocsRaw.map(d => JSON.parse(d as string));
    for (const doc of pastedDocs) {
        const prefix = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
        const filename = getSafeFilename(`${prefix}-note`);
        fs.writeFileSync(`${diskFolder}/${filename}.txt`, doc.content, { encoding: "utf8" });
        await db.document.create({
            data: {
                itemId: target.itemId || null,
                timelineNoteId: target.timelineNoteId || null,
                type: "note",
                title: doc.title,
                source: "Pasted Note",
                path: `${webFolder}/${filename}.txt`,
                extracts: JSON.stringify([doc.content])
            }
        });
    }
    
    // Extract cleanly uploaded raw files (e.g., PDFs from PasteHandler or Drag&Drop)
    for (const [key, value] of formData.entries()) {
        if (key.startsWith('uploaded_document_file.')) {
            const file = value as File;
            if (!file || file.size === 0) continue;
            
            const taskId = key.split('.')[1];
            const originalTitle = (formData.get(`uploaded_document_title.${taskId}`) as string) || file.name;
            const prefix = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
            
            const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
            const filename = `${getSafeFilename(`${prefix}-doc`)}.${ext}`;
            
            const buffer = Buffer.from(await file.arrayBuffer());
            fs.writeFileSync(`${diskFolder}/${filename}`, buffer);
            
            const docRecord = await db.document.create({
                data: {
                    itemId: target.itemId || null,
                    timelineNoteId: target.timelineNoteId || null,
                    type: "document",
                    title: originalTitle,
                    source: file.name,
                    path: `${webFolder}/${filename}`,
                    extracts: "[]"
                }
            });
            
            if (target.itemId) await logActivity(target.itemId, 'Document Attached', `Saved uploaded document: ${originalTitle}`, 'success');

            const { ioQueue } = await import('$lib/server/queue/index');
            ioQueue.add(async () => {
                let extractedText = "";
                let finalTitle = originalTitle;
                const { isPdf, isEpub } = await import('$lib/shared/fileutils');

                if (isPdf(filename)) {
                    let parser;
                    try {
                        const { PDFParse } = await import('pdf-parse');
                        parser = new PDFParse({ data: buffer });
                        const textResult = await parser.getText();
                        extractedText = textResult.text;
                        
                        const infoResult = await parser.getInfo();
                        const metaTitle = infoResult.info?.Title?.trim();
                        if (metaTitle && metaTitle.toLowerCase() !== 'untitled') finalTitle = metaTitle;
                    } catch (e) { console.error("Failed to parse local PDF:", e); } 
                    finally { if (parser) await parser.destroy(); }
                } else if (isEpub(filename)) {
                    try {
                        const { extractEpubText, processEpubCoverToItemPhoto } = await import('$lib/server/epub');
                        extractedText = await extractEpubText(`${diskFolder}/${filename}`);
                        if (target.itemId) await processEpubCoverToItemPhoto(target.itemId, `${diskFolder}/${filename}`);
                        const { generateDocumentThumbnail } = await import('$lib/server/thumbExtractor');
                        generateDocumentThumbnail(docRecord.id, `${diskFolder}/${filename}`, 'epub').catch(console.error);
                    } catch (e) {
                        console.error("Failed to parse local EPUB:", e);
                    }
                } else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
                    extractedText = buffer.toString('utf8');
                }

                if (extractedText.trim()) {
                    if (ext === 'pdf') {
                        const { generateDocumentThumbnail } = await import('$lib/server/thumbExtractor');
                        generateDocumentThumbnail(docRecord.id, `${diskFolder}/${filename}`, 'pdf').catch(console.error);
                    }
                    const cappedText = extractedText.substring(0, 10000);
                    await db.document.update({ where: { id: docRecord.id }, data: { title: finalTitle, extracts: JSON.stringify([extractedText]) }});
                    if (cappedText.trim().length > 50) {
                        try {
                            const { summarizeWebpageExtract } = await import('$lib/server/llm');
                            const summary = await summarizeWebpageExtract(cappedText);
                            await db.document.update({ where: { id: docRecord.id }, data: { summary } });
                            if (target.itemId) await logActivity(target.itemId, 'Analysis', `Generated summary for document: ${finalTitle}`, 'success');
                        } catch (e) {
                            console.error("Failed to summarize local document:", e);
                            if (target.itemId) await logActivity(target.itemId, 'Analysis', `Failed to generate summary for document: ${finalTitle}`, 'error');
                        }
                    }
                }
            }, { targetType: target.itemId ? 'item' : 'global', targetId: target.itemId || 0, description: `Extracting text from ${originalTitle}` }).catch(console.error);
        }
    }

    const preDocsRaw = formData.getAll("preprocessed_docs[]");
    const preDocs = preDocsRaw.map(d => JSON.parse(d as string));
    for (const doc of preDocs) {
        await db.document.create({
            data: {
                itemId: target.itemId || null,
                timelineNoteId: target.timelineNoteId || null,
                type: doc.type === 'text' ? 'note' : 'uncategorized',
                title: doc.title || doc.source || "Untitled Document",
                source: doc.source,
                path: doc.path,
                extracts: typeof doc.extracts === 'string' ? doc.extracts : JSON.stringify(doc.extracts || []),
                summary: doc.summary || null
            }
        });
        if (target.itemId) {
            await logActivity(target.itemId, 'Document Attached', `Saved pasted document: ${doc.title || doc.source}`, 'success');
            if (doc.summary) {
                await logActivity(target.itemId, 'Analysis', `Saved LLM summary for pasted document`, 'success');
            } else {
                await logActivity(target.itemId, 'Analysis', `No summary generated (content unreadable or too short)`, 'warning');
            }
        }        
    }
}

// --- SEMANTIC TAXONOMY ENGINE (ABSTRACTIONS) ---

/**
 * TRIGGER: Guardrail against collapsing low-entropy data.
 * ACTION: Returns false for numbers, booleans, tiny strings, and null-equivalents.
 * EXPLANATION: We cannot use values like "yes", "10", or "M" to prove two keys are identical.
 */
function isHighEntropyValue(valStr: string): boolean {
    const v = valStr.trim().toLowerCase();
    if (!v || ['null', 'undefined', 'none', 'n/a', 'unknown', '{}', '[object object]'].includes(v)) return false;
    if (v.length <= 2) return false; // Protects sizes (S, M, L, XL) and short numbers
    if (['yes', 'no', 'true', 'false', 'y', 'n'].includes(v)) return false;
    if (!isNaN(Number(v))) return false; // Protects strict numerical values
    return true;
}

export async function cleanAndSnapAttributes(rawAttrs: Record<string, any>, activeSchema: any[]) {
    if (!rawAttrs || Object.keys(rawAttrs).length === 0) return {};

    const { getSimilarity, normalizeStr, shareRootToken, calculateKeySimilarity } = await import('$lib/server/matcher');
    const finalAttrs: Record<string, string> = {};

    console.log("\n[SNAPPER DEBUG] --- SEMANTIC ENGINE STARTED ---");
    console.log("[SNAPPER DEBUG] Input Payload:", rawAttrs);

    const getSortedTokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');

    // Pre-process to filter out pure garbage
    const validPairs: { k: string, v: string, normV: string, isHighEnt: boolean }[] = [];

    for (const [k, v] of Object.entries(rawAttrs)) {
        let valStr = typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
        const lowVal = valStr.toLowerCase();
        if (valStr === '{}' || valStr === '[object Object]' || !valStr || ['null', 'undefined', 'n/a', 'none', 'unknown'].includes(lowVal)) continue;
        validPairs.push({ k, v: valStr, normV: normalizeStr(valStr), isHighEnt: isHighEntropyValue(valStr) });
        console.log(`[SNAPPER DEBUG] Valid Pair: [${k}] -> '${valStr}' (highEnt: ${isHighEntropyValue(valStr)})`);
    }

    // PHASE 1: Intra-Payload Stutter Resolution
    // TRIGGER: LLM outputs multiple keys with identical high-entropy values (The "Stutter").
    // ACTION: Collapse them immediately so they don't pollute the next phases.
    const stutterResolved = new Map<string, string>();
    const processedKeys = new Set<string>();

    for (let i = 0; i < validPairs.length; i++) {
        const pairA = validPairs[i];
        if (processedKeys.has(pairA.k)) continue;

        let group = [pairA];
        if (pairA.isHighEnt) {
            for (let j = i + 1; j < validPairs.length; j++) {
                const pairB = validPairs[j];
                if (!processedKeys.has(pairB.k) && pairB.isHighEnt && pairA.normV === pairB.normV) {
                    if (shareRootToken(pairA.k, pairB.k)) group.push(pairB);
                }
            }
            if (group.length > 1) console.log(`[SNAPPER DEBUG] PHASE 1: Detected Stutter Group:`, group.map(g => g.k));
        }

        // Pick the best key from the stutter block (prefer existing DB schema matches)
        let winner = group[0];
        if (group.length > 1) {
            winner = group.reduce((best, current) => {
                const bestInSchema = activeSchema.some(f => f.name === best.k);
                const currentInSchema = activeSchema.some(f => f.name === current.k);
                if (bestInSchema && !currentInSchema) return best;
                if (!bestInSchema && currentInSchema) return current;
                return best.k.length <= current.k.length ? best : current;
            });
        }

        for (const p of group) processedKeys.add(p.k);
        stutterResolved.set(winner.k, winner.v);
        if (group.length > 1) console.log(`[SNAPPER DEBUG] PHASE 1: Collapsed to Winner -> '${winner.k}'`);
    }

    // PHASE 2 & 3: Schema Snapping & Orphan Triangulation
    for (const [rawKey, rawVal] of stutterResolved.entries()) {
        const isHighEnt = isHighEntropyValue(rawVal);
        const normV = normalizeStr(rawVal);
        const rawTokens = getSortedTokens(rawVal);
        
        let snappedKey = rawKey;
        let bestKeySim = 0;
        let targetSchemaField: any = null;

        for (const field of activeSchema) {
            const sim = calculateKeySimilarity(rawKey, field.name);
            if (sim > bestKeySim) { bestKeySim = sim; snappedKey = field.name; targetSchemaField = field; }
        }

        // PHASE 3: Orphan Triangulation (The Near-Miss trigger)
        // TRIGGER: The key failed strict matching (<=0.82) but has a high-entropy value.
        // ACTION: Cross-reference its value against schema enums that share a root token.
        if (bestKeySim <= 0.82 && isHighEnt) {
            for (const field of activeSchema) {
                if (field.type === 'enum' && field.options && shareRootToken(rawKey, field.name)) {
                    for (const opt of field.options) {
                    const optTokens = getSortedTokens(opt);
                    if (getSimilarity(rawTokens, optTokens) > 0.85) {
                            bestKeySim = 0.95; // Force the snap!
                            snappedKey = field.name;
                            console.log(`[SNAPPER DEBUG] PHASE 3: Orphan Triangulation SNAPPED '${rawKey}' -> '${field.name}' based on value '${opt}'`);
                            targetSchemaField = field;
                            break;
                        }
                    }
                    if (bestKeySim > 0.82) break;
                }
            }
        }

        // Fallback: try snapping against other finalized keys to group remaining anomalies
        if (bestKeySim <= 0.82) {
            for (const existingKey of Object.keys(finalAttrs)) {
                const sim = calculateKeySimilarity(rawKey, existingKey);
                if (sim > bestKeySim) { bestKeySim = sim; snappedKey = existingKey; targetSchemaField = activeSchema.find(f => f.name === existingKey); }
            }
        }

        if (bestKeySim <= 0.82) {
            snappedKey = rawKey;
            targetSchemaField = null;
        }

        let finalVal = rawVal;
        if (targetSchemaField && targetSchemaField.type === 'enum' && targetSchemaField.options) {
            let bestValSim = 0;
            let snappedVal = rawVal;
            for (const opt of targetSchemaField.options) {
                const optTokens = getSortedTokens(opt);
                const sim = getSimilarity(rawTokens, optTokens);
                if (sim > bestValSim) { bestValSim = sim; snappedVal = opt; }
            }
            // Restore the strict 80% threshold required to format values
            if (bestValSim > 0.80) {
                finalVal = snappedVal;
                if (finalVal !== rawVal) console.log(`[SNAPPER DEBUG] Enum Formatted: '${rawVal}' -> '${finalVal}'`);
            }
        }

        if (!finalAttrs[snappedKey]) {
            finalAttrs[snappedKey] = finalVal;
        }
    }

    console.log("[SNAPPER DEBUG] --- FINAL OUTPUT ---", finalAttrs, "\n");
    return finalAttrs;
}

export async function createItemEntity(params: {
    title: string;
    description?: string;
    reason?: string;
    amount?: number | null;
    inventoryId: number;
    userId: number;
    containers?: string[];
    tagIds?: { id: number }[];
    photos?: Prisma.PhotoCreateWithoutItemInput[];
    attributes?: Prisma.KVPCreateWithoutItemInput[];
    extractedAttributes?: string | Record<string, any> | null;
    physical_traits?: string[];
    prominent_text_or_graphic?: string | null;
    distinctive_blemishes_or_wear?: string | null;
    color_mix?: any;
    clientId?: string;
    timelineNoteId?: number | null;
    duplicateStatus?: string;
}) {
    const { getActiveSchema } = await import('$lib/server/ontology');
    const { getSimilarity, normalizeStr } = await import('$lib/server/matcher');
    
    let catId = null;
    if (params.photos && Array.isArray(params.photos)) {
        const prodPhoto = params.photos.find((p: any) => p.categoryId);
        if (prodPhoto) catId = (prodPhoto as any).categoryId;
    }
    const activeSchema = await getActiveSchema(params.inventoryId, catId, false);

    const finalAttributes: { key: string, value: string, isAutoGenerated: boolean }[] = [];
    const taxonomyLogs: string[] = [];

    const uiAttrs: Record<string, string> = {};
    if (params.attributes) {
        for (const a of params.attributes) uiAttrs[a.key] = a.value;
    }
    const snappedUiAttrs = await cleanAndSnapAttributes(uiAttrs, activeSchema);
    
    const aiAttrs: Record<string, string> = {};
    if (params.extractedAttributes) {
        try {
            const parsed = typeof params.extractedAttributes === 'string' ? JSON.parse(params.extractedAttributes) : params.extractedAttributes;
            Object.assign(aiAttrs, parsed);
        } catch(e) {}
    }

    // Funnel unstructured physical traits directly into the Snapper for deduplication
    if (params.physical_traits) {
        for (const field of activeSchema) {
            if (field.extractionMethod === 'HUMAN_REQUIRED') continue;
            if (field.type === 'enum' && field.options) {
                for (const trait of params.physical_traits) {
                    let bestSim = 0;
                    let matchStr = null;
                    for (const opt of field.options) {
                        const sim = getSimilarity(normalizeStr(opt), normalizeStr(trait));
                        if (sim > bestSim) { bestSim = sim; matchStr = opt; }
                    }
                    if (bestSim > 0.82 && matchStr && !aiAttrs[field.name]) {
                        aiAttrs[field.name] = matchStr;
                    }
                }
            }
        }
    }

    const snappedAiAttrs = await cleanAndSnapAttributes(aiAttrs, activeSchema);

    for (const [k, v] of Object.entries(snappedUiAttrs)) {
        finalAttributes.push({ key: k, value: v, isAutoGenerated: false });
    }
    for (const [k, v] of Object.entries(snappedAiAttrs)) {
        if (!finalAttributes.some(a => a.key === k)) {
            finalAttributes.push({ key: k, value: v, isAutoGenerated: true });
            taxonomyLogs.push(`Auto-generated attribute '${k}': '${v}'`);
        }

    }

    // Ensure discriminators are saved cleanly as Attributes, separate from the generic NLP pool
    const isValValid = (v: any) => v && !['null', 'none', 'n/a', 'undefined', 'unknown', '{}'].includes(String(v).trim().toLowerCase());
    if (isValValid(params.prominent_text_or_graphic) && !finalAttributes.some(a => a.key === 'prominent_text_or_graphic')) {
        finalAttributes.push({ key: 'prominent_text_or_graphic', value: params.prominent_text_or_graphic as string, isAutoGenerated: true });
    }
    if (isValValid(params.distinctive_blemishes_or_wear) && !finalAttributes.some(a => a.key === 'distinctive_blemishes_or_wear')) {
        finalAttributes.push({ key: 'distinctive_blemishes_or_wear', value: params.distinctive_blemishes_or_wear as string, isAutoGenerated: true });
    }

    // Organic Schema Evolution - run across the final merged set (both AI-extracted and Human-edited)
    for (const attr of finalAttributes) {
        const field = activeSchema.find((f: any) => f.name === attr.key) as any;
        if (field && field.id && field.type === 'enum' && field.options) {
            const normalize = (str: string) => {
                return str.toLowerCase()
                    .replace(/[^a-z0-9]+/g, ' ')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .sort()
                    .join(' ');
            };
            const valStr = attr.value.trim();
            const normalizedVal = normalize(valStr);
            const existingMatch = field.options.find((o: string) => {
                const normO = normalize(o);
                return normO === normalizedVal || getSimilarity(normO, normalizedVal) > 0.85;
            });

            if (existingMatch) {
                attr.value = existingMatch; // Snap to the existing enum to prevent duplicates
            } else {
                const newOptions = [...field.options, valStr];
                await db.templateField.update({ where: { id: field.id }, data: { options: JSON.stringify(newOptions) } });
                field.options = newOptions; // Update in-memory for subsequent matches in loop
            }
        } else if (!field && attr.isAutoGenerated && catId && attr.key !== 'color_mix' && attr.key !== 'prominent_text_or_graphic' && attr.key !== 'distinctive_blemishes_or_wear') {
            try {
                const newField = await db.templateField.create({
                    data: {
                        name: attr.key,
                        uiLabel: attr.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        type: 'string',
                        extractionMethod: 'VISION_STRICT',
                        matchWeight: 'FUZZY_SECONDARY',
                        inventoryId: params.inventoryId,
                        categoryId: catId
                    }
                });
                activeSchema.push(newField);
                taxonomyLogs.push(`Registered orphan key into schema: ${attr.key}`);
            } catch (e) {}
        }
    }

    // FAST WORKFLOW: Graceful Degradation for Locations
    // We never reject a save just because a container is missing or deleted.
    const validContainers: string[] = [];
    const missingContainers: string[] = [];
    const requestedContainers = [...new Set((params.containers || []).map(String).filter(c => c.trim().length > 0 && c !== 'undefined' && c !== 'null'))];
    
    if (requestedContainers.length > 0) {
        const existing = await db.container.findMany({
            where: { inventoryId: params.inventoryId, name: { in: requestedContainers } },
            select: { name: true }
        });
        const existingNames = new Set(existing.map(e => e.name));
        for (const req of requestedContainers) {
            if (existingNames.has(req)) validContainers.push(req);
            else missingContainers.push(req);
        }
    }

    // Idempotency: Protect against outbox retries and rapid double-saves
    if (params.clientId) {
        const existing = await db.item.findUnique({
            where: { clientId: params.clientId },
            include: { photos: true }
        });
        if (existing) {
            return existing;
        }
    }

    const safeTitle = params.title.trim() || "New Item";

    const { tokenizeAndStem } = await import('$lib/server/nlp');
    const semanticTokens = JSON.stringify(tokenizeAndStem([
        safeTitle, 
        params.description, 
        ...(params.physical_traits || [])
    ]));

    const item = await db.item.create({
        data: {
            clientId: params.clientId,
            title: safeTitle,
            description: params.description?.trim() || "",
            slug: slugify(safeTitle.toLowerCase()) || "new-item",
            inventoryId: params.inventoryId,
            authorId: params.userId,
            duplicateStatus: params.duplicateStatus || "NONE",
            reason: params.reason || "",
            amount: params.amount !== undefined ? params.amount : null,
            semanticTokens,
            photos: params.photos && params.photos.length > 0 ? { create: params.photos } : undefined,
            attributes: finalAttributes.length > 0 ? { create: finalAttributes } : undefined,
            locations: validContainers.length > 0 ? {
                create: validContainers.map(cont => ({
                    container: { connect: { inventoryId_name: { inventoryId: params.inventoryId, name: cont } } }
                }))
            } : undefined,
            tags: params.tagIds && params.tagIds.length > 0 ? { connect: params.tagIds } : undefined,
            timelineNotes: params.timelineNoteId ? { connect: [{ id: params.timelineNoteId }] } : undefined
        },
        include: { photos: true }
    });

    if (params.color_mix && !finalAttributes.some(a => a.key === 'color_mix')) {
        await db.kVP.create({ data: { itemId: item.id, key: 'color_mix', value: typeof params.color_mix === 'string' ? params.color_mix : JSON.stringify(params.color_mix), isAutoGenerated: true } });
    }

    const { processItemPhotosBackground } = await import('$lib/server/photouploads');
    processItemPhotosBackground(item).catch(e => console.error(e));

    for (const msg of taxonomyLogs) {
        await logActivity(item.id, 'Taxonomy Engine', msg, 'info');
    }

    for (const missing of missingContainers) {
        await logActivity(item.id, 'Location', `Could not assign to location '${missing}' because it no longer exists. Saved without location.`, 'warning');
    }

    return item;
}
