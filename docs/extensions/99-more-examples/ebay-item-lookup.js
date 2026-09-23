/**
 * @name Ebay Item Lookup
 * @description Give me a plugin that searches for the item on ebay
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 * @archetype any
 * @generatedBy gemini-3.1-flash-lite
 * 
 * User Request: "Give me a plugin that searches for the item on ebay"
 */
export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'ebay-search',
        label: 'Search on eBay',
        icon: 'bi-shop',
        urlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={{title}}'
    });
}