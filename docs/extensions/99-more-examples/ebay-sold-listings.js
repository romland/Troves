/**
 * Troves Plugin generated for: "Instant eBay Sold/Completed listings lookup"
 * 
 * ...ugh, you need to have an Ebay account for this.
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    
    registerItemAction(
        { 
            id: 'ebay-sold-check', 
            label: 'Check Sold Prices (eBay)', 
            icon: 'bi-cash-coin',
            mode: 'resolve' // Uses Redirect Proxy
        },
        // ...redirecting
        async (payload) => {
            const item = payload.entity;
            
            // 1. Build a strict search string
            const cleanTitle = item.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
            const prefixWord = ""; // NOTE: Trailing space if filled in! Fill this in to reduce/focus results, if needed (e.g. trollbeads, tools, lego...)
            const searchQuery = encodeURIComponent(`${prefixWord}${cleanTitle}`);
            
            // 2. Build the eBay Sold Listings URL
            // LH_Complete=1 and LH_Sold=1 are eBay's internal flags to only show items that actually sold
            const targetUrl = `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}&LH_Complete=1&LH_Sold=1`;
            
            // 3. Absolute Transparency
            if (logActivity) {
                await logActivity(
                    item.id, 
                    'Market Price Check', 
                    'Redirecting to eBay Sold Listings to verify actual market value.', 
                    'info',
                    JSON.stringify({ query: `${prefixWord}${cleanTitle}`, url: targetUrl }, null, 2)
                );
            }

            // 4. Return the URL so the SvelteKit proxy can natively redirect
            return targetUrl;
        }
    );
}