import { fail, redirect } from '@sveltejs/kit';
 import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/database';
import sharp from 'sharp';
import { MediaIngest } from '$lib/server/services/MediaIngest';
 import { extensionManager } from '$lib/server/extensions/ExtensionManager';

 export const load = (async ({ locals }) => {
    if (!locals.user) throw redirect(303, '/login');
    const canPrintLabels = await extensionManager.hasActiveListeners('onContainerCreated', locals.activeInventoryId);
    return { canPrintLabels };
 }) satisfies PageServerLoad;

export const actions = {
    default: async ({ locals, request }) => {
        if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });

        const data = Object.fromEntries(await request.formData());
        const name = data.name as string;
        const description = data.description as string;
        const file = data.photoPath as File;
        const mode = data.mode as string;

        if (!name || !name.trim()) {
            return fail(400, { error: true, message: 'Container name cannot be blank.' });
        }

        let filename = null;

        if (file.size > 0) {
            const { localPath, webPath } = await MediaIngest.saveUploadedImage(file, 'container');
            filename = webPath;

			try {
                const thumbLocalPath = localPath.replace(/\.[^/.]+$/, '_thumb.webp');
                await sharp(localPath).resize({ width: 256 }).webp({ quality: 80 }).toFile(thumbLocalPath);
			} catch (e) { console.error("Failed to generate container thumbnail", e); }
        }

        const container = await db.container.create({
            data: {
                name: name.trim(),
                photoPath: filename,
                description: (description || '').trim(),
                location : (data.location as string)?.trim() || null,
                inventoryId: locals.activeInventoryId
            }
        });

         const printLabel = data.printLabel === 'on';
         const printScope = (data.printScope as string) || 'all'; // 'master' or 'all'

         // Construct the standard Fat Payload context for all events in this request
         const extContext = { user: locals.user, inventoryId: locals.activeInventoryId };

         // Master Container always gets a large label if print is requested
         extensionManager.trigger('onContainerCreated', { 
             entity: container, 
             context: extContext, 
             intent: { printLabel, labelSize: mode === 'batch' ? 'large' : ((data.labelSize as string) || 'large') } 
         });

        if (mode === 'batch') {
            const trayCount = Number(data.numtrays) || 10;
            const startTray = Number(data.starttray) || 1;

            for(let i = startTray; i < (trayCount + startTray); i++) {
                const trayId = i.toString().padStart(3, '0')
                 const childTray = await db.container.create({
                    data: {
                        parentId: container.id,
                        name: `${name.trim()} ${trayId}`,
                        description: "",
                        inventoryId: locals.activeInventoryId
                    }
                });

                 // Child trays print small labels ONLY if the user selected 'Master + All Trays'
                 extensionManager.trigger('onContainerCreated', { 
                     entity: childTray, 
                     context: extContext, 
                     intent: { printLabel: printLabel && printScope === 'all', labelSize: 'small' } 
                 });
            }
        }

        redirect(302, `/container/${container?.name}`);
    }
} satisfies Actions;
