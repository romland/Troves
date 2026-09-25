import type { LayoutServerLoad } from "./$types";
import { db } from '$lib/server/database';
import { getAllArchetypes } from "$lib/server/archetypes";
import { env } from '$env/dynamic/private';

export const load = (async ({ locals, setHeaders }) => {
    try {
        setHeaders({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
    } catch (e) {}

    let inventories: any[] = [];
    if (locals.user) {
        const access = await db.userInventoryAccess.findMany({
            where: { userId: locals.user.id },
            include: { inventory: true }
        });
        inventories = access.map(a => a.inventory);
    }

    const checkCapability = (modality: string) => {
        const baseUrl = env[`AI_${modality}_BASE_URL`];
        const isLocal = !!(baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('192.168.')));
        if (env.NO_THIRD_PARTY_SERVICES === 'true' && !isLocal) return false;
        const key = env[`AI_${modality}_API_KEY`] || env.GEMINI_API_KEY || env.GROQ_API_TOKEN || env.OPENAI_API_TOKEN || env.REPLICATE_API_KEY;
        const hasKey = key && key.trim() !== '' && !key.includes('AQ....') && !key.includes('gsk_...') && !key.includes('sk-...');
        return !!(hasKey || isLocal);
    };

    return { 
        user: locals.user, 
        activeInventoryId: locals.activeInventoryId,
        role: locals.role,
        activeSort: locals.activeSort || 'newest',
        activeViewMode: locals.activeViewMode || 'list',
        activeAddMode: locals.activeAddMode || 'single',
        inventories,
        archetypes: getAllArchetypes(),
        capabilities: {
            hasVision: checkCapability('VISION'),
            hasText: checkCapability('TEXT'),
            hasAudio: checkCapability('AUDIO')
        }
    };

}) satisfies LayoutServerLoad;
