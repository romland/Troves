import sharp from 'sharp';
import { getSafeFilename } from '$lib/server/fsUtils';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';
import { polygonToAxisAlignedBox, calculatePolygonRotation, type Polygon } from './polygonMath';

/**
 * Extracts a 4-point polygon from an image, deskews/rotates it if necessary, 
 * and saves it as a fresh WebP image. 
 * Replaces the old 2D extractBoundingBox method.
 */
export async function cropPolygon(
    sourceLocalPath: string,
    polygon: Polygon,
    filenamePrefix: string = 'crop'
): Promise<string | null> {
    try {
        const metadata = await sharp(sourceLocalPath).metadata();
        if (!metadata.width || !metadata.height) return null;

        let w = metadata.width;
        let h = metadata.height;
        
        // Account for EXIF orientation swaps
        if (metadata.orientation && metadata.orientation >= 5) {
            w = metadata.height;
            h = metadata.width;
        }

        // Convert [0-1000] scale to absolute pixels
        const pixelPolygon: Polygon = polygon.map(p => [
            (p[0] / 1000) * w,
            (p[1] / 1000) * h
        ]) as Polygon;

        // Find the absolute limits of the polygon to crop the region
        const [top, left, bottom, right] = polygonToAxisAlignedBox(pixelPolygon);
        const angle = calculatePolygonRotation(pixelPolygon);

        const safeLeft = Math.max(0, Math.floor(left));
        const safeTop = Math.max(0, Math.floor(top));
        const safeW = Math.min(w - safeLeft, Math.max(1, Math.floor(right - left)));
        const safeH = Math.min(h - safeTop, Math.max(1, Math.floor(bottom - top)));

        const filename = getSafeFilename(filenamePrefix, 'crop') + '.webp';
        const outputPath = `${uploadsDiskFolder}/${filename}`;

        let pipeline = sharp(sourceLocalPath).rotate(); // Auto-orient first based on EXIF
        
        // 1. Crop down to the immediate region containing the skewed object
        pipeline = pipeline.extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH });

        // 2. Deskew: If the angle is significant, rotate it flat. 
        // We use a transparent background so the corners don't create ugly black triangles.
        if (Math.abs(angle) > 2) {
            pipeline = pipeline.rotate(-angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        }

        await pipeline
            .withMetadata()
            .webp({ quality: 85 })
            .toFile(outputPath);

        return `${uploadsWebFolder}/${filename}`;
    } catch (e) {
        console.error("Polygon extraction and deskew failed", e);
        return null;
    }
}