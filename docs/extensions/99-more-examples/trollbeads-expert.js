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
        requiredPlugins: ['trollbeads-expert.js'],
        settings: { 
            allowAutoTaxonomy: false, // We enforce a strict schema below
            bgRemovalEnabled: true,
            bgRemovalPreCrop: true
        },
        // We override the default taxonomy so the UI always has these fields
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
            }
        ]
    });

    // 2. INJECT VISION EXPERTISE (One-Shot Prompt Interception)
    // This runs in memory right before the image is sent to the Vision model.
    addModifier('beforeVisionClassification', (basePrompt, context) => {
        if (context.archetype !== 'trollbeads') return basePrompt;

        const expertPrompt = `
        CRITICAL DOMAIN EXPERTISE: You are a Trollbeads appraiser. 
        Analyze this glass or silver bead. 
        - If it is a known production bead, output its exact commercial name to 'bead_name' (e.g., 'Azure Bubbles').
        - Identify its 'pattern_family' using ONLY these terms: Armadillo, Python, Critter, Prism, Bubbles, Swirl, Footprints, Dichroic.
        - If it lacks a standard production name, classify it as 'OOAK' (One of a Kind) and describe its colors.
        `;
        
        return basePrompt + "\n\n" + expertPrompt;
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
        
        let colors = '';
        try { colors = JSON.parse(item.color_mix || '[]').sort((a,b) => b.pct - a.pct).slice(0, 2).map(c => c.name).join('/'); } catch(e) {}

        // --- A. Generate SEO Resale Title ---
        let seoTitle = "Trollbeads";
        if (beadName && beadName.toUpperCase() !== 'OOAK') {
            seoTitle += ` ${beadName} Glass Bead`;
        } else {
            seoTitle += ` Unique OOAK ${colors} ${pattern || 'Glass'} Bead`;
        }
        await db.item.update({ where: { id: item.id }, data: { title: seoTitle } });
    }, { maxRetries: 1, retryDelayMs: 3000, rateLimitRpm: 15 });
}