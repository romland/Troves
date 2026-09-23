/**
 * @name Board game & Tabletop lookup
 * @description Fetches board game information (very untested)
 * @author Troves Community
 * @version 0.0.1
 * @updated 2026-09-15
 * @github https://github.com/romland/troves
 */
/**
 * ============================================================================
 * TROVES PLUGIN: BOARD GAME & TABLETOP LOOKUP (BGG)
 * ============================================================================
 * Features:
 * - Queries the BoardGameGeek XML API2 using the item's title.
 * - Parses XML responses securely using Cheerio.
 * - Performs hardware-aware/fuzzy text matching via itemOps.compareTitles.
 * - Idempotently extracts: Min/Max Players, Playing Time, Recommended Age, 
 *   Complexity Rating, Box Art Image, and BGG Catalog links.
 * - Fully logs API requests and errors to the Troves Activity Monitor.
 * ============================================================================
 * 
 * REQUIRED SETUP:
 * Register and check out
 *   https://boardgamegeek.com/using_the_xml_api and 
 *   https://boardgamegeek.com/applications
 *
 * Add your free application token to your Troves `.env` file:
 * BGG_API_TOKEN="your_bgg_application_token_here"
 */
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    async function lookupAndEnrichBoardGame(payload) {
        const item = payload.entity;

        if (!item.title) {
            sysLog.warn(`[BGG] Item ${item.id} has no title to search for.`);
            return;
        }

        const bggToken = env.BGG_API_TOKEN;
        if (!bggToken) {
            sysLog.warn("[BGG] Skipped: BGG_API_TOKEN missing from .env");
            return;
        }

        const safeTitle = item.title.trim();
        sysLog.info(`[BGG] Searching BoardGameGeek catalog for: "${safeTitle}"`);

        const headers = {
            'Authorization': `Bearer ${bggToken}`,
            'Accept': 'application/xml'
        };

        try {
            // 1. Search BGG for the game ID
            const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(safeTitle)}&type=boardgame`;
            const searchRes = await fetch(searchUrl, { headers });

            if (!searchRes.ok) {
                let errText = '';
                try { errText = await searchRes.text(); } catch(e) {}
                throw new Error(`BGG Search failed (${searchRes.status}): ${errText}`);
            }
            
            const searchXml = await searchRes.text();
            const $search = cheerio.load(searchXml, { xmlMode: true });
            const items = $search('item');

            if (items.length === 0) {
                sysLog.warn(`[BGG] No board games found for "${safeTitle}".`);
                return;
            }

            // 2. Find best matching game ID using itemOps.compareTitles
            let bestGameId = null;
            let bestGameName = '';

            items.each((_, el) => {
                if (bestGameId) return;
                const id = $search(el).attr('id');
                const name = $search(el).find('name').attr('value') || '';
                
                const matchEval = itemOps.compareTitles(safeTitle, name);
                if (matchEval.titleSim > 0.6 || name.toLowerCase().includes(safeTitle.toLowerCase())) {
                    bestGameId = id;
                    bestGameName = name;
                }
            });

            if (!bestGameId && items.length > 0) {
                bestGameId = $search(items[0]).attr('id');
                bestGameName = $search(items[0]).find('name').attr('value') || '';
            }

            if (!bestGameId) {
                sysLog.warn(`[BGG] Could not resolve a valid game ID for "${safeTitle}".`);
                return;
            }

            sysLog.info(`[BGG] Resolved game ID ${bestGameId}: "${bestGameName}"`);

            // 3. Fetch full game details via Thing API (with statistics)
            const thingUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${bestGameId}&stats=1`;
            const thingRes = await fetch(thingUrl, { headers });

            if (!thingRes.ok) throw new Error(`BGG Thing API failed: ${thingRes.statusText}`);
            const thingXml = await thingRes.text();

            const $thing = cheerio.load(thingXml, { xmlMode: true });
            const $item =$thing('item').first();

            if (!$item.length) {
                sysLog.warn(`[BGG] Failed to retrieve details for game ID ${bestGameId}`);
                return;
            }

            const primaryName = $item.find('name[type="primary"]').attr('value') || bestGameName;
            const minPlayers = $item.find('minplayers').attr('value');
            const maxPlayers = $item.find('maxplayers').attr('value');
            const playingTime = $item.find('playingtime').attr('value');
            const minAge = $item.find('minage').attr('value');
            const complexity = $item.find('averageweight').attr('value');
            const imageUrl = $item.find('image').text();

            if (logActivity) {
                await logActivity(
                    item.id,
                    'BGG Lookup',
                    `Successfully matched "${safeTitle}" with BGG Board Game: "${primaryName}" (ID: ${bestGameId})`,
                    'success',
                    JSON.stringify({ gameId: bestGameId, primaryName, minPlayers, maxPlayers, playingTime, minAge, complexity }, null, 2)
                );
            }

            let updatesMade = 0;

            // 4. Save Attributes Idempotently using itemOps
            if (minPlayers && maxPlayers) {
                const playerRange = minPlayers === maxPlayers ? `${minPlayers} Players` : `${minPlayers}-${maxPlayers} Players`;
                if (await itemOps.setAttribute(item.id, 'Player Count', playerRange)) updatesMade++;
            }
            if (playingTime) {
                if (await itemOps.setAttribute(item.id, 'Playing Time', `${playingTime} mins`)) updatesMade++;
            }
            if (minAge) {
                if (await itemOps.setAttribute(item.id, 'Recommended Age', `${minAge}+ years`)) updatesMade++;
            }
            if (complexity) {
                const weightNum = parseFloat(complexity).toFixed(2);
                if (await itemOps.setAttribute(item.id, 'Complexity Rating', `${weightNum} / 5.0`)) updatesMade++;
            }

            // 5. Attach BGG Entry Link
            const bggPageUrl = `https://boardgamegeek.com/boardgame/${bestGameId}`;
            const docAttached = await itemOps.attachDocument(item.id, {
                type: 'link',
                title: `${primaryName} - BoardGameGeek Entry`,
                source: 'BoardGameGeek',
                path: bggPageUrl,
                extracts: `View community ratings, rule discussions, and strategies.`
            });
            if (docAttached) updatesMade++;

            // 6. Download Box Art
            if (imageUrl) {
                const fullItem = await db.item.findUnique({
                    where: { id: item.id },
                    include: { photos: true }
                });

                const coverExists = fullItem.photos?.some(p => p.orgPath?.includes('bgg-cover-'));

                if (!coverExists) {
                    try {
                        const imgRes = await fetch(imageUrl);
                        if (imgRes.ok) {
                            const buffer = Buffer.from(await imgRes.arrayBuffer());
                            if (buffer.length > 5000) {
                                const filename = `bgg-cover-${item.id}-${Date.now()}.jpg`;
                                const localPath = path.join(process.cwd(), 'data/images/u', filename);
                                fs.writeFileSync(localPath, buffer);

                                await db.photo.create({
                                    data: {
                                        itemId: item.id,
                                        type: 'product',
                                        orgPath: `/images/u/${filename}`,
                                        thumbPath: `/images/u/${filename}`,
                                        cropPath: `/images/u/${filename}`,
                                        ocr: "{}",
                                        llmAnalysis: "{}",
                                        isPrimary: !fullItem.photos?.some(p => p.isPrimary)
                                    }
                                });
                                updatesMade++;
                                sysLog.info(`[BGG] Downloaded and attached box art for ${primaryName}`);
                            }
                        }
                    } catch (imgErr) {
                        sysLog.error(`[BGG] Failed to download box art image:`, imgErr);
                    }
                }
            }

            sysLog.info(`[BGG] Successfully enriched board game: ${primaryName} (${updatesMade} updates made)`);

        } catch (error) {
            sysLog.error(`[BGG] Unhandled error during board game enrichment:`, error);
            if (logActivity) {
                await logActivity(item.id, 'BGG Lookup Failed', error.message, 'error', JSON.stringify({ stack: error.stack }, null, 2));
            }
            throw error;
        }
    }

    on('onItemProcessed', async (payload) => {
        if (payload.intent?.isNew) {
            await lookupAndEnrichBoardGame(payload);
        }
    }, { maxRetries: 3, retryDelayMs: 4000, rateLimitRpm: 30 });

    registerItemAction({
        id: 'fetch-bgg-info',
        label: 'Fetch Board Game Info (BGG)',
        icon: 'bi-dice-5',
        maxRetries: 2,
        retryDelayMs: 3000,
        rateLimitRpm: 30
    }, async (payload) => {
        await lookupAndEnrichBoardGame(payload);
    });
}