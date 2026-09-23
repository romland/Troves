/**
 * @name Vinted Detailed Search
 * @description Searches for VERY similar items on Vinted
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 *
 * Troves Plugin generated for: "Vinted market pricing and similar item lookup based on dynamic taxonomy"
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {

    // Parses the ML model's stringified JSON (e.g. [{"color":"purple","pct":0.85}]) 
    // and returns just the dominant color name.
    const extractDominantColor = (rawColorStr) => {
        if (!rawColorStr) return '';
        try {
            const parsed = JSON.parse(rawColorStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const top = parsed.sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
                return top.name || top.color || '';
            }
        } catch (e) {
            return rawColorStr.split(',')[0].trim();
        }
        return '';
    };

    const buildFuzzySearchQuery = async (item) => {
        const brand = itemOps.getFuzzyAttribute(item, ['brand', 'maker', 'label']);
        const rawColor = itemOps.getFuzzyAttribute(item, ['color', 'shade']);
        const material = itemOps.getFuzzyAttribute(item, ['material', 'fabric']);
        
        const cleanColor = extractDominantColor(rawColor);
        
        const terms = [brand, item.title, cleanColor, material].filter(Boolean);
        
        return [...new Set(terms.join(' ').toLowerCase().split(' '))]
            .filter(w => w.length > 2)
            .join('+');
    };

    // 1. Magic Redirect UI Action: Instantly builds and redirects to Vinted
    registerItemAction({ 
        id: 'search-vinted', 
        label: 'Find Similar on Vinted', 
        icon: 'bi-tags',
        mode: 'resolve' // MAGIC PROXY MODE
    }, async (payload) => {
        const item = payload.entity;
        
        const fullItem = await db.item.findUnique({
            where: { id: item.id },
            include: { attributes: true }
        });

        const query = await buildFuzzySearchQuery(fullItem);
        
        if (!query) {
            sysLog.warn(`[VintedScout] Insufficient data to build search query for item ${item.id}`);
            // Redirect them to the Vinted homepage if the query fails completely
            return 'https://www.vinted.com';
        }

        const vintedUrl = `https://www.vinted.com/catalog?search_text=${query}`;
        
        // ABSOLUTE TRANSPARENCY: User clicks the button, and sees EXACTLY what happened in Activity log
        if (logActivity) {
            await logActivity(
                item.id, 
                'Vinted Query Generated', 
                'Constructed highly-specific Vinted URL from item attributes.', 
                'info',
                JSON.stringify({ extractedTerms: query.split('+'), generatedUrl: vintedUrl }, null, 2)
            );
        }

        return vintedUrl; // The proxy catches this and redirects the user natively
    });

    // 2. Automatic Background Enrichment: Estimated Valuation
    on('onItemProcessed', async (payload) => {
        if (!payload.intent?.isNew) return;

        const item = payload.entity;
        const fullItem = await db.item.findUnique({
            where: { id: item.id },
            include: { attributes: true }
        });

        const query = await buildFuzzySearchQuery(fullItem);
        if (!query) return;

        sysLog.info(`[VintedScout] Running background market check for: "${query}"`);

        try {
            const searchUrl = `https://www.vinted.com/api/v2/catalog/items?search_text=${query}`;
            const res = await fetch(searchUrl, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'Troves-Inventory-Agent/1.0' }
            });

            if (!res.ok) {
                const errorBody = await res.text();
                sysLog.warn(`[VintedScout] API rejected request. Status: ${res.status}. Body: ${errorBody}`);
                if (logActivity) {
                    await logActivity(
                        item.id, 'Vinted Background Check Failed', `API returned ${res.status}`, 'error',
                        JSON.stringify({ url: searchUrl, errorBody }, null, 2)
                    );
                }
                return; 
            }

            const data = await res.json();
            const items = data.items || [];

            if (items.length >= 3) {
                const topItems = items.slice(0, 5);
                const avgPrice = topItems.reduce((acc, curr) => acc + parseFloat(curr.price || 0), 0) / topItems.length;
                const currency = topItems[0].currency || 'EUR';
                const formattedPrice = `${currency} ${avgPrice.toFixed(2)}`;
                
                const updated = await itemOps.setAttribute(item.id, 'Estimated Value', formattedPrice);
                if (updated && logActivity) {
                    await logActivity(item.id, 'Market Valuation', `Averaged ${formattedPrice} based on ${topItems.length} similar Vinted listings.`, 'success', JSON.stringify({ queryUsed: query, itemsSampled: topItems.length, averagePrice: formattedPrice }, null, 2));
                }
            }
        } catch (error) { sysLog.error(`[VintedScout] Exception during background sync:`, error); }
    }, { maxRetries: 2, retryDelayMs: 5000, rateLimitRpm: 15 });
}