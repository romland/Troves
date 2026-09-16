import crypto from 'crypto';
import path from 'path';
import { error, fail, type ActionFailure } from '@sveltejs/kit';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';

/**
 * Hashes a plaintext session token securely using SHA-256.
 * Universal application: Protects session cookies from DB leaks.
 */
export function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// In-memory store for lightweight rate limiting
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();

/**
 * Universal, lightweight in-memory rate limiter.
 * Prevents brute-force credential stuffing and API abuse.
 */
export function checkRateLimit(key: string, limit: number = 5, windowMs: number = 60000): boolean {
    const now = Date.now();
    const record = rateLimitMap.get(key);

    if (!record || now > record.expiresAt) {
        // First attempt or window expired, reset bucket
        rateLimitMap.set(key, { count: 1, expiresAt: now + windowMs });
        return true;
    }

    if (record.count >= limit) return false;

    record.count += 1;
    return true;
}

/**
 * Validates and normalizes paths to prevent Local File Inclusion (LFI).
 * Enforces that resolved paths MUST remain inside the intended upload directories.
 */
export function assertSafeFilePath(inputPath: string | null | undefined): string | null {
    if (!inputPath) return null;
    
    // Strip null bytes universally
    const sanitized = inputPath.replace(/\0/g, '').split('?')[0].split('#')[0];
    
    const normalized = path.normalize(sanitized);
    if (normalized.includes('..') || !normalized.startsWith(uploadsWebFolder)) {
        console.warn(`[Security] Blocked LFI path traversal attempt: ${inputPath}`);
        return null;
    }
    return normalized;
}

/**
 * Blocks advanced Server-Side Request Forgery (SSRF) bypasses.
 * Checks for Hex (0x) and Octal (0) IP representations that bypass standard regex.
 */
export function assertSafeHostname(hostname: string): boolean {
    const host = hostname.toLowerCase();
    // Block Hex/Octal IP representations
    if (/^0/.test(host) || host.includes('0x')) return false;
    if (
        host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '169.254.169.254' ||
        host.match(/^10\./) || host.match(/^192\.168\./) || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
        host.endsWith('.local') || host.endsWith('.internal')
    ) {
        return false;
    }
    return true;
}

/**
 * DRY Role-Based Access Control (RBAC) enforcement.
 * Throwing SvelteKit's `error` naturally breaks execution and returns HTTP 403.
 */
export function assertCanMutate(locals: App.Locals) {
    if (!locals.user) {
        throw error(401, 'Unauthorized');
    }
    const role = locals.role;
    if (role !== 'EDITOR' && role !== 'OWNER' && !locals.user?.isAdmin) {
        throw error(403, 'Forbidden. Viewer access only.');
    }
}

/**
 * DRY Form Action Guard.
 * Unlike assertCanMutate (which throws a hard error page), this gracefully returns 
 * a fail() object to preserve the user's form state.
 */
export function getAuthError(locals: App.Locals): ActionFailure<{ error: boolean, message: string }> | null {
    if (!locals.user) return fail(401, { error: true, message: 'Unauthorized' });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user?.isAdmin) {
        return fail(403, { error: true, message: 'Forbidden. Viewer access only.' });
    }
    return null;
}
