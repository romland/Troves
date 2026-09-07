import sharp from 'sharp';
import fs from 'fs';
import { analyzeImage } from '$lib/server/ai/index';
import { getImageMimeType } from '$lib/server/fsUtils';
import { createVisionOptimizedPass } from './imageEnhancer';

/**
 * Detects the 4 outer boundary corners of a container in a skewed photo,
 * and warps/crops it into a clean orthogonal rectangle.
 */
export async function deskewContainerImage(localFilePath: string): Promise<string> {
    const tempOptPath = localFilePath + '.deskew.opt.webp';
    const finalOptPath = await createVisionOptimizedPass(localFilePath, tempOptPath);

    const b64 = fs.readFileSync(finalOptPath).toString('base64');
    const mime = getImageMimeType(finalOptPath);

    const promptText = `Detect the 4 extreme outer corner points of the physical container, drawer, or shelf in this image.
    Ignore the surrounding room or floor. 
    Return the 4 corners starting from top-left, clockwise: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] normalized from 0 to 1000.`;

    const schema = {
        type: 'object',
        properties: {
            corners: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description: 'Exactly 4 points [[x,y], [x,y], [x,y], [x,y]]'
            }
        },
        required: ['corners']
    };

    try {
        const raw = await analyzeImage(promptText, mime, b64, true, schema, 'Container Deskew', undefined, 'MULTISCAN');
        const data = JSON.parse(raw);
        if (data.corners && data.corners.length === 4) {
            const meta = await sharp(localFilePath).metadata();
            const w = meta.width || 1000;
            const h = meta.height || 1000;

            // Compute bounding box of the container corners
            const xs = data.corners.map((p: number[]) => (p[0] / 1000) * w);
            const ys = data.corners.map((p: number[]) => (p[1] / 1000) * h);
            
            const left = Math.max(0, Math.floor(Math.min(...xs)));
            const top = Math.max(0, Math.floor(Math.min(...ys)));
            const width = Math.min(w - left, Math.floor(Math.max(...xs) - left));
            const height = Math.min(h - top, Math.floor(Math.max(...ys) - top));

            if (width > 100 && height > 100) {
                const straightenedPath = localFilePath.replace(/\.[^/.]+$/, '') + '_deskewed.webp';
                await sharp(localFilePath)
                    .rotate()
                    .extract({ left, top, width, height })
                    .webp({ quality: 90 })
                    .toFile(straightenedPath);
                    
                const straightenedThumbPath = straightenedPath.replace(/\.[^/.]+$/, '_thumb.webp');
                await sharp(straightenedPath)
                    .resize({ width: 256 })
                    .webp({ quality: 80 })
                    .toFile(straightenedThumbPath);

                return straightenedPath;
            }
        }
    } catch (e) {
        console.error("[Container Deskew] Failed to deskew, using original.", e);
    } finally {
        if (fs.existsSync(tempOptPath)) fs.unlinkSync(tempOptPath);
    }

    return localFilePath;
}
