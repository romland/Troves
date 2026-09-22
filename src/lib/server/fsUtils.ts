import fs from 'fs';
import path from 'path';
import slugify from 'slugify';
import crypto from 'crypto';

export function getSafeFilename(filename: string, extra: string = ""): string {
    // Format: YYYYMMDDHHmmss
    const date = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const uuid = crypto.randomUUID();
    
    // Strip directory traversal or null bytes if 'extra' is ever user-controlled
    const safeExtra = extra.replace(/[^a-zA-Z0-9_-]/g, '');
    
    // We drop the original filename completely to prevent runaway stacked strings 
    // (like -draft-draft-draft). A clean date + extra + UUID is universally unique.
    return [date, safeExtra, uuid].filter(Boolean).join('-');
}

export function getImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}
