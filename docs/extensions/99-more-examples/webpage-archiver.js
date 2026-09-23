/**
 * @name Website Archiver
 * @description It looks in attributes of items and archives any link mentioned. This is mostly written as an example on how to use Troves' archiver.
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 *
 * How to use this plugin/example:
 * 1. Click the "Archive Webpages from Attributes" button in the item's "..." menu.
 * 2. The plugin will scan all of the item's Key-Value Pair attributes. 
 * 3. Any attribute value that is a single-line HTTP/HTTPS URL will be sent to 
 *    Troves' background worker to be safely downloaded, parsed, summarized, 
 *    download, parse, summarize, and permanently archive the document so 
 *    you never lose it to link-rot.
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    registerItemAction({
        id: 'archive-webpage',
        label: 'Archive Webpages from Attributes',
        icon: 'bi-cloud-download',
        mode: 'queue',
        maxRetries: 2,
        retryDelayMs: 5000,
        rateLimitRpm: 15
    }, async (payload) => {
        const item = payload.entity;
        
        const fullItem = await db.item.findUnique({
            where: { id: item.id },
            include: { attributes: true }
        });

        const urlsToScrape = [];
        if (fullItem?.attributes) {
            for (const attr of fullItem.attributes) {
                const val = (attr.value || '').trim();
                if (/^https?:\/\//i.test(val) && !/[\r\n\s]/.test(val)) urlsToScrape.push(val);
            }
        }
        
        if (urlsToScrape.length === 0) {
            sysLog.warn(`[WebpageArchiver] Item ${item.id} has no valid URL attributes to scrape.`);
            if (logActivity) await logActivity(item.id, 'Archiver Skipped', 'No http/https URLs found in attributes.', 'warning');
            return;
        }

        sysLog.info(`[WebpageArchiver] Queuing ${urlsToScrape.length} URL(s) for item ${item.id}.`);
        for (const url of urlsToScrape) {
            sysLog.info(`[WebpageArchiver] Dispatched: ${url}`);
            if (logActivity) await logActivity(item.id, 'Web Archiver Queued', `Archiving: ${url}`, 'info');
            await itemOps.fetchAndStoreWebpage(url, item.id);
        }
    });
}
