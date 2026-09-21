import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { createSession, setSessionCookie } from '$lib/server/session';
import bcrypt from 'bcryptjs';
import type { PageServerLoad, Actions } from './$types';
import { getSystemDiagnostics } from '$lib/server/diagnostics';
import fs from 'fs';
import path from 'path';
import { pingTelemetry } from "$lib/server/telemetry";

export const load = (async () => {
    // Re-verify just in case the hook check was bypassed
    const userCount = await db.user.count();
    if (userCount > 0) throw redirect(303, '/login');

    return { diagnostics: await getSystemDiagnostics() };
}) satisfies PageServerLoad;

export const actions = {
    setupAdmin: async ({ request, cookies, getClientAddress }) => {
        const data = await request.formData();
        
        const username = data.get('username') as string;
        const password = data.get('password') as string;
        const passwordConfirm = data.get('passwordConfirm') as string;

        if (!username || !password) {
            return fail(400, { error: true, message: "Username and Password are required." });
        }

        // 1. Create the Master Admin User
        if (password !== passwordConfirm) {
            return fail(400, { error: true, message: "Passwords do not match." });
        }
        const adminUser = await db.user.create({
            data: {
                username: username.trim(),
                password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
                isAdmin: true,
                canCreateInventories: true
            }
        });

        pingTelemetry('install');

        // 2. Automatically log them in
        const userAgent = request.headers.get('user-agent');
        const ip = getClientAddress();
        const rawSessionId = await createSession(adminUser.id, userAgent, ip);
        
        setSessionCookie(cookies, rawSessionId);

        // DO NOT REDIRECT! Return success so the UI stays on the page and advances to Step 2
        return { success: true };
    },

    restoreBackup: async ({ request }) => {
        const data = await request.formData();
        const file = data.get('backup') as File;
        
        if (!file || file.size === 0) {
            return fail(400, { error: true, message: "No valid database file provided." });
        }

        try {
            const buffer = Buffer.from(await file.arrayBuffer());
            const dbPath = path.resolve('prisma/dev.db');
            
            await db.$disconnect();
            fs.writeFileSync(dbPath, buffer);
            await db.$connect();
            
            const userCount = await db.user.count();
            if (userCount > 0) {
                redirect(303, '/login');
            } else {
                return fail(400, { error: true, message: "Restored database is empty. Please create an account." });
            }
        } catch (e) {
            if (isRedirect(e)) throw e;
            console.error("Database restore failed:", e);
            return fail(500, { error: true, message: "Failed to overwrite the database file." });
        }        
    }
} satisfies Actions;
