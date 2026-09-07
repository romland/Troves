import { decodeHtmlEntities } from '$lib/shared/fileutils';

/**
 * Memory & Stack-Safe HTML Stripper
 * V8's Regex engine crashes on lazy quantifiers ([\s\S]*?) over massive inline 
 * base64 strings (20MB+). This uses native indexOf to safely skip styles/scripts 
 * and extract pure text without blowing the call stack.
 */
export function stripHtmlSafe(htmlString: string, maxOutputLength: number = 10000): string {
    if (!htmlString) return '';
    
    let clean = '';
    let cursor = 0;
    const lower = htmlString.toLowerCase();
    
    while (cursor < htmlString.length) {
        const scriptStart = lower.indexOf('<script', cursor);
        const styleStart = lower.indexOf('<style', cursor);
        
        let nextTag = -1;
        let endTag = '';
        
        if (scriptStart !== -1 && (styleStart === -1 || scriptStart < styleStart)) {
            nextTag = scriptStart;
            endTag = '</script>';
        } else if (styleStart !== -1) {
            nextTag = styleStart;
            endTag = '</style>';
        }
        
        if (nextTag === -1) {
            clean += htmlString.substring(cursor);
            break;
        }
        
        clean += htmlString.substring(cursor, nextTag);
        const endIdx = lower.indexOf(endTag, nextTag);
        if (endIdx === -1) break;
        cursor = endIdx + endTag.length;
    }
    
    const extractText = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return extractText.substring(0, maxOutputLength);
}

/**
 * Safely extracts a title from raw HTML, falling back to <h1> or the URL
 */
export function extractHtmlTitleSafe(html: string, fallbackUrl: string = ""): string {
    if (!html) return decodeHtmlEntities(fallbackUrl);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : (h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : "");
    return decodeHtmlEntities(title || fallbackUrl);
}
