# Evolving Taxonomy & Prompt Modifiers

Troves uses an Entity-Attribute-Value (EAV) taxonomy that self-organizes based on what you scan. While the core engine is good at dynamically building schemas and enforcing strict vocabulary for any collection, plugins allow you to inject ultra-specific, expert-level domain knowledge into the pipeline. 

By using **Archetypes** and **Prompt Modifiers**, extensions can act as niche specialists, guiding the system to use exact commercial terminology, strict industry grading scales, or specialized schemas.

## 1. Dynamic Archetypes

An Archetype represents the highest-level concept of a Trove (e.g., "Hardware & Tools", "Collectibles"). When a user creates a new Trove, they select an Archetype.

A plugin can register a new, specialized Archetype (like "Trollbeads Collection" or "Sneakers") that appears in this list. 

```javascript
export default function register({ registerArchetype }) {
    registerArchetype({
        id: 'sneakers',
        name: 'Sneakerhead Collection',
        icon: 'bi-bandaid', // Bootstrap icon class
        requiredPlugins: ['sneaker-auth.js'], // Plugins that will automatically be enabled
        settings: { 
            allowAutoTaxonomy: false, 
            deepScanCollections: true 
        },
        taxonomy: [
            // You can force specific fields into the EAV database automatically
            { name: 'silhouette', uiLabel: 'Silhouette', type: 'string', matchWeight: 'STRICT_DEDUPE', extractionMethod: 'VISION_STRICT' },
            { name: 'colorway', uiLabel: 'Colorway', type: 'string', matchWeight: 'FUZZY_SECONDARY', extractionMethod: 'VISION_STRICT' },
            { name: 'us_size', uiLabel: 'US Size', type: 'number', matchWeight: 'METADATA_ONLY', extractionMethod: 'HUMAN_REQUIRED' }
        ]
    });
}
```

## 2. Prompt Modifiers (Middleware Waterfall)

Troves runs purely asynchronous background queues. You cannot block the user's UI. However, right before the Vision model is executed, the `ExtensionManager` passes the raw prompt through the `applyModifiers` waterfall.

This allows your plugin to **silently inject expertise into the Vision model** based on the active archetype, completely eliminating the need for the user to type manual hints.

```javascript
export default function register({ addModifier }) {
    // Intercept the prompt for the vision model in flight
    addModifier('beforeVisionClassification', (basePrompt, context) => {
        
        // Ensure we only mess with our own Archetype!
        if (context.archetype !== 'sneakers') return basePrompt;

        // The LLM will obey this injected rule
        const expertPrompt = `
            CRITICAL DOMAIN EXPERTISE: You are a sneaker authenticator and archivist.
            Analyze this shoe. Extract the exact 'silhouette' (e.g., Jordan 1 High, Yeezy 350 V2) and the 'colorway' (e.g., Bred, Zebra).
            Ignore the background entirely.
        `;
        
        return basePrompt + "\n\n" + expertPrompt;
    });
}
```

### Available Modifier Hooks

- **`beforeVisionClassification`**: 
  - **Payload**: `(basePrompt: string, context: { inventoryId: number, archetype: string, isMultiScan: boolean, hint?: string })`
  - **Purpose**: Add specific visual extraction instructions before `analyze-draft` or `analyze-multiscan` executes.
  - **Rule**: ALWAYS check the `context.archetype` before modifying the prompt, or you will accidentally break standard scans for unrelated Troves!
