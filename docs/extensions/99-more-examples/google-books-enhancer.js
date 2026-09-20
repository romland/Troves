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

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
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
            await itemOps.setAttribute(item.id, attr.key, attr.value);
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
                            sysLog.warn(`[GoogleBooks] Google cover too small (${buffer.length} bytes) from ${imgRes.url}. Likely a placeholder. Discarding.`);
                            if (logActivity) await logActivity(item.id, 'Google Books Cover', `Discarded Google cover from ${imgRes.url} as it appeared to be a placeholder image (${buffer.length} bytes).`, 'warning');
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