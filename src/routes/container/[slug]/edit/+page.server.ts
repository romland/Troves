import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from "./$types";
import fs from "fs";
import { db } from '$lib/server/database';
import sharp from 'sharp';
import { MediaIngest } from '$lib/server/services/MediaIngest';

export const load = (async ({ locals, params }) => {
    console.log(params);
    const post = await db.container.findFirst({
        select : {
            name : true,
            parentId : true,
            photoPath : true,
            description : true,
            location : true,
            spatialMap: true,
            children : {
              select : {
                name : true,
                parentId : true,
              }
            },
          },
        where: {
            AND: [
                // { author: { id: locals.user.id } },
                { name: params.slug },
                { inventoryId: locals.activeInventoryId }
            ]
        },
    });

    if (!post) {
        redirect(302, '/');
    }

    return  { item: post };
}) satisfies PageServerLoad;

export const actions = {
    save: async ({ request, params, locals }) => {
        if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });

        const data = Object.fromEntries(await request.formData());
        const name = data.name as string;
        const description = data.description as string;
        const file = data.photoPath as File;

        /*
        // TODO: Check so that it's in the right format (one character, basically -- A-Z)
        if (name.length !== 1) {
            return fail(400, {
                error: true,
                message: 'Field <strong>Name</strong> must be one character (for now).'
            });
        }
        */

        const post = await db.container.findUnique({
            where: {
                inventoryId_name: { inventoryId: locals.activeInventoryId, name: data.id as string }
            }
        });

        let filename = post?.photoPath;

        if (file.size > 0) {
            const { localPath, webPath } = await MediaIngest.saveUploadedImage(file, 'container');
            filename = webPath;

			try {
                const thumbLocalPath = localPath.replace(/\.[^/.]+$/, '_thumb.webp');
                await sharp(localPath).resize({ width: 256 }).webp({ quality: 80 }).toFile(thumbLocalPath);
			} catch (e) { console.error("Failed to generate container thumbnail", e); }
        }

        const oldName = data.id as string;
        const newName = name.trim();

        if (!newName) {
            return fail(400, { error: true, message: "Container name cannot be blank." });
        }

        await db.container.update({
            where: { inventoryId_name: { inventoryId: locals.activeInventoryId, name: oldName } },
            data: {
                photoPath: filename,
                name: newName,
                description: (description || '').trim(),
                location : (data.location as string)?.trim() || null,
            }
        });

        // Automatically rename all sub-trays to match the new parent prefix
        if (oldName !== newName && post) {
            const children = await db.container.findMany({
                where: { parentId: post.id }
            });

            for (const child of children) {
                const newChildName = child.name.startsWith(oldName) 
                    ? newName + child.name.substring(oldName.length) 
                    : child.name.replace(oldName, newName);
                
                await db.container.update({
                    where: { id: child.id },
                    data: { name: newChildName }
                });
            }
        }

        // TODO: act on numtrays (removing them is futile... perhaps just allow adding for now, can't be arsed to remove)
        // TODO: We don't touch the number of trays at all for now (since it involves possibly related items). Later. CBA.

        redirect(302, `/container/${encodeURIComponent(newName)}`);
    },

    rotate: async ({ request, params, locals }) => {
        if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
        if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });

        const post = await db.container.findUnique({
            where: {
                inventoryId_name: { inventoryId: locals.activeInventoryId, name: params.slug }
            }
        });

        if (!post || !post.photoPath) return fail(404, { error: true, message: "Container or photo not found." });

        const localPath = `data${post.photoPath}`;
        if (!fs.existsSync(localPath)) return fail(404, { error: true, message: "Physical photo file not found." });

        const newWebPath = post.photoPath.replace(/\.webp$/, `_r${Date.now()}.webp`);
        const newLocalPath = `data${newWebPath}`;

        const buffer = fs.readFileSync(localPath);
        const rotatedBuffer = await sharp(buffer).rotate(90).webp({ quality: 85 }).toBuffer();
        fs.writeFileSync(newLocalPath, rotatedBuffer);
        
        const thumbPath = newLocalPath.replace(/\.[^/.]+$/, '_thumb.webp');
        const thumbBuffer = await sharp(rotatedBuffer).resize({ width: 256 }).webp({ quality: 80 }).toBuffer();
        fs.writeFileSync(thumbPath, thumbBuffer);

        await db.container.update({
            where: { id: post.id },
            data: { photoPath: newWebPath }
        });

        try { 
            fs.unlinkSync(localPath); 
            fs.unlinkSync(localPath.replace(/\.[^/.]+$/, '_thumb.webp')); 
        } catch(e) {}

        return { success: true, message: "Image rotated 90 degrees." };
    }
} satisfies Actions;
