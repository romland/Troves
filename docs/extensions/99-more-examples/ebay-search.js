/**
 * ============================================================================
 * TROVES PLUGIN: EBAY SEARCH
 * ============================================================================
 * User Request: "Give me a plugin that searches for the item on ebay"
 * Target Trove Archetype: any
 * ============================================================================
 */

export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'ebay-search',
        label: 'Search on eBay',
        icon: 'bi-shop',
        urlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={{title}}'
    });
}