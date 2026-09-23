/**
 * @name Horology Expert
 * @description Contributes the "Watches" archetype. Enforces a strict, comprehensive horological vocabulary (Movements, Complications, Materials) and teaches the Voice Engine watch collector nicknames (Speedy, Batman, Pepsi) so voice searches actually work.
 * @author Troves Community
 * @version 1.0.0
 * @updated 2026-09-23
 * @github https://github.com/romland/troves
 */
export default function register({ registerArchetype, addModifier, registerVoiceVocabulary }) {
    
    // Lock down the Schema with a comprehensive watch collector's taxonomy
    registerArchetype({
        id: 'watches',
        name: 'Horology / Watches',
        icon: 'bi-watch',
        contentsHint: "Mechanical watches, quartz watches, straps, horology tools",
        examples: "Rolex Submariner, Omega Speedmaster, Seiko SKX, spring bar tools, NATO straps.",
        requiredPlugins: ['horology-expert.js'],
        // askTrovesExample: "What complications are visible on this dial?",
        askTrovesExample: "How much is it worth?",
        defaults: [
            { label: 'Horology Taxonomy', icon: 'bi-diagram-3', highlight: true, tooltip: 'Enforces strict commercial terminology for watches (Complications, Movements, Case Material).' },
            { label: 'Collector Slang', icon: 'bi-mic', highlight: true, tooltip: 'Understands watch collector nicknames via voice search (e.g., Speedy, Batman, Pepsi).' }
        ],
        settings: { 
            allowAutoTaxonomy: false, 
            deepScanCollections: true 
        },
        taxonomy: [
            { name: 'brand', uiLabel: 'Brand', type: 'string', matchWeight: 'STRICT_DEDUPE', extractionMethod: 'VISION_STRICT' },
            { name: 'model', uiLabel: 'Model', type: 'string', matchWeight: 'STRICT_DEDUPE', extractionMethod: 'VISION_STRICT' },
            { name: 'reference_number', uiLabel: 'Reference Number', type: 'string', matchWeight: 'STRICT_DEDUPE', extractionMethod: 'VISION_STRICT' },
            { name: 'movement_type', uiLabel: 'Movement', type: 'enum', options: '["Automatic", "Manual Wind", "Quartz", "Spring Drive", "Tuning Fork"]', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'case_material', uiLabel: 'Case Material', type: 'enum', options: '["Stainless Steel", "Yellow Gold", "White Gold", "Rose Gold", "Titanium", "Platinum", "Ceramic", "Bronze", "Carbon", "PVD/DLC"]', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'case_size_mm', uiLabel: 'Case Size (mm)', type: 'number', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'HUMAN_REQUIRED' },
            { name: 'dial_color', uiLabel: 'Dial Color', type: 'string', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'bezel_type', uiLabel: 'Bezel', type: 'string', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'bracelet_strap', uiLabel: 'Bracelet/Strap', type: 'string', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'complications', uiLabel: 'Complications', type: 'string', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'crystal_material', uiLabel: 'Crystal', type: 'enum', options: '["Sapphire", "Mineral", "Acrylic / Hesalite", "Hardlex"]', matchWeight: 'METADATA_ONLY', extractionMethod: 'HUMAN_REQUIRED' },
            { name: 'water_resistance_m', uiLabel: 'Water Resistance (m)', type: 'number', matchWeight: 'METADATA_ONLY', extractionMethod: 'HUMAN_REQUIRED' },
            { name: 'year_of_production', uiLabel: 'Year', type: 'number', matchWeight: 'METADATA_ONLY', extractionMethod: 'HUMAN_REQUIRED' },
            { name: 'box_and_papers', uiLabel: 'Box & Papers', type: 'enum', options: '["Full Set", "Watch & Box", "Watch & Papers", "Watch Only (Naked)"]', matchWeight: 'METADATA_ONLY', extractionMethod: 'HUMAN_REQUIRED' }
        ]
    });

    // Tune the Vision LLM
    addModifier('beforeVisionClassification', (promptObj, context) => {
        if (context.archetype !== 'watches') return promptObj;

        promptObj.domainExpertise.push(
            "You are an expert horologist and watch appraiser.",
            "Extract exact dial text to identify the 'brand', 'model', and 'reference_number' (if printed on dial/caseback).",
            "Look closely at the dial layout to identify 'complications' (e.g., Chronograph, Moonphase, Tourbillon, Perpetual Calendar, Date window, Day-Date, GMT hand).",
            "Determine the 'movement_type'. If the dial says 'Automatic', 'Chronometer', or features a visible escapement (open heart/display back), classify accordingly. If a digital display is visible or dial says 'Quartz', classify as Quartz.",
            "Identify 'case_material' visually. Silver-tones are usually 'Stainless Steel' unless hallmarks are visible. Two-tone is a mix.",
            "Identify 'bezel_type' (e.g., Fluted, Smooth, Diver/Count-up, GMT/24-hour, Tachymeter).",
            "Identify 'bracelet_strap' style (e.g., Oyster, Jubilee, President, Leather, NATO, Rubber, Milanese)."
        );
        return promptObj;
    });

    // Teach the Voice Engine the Slang!
    registerVoiceVocabulary({
        // Rolex
        "pepsi": "rolex gmt master red blue",
        "batman": "rolex gmt master blue black oyster",
        "batgirl": "rolex gmt master blue black jubilee",
        "smurf": "rolex submariner white gold blue",
        "kermit": "rolex submariner green bezel black dial",
        "starbucks": "rolex submariner green bezel black dial 41mm",
        "hulk": "rolex submariner green dial green bezel",
        "root beer": "rolex gmt master brown",
        "sprite": "rolex gmt master green black destro",
        "skydweller": "rolex sky-dweller",
        "daytona": "rolex cosmograph daytona",
        "president": "rolex day-date",
        "paul newman": "rolex daytona exotic dial",
        // Omega
        "speedy": "omega speedmaster",
        "moonwatch": "omega speedmaster professional",
        "moon watch": "omega speedmaster professional",
        "ed white": "omega speedmaster 105.003",
        "snoopy": "omega speedmaster snoopy",
        // General / Others
        "royal oak": "audemars piguet royal oak",
        "nautilus": "patek philippe nautilus",
        "aquanaut": "patek philippe aquanaut",
        "panda": "chronograph white dial black sub-dials",
        "reverse panda": "chronograph black dial white sub-dials"
    });
}
