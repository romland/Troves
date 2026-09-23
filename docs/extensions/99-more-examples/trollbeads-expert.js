/**
 * @name Trollbeads Expert
 * @description Attempts to figure out Trollbeads (very untested), it also adds a new Trove archetype
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 */
/**
 * TROVES PLUGIN: TROLLBEADS EXPERT & RESELLER SUITE
 *
 * At the moment this is just an example plugin to hook into archetypes.
 * 
 * Features:
 * 1. Registers the "Trollbeads" archetype with custom EAV defaults.
 * 2. Modifies the Vision model prompt in-flight to use trollbead terminology.
 * 3. Builds a title automatically.
 */
export default function register({ registerArchetype, addModifier, on, sysLog, logActivity, env, fetch, itemOps, db }) {
    
    // 1. REGISTER THE ARCHETYPE
    // This injects "Trollbeads" into the UI dropdown when creating a new Trove.
    registerArchetype({
        id: 'trollbeads',
        name: 'Trollbeads Reseller',
        icon: 'bi-gem',
        contentsHint: "Trollbeads, charms, jewelry",
        examples: "Glass beads, silver cores, gold charms, OOAKs, bracelets.",
        requiredPlugins: ['trollbeads-expert.js'],
        askTrovesExample: "Is this a Universal or Classic core?",
        defaults: [
            { label: 'Bead Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Enforces strict commercial terminology for Trollbeads.' },
            { label: 'Macro Mode', icon: 'bi-search', highlight: true, tooltip: 'Tuned to look for LAA / 925S hallmarks.' }
        ],
        settings: { 
            // We set this to true so the LLM can generate ANY OTHER random attributes
            // we didn't hardcode below (like "Theme" or "Collection").
            allowAutoTaxonomy: true, 
            bgRemovalEnabled: true,
            bgRemovalPreCrop: true
        },
        // We enforce the base strict taxonomy so the UI always has these fields
        taxonomy: [
            { 
                name: 'bead_name', 
                uiLabel: 'Commercial Name', 
                type: 'string', 
                matchWeight: 'STRICT_DEDUPE', 
                extractionMethod: 'VISION_STRICT'
            },
            { 
                name: 'pattern_family', 
                uiLabel: 'Pattern', 
                type: 'enum', 
                options: ['Armadillo', 'Python', 'Critter', 'Prism', 'Bubbles', 'Swirl', 'Footprints', 'Dichroic', 'OOAK'], 
                matchWeight: 'FUZZY_SECONDARY', 
                extractionMethod: 'VISION_STRICT'
            },
            {
                name: 'core_size', 
                uiLabel: 'Core Size', 
                type: 'enum', 
                options: ['Small Core', 'Universal Core'], 
                matchWeight: 'METADATA_ONLY', 
                extractionMethod: 'HYBRID'
            },
            {
                name: 'material', 
                uiLabel: 'Material', 
                type: 'enum', 
                options: ['Silver', 'Glass', 'Gold', 'Amber', 'Copper', 'Leather', 'Mixed'], 
                matchWeight: 'FUZZY_SECONDARY', 
                extractionMethod: 'VISION_STRICT'
			},
			{
				name: 'main_color', 
				uiLabel: 'Primary Glass Color', 
				type: 'string', 
				matchWeight: 'FUZZY_SECONDARY', 
				extractionMethod: 'VISION_STRICT'
			},
			{
				name: 'hallmark_verified', 
				uiLabel: 'LAA / 925S Hallmark', 
				type: 'boolean', 
				matchWeight: 'METADATA_ONLY', 
				extractionMethod: 'VISION_STRICT'
            }
        ]
    });

    // 2. INJECT VISION EXPERTISE (One-Shot Prompt Interception)
    // This runs in memory right before the image is sent to the Vision model.
	addModifier('beforeVisionClassification', (promptObj, context) => {
		if (context.archetype !== 'trollbeads') return promptObj;

        const expertPrompt = `
You are an elite Trollbeads appraiser and archivist. You possess encyclopedic knowledge of Lise Aagaard's designs.
Analyze this bead/charm systematically:

1. MATERIAL & CORE: 
    - Is it Murano Glass, Sterling Silver, 18k Gold, Amber, or Gemstone?
    - Look at the center hole (the core). A 'Small Core' is flush or barely protrudes. A 'Universal Core' has a wide, distinct silver tube protruding on both sides (designed to fit Pandora bracelets).

2. HALLMARKS (AUTHENTICITY):
    - Look extremely closely at the silver core or the edge of silver charms. Authentic Trollbeads are stamped 'LAA 925S' (post-2006) or just '925S' / 'LAA'. Gold is 'LAA 750'.
    - If you see this stamp, set 'hallmark_verified' to true and transcribe the exact text into 'prominent_text_or_graphic'.

3. GLASS BEAD CHEAT SHEET (If Glass):
    - Armadillo: Layered, overlapping scale-like dots (like a 3D brick pattern).
    - Python: Wavy, snake-skin lines.
    - Prism: Faceted glass, triangular geometric cuts on the surface.
    - Bubbles/Drops: Internal trapped air bubbles (e.g., 'Azure Bubbles' is earthy brown/blue with deep bubbles).
    - Dichroic: Highly reflective, glittery, metallic foil embedded in the glass.
    - Flowers: Distinct petals, often embedded deep in clear glass (e.g., 'Desert Rose', 'Milan', 'Traces').
    - OOAK (One of a Kind): Often features 6 dots/buds, unique color combos not in the main catalog, or experimental swirls. If it looks non-standard, name it "OOAK" and describe the colors thoroughly.

4. SILVER CHARM MOTIFS (If Silver):
    - Identify the specific sculptural subject (e.g., Troll, Knot, Animal, Letter, Mythological figure).

OUTPUT INSTRUCTIONS:
- Extract the exact commercial 'bead_name' if known. If unknown, describe its visual motif vividly (e.g., 'Silver Floral Knot' or 'Blue Dot OOAK').
- Strictly categorize its 'pattern_family' and 'material'.
`;
        
        promptObj.domainExpertise.push(expertPrompt);
        return promptObj;
    });

    // 3. POST-PROCESSING (SEO Titles & Grounded Web Search)
    on('onItemProcessed', async (payload) => {
        if (!payload.intent?.isNew) return;
        
        const item = await db.item.findUnique({ where: { id: payload.entity.id }, include: { attributes: true } });
        const inv = await db.inventory.findUnique({ where: { id: item.inventoryId }, select: { archetype: true } });
        
        if (inv?.archetype !== 'trollbeads') return;

        sysLog.info(`[Trollbeads] Processing post-scan data for item ${item.id}`);

        const beadName = itemOps.getFuzzyAttribute(item, ['bead_name', 'commercial name']);
        const pattern = itemOps.getFuzzyAttribute(item, ['pattern', 'pattern_family']);
		const coreSize = itemOps.getFuzzyAttribute(item, ['core_size', 'core']) || '';
		const isVerified = itemOps.getFuzzyAttribute(item, ['hallmark_verified', 'laa']) === 'true';
        
        let colors = '';
        try { colors = JSON.parse(item.color_mix || '[]').sort((a,b) => b.pct - a.pct).slice(0, 2).map(c => c.name).join('/'); } catch(e) {}

        // --- A. Generate SEO Resale Title ---
        let seoTitle = "Trollbeads";
		if (isVerified) seoTitle += " Authentic";
		
        if (beadName && beadName.toUpperCase() !== 'OOAK') {
			seoTitle += ` ${beadName} ${coreSize} Bead`;
        } else {
			seoTitle += ` Unique OOAK ${colors} ${pattern || 'Glass'} ${coreSize} Bead`;
        }
		
		// Clean up double spaces if variables were empty
		seoTitle = seoTitle.replace(/\s+/g, ' ').trim();
		
		await db.item.update({ where: { id: item.id }, data: { title: seoTitle } });
    }, { maxRetries: 1, retryDelayMs: 3000, rateLimitRpm: 15 });
}
