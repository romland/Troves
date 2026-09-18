/**
 * ============================================================================
 * TROVES PLUGIN: WOOCOMMERCE SYNC
 * ============================================================================
 * Features:
 * - Pushes Troves items to a WooCommerce storefront via REST API v3.
 * - Leaves Pricing completely blank for safe manual management in WordPress.
 * - Maps Troves dynamic taxonomy directly to WooCommerce product attributes.
 * - Extracts Troves documents/links and generates a clean HTML "Related Resources" block.
 * - Uploads Troves local images to the WP Media Library and assigns them to the product.
 * - Tracks uploaded WP Media IDs to prevent duplicate image uploads on subsequent syncs.
 * - Idempotency: Stores the WooCommerce Product ID locally to perform PUT updates.
 * ============================================================================
 * 
 * REQUIRED SETUP:
 * Add these to your .env file:
 * 
 * WC_STORE_URL="https://yourstore.com"
 * 
 * // For WooCommerce Product creation (WooCommerce > Settings > Advanced > REST API)
 * WC_CONSUMER_KEY="ck_..."
 * WC_CONSUMER_SECRET="cs_..."
 * 
 * // For WordPress Media Uploads (Users > Profile > Application Passwords)
 * WP_USERNAME="admin_username"
 * WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
 */

import fs from 'fs';
import path from 'path';

export default function register({ registerItemAction, sysLog, logActivity, fetch, env, itemOps, db }) {
    registerItemAction({ 
        id: 'sync-woocommerce', 
        label: 'Sync to WooCommerce', 
        icon: 'bi-shop',
        maxRetries: 1, 
        retryDelayMs: 3000
    }, async (payload) => {
        const item = payload.entity;

        const url = env.WC_STORE_URL?.replace(/\/$/, '');
        const wcKey = env.WC_CONSUMER_KEY;
        const wcSecret = env.WC_CONSUMER_SECRET;
        const wpUser = env.WP_USERNAME;
        const wpAppPass = env.WP_APP_PASSWORD;

        if (!url || !wcKey || !wcSecret || !wpUser || !wpAppPass) {
            sysLog.warn("[WooCommerce] Skipped: Missing API keys or URLs in .env");
            return;
        }

        // 1. Fetch full item to get photos and documents
        const fullItem = await db.item.findUnique({
            where: { id: item.id },
            include: { attributes: true, photos: true, documents: true }
        });

        // 2. Check Idempotency State
        const wcIdAttr = fullItem.attributes?.find(a => a.key === '_WooCommerce ID');
        const existingWcId = wcIdAttr ? wcIdAttr.value : null;
        
        const mediaMapAttr = fullItem.attributes?.find(a => a.key === '_WC_Media_Map');
        let mediaMap = mediaMapAttr ? JSON.parse(mediaMapAttr.value) : {};

        sysLog.info(`[WooCommerce] Syncing "${fullItem.title}"...`);

        // 3. The Two-Hop Image Upload
        let uploadedImageIds = [];
        let wpAuthHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64');

        for (const photo of fullItem.photos || []) {
            // Only sync product photos, not invoices/receipts
            if (photo.type !== 'product') continue;

            if (mediaMap[photo.id]) {
                uploadedImageIds.push({ id: mediaMap[photo.id] });
                continue;
            }

            // Fallback to thumbPath if orgPath is null
            const targetPath = photo.orgPath || photo.thumbPath;
            if (!targetPath) continue;

            const filePath = path.join(process.cwd(), 'data', targetPath);
            if (!fs.existsSync(filePath)) continue;

            try {
                const fileBuffer = fs.readFileSync(filePath);
                const fileName = path.basename(filePath);
                
                // WP Media API requires the exact filename in the Content-Disposition header
                const mediaRes = await fetch(`${url}/wp-json/wp/v2/media`, {
                    method: 'POST',
                    headers: {
                        'Content-Disposition': `attachment; filename="${fileName}"`,
                        'Authorization': wpAuthHeader,
                        'Content-Type': 'image/jpeg'
                    },
                    body: fileBuffer
                });

                if (mediaRes.ok) {
                    const mediaData = await mediaRes.json();
                    mediaMap[photo.id] = mediaData.id;
                    uploadedImageIds.push({ id: mediaData.id });
                    sysLog.debug(`[WooCommerce] Uploaded image ${fileName} to WP Media ID ${mediaData.id}`);
                } else {
                    sysLog.warn(`[WooCommerce] Failed to upload image ${fileName}: ${await mediaRes.text()}`);
                }
            } catch (err) {
                sysLog.error(`[WooCommerce] Image upload exception:`, err);
            }
        }

        // Save media map back to Troves so we don't upload these files again
        if (Object.keys(mediaMap).length > 0) {
            await itemOps.setAttribute(item.id, '_WC_Media_Map', JSON.stringify(mediaMap));
        }

        // 4. Translate Attributes
        const wcAttributes = [];
        if (fullItem.attributes) {
            for (const attr of fullItem.attributes) {
                if (attr.key.startsWith('_')) continue;
                wcAttributes.push({
                    name: attr.key,
                    options: [attr.value],
                    visible: true,
                    variation: false
                });
            }
        }

        // 5. Construct Professional Document HTML
        let extendedDescription = fullItem.description || '';
        if (fullItem.documents && fullItem.documents.length > 0) {
            extendedDescription += '\n\n<hr style="margin-top: 2rem;" />\n<h4>Related Resources</h4>\n<ul style="list-style-type: disc; margin-left: 1.5rem;">\n';
            for (const doc of fullItem.documents) {
                extendedDescription += `<li><a href="${doc.path}" target="_blank" rel="noopener noreferrer">${doc.title}</a> <em style="font-size: 0.85em; color: #666;">(${doc.source})</em></li>\n`;
            }
            extendedDescription += '</ul>';
        }

        // 6. Build final WooCommerce payload
        const productData = {
            name: fullItem.title,
            description: extendedDescription,
            manage_stock: true,
            stock_quantity: fullItem.amount || 1,
            attributes: wcAttributes,
            images: uploadedImageIds
        };

        const endpoint = existingWcId 
            ? `${url}/wp-json/wc/v3/products/${existingWcId}` 
            : `${url}/wp-json/wc/v3/products`;
            
        const method = existingWcId ? 'PUT' : 'POST';
        const wcAuthHeader = 'Basic ' + Buffer.from(`${wcKey}:${wcSecret}`).toString('base64');

        try {
            const res = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': wcAuthHeader
                },
                body: JSON.stringify(productData)
            });

            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}
                sysLog.error(`[WooCommerce] API rejected request. Status: ${res.status}. Body: ${errorBody}`);
                
                if (logActivity) {
                    await logActivity(
                        item.id, 
                        'WooCommerce Sync Failed', 
                        `API rejected the request (${res.status})`, 
                        'error', 
                        JSON.stringify({ endpoint, method, payload: productData, error: errorBody }, null, 2)
                    );
                }
                throw new Error(`WooCommerce API error: ${res.statusText}`);
            }

            const responseData = await res.json();

            // 7. Store the ID locally if this was a new creation
            if (!existingWcId) {
                await itemOps.setAttribute(item.id, '_WooCommerce ID', String(responseData.id));
                await itemOps.attachDocument(item.id, {
                    type: 'link',
                    title: `View on Webshop`,
                    source: 'WooCommerce',
                    path: responseData.permalink,
                    extracts: 'Manage pricing and storefront visibility.'
                });
            }

            if (logActivity) {
                await logActivity(
                    item.id, 
                    'WooCommerce Sync', 
                    `Successfully ${existingWcId ? 'updated' : 'created'} listing on webshop.`, 
                    'success',
                    JSON.stringify({ 
                        action: existingWcId ? 'PUT' : 'POST',
                        product_id: responseData.id, 
                        images_synced: uploadedImageIds.length
                    }, null, 2)
                );
            }
            
        } catch (error) {
            sysLog.error(`[WooCommerce] Sync error:`, error);
            throw error;
        }
    });
}