import sharp from 'sharp';
import { getSafeFilename } from '$lib/server/fsUtils';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';
import { polygonToAxisAlignedBox, calculatePolygonRotation, type Polygon } from './polygonMath';
import { warpImageBilinear } from './pureCv';

/**
 * Extracts a 4-point polygon from an image, deskews/rotates it if necessary, 
 * and saves it as a fresh WebP image. 
 * Replaces the old 2D extractBoundingBox method.
 */
export async function cropPolygon(
    sourceLocalPath: string,
    polygon: Polygon,
    filenamePrefix: string = 'crop',
    straighten: boolean = false
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
        const safeW = Math.min(w - safeLeft, Math.max(1, Math.ceil(right - left)));
        const safeH = Math.min(h - safeTop, Math.max(1, Math.ceil(bottom - top)));

        const filename = getSafeFilename(filenamePrefix, 'crop') + '.webp';
        const outputPath = `${uploadsDiskFolder}/${filename}`;

        let pipeline = sharp(sourceLocalPath).rotate(); // Auto-orient first based on EXIF
        
        if (straighten) {
            // Determine target dimensions based on longest bounding edges
            const wTop = Math.hypot(pixelPolygon[1][0] - pixelPolygon[0][0], pixelPolygon[1][1] - pixelPolygon[0][1]);
            const wBot = Math.hypot(pixelPolygon[2][0] - pixelPolygon[3][0], pixelPolygon[2][1] - pixelPolygon[3][1]);
            const hLeft = Math.hypot(pixelPolygon[3][0] - pixelPolygon[0][0], pixelPolygon[3][1] - pixelPolygon[0][1]);
            const hRight = Math.hypot(pixelPolygon[2][0] - pixelPolygon[1][0], pixelPolygon[2][1] - pixelPolygon[1][1]);
            
            const dstW = Math.max(1, Math.round(Math.max(wTop, wBot)));
            const dstH = Math.max(1, Math.round(Math.max(hLeft, hRight)));

            // Shift polygon relative to the isolated bounding box buffer
            const relPoly = pixelPolygon.map(p => [p[0] - safeLeft, p[1] - safeTop]);

            // Extract raw buffer to limit memory footprint before mapping
            const { data, info } = await pipeline
                .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            const warpedBuffer = warpImageBilinear(data, info.width, info.height, info.channels, relPoly, dstW, dstH);
            pipeline = sharp(warpedBuffer, { raw: { width: dstW, height: dstH, channels: 4 } });
        } else {
            // 1. Standard Crop down to the immediate region containing the skewed object
            pipeline = pipeline.extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH });

            // 2. Deskew: Rotate it flat via affine orientation
            if (Math.abs(angle) > 2) {
                pipeline = pipeline.rotate(-angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
            }
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