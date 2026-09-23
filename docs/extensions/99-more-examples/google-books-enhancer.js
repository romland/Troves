/**
 * @name Book Information Enhancer
 * @description Enriches books with cover, ISBN, plot, etc from Google Books 
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 * @archetype any
 * 
 * You might/will need Google Books API key for this!
 * 
 * Google allows *some* unauthenticated requests to the Books API for browsers.
 * But essentially, it seems very low. It requires an API key to track your usage.
 * 
 * But I swear, the absolutely hardest part about this and anything Google is to
 * navigate their effing Cloud panel. It's funny how they can make you feel so 
 * goddamn stupid.
 * 
 * How to get that free Google Books API Key
 * 
 * It takes about 60 seconds and doesn't require a credit card:
 * 1. Go to: https://console.cloud.google.com/apis/library/books.googleapis.com
 *     - If you don't have a project yet, it will pop up a window forcing you to create 
 *       one (just call it "Troves"). Once the page loads, just click the blue Enable 
 *       button.
 * 2. Create the Key
 *     - Click this direct link: Google Cloud Credentials Page
 *       Click + CREATE CREDENTIALS at the top.
 *       Select API Key.
 *       Select "Books API"
 *       Copy the string it gives you.
 * 3. Finally, open your Troves `.env` file and add:
 *     GOOGLE_BOOKS_API_KEY="AIzaSyYourGeneratedKeyHere..."
 * 
 * Because you added a new \`.env\` key, you must restart Troves (\`./troves restart\`). 
 * 
 * If you are only editing the plugin code itself, you can just use the "Hot Reload Plugins"
 * button in the Admin interface!
*/
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    async function lookupAndEnrichBook(baseItem) {
        const item = await db.item.findUnique({
            where: { id: baseItem.id },
            include: { attributes: true, photos: true }
        });

        if (!item || !item.title) {
            sysLog.warn(`[GoogleBooks] Item ${baseItem?.id} has no title to search for.`);
            return;
        }

        const safeTitle = item.title.replace(/"/g, '').trim();

        // --- TIER 1: HIGH PRECISION (Author & Subtitle Only) ---
        const author = itemOps.getFuzzyAttribute(item, ['author', 'writer', 'creator', 'by']);
        const subtitle = itemOps.getFuzzyAttribute(item, ['subtitle']);
        const preciseExtraStr = [author, subtitle].filter(Boolean).join(' ').trim();

        // --- TIER 2/3: THE KITCHEN SINK (Description & Broad Attributes) ---
        const broadTerms = [];
        if (item.description && item.description.length < 150) {
            broadTerms.push(item.description);
        }
        
        if (item.attributes && item.attributes.length > 0) {
            const fuzzyKeyTargets = ['author', 'subtitle', 'writer', 'creator', 'by', 'brand', 'maker', 'artist', 'publisher'];
            item.attributes.forEach(a => {
                if (fuzzyKeyTargets.some(target => a.key.toLowerCase().includes(target))) {
                    broadTerms.push(a.value);
                }
            });
        }
        const broadExtraStr = [...new Set(broadTerms)].join(' ').trim();

        const apiKey = env.GOOGLE_BOOKS_API_KEY;
        const keyParam = apiKey ? `&key=${apiKey}` : '';

        const executeSearchPass = async (query) => {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5${keyParam}`;

            if (logActivity) {
                const sanitizedUrl = url.replace(/key=[^&]+/, 'key=***');
                await logActivity(
                    item.id,
                    'Google Books Query',
                    `Querying API for "${query}"`,
                    'info',
                    JSON.stringify({ query, url: sanitizedUrl }, null, 2)
                );
            }

            const res = await fetch(url, {
                headers: { 'User-Agent': 'Troves-Inventory-Agent/1.0', 'Accept': 'application/json' }
            });

            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}

                sysLog.error(`[GoogleBooks] API rejected request. Status: ${res.status} ${res.statusText}`);

                if (logActivity) {
                    await logActivity(item.id, 'Google Books Error', `API request failed (${res.status})`, 'error', errorBody);
                }

                if (res.status === 429) {
                    return { status: 429, data: null };
                }
                throw new Error(`Google Books API failed: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            return { status: 200, data };
        };

        const getWords = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !['the', 'and', 'for', 'with', 'vol', 'of'].includes(w));
        const origTitleWords = getWords(safeTitle);
        const requiredTitleMatches = Math.max(1, Math.floor(origTitleWords.length * 0.5));
        const rejectTerms = ['analysis', 'summary', 'study guide', 'bibliography', 'biography', 'trivia'];

        const findBestBook = (items) => {
            if (!items) return null;
            for (const item of items) {
                const book = item.volumeInfo;
                if (!book.title || !book.authors || book.authors.length === 0) continue;

                const lowerTitle = book.title.toLowerCase();
                if (rejectTerms.some(t => lowerTitle.includes(t)) && !rejectTerms.some(t => safeTitle.toLowerCase().includes(t))) {
                    continue;
                }

                const bookTitleWords = getWords(book.title);
                const titleOverlap = origTitleWords.reduce((count, w) => count + (bookTitleWords.includes(w) ? 1 : 0), 0);

                if (titleOverlap >= requiredTitleMatches || origTitleWords.length === 0) {
                    return book;
                }
            }
            return null;
        };

        // --- THREE PASS WATERFALL STRATEGY ---
        let bestBook = null;
        let queryUsed = "";
        
        // Pass 1: Strict Title + Precision Attributes
        const pass1Query = `intitle:"${safeTitle}" ${preciseExtraStr}`.trim();
        sysLog.info(`[GoogleBooks] Pass 1 (Strict): ${pass1Query}`);
        let passResult = await executeSearchPass(pass1Query);
        if (passResult.status === 429) return;
        bestBook = findBestBook(passResult.data?.items);
        queryUsed = pass1Query;

        if (!bestBook) {
            // Pass 2: Loose Title + Precision Attributes
            const pass2Query = `${safeTitle} ${preciseExtraStr}`.trim();
            sysLog.info(`[GoogleBooks] Pass 2 (Loose): ${pass2Query}`);
            passResult = await executeSearchPass(pass2Query);
            if (passResult.status === 429) return;
            bestBook = findBestBook(passResult.data?.items);
            queryUsed = pass2Query;
        }

        if (!bestBook && broadExtraStr !== preciseExtraStr) {
            // Pass 3: The Kitchen Sink Fallback
            const pass3Query = `${safeTitle} ${broadExtraStr}`.trim();
            sysLog.info(`[GoogleBooks] Pass 3 (Kitchen Sink): ${pass3Query}`);
            passResult = await executeSearchPass(pass3Query);
            if (passResult.status === 429) return;
            bestBook = findBestBook(passResult.data?.items);
            queryUsed = pass3Query;
        }

        if (logActivity) {
            await logActivity(
                item.id,
                'Google Books Response',
                bestBook ? `Found valid volume: "${bestBook.title}"` : `No clean matches found across all tiers.`,
                bestBook ? 'success' : 'warning',
                JSON.stringify({ finalQueryUsed: queryUsed, match: bestBook || "None" }, null, 2)
            );
        }

        if (!bestBook) {
            sysLog.warn(`[GoogleBooks] Discarding all results: No items matched our criteria after 3 passes.`);
            return;
        }

        const book = bestBook;
        const updates = {};

        if (book.title && book.title !== item.title) updates.title = book.title;

        if (book.description && (!item.description || item.description.trim() === '' || item.description.length < 150)) {
            updates.description = book.description;
        }

        if (Object.keys(updates).length > 0) {
            await db.item.update({ where: { id: item.id }, data: updates });
            if (logActivity) {
                await logActivity(item.id, 'Google Books Overwrite', 'Updated item fields automatically.', 'success');
            }
        }

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

        const coverExists = await db.photo.findFirst({ 
            where: { itemId: item.id, orgPath: { contains: '-cover-' } } 
        });

        if (!coverExists) {
            let coverBuffer = null;
            let coverSource = 'google';

            if (book.imageLinks?.thumbnail) {
                const baseImageUrl = book.imageLinks.thumbnail.replace('http:', 'https:');
                try {
                    const highResUrl = baseImageUrl.replace('&edge=curl', '').replace('zoom=1', 'zoom=3'); 
                    let imgRes = await fetch(highResUrl);

                    if (!imgRes.ok) imgRes = await fetch(baseImageUrl);

                    if (imgRes.ok) {
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        const threshold = imgRes.url.includes('zoom=3') ? 35000 : 4500;

                        if (buffer.length >= threshold) {
                            coverBuffer = buffer;
                        } else {
                            if (logActivity) await logActivity(item.id, 'Google Books Cover', `Discarded placeholder image (${buffer.length} bytes).`, 'warning');
                        }
                    }
                } catch (e) {
                    sysLog.error(`[GoogleBooks] Failed to download cover art:`, e);
                }
            }

            if (!coverBuffer && isbnValue) {
                try {
                    const olUrl = `https://covers.openlibrary.org/b/isbn/${isbnValue}-L.jpg?default=false`;
                    const olRes = await fetch(olUrl);
                    
                    if (olRes.ok) {
                        const buffer = Buffer.from(await olRes.arrayBuffer());
                        if (buffer.length > 5000) {
                            coverBuffer = buffer;
                            coverSource = 'openlibrary';
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
                if (logActivity) await logActivity(item.id, 'Cover Art', `Downloaded cover from ${coverSource === 'google' ? 'Google Books' : 'Open Library'}.`, 'success');
            }
        }
    }

    on(
        'onItemProcessed',
        async (payload) => {
            if (payload.intent?.isNew) {
                await lookupAndEnrichBook(payload.entity);
            }
        },
        { maxRetries: 3, retryDelayMs: 3000, rateLimitRpm: 50 }
    );

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