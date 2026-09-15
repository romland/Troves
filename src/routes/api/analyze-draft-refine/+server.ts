import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guessProductDetails } from '$lib/server/vision-classification';
import { uploadsDiskFolder } from '$lib/server/constants';
import path from 'path';
import { apiQueue } from '$lib/server/queue/index';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    try {
        const { draftPath, hint } = await request.json();
        
        if (!draftPath || !hint) {
            return json({ error: 'Missing parameters' }, { status: 400 });
        }

        // Map web path back to local disk path
        const filename = path.basename(draftPath);
        const localPath = `${uploadsDiskFolder}/${filename}`;

        const aiData = await apiQueue.add(
            () => guessProductDetails(localPath, hint),
            { targetType: 'global', targetId: 0, description: 'Refining draft details via LLM' }
        );

        return json({
            success: true,
            aiData
        });

    } catch (e) {
        console.error("Draft refine error:", e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};