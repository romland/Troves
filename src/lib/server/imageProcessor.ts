import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import crop from "crop-node";
import { getTopColorsNamed } from '$lib/server/colors';
import { heavyMlQueue } from './queue/index';
import type { Photo } from '@prisma/client';
import type { TaskContext } from '$lib/server/taskManager';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';

const rembgCircuitBreaker = {
    failures: 0,
    trippedUntil: 0,
    isTripped() { return Date.now() < this.trippedUntil; },
    trip() {
        this.failures++;
        if (this.failures >= 3) {
            this.trippedUntil = Date.now() + 5 * 60 * 1000;
            console.warn("[Circuit Breaker] 🛑 RemBG crashed 3 times. Bypassing background removal for 5 minutes.");
        }
    },
    reset() { this.failures = 0; this.trippedUntil = 0; }
};

export async function removeBackground(imgUrl: string, outputFileNoBkg: string, tracking?: TaskContext, inputLocalPath?: string, model: string = 'bria-rmbg'): Promise<string> {
    // Allow an explicit input path so we can feed it pre-cropped images, 
    // otherwise fallback to deriving the original path from the output filename.
    const localPath = inputLocalPath || outputFileNoBkg.replace(/_crop\.png$/, '');
    if (env.ENABLE_REMBG !== 'true' || rembgCircuitBreaker.isTripped()) {
        fs.copyFileSync(localPath, outputFileNoBkg);
        return outputFileNoBkg;
    }

    let response;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout to prevent silent queue death
    const rembgUrl = env.REMBG_URL || 'http://localhost:7000';

    try {
        if (fs.existsSync(localPath)) {
            const form = new FormData();
            const fileBuffer = await sharp(localPath)
                .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
                .toBuffer();
            
            form.append('file', fileBuffer, { filename: 'upload.png' });
            const headers = {
                ...form.getHeaders(),
                'Content-Length': form.getLengthSync().toString()
            };
            response = await fetch(`${rembgUrl}/api/remove?model=${model}`, {
                method: 'POST',
                body: form as any,
                headers: headers,
                signal: controller.signal as any
            });
        } else {
            console.log(`Local file not found for rembg: ${localPath}, falling back to URL: ${imgUrl}`);
            response = await fetch(`${rembgUrl}/api/remove?url=${encodeURIComponent(imgUrl)}&model=${model}`, { signal: controller.signal as any });
        }
        rembgCircuitBreaker.reset();
    } catch (e: any) {
        rembgCircuitBreaker.trip();
        if (e.name === 'AbortError') throw new Error(`RemBG HTTP Error: Request timed out after 60 seconds.`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }

    if (!response || !response.ok) {
        rembgCircuitBreaker.trip();
        throw new Error(`RemBG HTTP Error: ${response ? await response.text() : 'No response'}`);
    }

    const fileStream = fs.createWriteStream(outputFileNoBkg);
    await new Promise((resolve, reject) => {
        response.body?.pipe(fileStream);
        response.body?.on('error', reject);
        fileStream.on('finish', () => resolve(true));
    });
    return outputFileNoBkg;
}

export async function generatePhotoDerivatives(photo: Partial<Photo>, imgUrl: string, getColors: boolean = true, tracking?: TaskContext, foregroundBox?: number[] | null, bgRemovalEnabled: boolean = true, bgRemovalModel: string = 'bria-rmbg'): Promise<Partial<Photo>> {
    // Monolithic Lock: Prevent fragmented queue interleaving so items finish entirely 1-by-1
    return heavyMlQueue.add(async () => {
        const updates: Partial<Photo> = {};
        const timings: string[] = [];
        let t0 = performance.now();
        
        try {
            const orgThumbnail = await sharp(`data${photo.orgPath}`).rotate().resize({ width: 256 }).webp({ quality: 80 }).toBuffer();
            fs.writeFileSync(`data${photo.orgPath?.replace(/\.[^/.]+$/, '')}_org_thumb.webp`, orgThumbnail);
            timings.push(`OrgThumb: ${(performance.now() - t0).toFixed(0)}ms`);
        } catch (ex) { console.error("Error generating original thumbnail", ex); }

        const outputFileNoBkg = `data${photo.orgPath}_crop.png`;
        const finalCropPath = `data${photo.orgPath?.replace(/\.[^/.]+$/, '')}_crop.webp`;
        const finalThumbPath = `data${photo.orgPath?.replace(/\.[^/.]+$/, '')}_thumb.webp`;

        try {
            if (bgRemovalEnabled) {
                let pathForRembg = `data${photo.orgPath}`;
                let tempBoxCrop = null;
                
                if (foregroundBox && foregroundBox.length === 4) {
                    tempBoxCrop = `data${photo.orgPath?.replace(/\.[^/.]+$/, '')}_temp_box.webp`;
                    t0 = performance.now();
                    const extracted = await extractBoundingBox(`data${photo.orgPath}`, foregroundBox, 'temp_box');
                    if (extracted) {
                        pathForRembg = `data${extracted}`;
                    }
                    timings.push(`BoxCrop: ${(performance.now() - t0).toFixed(0)}ms`);
                }

                t0 = performance.now();
            await removeBackground(imgUrl, outputFileNoBkg, tracking, pathForRembg, bgRemovalModel);
                timings.push(`RemBG: ${(performance.now() - t0).toFixed(0)}ms`);

                t0 = performance.now();
                const cropped: any = await crop(outputFileNoBkg, { outputFormat: "png" });
                
                const meta = await sharp(cropped).metadata();
                // If RemBG stripped too much (e.g., tight crop of a patterned shirt), it outputs a tiny/transparent image.
                if (!meta.width || !meta.height || meta.width <= 10 || meta.height <= 10) {
                    console.log(`[Image Processor] RemBG stripped the entire image. Falling back to original.`);
                    await sharp(pathForRembg).webp({ quality: 85 }).toFile(finalCropPath);
                } else {
                    await sharp(cropped).webp({ quality: 85 }).toFile(finalCropPath);
                }
                
                fs.unlinkSync(outputFileNoBkg);
                
                if (tempBoxCrop && fs.existsSync(tempBoxCrop)) {
                    fs.unlinkSync(tempBoxCrop);
                }
                updates.cropPath = `${photo.orgPath?.replace(/\.[^/.]+$/, '')}_crop.webp`;
                timings.push(`AutoCrop&WebP: ${(performance.now() - t0).toFixed(0)}ms`);

                t0 = performance.now();
                await sharp(finalCropPath).resize({ width: 256 }).webp({ quality: 80 }).toFile(finalThumbPath);
                updates.thumbPath = `${photo.orgPath?.replace(/\.[^/.]+$/, '')}_thumb.webp`;
                timings.push(`CutThumb: ${(performance.now() - t0).toFixed(0)}ms`);

                if (getColors) {
                    t0 = performance.now();
                    const colors = await new Promise((resolve, reject) => {
                        getTopColorsNamed(finalCropPath, (err: any, res: any) => err ? reject(err) : resolve(res));
                    });
                    updates.colors = JSON.stringify(colors);
                    timings.push(`Colors: ${(performance.now() - t0).toFixed(0)}ms`);
                }
            } else {
                // Fallback: Just generate thumbnails and colors from the original un-cropped image
                t0 = performance.now();
                await sharp(`data${photo.orgPath}`).rotate().resize({ width: 256 }).webp({ quality: 80 }).toFile(finalThumbPath);
                updates.thumbPath = `${photo.orgPath?.replace(/\.[^/.]+$/, '')}_thumb.webp`;
                updates.cropPath = photo.orgPath; // No cutout created
                timings.push(`Thumb(NoBG): ${(performance.now() - t0).toFixed(0)}ms`);

                if (getColors) {
                    t0 = performance.now();
                    const colors = await new Promise((resolve, reject) => {
                        getTopColorsNamed(`data${photo.orgPath}`, (err: any, res: any) => err ? reject(err) : resolve(res));
                    });
                    updates.colors = JSON.stringify(colors);
                    timings.push(`Colors(NoBG): ${(performance.now() - t0).toFixed(0)}ms`);
                }
            }
            
            console.log(`[Image Processor] ⏱️ Sub-task profile for photo ${photo.id || 'N/A'}: ${timings.join(' | ')}`);
            
        } catch (err) { console.error("Background/Crop pipeline failed:", err); }
        return updates;
    }, tracking ? { ...tracking, description: `Processing image: ${photo.orgPath?.split('/').pop() || 'unknown'}` } : undefined);
}

export async function extractBoundingBox(
    sourceLocalPath: string,
    box: number[],
    filenamePrefix: string = 'crop'
): Promise<string | null> {
    try {
        const { getSafeFilename } = await import('$lib/server/fsUtils');
        const { uploadsDiskFolder, uploadsWebFolder } = await import('$lib/server/constants');
        const { getBoxMetrics } = await import('$lib/shared/boundingBox');

        const metrics = getBoxMetrics(box);
        if (!metrics) return null;

        const metadata = await sharp(sourceLocalPath).metadata();
        if (!metadata.width || !metadata.height) return null;

        // Account for EXIF orientation swaps before calculating dimensions
        let w = metadata.width;
        let h = metadata.height;
        if (metadata.orientation && metadata.orientation >= 5) {
            w = metadata.height;
            h = metadata.width;
        }

        let top = Math.max(0, Math.floor((metrics.ymin / 1000) * h));
        let left = Math.max(0, Math.floor((metrics.xmin / 1000) * w));
        let boxW = Math.max(1, Math.floor((metrics.w / 1000) * w));
        let boxH = Math.max(1, Math.floor((metrics.h / 1000) * h));

        if (left + boxW > w) boxW = w - left;
        if (top + boxH > h) boxH = h - top;

        const filename = getSafeFilename(filenamePrefix, 'crop') + '.webp';
        
        await sharp(sourceLocalPath)
            .rotate()
            .extract({ left, top, width: boxW, height: boxH })
            .withMetadata()
            .webp({ quality: 85 })
            .toFile(`${uploadsDiskFolder}/${filename}`);

        return `${uploadsWebFolder}/${filename}`;
    } catch (e) {
        console.error("Bounding box extraction failed", e);
        return null;
    }
}
