/**
 * @name Mouser Spec Fetcher
 * @description Fetches specs from Mouser (very untested)
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 */
/**
 * ============================================================================
 * TROVES PLUGIN: MOUSER COMPONENT LOOKUP
 * ============================================================================
 * Features:
 * - Queries the Mouser Search API using the item's title (sanitized for symbols).
 * - Performs hardware-aware fuzzy matching to reject incorrect spec variants.
 * - Idempotently attaches: Datasheets, Store Links, Pricing, Lead Times, Manufacturer, MPN, and Category.
 * - Uses regex to salvage hidden specs (Voltage, Current, Power, Frequency) from generic descriptions.
 * - Fully logs API requests and errors to the Troves Activity Monitor.
 * ============================================================================
 * 
 * REQUIRED SETUP:
 * You must add the following key to your Troves `.env` file:
 * 
 * MOUSER_API_KEY="your_mouser_search_api_key_here"
 * 
 * How to get one (Free):
 * 1. Go to https://www.mouser.com/api-hub/ and sign in or create a free account.
 * 2. Request a "Search API" key.
 * 3. Add it to your `.env` file and restart your Troves Docker container.
 * ============================================================================
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {    
    async function lookupAndEnrichComponent(payload) {
        const item = payload.entity;

        if (!item.title) {
            sysLog.warn(`[Mouser] Item ${item.id} has no title to search for.`);
            return;
        }

        const apiKey = env.MOUSER_API_KEY;
        if (!apiKey) {
            sysLog.warn("[Mouser] Skipped: MOUSER_API_KEY missing from .env");
            return;
        }

        const safeTitle = item.title.trim();
        // Mouser's API strictly rejects symbols like Ω, :, and /
        const mouserQuery = safeTitle.replace(/Ω/gi, 'ohm').replace(/[^a-zA-Z0-9\.\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
        sysLog.info(`[Mouser] Searching catalog for: "${mouserQuery}" (Original: "${safeTitle}")`);

        // 1. Prepare Request
        const url = `https://api.mouser.com/api/v1/search/keyword?apiKey=${apiKey}`;
        const requestBody = {
            SearchByKeywordRequest: {
                keyword: mouserQuery,
                records: 10,
                startingRecord: 0,
                searchOptions: "",
                searchWithYourSignUpLanguage: ""
            }
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            // 2. Full Transparency Error Catching
            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}
                
                sysLog.error(`[Mouser] API rejected request. Status: ${res.status}. Body: ${errorBody}`);
                
                if (logActivity) {
                    await logActivity(
                        item.id, 
                        'Mouser Sync Failed', 
                        `API rejected the request (${res.status})`, 
                        'error', 
                        JSON.stringify({ 
                            url: url.replace(/apiKey=[^&]+/, 'apiKey=***'), 
                            requestBody, 
                            responseStatus: res.status, 
                            responseBody: errorBody 
                        }, null, 2)
                    );
                }
                throw new Error(`Mouser API rejected request: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            const parts = data.SearchResults?.Parts || [];

            if (logActivity) {
                await logActivity(
                    item.id, 
                    'Mouser Component Search', 
                    `Queried Mouser for "${mouserQuery}". Found ${parts.length} results.`, 
                    'info', 
                    JSON.stringify({ 
                        query: mouserQuery, 
                        requestBody, 
                        resultsCount: parts.length, 
                        rawData: data 
                    }, null, 2)
                );
            }

            if (parts.length === 0) {
                sysLog.warn(`[Mouser] No components found for "${mouserQuery}".`);
                return;
            }

            // 3. Hardware-Aware Fuzzy Matching
            let bestMatch = null;
            let highestScore = -999;
            let rejectedLog = [];

            for (const part of parts) {
                const candidateStr = `${part.ManufacturerPartNumber} ${part.Description}`;
                const matchEval = itemOps.compareTitles(safeTitle, candidateStr);

                // Electronics Exception: If the Mouser MPN contains our raw title (ignoring case/spaces),
                // it is likely a packaging suffix (e.g., NRF24L01 vs NRF24L01P-R7). Allow it!
                const rawMpn = (part.ManufacturerPartNumber || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const rawTitle = safeTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

                if (matchEval.isSpecClash && !rawMpn.includes(rawTitle) && !rawTitle.includes(rawMpn)) {
                    rejectedLog.push(`Rejected "${part.ManufacturerPartNumber}" (Spec/Number clash against "${safeTitle}")`);
                    continue; 
                }

                let score = matchEval.titleSim;
                if (rawMpn.includes(rawTitle) || rawTitle.includes(rawMpn)) {
                    score += 0.5; // Artificially boost substring MPN matches to the top
                }

                if (score > highestScore) {
                    highestScore = score;
                    bestMatch = part;
                }
            }

            if (!bestMatch) {
                sysLog.warn(`[Mouser] Found ${parts.length} results, but rejected them all due to spec/number clashes.`);
                if (logActivity) {
                    await logActivity(item.id, 'Mouser Sync Aborted', `Rejected parts to prevent bad datasheets.\n` + rejectedLog.join('\n'), 'warning');
                }
                return;
            }

            // 4. Safe, Idempotent Mutations
            sysLog.info(`[Mouser] Best match selected: ${bestMatch.ManufacturerPartNumber}`);
            let updatesMade = 0;

            if (bestMatch.DataSheetUrl) {
                const docAttached = await itemOps.attachDocument(item.id, {
                    type: 'link',
                    title: `${bestMatch.ManufacturerPartNumber} Datasheet`,
                    source: 'Mouser',
                    path: bestMatch.DataSheetUrl,
                    extracts: bestMatch.Description
                });
                if (docAttached) updatesMade++;
            }

            // Attach the direct store link
            if (bestMatch.ProductDetailUrl) {
                const linkAttached = await itemOps.attachDocument(item.id, {
                    type: 'link',
                    title: `View on Mouser`,
                    source: 'Mouser',
                    path: bestMatch.ProductDetailUrl,
                    extracts: `Check live pricing, stock levels, and packaging options.`
                });
                if (linkAttached) updatesMade++;
            }

            if (bestMatch.Manufacturer) { if (await itemOps.setAttribute(item.id, 'Manufacturer', bestMatch.Manufacturer)) updatesMade++; }
            if (bestMatch.ManufacturerPartNumber) { if (await itemOps.setAttribute(item.id, 'MPN', bestMatch.ManufacturerPartNumber)) updatesMade++; }
            if (bestMatch.Category) { if (await itemOps.setAttribute(item.id, 'Component Category', bestMatch.Category)) updatesMade++; }
            if (bestMatch.LifecycleStatus) { if (await itemOps.setAttribute(item.id, 'Lifecycle Status', bestMatch.LifecycleStatus)) updatesMade++; }
            if (bestMatch.ROHSStatus) { if (await itemOps.setAttribute(item.id, 'RoHS Status', bestMatch.ROHSStatus)) updatesMade++; }
            if (bestMatch.Description) { if (await itemOps.setAttribute(item.id, 'Specs (Raw)', bestMatch.Description)) updatesMade++; }

            // Supply Chain Metrics
            if (bestMatch.Availability) { if (await itemOps.setAttribute(item.id, 'Mouser Supplier Stock', bestMatch.Availability)) updatesMade++; }
            if (bestMatch.LeadTime) { if (await itemOps.setAttribute(item.id, 'Mouser Lead Time', bestMatch.LeadTime)) updatesMade++; }

            if (bestMatch.PriceBreaks && Array.isArray(bestMatch.PriceBreaks) && bestMatch.PriceBreaks.length > 0) {
                // Grab the price for 1 unit, or fallback to the lowest available minimum order quantity
                const unitPrice = bestMatch.PriceBreaks.find(p => p.Quantity === 1) || bestMatch.PriceBreaks[0];
                if (unitPrice && unitPrice.Price) {
                    if (await itemOps.setAttribute(item.id, 'Unit Price', `${unitPrice.Currency} ${unitPrice.Price}`)) updatesMade++;
                }
            }

            // Mouser notoriously crams vital specs into the description for ICs instead of the ProductAttributes array.
            // Let's salvage them using standard engineering unit regex patterns.
            const desc = bestMatch.Description || '';
            const volts = desc.match(/\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[mμu]?V\b/gi);
            if (volts && await itemOps.setAttribute(item.id, 'Voltage', [...new Set(volts)].join(', '))) updatesMade++;
            
            const freq = desc.match(/\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[kMG]Hz\b/gi);
            if (freq && await itemOps.setAttribute(item.id, 'Frequency', [...new Set(freq)].join(', '))) updatesMade++;

            const amps = desc.match(/\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[mμu]?A\b/gi);
            if (amps && await itemOps.setAttribute(item.id, 'Current', [...new Set(amps)].join(', '))) updatesMade++;

            const watts = desc.match(/\b(?:\d+\/\d+|\d+(?:\.\d+)?)[mμu]?W\b/gi);
            if (watts && await itemOps.setAttribute(item.id, 'Power', [...new Set(watts)].join(', '))) updatesMade++;

            if (bestMatch.ProductAttributes && Array.isArray(bestMatch.ProductAttributes)) {
                for (const attr of bestMatch.ProductAttributes) {
                    if (attr.AttributeName && attr.AttributeValue) {
                        const attrAdded = await itemOps.setAttribute(item.id, attr.AttributeName, attr.AttributeValue);
                        if (attrAdded) updatesMade++;
                    }
                }
            }

            if (logActivity) {
                if (updatesMade > 0) {
                    await logActivity(item.id, 'Mouser Sync Success', `Successfully enriched "${bestMatch.ManufacturerPartNumber}" and attached ${updatesMade} new attributes/datasheets.`, 'success');
                } else {
                    await logActivity(item.id, 'Mouser Sync Complete', `Matched with "${bestMatch.ManufacturerPartNumber}", but no new missing data was found to add.`, 'info');
                }
            }

        } catch (error) {
            sysLog.error(`[Mouser] Unhandled error during component enrichment:`, error);
            // Error is already logged to DB if it came from the fetch block above
            throw error;
        }
    }

    // Let's not do this automatically, it expects pretty precise searches to be useful
    // on('onItemProcessed', async (payload) => {
    //     if (payload.intent?.isNew) {
    //         await lookupAndEnrichComponent(payload);
    //     }
    // }, { maxRetries: 3, retryDelayMs: 4000, rateLimitRpm: 25 });

    registerItemAction({ 
        id: 'fetch-mouser-component', 
        label: 'Fetch Specs & Datasheet (Mouser)', 
        icon: 'bi-cpu',
        maxRetries: 1, 
        rateLimitRpm: 25
    }, async (payload) => {
        await lookupAndEnrichComponent(payload);
    });
}