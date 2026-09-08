import sharp from 'sharp';

/**
 * Creates a hyper-contrasted, auto-leveled temporary image.
 * Solves "Lighting Occlusion" where shadows in drawers blind the Vision Model.
 * This image should be passed to the LLM and immediately deleted.
 */
export async function createVisionOptimizedPass(inputPath: string, outputPath: string): Promise<string> {
    try {
        const meta = await sharp(inputPath).metadata();
        const cw = Math.max(2, Math.min(200, Math.floor((meta.width || 200) / 2)));
        const ch = Math.max(2, Math.min(200, Math.floor((meta.height || 200) / 2)));

        await sharp(inputPath)
            .normalize() // Auto-level exposure
            .clahe({ width: cw, height: ch, maxSlope: 3 }) // Local contrast enhancement (brings out tray edges/text in shadows)
            .modulate({ brightness: 1.1, saturation: 1.2 }) // Slight bump to make labels pop
            .webp({ quality: 90 })
            .toFile(outputPath);
            
        return outputPath;
    } catch (e) {
        console.error("[Vision Enhancer] Failed to optimize image, falling back to original.", e);
        return inputPath;
    }
}