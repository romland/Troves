import { db } from '$lib/server/database';
import { hashSessionToken } from '$lib/server/security';
import crypto from 'crypto';
import type { Cookies } from '@sveltejs/kit';

const SESSION_DAYS = 90;

export async function createSession(userId: number, userAgent: string | null, ipAddress: string | null) {
    const rawSessionId = crypto.randomUUID();
    const sessionHash = hashSessionToken(rawSessionId);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

    await db.session.create({
        data: { sessionHash, userId, userAgent, ipAddress, expiresAt }
    });

    return rawSessionId;
}

export function setSessionCookie(cookies: Cookies, rawSessionId: string) {
    cookies.set('session', rawSessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax', // Lax ensures smooth OAuth/External navigation
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * SESSION_DAYS
    });
}

export async function validateAndRefreshSession(rawSessionId: string, cookies: Cookies) {
    const sessionHash = hashSessionToken(rawSessionId);
    
    const session = await db.session.findUnique({
        where: { sessionHash },
        include: { 
            user: { 
                select: {
                    id: true,
                    username: true,
                    name: true,
                    email: true,
                    avatar: true,
                    isAdmin: true,
                    preferences: true,
                    inventoryAccess: true,
                    canCreateInventories: true
                }
            } 
        }
    });

    if (!session) return null;

    // Hard expiration check
    if (new Date() >= session.expiresAt) {
        await db.session.delete({ where: { id: session.id } });
        return null;
    }

    // Sliding Window: If the session hasn't been active in 24 hours, push expiration forward 90 days.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (session.lastActiveAt < oneDayAgo) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
        
        await db.session.update({
            where: { id: session.id },
            data: { lastActiveAt: new Date(), expiresAt }
        });
        
        // Refresh the browser cookie to match the new DB expiration
        setSessionCookie(cookies, rawSessionId);
    }

    return session;
}

export async function invalidateSession(rawSessionId: string) {
    const sessionHash = hashSessionToken(rawSessionId);
    await db.session.deleteMany({ where: { sessionHash } });
}