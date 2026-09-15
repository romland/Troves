import { notify } from '$lib/client/notifications';
import { isPdf, isEpub, isVideo, isImage, isHtml } from '$lib/shared/fileutils';

// To fix iOS Safari GC issue with SpeechSynthesis, keep a global reference
let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(text: string, voiceURI?: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    console.log('🗣️ [VOICE] Queueing speech:', text);
    window.speechSynthesis.resume(); // iOS Safari Hack
    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.volume = 1.0;
    currentUtterance.onstart = () => console.log('🗣️ [VOICE] Speech started playing.');
    currentUtterance.onerror = (e) => console.error('🗣️ [VOICE] Speech error:', e);
    
    if (voiceURI) {
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.voiceURI === voiceURI);
        if (voice) currentUtterance.voice = voice;
    }
    
    window.speechSynthesis.speak(currentUtterance);
}

// This is very naive. Just one word: Buses.
export function pluralize(str: string): string {
    if (!str) return '';
    const lower = str.toLowerCase();
    if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') || lower.endsWith('ch') || lower.endsWith('sh')) return str;
    return str + 's';
}

export function copyDuplicateDebugPayload(title: string, scannedItem: any, dbItem: any) {
    console.group(`🐞 DEBUG: ${title}`);
    console.log("--- SCANNED ITEM (NEW) ---", scannedItem);
    console.log("--- DATABASE ITEM (EXISTING) ---", dbItem);
    if (dbItem?.debugTrace) {
        console.log("--- MATCH ALGORITHM TRACE ---");
        dbItem.debugTrace.forEach((l: string) => console.log(l));
    }
    console.groupEnd();

    const cleanObj = (obj: any) => {
        if (!obj) return null;
        const { contentToHtml, thumbPath, orgPath, cropPath, logs, documents, photos, ...rest } = obj;
        if (photos) rest.photos = photos.map((p: any) => ({ id: p.id, type: p.type }));
        return rest;
    };
    const payload = { scannedItem: cleanObj(scannedItem), dbItem: cleanObj(dbItem) };
    
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
		notify('success', "Debug data dumped to console AND copied to clipboard!");
	}).catch(() => notify('info', "Debug data dumped to console! (Clipboard copy failed)"));
}

export async function nukeAllCaches(skipConfirm: boolean = false) {
	if (!skipConfirm && !confirm("This will clear all offline data, caches, and force a hard reload. Continue?")) return;
	if (typeof window !== 'undefined') {
		try { sessionStorage.clear(); localStorage.clear(); } catch(e) { console.warn("Storage clear blocked:", e); }
		try {
			if ('caches' in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map(key => caches.delete(key)));
			}
		} catch(e) { console.warn("Cache clear blocked:", e); }
		try {
			if ('serviceWorker' in navigator) {
				const regs = await navigator.serviceWorker.getRegistrations();
				for (const r of regs) await r.unregister();
			}
		} catch(e) { console.warn("SW clear blocked:", e); }
		// Force a completely fresh page load bypassing all service worker caches
		window.location.href = window.location.pathname + '?nocache=' + Date.now();
	}
}

export function getFileInfo(doc: any) {
    const path = (doc.path || '').toLowerCase().split('#')[0];
    const source = (doc.source || '').toLowerCase();
    
    if (isPdf(path)) return { icon: 'bi-filetype-pdf', color: 'text-error', label: 'PDF' };
    if (isEpub(path)) return { icon: 'bi-book', color: 'text-secondary', label: 'EPUB' };
    if (isVideo(path)) return { icon: 'bi-filetype-mp4', color: 'text-info', label: 'VIDEO' };
    if (isImage(path)) return { icon: 'bi-image', color: 'text-success', label: 'IMAGE' };
    if (isHtml(path) || source.startsWith('http')) return { icon: 'bi-globe', color: 'text-primary', label: 'WEB' };
    if (doc.type === 'note') return { icon: 'bi-sticky', color: 'text-warning', label: 'NOTE' };
    
    const match = path.match(/\.([a-z0-9]+)$/i);
    if (match) return { icon: 'bi-file-earmark-text', color: 'text-gray-500', label: match[1].toUpperCase() };
    
    return { icon: 'bi-file-earmark-text', color: 'text-gray-500', label: 'DOC' };
}

export function isSlowConnection(): boolean {
    if (typeof navigator === 'undefined' || !('connection' in navigator)) return false;
    const conn = (navigator as any).connection;
    if (conn.saveData) return true;
    if (['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
    return false;
}

export function getHumanLocationText(polygon: number[][] | null, containerName: string = ""): string {
    if (!polygon || polygon.length !== 4) return containerName ? containerName : `Location`;
    const cx = polygon.reduce((sum, p) => sum + p[0], 0) / 4;
    const cy = polygon.reduce((sum, p) => sum + p[1], 0) / 4;
    let vertical = cy < 333 ? "Top" : cy > 666 ? "Bottom" : "Center";
    let horizontal = cx < 333 ? "left" : cx > 666 ? "right" : "center";
    
    let pos = "";
    if (vertical === "Center" && horizontal === "center") pos = "center";
    else if (vertical === "Center") pos = `${horizontal === 'left' ? 'left' : 'right'} side`;
    else if (horizontal === "center") pos = vertical.toLowerCase();
    else pos = `${vertical.toLowerCase()}-${horizontal}`;
    
    return containerName ? `${pos} in ${containerName}` : pos;
}
