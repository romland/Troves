import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertCanMutate } from '$lib/server/security';
import { cropPolygon } from '$lib/server/vision/polygonCrop';
import { createVisionOptimizedPass } from '$lib/server/vision/imageEnhancer';
import { analyzeImage } from '$lib/server/ai/index';
import fs from 'fs';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);
    const { parentImagePath, polygon } = await request.json();
    
    let croppedWebPath = null;
    let enhancedLocalPath = null;

    try {
        const sourceLocalPath = `data${parentImagePath}`;
        if (!fs.existsSync(sourceLocalPath)) return json({ error: 'Source image missing' }, { status: 404 });

        // Crop the exact polygon
        croppedWebPath = await cropPolygon(sourceLocalPath, polygon, 'temp_label');
        if (!croppedWebPath) return json({ error: 'Failed to extract region' }, { status: 400 });

        // Deep-fry it so faded/shadowed labels become legible
        const localCropPath = `data${croppedWebPath}`;
        const targetEnhancedPath = `${localCropPath}.opt.webp`;
        enhancedLocalPath = await createVisionOptimizedPass(localCropPath, targetEnhancedPath);

        const b64 = fs.readFileSync(enhancedLocalPath).toString('base64');
        const resText = await analyzeImage(
            "Read any text on this label, tray, or object. Be extremely concise. Return ONLY the transcribed text. Do not add conversational filler. If you see no text, return null.",
            "image/webp",
            b64,
            true,
            { type: 'object', properties: { text: { type: 'string', nullable: true } }, required: ['text'] },
            "Read Spatial Label",
            { targetType: 'global', targetId: 0 },
            "CLASSIFY"
        );

        return json(JSON.parse(resText));
    } catch (e: any) {
        console.error("Label read failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        // Cleanup temp files immediately
        if (croppedWebPath && fs.existsSync(`data${croppedWebPath}`)) fs.unlinkSync(`data${croppedWebPath}`);
        if (enhancedLocalPath && fs.existsSync(enhancedLocalPath)) fs.unlinkSync(enhancedLocalPath);
    }
};