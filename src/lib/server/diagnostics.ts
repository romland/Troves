import { exec } from 'child_process';
import { promisify } from 'util';
import { env } from '$env/dynamic/private';
import os from 'os';
import fs from 'fs';

const execAsync = promisify(exec);

async function checkCommand(cmd: string) {
    try { await execAsync(`command -v ${cmd}`); return true; } catch { return false; }
}

async function checkService(url: string) {
    try { await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

export async function getSystemDiagnostics() {
    const totalRamGB = os.totalmem() / (1024 ** 3);
    const isContainer = fs.existsSync('/.dockerenv') || env.DOCKER_MODE === 'true';

    const deps = [
        { id: 'ffmpeg', name: 'FFmpeg', desc: 'Extracts frames from video files.', cmd: 'apt-get install ffmpeg', installed: await checkCommand('ffmpeg') },
        { id: 'pdftoppm', name: 'Poppler (pdftoppm)', desc: 'Generates PDF thumbnails.', cmd: 'apt-get install poppler-utils', installed: await checkCommand('pdftoppm') },
        { id: 'ytdlp', name: 'yt-dlp', desc: 'Downloads linked videos natively.', cmd: 'pip install yt-dlp', installed: await checkCommand('yt-dlp') },
        { id: 'docker', name: 'Docker', desc: isContainer ? 'Managed (Containerized)' : 'Microservice management.', cmd: 'apt-get install docker', installed: isContainer || await checkCommand('docker') },
    ];

    const microservices = [
        { id: 'rembg', name: 'RemBG', ram: 8, desc: 'Image background removal', port: 7000, running: await checkService(`${env.REMBG_URL || 'http://localhost:7000'}/api/remove`) },
        { id: 'paddleocr', name: 'PaddleOCR', ram: 2, desc: 'Local text extraction', port: 8000, running: await checkService(`${env.PADDLE_URL || 'http://localhost:8000'}/`) },
        { id: 'singlefile', name: 'SingleFile', ram: 1, desc: 'Webpage archiver', port: 8001, running: await checkService(`${env.SINGLEFILE_URL || 'http://localhost:8001'}/`) }
    ];

	const { getAIConfig } = await import('./ai/index');
	const mapEngine = (modality: 'VISION' | 'TEXT' | 'AUDIO', task: string, subTask?: string) => {
		const config = getAIConfig(modality, subTask);
		const isLocal = !!(config.baseURL && (config.baseURL.includes('localhost') || config.baseURL.includes('127.0.0.1') || config.baseURL.includes('192.168.')));
		const hasValidKey = !!(config.apiKey && config.apiKey.trim() !== '' && !config.apiKey.includes('AQ....') && !config.apiKey.includes('gsk_...') && !config.apiKey.includes('sk-...'));
		return {
			modality,
			task,
			provider: config.provider,
			model: config.model || 'default',
			configured: hasValidKey || isLocal
		};
	};

	const engines = [
		mapEngine('VISION', 'Base / Default'),
		mapEngine('VISION', 'Classification', 'CLASSIFY'),
		mapEngine('VISION', 'Multi-Scan Grid', 'MULTISCAN'),
		mapEngine('VISION', 'Guess Refinement', 'GUESS'),
		mapEngine('TEXT', 'Base / Default'),
		mapEngine('TEXT', 'Document/Web Summaries', 'SUMMARY'),
		mapEngine('TEXT', 'Invoice/Receipt Parser', 'PARSER'),
		mapEngine('TEXT', 'KVP Table Extractor', 'KVPPARSER'),
		mapEngine('TEXT', 'Taxonomy Generation', 'TAXONOMY'),
		mapEngine('TEXT', 'Ask Troves (Q&A)', 'QNA'),
		mapEngine('AUDIO', 'Voice Dictation', 'DICTATION'),
	];

	return { totalRamGB, deps, microservices, engines };
}

export async function checkEngineHealth() {
	const { getSystemDiagnostics } = await import('./diagnostics');
	const { engines } = await getSystemDiagnostics();
	const missingEngines = engines.filter(e => !e.configured);
	return {
		hasMissingKeys: missingEngines.length > 0,
		missingEngines
	};
}
