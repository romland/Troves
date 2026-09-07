import { db } from '$lib/server/database';
import { taskManager } from './taskManager';
import { BASE_COLORS } from './colors';
import { generateText } from './ai/index';



const eavResponseSchema = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Machine name, e.g., form_factor' },
            uiLabel: { type: 'string', description: 'Layman/everyday human label. E.g., use "Fabric" instead of "textile_construction", or "Worn On" instead of "body_zone"' },
            type: { type: 'string', enum: ['string', 'enum', 'boolean', 'number'] },
            options: { type: 'array', items: { type: 'string' }, description: 'Array of enums if type is enum' },
                matchWeight: { type: 'string', enum: ['STRICT_DEDUPE', 'FUZZY_SECONDARY', 'METADATA_ONLY', 'SUBJECTIVE_TEXT'] },
            extractionMethod: { type: 'string', enum: ['VISION_STRICT', 'HUMAN_REQUIRED', 'HYBRID'] }
        },
        required: ['name', 'uiLabel', 'type', 'matchWeight', 'extractionMethod']
    }
};

export async function getActiveSchema(inventoryId: number, categoryId?: number | null, fetchAll: boolean = false) {
    const inv = await db.inventory.findUnique({ where: { id: inventoryId } });
    const archetype = (inv as any)?.archetype || 'generic';
    const allowAutoTaxonomy = (inv as any)?.allowAutoTaxonomy ?? false;

    // If auto-taxonomy is disabled for this inventory, return no extractions
    if (!allowAutoTaxonomy) return [];

    const whereClause: any = { inventoryId };
    if (!fetchAll) {
        whereClause.OR = [{ categoryId: null }, ...(categoryId ? [{ categoryId }] : [])];
    }
    
    const dbFields = await db.templateField.findMany({ 
        where: whereClause,
        include: { category: { select: { name: true } } }
    });

    const globalBaseFields = [];

    // Only natural specimens totally lack a concept of a manufacturer or creator.
    if (archetype !== 'natural') {
        globalBaseFields.push({ id: undefined, name: 'brand_or_creator', uiLabel: archetype === 'media' ? 'Creator/Publisher' : 'Brand/Maker', type: 'string', options: null, matchWeight: 'STRICT_DEDUPE', extractionMethod: 'HYBRID', categoryId: null });
    }
    // Media rarely benefits from deduplicating based on the color of the spine.
    if (archetype !== 'media') {
        globalBaseFields.push({ id: undefined, name: 'color_mix', uiLabel: 'Colors (Proportional)', type: 'object', options: BASE_COLORS, matchWeight: 'COLOR_PROPORTION', extractionMethod: 'VISION_STRICT', categoryId: null });
    }
    if (archetype !== 'natural') {
        globalBaseFields.push({ id: undefined, name: 'distinctive_blemishes_or_wear', uiLabel: 'Condition/Wear', type: 'string', options: null, matchWeight: 'STRICT_DEDUPE', extractionMethod: 'HYBRID', categoryId: null });
    }

    return [
        ...globalBaseFields,
        ...dbFields.map(f => ({ id: f.id, name: f.name, uiLabel: f.uiLabel, type: f.type, options: f.options ? JSON.parse(f.options) : null, matchWeight: f.matchWeight, extractionMethod: f.extractionMethod, categoryId: f.categoryId, categoryName: (f as any).category?.name }))
    ];
}

export async function bootstrapInventorySchema(inventoryId: number, domainName: string) {
    const inv = await db.inventory.findUnique({ where: { id: inventoryId } });
    if (!(inv as any)?.allowAutoTaxonomy) return false;

    const taskId = taskManager.start('global', inventoryId, `Bootstrapping taxonomy rules for "${domainName}"`);
    console.log(`[Taxonomy Engine] 🚀 Starting schema generation for Trove ID ${inventoryId}: "${domainName}"`);
    
    const archetype = (inv as any)?.archetype || 'generic';
    let archetypeGuidance = "";
    switch (archetype) {
        case 'media': archetypeGuidance = "This is a Media & Publications inventory. Focus on Identity and Authorship. Ignore physical materials. Extract things like Format (e.g. Hardcover, DVD), Genre, Release Era."; break;
        case 'apparel': archetypeGuidance = "This is an Apparel & Soft Goods inventory. Focus on Fit, Form, and Fabric. Extract things like Item Style, Target Audience (e.g. Mens, Womens), Size, Material."; break;
        case 'hardware': archetypeGuidance = "This is a Hardware & Equipment inventory. Focus on Make, Model, and Specs. Extract things like Form Factor, Power/Connectivity, Purpose."; break;
        case 'consumables': archetypeGuidance = "This is a Consumables & Pantry inventory. Focus on Shelf-life and Volume. Extract things like Volume/Weight, Packaging Type (e.g. Can, Box), Diet/Type."; break;
        case 'collectibles': archetypeGuidance = "This is a Collectibles & Valuables inventory. Focus on Rarity, Era, and Condition. Extract things like Franchise/Subject, Era/Year, Material/Finish."; break;
        case 'natural': archetypeGuidance = "This is a Natural Specimens inventory. Focus on Classification and Origin. Ignore brands or model numbers. Extract things like Species/Mineral Type, Form, Pattern."; break;
    }

    try {
        // const prompt = `You are a Principal Data Architect designing a strict EAV taxonomy for an inventory tracking: "${domainName}".
        // const prompt = `You are a Principal Data Architect designing a strict EAV taxonomy for an inventory tracking: "${domainName}".
        // const prompt = `You are a Principal Data Architect designing a strict Entity-Attribute-Value (EAV) taxonomy for an inventory tracking: "${domainName}".
        // The user describes this inventory as: "${inv.description || 'A general collection'}".
        const prompt = `You are a Principal Data Architect designing a strict Entity-Attribute-Value (EAV) taxonomy.
The user was asked what this inventory contains, and they answered: "${domainName}".
If this answer is vague (like "stuff in the shed" or "boxes"), generate a broad, generic tracking schema. If it is highly specific (like "vintage stamps"), generate a bespoke schema.

${archetypeGuidance}

We need BOTH human-friendly specific terms AND abstract groupings for "similar item" matching.

STRUCTURAL REQUIREMENTS (Output EXACTLY 5-6 attributes):

1. ONE "Form Factor" or "Item Sub-Type" (extractionMethod: "VISION_STRICT").
   - The specific, human-friendly noun for the item.
   - E.g., Garment Style (T-Shirt, Hoodie, Jeans), Tool Type (Wrench, Saw).

2. ONE "Macro Functional Group" (extractionMethod: "VISION_STRICT").
   - The abstract grouping of WHERE it goes or WHAT it does, to group interchangeable items together.
   - E.g., Worn On (Torso, Legs, Feet), Primary Action (Cutting, Fastening, Measuring).

3. TWO "Universal Material or Finish Traits" (extractionMethod: "VISION_STRICT" or "HYBRID").
   - E.g., Fabric, Pattern, Surface Finish, Primary Material.

4. ONE or TWO "Human Context" fields (extractionMethod: "HUMAN_REQUIRED").
   - Context the camera cannot accurately know without reading a physical tag.
   - E.g., Size, Storage Capacity, Material. ALWAYS use type "enum" for sizes with exhaustive options.

CRITICAL BANS:
- NO "Color", "Brand", "Manufacturer", "Creator", or "Publisher" fields (these are tracked globally). DO NOT output any field containing these words.
- UNIVERSAL APPLICABILITY: These fields will be applied to EVERY item in the inventory. Do NOT generate part-specific geometry (like sleeves, ports, lenses, or pages) because not every item in the domain has those parts. Keep them abstract.
- 'matchWeight' MUST be "STRICT_DEDUPE", "FUZZY_SECONDARY", "SUBJECTIVE_TEXT", or "METADATA_ONLY".
- For ALL enums, provide a HIGHLY EXHAUSTIVE 'options' array. Format the options nicely (e.g. 'Athletic Fit' instead of 'athletic'). For item types/forms, generate at least 15-25 common values to prevent cold-start issues. For sizes, include a full standard range.

ADAPT TO USER INTENT: Adjust your specificity based on the user's description and archetype. If it's a generic inventory, keep fields broad. If the description implies a highly specific sub-niche (e.g., "Vintage Belts"), generate hyper-specific fields (e.g., "Buckle Type", "Notch Count").`;
        const resText = await generateText('You are a helpful assistant.', prompt, true, eavResponseSchema, `Trove Bootstrap: ${domainName}`, undefined, 'TAXONOMY');
        const fields = JSON.parse(resText);
        console.log(`[Taxonomy Engine] 🟢 Received ${fields.length} schema fields for "${domainName}". Saving to DB:`, JSON.stringify(fields, null, 2));
            
        for (const f of fields) {
            const existing = await db.templateField.findFirst({
                where: { inventoryId, categoryId: null, name: f.name }
            });
            if (!existing) {
                const created = await db.templateField.create({
                    data: { name: f.name, uiLabel: f.uiLabel, type: f.type, options: f.options ? JSON.stringify(f.options) : null, matchWeight: f.matchWeight, extractionMethod: f.extractionMethod, inventoryId, categoryId: null }
                });
                console.log(`[Taxonomy Engine] 💾 Inserted TemplateField Rule [Inventory ID ${inventoryId}]:`, created);
            }
        }
        return true;
    } catch (e) {
        console.error(`[Taxonomy Engine] 🔴 Trove schema bootstrap failed for ${domainName}:`, e);
        throw e;
    } finally {
        taskManager.end(taskId);
    }
}

export async function bootstrapCategorySchema(categoryId: number, categoryName: string, inventoryId: number) {
    const inv = await db.inventory.findUnique({ where: { id: inventoryId } });
    if (!(inv as any)?.allowAutoTaxonomy) return false;

    const taskId = taskManager.start('global', inventoryId, `Bootstrapping category schema for "${categoryName}"`);
    console.log(`[Taxonomy Engine] 🚀 Starting category schema generation for ID ${categoryId}: "${categoryName}"`);

    try {
        const existingCategories = await db.category.findMany({ where: { inventoryId }, select: { name: true } });
        const existingCatNames = existingCategories.map(c => c.name).join(', ');

        const prompt = `You are a Principal Data Architect. Define 1-3 critical visual attributes needed to uniquely identify and deduplicate an item specifically in the sub-category: "${categoryName}".
            
            CONTEXT (THE ZOOM LEVEL):
            The overarching inventory archetype is: "${(inv as any)?.archetype || 'generic'}".
            Existing categories in this vault: [${existingCatNames}].
            
            CRITICAL RULES:
            1. RELATIVE RESOLUTION (MACRO vs MICRO): Gauge the "Zoom Level" of this vault. 
                - High Variance (MACRO): If existing categories are vastly different (e.g., 'shirts', 'hardware', 'books'), DO NOT generate micro-attributes like 'fastening_mechanism'. Stick to macro identifiers.
                - Low Variance (MICRO): If existing categories are highly clustered (e.g., 'sneakers', 'boots', 'loafers'), you are operating at MICRO resolution. You MUST generate specific micro-attributes (e.g., 'sole_pattern', 'heel_height') because every item is structurally similar.
            2. Categorize EVERY attribute with an extractionMethod:
               - "VISION_STRICT": 100% undeniable visual geometry or physical form.
               - "HYBRID": Visible text, brands, or labels that might be obscured.
                - "HUMAN_REQUIRED": Context the camera CANNOT reliably know without reading a hidden tag, using a measuring tool, or chemical testing (e.g., size, exact dimensions, weight, capacity, internal material).
            3. For ALL enums, provide a HIGHLY EXHAUSTIVE 'options' array.
            4. NO REDUNDANCY: Do not generate "Color", "Color Mix", or "Brand" fields as they are tracked globally.`;

        const resText = await generateText('You are a helpful assistant.', prompt, true, eavResponseSchema, `Category Bootstrap: ${categoryName}`, undefined, 'TAXONOMY');
        const fields = JSON.parse(resText);
        console.log(`[Taxonomy Engine] 🟢 Received ${fields.length} fields for category "${categoryName}". Saving to DB:`, JSON.stringify(fields, null, 2));

        const { calculateKeySimilarity } = await import('$lib/server/matcher');
        const allExistingFields = await db.templateField.findMany({ where: { inventoryId } });

        for (const f of fields) {
            let bestSim = 0;
            let matchedField: any = null;
            
            for (const existing of allExistingFields) {
                const sim = calculateKeySimilarity(f.name, existing.name);
                if (sim > bestSim) { bestSim = sim; matchedField = existing; }
            }
            
            if (bestSim > 0.82 && matchedField) {
                if (matchedField.categoryId === null) {
                    console.log(`[Taxonomy Engine] 🛑 Vetoed local field '${f.name}': Already exists globally as '${matchedField.name}'`);
                    continue; // Drop it completely to protect the global namespace
                } else {
                    console.log(`[Taxonomy Engine] 🔗 Snapped proposed field '${f.name}' to existing local trait '${matchedField.name}'`);
                    f.name = matchedField.name; // Standardize the key across categories
                }
            }

            const existing = await db.templateField.findFirst({
                where: { inventoryId, categoryId, name: f.name }
            });
            if (!existing) {
                const created = await db.templateField.create({
                    data: { name: f.name, uiLabel: f.uiLabel, type: f.type, options: f.options ? JSON.stringify(f.options) : null, matchWeight: f.matchWeight, extractionMethod: f.extractionMethod, inventoryId, categoryId }
                });
                console.log(`[Taxonomy Engine] 💾 Inserted TemplateField Rule [Category ID ${categoryId}]:`, created);
            }
        }
    } catch (e) {
        console.error(`[Taxonomy Engine] 🔴 Category schema bootstrap failed for ${categoryName}:`, e);
    } finally {
        taskManager.end(taskId);
    }
}

export async function beautifyTaxonomyRules(inventoryId: number) {
    const fields = await db.templateField.findMany({ where: { inventoryId } });
    if (fields.length === 0) return false;

    const taskId = taskManager.start('global', inventoryId, `Beautifying taxonomy labels`);
    try {
        const payload = fields.map(f => ({
            id: f.id, name: f.name, uiLabel: f.uiLabel, options: f.options ? JSON.parse(f.options) : null
        }));

        const prompt = `You are a UX writer improving an inventory app. 
Translate the following system taxonomy fields into everyday, layman's terms (suitable for a teenager or general adult, not overly technical).
- "uiLabel": Rewrite the machine "name" into a simple, natural label (e.g., "textile_construction" -> "Fabric", "body_zone" -> "Worn On", "garment_style" -> "Style").
- "options": If present, format the enum values to look nice and readable (e.g., "synthetic" -> "Synthetic", "button-down" -> "Button-Down").
Output exactly the same JSON array structure, preserving the "id" integer, but updating "uiLabel" and "options".`;

        const jsonSchema = {
            type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, uiLabel: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, nullable: true } }, required: ['id', 'uiLabel'] }
        };
        const resText = await generateText('You are a UX writer improving an inventory app.', prompt + '\n\n' + JSON.stringify(payload), true, jsonSchema, `Beautify Taxonomy`, undefined, 'TAXONOMY');
        const improved = JSON.parse(resText);
            
        for (const field of improved) {
            await db.templateField.update({
                where: { id: field.id },
                data: { uiLabel: field.uiLabel, ...(field.options ? { options: JSON.stringify(field.options) } : {}) }
            });
        }
        return true;
    } catch (e) {
        console.error("Beautify failed:", e);
    } finally {
        taskManager.end(taskId);
    }
}
