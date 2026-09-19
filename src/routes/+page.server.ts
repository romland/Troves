import type { Actions, PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';

export const load = (async ({ locals, url, fetch }) => {
    const unassignedCount = await db.item.count({
        where: {
            inventoryId: locals.activeInventoryId,
            locations: { none: {} }
        }
    });

    const apiUrl = new URL('/api/items', url.origin);
    url.searchParams.forEach((val, key) => apiUrl.searchParams.append(key, val));
    if (!apiUrl.searchParams.has('c')) apiUrl.searchParams.set('c', '12');

    const res = await fetch(apiUrl.toString());
    const data = await res.json();

    return { items: data.items, prevPage: data.prevPage, nextPage: data.nextPage, unassignedCount };
}) satisfies PageServerLoad;

export const actions = {
    setTheme: async ({ request, url, cookies }) => {
        console.log('[DEBUG-THEME] setTheme action invoked!');

        let theme = url.searchParams.get('theme');
        const redirectTo = url.searchParams.get('redirectTo');

        try {
            const fd = await request.formData();
            if (!theme && fd.has('theme')) theme = fd.get('theme')?.toString() || null;
        } catch (e) {
            console.log('[DEBUG-THEME] No formData attached or parse failed.');
        }

        console.log(`[DEBUG-THEME] Target theme resolved to: ${theme}`);

        if (theme) {
            cookies.set('theme', theme, {
                path: '/',
                maxAge: 60 * 60 * 24 * 365,
                httpOnly: false,
                sameSite: 'lax'
            });
            console.log(`[DEBUG-THEME] Server-side cookie 'theme' set successfully.`);
        }

        if (redirectTo) {
            console.log(`[DEBUG-THEME] Redirecting to ${redirectTo}`);
            redirect(303, redirectTo);
        }
        
        return { success: true, theme };
    },
    switchInventory: async ({ request, cookies }) => {
        const data = await request.formData();
        const newInventoryId = data.get('inventoryId')?.toString();
        
        if (newInventoryId) {
            cookies.set('activeInventoryId', newInventoryId, { path: '/', maxAge: 60 * 60 * 24 * 365 });
        }
        redirect(303, '/');
    }
} satisfies Actions;