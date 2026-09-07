import { json } from '@sveltejs/kit';
import { guessProductDetails } from '$lib/server/gemini-classification';
import { db } from '$lib/server/database';

export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    const { itemId, hint } = await request.json();
    
    // Get the item's first product photo
    const item = await db.item.findFirst({
        where: { id: Number(itemId), inventoryId: locals.activeInventoryId },
        include: { photos: true }
    });
    
    const photo = item?.photos.find(p => p.type === 'product');
    
    if (!photo) {
        return json({ error: "No product photo found to analyze." }, { status: 400 });
    }

    try {
        const result = await guessProductDetails(`data${photo.orgPath}`, hint, Number(itemId));
        return json(result);
    } catch (e: any) {
        console.error("AI Refine Error:", e);
        return json({ error: "Failed to process image with LLM." }, { status: 500 });
    }
}