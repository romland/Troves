import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertCanMutate } from '$lib/server/security';
import { analyzeImage } from '$lib/server/ai/index';
import { getImageMimeType } from '$lib/server/fsUtils';
import { taskManager } from '$lib/server/taskManager';
import sharp from 'sharp';
import fs from 'fs';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);
    const { imagePath, slots } = await request.json();
    
    if (!imagePath || !slots || slots.length === 0) {
        return json({ error: 'Missing image or slots' }, { status: 400 });
    }

    const localPath = `data${imagePath}`;
    if (!fs.existsSync(localPath)) return json({ error: 'Image not found' }, { status: 404 });

    const taskId = taskManager.start('global', 0, `Deep scanning ${slots.length} compartments...`);
    
    try {
        // 1. Generate SVG Overlay to "Burn In" numbers onto the image for the LLM
        const meta = await sharp(localPath).metadata();
        const w = meta.width || 1000;
        const h = meta.height || 1000;
        
        const radius = Math.max(20, Math.min(w, h) * 0.02); // Scale dots to image size
        const fontSize = radius * 1.2;
        
        let svgElements = '';
        slots.forEach((slot: any) => {
            const poly = slot.polygon;
            const i = slot.originalIndex;
            // Find the center (centroid) of the 4-point polygon
            const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4;
            const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4;
            const px = (cx / 1000) * w;
            const py = (cy / 1000) * h;
            
            svgElements += `<circle cx="${px}" cy="${py}" r="${radius}" fill="#ef4444" opacity="0.9" />`;
            svgElements += `<text x="${px}" y="${py + (radius * 0.35)}" font-size="${fontSize}" font-family="sans-serif" font-weight="bold" fill="white" text-anchor="middle">${i}</text>`;
        });
        
        const svg = `<svg width="${w}" height="${h}">${svgElements}</svg>`;
        
        const annotatedBuffer = await sharp(localPath)
            .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
            .webp({ quality: 85 })
            .toBuffer();

        // 2. Call Vision Model
        // const prompt = `Attached is a top-down photo of a storage container. I have overlaid red circles with numbers (0 through ${polygons.length - 1}) in the center of each compartment.
        const prompt = `Attached is a top-down photo of a storage container. I have overlaid red circles with numbers in the center of specific compartments.
        Look at each numbered compartment. Identify what is inside.
        1. Look at the physical item itself.
        2. Look for printed labels (Dymo/Brother tape) which may be slightly outside or overlapping the box boundary, but clearly belong to that numbered slot.
        3. If a slot is completely empty, SKIP IT. Do not include it in the results.
        Return a JSON array of objects mapping the 'slotIndex' to a concise 'title' and optional 'description'.`;

        const schema = {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: { type: 'object', properties: { slotIndex: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['slotIndex', 'title'] }
                }
            },
            required: ['items']
        };

        const resText = await analyzeImage(prompt, 'image/webp', annotatedBuffer.toString('base64'), true, schema, 'Deep Scan Grid', { targetType: 'global', targetId: 0 }, 'MULTISCAN');
        
        return json(JSON.parse(resText));
    } catch (e: any) {
        console.error("Deep Scan failed:", e);
        return json({ error: e.message }, { status: 500 });
    } finally {
        taskManager.end(taskId);
    }
};