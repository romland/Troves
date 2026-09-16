/*
Doc: https://kit.svelte.dev/docs/routing#server
*/
import { db } from '$lib/server/database';
import type { Prisma } from '@prisma/client';
import { normalizeStr } from '$lib/server/matcher';
import { tokenizeAndStem } from '$lib/server/nlp';

/*
TODO SECURITY: NEED TO IMPLEMENT AUTHORIZATION HERE (HOW IS IT DONE ELSEWHERE?)
*/

function scoreSearchRelevance(item: any, query: string, terms: string[], stems: string[]): number {
    if (!item.title) return 0;
    const title = normalizeStr(item.title);
    const q = normalizeStr(query);
    let score = 0;
    
    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 80;
    else if (title.includes(q)) score += 60;
    else {
        let matches = 0;
        let lastIndex = -1;
        let inOrder = true;
        
        for (const term of terms) {
            const t = normalizeStr(term);
            const idx = title.indexOf(t);
            if (idx !== -1) {
                matches++;
                if (idx > lastIndex) lastIndex = idx;
                else inOrder = false;
            }
        }
        score += (matches / terms.length) * 40;
        if (inOrder && matches === terms.length) score += 10;
    }

    // NLP Stemming Fallback: If title didn't score high, check the semantic tokens
    if (score < 50 && item.semanticTokens && stems.length > 0) {
        let stemMatches = 0;
        for (const stem of stems) {
            if (item.semanticTokens.includes(`"${stem}"`)) stemMatches++;
        }
        if (stemMatches > 0) score += (stemMatches / stems.length) * 15;
    }

    return score;
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, setHeaders, locals }) {
    const tStart = performance.now();
    if (!locals.user) return new Response('Unauthorized', { status: 401 });
	setHeaders({
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
	});
    const idsParam = String(url.searchParams.get('ids') || "").trim();
    const q = String(url.searchParams.get('q') || "").trim();
	const cat = String(url.searchParams.get('category') || "").trim();
    const page = Number(url.searchParams.get('page') ?? '1');
    const count = Math.min( Number(url.searchParams.get('c') ?? '12'), 24);
    const docLimit = Math.min( Number(url.searchParams.get('dc') ?? '50'), 100);
    const unassigned = url.searchParams.get('unassigned') === 'true';
    const attrKey = url.searchParams.get('attrKey');
    const attrVal = url.searchParams.get('attrVal');
    const sort = url.searchParams.get('sort') || locals.activeSort || 'newest';

    // Advanced Search/Bulk Filters
    const tag = String(url.searchParams.get('tag') || "").trim();
    const container = String(url.searchParams.get('container') || "").trim();
    const titleStr = String(url.searchParams.get('title') || "").trim();
    const descStr = String(url.searchParams.get('desc') || "").trim();
    const docStr = String(url.searchParams.get('doc') || "").trim();
    const reasonStr = String(url.searchParams.get('reason') || "").trim();
    const minAmount = url.searchParams.get('minAmount');
    const maxAmount = url.searchParams.get('maxAmount');
    const duplicateStatus = url.searchParams.get('duplicateStatus');
    const colorMix = url.searchParams.get('color');
    const attrsJson = url.searchParams.get('attrs');
    const fetchDocs = url.searchParams.get('fetchDocs') === 'true';

    // Fetch inventory settings for search logic
    const inventory = await db.inventory.findUnique({
        where: { id: locals.activeInventoryId },
        select: { enableFuzzySearch: true }
    });

    let orderBy: any = [{ id: 'desc' }];
    switch(sort) {
        case 'oldest': orderBy = [{ id: 'asc' }]; break;
        case 'name_asc': orderBy = [{ title: 'asc' }]; break;
        case 'name_desc': orderBy = [{ title: 'desc' }]; break;
        case 'updated': orderBy = [{ updatedAt: 'desc' }]; break;
        case 'dust': orderBy = [{ updatedAt: 'asc' }]; break;
        case 'amount_asc': orderBy = [{ amount: 'asc' }]; break;
        case 'amount_desc': orderBy = [{ amount: 'desc' }]; break;
    }

    // Surgically select only what the UI needs. 
    // We strictly omit massive columns: `photos.ocr`, `photos.exifData`, `documents.extracts`.
    const itemSelect: Prisma.ItemSelect = {
        id: true, clientId: true, slug: true, amount: true, title: true, description: true, reason: true, duplicateStatus: true,
        inventoryId: true, authorId: true, createdAt: true, updatedAt: true,
        locations: { include: { container: true } },
        photos: {
            select: {
                id: true, type: true, isPrimary: true, orgPath: true, cropPath: true, thumbPath: true,
                showOriginal: true, colors: true, classBlip: true, classTrash: true, llmAnalysis: true,
                categoryId: true, category: true
            }
        },
        tags: true,
        attributes: true,
        _count: { select: { documents: true } } // Don't fetch document texts, just the count
    };

    // Only incur the cost of fetching semantic tokens if we actually need them to rank a search
    if (q) itemSelect.semanticTokens = true;

    const query: Prisma.ItemFindManyArgs = {
        take: Number(count) || 12,
        skip: Math.max(0, (Number(page) || 1) - 1) * (Number(count) || 12),
        orderBy,
        where: {
            inventoryId: locals.activeInventoryId
        },
        select: itemSelect
    };

    if (idsParam) {
        const targetIds = idsParam.split(',').map(Number).filter(n => !isNaN(n));
        if (targetIds.length > 0) {
            query.where = { ...query.where, id: { in: targetIds } };
        }
    }

    let documentResults: any[] = [];

    // Full Text Search for Documents (SQLite FTS5)
    let tFtsStart = performance.now();
    const ftsQuery = q || docStr;

    // Parse exact phrases (e.g. "usb ttl") vs individual words
    const parsedTerms: { text: string, isPhrase: boolean }[] = [];
    const termRegex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = termRegex.exec(ftsQuery)) !== null) {
        if (match[1]) {
			const cleanPhrase = match[1].replace(/[^\p{L}\p{N}\sµΩ°²³½¼¾$€£%&+#ø@-]/gu, '').replace(/\s+/g, ' ').trim();
            if (cleanPhrase) parsedTerms.push({ text: cleanPhrase, isPhrase: true });
        } else if (match[2]) {
			const cleanWord = match[2].replace(/[^\p{L}\p{N}\sµΩ°²³½¼¾$€£%&+#ø@-]/gu, '').trim();
            if (cleanWord) parsedTerms.push({ text: cleanWord, isPhrase: false });
        }
    }

    // Prevent FTS5 index explosions on 1-character prefix queries (like "t*") which take 5+ seconds
    const ftsTerms = parsedTerms.map(t => t.text).filter(text => text.length > 1);
    if (ftsTerms.length > 0 && fetchDocs) {
        const matchQuery = ftsTerms.map(word => `"${word}"*`).join(' AND ');
        try {
            documentResults = await db.$queryRawUnsafe(`
                SELECT d.id, d.title, d.path, d.source, d.itemId, 
                snippet(DocumentIndex, 1, '<mark class="bg-primary/15 text-primary font-semibold px-1 rounded-sm">', '</mark>', '...', 12) as excerpt
                FROM DocumentIndex fts
                JOIN Document d ON d.id = fts.rowid
                LEFT JOIN Item i ON d.itemId = i.id
                LEFT JOIN TimelineNote tn ON d.timelineNoteId = tn.id
                WHERE DocumentIndex MATCH ?
                  AND (i.inventoryId = ? OR tn.inventoryId = ?)
                  AND (tn.category IS NULL OR tn.category != 'trash')
                ORDER BY (
                    -bm25(DocumentIndex, 10.0, 1.0) 
                    + CASE WHEN d.itemId IS NOT NULL THEN 5.0 ELSE 0.0 END
                ) DESC
                LIMIT ?;
            `, matchQuery, locals.activeInventoryId, locals.activeInventoryId, docLimit) as any[];
        } catch (e) { console.error("FTS search failed", e); }
    } else if (fetchDocs) {
        // Requested documents explicitly (e.g. search page default state)
        try {
            documentResults = await db.$queryRawUnsafe(`
                SELECT d.id, d.title, d.path, d.source, d.itemId, 
                '' as excerpt
                FROM Document d
                LEFT JOIN Item i ON d.itemId = i.id
                LEFT JOIN TimelineNote tn ON d.timelineNoteId = tn.id
                WHERE (i.inventoryId = ? OR tn.inventoryId = ?)
                  AND (tn.category IS NULL OR tn.category != 'trash')
                ORDER BY d.createdAt DESC
                LIMIT ?;
            `, locals.activeInventoryId, locals.activeInventoryId, docLimit) as any[];
        } catch(e) { console.error("Recent documents fetch failed", e); }
    }
    const tFtsEnd = performance.now();

    // Clean up SQLite FTS JSON artifacts (literal \n, \t, brackets) from the excerpts
    documentResults.forEach(d => {
        if (d.excerpt) {
            d.excerpt = d.excerpt
                .replace(/\\[nrt]/g, ' ')          // Strip literal \n, \r, \t
                .replace(/\\"/g, '"')            // Unescape quotes
                .replace(/^\["?|"?\]$/g, '')     // Remove leading/trailing JSON array brackets
                .replace(/","/g, ' ... ')        // Replace JSON array commas with a nice separator
                .replace(/\s+/g, ' ')            // Collapse multiple spaces
                .trim();
        }
    });

    // Enrich Document Results with Rich Item Data for the UI
    if (documentResults.length > 0) {
        const docItemIds = [...new Set(documentResults.map(d => d.itemId).filter(Boolean))];
        if (docItemIds.length > 0) {
            try {
                const richItems = await db.item.findMany({
                    where: { id: { in: docItemIds } },
                    select: {
                        id: true,
                        title: true,
                        photos: { select: { id: true, thumbPath: true, orgPath: true, type: true, isPrimary: true, category: true } },
                        locations: { include: { container: true } }
                    }
                });
                const itemMap = new Map(richItems.map(i => [i.id, {
                    ...i,
                    locationName: i.locations?.[0]?.container?.name || 'Unassigned',
                    categoryName: i.photos?.[0]?.category?.name || 'No Category'
                }]));
                documentResults.forEach(d => {
                    if (d.itemId) d.item = itemMap.get(d.itemId);
                });
            } catch (e) { console.error("Failed to enrich document items", e); }
        }
    }

    const searchTerms = parsedTerms.map(t => t.text);
    const stemmedTerms = inventory?.enableFuzzySearch ? tokenizeAndStem([q]) : [];

    if (!idsParam && q && parsedTerms.length > 0) {
        const termConditions = parsedTerms.map(({ text, isPhrase }) => {
            const orConditions: any[] = [
                { title: { contains: text } },
                { description: { contains: text } },
                { locations: { some: { container: { name: { contains: text } } } } },
                { tags: { some: { name: { contains: text } } } },
                { photos: { some: { ocr: { contains: text } } } }
            ];

            if (!isPhrase) {
                if (inventory?.enableFuzzySearch) {
                    const stem = tokenizeAndStem([text])[0] || text;
                    orConditions.push({ semanticTokens: { contains: `"${stem}"` } });
                    // Only search the AI's raw metadata dump if fuzzy search is enabled
                    orConditions.push({ photos: { some: { llmAnalysis: { contains: text } } } });
                }
            }

            return { OR: orConditions };
        });
        
        query.where = {
            ...query.where,
            AND: [
                ...(query.where.AND as any || []),
                ...termConditions
            ]
        };
    }

	if (cat && cat.length > 0) {
        if (cat === '_uncategorized') {
            // Finds items that DO NOT have ANY photo with a valid category
            query.where = { ...query.where, photos: { none: { categoryId: { not: null } } } };
        } else {
            query.where = { ...query.where, photos: { some: { category: { name: cat } } } };
        }
	}

    if (tag && tag.length > 0) {
        query.where = { ...query.where, tags: { some: { OR: [{ name: tag }, { slug: tag }] } } };
    }

    if (container && container.length > 0) {
        const cList = container.split(',');
        query.where = { ...query.where, locations: { some: { container: { name: { in: cList } } } } };
    }

    if (unassigned) {
        query.where = { ...query.where, locations: { none: {} } };
    }

    if (titleStr) query.where = { ...query.where, title: { contains: titleStr } };
    if (descStr) query.where = { ...query.where, description: { contains: descStr } };
    if (reasonStr) query.where = { ...query.where, reason: { contains: reasonStr } };
    
    if (docStr) {
        query.where = { ...query.where, documents: { some: { OR: [ { title: { contains: docStr } }, { extracts: { contains: docStr } }, { summary: { contains: docStr } } ] } } };
    }

    if (duplicateStatus) {
        query.where = { ...query.where, duplicateStatus };
    }

    if (colorMix && colorMix !== '[]') {
        try {
            const colors = JSON.parse(colorMix).map((c: any) => c.name || c.color);
            if (colors.length > 0) {
                query.where = { ...query.where, attributes: { some: { key: 'color_mix', AND: colors.map((c: string) => ({ value: { contains: `"${c}"` } })) } } };
            }
        } catch (e) {}
    }

    if (minAmount || maxAmount) {
        query.where = { ...query.where, amount: {} };
        if (minAmount) (query.where as any).amount.gte = Number(minAmount);
        if (maxAmount) (query.where as any).amount.lte = Number(maxAmount);
    }

    if (attrKey && attrVal) {
        query.where = { ...query.where, attributes: { some: { key: attrKey, value: attrVal } } };
    }

    if (attrsJson) {
        try {
            const attrs = JSON.parse(attrsJson);
            const andClauses = Object.entries(attrs)
                .filter(([_, v]) => v !== '' && v !== null)
                .map(([k, v]) => ({
                    attributes: { some: { key: k, value: String(v) } }
            }));
            if (andClauses.length > 0) {
                query.where = { ...query.where, AND: [...(query.where.AND as any || []), ...andClauses] };
            }
        } catch(e) { console.error('Failed to parse attrs filter', e); }
    }

    let tDbStart = performance.now();
    const rawItems = await db.item.findMany(query);
    
    // Only incur the cost of counting the entire database when loading the first page
    const totalCount = (Number(page) === 1 || !page) 
        ? await db.item.count({ where: query.where }) 
        : 0;
    let tDbEnd = performance.now();

    const items = rawItems.map((item: any) => {
        // Memory cleanup no longer needed here - Prisma handles the omitting natively via the `select` block.
        if (item.duplicateStatus === 'FLAGGED') item.hasDuplicate = true;
        return item;
    });

    // In-memory rank sorting based on query exactness and word-order
    let tSortStart = performance.now();
    if (q && searchTerms.length > 0) {
        items.sort((a, b) => scoreSearchRelevance(b, q, searchTerms, stemmedTerms) - scoreSearchRelevance(a, q, searchTerms, stemmedTerms));
    }
    let tSortEnd = performance.now();

    const prevPage = page == 1 ? 0 : page - 1;
    const nextPage = items.length < count ? 0 : page + 1;
    
    const totalTime = (performance.now() - tStart).toFixed(2);
    console.log(`[Search Telemetry] Total: ${totalTime}ms | ${fetchDocs ? `FTS: ${(tFtsEnd-tFtsStart).toFixed(2)}ms | ` : ''}Prisma DB: ${(tDbEnd-tDbStart).toFixed(2)}ms | JS Sort: ${(tSortEnd-tSortStart).toFixed(2)}ms | Query: "${q}"`);

    return new Response(JSON.stringify({ q, items, documentResults, totalCount, prevPage, nextPage }));
}
