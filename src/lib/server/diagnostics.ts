import { exec } from 'child_process';
import { promisify } from 'util';
import { env } from '$env/dynamic/private';
import os from 'os';

const execAsync = promisify(exec);

async function checkCommand(cmd: string) {
    try { await execAsync(`command -v ${cmd}`); return true; } catch { return false; }
}

async function checkService(url: string) {
    try { await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

export async function getSystemDiagnostics() {
    const totalRamGB = os.totalmem() / (1024 ** 3);

    const deps = [
        { id: 'ffmpeg', name: 'FFmpeg', desc: 'Extracts frames from video files.', cmd: 'apt-get install ffmpeg', installed: await checkCommand('ffmpeg') },
        { id: 'pdftoppm', name: 'Poppler (pdftoppm)', desc: 'Generates PDF thumbnails.', cmd: 'apt-get install poppler-utils', installed: await checkCommand('pdftoppm') },
        { id: 'ytdlp', name: 'yt-dlp', desc: 'Downloads linked videos natively.', cmd: 'pip install yt-dlp', installed: await checkCommand('yt-dlp') },
        { id: 'docker', name: 'Docker', desc: 'Microservice management.', cmd: 'apt-get install docker', installed: await checkCommand('docker') },
    ];

    const microservices = [
        { id: 'rembg', name: 'RemBG', ram: 8, desc: 'Image background removal', port: 7000, running: await checkService(`${env.REMBG_URL || 'http://localhost:7000'}/api/remove`) },
        { id: 'paddleocr', name: 'PaddleOCR', ram: 2, desc: 'Local text extraction', port: 8000, running: await checkService(`${env.PADDLE_URL || 'http://localhost:8000'}/`) },
        { id: 'singlefile', name: 'SingleFile', ram: 1, desc: 'Webpage archiver', port: 8001, running: await checkService(`${env.SINGLEFILE_URL || 'http://localhost:8001'}/`) }
    ];

    const apis = {
        vision: { provider: env.AI_VISION_PROVIDER || 'gemini', configured: !!env.AI_VISION_API_KEY || !!env.AI_VISION_BASE_URL },
        text: { provider: env.AI_TEXT_PROVIDER || 'openai', configured: !!env.AI_TEXT_API_KEY || !!env.AI_TEXT_BASE_URL },
        audio: { provider: env.AI_AUDIO_PROVIDER || 'openai', configured: !!env.AI_AUDIO_API_KEY || !!env.AI_AUDIO_BASE_URL }
    };

    return { totalRamGB, deps, microservices, apis };
}
