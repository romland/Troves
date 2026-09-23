/**
 * @name Spotify Album Fetcher
 * @description Connects to Spotify's API to download high-resolution album art and extract tracklists when a CD is scanned.
 * @author Troves Community
 * @version 1.0.0
 * @updated 2026-09-15
 * @github https://github.com/romland/troves
 * @donate https://github.com/romland
 * @website https://llemming.com/
 *
 *
 * REQUIRED SETUP:
 * You must add the following keys to your Troves `.env` file:
 * 
 * SPOTIFY_CLIENT_ID="your_spotify_client_id"
 * SPOTIFY_CLIENT_SECRET="your_spotify_client_secret"
 * 
 * How to get them (Free):
 * 1. Go to https://developer.spotify.com/dashboard
 * 2. Log in with your standard Spotify account.
 * 3. Click "Create app". Name it "Troves", put "http://localhost" as Redirect URI.
 * 4. Once created, click "Settings" to view your Client ID and Client Secret.
 * 5. Add them to your `.env` file and restart your Troves Docker container.
 *
 * FEATURES:
 *
 * 1. SMART METADATA SEARCH
 * When a CD is processed, the plugin takes the Troves `title` (and the `Artist` 
 * attribute if the ML found one) and queries Spotify. 
 * -> Gotcha: We deliberately avoid strict `album:xxx` API filters because OCR 
 *    titles from photos can be messy. A broad keyword search with `type=album` 
 *    is way more resilient.
 * 
 * 2. AUTOMATIC DATA ENRICHMENT
 * It pulls down the officially formatted Album Name, Artist, Release Year, and 
 * Track Count, and saves them as custom attributes (KVPs) in Troves. 
 * -> Gotcha: It checks if these exist first (Idempotency). You can mash the 
 *    manual "Fetch" button 10 times and it will never create duplicate data.
 * 
 * 3. FULL TRACKLIST EXTRACTION (THE TWO-HOP PULL)
 * Spotify's search endpoint only returns "Simplified Albums" (which lack tracklists). 
 * The plugin takes the winning Album ID, makes a *second* API call to get the 
 * full album, calculates track durations into readable text (e.g., "3:45"), and 
 * creates a Troves 'Document' (type: link) for every single song.
 * 
 * 4. NATIVE APP DEEP-LINKING
 * Instead of boring web URLs (`https://...`), it saves the tracks and album 
 * links using Spotify's native URI scheme (e.g., `spotify:track:12345`). 
 * -> Feature: Clicking a song in Troves tells your OS to instantly open the 
 *    desktop or mobile Spotify app directly to that specific track.
 * -> The Annoying Gotcha: Spotify permanently killed auto-play for URIs to stop 
 *    streaming fraud. The link opens the app right to the song, but a human 
 *    still has to manually click the green 'Play' button.
 * 
 * 5. HIGH-RES COVER ART
 * It finds the highest resolution cover art available, downloads the raw 
 * image buffer, saves it locally to your Troves disk (`data/images/u/`), and 
 * sets it as the primary photo (if the user didn't already set one).
 * 
 * 6. DUAL EXECUTION (AUTO & MANUAL)
 * -> Auto: Listens to `onItemProcessed` and runs quietly in the background 
 *    only for newly created items.
 * -> Manual: Injects a "Fetch Album & Tracks" button into the item UI.
 * Both are wrapped in Troves' built-in rate limiting (30 requests/min) and 
 * auto-retries to ensure we never get IP-banned by Spotify.
 */
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    
    // Helper to be polite to APIs
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function getSpotifyToken() {
        const clientId = env.SPOTIFY_CLIENT_ID;
        const clientSecret = env.SPOTIFY_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env");
        }

        const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Spotify Auth Failed: ${res.status} - ${errBody}`);
        }

        const data = await res.json();
        return data.access_token;
    }

    async function lookupAndEnrichCD(baseItem) {
        const item = await db.item.findUnique({
            where: { id: baseItem.id },
            include: { attributes: true, photos: true }
        });

        if (!item || !item.title) {
            sysLog.warn(`[SpotifyCD] Item ${baseItem?.id} has no title to search for.`);
            return;
        }

        const safeTitle = item.title.trim();
        sysLog.info(`[SpotifyCD] Starting enrichment for CD: "${safeTitle}"`);

        try {
            const token = await getSpotifyToken();

            // 1. EXTRACT ALL RAW DATA FOR DEBUGGING
            const allAttributes = item.attributes ? item.attributes.map(a => ({ key: a.key, value: a.value })) : [];
            
            // 2. FUZZY MATCH TARGETS
            const artist = itemOps.getFuzzyAttribute(item, ['artist', 'band', 'creator', 'by']);
            const subtitle = itemOps.getFuzzyAttribute(item, ['subtitle', 'album']);
            
            const broadTerms = [];
            if (item.description && item.description.length < 150) {
                broadTerms.push(item.description);
            }
            if (item.attributes && item.attributes.length > 0) {
                const fuzzyKeyTargets = ['label', 'publisher', 'record', 'producer', 'prominent text', 'prominent graphic'];
                item.attributes.forEach(a => {
                    if (fuzzyKeyTargets.some(target => a.key.toLowerCase().includes(target))) {
                        broadTerms.push(a.value);
                    }
                });
            }
            const broadExtraStr = [...new Set(broadTerms)].join(' ').trim();

            // 3. LOG THE EXACT STARTING STATE
            if (logActivity) {
                await logActivity(
                    item.id,
                    'Pre-Flight Metadata Dump',
                    'Dumping all item attributes and extracted targets before formulating Spotify queries.',
                    'info',
                    JSON.stringify({
                        rawTitle: safeTitle,
                        rawDescription: item.description || "NONE",
                        allItemAttributes: allAttributes,
                        mapped_SubtitleTarget: subtitle || "NONE",
                        mapped_ArtistTarget: artist || "NONE",
                        mapped_KitchenSinkTerms: broadExtraStr || "NONE"
                    }, null, 2)
                );
            }

            // 4. BUILD TIERED QUERIES
            const appendIfNotPresent = (baseStr, addition) => {
                if (!addition) return baseStr;
                if (baseStr.toLowerCase().includes(addition.toLowerCase())) return baseStr;
                return `${baseStr} ${addition}`.trim();
            };

            const queriesToTry = [];
            
            // Pass 1: STRICTLY TITLE + SUBTITLE
            const pass1 = appendIfNotPresent(safeTitle, subtitle);
            queriesToTry.push(pass1);

            // Pass 2: TITLE + ARTIST
            const pass2 = appendIfNotPresent(safeTitle, artist);
            if (pass2 !== pass1) {
                queriesToTry.push(pass2);
            }

            // Pass 3: JUST THE TITLE
            if (safeTitle !== pass1 && safeTitle !== pass2) {
                queriesToTry.push(safeTitle);
            }

            // Pass 4: THE KITCHEN SINK
            let pass4 = safeTitle;
            pass4 = appendIfNotPresent(pass4, broadExtraStr);
            if (pass4 !== pass1 && pass4 !== pass2 && pass4 !== safeTitle && broadExtraStr) {
                queriesToTry.push(pass4);
            }

            if (logActivity) {
                await logActivity(
                    item.id,
                    'Waterfall Plan',
                    `Will attempt ${queriesToTry.length} queries in sequence until a match is found.`,
                    'info',
                    JSON.stringify({ queryOrder: queriesToTry }, null, 2)
                );
            }

            const executeSearchPass = async (query) => {
                const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=3`;

                if (logActivity) {
                    await logActivity(
                        item.id,
                        'Spotify API Request',
                        `Executing Search: "${query}"`,
                        'info',
                        JSON.stringify({ url: url })
                    );
                }

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                });

                if (!res.ok) {
                    let errorBody = "";
                    try { errorBody = await res.text(); } catch (e) {}
                    sysLog.error(`[SpotifyCD] API rejected request. Status: ${res.status} ${res.statusText}. Body: ${errorBody}`);
                    
                    if (logActivity) {
                        await logActivity(item.id, 'Spotify API Error', `Status: ${res.status}`, 'error', errorBody);
                    }
                    
                    if (res.status === 429) return { status: 429, data: null };
                    throw new Error(`Spotify Search Failed: ${res.status} ${res.statusText}`);
                }

                const data = await res.json();
                
                if (logActivity) {
                    const hitCount = data.albums?.items?.length || 0;
                    await logActivity(item.id, 'Spotify API Response', `Found ${hitCount} albums for "${query}".`, hitCount > 0 ? 'success' : 'warning');
                }

                return { status: 200, data };
            };

            // --- WATERFALL EXECUTION ---
            let bestAlbum = null;
            let queryUsed = "";

            for (const [index, query] of queriesToTry.entries()) {
                if (index > 0) {
                    sysLog.info(`[SpotifyCD] Pausing 1.5s to respect Spotify API burst limits...`);
                    await sleep(1500); 
                }

                sysLog.info(`[SpotifyCD] Pass ${index + 1}: ${query}`);
                const result = await executeSearchPass(query);
                
                if (result.status === 429) break; 
                
                const albums = result.data?.albums?.items;
                if (albums && albums.length > 0) {
                    bestAlbum = albums[0]; 
                    queryUsed = query;
                    break; // SHORT CIRCUIT: Stops the loop instantly on the first hit
                }
            }

            if (!bestAlbum) {
                sysLog.warn(`[SpotifyCD] No albums found on Spotify across all tiers.`);
                if (logActivity) await logActivity(item.id, 'Spotify Enrichment Aborted', `Exhausted all search passes with no hits.`, 'error');
                return;
            }

            sysLog.info(`[SpotifyCD] Match found: ${bestAlbum.name} (using query: "${queryUsed}")`);

            if (logActivity) {
                await logActivity(
                    item.id,
                    'Spotify Match Locked',
                    `Selected album: "${bestAlbum.name}" by ${bestAlbum.artists.map(a => a.name).join(', ')}`,
                    'success',
                    JSON.stringify({ queryUsed, spotifyId: bestAlbum.id }, null, 2)
                );
            }

            // Update core Item fields
            const updates = {};
            if (bestAlbum.name && bestAlbum.name !== item.title) {
                updates.title = bestAlbum.name;
            }

            if (Object.keys(updates).length > 0) {
                await db.item.update({ where: { id: item.id }, data: updates });
            }

            // Append KVP attributes
            const attributesToAdd = [];
            const albumArtistName = bestAlbum.artists.map(a => a.name).join(', ');
            if (albumArtistName) attributesToAdd.push({ key: 'Artist', value: albumArtistName });
            
            if (bestAlbum.release_date) {
                attributesToAdd.push({ key: 'Release Year', value: bestAlbum.release_date.split('-')[0] });
                attributesToAdd.push({ key: 'Release Date', value: bestAlbum.release_date });
            }
            if (bestAlbum.total_tracks) attributesToAdd.push({ key: 'Total Tracks', value: String(bestAlbum.total_tracks) });
            if (bestAlbum.uri) attributesToAdd.push({ key: 'Spotify Link', value: bestAlbum.uri });

            for (const attr of attributesToAdd) {
                await itemOps.setAttribute(item.id, attr.key, attr.value);
            }

            // Fetch FULL album to get tracklist
            sysLog.info(`[SpotifyCD] Fetching full tracklist for album ID: ${bestAlbum.id}`);
            const fullAlbumRes = await fetch(`https://api.spotify.com/v1/albums/${bestAlbum.id}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });

            if (fullAlbumRes.ok) {
                const fullAlbum = await fullAlbumRes.json();
                const tracks = fullAlbum.tracks?.items || [];
                
                if (tracks.length > 0) {
                    let tracksAdded = 0;
                    for (const track of tracks) {
                        const trackUri = track.uri; 
                        if (!trackUri) continue;

                        const existingTrack = await db.document.findFirst({
                            where: { itemId: item.id, path: trackUri }
                        });

                        if (!existingTrack) {
                            const min = Math.floor(track.duration_ms / 60000);
                            const sec = ((track.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0');
                            
                            const trackArtists = track.artists && track.artists.length > 0 
                                ? track.artists.map(a => a.name).join(', ') 
                                : albumArtistName;
                            
                            await itemOps.attachDocument(item.id, {
                                type: 'link',
                                title: `🎵 Track ${track.track_number}: ${track.name} - ${trackArtists}`,
                                source: 'Spotify',
                                path: trackUri,
                                extracts: `Duration: ${min}:${sec}`
                            });
                            tracksAdded++;
                        }
                    }
                    if (tracksAdded > 0 && logActivity) {
                        await logActivity(item.id, 'Spotify Tracks Attached', `Added ${tracksAdded} native app links.`, 'success');
                    }
                }
            } else {
                sysLog.warn(`[SpotifyCD] Failed to fetch tracklist: ${fullAlbumRes.statusText}`);
            }

            // Download Cover Art
            const coverExists = await db.photo.findFirst({ 
                where: { itemId: item.id, orgPath: { contains: 'spotify-cover-' } } 
            });

            if (!coverExists && bestAlbum.images && bestAlbum.images.length > 0) {
                const largestImage = bestAlbum.images[0];
                try {
                    const imgRes = await fetch(largestImage.url);
                    if (imgRes.ok) {
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        const filename = `spotify-cover-${item.id}-${Date.now()}.jpg`;
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
                                isPrimary: !item.photos?.some(p => p.isPrimary)
                            }
                        });
                        if (logActivity) await logActivity(item.id, 'Cover Art Downloaded', 'Attached high-res cover from Spotify.', 'success');
                    }
                } catch (imgErr) {
                    sysLog.error(`[SpotifyCD] Failed to download cover art:`, imgErr);
                }
            }

        } catch (error) {
            sysLog.error(`[SpotifyCD] Unhandled error during CD enrichment:`, error);
            if (logActivity) await logActivity(item.id, 'Spotify Sync Exception', error.message, 'error');
            throw error; 
        }
    }

    on('onItemProcessed', async (payload) => {
        if (payload.intent?.isNew) {
            await lookupAndEnrichCD(payload.entity);
        }
    }, { maxRetries: 3, retryDelayMs: 5000, rateLimitRpm: 30 });

    registerItemAction({ 
        id: 'fetch-spotify-cd', 
        label: 'Fetch Album & Tracks from Spotify', 
        icon: 'bi-music-note-list',
        maxRetries: 2,
        retryDelayMs: 3000,
        rateLimitRpm: 30
    }, async (payload) => {
        await lookupAndEnrichCD(payload.entity);
    });
}
