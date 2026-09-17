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

Restart Troves (or Docker container (`docker compose restart app`)), and the plugin 
will automatically pick up the key, attach it to the request, and successfully pull 
your book data.
*/
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, fetch, db, env }) {
    // Core enrichment function shared by both automatic and manual triggers
    async function lookupAndEnrichBook(item) {
        if (!item.title) {
            sysLog.warn(`[GoogleBooks] Item ${item.id} has no title to search for.`);
            return;
        }

        sysLog.info(`[GoogleBooks] Searching for: ${item.title}`);

        // Automatically use an API key if defined in your .env file
        const apiKey = env.GOOGLE_BOOKS_API_KEY;
        const keyParam = apiKey ? `&key=${apiKey}` : '';
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(item.title)}&maxResults=1${keyParam}`;

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

            if (res.status === 429) {
                sysLog.error(`[GoogleBooks] Too Many Requests (429). You MUST add GOOGLE_BOOKS_API_KEY to your .env file.`);
                return;
            }
            throw new Error(`Google Books API failed: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        if (!data.items || data.items.length === 0) {
            sysLog.info(`[GoogleBooks] No results found for ${item.title}`);
            return;
        }

        const book = data.items[0].volumeInfo;
        const updates = {};
        if (book.title && book.title !== item.title) updates.title = book.title;
        if (book.description && (!item.description || item.description.trim() === '')) updates.description = book.description;

        if (Object.keys(updates).length > 0) {
            await db.item.update({
                where: { id: item.id },
                data: updates
            });
        }

        // Extract and append KVP attributes
        const attributesToAdd = [];
        if (book.authors) attributesToAdd.push({ key: 'Author', value: book.authors.join(', ') });
        if (book.publisher) attributesToAdd.push({ key: 'Publisher', value: book.publisher });
        if (book.publishedDate) attributesToAdd.push({ key: 'Published Date', value: book.publishedDate });
        if (book.pageCount) attributesToAdd.push({ key: 'Page Count', value: String(book.pageCount) });
        if (book.industryIdentifiers) {
            const isbn13 = book.industryIdentifiers.find(i => i.type === 'ISBN_13');
            if (isbn13) attributesToAdd.push({ key: 'ISBN', value: isbn13.identifier });
        }

        for (const attr of attributesToAdd) {
            const exists = await db.kVP.findFirst({ where: { itemId: item.id, key: attr.key } });
            if (!exists) {
                await db.kVP.create({ data: { itemId: item.id, key: attr.key, value: attr.value, isAutoGenerated: true } });
            }
        }

        // Physically Download High-Res Cover Art
        if (book.imageLinks?.thumbnail) {
            // Trick Google into giving us a larger, uncurled image instead of the tiny default thumbnail
            const imageUrl = book.imageLinks.thumbnail
                .replace('http:', 'https:')
                .replace('&edge=curl', '')
                .replace('zoom=1', 'zoom=3'); 
                
            // Check if we already downloaded a cover for this item
            const coverExists = await db.photo.findFirst({ 
                where: { itemId: item.id, orgPath: { contains: 'google-cover' } } 
            });
            
            if (!coverExists) {
                try {
                    sysLog.info(`[GoogleBooks] Downloading cover art...`);
                    const imgRes = await fetch(imageUrl);
                    if (imgRes.ok) {
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        const filename = `google-cover-${item.id}-${Date.now()}.jpg`;
                        const localPath = path.join(process.cwd(), 'data/images/u', filename);
                        
                        // 1. Save physically to disk
                        fs.writeFileSync(localPath, buffer);

                        // 2. Attach as a native photo, and set isPrimary: true so it jumps to the front of the line
                        await db.photo.create({
                            data: {
                                itemId: item.id,
                                type: 'product',
                                orgPath: `/images/u/${filename}`,
                                isPrimary: true
                            }
                        });
                    }
                } catch (e) {
                    sysLog.error(`[GoogleBooks] Failed to download cover art:`, e);
                }
            }
        }

        sysLog.info(`[GoogleBooks] Successfully enriched ${item.title}!`);
    }

    // 1. Automatic Post-Processing Trigger
    on(
        'onItemProcessed',
        async (payload) => {
            if (payload.intent?.isNew) {
                await lookupAndEnrichBook(payload.entity);
            }
        },
        { maxRetries: 3, retryDelayMs: 3000, rateLimitRpm: 50 }
    );

    // 2. Manual UI Action Trigger
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