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

    // We rename the file to naturally bust the browser cache without requiring
    // ?v= cache-busting parameters spread everywhere in the UI templates.
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
        
        const newWebPath = cleanWebPath.replace(/\.webp$/, `_r${Date.now()}.webp`);
        const newLocalPath = `data${newWebPath}`;

        fs.writeFileSync(newLocalPath, rotatedBuffer);
        try { fs.unlinkSync(localPath); } catch(e) {}
        
        return newWebPath;
    };

    try {
        const cleanOrg = await applyRotation(photo.orgPath);
        const cleanThumb = await applyRotation(photo.thumbPath);
        const cleanCrop = await applyRotation(photo.cropPath);
        
        // Rotate the implicitly derived org_thumb
        if (cleanOrg && photo.orgPath) {
            const oldOrgThumb = photo.orgPath.split('?')[0].replace(/\.[^/.]+$/, '_org_thumb.webp');
            const localOldOrgThumb = `data${oldOrgThumb}`;
            
            const newOrgThumb = cleanOrg.replace(/\.[^/.]+$/, '_org_thumb.webp');
            const localNewOrgThumb = `data${newOrgThumb}`;
            
            if (fs.existsSync(localOldOrgThumb)) {
                 const buffer = fs.readFileSync(localOldOrgThumb);
                 const rotatedBuffer = await sharp(buffer).rotate(degrees).toBuffer();
                 fs.writeFileSync(localNewOrgThumb, rotatedBuffer);
                 try { fs.unlinkSync(localOldOrgThumb); } catch(e) {}
            }
        }

        await db.photo.update({
            where: { id: photo.id },
            data: { 
                orgPath: cleanOrg,
                thumbPath: cleanThumb,
                cropPath: cleanCrop
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