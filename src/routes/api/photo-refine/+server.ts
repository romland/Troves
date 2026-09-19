import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { generatePhotoDerivatives } from '$lib/server/imageProcessor';
import { logActivity } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

    try {
        const { photoId, removeBackground, extractColors } = await request.json();
        if (!photoId) return json({ error: 'Missing photoId' }, { status: 400 });

        const photo = await db.photo.findUnique({ where: { id: Number(photoId) } });
        if (!photo || !photo.orgPath) return json({ error: 'Photo not found' }, { status: 404 });

        const tracking = { targetType: 'item' as const, targetId: photo.itemId! };
        await logActivity(photo.itemId, 'Image Refinement', `Starting background processing for photo ${photo.id}...`);
        
        generatePhotoDerivatives(photo, photo.orgPath, extractColors ?? true, tracking, null, removeBackground ?? true).then(async (updates) => {
            if (Object.keys(updates).length > 0) {
                await db.photo.update({ where: { id: Number(photoId) }, data: updates });
                await logActivity(photo.itemId, 'Image Refinement', `Successfully processed photo ${photo.id}`, 'success');
            }
        }).catch(async (e) => await logActivity(photo.itemId, 'Image Refinement Failed', e.message || 'Unknown error', 'error'));

        return json({ success: true, message: 'Processing queued' });
    } catch (e) { return json({ error: 'Server Error' }, { status: 500 }); }
};