import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import sharp from 'sharp';
import fs from 'fs';
import { logActivity } from '$lib/server/logger';
import { assertCanMutate } from '$lib/server/security';

export const POST: RequestHandler = async ({ request, locals }) => {
    assertCanMutate(locals);

    const { photoId, degrees } = await request.json();
    if (!photoId || typeof degrees !== 'number') return json({ error: 'Invalid payload' }, { status: 400 });

    const photo = await db.photo.findFirst({
        where: { id: photoId, item: { inventoryId: locals.activeInventoryId } },
        include: { item: true }
    });

    if (!photo) return json({ error: 'Photo not found' }, { status: 404 });

    // We apply rotation in-place and bump updatedAt to bust the UI cache natively
    const applyRotation = async (webPath: string | null) => {
        if (!webPath) return null;
        const cleanWebPath = webPath.split('?')[0]; // Strip existing query params
        
        // Strict anti-traversal check to prevent LFI via rotation buffer
        if (cleanWebPath.includes('..') || !cleanWebPath.startsWith('/images/')) {
            throw new Error('Invalid image path');
        }
        
        const localPath = `data${cleanWebPath}`;
        if (!fs.existsSync(localPath)) return cleanWebPath;

        const buffer = fs.readFileSync(localPath);
        const rotatedBuffer = await sharp(buffer).rotate(degrees).toBuffer();
        
        // Overwrite in place! No more appending _r timestamps to the filename!
        fs.writeFileSync(localPath, rotatedBuffer);
        
        return cleanWebPath;
    };

    try {
        const cleanOrg = await applyRotation(photo.orgPath);
        const cleanThumb = await applyRotation(photo.thumbPath);
        const cleanCrop = await applyRotation(photo.cropPath);
        
        // Rotate the implicitly derived org_thumb
        if (cleanOrg && photo.orgPath) {
            const oldOrgThumb = photo.orgPath.split('?')[0].replace(/\.[^/.]+$/, '_org_thumb.webp');
            const localOldOrgThumb = `data${oldOrgThumb}`;
            
            if (fs.existsSync(localOldOrgThumb)) {
                 const buffer = fs.readFileSync(localOldOrgThumb);
                 const rotatedBuffer = await sharp(buffer).rotate(degrees).toBuffer();
                 fs.writeFileSync(localOldOrgThumb, rotatedBuffer);
            }
        }

        await db.photo.update({
            where: { id: photo.id },
            data: { 
                orgPath: cleanOrg,
                thumbPath: cleanThumb,
                cropPath: cleanCrop,
                updatedAt: new Date(), // Force bump so the client cache busts
                item: photo.item ? { update: { updatedAt: new Date() } } : undefined
            }
        });

        if (photo.item) {
            await logActivity(photo.item.id, 'Image Edit', `Rotated photo ${degrees} degrees`, 'success');
        }

        return json({ success: true });
    } catch (e) {
        console.error("Failed to rotate image:", e);
        return json({ error: 'Server error during rotation' }, { status: 500 });
    }
};