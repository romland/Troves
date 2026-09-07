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
    
    // Truncate to prevent ENAMETOOLONG errors, and strict-slugify to strip all unicode/path chars
    const safeName = slugify(filename.substring(0, 30), { lower: true, strict: true });
    
    return [date, safeExtra, uuid, safeName].filter(Boolean).join('-');
}

export function getImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}
