<script lang="ts">
    /*
     * ARCHITECTURE: Document Rendering & Reading Position State Machine
     * 
     * This component serves as the universal viewer for EPUBs, PDFs, Webpages (Iframes), and Markdown.
     * 
     * 1. Position Tracking: We aggressively track scrollY (Web/MD), CFI (EPUB), or pageNum (PDF).
     * 2. The "Resume Reading" Breadcrumb: 
     *    - If a user opens a document VIA A SEARCH RESULT, we intercept the query.
     *    - We freeze the position tracker so the search jump doesn't overwrite their saved bookmark.
     *    - We spawn a "Return to Bookmark" button. Clicking it clears the search state and warps 
     *      them back to their original reading position, unfreezing the tracker.
     * 3. Sync: On close, we push the latest position to `localStorage` and SvelteKit's `/profile` backend.
     */

    import { fade, fly } from 'svelte/transition';
    import { cubicOut } from 'svelte/easing';
    import { tick, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { notify } from '$lib/client/notifications';
    import GestureShield from './GestureShield.svelte';
    import { marked } from 'marked';
    import { isEpub, isMarkdown, isHtml, isPdf, isCsv } from '$lib/shared/fileutils';
    import PdfViewer from './PdfViewer.svelte';

    export let isOpen = false;
    let doc: any = null;
    let loading = false;
    let viewerRef: HTMLDivElement;
    let overlayRef: HTMLDivElement;
    let iframeRef: HTMLIFrameElement;
	let docType: 'epub' | 'iframe' | 'markdown' | 'pdf-mobile' | 'pdf-inline' | 'none' = 'none';
    let invertIframe = false;
    let markdownContentHtml = '';
    
    let book: any = null;
    let rendition: any = null;
    
    // UI Chrome State
    let showMenu = true;
    let menuTimeout: ReturnType<typeof setTimeout>;
    let showToc = false;
    let showSettings = false;
    
    // Reading State
    let atStart = true;
    let atEnd = false;
    let isTurningPage = false;
    let progress = 0;
    let currentChapter = "";
    let toc: any[] = [];
    let locationsGenerated = false;
    
    // Settings
    let fontSize = 100;
    let fontFamily = 'system-ui, -apple-system, sans-serif';
    let lineHeight = 1.6;
    let pageMargin = 16;

    // Highlight state
    let highlightModal: HTMLDialogElement;
    let pendingHighlight: { text: string, cfiRange: string, chapterText: string } | null = null;
    let isSavingHighlight = false;

    let returnToPosition: string | null = null;
    let returnToLabel = "";

    let userPrefs: any = {};
    let markdownContainerRef: HTMLDivElement;
    let mdScrollTimeout: any;
	let isMobile = false;
	let isLargeDocument = false;
	let docSizeStr = "";

    let activeDocUrl = "";
    let activeSearchQuery = "";
    let isMaximized = false;

    export async function open(documentRecord: any) {
        doc = documentRecord;
        isOpen = true;
        loading = true;
        showMenu = true;
        showToc = false;
        showSettings = false;
        atStart = true;
        atEnd = false;
        progress = 0;
        currentChapter = "";
        toc = [];
        locationsGenerated = false;
        invertIframe = false;
        isMaximized = false;

		isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
		isLargeDocument = false;
		docSizeStr = "";

        const rawPath = doc.path || doc.source || '';
        let path = rawPath.toLowerCase();
        let cfiToJump = null;
        
        // Hydrate document preferences early so all viewers can access them
        userPrefs = JSON.parse($page.data.user?.preferences || '{}');

        activeSearchQuery = documentRecord._searchQuery || $page.url.searchParams.get('q') || $page.url.searchParams.get('doc') || '';
        const epubSearchQuery = documentRecord._rawQuery || activeSearchQuery;
        activeDocUrl = rawPath;

        returnToPosition = null;
        returnToLabel = "";

        if (activeSearchQuery && !activeDocUrl.includes('#')) {
            const safeQuery = encodeURIComponent(activeSearchQuery.replace(/"/g, '').trim());
            const safeExact = encodeURIComponent(epubSearchQuery.replace(/"/g, '').trim());
            if (isPdf(path)) {
                activeDocUrl = `${activeDocUrl}#search=${safeQuery}&exact=${safeExact}`;
            } else if (isHtml(path) || path.endsWith('.csv') || rawPath.startsWith('http')) {
                // Scroll-to-text fragment (Chromium natively supports this)
                activeDocUrl = `${activeDocUrl}#:~:text=${safeQuery}`;
            }

            // If we are jumping to a search query, check if there's an existing reading position to protect
            const savedPdfPage = localStorage.getItem(`troves_pdf_page_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.pdfLocations?.[doc.id || doc.path];
            const savedWebScroll = localStorage.getItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.webLocations?.[doc.id || doc.path];
            const savedCfi = localStorage.getItem(`troves_epub_cfi_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.epubLocations?.[doc.id || doc.path];

            if (isPdf(path) && savedPdfPage) {
                returnToPosition = savedPdfPage;
                returnToLabel = `Back to Page ${savedPdfPage}`;
            } else if (isEpub(path) && savedCfi) {
                returnToPosition = savedCfi;
                returnToLabel = "Return to Bookmark";
            } else if ((isHtml(path) || isMarkdown(path) || path.endsWith('.csv') || rawPath.startsWith('http')) && savedWebScroll) {
                returnToPosition = savedWebScroll;
                returnToLabel = "Return to Reading";
            }

        } else if (isPdf(path) && !activeDocUrl.includes('#')) {
            const savedPdfPage = localStorage.getItem(`troves_pdf_page_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.pdfLocations?.[doc.id || doc.path];
            if (savedPdfPage) {
                activeDocUrl = `${activeDocUrl}#page=${savedPdfPage}`;
            }
        }

        // Extract CFI anchor if we jumped here from a Search Result highlight
        if (rawPath.includes('#epubcfi(')) {
            const parts = rawPath.split('#');
            path = parts[0].toLowerCase();
            cfiToJump = parts.slice(1).join('#');
            doc.path = parts[0]; // Mutate locally so epub.js loads the book correctly
        }

        if (isEpub(path)) {
            docType = 'epub';
            resetMenuTimeout();
        } else if (isMarkdown(path) || doc.type === 'note') {
            docType = 'markdown';
            resetMenuTimeout();
            try {
                const res = await fetch(doc.path || doc.source);
                const text = await res.text();
                const rawHtml = await marked.parse(text, { breaks: true, gfm: true });
                const q = (doc._rawQuery || activeSearchQuery || '').replace(/"/g, '').trim();
                if (q) {
                    // Highlight text safely outside of HTML attributes
                    const regex = new RegExp(`(?![^<]*>)(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    markdownContentHtml = rawHtml.replace(regex, '<mark class="bg-primary/30 text-primary rounded-sm px-1">$1</mark>');
                    setTimeout(() => {
                        const mark = document.querySelector('.prose mark');
                        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 200);
                } else {
                    markdownContentHtml = rawHtml;
                }

                if (!activeSearchQuery) {
                    setTimeout(() => {
                        const savedScroll = localStorage.getItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.webLocations?.[doc.id || doc.path];
                        if (savedScroll && markdownContainerRef) markdownContainerRef.scrollTop = parseInt(savedScroll, 10);
                    }, 100);
                }
            } catch (e) {
                markdownContentHtml = '<p class="text-error font-bold">Failed to load document.</p>';
            }
		} else if (isPdf(path)) {
			try {
				const res = await fetch(doc.path || doc.source, { method: 'HEAD' });
				const bytes = res.headers.get('content-length');
				if (bytes) {
					const mb = parseInt(bytes) / (1024 * 1024);
					docSizeStr = mb > 1 ? `${mb.toFixed(2)} MB` : `${(parseInt(bytes) / 1024).toFixed(0)} KB`;
					if (mb > 25) isLargeDocument = true;
				}
			} catch (e) {}
			
			if (isMobile && isLargeDocument) {
				docType = 'pdf-mobile';
			} else {
				docType = 'pdf-inline';
			}
			clearTimeout(menuTimeout);
		} else if (isCsv(path) || isHtml(path)) {
			docType = 'iframe';
			clearTimeout(menuTimeout);
        } else {
            window.open(doc.path || doc.source, '_blank');
            close();
            return;
        }
        
        if (docType === 'iframe') invertIframe = userPrefs.documentDarkMode === true;
        
        // Check for specific document override
        const override = localStorage.getItem(`troves_invert_${$page.data.user?.id}_${doc?.id}`);
        if (override !== null) invertIframe = override === 'true';

        // Load user's persistent reading preferences
        const savedPrefs = localStorage.getItem(`troves_epub_prefs_${$page.data.user?.id}`);
        if (savedPrefs) {
            try {
                const prefs = JSON.parse(savedPrefs);
                if (prefs.fontSize) fontSize = prefs.fontSize;
                if (prefs.fontFamily) fontFamily = prefs.fontFamily;
                if (prefs.lineHeight) lineHeight = prefs.lineHeight;
                if (prefs.pageMargin) pageMargin = prefs.pageMargin;
            } catch(e) {}
        }

        await tick(); // Wait for DOM to mount viewerRef
        if (overlayRef) overlayRef.focus();
        
        if (docType === 'iframe') return; // Iframe handles its own loading state via on:load

        if (docType === 'epub') {
            try {
                // Lazy load the heavy epub.js library ONLY when a book is opened
                const ePub = (await import('epubjs')).default;
                
                book = ePub(doc.path);
                
                rendition = book.renderTo(viewerRef, {
                width: '100%',
                height: '100%',
                spread: window.innerWidth > 800 ? 'auto' : 'none',
                manager: 'continuous',
                flow: 'paginated',
                snap: true
            });
            
            // === PERFECT DARK MODE SYNC ===
            // 1. Grab exact DaisyUI variables dynamically from the current theme
            const dummy = document.createElement('div');
            dummy.className = 'bg-base-100 text-base-content';
            document.body.appendChild(dummy);
            const themeBg = getComputedStyle(dummy).backgroundColor;
            const themeFg = getComputedStyle(dummy).color;
            document.body.removeChild(dummy);

            // 2. Register base theme
            rendition.themes.register('troves', {
                'html': { 'background': `${themeBg} !important` },
                'body': { 
                    'background': `${themeBg} !important`, 
                    'color': `${themeFg} !important`,
                    'font-family': 'var(--ep-font) !important'
                }
            });
            rendition.themes.select('troves');
            rendition.themes.fontSize(`${fontSize}%`);

            // 3. Brute-force override any publisher styles embedded in the EPUB html
            rendition.hooks.content.register((contents: any) => {
                const style = contents.document.createElement('style');
                style.innerHTML = `
                    :root { --ep-font: ${fontFamily}; --ep-lh: ${lineHeight}; --ep-pad: ${pageMargin}px; }
                    html, body { background: ${themeBg} !important; background-color: ${themeBg} !important; color: ${themeFg} !important; font-family: var(--ep-font) !important; line-height: var(--ep-lh) !important; padding-left: var(--ep-pad) !important; padding-right: var(--ep-pad) !important; }
                    * { color: ${themeFg} !important; background-color: transparent !important; font-family: inherit !important; }
                    a { color: ${themeFg} !important; text-decoration: underline !important; }
                    img { max-width: 100% !important; height: auto !important; border-radius: 8px !important; }
                    svg { max-width: 100% !important; height: auto !important; }
                `;
                contents.document.head.appendChild(style);
            });
            
            // === RESTORE READING POSITION ===
            const savedCfi = localStorage.getItem(`troves_epub_cfi_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.epubLocations?.[doc.id || doc.path];

            if (epubSearchQuery) {
                /* 
                 * EPUB SEARCH CRAWLER
                 * EPUB.js renders isolated iframes per chapter. It cannot natively search the whole book.
                 * We iterate over the book's spine, silently loading and unloading chapters into memory 
                 * until we find the target CFI, then command the rendition to jump and highlight it.
                 */
                const q = epubSearchQuery.replace(/"/g, '').trim();
                book.ready.then(async () => {
                    let foundCfi = null;
                    for (const item of book.spine.spineItems) {
                        await item.load(book.load.bind(book));
                        const results = item.find(q);
                        item.unload(); // Prevent memory leaks in large books
                        if (results && results.length > 0) { foundCfi = results[0].cfi; break; }
                    }
                    if (foundCfi) {
                        await rendition.display(foundCfi);
                        rendition.annotations.highlight(foundCfi, {}, (e: any) => {});
                    } else {
                        await rendition.display(cfiToJump || savedCfi || undefined);
                    }
                });
            } else if (cfiToJump) {
                await rendition.display(cfiToJump);
            } else if (savedCfi) {
                await rendition.display(savedCfi);
            } else {
                await rendition.display();
            }
            
            // === LOAD METADATA ===
            book.loaded.navigation.then((nav: any) => {
                // Flatten TOC for mobile-friendly linear lists
                const flatten = (arr: any[], level = 0): any[] => {
                    return arr.reduce((acc, item) => {
                        acc.push({ ...item, level });
                        if (item.subitems?.length) acc.push(...flatten(item.subitems, level + 1));
                        return acc;
                    }, []);
                };
                toc = flatten(nav.toc);
            });

            // Generate locations for exact percentage tracking (this is heavy, so we don't await it to unblock reading)
            book.ready.then(() => {
                return book.locations.generate(1600);
            }).then(() => {
                locationsGenerated = true;
                updateProgress(rendition.currentLocation());
            });
            
            // === CONTEXT HIGHLIGHT EXTRACTOR ===
            rendition.on('selected', async (cfiRange: string, contents: any) => {
                const text = rendition.getRange(cfiRange).toString().trim();
                if (!text) return;
                
                const chapterText = contents.document.body.innerText;
                pendingHighlight = { text, cfiRange, chapterText };
                highlightModal.showModal();

                contents.window.getSelection().removeAllRanges();
            });
            
            // Pass through keyboard events from inside the iframe
            rendition.on('keyup', (e: KeyboardEvent) => {
                if (e.key === 'ArrowRight' || e.key === ' ') nextPage();
                else if (e.key === 'ArrowLeft') prevPage();
                else if (e.key === 'Escape') close();
            });

            // Edge-tapping for 1-handed reading
            rendition.on('click', (e: MouseEvent) => {
                const width = e.view?.innerWidth || window.innerWidth;
                const x = e.clientX;
                if (x < width * 0.25) prevPage();
                else if (x > width * 0.75) nextPage();
                else toggleMenu();
            });

            rendition.on('relocated', (location: any) => {
                if (returnToPosition) return; // Prevent overwriting bookmark while inspecting search result
                if (location && location.start && location.start.cfi) {
                        localStorage.setItem(`troves_epub_cfi_${$page.data.user?.id}_${doc.id || doc.path}`, location.start.cfi);
                }
                updateProgress(location);
            });
            
            } catch (e) {
                console.error("Failed to load EPUB:", e);
            } finally {
                loading = false;
            }
        } else {
            loading = false;
        }
    }
    
    function handleIframeLoad() {
        loading = false;
        if (iframeRef) {
            iframeRef.focus();
            iframeRef.contentWindow?.focus();

            // Setup Scroll Restoration for Local HTML Files
            try {
                console.log(`[DEBUG-WEB-SCROLL] Iframe loaded. Src: ${iframeRef.src}`);
                if (!activeSearchQuery && iframeRef.contentWindow) {
                    const savedScroll = localStorage.getItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`) || userPrefs.webLocations?.[doc.id || doc.path];
                    console.log(`[DEBUG-WEB-SCROLL] Checking restore key: troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}. Found: ${savedScroll}`);
                    if (savedScroll) {
                        setTimeout(() => {
                            const y = parseInt(savedScroll, 10);
                            if (iframeRef.contentWindow) iframeRef.contentWindow.scrollTo({ top: y, behavior: 'auto' });
                            if (iframeRef.contentDocument) {
                                if (iframeRef.contentDocument.documentElement) iframeRef.contentDocument.documentElement.scrollTop = y;
                                if (iframeRef.contentDocument.body) iframeRef.contentDocument.body.scrollTop = y;
                            }
                            console.log(`[DEBUG-WEB-SCROLL] Scroll restored to: ${savedScroll}`);
                        }, 150); // slight delay to allow layout recalculation
                    }
                } else {
                    console.log(`[DEBUG-WEB-SCROLL] Skipped restore. activeSearchQuery: "${activeSearchQuery}", hasWindow: ${!!iframeRef.contentWindow}`);
                }
                
                if (iframeRef.contentDocument) {
                    let ifScrollTimeout: any;
                    iframeRef.contentDocument.addEventListener('scroll', (e) => {
                        if (returnToPosition) return;
                        clearTimeout(ifScrollTimeout);
                        ifScrollTimeout = setTimeout(() => {
                            let currentScroll = 0;
                            try {
                                if (e.target && (e.target as HTMLElement).scrollTop) {
                                    currentScroll = (e.target as HTMLElement).scrollTop;
                                } else {
                                    const win = iframeRef.contentWindow;
                                    const docRef = iframeRef.contentDocument;
                                    currentScroll = win?.scrollY || docRef?.documentElement?.scrollTop || docRef?.body?.scrollTop || 0;
                                }
                                console.log(`[DEBUG-WEB-SCROLL] Saving new scrollY position: ${currentScroll}`);
                                localStorage.setItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`, currentScroll.toString());
                            } catch(err) {}
                        }, 150);
                    }, { capture: true, passive: true });
                    console.log(`[DEBUG-WEB-SCROLL] Successfully attached scroll listener to iframe.`);
                }
            } catch (e) {
                console.warn(`[DEBUG-WEB-SCROLL] Failed to setup scroll tracking. Likely Cross-Origin restriction:`, e);
            }

            try {
                const iframeDoc = iframeRef.contentDocument || iframeRef.contentWindow?.document;
                if (iframeDoc) {
                    iframeDoc.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') close();
                    });

                    // === THE "READING MODE" NUKE ===
                    // Only inject into HTML documents (skip PDFs)
                    const docPath = (doc?.path || doc?.source || '').toLowerCase();
                if (isHtml(docPath)) {
                        const style = iframeDoc.createElement('style');
                        style.innerHTML = `
                            /* Annihilate cookie banners, paywalls, and sticky overlays */
                            [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i],
                            [class*="gdpr" i], [id*="gdpr" i], [class*="popup" i], [id*="popup" i],
                            [class*="newsletter" i], [class*="subscribe" i], [class*="overlay" i],
                            /* Remove sticky headers/footers to give full reading real estate */
                            header, footer, nav, [style*="position: fixed"], [style*="position: sticky"] { display: none !important; }
                            /* Ensure the body actually scrolls and isn't locked by a hidden paywall */
                            body, html { overflow: auto !important; position: static !important; }
                        `;
                        iframeDoc.head.appendChild(style);
                    }

                    // Force iframe to scroll to search query, bypassing URL fragment security blocks
                    if (activeSearchQuery && isHtml(docPath)) {
                        const script = iframeDoc.createElement('script');
                        script.innerHTML = `setTimeout(() => { window.find("${activeSearchQuery.replace(/"/g, '').trim()}"); }, 200);`;
                        iframeDoc.body.appendChild(script);
                    }
                }
            } catch (err) {
                // Fails silently on secure PDFs or cross-origin URLs
            }
        }
    }

    async function resumeReading() {
        if (!returnToPosition) return;
        
        if (docType === 'epub' && rendition) {
            await rendition.display(returnToPosition);
        } else if (docType === 'iframe' && iframeRef?.contentWindow) {
            iframeRef.contentWindow.scrollTo({ top: parseInt(returnToPosition, 10), behavior: 'smooth' });
        } else if (docType === 'markdown' && markdownContainerRef) {
            markdownContainerRef.scrollTo({ top: parseInt(returnToPosition, 10), behavior: 'smooth' });
        } else if (docType === 'pdf-inline') {
            activeDocUrl = `${activeDocUrl.split('#')[0]}#page=${returnToPosition}`;
        }
        
        returnToPosition = null; // Clear breadcrumb, resume tracking
    }

    function updateProgress(location: any) {
        if (!location) return;
        atStart = location.atStart;
        atEnd = location.atEnd;
        
        if (locationsGenerated) {
            progress = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
        }
        
        // Find current chapter from TOC
        if (toc.length > 0) {
            const cleanHref = location.start.href.split('#')[0];
            const chapter = toc.find(item => item.href.includes(cleanHref));
            if (chapter) currentChapter = chapter.label.trim();
        }
    }

    function toggleMaximize() {
        isMaximized = !isMaximized;
        if (docType === 'epub' && rendition) {
            setTimeout(() => rendition.resize(), 300); // Recalculate pagination after CSS transition
        }
    }

    export function close() {
        // Ensure we capture the absolute latest position before saving to DB
        if (docType === 'iframe') {
            try {
                const win = iframeRef?.contentWindow;
                const docRef = iframeRef?.contentDocument;
                const currentScroll = win?.scrollY || docRef?.documentElement?.scrollTop || docRef?.body?.scrollTop || 0;
                if (currentScroll > 0) {
                    localStorage.setItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`, currentScroll.toString());
                }
            } catch(e) {}
        } else if (docType === 'markdown' && markdownContainerRef) {
            localStorage.setItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`, markdownContainerRef.scrollTop.toString());
        }

		// Sync final reading positions to the server before closing
		if ((docType === 'epub' || docType === 'pdf-inline' || docType === 'iframe' || docType === 'markdown') && doc) {
			try {
                const isPdf = docType === 'pdf-inline';
                const isWeb = docType === 'iframe' || docType === 'markdown';
                const key = `troves_${isPdf ? 'pdf_page' : (isWeb ? 'scroll_y' : 'epub_cfi')}_${$page.data.user?.id}_${doc.id || doc.path}`;
                const val = localStorage.getItem(key);
				if (val) {
					const currentPrefs = JSON.parse($page.data.user?.preferences || '{}');
                    const prefsKey = isPdf ? 'pdfLocations' : (isWeb ? 'webLocations' : 'epubLocations');
					if (!currentPrefs[prefsKey]) currentPrefs[prefsKey] = {};
					if (currentPrefs[prefsKey][doc.id || doc.path] !== val) {
						currentPrefs[prefsKey][doc.id || doc.path] = val;
						const fd = new FormData();
						fd.append('preferences', JSON.stringify(currentPrefs));
						fetch('/profile?/updatePreferences', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' }});
					}
				}
			} catch (e) {}
		}

        isOpen = false;
        showToc = false;
        showSettings = false;
        docType = 'none';
        if (book) {
            book.destroy();
            book = null;
            rendition = null;
        }
    }

    // --- Gesture & Navigation ---
    const FADE_DURATION = 75; // Fast enough to be snappy, long enough to hide the flash
    
    async function prevPage() { 
        if (!rendition || isTurningPage) return; 
        isTurningPage = true;
        // Wait for the viewer to actually turn invisible before thrashing the DOM
        await new Promise(r => setTimeout(r, FADE_DURATION)); 
        await rendition.prev(); 
        isTurningPage = false;
        resetMenuTimeout(); 
    }
    
    async function nextPage() { 
        if (!rendition || isTurningPage) return; 
        isTurningPage = true;
        // Wait for the viewer to actually turn invisible before thrashing the DOM
        await new Promise(r => setTimeout(r, FADE_DURATION)); 
        await rendition.next(); 
        isTurningPage = false;
        resetMenuTimeout(); 
    }
    
    function toggleMenu() {
        if (docType === 'iframe') return; // Enforce always visible
        showMenu = !showMenu;
        if (showMenu) resetMenuTimeout();
        if (!showMenu) { showToc = false; showSettings = false; }
    }
    
    function resetMenuTimeout() {
        clearTimeout(menuTimeout);
        if (showMenu) {
            menuTimeout = setTimeout(() => showMenu = false, 3500);
        }
    }
    
    function savePrefs() {
        localStorage.setItem(`troves_epub_prefs_${$page.data.user?.id}`, JSON.stringify({ fontSize, fontFamily, lineHeight, pageMargin }));
    }

    function changeFontSize(delta: number) {
        fontSize = Math.max(50, Math.min(250, fontSize + delta));
        if (rendition) rendition.themes.fontSize(`${fontSize}%`);
        savePrefs();
        resetMenuTimeout();
    }
    
    function applyEpubStyles() {
        if (rendition) {
            rendition.getContents().forEach((c: any) => {
                if (c && c.document && c.document.documentElement) {
                    c.document.documentElement.style.setProperty('--ep-font', fontFamily);
                    c.document.documentElement.style.setProperty('--ep-lh', lineHeight.toString());
                    c.document.documentElement.style.setProperty('--ep-pad', `${pageMargin}px`);
                }
            });
        }
        savePrefs();
        resetMenuTimeout();
    }
    
    function changeFontFamily(family: string) { fontFamily = family; applyEpubStyles(); }
    function changeLineHeight(val: number) { lineHeight = val; applyEpubStyles(); }
    function changeMargin(val: number) { pageMargin = val; applyEpubStyles(); }

    function goToChapter(href: string) {
        if (!rendition || !book) return;

        const parts = href.split('#');
        const basePath = parts[0];
        const anchor = parts.length > 1 ? '#' + parts.slice(1).join('#') : '';

        let targetHref = href;
        const spine = book.spine.spineItems;

        // If the exact base path isn't in the spine, fuzzy match it before asking epub.js to render
        if (!spine.some((item: any) => item.href === basePath)) {
            const fuzzyMatch = spine.find((item: any) => 
                item.href.endsWith('/' + basePath) || 
                basePath.endsWith('/' + item.href) ||
                item.href.includes(basePath)
            );

            if (fuzzyMatch) {
                targetHref = fuzzyMatch.href + anchor; // Re-attach the sub-section anchor!
            }
        }

        rendition.display(targetHref).catch((err: any) => {
            console.error(`[EPUB Nav] Navigation completely failed for: '${targetHref}'`, err);
            console.table(book.spine.spineItems.map((i: any) => ({ idref: i.idref, href: i.href })));
        });

        showToc = false;
        showMenu = false;
    }

    function handleScrub(e: any) {
        if (!locationsGenerated || !book || !rendition) return;
        const pct = parseFloat(e.currentTarget.value) / 100;
        const cfi = book.locations.cfiFromPercentage(pct);
        rendition.display(cfi);
        resetMenuTimeout();
    }

    function bookmarkCurrentPage() {
        if (!rendition) return;
        const loc = rendition.currentLocation();
        if (!loc || !loc.start) return;
        pendingHighlight = {
            text: "", // Empty text signals this is a page bookmark, not a text highlight
            cfiRange: loc.start.cfi,
            chapterText: currentChapter || 'Saved Location'
        };
        highlightModal.showModal();
    }
    
    function handleGlobalKeydown(e: KeyboardEvent) {
        if (!isOpen) return;
        if (docType === 'iframe') resetMenuTimeout();
        if (e.key === 'Escape') {
            e.preventDefault();
            if (showToc || showSettings) { showToc = false; showSettings = false; }
            else close();
        } else if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            nextPage();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevPage();
        }
    }

    async function confirmHighlight() {
        if (!pendingHighlight) return;
        
        const fd = new FormData();
        const content = pendingHighlight.text 
            ? `**Highlight from ${doc.title}:**\n> "${pendingHighlight.text}"`
            : `**Bookmark in ${doc.title}:**\n${currentChapter || 'Saved Location'}`;
            
        fd.append('content', content);
        fd.append('category', 'idea');
        fd.append('preprocessed_docs[]', JSON.stringify({
            title: pendingHighlight.text ? `Highlight: ${doc.title}` : `Bookmark: ${doc.title}`,
            source: doc.title,
            path: `${doc.path}#${pendingHighlight.cfiRange}`,
            extracts: [pendingHighlight.chapterText], // Allows FTS5 to index the entire chapter text around the quote
            type: 'note'
        }));
        if (doc.itemId) fd.append('linkedItemIds[]', doc.itemId.toString());
        
        // Fire and forget, don't await the network
        fetch('/timeline?/capture', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true', 'accept': 'application/json' } })
            .then(() => notify('success', 'Highlight saved to Notebook!'))
            .catch(() => notify('error', 'Failed to save highlight.'));
        
        highlightModal.close();
        pendingHighlight = null;
    }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

{#if isOpen}
    <!-- Main Background (Dimmed to separate the book from the OS layer) -->
    <div 
        bind:this={overlayRef}
        class="fixed inset-0 z-[9999] bg-base-300/95 backdrop-blur-xl flex flex-col outline-none overscroll-none touch-none overflow-y-scroll"
        transition:fade={{ duration: 250, easing: cubicOut }}
        tabindex="-1"
    >
        <!-- === TOP CHROME === -->
        <div 
            class="absolute top-4 inset-x-4 {isMaximized ? 'max-w-none' : 'max-w-2xl'} mx-auto flex justify-between items-center bg-base-200/95 backdrop-blur-xl border border-base-300 shadow-xl rounded-full p-2 z-50 transition-all duration-300"
            class:opacity-0={!showMenu && !showToc && !showSettings}
            class:-translate-y-4={!showMenu && !showToc && !showSettings}
            class:pointer-events-none={!showMenu && !showToc && !showSettings}
        >
        <button class="btn btn-sm btn-ghost rounded-full px-4 font-bold" on:click={close} aria-label="Close">
            Done
            </button>
            
            <div class="flex-1 min-w-0 px-3 flex flex-col items-center justify-center">
                <h2 class="font-bold text-sm tracking-tight truncate w-full text-center">{doc?.title || 'Document'}</h2>
                {#if returnToPosition}
                    <button type="button" class="badge badge-primary badge-sm font-bold shadow-sm mt-1 animate-fade-in hover:scale-105 cursor-pointer border-none" on:click|stopPropagation={resumeReading}>
                        <i class="bi bi-arrow-return-left mr-1"></i> {returnToLabel}
                    </button>
                {/if}
            </div>
            
            <div class="flex items-center gap-1">
			{#if docType === 'iframe' || docType === 'pdf-inline'}
				<a href={activeDocUrl} target="_blank" rel="noopener noreferrer" download={doc?.path?.toLowerCase().endsWith('.pdf') ? doc.title || 'document.pdf' : undefined} class="btn btn-circle btn-sm btn-ghost bg-base-100/50 hover:bg-base-100 text-base-content shadow-sm mr-1" title={doc?.path?.toLowerCase().endsWith('.pdf') ? "Download" : "Open Natively"}>
                    <i class="bi bi-box-arrow-up-right text-lg"></i>
                </a>
            {/if}

			{#if docType === 'iframe' || docType === 'markdown' || docType === 'pdf-inline'}
                <button class="btn btn-circle btn-sm btn-ghost" on:click={() => { invertIframe = !invertIframe; localStorage.setItem(`troves_invert_${$page.data.user?.id}_${doc?.id}`, String(invertIframe)); }} title="Toggle Appearance">
                    <i class="bi {invertIframe ? 'bi-sun-fill text-warning' : 'bi-moon-fill'} text-lg"></i>
                </button>
            {:else if docType === 'epub'}
                <button class="btn btn-circle btn-sm btn-ghost" on:click={bookmarkCurrentPage} title="Bookmark Page">
                    <i class="bi bi-bookmark-plus text-lg"></i>
                </button>
                <button class="btn btn-circle btn-sm btn-ghost {showSettings ? 'bg-primary/20 text-primary' : ''}" on:click={() => {showSettings = !showSettings; showToc = false;}} aria-label="Appearance">
                    <span class="font-serif font-bold text-lg leading-none">Aa</span>
                </button>
                <button class="btn btn-circle btn-sm btn-ghost {showToc ? 'bg-primary/20 text-primary' : ''}" on:click={() => {showToc = !showToc; showSettings = false;}} aria-label="Table of Contents">
                    <i class="bi bi-list"></i>
                </button>
            {/if}
                <button class="hidden md:inline-flex btn btn-circle btn-sm btn-ghost" on:click={toggleMaximize} title={isMaximized ? "Restore Size" : "Maximize"}>
                    <i class="bi {isMaximized ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'} text-lg"></i>
                </button>
            </div>
        </div>

        <!-- === READER CANVAS === -->
        <!-- Floating Page Layout: Constrains height on Desktop, fills screen on mobile -->
        <div class="flex-1 w-full h-full flex items-center justify-center pt-[10vh] pb-[10vh] md:py-8 px-0 md:px-4 relative z-10">
            <div class="w-full h-full {isMaximized ? 'max-w-none' : 'max-w-2xl md:max-h-[800px]'} relative bg-base-100 md:rounded-3xl md:shadow-2xl md:border md:border-base-300 overflow-hidden transition-all duration-300">
                
                {#if loading}
                    <div class="absolute inset-0 flex items-center justify-center z-10" transition:fade>
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                {/if}
                
				{#if docType === 'pdf-mobile'}
					<div class="w-full h-full flex flex-col items-center justify-center p-6 text-center z-10 bg-base-200/50">
						<i class="bi bi-file-earmark-pdf text-6xl text-error mb-4"></i>
						<h3 class="font-bold text-lg mb-2">{doc?.title || 'PDF Document'}</h3>
						{#if isLargeDocument}
							<p class="text-warning text-sm font-semibold mb-2"><i class="bi bi-exclamation-triangle"></i> Large File ({docSizeStr})</p>
							<p class="text-xs text-base-content/60 mb-6 max-w-xs">This file is quite large. Opening it directly in the app might cause instability or lag on your device.</p>
						{:else}
							<p class="text-sm text-base-content/60 mb-6 max-w-xs">PDF viewing is optimized for native apps on your device.</p>
						{/if}
						<div class="flex gap-3">
							<a class="btn btn-primary shadow-lg rounded-xl flex items-center gap-2" href={doc?.path || doc?.source} download>
								<i class="bi bi-download text-lg"></i> Download
							</a>
							<a class="btn btn-outline border-base-300 bg-base-100 shadow-sm rounded-xl flex items-center gap-2" href={activeDocUrl} target="_blank" rel="noopener noreferrer">
								<i class="bi bi-box-arrow-up-right text-lg"></i> Open
							</a>
						</div>
					</div>
				{:else if docType === 'epub'}
                    <GestureShield 
                        active={!showToc && !showSettings && !pendingHighlight} 
                        on:swipeLeft={nextPage}
                        on:swipeRight={prevPage}
                        on:tapLeft={prevPage}
                        on:tapRight={nextPage}
                        on:tapCenter={toggleMenu}
                    />
                    <div 
                        bind:this={viewerRef} 
                        class="w-full h-full epub-viewer transition-opacity duration-75 ease-out"
                        style="opacity: {isTurningPage ? 0 : 1};"
                    ></div>
                {:else if docType === 'iframe'}
                    <iframe 
                        bind:this={iframeRef}
                        src={activeDocUrl} 
                        class="w-full h-full border-none transition-all duration-300 relative z-10"
                        style="background-color: white; filter: {invertIframe ? 'invert(1) hue-rotate(180deg)' : 'none'};"
                        on:load={handleIframeLoad}
                        title="Document Viewer"
                    ></iframe>
				{:else if docType === 'pdf-inline'}
					<div class="w-full h-full relative z-10">
						<PdfViewer url={activeDocUrl} invert={invertIframe} saveKey={`troves_pdf_page_${$page.data.user?.id}_${doc.id || doc.path}`} />
					</div>
                {:else if docType === 'markdown'}
                    <div bind:this={markdownContainerRef} class="w-full h-full overflow-y-auto p-6 sm:p-10 relative z-10 bg-base-100 text-base-content transition-all duration-300"
                         style={invertIframe ? "filter: invert(1) hue-rotate(180deg);" : ""}
                         on:click={(e) => { if((e.target as HTMLElement).tagName !== 'A') toggleMenu(); }} role="presentation"
                         on:scroll={() => {
                             if (!markdownContainerRef || returnToPosition) return;
                             clearTimeout(mdScrollTimeout);
                             mdScrollTimeout = setTimeout(() => {
                                 localStorage.setItem(`troves_scroll_y_${$page.data.user?.id}_${doc.id || doc.path}`, markdownContainerRef.scrollTop.toString());
                             }, 150);
                         }}>
                        <div class="prose prose-sm sm:prose-base max-w-none prose-p:text-base-content prose-headings:text-base-content prose-strong:text-base-content prose-a:text-primary prose-li:text-base-content">
                            {@html markdownContentHtml}
                        </div>
                    </div>
                {/if}
            </div>
        </div>
        
        <!-- === BOTTOM CHROME (Progress) === -->
        {#if docType === 'epub'}
        <div 
            class="absolute bottom-4 inset-x-4 {isMaximized ? 'max-w-none' : 'max-w-2xl'} mx-auto flex flex-col justify-center items-center bg-base-200/95 backdrop-blur-xl border border-base-300 shadow-xl rounded-2xl p-4 z-50 transition-all duration-300"
            class:opacity-0={!showMenu && !showToc && !showSettings}
            class:translate-y-4={!showMenu && !showToc && !showSettings}
            class:pointer-events-none={!showMenu && !showToc && !showSettings}
        >
            <div class="w-full flex justify-between text-xs font-semibold text-gray-500 mb-2 px-1">
                <span class="truncate max-w-[70%]">{currentChapter || 'Reading...'}</span>
                <span>{progress}%</span>
            </div>
            <input type="range" min="0" max="100" value={progress} on:change={handleScrub} class="range range-primary range-xs w-full" disabled={!locationsGenerated} />
        </div>
        {/if}
        
        <!-- === TABLE OF CONTENTS DRAWER === -->
        {#if showToc}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="absolute inset-0 bg-base-100/60 backdrop-blur-sm z-[60]" on:click={() => showToc = false} transition:fade={{duration: 200}}></div>
            <div class="absolute top-20 right-4 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] bg-base-100 border border-base-300 shadow-2xl rounded-2xl overflow-hidden z-[70] flex flex-col" transition:fly={{ y: -20, duration: 200 }}>
                <div class="p-4 border-b border-base-200 font-bold tracking-tight bg-base-200/50">Chapters</div>
                <div class="overflow-y-auto flex-1 p-2">
                    {#if toc.length === 0}
                        <div class="p-4 text-center text-sm text-gray-500 italic">No chapters found.</div>
                    {:else}
                        {#each toc as chapter}
                            <button 
                                class="w-full text-left p-3 text-sm hover:bg-primary/10 hover:text-primary rounded-xl transition-colors truncate"
                                style="padding-left: {1 + chapter.level * 1}rem;"
                                class:text-primary={currentChapter === chapter.label.trim()}
                                class:font-bold={currentChapter === chapter.label.trim()}
                                on:click={() => goToChapter(chapter.href)}
                            >
                                {chapter.label.trim()}
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
        {/if}
        
        <!-- === APPEARANCE DRAWER === -->
        {#if showSettings}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="absolute inset-0 bg-base-100/60 backdrop-blur-sm z-[60]" on:click={() => showSettings = false} transition:fade={{duration: 200}}></div>
            <div class="absolute top-20 right-4 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-base-100 border border-base-300 shadow-2xl rounded-2xl z-[70] flex flex-col p-4 gap-6 hide-scrollbar" transition:fly={{ y: -20, duration: 200 }}>
                
                <div class="flex flex-col gap-2">
                    <div class="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">Font Size</div>
                    <div class="flex items-center gap-3 bg-base-200 p-2 rounded-xl">
                        <button class="btn btn-circle btn-sm btn-ghost" aria-label="Decrease Font Size" on:click={() => changeFontSize(-10)}><i class="bi bi-dash text-lg"></i></button>
                        <div class="flex-1 text-center font-mono font-bold text-sm">{fontSize}%</div>
                        <button class="btn btn-circle btn-sm btn-ghost" aria-label="Increase Font Size" on:click={() => changeFontSize(10)}><i class="bi bi-plus text-lg"></i></button>
                    </div>
                </div>
                
                <div class="flex flex-col gap-2">
                    <div class="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">Typography</div>
                    <div class="grid grid-cols-2 gap-2">
                        <button class="btn border-base-300 bg-base-200 font-sans normal-case text-base {fontFamily.includes('sans-serif') ? 'border-primary text-primary bg-primary/10' : ''}" on:click={() => changeFontFamily('system-ui, -apple-system, sans-serif')}>Sans-Serif</button>
                        <button class="btn border-base-300 bg-base-200 font-serif normal-case text-base {fontFamily.includes('Georgia') ? 'border-primary text-primary bg-primary/10' : ''}" on:click={() => changeFontFamily('Georgia, serif')}>Serif</button>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">Spacing</div>
                    <div class="grid grid-cols-3 gap-2">
                        <button class="btn border-base-300 bg-base-200 {lineHeight === 1.2 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Line Height 1.2" on:click={() => changeLineHeight(1.2)}><i class="bi bi-list text-lg"></i></button>
                        <button class="btn border-base-300 bg-base-200 {lineHeight === 1.6 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Line Height 1.6" on:click={() => changeLineHeight(1.6)}><i class="bi bi-distribute-vertical text-lg"></i></button>
                        <button class="btn border-base-300 bg-base-200 {lineHeight === 2.0 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Line Height 2.0" on:click={() => changeLineHeight(2.0)}><i class="bi bi-arrows-expand text-lg"></i></button>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">Margins</div>
                    <div class="grid grid-cols-3 gap-2">
                        <button class="btn border-base-300 bg-base-200 {pageMargin === 4 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Margin 4" on:click={() => changeMargin(4)}><i class="bi bi-arrows-collapse text-lg"></i></button>
                        <button class="btn border-base-300 bg-base-200 {pageMargin === 16 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Margin 16" on:click={() => changeMargin(16)}><i class="bi bi-distribute-horizontal text-lg"></i></button>
                        <button class="btn border-base-300 bg-base-200 {pageMargin === 32 ? 'border-primary text-primary bg-primary/10' : ''}" aria-label="Margin 32" on:click={() => changeMargin(32)}><i class="bi bi-arrows-expand text-lg" style="transform: rotate(90deg)"></i></button>
                    </div>
                </div>

            </div>
        {/if}

    </div>

<dialog bind:this={highlightModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close={() => pendingHighlight = null}>
    <div class="modal-box p-6 sm:rounded-3xl bg-base-100 shadow-2xl border border-base-200">
        <h3 class="font-bold text-xl mb-4 flex items-center gap-2">
            <i class="bi {pendingHighlight?.text ? 'bi-quote' : 'bi-bookmark'} text-primary"></i> {pendingHighlight?.text ? 'Save Highlight' : 'Save Bookmark'}
        </h3>
        {#if pendingHighlight?.text}
            <blockquote class="border-l-4 border-primary pl-4 text-sm italic text-base-content/80 mb-4 max-h-32 overflow-y-auto">
                "{pendingHighlight.text}"
            </blockquote>
        {:else}
            <div class="bg-base-200 p-4 rounded-xl mb-4 font-medium text-sm flex items-center gap-3">
                <i class="bi bi-pin-map text-primary text-xl"></i> {currentChapter || 'Current Page'}
            </div>
        {/if}
        <p class="text-xs text-gray-500 mb-6 bg-base-200/50 p-3 rounded-xl border border-base-200">
            <i class="bi bi-info-circle mr-1"></i> This and the surrounding pages will be saved to your Notebook. 
            This allows you to search for the context later and jump back exactly to this spot.
        </p>
        <div class="modal-action mt-0 flex gap-2">
            <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={() => highlightModal.close()} disabled={isSavingHighlight}>Cancel</button>
            <button type="button" class="btn btn-primary flex-1 rounded-xl shadow-md" on:click={confirmHighlight} disabled={isSavingHighlight}>
                {#if isSavingHighlight}
                    <span class="loading loading-spinner loading-sm"></span> Saving...
                {:else}
                    Save to Notebook
                {/if}
            </button>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button disabled={isSavingHighlight}>close</button></form>
</dialog>
{/if}

<style>
    /* Instantly neutralize epub.js default white iframes before hooks run */
    :global(.epub-viewer iframe) {
        background-color: transparent !important;
    }
</style>
