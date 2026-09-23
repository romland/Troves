/**
 * This is the "Feel-Good" Telemetry.
 * 
 * It's a tiny ping when Troves boots up or gets installed. It’s only to keep me
 * motivated.
 * 
 * It sends the app version and an randomly generated instance ID. It absolutely
 * does not send your IP (and your server's IP is dropped), inventory data, 
 * photos, or keys or anything else.  
 * 
 * Verify it: The code is below. 
 * 
 * You can grep for `pingTelemetry` to see how and where it's called.
 * 
 * On my end, the data looks like this:
 * > SELECT * FROM pings;
 *      id  event   version         instance_id                           created_at
 *      1   boot    v0.9.1-c959adc  a2bbced5-1860-47a8-920f-307a3d6aef6c  2026-09-21 09:20:40
 * 
 * That said, I totally get wanting your self-hosted software to stay completely quiet.
 * If you want to opt out, just add `DISABLE_FEELGOOD_TELEMETRY="true"` to your `.env`
 * file. It won't make a peep, no hard feelings!
 */
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { sysLog } from './logger';

const TELEMETRY_ENDPOINT = 'https://troves-ping-catcher.cloudflareworkers-6c9.workers.dev/'; 

export async function pingTelemetry(event: 'install' | 'boot') {
    // Respect request for absolute silence!
    if (env.DISABLE_FEELGOOD_TELEMETRY === 'true') {
        return;
    }

    try {
        // Generate a UUID and persist it to the data directory so it survives reboots.
        // If the directory is wiped, it's a "new" user. Makes sense?
        const dataDir = path.join(process.cwd(), 'data');
        const idPath = path.join(dataDir, '.instance_id');
        
        let instanceId = '';
        
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(idPath)) {
            instanceId = fs.readFileSync(idPath, 'utf8').trim();
        } else {
            instanceId = crypto.randomUUID();
            fs.writeFileSync(idPath, instanceId, 'utf8');
        }

        // Troves version and the anonymous instance id.
        const payload = {
            event,
            version: import.meta.env.PUBLIC_APP_VERSION || 'dev',
            instanceId
        };

        // Fire and forget with a strict 3-second timeout so it never blocks Troves
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        // Let user know!
        sysLog.info("❤️  Ping!");

        fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        }).catch(() => {
            // Silently swallow network errors (e.g. offline, pi-hole block, endpoint down)
            // We don't care.
        console.log("PING FAIL 1!")
        }).finally(() => {
            clearTimeout(timeoutId);
        });

    } catch (e) {
        console.log("PING FAIL 2!")
        // We don't care.
    }
}