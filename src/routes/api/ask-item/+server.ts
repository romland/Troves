import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { env } from '$env/dynamic/private';
import { uploadsDiskFolder, uploadsWebFolder } from '$lib/server/constants';
import fs from 'fs';
import path from 'path';
import { logActivity } from '$lib/server/logger';
import { getSafeFilename } from '$lib/server/fsUtils';
import { generateText, analyzeImage } from '$lib/server/ai/index';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (locals.role !== 'EDITOR' && locals.role !== 'OWNER' && !locals.user.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

        const { itemId, question, includePhoto } = await request.json();

    const item = await db.item.findUnique({
        where: { id: itemId, inventoryId: locals.activeInventoryId },
        include: { attributes: true, photos: true, documents: true }
    });

    if (!item) return json({ error: 'Item not found' }, { status: 404 });

    // Gather Context
    const attrs = item.attributes.map(a => `${a.key}: ${a.value}`).join('\n');
    const ocrText = item.photos.map(p => {
        try { return JSON.parse(p.ocr || '{}')?.data?.map((b:any) => b[1][0]).join(' ') || ''; } catch(e) { return ''; }
    }).join('\n');
    
    const docsText = item.documents.map(d => {
        try { return JSON.parse(d.extracts || '[]').join('\n'); } catch(e) { return ''; }
    }).join('\n');

    const prompt = `You are a helpful, premium assistant embedded in a personal inventory app called Troves.
The user is asking a question about a specific item they own. 
Provide a clear, concise, brief without losing information, and beautifully formatted Markdown answer. 
If the answer requires general knowledge (like "what glue sticks does a Dremel 930 use?"), seamlessly utilize your general knowledge, but ground it in the item's context if applicable.
IMPORTANT: Do not use H1 (#) or H2 (##) headers in your response. Use H3 (###) or bold text for sections.

--- ITEM CONTEXT ---
Title: ${item.title}
Description: ${item.description || 'None'}
Attributes:
${attrs}

Visible Text on Item (OCR):
${ocrText.substring(0, 2000)}

Related Documents/Manuals Extracts:
${docsText.substring(0, 3000)}
--------------------

USER QUESTION: ${question}
`;

        let answer = '';

        if (includePhoto) {
            const primaryPhoto = item.photos.find(p => p.type === 'product' && p.orgPath);
            if (primaryPhoto) {
                try {
                    const localFilePath = `data${primaryPhoto.orgPath}`;
                    const fileBuffer = fs.readFileSync(localFilePath);
                    const ext = path.extname(localFilePath).toLowerCase();
                    let mimeType = 'image/jpeg';
                    if (ext === '.png') mimeType = 'image/png';
                    else if (ext === '.webp') mimeType = 'image/webp';

                    answer = await analyzeImage(prompt, mimeType, fileBuffer.toString('base64'), false, undefined, 'AI Assistant Q&A', { itemId }, 'QNA');
                } catch (err) {
                    console.error("Failed to load photo for AI context:", err);
                }
            }
        }

    try {
        if (!answer) {
            answer = await generateText('You are a helpful assistant.', prompt, false, undefined, 'AI Assistant Q&A', { itemId }, 'QNA');
        }

        // Save to Notebook (Document)
        const filename = getSafeFilename(`item-${item.id}-qna`);
        
        const markdownContent = `## 💬 Question\n> ${question}\n\n---\n\n${answer}`;
        // const markdownContent = `# ${question}\n\n---\n\n${answer}`;
        // const markdownContent = `> ### 💬 ${question}\n\n---\n\n${answer}`;
        fs.writeFileSync(`${uploadsDiskFolder}/${filename}.md`, markdownContent, { encoding: "utf8" });

        const doc = await db.document.create({
            data: {
                itemId: item.id,
                type: "note",
                title: `Q: ${question}`,
                source: "AI Assistant",
                path: `${uploadsWebFolder}/${filename}.md`,
                extracts: JSON.stringify([markdownContent]),
                summary: markdownContent
            }
        });


        const debugPayload = JSON.stringify({
            model: 'gemini-3.1-flash-lite',
            question: question,
                includedPhoto: includePhoto ? 'Yes' : 'No',
            prompt: prompt,
            response: answer
        }, null, 2);

        await logActivity(item.id, 'AI Assistant', `Generated answer for: "${question}"`, 'success', debugPayload);
        return json({ success: true, answer, document: doc });
    } catch (e) {
        console.error("AI Question Failed:", e);
        return json({ error: 'Failed to generate answer' }, { status: 500 });
    }
};