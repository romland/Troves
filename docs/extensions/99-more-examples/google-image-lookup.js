/**
 * @name Google Image Lookup
 * @description Give me an extension that does what google search one does but for google images
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @archetype any
 * @github https://github.com/romland/troves
 * @generatedBy gemini-3.1-flash-lite
 */
export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'google-image-search',
        label: 'Search on Google Images',
        icon: 'bi-image',
        urlTemplate: 'https://www.google.com/search?udm=2&q={{title}}'
    });
}