import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { db } from '$lib/server/database';
import { checkRateLimit } from '$lib/server/security';
import { createSession, setSessionCookie } from '$lib/server/session';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

bcrypt.setRandomFallback((len) => Array.from(crypto.randomBytes(len)));

export const actions = {
    default: async ({ cookies, request, getClientAddress }) => {
        // Throttle login attempts to 5 per minute per IP to prevent brute force
        if (!checkRateLimit(`login:${getClientAddress()}`, 5, 60000)) {
            return fail(429, { error: true, message: 'Too many attempts. Please wait a minute.' });
        }

        const { username, password } = Object.fromEntries(await request.formData()) as Record<string, string>;

        if (!username || !password) {
            return fail(400, {
                error: true,
                message: '<strong>Username</strong> and/or <strong>password</strong> can not be blank.'
            });
        }

        let user = await db.user.findUnique({
            where: { username: username.trim() }
        });

        if (!user) {
            return fail(400, {
                error: true,
                message: 'User does not exist.'
            });
        } else {
            const validPassword = await bcrypt.compare(password, user.password);

            if (!validPassword) {
                return fail(400, {
                    error: true,
                    message: 'You have entered invalid credentials.'
                });
            }
        }

        const userAgent = request.headers.get('user-agent');
        const ip = getClientAddress();
        const rawSessionId = await createSession(user.id, userAgent, ip);
        setSessionCookie(cookies, rawSessionId);

        redirect(303, '/');
    }
} satisfies Actions;
