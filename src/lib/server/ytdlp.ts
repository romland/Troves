import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSafeFilename } from '$lib/server/fsUtils';

const execFileAsync = promisify(execFile);

let ytDlpAvailable: boolean | null = null;

export async function isYtDlpAvailable() {
    if (ytDlpAvailable !== null) return ytDlpAvailable;
    try {
        await execFileAsync('yt-dlp', ['--version']);
        ytDlpAvailable = true;
    } catch {
        ytDlpAvailable = false;
    }
    return ytDlpAvailable;
}

export async function fetchVideoIfSupported(
    url: string, 
    diskFolder: string, 
    webFolder: string, 
    prefix: string,
    onStart?: (title: string) => Promise<void>
) {
    if (!(await isYtDlpAvailable())) {
        console.log("[yt-dlp] SKIPPED: yt-dlp is not installed or not in PATH.");
        return null;
    }
    
    try {
        // 1. Ask yt-dlp to dump the JSON metadata. If it succeeds, the site is supported!
        // We use a timeout to prevent hanging on unsupported/slow sites.
        const { stdout: jsonOut } = await execFileAsync('yt-dlp', [
            '--dump-json', '--no-playlist', '--playlist-items', '1', '--js-runtimes', 'node', '--extractor-args', 'generic:impersonate', url
        ], { timeout: 15000, maxBuffer: 10 * 1024 * 1024 });

        // Extract the first valid JSON object to avoid crashing on Newline Delimited JSON (NDJSON) or warnings
        const jsonLine = jsonOut.split('\n').find(line => line.trim().startsWith('{'));
        if (!jsonLine) return null;
        const meta = JSON.parse(jsonLine);
        
        if (!meta || !meta.title) return null;
        
        // Signal to the logger that we successfully found a video and are about to start the heavy download
        if (onStart) await onStart(meta.title);

        const safeName = getSafeFilename(prefix + '-video');
        const finalDiskPath = `${diskFolder}/${safeName}.mp4`;
        const finalWebPath = `${webFolder}/${safeName}.mp4`;
        
        // 2. Download the best available MP4 configuration
        // We strictly prefer H.264 (avc) video to ensure 100% cross-browser web playback, avoiding HEVC/H.265 blind spots.
		const t0 = performance.now();
		console.log(`[yt-dlp] 🚀 Starting heavy background download for: ${url}`);
        await execFileAsync('yt-dlp', [
            '-f', 'bestvideo+bestaudio/best', '-S', 'vcodec:h264,res,acodec:m4a', '--merge-output-format', 'mp4', '--extractor-args', 'generic:impersonate',
            '-o', finalDiskPath, '--no-playlist', '--playlist-items', '1', '--js-runtimes', 'node', url
        ]);
		console.log(`[yt-dlp] ✅ Finished download in ${((performance.now() - t0) / 1000).toFixed(2)}s for: ${url}`);

        return {
            title: meta.title,
            description: meta.description || '',
            path: finalWebPath
        };
    } catch (e: any) {
        // yt-dlp acts as a probe. It's expected to fail on standard webpages.
        // We only log actual execution errors, ignoring routine "Unsupported URL" rejections.
        if (e?.stderr && !e.stderr.includes('Unsupported URL')) {
            console.error("[yt-dlp] Probe execution error for url:", url, "\n", e.stderr);
        }
        return null;
    }
}