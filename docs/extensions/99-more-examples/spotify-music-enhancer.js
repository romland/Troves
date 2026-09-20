/**
 * ============================================================================
 * TROVES PLUGIN: SPOTIFY CD METADATA MATCHER
 * ============================================================================
 * 
 * ARCHITECTURAL PAUSE & API SUGGESTIONS:
 * You mentioned having a Spotify account and wanting to avoid paid services. 
 * Spotify is an excellent choice for rich metadata and high-quality cover art. 
 * I have implemented the full Spotify plugin below for you. 
 * 
 * However, since you are tracking physical CDs, please be aware:
 * 1. Spotify (Implemented Below): Great for general album info, track counts, 
 *    and cover art. Free via Developer API.
 * 2. Discogs (Alternative): The gold standard for physical CDs. It tracks 
 *    specific pressings, barcodes, matrix runouts, and physical media values. 
 *    It has a free API (requires generating a Personal Access Token).
 * 3. MusicBrainz (Alternative): Open-source, incredibly detailed physical 
 *    release groups. 100% free, no API key required, but rate-limited strictly.
 * 
 * If you ever want to switch to Discogs to track physical barcodes instead of 
 * digital releases, let me know and we can write a Discogs version!
 * 
 * ============================================================================
 * FEATURE BREAKDOWN
 * ============================================================================
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
 *
 * ============================================================================
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
 * ============================================================================
 */
import fs from 'fs';
import path from 'path';

export default function register({ on, registerItemAction, sysLog, logActivity, fetch, db, env, itemOps }) {
    
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

            let artistQuery = '';
            if (item.attributes) {
                const artistAttr = item.attributes.find(a => a.key.toLowerCase() === 'artist' || a.key.toLowerCase() === 'band');
                if (artistAttr) {
                    artistQuery = ` ${artistAttr.value}`;
                }
            }

            const searchQuery = `${safeTitle}${artistQuery}`.trim();
            const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=album&limit=3`;

            if (logActivity) {
                await logActivity(
                    item.id,
                    'Spotify Search Query',
                    `Querying Spotify API for "${searchQuery}"`,
                    'info',
                    JSON.stringify({ query: searchQuery, url: url }, null, 2)
                );
            }

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                let errorBody = "";
                try { errorBody = await res.text(); } catch (e) {}
                sysLog.error(`[SpotifyCD] API rejected request. Status: ${res.status} ${res.statusText}. Body: ${errorBody}`);
                if (logActivity) await logActivity(item.id, 'Spotify Error', `API request failed (${res.status})`, 'error', errorBody);
                throw new Error(`Spotify Search Failed: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            const albums = data.albums?.items;

            if (!albums || albums.length === 0) {
                sysLog.warn(`[SpotifyCD] No albums found on Spotify for query: "${searchQuery}"`);
                if (logActivity) await logActivity(item.id, 'Spotify Response', `No matching albums found.`, 'warning');
                return;
            }

            const bestAlbum = albums[0];
            sysLog.info(`[SpotifyCD] Match found: ${bestAlbum.name}`);

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
                        await logActivity(item.id, 'Spotify Tracks', `Attached ${tracksAdded} tracks as native app links.`, 'success');
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
                        if (logActivity) await logActivity(item.id, 'Cover Art', 'Downloaded album cover from Spotify.', 'success');
                    }
                } catch (imgErr) {
                    sysLog.error(`[SpotifyCD] Failed to download cover art:`, imgErr);
                }
            }

        } catch (error) {
            sysLog.error(`[SpotifyCD] Unhandled error during CD enrichment:`, error);
            if (logActivity) await logActivity(item.id, 'Spotify Sync Failed', error.message, 'error');
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