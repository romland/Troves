# Plugin Cookbook & Examples

This section contains real-world examples of plugins to demonstrate how to leverage the Troves Extension Engine. You can copy these files directly into your `data/plugins/` directory and modify them to suit your needs.

---

## 1. Custom Thermal Label Printer (Label Studio)

**Suggested Filename:** `data/plugins/label-studio.js`

**The Goal:** Automatically print physical thermal labels (containing QR codes and container names) when creating new storage boxes in Troves.

**How it works:**
- It listens to the automatic `onContainerCreated` event and the manual `onPrintLabelRequested` event.
- It intercepts the `intent` payload to determine if the user actually wanted to print a label (`intent.printLabel`), and whether they wanted the `small` or `large` format.
- It safely reads the printer's local IP and API key from the `.env` file.
- It executes sequentially in the background `ioQueue`, ensuring the Troves UI never freezes while waiting for the printer to spool.

```javascript
/**
 * This plugin depend on two .env keys:
 *      EXT_PRINTER_URL="http://192.168.178.194:8080"
 *      EXT_PRINTER_API_KEY="xxx"
 * 
 * ...but is other than that completely stand-alone. Just dump it in Troves' data/plugins/
 */
export default function register({ on, sysLog, fetch, env }) {
    async function printContainerLabel(entity, size) {
        const apiUrl = env.EXT_PRINTER_URL;
        const token = env.EXT_PRINTER_API_KEY;
        
        if (!apiUrl || !token) {
            sysLog.warn("Label Studio plugin skipped: EXT_PRINTER_URL or EXT_PRINTER_API_KEY is missing from .env");
            return;
        }
        
        try {
            // Generate QR Code
            const qrRes = await fetch(`${apiUrl}/api/barcode`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 'qr', data: entity.name })
            });
            
            if (!qrRes.ok) throw new Error(`Barcode generation failed: ${qrRes.statusText}`);
            const qrData = await qrRes.json();
            
            // Build Render Engine Layout
            const items = [{ type: 'image', data: qrData.image }];
            
            if (size === 'large') {
                items.push({
                    type: 'text',
                    content: entity.name,
                    size: 80,
                    align: 'center'
                });
            }
            
            // Dispatch to Label Studio Queue
            const printRes = await fetch(`${apiUrl}/api/v1/print`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ items, auto_length: true })
            });
            
            if (!printRes.ok) throw new Error(`Print queue rejected: ${printRes.statusText}`);
            sysLog.info(`[Label Studio Plugin] Successfully queued print job for container: ${entity.name}`);
            
        } catch (error) {
            sysLog.error(`[Label Studio Plugin] Printer extension failed:`, error);
        }
    }
    
    on('onContainerCreated', async (payload) => {
        if (payload.intent.printLabel) {
            await printContainerLabel(payload.entity, payload.intent.labelSize || 'large');
        }
    });
    
    on('onPrintLabelRequested', async (payload) => {
        await printContainerLabel(payload.entity, payload.intent.labelSize || 'large');
    });
}
```

## 3. Manual Fetcher (UI Action & Database Access)

**Suggested Filename:** `data/plugins/fetch-manual.js`

**The Goal:** Adds a button to the "..." menu of an item. When clicked, it searches an external API for the item's title and attaches a PDF link directly to the Troves database as a Document.

```javascript
export default function register({ registerItemAction, sysLog, fetch, db }) {
    
    // Register a button that the frontend will render
    registerItemAction(
        { 
            id: 'fetch-user-manual', 
            label: 'Fetch User Manual', 
            icon: 'bi-journal-text' 
        }, 
        async (payload) => {
            const item = payload.entity;
            
            if (!item.title) {
                sysLog.warn(`[FetchManual] Item ${item.id} has no title to search for.`);
                return;
            }

            sysLog.info(`[FetchManual] Searching manuals for: ${item.title}`);

            // Example API call
            const res = await fetch(`https://api.example.com/manuals?q=${encodeURIComponent(item.title)}`);
            
            // Do NOT try/catch this! Throwing the error allows the Troves Queue 
            // to properly mark the task as "Failed" in the System Activity UI.
            if (!res.ok) throw new Error(`API failed: ${res.statusText}`);

            const data = await res.json();

            if (data.manualUrl) {
                // Use the injected Prisma instance to save the document!
                await db.document.create({
                    data: {
                        title: `${item.title} - User Manual`,
                        source: new URL(data.manualUrl).hostname,
                        path: data.manualUrl, // Direct link to PDF
                        extracts: "Automatically fetched via plugin",
                        itemId: item.id
                    }
                });
                sysLog.info(`[FetchManual] Successfully attached manual to ${item.title}`);
            } else {
                sysLog.info(`[FetchManual] No manual found for ${item.title}`);
            }
        }
    );
}
```

## 4. Client-Side URL Link (Google Search)

**Suggested Filename:** `data/plugins/google-search.js`

**The Goal:** Add a button to the item menu that opens a new browser tab to search for the item's title.

**How it works:**
- By providing a `urlTemplate` instead of an asynchronous backend handler function, Troves knows to render this as a standard `<a target="_blank">` HTML link rather than a background queue job.
- The Svelte UI automatically replaces `{{title}}` in the template with the URL-encoded title of the current item.

```javascript
export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'google-search',
        label: 'Search on Google',
        icon: 'bi-google',
        urlTemplate: 'https://www.google.com/search?q={{title}}'
    });
}
```

--- a/docs/extensions/04-examples.md
++ b/docs/extensions/04-examples.md
@@ -134,3 +134,84 @@
     });
 }

## 5. Fetch Metadata & Update Entity (Google Books API)

**Suggested Filename:** `data/plugins/google-books.js`

**The Goal:** Query the Google Books API for an item, update its title and description, add attributes (Author, Publisher, Pages, ISBN), and fetch the cover art.

**How it works:**
- It leverages the built-in `rateLimitRpm` to strictly stay under typical 60 requests/min free limits.
- It uses `maxRetries` to automatically recover from temporary API timeouts in the background queue.
- It reads from and writes directly to the Troves database using the injected `db` Prisma client.

```javascript
/*
You might need Google Books API key for this!

Google allows *some* unauthenticated requests to the Books API for browsers.
But essentially, it seems very low. It requires an API key to track your usage.

But I swear, the absolutely hardest part about this and anything Google is to
navigate their effing Cloud panel. It's funny how they can make you feel so 
goddamn stupid.

# How to get a free Google Books API Key
It takes about 60 seconds and doesn't require a credit card:
1. Go to: https://console.cloud.google.com/apis/library/books.googleapis.com
    - If you don't have a project yet, it will pop up a window forcing you to create 
      one (just call it "Troves"). Once the page loads, just click the blue Enable 
      button.
2. Create the Key
    - Click this direct link: Google Cloud Credentials Page
      Click + CREATE CREDENTIALS at the top.
      Select API Key.
      Select "Books API"
      Copy the string it gives you.
3. Finally, open your Troves `.env` file and add:
    GOOGLE_BOOKS_API_KEY="AIzaSyYourGeneratedKeyHere..."

Because you added a new \`.env\` key, you must restart Troves (\`docker compose restart app\`). 
If you are only editing the plugin code itself, you can just use the "Hot Reload Plugins" button in the Admin interface!
*/
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env }) {
    async function lookupAndEnrichBook(baseItem) {
        // Fetch the fully hydrated item to ensure we have all attributes
        const item = await db.item.findUnique({
            where: { id: baseItem.id },
            include: { attributes: true, photos: true }
        });

        if (!item || !item.title) {
            sysLog.warn(`[GoogleBooks] Item ${baseItem?.id} has no title to search for.`);
            return;
        }

        const safeTitle = item.title.replace(/"/g, '').trim();
        const additionalTerms = [];

        // If description is short, it was likely captured as an author/subtitle during rapid intake
        if (item.description && item.description.length < 150) {
            additionalTerms.push(item.description);
        }

        // Broaden the net: match any attribute key containing relevant terms
        const fuzzyKeyTargets = ['author', 'subtitle', 'writer', 'creator', 'by', 'brand', 'maker', 'artist', 'publisher'];
        if (item.attributes && item.attributes.length > 0) {
            const relevantAttrs = item.attributes.filter(a => {
                const lowerKey = a.key.toLowerCase();
                return fuzzyKeyTargets.some(target => lowerKey.includes(target));
            });
            relevantAttrs.forEach(a => additionalTerms.push(a.value));
        }

        const extraStr = [...new Set(additionalTerms)].join(' ').trim();
        const apiKey = env.GOOGLE_BOOKS_API_KEY;
        const keyParam = apiKey ? `&key=${apiKey}` : '';

        // Internal helper to perform a query pass with full debug activity logging
        const executeSearchPass = async (query) => {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5${keyParam}`;

            if (logActivity) {
                const sanitizedUrl = url.replace(/key=[^&]+/, 'key=***');
                await logActivity(
                    item.id,
                    'Google Books Query',
                    `Querying Google Books API for "${query}"`,
                    'info',
                    JSON.stringify({ 
                        query, 
                        url: sanitizedUrl,
                        debug_InitialState: {
                            title: item.title,
                            description: item.description,
                            allAttributes: item.attributes ? item.attributes.map(a => `${a.key}: ${a.value}`) : []
                        }
                    }, null, 2)
                );
            }

            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Troves-Inventory-Agent/1.0',
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}

                sysLog.error(`[GoogleBooks] API rejected request. Status: ${res.status} ${res.statusText}. Body: ${errorBody}`);

                if (logActivity) {
                    await logActivity(
                        item.id,
                        'Google Books Error',
                        `API request failed (${res.status} ${res.statusText})`,
                        'error',
                        errorBody
                    );
                }

                if (res.status === 429) {
                    sysLog.error(`[GoogleBooks] Too Many Requests (429). You MUST add GOOGLE_BOOKS_API_KEY to your .env file.`);
                    return { status: 429, data: null };
                }
                throw new Error(`Google Books API failed: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            return { status: 200, data };
        };

        // --- LOCAL FILTERING LOGIC ---
        // Google's API ranking is unpredictable. We fetch 5 results and find the best actual match locally.
        const getWords = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !['the', 'and', 'for', 'with', 'vol', 'of'].includes(w));
        const origTitleWords = getWords(safeTitle);
        const requiredTitleMatches = Math.max(1, Math.floor(origTitleWords.length * 0.5));
        const rejectTerms = ['analysis', 'summary', 'study guide', 'bibliography', 'biography', 'trivia'];

        const findBestBook = (items) => {
            if (!items) return null;
            for (const item of items) {
                const book = item.volumeInfo;
                if (!book.title || !book.authors || book.authors.length === 0) continue;

                // Reject analyses unless the original scan actually had that word
                const lowerTitle = book.title.toLowerCase();
                if (rejectTerms.some(t => lowerTitle.includes(t)) && !rejectTerms.some(t => safeTitle.toLowerCase().includes(t))) {
                    continue;
                }

                // Title overlap check
                const bookTitleWords = getWords(book.title);
                const titleOverlap = origTitleWords.reduce((count, w) => count + (bookTitleWords.includes(w) ? 1 : 0), 0);

                if (titleOverlap >= requiredTitleMatches || origTitleWords.length === 0) {
                    return book;
                }
            }
            return null;
        };

        // --- TWO PASS SEARCH STRATEGY ---
        let bestBook = null;
        let queryUsed = "";
        
        // Pass 1: Strict Title Match
        const pass1Query = `intitle:"${safeTitle}" ${extraStr}`.trim();
        sysLog.info(`[GoogleBooks] Pass 1 (Strict): ${pass1Query}`);
        let passResult = await executeSearchPass(pass1Query);

        if (passResult.status === 429) return;

        bestBook = findBestBook(passResult.data?.items);
        queryUsed = pass1Query;

        if (!bestBook) {
            // Pass 2: Loose Fallback Match
            const pass2Query = `${safeTitle} ${extraStr}`.trim();
            sysLog.info(`[GoogleBooks] Pass 2 (Loose Fallback): ${pass2Query}`);
            passResult = await executeSearchPass(pass2Query);
            
            if (passResult.status === 429) return;
            bestBook = findBestBook(passResult.data?.items);
            queryUsed = pass2Query;
        }

        if (logActivity) {
            await logActivity(
                item.id,
                'Google Books Response',
                bestBook ? `Found valid volume: "${bestBook.title}"` : `No clean matches found for "${queryUsed}"`,
                bestBook ? 'success' : 'warning',
                JSON.stringify({ queryUsed, match: bestBook || "None" }, null, 2)
            );
        }

        if (!bestBook) {
            sysLog.warn(`[GoogleBooks] Discarding all results: No items matched our strict criteria.`);
            return;
        }

        const book = bestBook;

        const updates = {};

        if (book.title && book.title !== item.title) updates.title = book.title;

        // Only overwrite description if empty or previously filled with a short author string
        if (book.description && (!item.description || item.description.trim() === '' || item.description.length < 150)) {
            updates.description = book.description;
        }

        if (Object.keys(updates).length > 0) {
            await db.item.update({
                where: { id: item.id },
                data: updates
            });
            
            if (logActivity) {
                await logActivity(item.id, 'Google Books Overwrite', 'Updated item fields automatically. You can revert this in Version History if incorrect.', 'success');
            }
        }

        // Extract and append KVP attributes
        const attributesToAdd = [];
        if (book.authors) attributesToAdd.push({ key: 'Author', value: book.authors.join(', ') });
        if (book.publisher) attributesToAdd.push({ key: 'Publisher', value: book.publisher });
        if (book.publishedDate) attributesToAdd.push({ key: 'Published Date', value: book.publishedDate });
        if (book.pageCount) attributesToAdd.push({ key: 'Page Count', value: String(book.pageCount) });
        
        let isbnValue = null;
        if (book.industryIdentifiers) {
            const isbn13 = book.industryIdentifiers.find(i => i.type === 'ISBN_13' || i.type === 'ISBN_10');
            if (isbn13) {
                isbnValue = isbn13.identifier;
                attributesToAdd.push({ key: 'ISBN', value: isbnValue });
            }
        }

        for (const attr of attributesToAdd) {
            const exists = await db.kVP.findFirst({ where: { itemId: item.id, key: attr.key } });
            if (!exists) {
                await db.kVP.create({ data: { itemId: item.id, key: attr.key, value: attr.value, isAutoGenerated: true } });
            }
        }

        // Extract and apply Categories
        if (book.categories && book.categories.length > 0) {
            const catName = book.categories[0];
            let category = await db.category.findFirst({ where: { inventoryId: item.inventoryId, name: catName }});
            if (!category) {
                const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                category = await db.category.create({ data: { inventoryId: item.inventoryId, name: catName, slug }});
            }
            
            const primaryPhoto = item.photos?.find(p => p.isPrimary) || item.photos?.[0];
            if (primaryPhoto && !primaryPhoto.categoryId) {
                await db.photo.update({ where: { id: primaryPhoto.id }, data: { categoryId: category.id }});
            }
        }

        // --- Cover Art Download ---
        const coverExists = await db.photo.findFirst({ 
            where: { itemId: item.id, orgPath: { contains: '-cover-' } } 
        });

        if (!coverExists) {
            let coverBuffer = null;
            let coverSource = 'google';

            if (book.imageLinks?.thumbnail) {
                const baseImageUrl = book.imageLinks.thumbnail.replace('http:', 'https:');
                try {
                    sysLog.info(`[GoogleBooks] Downloading cover art from Google...`);
                    
                    // Try high-resolution image first
                    const highResUrl = baseImageUrl.replace('&edge=curl', '').replace('zoom=1', 'zoom=3'); 
                    let imgRes = await fetch(highResUrl);

                    if (!imgRes.ok) {
                        imgRes = await fetch(baseImageUrl);
                    }

                    if (imgRes.ok) {
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        
                        // Google Books placeholders are mostly solid grey. A real zoom=3 cover is 40KB+. 
                        // The scaled-up zoom=3 placeholder is typically ~12KB. 
                        const isHighRes = imgRes.url.includes('zoom=3');
                        const threshold = isHighRes ? 35000 : 4500;

                        if (buffer.length >= threshold) {
                            coverBuffer = buffer;
                        } else {
                            sysLog.warn(`[GoogleBooks] Google cover too small (${buffer.length}b). Likely a placeholder. Discarding.`);
                            if (logActivity) await logActivity(item.id, 'Google Books Cover', `Discarded Google cover as it appeared to be a placeholder image.`, 'warning');
                        }
                    } else {
                        sysLog.warn(`[GoogleBooks] Google returned ${imgRes.status} when fetching image.`);
                    }
                } catch (e) {
                    sysLog.error(`[GoogleBooks] Failed to download cover art:`, e);
                }
            }

            // Fallback to Open Library using ISBN
            if (!coverBuffer && isbnValue) {
                try {
                    sysLog.info(`[GoogleBooks] Attempting fallback to Open Library for ISBN ${isbnValue}...`);
                    // default=false ensures OpenLibrary returns a 404 instead of their own generic placeholder
                    const olUrl = `https://covers.openlibrary.org/b/isbn/${isbnValue}-L.jpg?default=false`;
                    const olRes = await fetch(olUrl);
                    
                    if (olRes.ok) {
                        const buffer = Buffer.from(await olRes.arrayBuffer());
                        if (buffer.length > 5000) {
                            coverBuffer = buffer;
                            coverSource = 'openlibrary';
                            sysLog.info(`[GoogleBooks] Successfully acquired fallback cover from Open Library.`);
                        }
                    }
                } catch (e) {
                    sysLog.error(`[GoogleBooks] Failed to fetch Open Library cover:`, e);
                }
            }

            if (coverBuffer) {
                const filename = `${coverSource}-cover-${item.id}-${Date.now()}.jpg`;
                const localPath = path.join(process.cwd(), 'data/images/u', filename);
                fs.writeFileSync(localPath, coverBuffer);

                await db.photo.create({
                    data: {
                        itemId: item.id,
                        type: 'product',
                        orgPath: `/images/u/${filename}`,
                        thumbPath: `/images/u/${filename}`,
                        cropPath: `/images/u/${filename}`,
                        ocr: "{}",
                        llmAnalysis: "{}",
                        isPrimary: true
                    }
                });
                sysLog.info(`[GoogleBooks] Cover art saved successfully.`);
                if (logActivity) await logActivity(item.id, 'Cover Art', `Downloaded and attached book cover from ${coverSource === 'google' ? 'Google Books' : 'Open Library'}.`, 'success');
            } else {
                sysLog.info(`[GoogleBooks] No cover art exists for this book in Google or Open Library.`);
            }
        }

        sysLog.info(`[GoogleBooks] Successfully enriched ${item.title}!`);
    }

    // 1. Automatic Post-Processing Trigger (Runs after background ML pipeline finishes on newly created items)
    on(
        'onItemProcessed',
        async (payload) => {
            if (payload.intent?.isNew) {
                await lookupAndEnrichBook(payload.entity);
            }
        },
        { maxRetries: 3, retryDelayMs: 3000, rateLimitRpm: 50 }
    );

    // 2. Manual UI Action Trigger (Available from item context menu anytime)
    registerItemAction(
        { 
            id: 'fetch-google-books', 
            label: 'Lookup on Google Books', 
            icon: 'bi-book',
            maxRetries: 3,
            retryDelayMs: 3000,
            rateLimitRpm: 50
        },
        async (payload) => {
            await lookupAndEnrichBook(payload.entity);
        }
    );
}
```

## 6. Fetch Metadata & Update Entity (Spotify API)

**Suggested Filename:** `data/plugins/fetch-spotify-info.js`

**The Goal:** Query the Spotify API for an item, update its title and description, add attributes, and fetch the cover art and add a song list.

**How it works:**
- It leverages the built-in `rateLimitRpm` to strictly stay under typical 60 requests/min free limits.
- It uses `maxRetries` to automatically recover from temporary API timeouts in the background queue.
- It reads from and writes directly to the Troves database using the injected `db` Prisma client.

```javascript
/**
 * ============================================================================
 * TROVES PLUGIN: SPOTIFY CD METADATA MATCHER
 * ============================================================================
 * 
 * ARCHITECTURAL PAUSE & API SUGGESTIONS:
 * You mentioned having a Spotify account and wanting to avoid paid services. 
 * Spotify is an excellent choice for rich metadata and high-quality cover art. 
 * I have implemented the full Spotify plugin below for you. 
 * 
 * However, since you are tracking physical CDs, please be aware:
 * 1. Spotify (Implemented Below): Great for general album info, track counts, 
 *    and cover art. Free via Developer API.
 * 2. Discogs (Alternative): The gold standard for physical CDs. It tracks 
 *    specific pressings, barcodes, matrix runouts, and physical media values. 
 *    It has a free API (requires generating a Personal Access Token).
 * 3. MusicBrainz (Alternative): Open-source, incredibly detailed physical 
 *    release groups. 100% free, no API key required, but rate-limited strictly.
 * 
 * If you ever want to switch to Discogs to track physical barcodes instead of 
 * digital releases, let me know and we can write a Discogs version!
 * 
 * ============================================================================
 * FEATURE BREAKDOWN
 * ============================================================================
 * 1. SMART METADATA SEARCH
 * When a CD is processed, the plugin takes the Troves `title` (and the `Artist` 
 * attribute if the ML found one) and queries Spotify. 
 * -> Gotcha: We deliberately avoid strict `album:xxx` API filters because OCR 
 *    titles from photos can be messy. A broad keyword search with `type=album` 
 *    is way more resilient.
 * 
 * 2. AUTOMATIC DATA ENRICHMENT
 * It pulls down the officially formatted Album Name, Artist, Release Year, and 
 * Track Count, and saves them as custom attributes (KVPs) in Troves. 
 * -> Gotcha: It checks if these exist first (Idempotency). You can mash the 
 *    manual "Fetch" button 10 times and it will never create duplicate data.
 * 
 * 3. FULL TRACKLIST EXTRACTION (THE TWO-HOP PULL)
 * Spotify's search endpoint only returns "Simplified Albums" (which lack tracklists). 
 * The plugin takes the winning Album ID, makes a *second* API call to get the 
 * full album, calculates track durations into readable text (e.g., "3:45"), and 
 * creates a Troves 'Document' (type: link) for every single song.
 * 
 * 4. NATIVE APP DEEP-LINKING
 * Instead of boring web URLs (`https://...`), it saves the tracks and album 
 * links using Spotify's native URI scheme (e.g., `spotify:track:12345`). 
 * -> Feature: Clicking a song in Troves tells your OS to instantly open the 
 *    desktop or mobile Spotify app directly to that specific track.
 * -> The Annoying Gotcha: Spotify permanently killed auto-play for URIs to stop 
 *    streaming fraud. The link opens the app right to the song, but a human 
 *    still has to manually click the green 'Play' button.
 * 
 * 5. HIGH-RES COVER ART
 * It finds the highest resolution cover art available, downloads the raw 
 * image buffer, saves it locally to your Troves disk (`data/images/u/`), and 
 * sets it as the primary photo (if the user didn't already set one).
 * 
 * 6. DUAL EXECUTION (AUTO & MANUAL)
 * -> Auto: Listens to `onItemProcessed` and runs quietly in the background 
 *    only for newly created items.
 * -> Manual: Injects a "Fetch Album & Tracks" button into the item UI.
 * Both are wrapped in Troves' built-in rate limiting (30 requests/min) and 
 * auto-retries to ensure we never get IP-banned by Spotify.
 *
 * ============================================================================
 * REQUIRED SETUP:
 * You must add the following keys to your Troves `.env` file:
 * 
 * SPOTIFY_CLIENT_ID="your_spotify_client_id"
 * SPOTIFY_CLIENT_SECRET="your_spotify_client_secret"
 * 
 * How to get them (Free):
 * 1. Go to https://developer.spotify.com/dashboard
 * 2. Log in with your standard Spotify account.
 * 3. Click "Create app". Name it "Troves", put "http://localhost" as Redirect URI.
 * 4. Once created, click "Settings" to view your Client ID and Client Secret.
 * 5. Add them to your `.env` file and restart your Troves Docker container.
 * ============================================================================
 */
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env }) {
    
    async function getSpotifyToken() {
        const clientId = env.SPOTIFY_CLIENT_ID;
        const clientSecret = env.SPOTIFY_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env");
        }

        const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Spotify Auth Failed: ${res.status} - ${errBody}`);
        }

        const data = await res.json();
        return data.access_token;
    }

    async function lookupAndEnrichCD(baseItem) {
        const item = await db.item.findUnique({
            where: { id: baseItem.id },
            include: { attributes: true, photos: true }
        });

        if (!item || !item.title) {
            sysLog.warn(`[SpotifyCD] Item ${baseItem?.id} has no title to search for.`);
            return;
        }

        const safeTitle = item.title.trim();
        sysLog.info(`[SpotifyCD] Starting enrichment for CD: "${safeTitle}"`);

        try {
            const token = await getSpotifyToken();

            let artistQuery = '';
            if (item.attributes) {
                const artistAttr = item.attributes.find(a => a.key.toLowerCase() === 'artist' || a.key.toLowerCase() === 'band');
                if (artistAttr) {
                    artistQuery = ` ${artistAttr.value}`;
                }
            }

            const searchQuery = `${safeTitle}${artistQuery}`.trim();
            const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=album&limit=3`;

            if (logActivity) {
                await logActivity(
                    item.id,
                    'Spotify Search Query',
                    `Querying Spotify API for "${searchQuery}"`,
                    'info',
                    JSON.stringify({ query: searchQuery, url: url }, null, 2)
                );
            }

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}
                sysLog.error(`[SpotifyCD] API rejected request. Status: ${res.status} ${res.statusText}. Body: ${errorBody}`);
                if (logActivity) await logActivity(item.id, 'Spotify Error', `API request failed (${res.status})`, 'error', errorBody);
                throw new Error(`Spotify Search Failed: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            const albums = data.albums?.items;

            if (!albums || albums.length === 0) {
                sysLog.warn(`[SpotifyCD] No albums found on Spotify for query: "${searchQuery}"`);
                if (logActivity) await logActivity(item.id, 'Spotify Response', `No matching albums found.`, 'warning');
                return;
            }

            const bestAlbum = albums[0];
            sysLog.info(`[SpotifyCD] Match found: ${bestAlbum.name}`);

            // Update core Item fields
            const updates = {};
            if (bestAlbum.name && bestAlbum.name !== item.title) {
                updates.title = bestAlbum.name;
            }

            if (Object.keys(updates).length > 0) {
                await db.item.update({ where: { id: item.id }, data: updates });
            }

            // Append KVP attributes
            const attributesToAdd = [];
            const albumArtistName = bestAlbum.artists.map(a => a.name).join(', ');
            if (albumArtistName) attributesToAdd.push({ key: 'Artist', value: albumArtistName });
            
            if (bestAlbum.release_date) {
                attributesToAdd.push({ key: 'Release Year', value: bestAlbum.release_date.split('-')[0] });
                attributesToAdd.push({ key: 'Release Date', value: bestAlbum.release_date });
            }
            if (bestAlbum.total_tracks) attributesToAdd.push({ key: 'Total Tracks', value: String(bestAlbum.total_tracks) });
            
            if (bestAlbum.uri) attributesToAdd.push({ key: 'Spotify Link', value: bestAlbum.uri });

            for (const attr of attributesToAdd) {
                const exists = await db.kVP.findFirst({ where: { itemId: item.id, key: attr.key } });
                if (!exists) {
                    await db.kVP.create({ data: { itemId: item.id, key: attr.key, value: attr.value, isAutoGenerated: true } });
                } else if (!exists.value) {
                    await db.kVP.update({ where: { id: exists.id }, data: { value: attr.value } });
                }
            }

            // Fetch FULL album to get tracklist
            sysLog.info(`[SpotifyCD] Fetching full tracklist for album ID: ${bestAlbum.id}`);
            const fullAlbumRes = await fetch(`https://api.spotify.com/v1/albums/${bestAlbum.id}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });

            if (fullAlbumRes.ok) {
                const fullAlbum = await fullAlbumRes.json();
                const tracks = fullAlbum.tracks?.items || [];
                
                if (tracks.length > 0) {
                    let tracksAdded = 0;
                    for (const track of tracks) {
                        const trackUri = track.uri; 
                        if (!trackUri) continue;

                        const existingTrack = await db.document.findFirst({
                            where: { itemId: item.id, path: trackUri }
                        });

                        if (!existingTrack) {
                            const min = Math.floor(track.duration_ms / 60000);
                            const sec = ((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0');
                            
                            const trackArtists = track.artists && track.artists.length > 0 
                                ? track.artists.map(a => a.name).join(', ') 
                                : albumArtistName;
                            
                            await db.document.create({
                                data: {
                                    type: 'link',
                                    title: `🎵 Track ${track.track_number}: ${track.name} - ${trackArtists}`,
                                    source: 'Spotify',
                                    path: trackUri,
                                    extracts: `Duration: ${min}:${sec}`,
                                    itemId: item.id
                                }
                            });
                            tracksAdded++;
                        }
                    }
                    if (tracksAdded > 0 && logActivity) {
                        await logActivity(item.id, 'Spotify Tracks', `Attached ${tracksAdded} tracks as native app links.`, 'success');
                    }
                }
            } else {
                sysLog.warn(`[SpotifyCD] Failed to fetch tracklist: ${fullAlbumRes.statusText}`);
            }

            // Download Cover Art
            const coverExists = await db.photo.findFirst({ 
                where: { itemId: item.id, orgPath: { contains: 'spotify-cover-' } } 
            });

            if (!coverExists && bestAlbum.images && bestAlbum.images.length > 0) {
                const largestImage = bestAlbum.images[0];
                try {
                    const imgRes = await fetch(largestImage.url);
                    if (imgRes.ok) {
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        const filename = `spotify-cover-${item.id}-${Date.now()}.jpg`;
                        const localPath = path.join(process.cwd(), 'data/images/u', filename);
                        fs.writeFileSync(localPath, buffer);

                        await db.photo.create({
                            data: {
                                itemId: item.id,
                                type: 'product',
                                orgPath: `/images/u/${filename}`,
                                thumbPath: `/images/u/${filename}`,
                                cropPath: `/images/u/${filename}`,
                                ocr: "{}",
                                llmAnalysis: "{}",
                                isPrimary: !item.photos?.some(p => p.isPrimary)
                            }
                        });
                        if (logActivity) await logActivity(item.id, 'Cover Art', 'Downloaded album cover from Spotify.', 'success');
                    }
                } catch (imgErr) {
                    sysLog.error(`[SpotifyCD] Failed to download cover art:`, imgErr);
                }
            }

        } catch (error) {
            sysLog.error(`[SpotifyCD] Unhandled error during CD enrichment:`, error);
            if (logActivity) await logActivity(item.id, 'Spotify Sync Failed', error.message, 'error');
            throw error; 
        }
    }

    on('onItemProcessed', async (payload) => {
        if (payload.intent?.isNew) {
            await lookupAndEnrichCD(payload.entity);
        }
    }, { maxRetries: 3, retryDelayMs: 5000, rateLimitRpm: 30 });

    registerItemAction({ 
        id: 'fetch-spotify-cd', 
        label: 'Fetch Album & Tracks from Spotify', 
        icon: 'bi-music-note-list',
        maxRetries: 2,
        retryDelayMs: 3000,
        rateLimitRpm: 30
    }, async (payload) => {
        await lookupAndEnrichCD(payload.entity);
    });
}
```