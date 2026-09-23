/**
 * @name Ebay Item Lookup
 * @description Look up similar items on Ebay
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 */
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