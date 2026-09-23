/**
 * @name Google Image Lookup
 * @description Search for similar on Google Images
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 */
/**
 * ============================================================================
 * TROVES PLUGIN: GOOGLE IMAGE SEARCH
 * ============================================================================
 * User Request: "Give me an extension that does what google search one does but for google images"
 * Target Trove Archetype: any
 * Generated At: 2026-09-18T17:06:08Z
 * Model: gemini-3.1-flash-lite
 * ============================================================================
 */

export default function register({ registerItemAction }) {
    registerItemAction({
        id: 'google-image-search',
        label: 'Search on Google Images',
        icon: 'bi-image',
        // udm=2 is the modern Google URL parameter to force the Images vertical
        urlTemplate: 'https://www.google.com/search?udm=2&q={{title}}'
    });
}