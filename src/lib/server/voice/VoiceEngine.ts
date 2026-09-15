import { db } from '$lib/server/database';
import { tokenizeAndStem } from '$lib/server/nlp';

const NUM_WORDS: Record<string, string> = {
    zero: '0', nul: '0',
    one: '1', een: '1',
    two: '2', twee: '2',
    three: '3', drie: '3',
    four: '4', vier: '4',
    five: '5', vijf: '5',
    six: '6', zes: '6',
    seven: '7', zeven: '7',
    eight: '8', acht: '8',
    nine: '9', negen: '9',
    ten: '10', tien: '10',
    eleven: '11', elf: '11',
    twelve: '12', twaalf: '12',
    thirteen: '13', dertien: '13',
    fourteen: '14', veertien: '14',
    fifteen: '15', vijftien: '15',
    sixteen: '16', zestien: '16',
    seventeen: '17', zeventien: '17',
    eighteen: '18', achttien: '18',
    nineteen: '19', negentien: '19',
    twenty: '20', twintig: '20',
    thirty: '30', dertig: '30',
    forty: '40', veertig: '40',
    fifty: '50', vijftig: '50',
    sixty: '60', zestig: '60',
    seventy: '70', zeventig: '70',
    eighty: '80', tachtig: '80',
    ninety: '90', negentig: '90',
    hundred: '100', honderd: '100'
};

const SYMBOL_MAP: Record<string, string> = {
	// Hardware & Science
	'Ω': 'ohm',
	'μ': 'micro',
	'µ': 'micro',
	'ø': 'diameter',
	'²': 'squared',
	'³': 'cubed',
	'°': 'degree',
	// General & Math
	'%': 'percent',
	'&': 'and',
	'+': 'plus',
	'=': 'equals',
	'@': 'at',
	'#': 'number', // often spoken as "number" (e.g., "#2 pencil")
	'½': 'half',
	'¼': 'quarter',
	'¾': 'three quarters',
	// Currency
	'$': 'dollar',
	'€': 'euro',
	'£': 'pound'
};

// Shared text pre-processor that catches symbols before the tokenizer strips them
function preprocessText(text: string): string[] {
	let expanded = text;
	
	// Handle inches and feet shorthand if immediately following a digit
	expanded = expanded.replace(/(\d+)"/g, '$1 inch');
	expanded = expanded.replace(/(\d+)'/g, '$1 foot');

	// Expand compound units so the Database's "10MHz" matches the User's spoken "10 megahertz"
	// Anchored to digits (\d+) so we don't accidentally replace normal words (e.g. "Obama" -> "Obamilliamp")
	expanded = expanded.replace(/(\d+)\s*kΩ/gi, '$1 kilo ohm');
	expanded = expanded.replace(/(\d+)\s*mΩ/gi, '$1 mega ohm');
	expanded = expanded.replace(/(\d+)\s*[µμ]f/gi, '$1 microfarad');
	expanded = expanded.replace(/(\d+)\s*pf/gi, '$1 picofarad');
	expanded = expanded.replace(/(\d+)\s*nf/gi, '$1 nanofarad');
	expanded = expanded.replace(/(\d+)\s*µa/gi, '$1 microamp');
	expanded = expanded.replace(/(\d+)\s*ma\b/gi, '$1 milliamp');
	expanded = expanded.replace(/(\d+)\s*ghz/gi, '$1 gigahertz');
	expanded = expanded.replace(/(\d+)\s*mhz/gi, '$1 megahertz');
	expanded = expanded.replace(/(\d+)\s*khz/gi, '$1 kilohertz');
	expanded = expanded.replace(/(\d+)\s*hz\b/gi, '$1 hertz');
	expanded = expanded.replace(/(\d+)\s*°c/gi, '$1 degrees celsius');
	expanded = expanded.replace(/(\d+)\s*°f/gi, '$1 degrees fahrenheit');

	// Translate symbols into spoken words
	for (const [sym, word] of Object.entries(SYMBOL_MAP)) {
		expanded = expanded.split(sym).join(` ${word} `);
	}

	const cleaned = expanded.toLowerCase().replace(/[-_]+/g, ' ');
	const tokens = cleaned.split(/\s+/).filter(Boolean);
    const digitReplaced = tokens.map(t => NUM_WORDS[t] || t);

    // Fold compound tens + units (e.g., ["60", "4"] -> "64")
    const folded: string[] = [];
    for (let i = 0; i < digitReplaced.length; i++) {
        const curr = digitReplaced[i];
        const next = digitReplaced[i + 1];
        if (curr && next && /^[2-9]0$/.test(curr) && /^[1-9]$/.test(next)) {
            folded.push(String(parseInt(curr, 10) + parseInt(next, 10)));
            i++;
        } else {
            folded.push(curr);
        }
    }
	return folded;
}

function normalizeNumeralsAndCompounds(text: string): string[] {
	const folded = preprocessText(text);
	const variants = new Set<string>();
	variants.add(folded.join(' '));
	variants.add(folded.join('')); // "pine" + "64" -> "pine64"
	return Array.from(variants);
}

function normalizeQuery(text: string): string {
	return preprocessText(text).join(' ');
}

// Translates hardware/math symbols into phonetic words specifically for the TTS engine
function phoneticizeForTTS(text: string): string {
	let phonetic = text;
	phonetic = phonetic.replace(/µf/gi, ' microfarad ');
	
	// 1. Electronics & Engineering (Digit-Anchored Compound Units)
	phonetic = phonetic.replace(/(\d+)\s*kΩ/gi, '$1 kilo-ohm ');
	phonetic = phonetic.replace(/(\d+)\s*mΩ/gi, '$1 mega-ohm '); 
	phonetic = phonetic.replace(/(\d+)\s*[µμ]f/gi, '$1 microfarad ');
	phonetic = phonetic.replace(/(\d+)\s*pf/gi, '$1 picofarad ');
	phonetic = phonetic.replace(/(\d+)\s*nf/gi, '$1 nanofarad ');
	phonetic = phonetic.replace(/(\d+)\s*µa/gi, '$1 microamp ');
	phonetic = phonetic.replace(/(\d+)\s*ma\b/gi, '$1 milliamp ');
	phonetic = phonetic.replace(/(\d+)\s*ghz/gi, '$1 gigahertz ');
	phonetic = phonetic.replace(/(\d+)\s*mhz/gi, '$1 megahertz ');
	phonetic = phonetic.replace(/(\d+)\s*khz/gi, '$1 kilohertz ');
	phonetic = phonetic.replace(/(\d+)\s*hz\b/gi, '$1 hertz ');
	
	// 2. Hardware, Dimensions & Temperatures
	phonetic = phonetic.replace(/(\d+)\s*°c/gi, '$1 degrees Celsius ');
	phonetic = phonetic.replace(/(\d+)\s*°f/gi, '$1 degrees Fahrenheit ');
	phonetic = phonetic.replace(/±/g, ' plus or minus ');
	phonetic = phonetic.replace(/(\d+)\s*×\s*(\d+)/g, '$1 by $2'); // "2×4" -> "2 by 4"
	phonetic = phonetic.replace(/w\//gi, ' with ');
	phonetic = phonetic.replace(/w\/o/gi, ' without ');

	for (const [sym, word] of Object.entries(SYMBOL_MAP)) {
		// TTS engines handle everyday symbols ($ % &) perfectly, but choke on hardware ones
		if (['$', '€', '£', '%', '&', '+', '=', '@', '#'].includes(sym)) continue;
		phonetic = phonetic.split(sym).join(` ${word} `);
	}
	return phonetic.replace(/\s+/g, ' ').trim();
}

export interface VoiceIntent {
    name: string;
    match: (text: string) => RegExpMatchArray | null;
    process: (match: RegExpMatchArray, inventoryId: number) => Promise<{ query: string, spokenReply: string | null, route?: string }>;
}

export const findItems = async (subject: string, inventoryId: number) => {
    const allItems = await db.item.findMany({
        where: { inventoryId },
		select: { 
			id: true, 
			title: true, 
			slug: true, 
			amount: true, 
			semanticTokens: true,
			tags: { select: { name: true } }, 
			locations: { select: { spatialMap: true, container: { select: { name: true } } } },
			photos: { include: { category: { select: { name: true } } } }
		}
    });
    
		const rawSubjTokens = preprocessText(subject);
		const rescuedSubjTokens = rawSubjTokens.filter(t => /\d/.test(t)); // Rescue alphanumerics dropped by stemmers
		const textVariants = normalizeNumeralsAndCompounds(subject);
		const subjectTokens = Array.from(new Set([
			...rescuedSubjTokens,
			...textVariants.flatMap(v => tokenizeAndStem([v]))
		]));

    if (subjectTokens.length === 0) return [];
    
	const cleanSubj = normalizeQuery(subject);
	
    const scoredItems = allItems.map(item => {
        const itemTitle = item.title || '';
			const rescuedTitleTokens = preprocessText(itemTitle).filter(t => /\d/.test(t));
        const titleVariants = normalizeNumeralsAndCompounds(itemTitle);
			const titleTokens = [...rescuedTitleTokens, ...titleVariants.flatMap(v => tokenizeAndStem([v]))];
			
			const tagTokens = item.tags ? item.tags.flatMap((t: any) => {
				return [...preprocessText(t.name).filter(x => /\d/.test(x)), ...tokenizeAndStem([t.name])];
			}) : [];
		
			const locTokens = item.locations ? item.locations.flatMap((l: any) => {
				return [...preprocessText(l.container.name).filter(x => /\d/.test(x)), ...tokenizeAndStem([l.container.name])];
			}) : [];
			
		let semanticTokens: string[] = [];
		if (item.semanticTokens) {
			try { semanticTokens = JSON.parse(item.semanticTokens); } catch(e) {}
		}

		const catTokens = item.photos ? item.photos.flatMap((p: any) => {
			return p.category && p.category.name ? tokenizeAndStem([p.category.name]) : [];
		}) : [];
		
		const allItemTokens = new Set([...titleTokens, ...tagTokens, ...locTokens, ...semanticTokens, ...catTokens]);
		const matches = subjectTokens.filter(t => allItemTokens.has(t)).length;
		
		const cleanTitle = normalizeQuery(itemTitle);
        const exactTitleBonus = (cleanTitle.includes(cleanSubj) || textVariants.some(v => cleanTitle.replace(/\s+/g, '').includes(v.replace(/\s+/g, '')))) ? 5 : 0;
        const score = matches + exactTitleBonus;
		return { item, score, matches, allTokens: Array.from(allItemTokens) };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

	console.group(`🎙️ [VOICE MATCH DEBUG] Query: "${subject}"`);
	console.log(`Tokens required (${subjectTokens.length}):`, subjectTokens);

	if (scoredItems.length === 0) {
		console.log(`❌ No items scored above 0.`);
		console.groupEnd();
		return [];
	}

	console.log(`Top partial/full matches:`);
	scoredItems.slice(0, 5).forEach(x => {
		const matchedTokens = x.allTokens.filter(t => subjectTokens.includes(t));
		console.log(` - [ID: ${x.item.id}] "${x.item.title}": Score ${x.score} | Matches (${x.matches}/${subjectTokens.length}) | Matched tokens:`, matchedTokens);
	});

	// Strict AND matching: if any items contain ALL requested words, return ONLY those items.
	const perfectMatches = scoredItems.filter(x => x.matches === subjectTokens.length);
	if (perfectMatches.length > 0) {
		console.log(`🎯 Found ${perfectMatches.length} perfect matches!`);
		console.groupEnd();
		return perfectMatches.sort((a, b) => b.score - a.score).map(x => x.item);
	}

	// Drop-off filter: If no perfect matches exist, isolate the absolute best partial matches
	const topScore = scoredItems[0].score;
	const topMatches = scoredItems[0].matches;

	// Strict Fallback Guard: Don't return random 38 items just because they matched "10" and "capacitor"
	const requiredMatches = subjectTokens.length <= 2 ? subjectTokens.length : subjectTokens.length - 1;
	if (topMatches < requiredMatches) {
		console.log(`🚫 Rejecting fallback: Best match hit ${topMatches}/${subjectTokens.length} tokens. Required: ${requiredMatches}. Returning 0.`);
		console.groupEnd();
		return [];
	}

	console.log(`⚠️ No perfect matches found. Falling back to highest partial score (${topScore}). Returning ${scoredItems.filter(x => x.score === topScore).length} items.`);
	console.groupEnd();

	return scoredItems.filter(x => x.score === topScore).map(x => x.item);
};

import { getHumanLocationText } from '$lib/client/utils';

const getDirectRoute = (items: any[]) => items.length === 1 ? `/${items[0].id}/${items[0].slug}` : undefined;

const getContainerSummary = (items: any[]): string => {
    const containerNames = new Set<string>();
    for (const item of items) {
        item.locations?.forEach((l: any) => containerNames.add(l.container.name));
    }
    const list = Array.from(containerNames);
    if (list.length === 0) return 'unassigned locations';

    const groups = new Map<string, { displayPrefix: string, padding: number, nums: number[] }>();
    const others: string[] = [];

    for (const name of list) {
        const match = name.trim().match(/^(.*?)(?:[-\s]*)(\d+)$/);
        if (match && match[1].trim().length > 0) {
            const prefix = match[1].trim();
            const numStr = match[2];
            const num = parseInt(numStr, 10);
            const lowerPrefix = prefix.toLowerCase();
            if (!groups.has(lowerPrefix)) groups.set(lowerPrefix, { displayPrefix: prefix, padding: numStr.length, nums: [] });
            groups.get(lowerPrefix)!.nums.push(num);
        } else {
            others.push(name.trim());
        }
    }

    const formattedGroups: string[] = [];
    for (const data of groups.values()) {
        const nums = data.nums.sort((a, b) => a - b);

        if (nums.length === 1) {
            formattedGroups.push(`${data.displayPrefix} ${nums[0].toString().padStart(data.padding, '0')}`);
        } else {
            const first = `${data.displayPrefix} ${nums[0].toString().padStart(data.padding, '0')}`;
            const remainingNums = nums.slice(1);
            const visible = remainingNums.slice(0, 3).map(n => n.toString());
            const overflowCount = remainingNums.length - visible.length;

            if (overflowCount > 0) {
                formattedGroups.push(`${first}, ${visible.join(', ')} and ${overflowCount} others`);
            } else if (visible.length === 1) {
                formattedGroups.push(`${first} and ${visible[0]}`);
            } else {
                formattedGroups.push(`${first}, ${visible.slice(0, -1).join(', ')} and ${visible[visible.length - 1]}`);
            }
        }
    }

    const allResults = [...formattedGroups, ...others];
    if (allResults.length === 0) return 'unassigned locations';
    if (allResults.length === 1) return allResults[0];
    if (allResults.length === 2) return `${allResults[0]} and ${allResults[1]}`;
    const visibleGroups = allResults.slice(0, 2);
    const remainingGroupCount = allResults.length - visibleGroups.length;
    return `${visibleGroups.join(', ')} and ${remainingGroupCount} other ${remainingGroupCount === 1 ? 'location' : 'locations'}`;
};

// --- PLUG & PLAY INTENT REGISTRY ---
const intents: VoiceIntent[] = [
    {
        name: 'ContainerContents', // e.g., "What's in B 007?", "What is inside A 001", "Wat zit er in B 003"
        match: (text) => text.match(/^(?:what's in|what's inside|what is in|what is inside|what do i have in|what do we have in|wat zit er in|wat staat er in)\s+(.+)$/i),
        process: async (match, inventoryId) => {
            const targetQuery = match[1].trim();
            const normTarget = normalizeQuery(targetQuery);
            
            const containers = await db.container.findMany({
                where: { inventoryId },
                include: {
                    items: {
                        include: {
                            item: { select: { id: true, title: true, slug: true } }
                        }
                    }
                }
            });

            const matched = containers.find(c => {
                const normC = normalizeQuery(c.name);
                return normC === normTarget || c.name.toLowerCase().replace(/\s+/g, '') === targetQuery.toLowerCase().replace(/\s+/g, '');
            });
            if (!matched) return { query: targetQuery, spokenReply: `I couldn't find a container named ${targetQuery}.` };
            const items = matched.items.map(i => i.item).filter(i => Boolean(i?.title));
            const route = `/container/${encodeURIComponent(matched.name)}`;
            if (items.length === 0) return { query: targetQuery, spokenReply: `${matched.name} is empty.`, route };
            if (items.length === 1) return { query: targetQuery, spokenReply: `${matched.name} contains ${items[0].title}.`, route };
            if (items.length === 2) return { query: targetQuery, spokenReply: `${matched.name} contains ${items[0].title} and ${items[1].title}.`, route };
            return { query: targetQuery, spokenReply: `${matched.name} contains ${items.length} items, including ${items[0].title} and ${items[1].title}.`, route };
        }
    },
    {
        name: 'Locate', // e.g., "Where do I have an antenna", "Find the ESP32"
		match: (text) => text.match(/^(?:where is|where's|where are|where do i have|where do we have|find|locate|show me|search for|look for|i'm looking for|i am looking for|waar is|waar zijn|zoek|ik zoek|toon)(?:\s+(?:the|my|a|an|de|het|een|some))?\s+(.+)$/i),
        process: async (match, inventoryId) => {
			const subject = match[1].trim();
            const items = await findItems(subject, inventoryId);
            if (items.length === 0) return { query: subject, spokenReply: `I couldn't find any ${subject}.` };
            
            if (items.length === 1) {
                const bestItem = items[0];
                const route = getDirectRoute(items);
                if (bestItem.locations && bestItem.locations.length > 0) {
                    const locs = bestItem.locations.map((l: any) => {
                        let polyMap = null;
                        if (l.spatialMap) {
                            try {
                                const parsed = JSON.parse(l.spatialMap);
                                polyMap = Array.isArray(parsed) ? parsed : parsed.polygon;
                            } catch(e) {}
                        }
                        return getHumanLocationText(polyMap, l.container.name);
                    }).join(' and ');
                    return { query: subject, spokenReply: `I found it in ${locs}.`, route };
                }
                return { query: subject, spokenReply: `I found it, but it doesn't have a location assigned yet.`, route };
            }
            const containerSummary = getContainerSummary(items);
            const idList = items.map((i: any) => i.id).join(',');
            return { query: subject, spokenReply: `I found ${items.length} items in ${containerSummary}.`, route: `/search?q=${encodeURIComponent(subject)}&ids=${idList}` };
        }
    },
    {
        name: 'Stock', // e.g., "Do I have any e-ink displays?", "How many eink displays i have"
        match: (text) => text.match(/^(?:how many|do i have|do we have|i need)(?:\s+(?:any|a|an|some|een))?\s+(.+?)(?:\s+(?:do i have|do we have|i have|we have|in stock|left))?$/i),
        process: async (match, inventoryId) => {
			const subject = match[1].trim();
            const items = await findItems(subject, inventoryId);
            if (items.length === 0) return { query: subject, spokenReply: `No, I don't see any ${subject} in your Trove.` };
            
            const totalStock = items.reduce((sum, item) => sum + (item.amount === null ? 1 : item.amount), 0);
            return { query: subject, spokenReply: `You have ${totalStock} of them.`, route: getDirectRoute(items) };
        }
    },
    {
        name: 'List', // e.g., "Which servos do I have?"
        match: (text) => text.match(/^(?:list|list all|which|what)(?:\s+(?:all|types of|kind of))?\s+(.+?)(?:\s+(?:do i have|do we have|are there|is there))?$/i),
        process: async (match, inventoryId) => {
			const subject = match[1].trim();
            const items = await findItems(subject, inventoryId);
            if (items.length === 0) return { query: subject, spokenReply: `You don't have any ${subject}.` };
            
            const titles = items.map(i => i.title).filter(Boolean);
            if (titles.length <= 3) return { query: subject, spokenReply: `You have ${titles.length}: ${titles.join(', ')}.` };
            return { query: subject, spokenReply: `You have ${titles.length} of them, including ${titles[0]}, ${titles[1]}, and ${titles.length - 2} others.` };
        }
    },
    {
        name: 'Fallback', // Standard keyword search
        match: (text) => text.match(/(.*)/),
        process: async (match, inventoryId) => {
			const subject = match[1].trim();
            const items = await findItems(subject, inventoryId);
            if (items.length === 0) return { query: subject, spokenReply: `I couldn't find anything for ${subject}.` };
            return { query: subject, spokenReply: null, route: getDirectRoute(items) }; 
        }
    }
];

export const processVoiceQuery = async (transcription: string, inventoryId: number) => {
    const cleanText = transcription.toLowerCase().replace(/[.?!]+$/, '').trim();
    for (const intent of intents) {
        const match = intent.match(cleanText);
		if (match) {
			const result = await intent.process(match, inventoryId);
			if (result.spokenReply) result.spokenReply = phoneticizeForTTS(result.spokenReply);
			return result;
		}
    }
    return { query: cleanText, spokenReply: null };
};
