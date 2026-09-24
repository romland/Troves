import fetch from 'node-fetch';
import fs from 'fs';
import FormData from 'form-data';
import { lightMlQueue } from './queue/index';
import type { TaskContext } from '$lib/server/taskManager';
import sharp from 'sharp';
import path from 'path';
import { env } from '$env/dynamic/private';

export async function getOCRdata(imageUrl : string, tracking?: TaskContext): Promise<any>
{
	if (env.ENABLE_PADDLEOCR !== 'true') return null;
	
	return lightMlQueue.add(async () => {
		let localPath = imageUrl;
		if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
			try {
				const parsedUrl = new URL(imageUrl);
				localPath = `data${parsedUrl.pathname}`;
			} catch (e) {}
		}
		
		const paddleUrl = env.PADDLE_URL || 'http://localhost:8000';
		if (fs.existsSync(localPath)) {
			const url = `${paddleUrl}/ocr/predict-by-file`;
			
			const ext = path.extname(localPath).toLowerCase();
			const unsupportedMLFormats = ['.webp', '.avif', '.heic'];
			
			let filePayload: Buffer | fs.ReadStream;
			let fileOptions: any = undefined;
			
			if (unsupportedMLFormats.includes(ext)) {
				// Convert unsupported modern web formats to lossless PNG for crisp OCR text
				filePayload = await sharp(localPath).png().toBuffer();
				fileOptions = { filename: 'image.png', contentType: 'image/png' };
			} else {
				// Pass JPEGs and PNGs directly from disk with zero overhead
				filePayload = fs.createReadStream(localPath);
			}
			
			const form = new FormData();
			form.append('file', filePayload, fileOptions);
			try {
				const response = await fetch(url, {
					method: 'POST',
					body: form,
					headers: form.getHeaders()
				});
				
				if (response.ok) {
					const result = await response.json();
					// console.log("OCR result", JSON.stringify(result));
					return result;
				} else {
					console.log('OCR Error:', response.statusText, response);
					throw new Error(response.statusText);
				}
			} catch (error) {
				const err = error as Error;
				console.log('OCR Error:', err.message);
				throw err;
			}
		}
		
		const url = `${paddleUrl}/ocr/predict-by-url`;
		try {
			const response = await fetch(url + "?imageUrl=" + encodeURIComponent(imageUrl), {
				method: 'GET',
			});
			
			if (response.ok) {
				const result = await response.json();
				// console.log("OCR result", JSON.stringify(result));
				return result;
			} else {
				console.log('OCR Error:', response.statusText, response);
				throw new Error(response.statusText);
			}
		} catch (error) {
			const err = error as Error;
			console.log('OCR Error:', err.message);
			throw err;
		}
	}, tracking ? { ...tracking, description: 'Extracting text via OCR' } : undefined);
}
