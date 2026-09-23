/**
 * @name Example Dummy Plugin
 * @description Does nothing useful
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-18
 * @github https://github.com/romland/troves
 * @archetype any
 */
export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    
    // Abstracted core logic to allow both automatic and manual triggers
    async function fetchManual(item) {
        if (!item.title) {
            sysLog.warn(`[FetchManual] Item ${item.id} has no title to search for.`);
            if (logActivity) {
                await logActivity(item.id, 'Fetch Manual Skipped', 'Item has no title to search for.', 'warning', JSON.stringify({ itemId: item.id }));
            }
            return;
        }

        sysLog.info(`[FetchManual] Searching manuals for: ${item.title}`);
        
        // Construct the target URL
        const apiUrl = `https://api.example.com/manuals?q=${encodeURIComponent(item.title)}`;
        
        if (logActivity) {
            await logActivity(
                item.id,
                'Manual Search Request',
                `Querying external API for manual: "${item.title}"`,
                'info',
                JSON.stringify({ url: apiUrl })
            );
        }

        // Fetch using the injected Node.js fetch implementation
        const res = await fetch(apiUrl);
        
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            
            // Log the exact failure before throwing
            if (logActivity) {
                await logActivity(
                    item.id,
                    'Manual Search Failed',
                    `API request failed (${res.status} ${res.statusText})`,
                    'error',
                    JSON.stringify({ status: res.status, body: errBody })
                );
            }
            
            // Do NOT try/catch this! Throwing the error allows the Troves Queue 
            // to properly mark the task as "Failed" and utilize maxRetries.
            throw new Error(`API failed: ${res.statusText}`);
        }

        const data = await res.json();
        
        // Log the exact payload we got back
        if (logActivity) {
            await logActivity(
                item.id,
                'Manual Search Response',
                `Received successful response from API.`,
                'info',
                JSON.stringify(data)
            );
        }

        if (data.manualUrl) {
            // This safely attaches the link and ignores it if the path already exists!
            await itemOps.attachDocument(item.id, {
                type: 'link', 
                title: `${item.title} - User Manual`,
                source: new URL(data.manualUrl).hostname,
                path: data.manualUrl,
                extracts: "Automatically fetched via plugin",
                type: 'link' 
            });
            
            sysLog.info(`[FetchManual] Successfully attached manual to ${item.title}`);
            
            if (logActivity) {
                await logActivity(
                    item.id,
                    'Manual Attached',
                    `Attached manual from ${new URL(data.manualUrl).hostname}`,
                    'success',
                    JSON.stringify({ url: data.manualUrl })
                );
            }
        } else {
            sysLog.info(`[FetchManual] No manual found for ${item.title}`);
            
            if (logActivity) {
                await logActivity(
                    item.id,
                    'Manual Not Found',
                    `The API returned no matching manuals for this item.`,
                    'warning'
                );
            }
        }
    }

    // Automatic Post-Processing Trigger (Runs on newly created items)
    on(
        'onItemProcessed',
        async (payload) => {
            if (payload.intent?.isNew) {
                await fetchManual(payload.entity);
            }
        },
        // Prevent API spam
        {
            maxRetries: 3,
            retryDelayMs: 3000,
            rateLimitRpm: 30
        }
    );

    // Manual UI Action Trigger
    registerItemAction(
        { 
            id: 'fetch-user-manual', 
            label: 'Fetch User Manual', 
            icon: 'bi-journal-text',

            maxRetries: 2, 
            retryDelayMs: 2000, 
            rateLimitRpm: 30
        }, 
        async (payload) => {
            await fetchManual(payload.entity);
        }
    );
}