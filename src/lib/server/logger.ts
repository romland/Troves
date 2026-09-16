/**
 * ============================================================================
 * TROVES SYSTEM LOGGER (sysLog)
 * ============================================================================
 * A tiny, zero-dependency server-side logger that wraps Node's native console.
 * It provides consistent timestamps, level thresholds, and smart Error extraction
 * without sacrificing V8's native object inspection (colors, deep object expansion).
 * 
 * CONFIGURATION:
 * Set `LOG_LEVEL` in your `.env` file. 
 * Defaults to 'info' if omitted.
 * Valid levels: 'debug', 'info', 'warn', 'error'.
 * 
 * EXAMPLES:
 * 
 * 1. Standard Logging (String only)
 *    sysLog.info("Deep scan completed successfully.");
 *    // -> [16sep2026 23:45:04] [INFO] Deep scan completed successfully.
 * 
 * 2. Logging with Objects (Native console inspection is preserved!)
 *    sysLog.debug("Extracted attributes from LLM", { color: "red", size: "M" });
 *    // -> [16sep2026 23:45:04] [DEBUG] Extracted attributes from LLM { color: 'red', size: 'M' }
 * 
 * 3. Smart Error Formatting
 *    try { 
 *        throw new Error("Disk full"); 
 *    } catch (e) {
 *        sysLog.error("Upload pipeline crashed", e);
 *        // -> [16sep2026 23:45:04] [ERROR] Upload pipeline crashed 
 *        //        Error: Disk full
 *        //        at /src/routes/... (full stack trace)
 *    }
 * 
 * 4. Multiple Arguments
 *    sysLog.warn("Item missing", itemId, "in container", containerName);
 *    // -> [16sep2026 23:45:04] [WARN] Item missing 42 in container Box A
 * ============================================================================
 */
import { db } from '$lib/server/database';
import { env } from '$env/dynamic/private';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
type LogLevel = keyof typeof LEVELS;

const currentLevelStr = (env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const MIN_LEVEL = LEVELS[currentLevelStr] ?? LEVELS.info;

// 1. SAVE THE ORIGINAL CONSOLE NATIVES (Crucial to prevent infinite loops)
const native = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
};

function formatArg(arg: any) {
    if (arg instanceof Error) {
        return `\n    ${arg.stack || arg.message}`;
    }
    return arg;
}

// Adjusted to take `...args` entirely, since `console.log({ obj: 1 })` doesn't pass a string first
function out(level: LogLevel, ...args: any[]) {
    if (LEVELS[level] < MIN_LEVEL) return;

    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const ts = `${pad(d.getDate())}${months[d.getMonth()]}${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    const prefix = `[${ts}] [${level.toUpperCase()}]`;
    const processedArgs = args.map(formatArg);

    // 2. USE THE NATIVE METHODS TO OUTPUT
    if (level === 'error') native.error(prefix, ...processedArgs);
    else if (level === 'warn') native.warn(prefix, ...processedArgs);
    else if (level === 'debug') native.debug(prefix, ...processedArgs);
    else native.log(prefix, ...processedArgs);
}

export const sysLog = {
    debug: (...args: any[]) => out('debug', ...args),
    info:  (...args: any[]) => out('info', ...args),
    warn:  (...args: any[]) => out('warn', ...args),
    error: (...args: any[]) => out('error', ...args)
};

// 3. MONKEY-PATCH GLOBAL CONSOLE
// Only do this on the server side (Node.js) so we don't mess up the browser console
if (typeof window === 'undefined') {
    console.log = (...args: any[]) => out('info', ...args);
    console.info = (...args: any[]) => out('info', ...args);
    console.warn = (...args: any[]) => out('warn', ...args);
    console.error = (...args: any[]) => out('error', ...args);
    console.debug = (...args: any[]) => out('debug', ...args);
}


// ============================================================================
// DATABASE ACTIVITY LOGGER
// ============================================================================

export async function logActivity(itemId: number | null | undefined, action: string, message: string, level: string = 'info', payload: string | null = null) {
    try {
        await db.activityLog.create({
            data: { itemId: itemId || null, action, message, level, payload }
        });
    } catch (e) {
        // We use sysLog directly here, but now console.error would do the exact same thing!
        sysLog.error(`Failed to log activity (Action: ${action}, ItemID: ${itemId})`, e);
    }
}