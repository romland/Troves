export const hookDescriptions: Record<string, string> = {
    onContainerCreated: "When a new container is created",
    onItemAdded: "Immediately after a new item is added",
    onItemUpdated: "Immediately after an item is updated",
    onItemProcessed: "After background processing of an item completes",
    onPrintLabelRequested: "When a label print is requested manually"
};

export const modifierDescriptions: Record<string, string> = {
    beforeVisionClassification: "Modifies vision model prompts in-flight"
};

export function extractPluginMeta(content: string): Record<string, string> {
    const meta: Record<string, string> = {};
    
    // Find the first JSDoc block (/** ... */)
    const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
    
    if (jsdocMatch) {
        const block = jsdocMatch[1];
        
        // Match @key value pairs anywhere in the block.
        const regex = /@([a-zA-Z0-9_-]+)[ \t]+([^\r\n]+)/g;
        let match;
        
        while ((match = regex.exec(block)) !== null) {
            const key = match[1].toLowerCase();
            let rawValue = match[2].trim();
            
            // 1. Sanitize: Strip HTML tags to prevent UI breakage and XSS
            let cleanValue = rawValue.replace(/<\/?[^>]+(>|$)/g, "").trim();
            
            // 2. Truncate: Cap lengths to avoid UI blowouts on malicious/bad formatting
            const maxLength = key === 'description' ? 300 : 70;
            if (cleanValue.length > maxLength) {
                cleanValue = cleanValue.substring(0, maxLength).trim() + '...';
            }
            
            if (cleanValue) {
                meta[key] = cleanValue;
                
                // Enforce a limit of 9 (name/description + 7) parsed tags to keep things tidy
                if (Object.keys(meta).length >= 9) break;
            }
        }
    }
    return meta;
}
