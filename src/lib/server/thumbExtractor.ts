import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { load } from 'cheerio';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';
import { getSafeFilename } from '$lib/server/fsUtils';
import { ioQueue } from '$lib/server/queue/index';
import { logActivity } from '$lib/server/logger';
import { taskManager } from '$lib/server/taskManager';

const execAsync = promisify(exec);

export async function generateDocumentThumbnail(docId: number, diskPath: string, docType: 'video' | 'pdf' | 'html' | 'epub', htmlContent?: string): Promise<string | null> {
    const { db } = await import('$lib/server/database');
    const doc = await db.document.findUnique({ where: { id: docId }, select: { id: true, itemId: true, title: true } });
    const targetType = doc?.itemId ? 'item' : 'global';
    const targetId = doc?.itemId || 0;
    const filename = getSafeFilename(`doc-${docId}-thumb`) + '.webp';
    const finalDiskPath = path.join(process.cwd(), uploadsDiskFolder, filename);
    const finalWebPath = `${uploadsWebFolder}/${filename}`;
    const tempPath = path.join(process.cwd(), uploadsDiskFolder, `temp-${docId}`);

    return ioQueue.add(async () => {
        const taskId = taskManager.startDirect(targetType, targetId, `Generating thumbnail for ${doc?.title || docType.toUpperCase()}`);
        let tempFilesToClean: string[] = [];

        try {
            let sourceImageBuffer: Buffer | null = null;

            if (docType === 'video') {
                const absoluteVidPath = path.resolve(process.cwd(), diskPath);
                const tempImg = `${tempPath}.jpg`;
                tempFilesToClean.push(tempImg);
                try {
                    await execAsync(`ffmpeg -y -ss 00:00:01 -i "${absoluteVidPath}" -vframes 1 -f image2 "${tempImg}"`);
                    if (fs.existsSync(tempImg)) sourceImageBuffer = fs.readFileSync(tempImg);
                } catch (e) {
                    console.warn(`[Thumb Extractor] Video extraction failed for ${diskPath} (Corrupt or incomplete file).`);
                }
            } 
            else if (docType === 'pdf') {
                const absolutePdfPath = path.resolve(process.cwd(), diskPath);
                const tempImg = `${tempPath}.jpg`;
                tempFilesToClean.push(tempImg);
                try {
                    // -singlefile forces exact filename without page number padding
                    await execAsync(`pdftoppm -jpeg -singlefile -f 1 -l 1 -scale-to 800 "${absolutePdfPath}" "${tempPath}"`);
                    if (fs.existsSync(tempImg)) sourceImageBuffer = fs.readFileSync(tempImg);
                } catch (e) {
                    console.warn(`[Thumb Extractor] PDF extraction failed for ${diskPath} (Corrupt or invalid PDF).`);
                }
            } 
            else if (docType === 'html' && htmlContent) {
                // Extract embedded base64 images from SingleFile HTML (100% Offline)
                const $ = load(htmlContent);
                let bestB64 = '';
                let maxLen = 0;
                // Find the largest embedded base64 image to avoid 1x1 tracking pixels
                $('img[src^="data:image/"]').each((i, el) => {
                    const src = $(el).attr('src') || '';
                    if (src.length > maxLen) {
                        maxLen = src.length;
                        bestB64 = src;
                    }
                });
                if (bestB64 && maxLen > 1000) {
                    const b64Data = bestB64.split(',')[1];
                    if (b64Data) sourceImageBuffer = Buffer.from(b64Data, 'base64');
                }
            }
            else if (docType === 'epub') {
                const { extractEpubCoverBuffer } = await import('$lib/server/epub');
                const absoluteEpubPath = path.resolve(process.cwd(), diskPath);
                sourceImageBuffer = await extractEpubCoverBuffer(absoluteEpubPath);
            }

            if (!sourceImageBuffer) {
                console.log(`[Thumb Extractor] No viable image data recovered for Doc ${docId} (${docType}).`);
                return null;
            }

            // Force to a sleek 256x256 square WebP
            await sharp(sourceImageBuffer)
                .resize({ width: 256, height: 256, fit: 'cover', position: 'attention' })
                .webp({ quality: 85 })
                .toFile(finalDiskPath);

            await db.document.update({
                where: { id: docId },
                data: { thumbPath: finalWebPath }
            });

            if (doc?.itemId) {
                await logActivity(doc.itemId, 'Thumbnail Extractor', `Generated ${docType.toUpperCase()} thumbnail for "${doc.title}"`, 'success');
            }

            return finalWebPath;
        } catch (e) {
            console.error(`[Thumb Extractor] Failed for Doc ${docId} (${docType}):`, e);
            if (doc?.itemId) {
                await logActivity(doc.itemId, 'Thumbnail Extractor', `Failed to generate ${docType.toUpperCase()} thumbnail for "${doc.title}"`, 'warning');
            }
            return null;
        } finally {
                for (const f of tempFilesToClean) {
                    if (fs.existsSync(f)) fs.unlinkSync(f);
                }
            taskManager.end(taskId);
        }
    }, { targetType, targetId, description: `Thumbnail: ${doc?.title || docType}` });
}
