import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import QRUrlDownloader from '$lib/server/urldownloader';
import { summarizeWebpageExtract } from '$lib/server/llm';
import { getSafeFilename } from '$lib/server/fsUtils';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';
import fs from 'fs';
import { stripHtmlSafe, extractHtmlTitleSafe } from '$lib/server/htmlUtils';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden. Viewer access only.' }, { status: 403 });

    try {
        const { type, payload } = await request.json();
        console.log(`[Background Task] Received draft document request: type=${type}`);
        let summary = "";
        let title = "";
        let path = "";
        let extracts = "[]";

        const docFilename = getSafeFilename(`draft-doc`);

        if (type === 'url') {
            console.log(`[Background Task] Fetching URL: ${payload}`);
            if (!QRUrlDownloader.isURL(payload)) {
                return json({ error: 'Invalid or unsafe URL' }, { status: 400 });
            }
            const result = await QRUrlDownloader.downloadURL(payload);
            if (result) {
                const parsed = JSON.parse(result);

                // Fallback: If SingleFile failed to grab the title, manually extract it from HTML
                if (!parsed.title && parsed.html) {
                    parsed.title = extractHtmlTitleSafe(parsed.html, payload);
                }

                title = parsed.title;
                path = `${uploadsWebFolder}/${docFilename}.html`;
                console.log(`[Background Task] Saving HTML to ${path}`);

                fs.writeFileSync(`${uploadsDiskFolder}/${docFilename}.html`, parsed.html, { encoding: "utf8" });

                let extractText = parsed.extracts?.[0] || "";
                
                // Fallback: If readability failed, aggressively strip HTML tags to get raw text for the LLM
                if (extractText.length <= 50 && parsed.html) {
                    extractText = stripHtmlSafe(parsed.html, 10000);
                    // Overwrite the empty array so the DB actually saves the raw text
                    parsed.extracts = [extractText];
                }
                extracts = JSON.stringify(parsed.extracts || []);

                if (extractText.length > 50) {
                    console.log(`[Background Task] Summarizing extract with LLM...`);
                    summary = await summarizeWebpageExtract(extractText.substring(0, 5000));
                }
            } else {
                console.warn(`[Background Task] Failed to fetch URL: ${payload}`);
                return json({ error: 'Failed to download URL' }, { status: 400 });
            }
        } else if (type === 'text') {
            title = "Pasted Note";
            extracts = JSON.stringify([payload]);
            path = `${uploadsWebFolder}/${docFilename}.txt`;
            console.log(`[Background Task] Saving text to ${path}`);
            fs.writeFileSync(`${uploadsDiskFolder}/${docFilename}.txt`, payload, { encoding: "utf8" });
            console.log(`[Background Task] Summarizing note with LLM...`);
            summary = await summarizeWebpageExtract(payload.substring(0, 5000));
        }

        console.log(`[Background Task] Finished processing ${type} draft.`);
        return json({ success: true, summary, title, path, extracts, source: payload });
    } catch (e) {
        console.error("Draft document processing error:", e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};