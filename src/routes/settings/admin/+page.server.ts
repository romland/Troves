import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import crypto from 'crypto';
import type { PageServerLoad, Actions } from './$types';
import bcrypt from 'bcryptjs';
import { getSystemDiagnostics } from '$lib/server/diagnostics';

    bcrypt.setRandomFallback((len) => Array.from(crypto.randomBytes(len)));

export const load = (async ({ locals }) => {
    if (!locals.user?.isAdmin) throw redirect(303, '/profile');

    const allUsers = await db.user.findMany({ 
        select: { id: true, username: true, name: true, email: true, isAdmin: true, canCreateInventories: true } 
    });

    return { allUsers, diagnostics: await getSystemDiagnostics() };
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
        const email = data.get('email') as string;
        const password = data.get('password') as string;
        const passwordConfirm = data.get('passwordConfirm') as string;
        const isAdmin = data.get('isAdmin') === 'true';
        const canCreateInventories = data.get('canCreateInventories') === 'true';

        if (id === locals.user.id && !isAdmin) {
            return fail(400, { error: true, message: "You cannot revoke your own admin status." });
        }

        let updateData: any = { name: name.trim(), email: email.trim(), isAdmin, canCreateInventories };
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
    }
} satisfies Actions;
