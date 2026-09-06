import sharp from 'sharp';
import jsQR from 'jsqr';
import { db } from '$lib/server/database';
import type { Item } from '@prisma/client';
import { downloadQRURLs } from './photouploads';
import { getSafeFilename } from './fsUtils';
import fs from 'fs';
import { summarizeWebpageExtract } from './llm';
import { PDFParse } from 'pdf-parse';
import { ioQueue } from './queue/index';
import { assertSafeHostname } from '$lib/server/security';
import { logActivity } from '$lib/server/logger';
import { taskManager } from '$lib/server/taskManager';
import { fetchVideoIfSupported } from './ytdlp';
import { extractEpubText } from './epub';
import { isPdf, isEpub } from '$lib/shared/fileutils';
import { decodeHtmlEntities } from '$lib/shared/fileutils';
    import { env } from '$env/dynamic/private';

export async function downloadAndStoreDocuments(target: { itemId?: number, timelineNoteId?: number }, remoteSite: string, data: any, diskFolder: string, webFolder: string, formPrefix: string, depth: number = 0)
{
	const targetType = target.itemId ? 'item' : 'note';
	const targetId = target.itemId || target.timelineNoteId || 0;
	const taskId = taskManager.start(targetType, targetId, 'Fetching and parsing linked documents');
	try {  
		if (depth === 0) {
			//
			// Download all URLs contained in _uploaded_ pictures containing QR codes (TODO: SECURITY?)
			// (this is largely obsolete after I started using client-side QR code scanner)
			//
			await downloadQRURLs(data, diskFolder, webFolder, formPrefix, remoteSite, target.itemId ? { id: target.itemId } : { id: target.timelineNoteId });
		}
		
		//
		// Download all URLs in the URLs field (TODO: SECURITY?)
		//
		const lines = (data.urls as string || "").split("\n");
		const deepLinksToFetch: string[] = [];
		
		for(let i = 0; i < lines.length; i++) {
			let rawLine = lines[i].trim();
			if (rawLine === "") continue;
			
			// Input sanitization: strip trailing punctuation from messy copy-pastes
			rawLine = rawLine.replace(/[,.;:)\]"']+$/, '');
			
			let validUrl: URL;
			try {
				const urlToTest = rawLine.match(/^https?:\/\//i) ? rawLine : `https://${rawLine}`;
				validUrl = new URL(urlToTest);
			} catch (e) {
				console.log(`[URL Sanitizer] Invalid URL skipped: ${rawLine}`);
				continue;
			}
			
			let line = validUrl.toString();
			
			// Transform GitHub repo URLs to ZIP downloads
			const githubMatch = line.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)\/?$/i);
            let customTitle: string | null = null;
			if (githubMatch) {
                line = `https://github.com/${githubMatch[1]}/${githubMatch[2]}/archive/HEAD.zip`;
                customTitle = `GitHub Repo: ${githubMatch[1]}/${githubMatch[2]} (${new Date().toISOString().split('T')[0]})`;
			}

			// Enforce strict SSRF protection before any fetch
			if (!QRUrlDownloader.isURL(line)) {
				console.log(`[Security] Blocked internal SSRF attempt: ${line}`);
				continue;
			}
			
			let document;
			try {
				document = await db.document.findFirst({
					where: {
						source: line,
						itemId: target.itemId || null,
						timelineNoteId: target.timelineNoteId || null
					}
				});
				
				if (!document) {
					document = await db.document.create({
						data: {
							itemId: target.itemId || null,
							timelineNoteId: target.timelineNoteId || null,
							type: "uncategorized",
							title: "",
							source: line,
							path: "",
							extracts: "[]"
						}
					});
				} else if (document.path && document.path.trim().length > 0) {
					console.log(`https://en1.savefrom.net/19wr/ Already downloaded, skipping: ${line}`);
					continue;
				}
			} catch (ex) {
				console.error("Error creating document in DB:", ex);
			}
			
			// Divert to PDF handler if needed
			if (await isPdfUrl(line)) {
				try {
					await handlePdfDownload(line, target, document?.id, diskFolder, webFolder);
					await logActivity(target.itemId, 'PDF Download', `Successfully parsed PDF: ${line}`, 'success');
				} catch (e) {
					console.error(`Error downloading PDF ${line}:`, e);
					await logActivity(target.itemId, 'PDF Download', `Failed to download PDF: ${line}`, 'error');
					if (document && !document.path) await db.document.delete({ where: { id: document.id } });
				}
				continue; // Skip SingleFile logic
			}
			
			// Divert to EPUB handler if needed
			if (await isEpubUrl(line)) {
				try {
					await handleEpubDownload(line, target, document?.id, diskFolder, webFolder);
					await logActivity(target.itemId, 'EPUB Download', `Successfully parsed EPUB: ${line}`, 'success');
				} catch (e) {
					console.error(`Error downloading EPUB ${line}:`, e);
					await logActivity(target.itemId, 'EPUB Download', `Failed to download EPUB: ${line}`, 'error');
					if (document && !document.path) await db.document.delete({ where: { id: document.id } });
				}
				continue; // Skip SingleFile logic
			}

			// Divert to ZIP handler if needed
			if (line.toLowerCase().endsWith('.zip')) {
				try {
					await handleGenericFileDownload(line, target, document?.id, diskFolder, webFolder, 'zip', customTitle);
					await logActivity(target.itemId, 'File Download', `Successfully downloaded ZIP: ${line}`, 'success');
				} catch (e) {
					console.error(`Error downloading ZIP ${line}:`, e);
					if (document && !document.path) await db.document.delete({ where: { id: document.id } });
				}
				continue; // Skip SingleFile logic
			}
			
			const idStr = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
			
			await logActivity(target.itemId, 'Link Analysis', `Inspecting URL for media content: ${line}`, 'info');
			
			// Divert to Video handler if yt-dlp supports the site
			try {
				const videoData = await fetchVideoIfSupported(line, diskFolder, webFolder, idStr, async (title) => {
					await logActivity(target.itemId, 'Video Archiver', `Detected video: "${title}". Starting heavy download...`, 'info');
				});
				if (videoData) {
					await db.document.update({
						where: { id: document?.id },
						data: {
							type: "video",
							title: videoData.title,
							path: videoData.path,
							extracts: JSON.stringify([videoData.description.substring(0, 1000)])
						}
					});
					await logActivity(target.itemId, 'Video Archiver', `Successfully archived video: ${videoData.title}`, 'success');
					
					// Fire and forget thumbnail extraction
					import('$lib/server/thumbExtractor').then(({ generateDocumentThumbnail }) => {
                        generateDocumentThumbnail(document.id, videoData.path.replace('/images/u', 'data/images/u'), 'video');
					});
					
					continue; // Skip SingleFile logic
				}
			} catch(e) {
				console.error("Video processing error:", e);
			}
			
			await logActivity(target.itemId, 'Web Scraper', `No video found. Scraping as standard webpage: ${line}`, 'info');
			const str: string|null = await QRUrlDownloader.downloadURL(line);
			if(!str) {
				console.log(`Did not get any result when downloading: ${line}`);
				await logActivity(target.itemId, 'Web Scraper', `Failed to fetch webpage: ${line}`, 'warning');
				if (document && !document.path) await db.document.delete({ where: { id: document.id } });
				continue;
			}
			
			const pageData = JSON.parse(str);
			const docFilename = getSafeFilename(`${idStr}-doc`);
			
			fs.writeFileSync(`${diskFolder}/${docFilename}.html`, pageData.html, { encoding: "utf8" });
			await logActivity(target.itemId, 'Web Scraper', `Downloaded webpage: ${pageData.title || line}`, 'success');
			
			console.log("Creating document from explicit URL", docFilename);
			
			// Fallback: If SingleFile failed to grab the title, manually extract it from HTML
			if (!pageData.title && pageData.html) {
				const titleMatch = pageData.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
				const h1Match = pageData.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
				pageData.title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : (h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : "");
			}

        pageData.title = decodeHtmlEntities(pageData.title);
			
			let extractText = pageData.extracts?.[0] || "";
			
			// Fallback: If SingleFile extraction failed, aggressively strip HTML tags
			if (extractText.length <= 50 && pageData.html) {
				extractText = pageData.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ').trim();
				pageData.extracts = [extractText.substring(0, 10000)];
			}
			
			try {
				await db.document.update({
					where: {
						id : document?.id
					},
					data: {
						itemId: target.itemId || null,
						timelineNoteId: target.timelineNoteId || null,
						type: "uncategorized",
						title: pageData.title || line, // Fallback to URL if title is blank
						source: pageData.url || line,
						path: `${webFolder}/${docFilename}.html`,
						extracts: JSON.stringify(pageData.extracts || [])
					}
				});
			} catch (ex) {
				console.error(`Error updating document in DB (${line}):`, ex);
				continue;
			}
			
			console.log(`[LLM CHECK] Extracts found: ${pageData.extracts?.length || 0} | First extract length: ${extractText.length} chars`);
			
			import('$lib/server/thumbExtractor').then(({ generateDocumentThumbnail }) => {
				generateDocumentThumbnail(document.id, '', 'html', pageData.html);
			});

			if (extractText.length > 50) {
				try {
					const summary = await summarizeWebpageExtract(extractText);
					await db.document.update({
						where: {
							id : document?.id
						},
						data: {
							summary: summary
						}
					});
					console.log("Have summary of webpage:", summary);
					await logActivity(target.itemId, 'Analysis', `Generated summary for: ${pageData.title || line}`, 'success');
				} catch (ex) {
					console.error(`Error updating document in DB (${line}):`, ex);
					continue;
				}
			} else {
				console.warn(`[LLM SKIPPED] Text extract too short (${extractText.length} chars) for URL: ${line}`);
				await logActivity(target.itemId, 'Web Scraper', `Skipped summary for ${line}, content too short.`, 'warning');
			}
			
			// DEEP SCRAPE LOGIC (Consolidated)
			const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
			const keywords = /datasheet|manual|schematic|user guide|instructions|specs|pinout|wiring|\.pdf$/i;
			let match;
			let deepLinksFound = 0;
			
			while ((match = linkRegex.exec(pageData.html)) !== null && deepLinksFound < 3) {
				const href = match[1];
				const text = match[2].replace(/<[^>]+>/g, '').trim(); 
				
				if (keywords.test(href) || keywords.test(text)) {
					try {
						const absUrl = new URL(href, line).href;
						if (!deepLinksToFetch.includes(absUrl)) {
							deepLinksToFetch.push(absUrl);
							await logActivity(target.itemId, 'Web Scraper', `Deep link queued for fetching: ${absUrl}`, 'info');
							deepLinksFound++;
						}
					} catch (e) { /* ignore invalid urls */ }
				}
			}      
			console.log("Downloaded explicitly stated URL:", line);
		}
		
		if (depth === 0 && deepLinksToFetch.length > 0) {
			await logActivity(target.itemId, 'Web Scraper', `Initiating deep scrape for ${deepLinksToFetch.length} discovered links...`, 'info');
			await downloadAndStoreDocuments(target, remoteSite, { urls: deepLinksToFetch.join('\n') }, diskFolder, webFolder, formPrefix, depth + 1);
		}
	} finally {
		taskManager.end(taskId);
	}
}

async function isPdfUrl(url: string): Promise<boolean> {
	if (isPdf(url)) return true;
	
	try {
		const headRes = await fetch(url, { method: 'HEAD' });
		const contentType = headRes.headers.get('content-type') || '';
		return contentType.toLowerCase().includes('application/pdf');
	} catch (e) {
		console.warn(`HEAD request failed for ${url}, relying on URL parsing.`);
		return false;
	}
}

async function isEpubUrl(url: string): Promise<boolean> {
	if (isEpub(url)) return true;
	
	try {
		const headRes = await fetch(url, { method: 'HEAD' });
		const contentType = headRes.headers.get('content-type') || '';
		return contentType.toLowerCase().includes('application/epub+zip');
	} catch (e) {
		return false;
	}
}

async function handlePdfDownload(url: string, target: { itemId?: number, timelineNoteId?: number }, documentId: any, diskFolder: string, webFolder: string) {
	return ioQueue.add(async () => {
		console.log(`Detected PDF, downloading directly: ${url}`);
		const pdfRes = await fetch(url);
		const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
		const idStr = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
		const docFilename = getSafeFilename(`${idStr}-doc`);
		
		fs.writeFileSync(`${diskFolder}/${docFilename}.pdf`, pdfBuffer);
		
		let extractedText = "";
		let pdfTitle = "";
		
		// First, check if the deep scraper gave us a nice anchor text label when it found the link
		const existingDoc = await db.document.findUnique({ where: { id: Number(documentId) }, select: { title: true } });
		let dbTitle = existingDoc?.title?.trim() || "";
		if (dbTitle.startsWith('Found: ')) dbTitle = dbTitle.substring(7).trim();
		
		let parser;
		try {
			// 1. Initialize with the buffer
			parser = new PDFParse({ data: pdfBuffer });
			
			// 2. Extract text (returns a TextResult object)
			const textResult = await parser.getText();
			extractedText = textResult.text;
			
			// 3. Extract metadata (returns an InfoResult object)
			const infoResult = await parser.getInfo();
			const metaTitle = infoResult.info?.Title?.trim();
			
			// Fallback Chain: Metadata -> Scraped Anchor Text -> Decoded Filename
			if (metaTitle && metaTitle.toLowerCase() !== 'untitled') {
				pdfTitle = metaTitle;
			} else if (dbTitle) {
				pdfTitle = dbTitle;
			} else {
				const urlName = url.split('/').pop()?.split('?')[0];
				if (urlName) {
					try {
						pdfTitle = decodeURIComponent(urlName).replace(/[-_]/g, ' ').trim();
					} catch(e) { pdfTitle = urlName; }
				}
			}
			
		} catch (e: any) {
			console.error("Failed to parse PDF:", e);
		} finally {
			// 4. Always destroy to free memory, as stated in the docs
			if (parser) {
				await parser.destroy();
			}
		}
		
		if (!pdfTitle) pdfTitle = "PDF Document";
		
		const cappedText = extractedText.substring(0, 10000); // Cap for LLM safety
		
		await db.document.update({
			where: { id: Number(documentId) },
			data: {
				title: pdfTitle,
				path: `${webFolder}/${docFilename}.pdf`,
				extracts: JSON.stringify([extractedText])
			}
		});
		
		import('$lib/server/thumbExtractor').then(({ generateDocumentThumbnail }) => {
			generateDocumentThumbnail(documentId, `${diskFolder}/${docFilename}.pdf`, 'pdf');
		});

		if (cappedText.trim().length > 50) {
			const summary = await summarizeWebpageExtract(cappedText);
			await db.document.update({
				where: { id: Number(documentId) },
				data: { summary: summary }
			});
			console.log("Have summary of PDF:", summary);
			await logActivity(target.itemId, 'Analysis', `Generated summary for PDF: ${pdfTitle}`, 'success');
		}
	});
}

async function handleEpubDownload(url: string, target: { itemId?: number, timelineNoteId?: number }, documentId: any, diskFolder: string, webFolder: string) {
	return ioQueue.add(async () => {
		console.log(`Detected EPUB, downloading directly: ${url}`);
		const epubRes = await fetch(url);
		const epubBuffer = Buffer.from(await epubRes.arrayBuffer());
		const idStr = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
		const docFilename = getSafeFilename(`${idStr}-doc`);
		
		const localPath = `${diskFolder}/${docFilename}.epub`;
		fs.writeFileSync(localPath, epubBuffer);
		
		if (target.itemId) {
			try {
				const { processEpubCoverToItemPhoto } = await import('$lib/server/epub');
				await processEpubCoverToItemPhoto(target.itemId, localPath);
			} catch (e) {
				console.error("Failed to extract EPUB cover:", e);
			}
		}

		const extractedText = await extractEpubText(localPath);
		const cappedText = extractedText.substring(0, 10000); // Cap for LLM safety
		
		let epubTitle = "";
		const existingDoc = await db.document.findUnique({ where: { id: Number(documentId) }, select: { title: true } });
		let dbTitle = existingDoc?.title?.trim() || "";
		if (dbTitle.startsWith('Found: ')) dbTitle = dbTitle.substring(7).trim();
		
		if (dbTitle) {
			epubTitle = dbTitle;
		} else {
			const urlName = url.split('/').pop()?.split('?')[0];
			if (urlName) {
				try { epubTitle = decodeURIComponent(urlName).replace(/[-_]/g, ' ').trim(); } catch(e) { epubTitle = urlName; }
			}
		}
		if (!epubTitle) epubTitle = "EPUB Document";
		
		await db.document.update({
			where: { id: Number(documentId) },
			data: {
				title: epubTitle,
				path: `${webFolder}/${docFilename}.epub`,
				extracts: JSON.stringify(extractedText ? [extractedText] : [])
			}
		});
		
		import('$lib/server/thumbExtractor').then(({ generateDocumentThumbnail }) => {
			generateDocumentThumbnail(documentId, `${diskFolder}/${docFilename}.epub`, 'epub');
		});

		if (cappedText.trim().length > 50) {
			const summary = await summarizeWebpageExtract(cappedText);
			await db.document.update({
				where: { id: Number(documentId) },
				data: { summary: summary }
			});
			console.log("Have summary of EPUB:", summary);
		}
	});
}

async function handleGenericFileDownload(url: string, target: { itemId?: number, timelineNoteId?: number }, documentId: any, diskFolder: string, webFolder: string, ext: string, customTitle: string | null = null) {
	return ioQueue.add(async () => {
		console.log(`Downloading generic file: ${url}`);
		const res = await fetch(url);
		const buffer = Buffer.from(await res.arrayBuffer());
		const idStr = target.itemId ? `item-${target.itemId}` : `note-${target.timelineNoteId}`;
		const docFilename = getSafeFilename(`${idStr}-doc`);
		
		fs.writeFileSync(`${diskFolder}/${docFilename}.${ext}`, buffer);
		
		let title = customTitle || url.split('/').pop()?.split('?')[0] || `File Document`;
		if (!customTitle) {
			try { title = decodeURIComponent(title).replace(/[-_]/g, ' ').trim(); } catch(e) {}
		}
		
		await db.document.update({
			where: { id: Number(documentId) },
            data: { 
                title, 
                path: `${webFolder}/${docFilename}.${ext}`, 
                extracts: "[]",
                type: ext === 'zip' ? 'zip' : 'document'
            }
		});
	});
}

export default class QRUrlDownloader
{
	static async decodeQR(imageData) : Promise<string|null>
	{
		try {
			// Use jsQR to decode the QR code
			const decodedQR = jsQR(imageData.data, imageData.width, imageData.height);
			
			if (!decodedQR) {
				// throw new Error('QR code not found in the image.');
				return null;
			}
			
			console.log("QR code decoded:", decodedQR.data)
			
			return decodedQR.data;
		} catch (error) {
			console.error('Error decoding QR code:', error);
			return null;
		}
	}
	
	static async fetchQRCodeDocument(imagePath : string) : Promise<string|null>
	{
		const imageData = await QRUrlDownloader.getImageData(imagePath);
        if (!imageData) return null;

		const qrData = await QRUrlDownloader.decodeQR(imageData);
		// console.log("QR DATA:", qrData);
		
		if(!qrData) {
			return null;
		}
		
		if(!QRUrlDownloader.isURL(qrData)) {
			console.log("There is a QR code, but it's not an URL. It says:", qrData);
			return null;
		}
		
		return await QRUrlDownloader.downloadURL(qrData);
	}
	
	static async downloadURL(url : string) : Promise<string|null>
	{
		return ioQueue.add(async () => {
			try {
				const controller = new AbortController();
				// Allow SingleFile its full 240s internal max buffer timeout + 10s grace
				const timeoutId = setTimeout(() => controller.abort(), 250000); 
				
                const singlefileUrl = env.SINGLEFILE_URL || 'http://localhost:8001';
                const response = await fetch(singlefileUrl, {
					method: 'POST',
					body: `url=${encodeURIComponent(url)}`,
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
					},
					signal: controller.signal
				});
				clearTimeout(timeoutId);
				
				if (response.ok) {
					const result = await response.text();
					console.log("URL download result", result.length, "bytes");
					return result;
				} else {
					console.log('URL download HTTP error:', response.statusText, url);
					return null;
				}
				
			} catch (error) {
				const err = error as Error;
				console.log('URL download error:', err.message, url);
				return null;
			}
		});
	}
	
	
	static isURL(url : string)
	{
		try {
			const parsed = new URL(url);
			if (!['http:', 'https:'].includes(parsed.protocol)) return false;
			
			// Prevent SSRF targeting internal networks
			if (!assertSafeHostname(parsed.hostname)) {
				return false;
			}
			return true;
		} catch (e) {
			return false;
		}
	}
	
	private static async getImageData(imagePath : string) : Promise<any>
	{
		try {
			// Load the image and extract raw RGBA pixels via Sharp
			const { data, info } = await sharp(imagePath)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
			
			return {
				data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
				width: info.width,
				height: info.height,
			};
		} catch (error) {
			console.error('Error loading image for QR check:', error);
			return null;
		}
	}
	
	private static async hasQRcode(imageData) : Promise<boolean>
	{
		return await QRUrlDownloader.decodeQR(imageData) !== null;
	}
}