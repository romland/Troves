import fs from 'fs';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { alignPolygonsToNewImage } from '../src/lib/server/vision/pureCv.js'; 

const prisma = new PrismaClient();

// Mirroring the POC arguments
const targetContainerName = process.argv[2];
const newPhotoPath = process.argv[3];

/**
 * Fetches the specific container from the local SQLite database to grab its
 * original top-down baseline photo and the associated spatial grid configuration.
 */
async function fetchBaseline() {
    console.log(`[*] Fetching baseline for container: '${targetContainerName}'...`);
    const container = await prisma.container.findFirst({
        where: { name: targetContainerName }
    });

    if (!container || !container.spatialMap || !container.photoPath) {
        throw new Error(`Container '${targetContainerName}' not found or lacks a spatialMap/photoPath.`);
    }

    // SvelteKit web paths look like "/images/u/file.jpg". On disk, they live in "data/images/u/file.jpg"
    const photoPath = `data${container.photoPath}`;
    if (!fs.existsSync(photoPath)) {
        throw new Error(`Baseline photo not found on disk at: ${photoPath}`);
    }

    const spatialData = JSON.parse(container.spatialMap);
    // Handle both the raw array format and the structural { polygons, warpMap } object format
    const polygons = Array.isArray(spatialData) ? spatialData : spatialData.polygons;

    return { photoPath, polygons };
}

/**
 * Takes an image path and a set of (0-1000) normalized polygons, and composites 
 * an SVG wireframe directly over the image, saving the result to a buffer.
 */
async function renderAnnotatedImage(imagePath: string, polygons: number[][][], color: string): Promise<Buffer> {
    const meta = await sharp(imagePath).metadata();
    
    // Guard against EXIF rotation inversion when establishing the SVG canvas
    const w = meta.orientation && meta.orientation >= 5 ? meta.height! : meta.width!;
    const h = meta.orientation && meta.orientation >= 5 ? meta.width! : meta.height!;

    let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
    for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        
        // Convert normalized 0-1000 coordinates to absolute pixel placement
        const pts = poly.map(p => `${(p[0] / 1000.0) * w},${(p[1] / 1000.0) * h}`).join(' ');
        
        // Draw polygon wireframe
        svg += `<polygon points="${pts}" fill="transparent" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`;
        
        // Draw slot index label roughly in the center
        const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4;
        const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4;
        svg += `<text x="${(cx / 1000.0) * w}" y="${(cy / 1000.0) * h}" fill="white" font-size="24" font-weight="bold" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" stroke="black" stroke-width="1">${i + 1}</text>`;
    }
    svg += `</svg>`;

    return sharp(imagePath)
        .rotate() // Auto-orient
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();
}

async function run() {
    if (!targetContainerName || !newPhotoPath) {
        console.log(`\n❌ Error: Missing Arguments`);
        console.log(`Usage: npx tsx scripts/test-pure-cv.ts "Container Name" path/to/new_photo.jpg\n`);
        process.exit(1);
    }

    if (!fs.existsSync(newPhotoPath)) {
        console.error(`\n❌ Error: New photo not found at '${newPhotoPath}'\n`);
        process.exit(1);
    }

    try {
        const { photoPath: baselinePath, polygons: baselinePolygons } = await fetchBaseline();
        
        console.log(`📷 Baseline: ${baselinePath}`);
        console.log(`📷 New Photo: ${newPhotoPath}`);
        console.log(`📐 Polygons: ${baselinePolygons.length}`);
        
        console.log(`\n--- Running Scenario A (Robust Mathematical Alignment) ---`);
        const t0 = performance.now();
        
        // Feed the images and the DB polygons into the pure TS CV engine
        const warpedPolygons = await alignPolygonsToNewImage(baselinePath, newPhotoPath, baselinePolygons);
        
        const t1 = performance.now();
        console.log(`✅ Math complete in ${(t1 - t0).toFixed(2)}ms!`);

        // Render the new skewed image with the newly warped grid (Scenario A)
        const newAnnotatedBuffer = await renderAnnotatedImage(newPhotoPath, warpedPolygons, "#00FFFF");
        fs.writeFileSync('scenario_A_new_warped_grid.jpg', newAnnotatedBuffer);
        console.log(`🖼️  Scenario A Complete. Wrote 'scenario_A_new_warped_grid.jpg'`);

        console.log(`\n--- Running Scenario C (Side-by-Side Composite) ---`);
        
        // Render the baseline annotated image
        const baseAnnotatedBuffer = await renderAnnotatedImage(baselinePath, baselinePolygons, "#00FF00");

        // Load both buffers to compare dimensions and composite them cleanly
        const baseImg = sharp(baseAnnotatedBuffer);
        const newImg = sharp(newAnnotatedBuffer);
        
        const baseMeta = await baseImg.metadata();
        const newMeta = await newImg.metadata();

        // Scale baseline height to match the new skewed image height for a clean side-by-side composite
        const scaleRatio = newMeta.height! / baseMeta.height!;
        const scaledBaseW = Math.round(baseMeta.width! * scaleRatio);
        
        const scaledBaseBuffer = await baseImg.resize({ width: scaledBaseW, height: newMeta.height! }).toBuffer();

        // Composite them side-by-side
        await sharp({
            create: { 
                width: scaledBaseW + newMeta.width!, 
                height: newMeta.height!, 
                channels: 3, 
                background: { r: 0, g: 0, b: 0 } 
            }
        }).composite([
            { input: scaledBaseBuffer, left: 0, top: 0 },
            { input: newAnnotatedBuffer, left: scaledBaseW, top: 0 }
        ]).jpeg({ quality: 90 }).toFile('scenario_C_composite.jpg');

        console.log(`🖼️  Scenario C Complete. Wrote 'scenario_C_composite.jpg'\n`);

    } catch (e: any) {
        console.error(`\n❌ Pipeline Failed:`);
        if (e.message.startsWith('CV_')) {
            console.error(`Reason: Engine threw an intentional guardrail error (${e.message})`);
        } else {
            console.error(e);
        }
    } finally {
        await prisma.$disconnect();
    }
}

run();