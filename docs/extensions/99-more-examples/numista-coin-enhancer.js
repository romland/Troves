/**
 * @name Coin information
 * @description Fetches coin information from Numista (very untested)
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 */
/*
 * ============================================================================
 * TROVES PLUGIN: NUMISTA COIN METADATA
 * ============================================================================
 * 
 * Automatically fetches and enriches coin metadata from the Numista catalog.
 * 
 * REQUIRED SETUP:
 * You must add the following key to your Troves `.env` file:
 * 
 * NUMISTA_API_KEY="your_numista_api_key_here"
 * 
 * How to get one (Free):
 * 1. Go to https://en.numista.com/api/ and request access to the Numista API.
 * 2. Once your key is granted, add it to your `.env` file.
 * 3. Restart your Troves Docker container.
 * ============================================================================
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    
    const demonymMap = {
        'swedish': 'Sweden', 'norwegian': 'Norway', 'danish': 'Denmark',
        'british': 'United Kingdom', 'english': 'United Kingdom', 'uk': 'United Kingdom',
        'french': 'France', 'german': 'Germany', 'canadian': 'Canada',
        'australian': 'Australia', 'american': 'United States', 'us': 'United States',
        'swiss': 'Switzerland', 'dutch': 'Netherlands', 'belgian': 'Belgium',
        'spanish': 'Spain', 'italian': 'Italy', 'russian': 'Russia',
        'mexican': 'Mexico', 'brazilian': 'Brazil', 'japanese': 'Japan',
        'chinese': 'China', 'indian': 'India', 'south african': 'South Africa'
    };

    function getFuzzyAttribute(attributes, keywords) {
        if (!attributes) return null;
        const match = attributes.find(a => {
            const keyLower = (a.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return keywords.some(kw => keyLower.includes(kw));
        });
        return match ? match.value : null;
    }

    function extractExpectedCountry(title, fuzzyCountryVal) {
        let textToSearch = title.toLowerCase();
        if (fuzzyCountryVal) textToSearch += ` ${fuzzyCountryVal.toLowerCase()}`;

        for (const [demonym, countryName] of Object.entries(demonymMap)) {
            if (new RegExp(`\\b${demonym}\\b`).test(textToSearch) || new RegExp(`\\b${countryName.toLowerCase()}\\b`).test(textToSearch)) {
                return countryName;
            }
        }
        return fuzzyCountryVal;
    }

    async function searchAndScoreCandidates(item, apiKey) {
        // --- CAPTURE INITIAL STATE FOR DEBUG LOGGING ---
        const debug_InitialItemState = {
            title: item.title,
            description: item.description,
            attributes: item.attributes ? item.attributes.map(a => `${a.key}: ${a.value}`) : []
        };

        const safeTitle = item.title.trim();
        const fuzzyCountry = getFuzzyAttribute(item.attributes, ['country', 'issuer', 'nation', 'origin']);
        const fuzzyDenom = getFuzzyAttribute(item.attributes, ['denomination', 'value', 'face']);
        const fuzzyYearStr = getFuzzyAttribute(item.attributes, ['year', 'date', 'mint']);
        const fuzzyYear = fuzzyYearStr ? parseInt(fuzzyYearStr.match(/\d{4}/)?.[0], 10) : null;

        const expectedCountry = extractExpectedCountry(safeTitle, fuzzyCountry);
        
        let searchTerms = [safeTitle];
        if (fuzzyDenom) searchTerms.push(fuzzyDenom);
        if (fuzzyYear) searchTerms.push(String(fuzzyYear));
        if (expectedCountry) searchTerms.push(expectedCountry);
        
        const fillerWords = /\b(coin|matte|proof|circulated|uncirculated|obverse|reverse|front|back|mint|round|metallic|copper|nickel|silver|gold|bronze|brass|zinc|steel|finish|surface)\b/gi;
        let cleanQueryStr = searchTerms.join(' ').replace(fillerWords, '').replace(/\s+/g, ' ').trim();
        
        for (const [demonym, countryName] of Object.entries(demonymMap)) {
            if (new RegExp(`\\b${demonym}\\b`, 'i').test(cleanQueryStr)) {
                cleanQueryStr = cleanQueryStr.replace(new RegExp(`\\b${demonym}\\b`, 'gi'), countryName);
            }
        }
        
        let query = [...new Set(cleanQueryStr.split(' ').filter(Boolean))].join(' ').trim();
        let searchUrl = `https://api.numista.com/v3/types?q=${encodeURIComponent(query)}&count=20`;
        sysLog.info(`[Numista] Query Pass 1: ${searchUrl}`);

        let searchRes = await fetch(searchUrl, { headers: { 'Numista-API-Key': apiKey, 'Accept': 'application/json' } });
        if (!searchRes.ok) throw new Error(`Search API failed: ${searchRes.status}`);
        
        let searchData = await searchRes.json();
        let types = searchData.types || [];

        if (logActivity) {
            await logActivity(
                item.id, 'Numista Query Pass 1', `Searched Numista API for: "${query}"`, 'info',
                JSON.stringify({ debug_InitialItemState, searchUrl, query, resultCount: types.length, rawApiResponse: searchData }, null, 2)
            );
        }

        // Minimal Fallback Pass
        if (types.length === 0 && fuzzyDenom) {
            let minimalBase = `${expectedCountry || ''} ${fuzzyDenom} ${fuzzyYear || ''}`.replace(fillerWords, '').replace(/\s+/g, ' ').trim();
            for (const [demonym, countryName] of Object.entries(demonymMap)) {
                if (new RegExp(`\\b${demonym}\\b`, 'i').test(minimalBase)) {
                    minimalBase = minimalBase.replace(new RegExp(`\\b${demonym}\\b`, 'gi'), countryName);
                }
            }
            let minimalQuery = [...new Set(minimalBase.split(' ').filter(Boolean))].join(' ').trim();
            
            searchUrl = `https://api.numista.com/v3/types?q=${encodeURIComponent(minimalQuery)}&count=20`;
            sysLog.info(`[Numista] Query Pass 2 (Minimal): ${searchUrl}`);
            
            searchRes = await fetch(searchUrl, { headers: { 'Numista-API-Key': apiKey, 'Accept': 'application/json' } });
            if (searchRes.ok) {
                searchData = await searchRes.json();
                types = searchData.types || [];
                if (types.length > 0) query = minimalQuery; 
                
                if (logActivity) {
                    await logActivity(
                        item.id, 'Numista Query Pass 2 (Fallback)', `Searched Numista API for: "${minimalQuery}"`, 'info',
                        JSON.stringify({ debug_InitialItemState, searchUrl, query: minimalQuery, resultCount: types.length, rawApiResponse: searchData }, null, 2)
                    );
                }
            }
        }

        if (types.length === 0) {
            return { query, types: [], bestMatch: null, rejectedLog: [], debug_InitialItemState };
        }

        // --- LOCAL VALIDATION ---
        const combinedOriginalText = `${safeTitle} ${fuzzyDenom || ''} ${fuzzyYearStr || ''}`.toLowerCase();
        const requiredTitleNumbers = combinedOriginalText.match(/\b\d+(?:\.\d+)?\b/g) || [];
        const filteredRequiredNumbers = [...new Set(requiredTitleNumbers.filter(n => parseInt(n) !== fuzzyYear))];

        const getWords = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2);
        const origWords = getWords(query);
        
        let highestScore = -1;
        let bestMatch = null;
        let rejectedLog = [];

        for (const coin of types) {
            let score = 0;
            const coinTitle = (coin.title || '').toLowerCase();
            
            // RULE A: Country Lock
            if (expectedCountry && coin.issuer?.name) {
                const apiIssuer = coin.issuer.name.toLowerCase();
                const expected = expectedCountry.toLowerCase();
                if (!apiIssuer.includes(expected) && !expected.includes(apiIssuer)) {
                    rejectedLog.push(`Rejected "${coin.title}" (Issuer mismatch: ${coin.issuer.name} vs ${expectedCountry})`);
                    continue; 
                }
            }
            
            // RULE B: Strict Forward Number Match (Your numbers must exist in Candidate)
            let missingCriticalNumber = false;
            for (const num of filteredRequiredNumbers) {
                if (!new RegExp(`\\b${num}\\b`).test(coinTitle)) {
                    missingCriticalNumber = true;
                    rejectedLog.push(`Rejected "${coin.title}" (Missing your number: ${num})`);
                    break;
                }
            }
            if (missingCriticalNumber) continue;

            // RULE C: Anti-Hallucination Reverse Number Match (Candidate numbers must exist in Your data)
            const candidateNumbers = coinTitle.match(/\b\d+(?:\.\d+)?\b/g) || [];
            let hallucinatesDenomination = false;
            for (const cNum of candidateNumbers) {
                if (!new RegExp(`\\b${cNum}\\b`).test(combinedOriginalText)) {
                    // Ignore years in candidate titles as false positives (e.g., 4 digit numbers starting with 1 or 2)
                    if (/^(1|2)\d{3}$/.test(cNum)) continue; 
                    
                    hallucinatesDenomination = true;
                    rejectedLog.push(`Rejected "${coin.title}" (Candidate has unknown number: '${cNum}')`);
                    break;
                }
            }
            if (hallucinatesDenomination) continue;

            // RULE D: Strict Year Boundary
            if (fuzzyYear) {
                if (coin.min_year && fuzzyYear < coin.min_year) {
                    rejectedLog.push(`Rejected "${coin.title}" (Coin from ${fuzzyYear}, minted > ${coin.min_year})`);
                    continue;
                }
                if (coin.max_year && fuzzyYear > coin.max_year) {
                    rejectedLog.push(`Rejected "${coin.title}" (Coin from ${fuzzyYear}, minted < ${coin.max_year})`);
                    continue;
                }
            }

            // Lexical Overlap Score
            const coinWords = getWords(coinTitle);
            for (const word of origWords) {
                if (coinWords.includes(word)) score++;
            }

            score -= Math.abs(coinTitle.length - query.length) * 0.01;

            if (score > highestScore) {
                highestScore = score;
                bestMatch = coin;
            }
        }

        return { query, types, bestMatch, rejectedLog, debug_InitialItemState };
    }

    async function applyCoinDetails(item, coinId, apiKey, debug_InitialItemState = null) {
        const fullUrl = `https://api.numista.com/v3/types/${coinId}`;
        const fullRes = await fetch(fullUrl, { headers: { 'Numista-API-Key': apiKey, 'Accept': 'application/json' } });
        if (!fullRes.ok) throw new Error(`Full Type Fetch Failed: ${fullRes.status}`);
        
        const coinData = await fullRes.json();
        const updates = {};
        
        if (coinData.title && coinData.title !== item.title) updates.title = coinData.title;
        if (coinData.comments && (!item.description || item.description.trim() === '' || item.description.length < 50)) {
            updates.description = coinData.comments.replace(/<[^>]*>?/gm, ''); 
        }

        if (Object.keys(updates).length > 0) {
            await db.item.update({ where: { id: item.id }, data: updates });
        }

        const attrMap = {
            'Issuer': coinData.issuer?.name,
            'Years Minted': coinData.min_year ? (coinData.min_year === coinData.max_year ? String(coinData.min_year) : `${coinData.min_year}-${coinData.max_year}`) : null,
            'Face Value': coinData.value?.text,
            'Composition': coinData.composition?.text,
            'Weight': coinData.weight ? `${coinData.weight}g` : null,
            'Diameter': coinData.size ? `${coinData.size}mm` : null,
            'Thickness': coinData.thickness ? `${coinData.thickness}mm` : null,
            'Shape': coinData.shape,
            'Numista Link': coinData.url,
            'Ruler': Array.isArray(coinData.ruler) ? coinData.ruler.map(r => r.name).join(', ') : null,
            'Mints': Array.isArray(coinData.mints) ? coinData.mints.map(m => m.name).join(', ') : null,
            'References': Array.isArray(coinData.references) ? coinData.references.map(r => `${r.catalogue?.code || ''} ${r.number}`).join(', ') : null,
            'Engravers': Array.isArray(coinData.engravers) ? coinData.engravers.join(', ') : null,
            'Tags': Array.isArray(coinData.tags) ? coinData.tags.join(', ') : null,
            'Technique': coinData.technique?.text,
            'Edge': coinData.edge?.description,
            'Obverse': coinData.obverse?.description || coinData.description,
            'Obverse Lettering': coinData.obverse?.lettering || coinData.lettering,
            'Reverse': coinData.reverse?.description,
            'Reverse Lettering': coinData.reverse?.lettering
        };

        let attributesAddedCount = 0;
        for (const [key, value] of Object.entries(attrMap)) {
            if (!value) continue;
            if (await itemOps.setAttribute(item.id, key, value)) {
                attributesAddedCount++;
            }
        }

        if (coinData.url) {
            await itemOps.attachDocument(item.id, {
                type: 'link', 
                title: `Numista Catalog: ${coinData.title || item.title}`, 
                source: 'Numista',
                path: coinData.url, 
                extracts: `View community details and pictures.`
            });
        }

        if (logActivity) {
            await logActivity(
                item.id, 'Numista Sync Success', `Successfully enriched "${coinData.title}" and attached ${attributesAddedCount} attributes.`, 'success',
                JSON.stringify({ debug_InitialItemState, mappedAttributes: attrMap, rawApiResponse: coinData }, null, 2)
            );
        }
    }

    async function lookupAndEnrichCoin(baseItem, dryRun = false) {
        const item = await db.item.findUnique({
            where: { id: baseItem.id },
            include: { attributes: true }
        });

        if (!item || !item.title) return;
        const apiKey = env.NUMISTA_API_KEY;
        if (!apiKey) return;

        try {
            const manualIdAttr = getFuzzyAttribute(item.attributes, ['numistaid']);
            const targetId = manualIdAttr ? manualIdAttr.replace(/\D/g, '') : null;

            if (targetId && !dryRun) {
                sysLog.info(`[Numista] Found explicit ID override: ${targetId}`);
                await applyCoinDetails(item, targetId, apiKey, { manualOverride: true, title: item.title });
                return;
            }

            const { query, types, bestMatch, rejectedLog, debug_InitialItemState } = await searchAndScoreCandidates(item, apiKey);

            if (types.length === 0) {
                if (logActivity) await logActivity(item.id, 'Numista Results', `No matches found using: [ ${query} ]`, 'warning', JSON.stringify({ debug_InitialItemState, query, error: "Zero results from API" }, null, 2));
                return;
            }

            if (dryRun) {
                const candidates = types.slice(0, 5).map((t, idx) => `${idx + 1}. ID: ${t.id} - ${t.title} (${t.issuer?.name || 'Unknown'})`).join('\n');
                if (logActivity) {
                    await logActivity(
                        item.id, 'Numista Candidates (Dry Run)', `Top Results for: [ ${query} ]\nTo force a match, add a custom attribute named "Numista ID".\n\n${candidates}`, 'info',
                        JSON.stringify({ debug_InitialItemState, query, rejectedLog, rawCandidates: types }, null, 2)
                    );
                }
                return;
            }

            if (!bestMatch) {
                sysLog.warn(`[Numista] Found ${types.length} results, all rejected by strict validation.`);
                if (logActivity) {
                    await logActivity(
                        item.id, 'Numista Sync Aborted', `Results rejected to prevent overwriting data.\n\n` + rejectedLog.slice(0, 10).join('\n'), 'warning',
                        JSON.stringify({ debug_InitialItemState, query, totalResultsFound: types.length, rejectedLog, rawCandidates: types }, null, 2)
                    );
                }
                return;
            }

            sysLog.info(`[Numista] Best match selected: ID ${bestMatch.id}`);
            await applyCoinDetails(item, bestMatch.id, apiKey, debug_InitialItemState);

        } catch (error) {
            sysLog.error(`[Numista] Unhandled error:`, error);
            if (logActivity) await logActivity(baseItem.id, 'Numista Failed', error.message, 'error', JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
            throw error; 
        }
    }

    on('onItemProcessed', async (payload) => {
        if (payload.intent?.isNew) await lookupAndEnrichCoin(payload.entity, false);
    }, { maxRetries: 3, retryDelayMs: 4000, rateLimitRpm: 45 });

    registerItemAction({ 
        id: 'fetch-numista-coin', label: 'Fetch Coin Info from Numista', icon: 'bi-coin',
        maxRetries: 2, retryDelayMs: 3000, rateLimitRpm: 45
    }, async (payload) => await lookupAndEnrichCoin(payload.entity, false));

    registerItemAction({ 
        id: 'fetch-numista-candidates', label: 'Find Numista Candidates (Dry Run)', icon: 'bi-search',
        maxRetries: 1, retryDelayMs: 2000, rateLimitRpm: 45
    }, async (payload) => await lookupAndEnrichCoin(payload.entity, true));
}