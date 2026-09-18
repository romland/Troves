import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import crypto from 'crypto';
import type { PageServerLoad, Actions } from './$types';
import bcrypt from 'bcryptjs';
import { getSystemDiagnostics } from '$lib/server/diagnostics';
import { extensionManager } from '$lib/server/extensions/ExtensionManager';
import fs from 'fs';
import path from 'path';

bcrypt.setRandomFallback((len) => Array.from(crypto.randomBytes(len)));

export const load = (async ({ locals }) => {
    if (!locals.user?.isAdmin) throw redirect(303, '/profile');

    const allUsers = await db.user.findMany({ 
        select: { id: true, username: true, name: true, email: true, isAdmin: true, canCreateInventories: true } 
    });

    const docsDir = path.resolve(process.cwd(), 'docs/extensions');
    let extensionDocs = '';
    try {
        if (fs.existsSync(docsDir)) {
            const docFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.md')).sort();
            for (const file of docFiles) {
                extensionDocs += `\n\n--- ${file} ---\n` + fs.readFileSync(path.join(docsDir, file), 'utf-8');
            }
        }
    } catch (e) { console.error("Failed to read extension docs", e); }

    const pluginDir = path.resolve(process.cwd(), 'data/plugins');
    let rawFiles: string[] = [];
    try { if (fs.existsSync(pluginDir)) rawFiles = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs')); } catch(e){}
    
    const loadedDetails = extensionManager.getPluginDetails();
    const plugins = rawFiles.map(file => {
        const loaded = loadedDetails.find(d => d.name === file);
        let content = '';
        try { content = fs.readFileSync(path.join(pluginDir, file), 'utf-8'); } catch(e){}
        return {
            name: file,
            isLoaded: !!loaded,
            hooks: loaded?.hooks || [],
            actions: loaded?.actions || [],
            content
        };
    });

    return { allUsers, diagnostics: await getSystemDiagnostics(), plugins, extensionDocs };
}) satisfies PageServerLoad;

export const actions = {
    createUser: async ({ request, locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden. Admins only." });
        
        const data = await request.formData();
        const username = data.get('username') as string;
        const password = data.get('password') as string;
        const passwordConfirm = data.get('passwordConfirm') as string;
        
        if (!username || !password) return fail(400, { error: true, message: "Username and password required." });
        if (password !== passwordConfirm) return fail(400, { error: true, message: "Passwords do not match." });

        try {
            await db.user.create({
                data: {
                    username: username.trim(),
                    password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
                }
            });
            return { success: true, message: `User '${username}' created!` };
        } catch (e) {
            return fail(400, { error: true, message: "Username likely already exists." });
        }
    },
    
    updateUser: async ({ request, locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden. Admins only." });

        const data = await request.formData();
        const id = Number(data.get('id'));
        if (!id) return fail(400, { error: true, message: "Invalid User ID." });

        const name = data.get('name') as string;
        let email: string | null = data.get('email') as string;
        email = email.trim() === '' ? null : email.trim();
        const password = data.get('password') as string;
        const passwordConfirm = data.get('passwordConfirm') as string;
        const isAdmin = data.get('isAdmin') === 'true';
        const canCreateInventories = data.get('canCreateInventories') === 'true';

        if (id === locals.user.id && !isAdmin) {
            return fail(400, { error: true, message: "You cannot revoke your own admin status." });
        }

        let updateData: any = { name: name.trim(), email: email || null, isAdmin, canCreateInventories };
        if (password) {
            if (password !== passwordConfirm) return fail(400, { error: true, message: "Passwords do not match." });
            if (password.trim().length < 6) return fail(400, { error: true, message: "Password must be at least 6 characters." });
            updateData.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
        }

        await db.user.update({ where: { id }, data: updateData });

        return { success: true, message: "User updated successfully." };
    },

    deleteUser: async ({ request, locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden. Admins only." });

        const data = await request.formData();
        const id = Number(data.get('id'));
        if (!id) return fail(400, { error: true, message: "Invalid User ID." });

        if (id === locals.user.id) {
            return fail(400, { error: true, message: "You cannot delete yourself." });
        }

        const userToDelete = await db.user.findUnique({ where: { id } });
        if (!userToDelete) return fail(404, { error: true, message: "User not found." });

        await db.user.delete({ where: { id } });

        return { success: true, message: `User '${userToDelete.username}' deleted successfully.` };
    },
    
    reloadPlugins: async ({ locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden." });
        await extensionManager.reloadPlugins();
        return { success: true, message: "Plugins hot-reloaded successfully." };
    },
    
    savePlugin: async ({ request, locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden." });
        
        const data = await request.formData();
        const name = data.get('name') as string;
        const content = data.get('content') as string;
        
        if (!name || !name.match(/^[a-zA-Z0-9_-]+\.(js|mjs)$/)) return fail(400, { error: true, message: "Invalid filename." });
        
        const pluginDir = path.resolve(process.cwd(), 'data/plugins');
        if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
        
        fs.writeFileSync(path.join(pluginDir, name), content, 'utf-8');
        await extensionManager.reloadPlugins();
        return { success: true, message: `Plugin '${name}' saved and reloaded.` };
    },
    
    deletePlugin: async ({ request, locals }) => {
        if (!locals.user?.isAdmin) return fail(403, { error: true, message: "Forbidden." });
        
        const data = await request.formData();
        const name = data.get('name') as string;
        
        const filePath = path.resolve(process.cwd(), 'data/plugins', name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        await extensionManager.reloadPlugins();
        return { success: true, message: `Plugin '${name}' deleted.` };
    }
} satisfies Actions;
