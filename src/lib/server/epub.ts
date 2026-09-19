import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * Extracts raw text from an EPUB file securely using JSZip.
 * Implements a word-count cutoff to prevent memory ballooning on massive books.
 */
export async function extractEpubText(filePath: string, maxWords = 100000): Promise<string> {
    try {
        const data = fs.readFileSync(filePath);
        const zip = await JSZip.loadAsync(data);
        
        // 1. Find the OPF file (the manifest of the book)
        const containerXml = await zip.file('META-INF/container.xml')?.async('string');
        if (!containerXml) throw new Error("Not a valid EPUB: Missing META-INF/container.xml");
        
        const $container = cheerio.load(containerXml, { xmlMode: true });
        const opfPath = $container('rootfile').attr('full-path');
        if (!opfPath) throw new Error("No OPF file defined in container.xml");
        
        // 2. Parse the OPF file
        const opfContent = await zip.file(opfPath)?.async('string');
        if (!opfContent) throw new Error(`OPF file not found at ${opfPath}`);
        
        const opfDir = path.posix.dirname(opfPath);
        const $opf = cheerio.load(opfContent, { xmlMode: true });
        
        // 3. Build a dictionary mapping file IDs to their relative paths
        const manifest: Record<string, string> = {};
        $opf('manifest item').each((_, el) => {
            const id = $opf(el).attr('id');
            const href = $opf(el).attr('href');
            if (id && href) manifest[id] = decodeURIComponent(href);
        });
        
        // 4. Extract text following the book's 'spine' (the exact reading order)
        let fullText = '';
        let wordCount = 0;
        
        const spineItems = $opf('spine itemref').toArray();
        for (const el of spineItems) {
            if (wordCount >= maxWords) {
                console.log(`[EPUB] Reached max word count (${maxWords}) for ${filePath}`);
                break;
            }
            
            const idref = $opf(el).attr('idref');
            if (!idref || !manifest[idref]) continue;
            
            // Resolve relative path to the HTML chapter
            const itemPath = opfDir === '.' ? manifest[idref] : `${opfDir}/${manifest[idref]}`;
            
            // Prevent Zip-Slip attacks (path traversal within the EPUB structure)
            const normalizedPath = path.posix.normalize(itemPath);
            if (normalizedPath.startsWith('..') || normalizedPath.startsWith('/')) continue;
            const file = zip.file(normalizedPath);
            if (!file) continue;
            
            try {
                const html = await file.async('string');
                
                // Zip Bomb Protection: Abort if uncompressed chapter is suspiciously huge (> 5MB)
                if (html.length > 5 * 1024 * 1024) {
                    console.warn(`[EPUB] Skipping chapter ${normalizedPath} - exceeds 5MB uncompressed limit`);
                    continue;
                }
                
                const $html = cheerio.load(html);
                const cleanText = $html.text().replace(/\s+/g, ' ').trim();
                
                if (cleanText) {
                    fullText += cleanText + '\n\n';
                    wordCount += cleanText.split(/\s+/).length;
                }
            } catch (e) {
                console.warn(`[EPUB] Failed to parse chapter ${itemPath}`);
            }
        }
        
        return fullText.trim();
    } catch (error) {
        console.error("[EPUB] Critical failure parsing EPUB:", error);
        return '';
    }
}

export async function extractEpubCoverBuffer(epubPath: string): Promise<Buffer | null> {
    const JSZip = (await import('jszip')).default;
    const { load } = await import('cheerio');
    const fs = await import('fs');
    const path = await import('path');

    try {
        const data = fs.readFileSync(epubPath);
        const zip = await JSZip.loadAsync(data);

        const containerXml = await zip.file('META-INF/container.xml')?.async('string');
        if (!containerXml) return null;
        const $container = load(containerXml, { xmlMode: true });
        const opfPath = $container('rootfile').attr('full-path');
        if (!opfPath) return null;

        const opfXml = await zip.file(opfPath)?.async('string');
        if (!opfXml) return null;
        const $opf = load(opfXml, { xmlMode: true });

        let coverHref: string | undefined;

        const coverItem3 = $opf('manifest item[properties~="cover-image"]');
        if (coverItem3.length > 0) {
            coverHref = coverItem3.attr('href');
        } else {
            const metaCover = $opf('meta[name="cover"]').attr('content');
            if (metaCover) {
                const coverItem2 = $opf(`manifest item[id="${metaCover}"]`);
                coverHref = coverItem2.attr('href');
            }
        }

        if (!coverHref) return null;

        const opfDir = path.dirname(opfPath);
        let coverZipPath = opfDir === '.' ? coverHref : `${opfDir}/${coverHref}`;
        coverZipPath = decodeURIComponent(coverZipPath);

        const file = zip.file(coverZipPath);
        if (!file) return null;

        return await file.async('nodebuffer');
    } catch (e) {
        console.error("Error extracting EPUB cover:", e);
        return null;
    }
}

export async function processEpubCoverToItemPhoto(itemId: number, epubLocalPath: string) {
    const sharp = (await import('sharp')).default;
    const { db } = await import('$lib/server/database');
    const { getSafeFilename } = await import('$lib/server/fsUtils');
    const { uploadsDiskFolder, uploadsWebFolder } = await import('$lib/server/constants');
    const { logActivity } = await import('$lib/server/logger');

    const coverBuffer = await extractEpubCoverBuffer(epubLocalPath);
    if (!coverBuffer) return;

    const existingPrimary = await db.photo.findFirst({ where: { itemId, isPrimary: true } });

    const filename = getSafeFilename(`item-${itemId}-epubcover`) + '.webp';
    const diskPath = `${uploadsDiskFolder}/${filename}`;
    const webPath = `${uploadsWebFolder}/${filename}`;

    await sharp(coverBuffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 85 }).toFile(diskPath);

    await db.photo.create({ data: { itemId, type: 'product', isPrimary: !existingPrimary, orgPath: webPath, showOriginal: true } });
    await logActivity(itemId, 'EPUB Cover', 'Automatically extracted cover art from EPUB', 'success');

    const { processItemPhotosBackground } = await import('$lib/server/photouploads');
    const freshItem = await db.item.findUnique({ where: { id: itemId }, include: { photos: true } });
    if (freshItem) {
        processItemPhotosBackground(freshItem).catch(console.error);
    }
}
