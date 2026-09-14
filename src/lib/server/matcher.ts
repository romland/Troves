import { BASE_COLORS_RGB, parseColorMix } from '$lib/shared/colors';
import { tokenizeAndStem } from '$lib/server/nlp';
export const normalizeStr = (s: string) => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, '').trim();

export function getSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0.0;
    if (s1 === s2) return 1.0;
    const len1 = s1.length, len2 = s2.length;
    if (!len1 || !len2) return 0.0;
    const dp = Array.from({length: len1 + 1}, () => new Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i-1] === s2[j-1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
        }
    }
    return 1 - (dp[len1][len2] / Math.max(len1, len2));
}

export function tokenizeKey(key: string): string[] {
    return key.toLowerCase().replace(/[^a-z0-9]+/g, '_').split('_').filter(t => t.length > 0);
}

export function shareRootToken(keyA: string, keyB: string): boolean {
    const tkA = tokenizeKey(keyA);
    const tkB = tokenizeKey(keyB);
    if (tkA.length === 0 || tkB.length === 0) return false;
    
    const intersect = tkA.filter(t => tkB.includes(t));
    if (intersect.length >= 2) return true;
    if (intersect.length === 1 && (tkA[0] === tkB[0] || tkA[0] === intersect[0] || tkB[0] === intersect[0])) return true;
    return false;
}

export function calculateKeySimilarity(keyA: string, keyB: string): number {
    const normA = normalizeStr(keyA).replace(/[^a-z0-9]/g, '');
    const normB = normalizeStr(keyB).replace(/[^a-z0-9]/g, '');
    let sim = getSimilarity(normA, normB);
    if (normA.length > 5 && normB.length > 5) {
        if (normA.includes(normB) || normB.includes(normA)) sim = Math.max(sim, 0.85);
    }
    const tkA = tokenizeKey(keyA);
    const tkB = tokenizeKey(keyB);
    if (tkA.length > 0 && tkB.length > 0) {
        const intersect = tkA.filter(t => tkB.includes(t));
        const isSubset = intersect.length === Math.min(tkA.length, tkB.length);
        if (isSubset && intersect.length >= 2) {
            sim = Math.max(sim, 0.90);
        } else if (isSubset && intersect.length === 1 && Math.max(tkA.length, tkB.length) === 2 && tkA[0] === tkB[0]) {
            sim = Math.max(sim, 0.85);
        }
    }
    return sim;
}

function rgbToLab(rgb: [number, number, number]): [number, number, number] {
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    
    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
    
    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

function colorDistance(c1: string, c2: string): number {
    const rgb1 = Object.entries(BASE_COLORS_RGB).find(([k]) => k.toLowerCase() === c1.toLowerCase())?.[1];
    const rgb2 = Object.entries(BASE_COLORS_RGB).find(([k]) => k.toLowerCase() === c2.toLowerCase())?.[1];
    if (!rgb1 || !rgb2) return 1; // max distance if unknown
    
    /*
    // Calculate Euclidean distance. Max distance in 3D RGB space is sqrt(255^2 * 3) ~= 441.67
    const dist = Math.sqrt(Math.pow(rgb1[0]-rgb2[0], 2) + Math.pow(rgb1[1]-rgb2[1], 2) + Math.pow(rgb1[2]-rgb2[2], 2));
    return dist / 441.67;
    */

    const lab1 = rgbToLab(rgb1);
    const lab2 = rgbToLab(rgb2);
    // We weight Lightness (L) by 0.5 to be more forgiving of shadows and exposure differences.
    const deltaE = Math.sqrt(Math.pow((lab1[0]-lab2[0]) * 0.5, 2) + Math.pow(lab1[1]-lab2[1], 2) + Math.pow(lab1[2]-lab2[2], 2));
    
    // A Delta E of ~65 represents completely different colors.
    return Math.min(1.0, Math.pow(deltaE / 65.0, 1.5));
}

function calculateColorMixSimilarity(mixAStr: string | any, mixBStr: string | any): number {
    const mixA = parseColorMix(mixAStr);
    const mixB = parseColorMix(mixBStr);
    if (!mixA.length || !mixB.length) return 0;

    const remA: Record<string, number> = {};
    const remB: Record<string, number> = {};

    mixA.forEach(m => remA[m.name] = m.pct);
    mixB.forEach(m => remB[m.name] = m.pct);

    let similarity = 0;
    // 1. Exact matches (Intersection of identical keys)
    for (const color of Object.keys(remA)) {
        if (remB[color]) {
            const overlap = Math.min(remA[color], remB[color]);
            similarity += overlap;
            remA[color] -= overlap;
            remB[color] -= overlap;
        }
    }

    // 2. Greedy soft matches (Euclidean Distance on remainder)
    const keysA = Object.keys(remA).filter(k => remA[k] > 0);
    const keysB = Object.keys(remB).filter(k => remB[k] > 0);
    for (const cA of keysA) {
        for (const cB of keysB) {
            if (remA[cA] > 0 && remB[cB] > 0) {
                const matchSim = 1 - colorDistance(cA, cB);
                // Pair if they share at least some hue family relation
                if (matchSim > 0.3) { 
                    const overlap = Math.min(remA[cA], remB[cB]);
                    similarity += overlap * matchSim;
                    remA[cA] -= overlap;
                    remB[cB] -= overlap;
                }
            }
        }
    }
    return similarity;
}

export const isUseless = (s: any) => {
    if (!s) return true;
    if (typeof s === 'object') return Object.keys(s).length === 0;
    if (String(s) === '[object Object]') return true;
    const norm = String(s).trim().toLowerCase();
    if (norm === '{}') return true;
    return norm === 'null' || norm === 'undefined' || norm === 'unknown' || norm === 'n/a' || norm === 'none';
};

export function computeIdfMap(dbItems: any[]): Map<string, number> {
    const idfMap = new Map<string, number>();
    const dfMap = new Map<string, number>();
    const totalDocs = dbItems.length;
    dbItems.forEach(item => {
            let tokens: string[] = [];
            if (item.semanticTokens) {
                try { tokens = JSON.parse(item.semanticTokens); } catch(e) {}
            }
            const graphic = item.attributes?.find((a: any) => a.key === 'prominent_text_or_graphic')?.value;
            const wear = item.attributes?.find((a: any) => a.key === 'distinctive_blemishes_or_wear')?.value;
            
            const extraTokens = tokenizeAndStem([graphic, wear]);
            const uniqueTokens = new Set<string>([...tokens, ...extraTokens]);
            
            uniqueTokens.forEach(t => dfMap.set(t, (dfMap.get(t) || 0) + 1));
    });
    dfMap.forEach((df, token) => idfMap.set(token, Math.log((totalDocs + 1) / (df + 1)) + 1));
    return idfMap;
}

function calculateWeightedJaccard(tokensA: string[], tokensB: string[], idfMap?: Map<string, number>): number {
    if (tokensA.length === 0 || tokensB.length === 0) return 0.0;
    let intersection = 0, union = 0;
    const unique = new Set([...tokensA, ...tokensB]);
    for (const t of unique) {
        const w = idfMap?.get(t) || 1.0;
        union += w;
        if (tokensA.includes(t) && tokensB.includes(t)) intersection += w;
    }
    return union > 0 ? intersection / union : 0;
}

export interface ScanContext {
    tokens: string[];
    colorMix: any;
    title: string;
    description: string;
    rawText: string;
    category?: string;
    prominentTextOrGraphic?: string | null;
    distinctiveWear?: string | null;
    extractedAttributes?: any;
    archetype?: string;
}

/**
 * Safely evaluates text identity, factoring in generic placeholders dynamically.
 * Detects strong composites (Title + Subtitle) which are critical for media items.
 */
export function evaluateTextIdentity(scanTitle: string, scanDesc: string, dbTitle: string, dbDesc: string, scanCategory?: string) {
    const normScanTitle = normalizeStr(scanTitle || '');
    const normDbTitle = normalizeStr(dbTitle || '');
    const normScanDesc = normalizeStr(scanDesc || '');
    const normDbDesc = normalizeStr(dbDesc || '');
    const normCategory = normalizeStr(scanCategory || '');

    // A title is generic if it is a known placeholder, too short, or heavily overlaps with its own category name.
    // Clothes example: Title "T-Shirt", Category "T-Shirt" -> GENERIC (Rely on visual traits instead)
    // Electronics example: Title "Capacitor", Category "Capacitor" -> GENERIC (Rely on visual traits instead)
    const genericFallbacks = ['newitem', 'defaultproduct', 'unknown', 'unknownitem', 'item', 'product'];
    const isGenericTitle = 
        normScanTitle.length < 3 || 
        genericFallbacks.some(t => normScanTitle.includes(t)) || 
        genericFallbacks.some(t => normDbTitle.includes(t)) ||
        (normCategory.length > 3 && (normScanTitle.includes(normCategory) || normCategory.includes(normScanTitle) || getSimilarity(normScanTitle, normCategory) > 0.8));

    let isStrongTextMatch = false;
    let isCompositeVeto = false;
    let titleSim = 0;

    if (!isGenericTitle && normDbTitle && normScanTitle) {
        titleSim = getSimilarity(normDbTitle, normScanTitle);
        if (normDbTitle === normScanTitle || titleSim > 0.85 || (normScanTitle.length > 5 && normDbTitle.includes(normScanTitle)) || (normDbTitle.length > 5 && normScanTitle.includes(normDbTitle))) {
            isStrongTextMatch = true;

            // Composite Subtitle/Author Check
            if (normScanDesc && normDbDesc) {
                const descSim = getSimilarity(normDbDesc, normScanDesc);
                // If descriptions clash completely, veto it (e.g., Queen vs Journey)
                if (descSim < 0.4 && !normDbDesc.includes(normScanDesc) && !normScanDesc.includes(normDbDesc)) {
                    isCompositeVeto = true;
                }
            }
        }
    }

    return { isStrongTextMatch, isCompositeVeto, isGenericTitle, titleSim, normScanTitle, normDbTitle, normScanDesc, normDbDesc };
}

export function computeMatch(
    scan: ScanContext,
    dbItem: any, 
    idfMap: Map<string, number>, 
): { isMatch: boolean, confidence: number, score: number, debugTrace: string[], sharedAttributes: {key: string, value: string}[] } {
    let strictFailures = 0;
    let fuzzyMatches = 0;
    let fuzzyMismatches = 0;
    const debugTrace: string[] = [];
    const sharedAttributes: { key: string, value: string }[] = [];

    // --- 1. CONTEXT AWARENESS (Archetype & Density) ---
    const archetype = scan.archetype || 'generic';
    const isMedia = archetype === 'media';
    const isLegacyItem = !dbItem.attributes || dbItem.attributes.length === 0;

    if (isMedia) debugTrace.push(`[ARCHETYPE] Media Mode Active (Strict Lexical Routing)`);
    if (isLegacyItem) debugTrace.push(`[DENSITY] Legacy/Sparse DB Item Detected (Relaxed Fuzzy Penalties)`);

    // --- 2. TEXT IDENTITY & COMPOSITE VETO ---
    const textEval = evaluateTextIdentity(scan.title, scan.description, dbItem.title, dbItem.description, scan.category);
    
    if (textEval.isCompositeVeto) {
        return { isMatch: false, confidence: 0, score: -999, debugTrace: [`[COMPOSITE VETO] Titles match but subtitles/authors clash ('${textEval.normScanDesc}' vs '${textEval.normDbDesc}')`], sharedAttributes: [] } as any;
    }

    if (isMedia) {
        if (textEval.isStrongTextMatch) {
            return { isMatch: true, confidence: 0.99, score: 999, debugTrace: [`[COMPOSITE PASS] Media Mode: Strong Title+Subtitle match.`], sharedAttributes: [] } as any;
        } else {
            return { isMatch: false, confidence: 0, score: -100, debugTrace: [`[MEDIA VETO] Media Mode requires strong text composite match. Titles differ.`], sharedAttributes: [] } as any;
        }
    }

    if (textEval.isStrongTextMatch) {
        debugTrace.push(`[TEXT MATCH] Strong title match (Sim=${textEval.titleSim.toFixed(2)})`);
    }

    const dbCat = dbItem.photos?.[0]?.category?.name?.toLowerCase();
    const sCat = scan.category?.toLowerCase();
    if (dbCat && sCat && dbCat !== sCat) {
        if (!dbCat.includes(sCat) && !sCat.includes(dbCat)) {
            return { isMatch: false, confidence: 0, debugTrace: [`[CATEGORY MISMATCH] DB='${dbCat}' != Scan='${sCat}'`] } as any;
        } else {
            debugTrace.push(`[CATEGORY ALIAS] DB='${dbCat}' loosely matches Scan='${sCat}'`);
        }
    }
    
    // --- 3. COLOR MIX GATE ---
    const dbColorAttr = dbItem.attributes?.find((a: any) => a.key === 'color_mix')?.value;
    if (dbColorAttr && scan.colorMix) {
        const sim = calculateColorMixSimilarity(dbColorAttr, typeof scan.colorMix === 'string' ? scan.colorMix : JSON.stringify(scan.colorMix));
        if (sim >= 0.85) {
            fuzzyMatches += 1.5;
            debugTrace.push(`[COLOR MATCH] Strong similarity: ${sim.toFixed(2)}`);
            sharedAttributes.push({ key: 'color_mix', value: typeof scan.colorMix === 'string' ? scan.colorMix : JSON.stringify(scan.colorMix) });
        } else if (sim >= 0.65) {
            fuzzyMatches += 0.5;
            debugTrace.push(`[COLOR MATCH] Partial similarity: ${sim.toFixed(2)}`);
            sharedAttributes.push({ key: 'color_mix', value: typeof scan.colorMix === 'string' ? scan.colorMix : JSON.stringify(scan.colorMix) });
        } else if (sim < 0.15) {
            strictFailures += 1;
            debugTrace.push(`[COLOR CLASH] Colors are completely distinct (Sim=${sim.toFixed(2)})`);
        } else {
            fuzzyMismatches += 2;
            debugTrace.push(`[COLOR MISMATCH] Similarity too low: ${sim.toFixed(2)}`);
        }
    } else if (dbColorAttr && !scan.colorMix) {
        strictFailures += 0.5;
        debugTrace.push(`[COLOR MISSING] DB has color mix, Scan missed it`);
    }

    // --- 4. IDENTITY DISCRIMINATORS (Graphics, Wear, and Printed Specs) ---
    // These are HIGH VALUE. If they clash, it is almost certainly a different item.
    // Sanitize LLM hallucinations like "null", "none", "unknown" before checking truthiness
    const scanGraphicVal = isUseless(scan.prominentTextOrGraphic) ? null : scan.prominentTextOrGraphic;
    const dbGraphicVal = isUseless(dbItem.attributes?.find((a: any) => a.key === 'prominent_text_or_graphic')?.value) ? null : dbItem.attributes?.find((a: any) => a.key === 'prominent_text_or_graphic')?.value;
    const scanWearVal = isUseless(scan.distinctiveWear) ? null : scan.distinctiveWear;
    const dbWearVal = isUseless(dbItem.attributes?.find((a: any) => a.key === 'distinctive_blemishes_or_wear')?.value) ? null : dbItem.attributes?.find((a: any) => a.key === 'distinctive_blemishes_or_wear')?.value;

    const evaluateTrait = (scanVal: string | null, dbVal: string | null, traitName: string, clashIsFatal: boolean) => {
        if (scanVal && dbVal) {
            const normScan = normalizeStr(scanVal);
            const normDb = normalizeStr(dbVal);
            const normCat = normalizeStr(scan.category || '');
            
            const tokensA_full = tokenizeAndStem([scanVal]);
            const tokensB_full = tokenizeAndStem([dbVal]);
            
            // Strip category names so item types don't inflate similarity.
            // Clothes example: "Adidas T-Shirt" and "Nike T-Shirt" shouldn't match just because they both say "T-Shirt".
            // Electronics example: "Samsung Capacitor" and "Rubycon Capacitor" shouldn't match just because of the word "Capacitor".
            const tokensA = normCat ? tokensA_full.filter(t => !normCat.includes(t)) : tokensA_full;
            const tokensB = normCat ? tokensB_full.filter(t => !normCat.includes(t)) : tokensB_full;

            let sim = 0;
            if (tokensA.length === 0 || tokensB.length === 0) {
                sim = calculateWeightedJaccard(tokensA_full, tokensB_full);
            } else {
                sim = calculateWeightedJaccard(tokensA, tokensB);
            }

            if (normScan.includes(normDb) || normDb.includes(normScan) || sim > 0.50) {
                fuzzyMatches += traitName === 'GRAPHIC' ? 2 : 1;
                debugTrace.push(`[${traitName} MATCH] Strong similarity (Jaccard=${sim.toFixed(2)}): '${scanVal}' vs '${dbVal}'`);
                sharedAttributes.push({ key: traitName, value: scanVal });
            } else if (sim > 0.35) { 
                // Raised threshold. 
                // Clothes: "AC Milan" vs "FC Bayern" will drop below this.
                // Electronics: "Raspberry Pi 4" vs "Raspberry Pi 3" will drop below this, avoiding false merges of similar models.
                fuzzyMatches += 0.5;
                debugTrace.push(`[${traitName} MATCH] Partial similarity (Jaccard=${sim.toFixed(2)}): '${scanVal}' vs '${dbVal}'`);
                sharedAttributes.push({ key: traitName, value: scanVal });
            } else {
                if (clashIsFatal) strictFailures += 1;
                else fuzzyMismatches += 1.5;
                debugTrace.push(`[${clashIsFatal ? 'VETO' : 'CLASH'}: ${traitName}] Distinct clash (Jaccard=${sim.toFixed(2)}): '${scanVal}' vs '${dbVal}'`);
            }
        } else if ((scanVal && !dbVal) || (!scanVal && dbVal)) {
            fuzzyMismatches += 0.5;
            debugTrace.push(`[VETO: ${traitName}] Presence mismatch`);
        }
    };

    // Graphics are highly distinct (Logos, Text, Specific Markings). If they clash, it's a different item.
    // Clothes: "Nike Swoosh" vs "Adidas Three Stripes" -> FATAL VETO
    // Electronics: "10k Ohm" vs "4.7k Ohm", or "Sony" vs "Samsung" -> FATAL VETO
    evaluateTrait(scanGraphicVal, dbGraphicVal, 'GRAPHIC', true);
    evaluateTrait(scanWearVal, dbWearVal, 'WEAR', false);

    // --- 5. ONTOLOGY & STRUCTURAL ATTRIBUTES ---
    // Ensures custom dynamic schema fields contribute to deduplication!
    // Clothes example: 'sleeve_length' or 'neckline_type'.
    // Electronics example: 'package_type' (e.g., 'SMD', 'Through-hole'), 'voltage_rating', or 'resistance'.
    let attrMatchCount = 0;
    if (scan.extractedAttributes && dbItem.attributes) {
        let scanAttrs: any = {};
        try {
            scanAttrs = typeof scan.extractedAttributes === 'string' ? JSON.parse(scan.extractedAttributes) : scan.extractedAttributes;
        } catch(e) {}
        
        for (const [key, scanVal] of Object.entries(scanAttrs)) {
            if (['color_mix', 'prominent_text_or_graphic', 'distinctive_blemishes_or_wear'].includes(key)) continue;

            const dbAttr = dbItem.attributes.find((a: any) => a.key === key);
            if (dbAttr && !isUseless(scanVal) && !isUseless(dbAttr.value)) {
                const normScanAttr = normalizeStr(String(scanVal));
                const normDbAttr = normalizeStr(String(dbAttr.value));
                
                if (normScanAttr === normDbAttr || normScanAttr.includes(normDbAttr) || normDbAttr.includes(normScanAttr)) {
                    attrMatchCount += 1;
                    debugTrace.push(`[ATTR MATCH] ${key}`);
                    sharedAttributes.push({ key, value: String(scanVal) });
                } else {
                    const sim = getSimilarity(normScanAttr, normDbAttr);
                    if (sim < 0.4) {
                        fuzzyMismatches += 0.5; // Penalize, but don't instantly veto for one wrong trait
                        debugTrace.push(`[ATTR CLASH] ${key}: '${scanVal}' vs '${dbAttr.value}'`);
                    }
                }
            }
        }
    }
    
    // THE CAP: Structural attributes max out at 1.5 points. 
    // Structure dictates WHAT an item is, not WHICH item it is.
    // Clothes example: You cannot force a match just by sharing "polyester", "short sleeve", and "v-neck".
    // Electronics example: You cannot force a match just because two components are both "10V", "Through-hole", "Radial" capacitors. They need identity (graphic/text) or specific titles.
    if (attrMatchCount > 0) {
        const cappedBonus = Math.min(1.5, attrMatchCount * 0.25);
        fuzzyMatches += cappedBonus;
        debugTrace.push(`[ATTR BONUS] ${attrMatchCount} structural attributes matched (+${cappedBonus.toFixed(2)} pts)`);
    }

    // --- 6. NLP TF-IDF JACCARD (The Baseline Physical Check) ---
    let dbTokens: string[] = [];
    try { dbTokens = dbItem.semanticTokens ? JSON.parse(dbItem.semanticTokens) : tokenizeAndStem([dbItem.title, dbItem.description]); } catch(e) {}

    const safeScanTokens = Array.isArray(scan.tokens) ? scan.tokens : []; // Failsafe
    
    const ignoreTokens = new Set(['new', 'item', 'untitled', 'product', 'default', 'unknown']);
    const cleanDbTokens = dbTokens.filter(t => !ignoreTokens.has(t));
    const cleanScanTokens = safeScanTokens.filter(t => !ignoreTokens.has(t));
    
    const jaccard = calculateWeightedJaccard(cleanDbTokens, cleanScanTokens, idfMap);
    
    if (jaccard >= 0.45) { // Lowered slightly from 0.50 to catch 49.4% near-misses
        fuzzyMatches += 3.0;
        debugTrace.push(`[NLP MATCH] Strong semantic physical overlap (${(jaccard * 100).toFixed(1)}%)`);
    } else if (jaccard >= 0.25) {
        fuzzyMatches += 1.0;
        debugTrace.push(`[NLP PARTIAL] Weak semantic physical overlap (${(jaccard * 100).toFixed(1)}%)`);
    } else if (safeScanTokens.length > 0 && dbTokens.length > 0) {
        if (isLegacyItem) {
            debugTrace.push(`[NLP IGNORED] Legacy item bypassed strict NLP penalty (${(jaccard * 100).toFixed(1)}%)`);
        } else {
            fuzzyMismatches += 1.5;
            debugTrace.push(`[NLP CLASH] Physical traits diverge significantly (${(jaccard * 100).toFixed(1)}%)`);
        }
    }

    // --- 7. SPECIFIC TITLE CLASH VETO ---
    // If titles are NOT generic placeholders, and they fundamentally differ, kill the match.
    // Clothes example: "AC Milan Home Kit" vs "FC Bayern Away Kit".
    // Electronics example: "Arduino Uno" vs "ESP32 NodeMCU".
    if (!textEval.isGenericTitle && !textEval.isStrongTextMatch) {
        if (textEval.titleSim < 0.35 && !textEval.normDbTitle.includes(textEval.normScanTitle) && !textEval.normScanTitle.includes(textEval.normDbTitle)) {
            strictFailures += 1;
            debugTrace.push(`[VETO: TITLE] Specific identities clash ('${scan.title}' vs '${dbItem.title}')`);
        }
    }

    let isMatch = false;

    // --- FINAL SCORING RESOLUTION ---
    if (strictFailures >= 1) {
        isMatch = false;
        debugTrace.push(`[RESULT] Failed: Missing required strict traits (strictFailures=${strictFailures})`);
    } else if (fuzzyMismatches >= 2) {
        isMatch = false;
        debugTrace.push(`[RESULT] Failed: Active physical trait clashes (mismatches=${fuzzyMismatches})`);
    } else if (textEval.isStrongTextMatch && !textEval.isGenericTitle) {
        isMatch = true;
        debugTrace.push(`[RESULT] Pass: Strong Text Match overrides minor trait clashes`);
    } else if (fuzzyMatches >= 3 && fuzzyMismatches <= 0.5) {
        isMatch = true;
        debugTrace.push(`[RESULT] Pass: Strong fuzzy match (${fuzzyMatches.toFixed(1)} pts)`);
    } else if (fuzzyMatches >= 4.5 && fuzzyMismatches <= 1.0) {
        isMatch = true;
        debugTrace.push(`[RESULT] Pass: Overwhelming fuzzy match (${fuzzyMatches.toFixed(1)} pts)`);
    } else {
        isMatch = false;
        debugTrace.push(`[RESULT] Failed: Not enough evidence to match (${fuzzyMatches.toFixed(1)} pts, ${fuzzyMismatches.toFixed(1)} clashes)`);
    }

    const score = fuzzyMatches - strictFailures - (fuzzyMismatches * 1.5) + (textEval.isStrongTextMatch ? 2 : 0);

    // Cast as any because previous files using it expect exactly { isMatch, confidence }. Adding debugTrace is safe as long as we type-cast locally where used.
    return { isMatch, confidence: isMatch ? 0.95 : 0, score, debugTrace, sharedAttributes } as any;
}

export function buildScanContextFromDbItem(item: any, archetype: string = 'generic'): ScanContext {
    let parsedTokens: string[] = [];
    try { parsedTokens = item.semanticTokens ? JSON.parse(item.semanticTokens) : tokenizeAndStem([item.title, item.description]); } catch(e) {}
    return {
        tokens: parsedTokens,
        colorMix: item.attributes?.find((a: any) => a.key === 'color_mix')?.value,
        title: item.title || '',
        description: item.description || '',
        rawText: '',
        category: item.photos?.[0]?.category?.name,
        prominentTextOrGraphic: item.attributes?.find((a: any) => a.key === 'prominent_text_or_graphic')?.value,
        distinctiveWear: item.attributes?.find((a: any) => a.key === 'distinctive_blemishes_or_wear')?.value,
        extractedAttributes: item.attributes?.reduce((acc: any, a: any) => ({ ...acc, [a.key]: a.value }), {}),
        archetype
    };
}

export function buildDuplicateDetails(dbItem: any, match: any) {
    return {
        id: dbItem.id, slug: dbItem.slug, title: dbItem.title, createdAt: dbItem.createdAt,
        categoryName: dbItem.photos?.[0]?.category?.name || 'Uncategorized',
        thumbPath: dbItem.photos?.[0]?.thumbPath || dbItem.photos?.[0]?.orgPath || null,
        orgPath: dbItem.photos?.[0]?.orgPath || null,
        locationName: dbItem.locations?.[0]?.container?.name || 'Unassigned',
        sharedAttributes: match.sharedAttributes,
        debugTrace: match.debugTrace,
        dbAttributes: dbItem.attributes,
        dbLlmAnalysis: dbItem.photos?.[0]?.llmAnalysis ? (() => { try { return JSON.parse(dbItem.photos[0].llmAnalysis); } catch(e) { return null; } })() : null
    };
}

export function findBestMatch(
    scan: ScanContext,
    dbItems: any[], 
    idfMap?: Map<string, number>
) {
    let bestMatch = null;
    let highestScore = -999;
    const actualIdfMap = idfMap || computeIdfMap(dbItems);
    for (const dbItem of dbItems) {
        const match = computeMatch(scan, dbItem, actualIdfMap);
        if (match.isMatch && match.score > highestScore) {
            highestScore = match.score;
            bestMatch = { dbItem, match };
        }
    }
    return bestMatch;
}

export function findRelatedItems(
    item: any,
    dbItems: any[],
    idfMap?: Map<string, number>,
    archetype: string = 'generic',
    limit: number = 4
) {
    const actualIdfMap = idfMap || computeIdfMap(dbItems);
    const scanCtx = buildScanContextFromDbItem(item, archetype);
    const related = [];
    const itemLocations = item.locations?.map((l: any) => l.containerId) || [];
    const itemTags = item.tags?.map((t: any) => t.id) || [];
    const itemCat = item.photos?.[0]?.categoryId;

    for (const dbItem of dbItems) {
        let score = 0;

        // 1. Spatial Proximity (+2.5 points for sharing a container)
        if (itemLocations.length > 0 && dbItem.locations?.length > 0) {
            const sharedLocs = dbItem.locations.filter((l: any) => itemLocations.includes(l.containerId));
            if (sharedLocs.length > 0) score += 2.5;
        }

        // 2. Tag Intersection (+2.0 points per shared tag)
        if (itemTags.length > 0 && dbItem.tags?.length > 0) {
            const sharedTags = dbItem.tags.filter((t: any) => itemTags.includes(t.id));
            score += sharedTags.length * 2.0;
        }

        // 3. Category Overlap (+1.0 point - baseline context, but not enough to match alone)
        const dbCat = dbItem.photos?.[0]?.categoryId;
        if (itemCat && dbCat && itemCat === dbCat) score += 1.0;

        // 4. Attribute Overlap (+1.5 point per exact KV match e.g. same Brand, Color, Material)
        if (item.attributes && dbItem.attributes) {
            for (const attr of item.attributes) {
                const dbAttr = dbItem.attributes.find((a: any) => a.key === attr.key);
                if (dbAttr && dbAttr.value === attr.value && !isUseless(attr.value)) score += 1.5;
            }
        }

        // 5. Semantic Token Overlap (Up to +4.0 points for very strong physical/text overlap)
        let dbTokens: string[] = [];
        try { dbTokens = dbItem.semanticTokens ? JSON.parse(dbItem.semanticTokens) : []; } catch(e) {}
        if (scanCtx.tokens.length > 0 && dbTokens.length > 0) {
            score += calculateWeightedJaccard(scanCtx.tokens, dbTokens, actualIdfMap) * 4.0;
        }

        // Must meet at least 3.0 points (e.g. Same Category + Same Container, or Same Category + Brand Match + NLP)
        if (score >= 3.0) { 
            related.push({ item: dbItem, score });
        }
    }
    return related.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.item);
}

export async function runDuplicateSweep(itemId: number, inventoryId: number) {
    const { db } = await import('$lib/server/database');
    const item = await db.item.findUnique({ where: { id: itemId }, include: { attributes: true, photos: { include: { category: true } } }});
    if (!item || item.duplicateStatus === 'DISMISSED') return;

    const allItems = await db.item.findMany({
        where: { inventoryId, id: { not: itemId } },
        include: { attributes: true, locations: { include: { container: true } }, photos: { include: { category: true } } }
    });

    const idfMap = computeIdfMap(allItems);
    const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { archetype: true } });
    const archetype = vault?.archetype || 'generic';

    const scanCtx = buildScanContextFromDbItem(item, archetype);
    const bestMatch = findBestMatch(scanCtx, allItems, idfMap);

    if (bestMatch && bestMatch.match.isMatch) {
        await db.item.update({ where: { id: itemId }, data: { duplicateStatus: 'FLAGGED' } });
        if (bestMatch.dbItem.duplicateStatus !== 'DISMISSED' && bestMatch.dbItem.duplicateStatus !== 'FLAGGED') {
            await db.item.update({ where: { id: bestMatch.dbItem.id }, data: { duplicateStatus: 'FLAGGED' } });
        }
    }
}

export async function healDuplicateStatuses(inventoryId: number) {
    const { db } = await import('$lib/server/database');
    const flaggedItems = await db.item.findMany({
        where: { inventoryId, duplicateStatus: 'FLAGGED' },
        include: { attributes: true, locations: { include: { container: true } }, photos: { include: { category: true } } }
    });

    if (flaggedItems.length === 0) return;

    const allItems = await db.item.findMany({
        where: { inventoryId },
        include: { attributes: true, locations: { include: { container: true } }, photos: { include: { category: true } } }
    });
    const idfMap = computeIdfMap(allItems);
    const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { archetype: true } });
    const archetype = vault?.archetype || 'generic';

    for (const item of flaggedItems) {
        const scanCtx = buildScanContextFromDbItem(item, archetype);
        const others = allItems.filter(i => i.id !== item.id);
        const bestMatch = findBestMatch(scanCtx, others, idfMap);
        if (!bestMatch || !bestMatch.match.isMatch) {
            await db.item.update({ where: { id: item.id }, data: { duplicateStatus: 'NONE' } });
        }
    }
}

export async function retroactiveDuplicateSweep(inventoryId: number) {
    const { db } = await import('$lib/server/database');
    console.log(`[Sweep] Starting retroactive duplicate sweep for Vault ${inventoryId}`);

    // Reset all currently FLAGGED back to NONE so we start fresh. Leave DISMISSED alone.
    await db.item.updateMany({
        where: { inventoryId, duplicateStatus: 'FLAGGED' },
        data: { duplicateStatus: 'NONE' }
    });

    const allItems = await db.item.findMany({
        where: { inventoryId },
        include: { attributes: true, locations: { include: { container: true } }, photos: { include: { category: true } } }
    });

    const idfMap = computeIdfMap(allItems);
    const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { archetype: true } });
    const archetype = vault?.archetype || 'generic';

    let flaggedCount = 0;
    for (const item of allItems) {
        if (item.duplicateStatus === 'DISMISSED') continue;
        const scanCtx = buildScanContextFromDbItem(item, archetype);
        const others = allItems.filter(i => i.id !== item.id);
        const bestMatch = findBestMatch(scanCtx, others, idfMap);
        
        if (bestMatch && bestMatch.match.isMatch) {
            await db.item.update({ where: { id: item.id }, data: { duplicateStatus: 'FLAGGED' } });
            flaggedCount++;
        }
    }
    console.log(`[Sweep] Retroactive sweep complete. Flagged ${flaggedCount} duplicates.`);
}

export function findBestMatchesForBatch(
    scannedItems: any[],
    dbItems: any[],
    idfMap?: Map<string, number>,
    archetype: string = 'generic'
) {
    console.log(`\n[MATCH-DEBUG] 🚀 ========================================================`);
    console.log(`[MATCH-DEBUG] 🚀 findBestMatchesForBatch STARTED`);
    console.log(`[MATCH-DEBUG] 🚀 SCANNED ITEMS: ${scannedItems.length} | DB ITEMS: ${dbItems.length}`);

    const actualIdfMap = idfMap || computeIdfMap(dbItems);
    const idUsage = new Map<number, number>();
    const inCollection: any[] = [];
    const newToYou: any[] = [];
    const annotatedScannedItems: any[] = [];

    for (const item of scannedItems) {
        console.log(`[MATCH-DEBUG] ------------------------------------------------`);
        console.log(`[MATCH-DEBUG] 🔎 SCANNING: "${item.title}"`);

        let parsedTokens: string[] = [];
        if (Array.isArray(item.tokens)) {
            parsedTokens = item.tokens;
        } else {
            parsedTokens = tokenizeAndStem([
                item.title,
                item.subtitle,
                item.description,
                item.rawText,
                ...(item.physical_traits || [])
            ]);
        }

        const scanCtx: ScanContext = {
            tokens: parsedTokens,
            colorMix: item.color_mix || item.extractedAttributes?.color_mix,
            title: item.title || '',
            description: item.description || item.subtitle || '',
            rawText: item.rawText || '',
            category: item.category,
            prominentTextOrGraphic: item.prominent_text_or_graphic || item.extractedAttributes?.prominent_text_or_graphic,
            distinctiveWear: item.distinctive_blemishes_or_wear || item.extractedAttributes?.distinctive_blemishes_or_wear,
            extractedAttributes: item.extractedAttributes,
            archetype
        };
        
        console.log(`[MATCH-DEBUG] 🧩 CONTEXT BUILT:`, JSON.stringify(scanCtx, null, 2));

        let bestMatch = null;
        let highestScore = -999;
        item._debugComparisons = [];

        for (const dbItem of dbItems) {
            const used = idUsage.get(dbItem.id) || 0;
            const available = dbItem.amount || 1;
            
            console.log(`[MATCH-DEBUG]   🆚 Checking DB Item ID ${dbItem.id} ("${dbItem.title}") | Used: ${used} | Available: ${available}`);

            if (used >= available) {
                console.log(`[MATCH-DEBUG]   ⏩ SKIPPING ID ${dbItem.id}: Stock fully consumed.`);
                continue; // Respect stock quantities!
            }

            const match = computeMatch(scanCtx, dbItem, actualIdfMap);

            // Debug trace preservation for UI
            const dbCat = dbItem.photos?.[0]?.category?.name?.toLowerCase();
            const sCat = scanCtx.category?.toLowerCase();
            if (match.isMatch || (dbCat && sCat && (dbCat === sCat || dbCat.includes(sCat) || sCat.includes(dbCat))) || (scanCtx.title && dbItem.title && (dbItem.title.toLowerCase().includes(scanCtx.title.toLowerCase()) || scanCtx.title.toLowerCase().includes(dbItem.title.toLowerCase())))) {
                item._debugComparisons.push({ dbTitle: dbItem.title, score: match.score, trace: match.debugTrace });
            }

            console.log(`[MATCH-DEBUG]   🧮 Score: ${match.score} | isMatch: ${match.isMatch}`);
            if (!match.isMatch) {
                 console.log(`[MATCH-DEBUG]   ❌ Trace:\n      ${match.debugTrace?.join('\n      ')}`);
            }

            if (match.isMatch && match.score > highestScore) {
                highestScore = match.score;
                bestMatch = { dbItem, match };
            }
        }

        if (bestMatch) {
            const { dbItem, match } = bestMatch;
            idUsage.set(dbItem.id, (idUsage.get(dbItem.id) || 0) + 1);

            const matchNorm = normalizeStr(dbItem.title);
            const dbTotalAmount = dbItems.filter(i => normalizeStr(i.title) === matchNorm).reduce((sum, i) => sum + (i.amount || 1), 0);

            item.isDuplicate = true;
            item.duplicateItemDetails = buildDuplicateDetails(dbItem, match);
            
            console.log(`[MATCH-DEBUG] ✅ WINNER: Linked "${item.title}" to DB Item ID ${dbItem.id} ("${dbItem.title}") with Score ${match.score}`);

            inCollection.push({
                ...item,
                matchedItem: { id: dbItem.id, title: dbItem.title, slug: dbItem.slug, amount: dbItem.amount, dbTotalAmount, locationName: dbItem.locations?.[0]?.container?.name || null, thumbPath: dbItem.photos?.[0]?.thumbPath || dbItem.photos?.[0]?.orgPath || null, categoryName: dbItem.photos?.[0]?.category?.name || 'Uncategorized' }
            });
        } else {
            item.isDuplicate = false;
            item.duplicateItemDetails = null;
            console.log(`[MATCH-DEBUG] ⚠️ NO MATCH. "${item.title}" is New to You.`);
            newToYou.push(item);
        }
        
        annotatedScannedItems.push(item);
    }
    
    console.log(`[MATCH-DEBUG] 🏁 findBestMatchesForBatch COMPLETED`);
    console.log(`[MATCH-DEBUG] 🏁 In Trove: ${inCollection.length} | New: ${newToYou.length}`);
    console.log(`[MATCH-DEBUG] 🚀 ========================================================\n`);

    return { inCollection, newToYou, annotatedScannedItems, idUsage };
}