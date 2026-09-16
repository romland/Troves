import { building } from "$app/environment";
import { redirect, type Handle } from "@sveltejs/kit";
import { db } from "$lib/server/database";
import { initFTS } from "$lib/server/fts";
import { validateAndRefreshSession } from "$lib/server/session";

export interface UserPreferences {
	largeFont?: boolean;
	documentDarkMode?: boolean;
	enableVoiceSearch?: boolean;
	shortcuts?: Record<string, string>;
	defaultSorts?: Record<string, string>; // Maps inventoryId to sortMode
	epubLocations?: Record<string, string>; // Maps document path/id to CFI string
}

let isSetupComplete = false;

export const handle = (async ({ event, resolve }) => {
	// 1. Initial Setup Guard: Route new installations directly to the Setup Wizard
	if (!building && !isSetupComplete) {
		const userCount = await db.user.count();
		if (userCount > 0) {
			isSetupComplete = true;
		} else if (!event.url.pathname.startsWith('/setup')) {
			throw redirect(307, '/setup');
		}
	}

	if (isSetupComplete && event.url.pathname.startsWith('/setup')) {
        throw redirect(303, '/login');
    }

    // Initialize the SQLite FTS5 engine once on server boot (skip during build)
    if (!building) {
        initFTS().catch(console.error);
    }

	let theme: string = 'coffee';  // default theme

	const session = event.cookies.get('session');
	const newTheme = event.url.searchParams.get('theme');
	const cookieTheme = event.cookies.get('theme');
	const path = event.url.pathname;

	if (newTheme) {
		theme = newTheme;
	} else if (cookieTheme) {
		theme = cookieTheme;
	}

	if (session) {
        const validSession = await validateAndRefreshSession(session, event.cookies);

        if (validSession) {
            const user = validSession.user;
            event.locals.user = {
                id: user.id,
                username: user.username,
                name: user.name || user.username,
                email: user.email,
                avatar: user.avatar,
                isAdmin: user.isAdmin,
                preferences: user.preferences,
                canCreateInventories: user.canCreateInventories
            } as any;

            // Inventory Routing Logic
            const cookieInvId = event.cookies.get('activeInventoryId');
            const allowedIds = user.inventoryAccess.map(ia => ia.inventoryId);
            
            if (cookieInvId && allowedIds.includes(Number(cookieInvId))) {
                event.locals.activeInventoryId = Number(cookieInvId);
            } else if (allowedIds.length > 0) {
                event.locals.activeInventoryId = allowedIds[0];
                event.cookies.set('activeInventoryId', allowedIds[0].toString(), { path: '/' });
            } else {
                    event.locals.activeInventoryId = null;
                }

                // Hydrate the user's role for this specific inventory
                if (event.locals.activeInventoryId) {
                    const access = user.inventoryAccess.find(ia => ia.inventoryId === event.locals.activeInventoryId);
                    event.locals.role = access?.role || 'VIEWER';
                } else {
                    event.locals.role = 'NONE';
            }

				try {
			const prefs: UserPreferences = JSON.parse(user.preferences || '{}');
					if (prefs.largeFont) (event.locals as any).largeFont = true;
				} catch(e) {}

            // Sort Routing Logic (Remembered per inventory)
            const urlSort = event.url.searchParams.get('sort');
            if (urlSort) {
                event.cookies.set('troves_sort_' + event.locals.activeInventoryId, urlSort, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: false });
                (event.locals as any).activeSort = urlSort;
            } else {
			const cookieSort = event.cookies.get('troves_sort_' + event.locals.activeInventoryId);
			let dbSort = 'newest';
			try {
				const currentPrefs: UserPreferences = JSON.parse(user.preferences || '{}');
				if (currentPrefs.defaultSorts?.[String(event.locals.activeInventoryId)]) dbSort = currentPrefs.defaultSorts[String(event.locals.activeInventoryId)];
			} catch (e) {}
			(event.locals as any).activeSort = cookieSort || dbSort || 'newest';
            }

            // UI View Modes
            const cookieViewMode = event.cookies.get('troves_viewmode_' + event.locals.activeInventoryId);
            if (cookieViewMode) {
                (event.locals as any).activeViewMode = cookieViewMode;
            } else if (event.locals.activeInventoryId) {
                const inv = await db.inventory.findUnique({ where: { id: event.locals.activeInventoryId }, select: { defaultView: true } });
                (event.locals as any).activeViewMode = inv?.defaultView || 'grid';
            } else {
                (event.locals as any).activeViewMode = 'grid';
            }
            (event.locals as any).activeAddMode = event.cookies.get('troves_add_mode') || 'single';

        } else {
            // Destroy the invalid cookie so we don't keep querying a dead token
            event.cookies.delete('session', { path: '/' }); 
        }
    } 
    
    // Now check authorization independently of the cookie's mere existence
    if (!event.locals.user) {
        // Protected by default: Lock down the entire app except specific auth flows
        if (!path.startsWith('/login') && !path.startsWith('/register') && !path.startsWith('/setup')) {
            if (path.startsWith('/api/')) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            redirect(303, '/login');
        }
    } else if (event.locals.activeInventoryId === null && !path.startsWith('/settings') && !path.startsWith('/profile') && !path.startsWith('/logout') && !path.startsWith('/activity') && !path.startsWith('/api')) {
        // Prevent access to standard routes if they belong to no inventory, funnel to profile
        redirect(303, '/profile');
    }

	return await resolve(event, {
		transformPageChunk: ({ html }) => {
			let out = html.replace('data-theme=""', `data-theme="${theme}"`);
			if ((event.locals as any).largeFont) {
				out = out.replace('<html ', '<html style="font-size: 110%;" ');
			}
			return out;
		}
	});
}) satisfies Handle;
