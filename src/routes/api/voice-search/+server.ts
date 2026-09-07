// src/routes/api/voice-search/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/database';
import { env } from '$env/dynamic/private';
import { recordLLMLog } from '$lib/server/llmLogger';
import { logActivity } from '$lib/server/logger';
import { tokenizeAndStem } from '$lib/server/nlp';
import { processVoiceQuery } from '$lib/server/voice/VoiceEngine';
import { transcribeAudio } from '$lib/server/ai/index';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const t0 = performance.now();
    let fileSize = 0;

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as File;
        const textQuery = formData.get('textQuery') as string || '';
        
        if (audioFile) fileSize = audioFile.size;

        if ((!audioFile || audioFile.size === 0) && !textQuery.trim()) {
            await logActivity(null, 'Voice Search', 'Received empty payload from browser.', 'error');
            recordLLMLog('Voice Search (Failed)', 'system', { error: 'Empty payload' }, { error: 'No audio or text data' }, performance.now() - t0, 0, 0);
            return json({ error: 'No audio or text provided' }, { status: 400 });
        }

        let rawTranscription = '';
        let tokensIn = 0;
        let tokensOut = 0;
        let groqData: any = {};
        let contextPrompt = '';

        // [DEBUG & TESTING WORKFLOW]
        // If the frontend passed a raw text string (from the '/v' search box command), 
        // we bypass the Groq Whisper audio transcription completely.
        // This allows us to debug the NLP Engine (VoiceEngine.ts) rapidly via text input.
        if (textQuery.trim()) {
            rawTranscription = textQuery.replace(/[.?!]+$/, '').trim();
        } else {
            // Fetch Categories and Tags to build a hyper-specific dictionary cheat sheet
            const [categories, tags] = await Promise.all([
                db.category.findMany({
                    where: { inventoryId: locals.activeInventoryId },
                    select: { name: true }
                }),
                db.tag.findMany({
                    where: { inventoryId: locals.activeInventoryId },
                    select: { name: true },
                    take: 50 // Limit to avoid overflowing Whisper's 224-token prompt window
                })
            ]);

            const categoryNames = categories.map(c => c.name).join(', ');
            const tagNames = tags.map(t => t.name).join(', ');
            
            // We prime the model with the user's exact data to guide unfamiliar spellings
            contextPrompt = `Inventory search context. Expected vocabulary includes: ${categoryNames}. Tags: ${tagNames}.`;

            const transcription = await transcribeAudio(audioFile, contextPrompt, 'DICTATION');
            
            rawTranscription = transcription.text.replace(/[.?!]+$/, '').trim();
            groqData = transcription as any;
            tokensIn = transcription.usage?.prompt_tokens || Math.round(fileSize / 100); 
            tokensOut = transcription.usage?.completion_tokens || rawTranscription.split(' ').length;

            const hallucinatedPromptWords = ['tags', 'inventory search context', 'expected vocabulary includes'];
            if (!rawTranscription || hallucinatedPromptWords.includes(rawTranscription.toLowerCase())) {
                return json({ error: "Didn't catch that. Please try again." }, { status: 400 });
            }
        }

        // [CORE INTENT ENGINE]
        // Pass the raw text (either transcribed from voice (groq) or typed (local) via debug) into the middleware
        const { query: finalQuery, spokenReply, route } = await processVoiceQuery(rawTranscription, locals.activeInventoryId);
        const durationMs = performance.now() - t0;

        const provider = textQuery.trim() ? 'local' : (groqData.provider || 'unknown');
        const logTitle = textQuery.trim() ? 'Voice Intent (Text Test)' : 'Voice Search';

        recordLLMLog(logTitle, provider, { prompt: contextPrompt, textQuery, fileSize }, { text: rawTranscription, finalQuery, spokenReply, usage: transcription?.usage }, durationMs, tokensIn, tokensOut);
        await logActivity(null, logTitle, `Parsed intent to query: "${finalQuery}"`, 'info');

        return json({ success: true, text: finalQuery, spokenReply, route });
    } catch (error: any) {
        console.error('Voice search error:', error);
        const durationMs = performance.now() - t0;
        recordLLMLog('Voice Search (Failed)', 'system', { fileSize }, { error: error.message }, durationMs, 0, 0);
        await logActivity(null, 'Voice Search', `Intent processing failed.`, 'error', error.message);
        return json({ error: 'Transcription failed' }, { status: 500 });
    }
};
