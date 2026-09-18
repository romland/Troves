export const photoTypes = ["Product", "Invoice or receipt", "Information", "Other"];

export const ARCHETYPES = [
	{ 
		id: 'hardware', name: 'Hardware & Equipment', icon: 'bi-tools', 
		examples: 'Cameras, instruments, sports, electronics, tools, laptops, etc.', 
        defaults: [{label: 'AI Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Automatically generates a dynamic schema based on item properties'}],
        settings: { allowAutoTaxonomy: true, enablePaddleOCR: true, duplicateStrategy: 'AUTO_BUMP', containerMode: 'select', defaultView: 'list' },
        promptGuidance: "This is a Hardware & Equipment inventory. Focus on Make, Model, and Specs. Extract things like Form Factor, Power/Connectivity, Purpose.",
        askTrovesExample: "What kind of batteries does this take?"
	},
	{ 
		id: 'apparel', name: 'Apparel & Soft Goods', icon: 'bi-handbag', 
		examples: 'Clothes, shoes, scarves, belts, bags, textiles, etc.', 
        defaults: [{label: 'AI Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Generates schemas'}, {label: 'Deep Scan', icon: 'bi-search', highlight: true, tooltip: 'Analyzes bulk images to find multiple distinct items'}],
        settings: { allowAutoTaxonomy: true, deepScanCollections: true, showColors: true, bgRemovalPreCrop: true },
        promptGuidance: "This is an Apparel & Soft Goods inventory. Focus on Fit, Form, and Fabric. Extract things like Item Style, Target Audience (e.g. Mens, Womens), Size, Material.",
        askTrovesExample: "What material is this made of?"
	},
	{ 
		id: 'media', name: 'Media & Publications', icon: 'bi-book', 
		examples: 'Books, comics, CDs, DVDs, vinyls, games, etc.', 
        defaults: [{label: 'No BG Removal', icon: 'bi-image-fill', highlight: false, tooltip: 'Leaves the background intact, better for books and flat media'}],
        settings: { bgRemovalEnabled: false, defaultView: 'list' },
        promptGuidance: "This is a Media & Publications inventory. Focus on Identity and Authorship. Ignore physical materials. Extract things like Format (e.g. Hardcover, DVD), Genre, Release Era.",
        askTrovesExample: "Who is the author or publisher?"
	},
	{ 
		id: 'consumables', name: 'Consumables & Pantry', icon: 'bi-basket', 
		examples: 'Whiskys, wines, groceries, canned veggies, spices, etc', 
        defaults: [{label: 'Standard', icon: 'bi-gear', highlight: false, tooltip: 'Standard default extraction'}],
        settings: { deepScanCollections: true, bgRemovalEnabled: false, duplicateStrategy: 'AUTO_BUMP', enableNotebook: false, enableDocuments: false },
        promptGuidance: "This is a Consumables & Pantry inventory. Focus on Shelf-life and Volume. Extract things like Volume/Weight, Packaging Type (e.g. Can, Box), Diet/Type.",
        askTrovesExample: "What is the expiration date?"
	},
	{ 
		id: 'collectibles', name: 'Valuables/Collectibles', icon: 'bi-gem', 
		examples: 'Coins, stamps, cards, sculptures, toys, Lego, posters, pet rocks, etc.', 
        defaults: [{label: 'AI Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Generates schemas'}, {label: 'Deep Scan', icon: 'bi-search', highlight: true, tooltip: 'Analyzes bulk images'}],
        settings: { allowAutoTaxonomy: true, deepScanCollections: true, trackQuantity: false, showColors: true },
        promptGuidance: "This is a Collectibles & Valuables inventory. Focus on Rarity, Era, and Condition. Extract things like Franchise/Subject, Era/Year, Material/Finish.",
        askTrovesExample: "What year was this made?"
	},
	{ 
		id: 'natural', name: 'Natural Specimens', icon: 'bi-tree', 
		examples: 'Plants, rocks, crystals, seashells, fossils, etc.', 
        defaults: [{label: 'AI Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Generates schemas'}],
        settings: { allowAutoTaxonomy: true, bgRemovalPreCrop: true, trackQuantity: false, showExif: true },
        promptGuidance: "This is a Natural Specimens inventory. Focus on Classification and Origin. Ignore brands or model numbers. Extract things like Species/Mineral Type, Form, Pattern.",
        askTrovesExample: "What species is this?"
	},
	{ 
		id: 'generic', name: 'Generic / Mixed', icon: 'bi-box-seam', 
		examples: 'A mix of various unrelated items.', 
        defaults: [{label: 'Standard', icon: 'bi-gear', highlight: false, tooltip: 'Standard default extraction'}],
        settings: {},
        promptGuidance: "",
        askTrovesExample: "What kind of batteries does this take?"
	}
];

export function getArchetypeSettings(archetypeId: string) {
    const arch = ARCHETYPES.find(a => a.id === archetypeId) || ARCHETYPES[6];
    return arch.settings;
}

export function getArchetypePromptGuidance(archetypeId: string) {
    const arch = ARCHETYPES.find(a => a.id === archetypeId) || ARCHETYPES[6];
    return arch.promptGuidance;
}

export function getArchetypeExampleQuestion(archetypeId: string) {
    const arch = ARCHETYPES.find(a => a.id === archetypeId) || ARCHETYPES[6];
    return arch.askTrovesExample;
}
