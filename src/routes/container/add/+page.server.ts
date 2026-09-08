import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import slugify from 'slugify';
import { writeFileSync } from "fs";
import { db } from '$lib/server/database';
import { getTagIds } from "$lib/server/services";
import sharp from 'sharp';

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
			const buffer = Buffer.from(await file.arrayBuffer());
            const date = new Date().toISOString()
                .replaceAll('-', '')
                .replaceAll(':', '')
                .replace(/T/, '')
                .replace(/\..+/, '');

            filename = date + '-' + slugify(file.name.toLowerCase()).replace(/\.[^/.]+$/, '') + '.webp';

			try {
                await sharp(buffer).webp({ quality: 85 }).toFile(`data/images/containers/${filename}`);
				const thumbFilename = filename.replace(/\.[^/.]+$/, "_thumb.webp");
                await sharp(buffer).resize({ width: 256 }).webp({ quality: 80 }).toFile(`data/images/containers/${thumbFilename}`);
			} catch (e) { console.error("Failed to generate container thumbnail", e); }

            filename = "/images/containers/" + filename;
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

        if (mode === 'batch') {
            const trayCount = Number(data.numtrays) || 10;
            const startTray = Number(data.starttray) || 1;

            for(let i = startTray; i < (trayCount + startTray); i++) {
                const trayId = i.toString().padStart(3, '0')
                await db.container.create({
                    data: {
                        parentId: container.id,
                        name: `${name.trim()} ${trayId}`,
                        description: "",
                        inventoryId: locals.activeInventoryId
                    }
                });
            }
        }

        // STUB: Label Studio Integration
        const printLabel = data.printLabel;
        const labelSize = data.labelSize as string;
        if (printLabel === 'on') {
            console.log(`[STUB] Queuing thermal label print for container: ${name} | Size: ${labelSize}`);
        }
    
        redirect(302, `/container/${container?.name}`);
    }
} satisfies Actions;