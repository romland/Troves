# Plugin Cookbook & Examples

This section contains real-world examples of plugins to demonstrate how to leverage the Troves Extension Engine. You can copy these files directly into your `data/plugins/` directory and modify them to suit your needs.

---

## Recipe: Custom Thermal Label Printer support

**The Goal:** Automatically print physical thermal labels (containing QR codes and container names) when creating new storage boxes in Troves.

This extension is actually THE reason why there is support for extensions in Troves at all.  

**How it works:**
- It listens to the automatic `onContainerCreated` event and the manual `onPrintLabelRequested` event.
- It intercepts the `intent` payload to determine if the user actually wanted to print a label (`intent.printLabel`), and whether they wanted the `small` or `large` format.
- It safely reads the printer's local IP and API key from the `.env` file.
- It executes sequentially in the background `ioQueue`, ensuring the Troves UI never freezes while waiting for the printer to spool.

**Suggested Filename:** `data/plugins/providi-label-studio.js`

**Get the Extension:**  
See [providi-label-studio.js](99-more-examples/providi-label-studio.js)


## Recipe: Adds button to search for the item in Google Images

A simple example snuck in as number 2 in this list.

**Code:**  
```javascript
/**
 * ============================================================================
 * TROVES PLUGIN: GOOGLE IMAGE SEARCH
 * ============================================================================
 * User Request: "Give me an extension that does what google search one does but for google images"
 * Target Trove Archetype: any
 * Generated At: 2026-09-18T17:06:08Z
 * Model: gemini-3.1-flash-lite
 * ============================================================================
 */

export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'google-image-search',
        label: 'Search on Google Images',
        icon: 'bi-image',
        // udm=2 is the modern Google URL parameter to force the Images vertical
        urlTemplate: 'https://www.google.com/search?udm=2&q={{title}}'
    });
}
```

**Suggested Filename:** `data/plugins/google-image-lookup.js`

**Get the Extension:**  
See [google-image-lookup.js](99-more-examples/google-image-lookup.js)

## Recipe: Fetch Metadata & Update CDs using Spotify

**The Goal:** Query the Spotify API for an item, update its title and description, add attributes, and fetch the cover art and add a song list.

**How it works:**
- It leverages the built-in `rateLimitRpm` to strictly stay under typical 60 requests/min free limits.
- It uses `maxRetries` to automatically recover from temporary API timeouts in the background queue.
- It reads from and writes directly to the Troves database using the injected `db` Prisma client.

**The User Request:**  
This extension was created with:  
> I want to fetch more info about my CD collection, i don't mind registering for a service, but i am not too keen on paying for it. I suppose I want to both manually and automatically update CD info... I have a spotify account if that helps. If possible grab songs from the album and create a document/link to each song that i can click to open in spotify (not web player please)

**Suggested Filename:** `data/plugins/fetch-spotify-info.js`

**Get the Extension:**  
See [spotify-music-enhancer.js](99-more-examples/spotify-music-enhancer.js)

## Recipe: Custom Archetype & Vision Prompt Injection

**The Goal:** Enforce a strict taxonomy for a specific collection type (Trollbeads) and inject domain expertise into the ML Vision model.

**API Concepts Demonstrated:** 
- `registerArchetype` to add a completely custom EAV schema and UI option.
- `addModifier('beforeVisionClassification')` to intercept and manipulate the `PromptBuilder` object in-flight.
- Generating SEO titles on `onItemProcessed`.

**Suggested Filename:** `data/plugins/trollbeads-expert.js`

**Get the Extension:**  
See [trollbeads-expert.js](99-more-examples/trollbeads-expert.js)


## Recipe: E-Commerce Sync (WooCommerce)

**The Goal:** Push a Troves item directly to a WooCommerce store, including its dynamic attributes, generated HTML description, and physical images.

**API Concepts Demonstrated:** 
- Complex REST API state tracking by saving remote IDs back into the Troves database via `itemOps.setAttribute` (stateful PUT/POST logic).
- Native Node `fs` and `path` modules to read images from the local Troves volume and upload them externally.

**Suggested Filename:** `data/plugins/woocommerce-promote-to-webshop.js`

**Get the Extension:**  
See [woocommerce-promote-to-webshop.js](99-more-examples/woocommerce-promote-to-webshop.js)


## Recipe: Manual Fetcher (UI Action & Database Access)

**The Goal:** Adds a button to the "..." menu of an item. When clicked, it searches an external API for the item's title and attaches a PDF link directly to the Troves database as a Document.

This is only an example, you'll have to set where it should download the documents of interest.

**Code:**  
```javascript
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    // Register a button that the frontend will render
    registerItemAction(
        { id: 'fetch-user-manual', label: 'Fetch User Manual', icon: 'bi-journal-text' }, 
        async (payload) => {
            const item = payload.entity;
            
            sysLog.info(`[FetchManual] Searching manuals for: ${item.title}`);

            const res = await fetch(`https://api.example.com/manuals?q=${encodeURIComponent(item.title)}`);
            if (!res.ok) throw new Error(`API failed: ${res.statusText}`);

            const data = await res.json();

            if (data.manualUrl) {
                await db.document.create({
                    data: {
                        type: 'link', 
                        title: `${item.title} - User Manual`,
                        source: new URL(data.manualUrl).hostname,
                        path: data.manualUrl,
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

**Warning:**  
So, the above, that's how you'd be able to do it. I include it because it illustrates what the happy path looks like.
In reality, you want to and SHOULD make it much more robust like this: 
[example-fetch-manual.js.js](99-more-examples/example-fetch-manual.js)

**Suggested Filename:** `data/plugins/fetch-manual.js`

## Recipe: Client-Side URL Link (Google Search)

**The Goal:** Add a button to the item menu that opens a new browser tab to search for the item's title.

**How it works:**
- By providing a `urlTemplate` instead of an asynchronous backend handler function, Troves knows to render this as a standard `<a target="_blank">` HTML link rather than a background queue job.
- The Svelte UI automatically replaces `{{title}}` in the template with the URL-encoded title of the current item.

**Code:**  
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

**Suggested Filename:** `data/plugins/google-search-lookup.js`

**Get the Extension:**  
See [google-search-lookup.js](99-more-examples/google-search-lookup.js)


## Recipe: Fetch Metadata & Update Books

**The Goal:** Query the Google Books API for an item, update its title and description, add attributes (Author, Publisher, Pages, ISBN), and fetch the cover art.

**How it works:**
- It leverages the built-in `rateLimitRpm` to strictly stay under typical 60 requests/min free limits.
- It uses `maxRetries` to automatically recover from temporary API timeouts in the background queue.
- It reads from and writes directly to the Troves database using the injected `db` Prisma client.

**Suggested Filename:** `data/plugins/google-books-enhancer.js`

**Get the Extension:**  
See [google-books-enhancer.js](99-more-examples/google-books-enhancer.js)


## Recipe: BoardGameGeek Tabletop Lookup
**The Goal:** Query the BGG XML API to automatically extract board game stats (player count, age, complexity), box art, and BGG catalog links.

**API Concepts Demonstrated:** 
- `fetch` with XML parsing (via Cheerio).
- `itemOps.compareTitles` for hardware-aware fuzzy string matching.
- Auto-running on `onItemProcessed` and manual UI triggers.

**Suggested Filename:** `data/plugins/boardgamegeek-item-enhancer.js`

**Get the Extension:**  
See [boardgamegeek-item-enhancer.js](99-more-examples/boardgamegeek-item-enhancer.js)


## Recipe: Client-Side URL Link (eBay Search)

**The Goal:** Add a simple button that opens an eBay search for the item's title in a new tab.

**API Concepts Demonstrated:** 
- `registerItemAction` using `urlTemplate` for zero-backend client-side linking.

**Suggested Filename:** `data/plugins/ebay-item-lookup.js`

**Get the Extension:**  
See [ebay-item-lookup.js](99-more-examples/ebay-item-lookup.js)


## Recipe: Dynamic URL Resolver (eBay Sold)

**The Goal:** Redirect the user to an eBay "Sold Listings" search for market price checking, building the URL dynamically.

**API Concepts Demonstrated:** 
- `registerItemAction` using `mode: 'resolve'` to synchronously build and return a target URL for SvelteKit to natively redirect the user.

**Suggested Filename:** `data/plugins/ebay-sold-lookup.js`

**Get the Extension:**  
See [ebay-sold-lookup.js](99-more-examples/ebay-sold-lookup.js)


## Recipe: Electronic Component Specs (Mouser)

**The Goal:** Search the Mouser API for electronic components, download datasheets, attach store links, and extract hidden specs via regex.

**API Concepts Demonstrated:** 
- Extensive use of `itemOps.setAttribute` and `itemOps.attachDocument` for idempotency.
- `itemOps.compareTitles` to reject spec/part number clashes.

**Suggested Filename:** `data/plugins/mouser-spec-downloader.js`

**Get the Extension:**  
See [mouser-spec-downloader.js](99-more-examples/mouser-spec-downloader.js)


## Recipe: Numista Coin Metadata

**The Goal:** Automatically enrich coin details from the Numista catalog using extracted attributes like year and denomination.

**API Concepts Demonstrated:** 
- `itemOps.getFuzzyAttribute` to gracefully locate taxonomy attributes regardless of exact naming.
- Multi-action registration (adding both a "Fetch" and "Dry Run" action to the same item).

**Suggested Filename:** `data/plugins/numista-coin-enhancer.js`

**Get the Extension:**  
See [numista-coin-enhancer.js](99-more-examples/numista-coin-enhancer.js)


## Recipe: Market Valuation & Contextual Link Resolution

**The Goal:** Run background valuations against Vinted's API based on parsed colors/brands, and provide a button that redirects to a highly-specific search.

**API Concepts Demonstrated:** 
- Dual-mode plugins: Using `onItemProcessed` for background HTTP API syncs and `registerItemAction` (`mode: 'resolve'`) for UI deep-linking using the exact same query builder.

**Suggested Filename:** `data/plugins/vinted-detailed-search-scout.js`

**Get the Extension:**  
See [vinted-detailed-search-scout.js](99-more-examples/vinted-detailed-search-scout.js)


## Recipe: Background Webpage Archiver

**The Goal:** Scan an item's KVP attributes for valid URLs and send them to the system's document downloader to be permanently archived.

**API Concepts Demonstrated:** 
- Utilizing `itemOps.fetchAndStoreWebpage` to delegate heavy offline archiving tasks directly to the core `ioQueue`.

**Suggested Filename:** `data/plugins/webpage-archiver.js`

**Get the Extension:**  
See [webpage-archiver.js](99-more-examples/webpage-archiver.js)
