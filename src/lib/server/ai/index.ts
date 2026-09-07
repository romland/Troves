import { env } from '$env/dynamic/private';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { apiQueue } from '../queue/index';
import { withRetry } from '../retry';
import type { TaskContext } from '../taskManager';

export type AIModality = 'VISION' | 'TEXT' | 'AUDIO';

export interface AIConfig {
    provider: string;
    model: string;
    baseURL: string | undefined;
    apiKey: string | undefined;
}

export function getAIConfig(modality: AIModality, subTask?: string): AIConfig {
    const prefixSpecific = `AI_${modality}_${subTask}`;
    const prefixDefault = `AI_${modality}`;

    const provider = ((subTask && env[`${prefixSpecific}_PROVIDER`]) ? env[`${prefixSpecific}_PROVIDER`] : env[`${prefixDefault}_PROVIDER`] || (modality === 'VISION' ? 'gemini' : 'openai')).toLowerCase();
    const model = (subTask && env[`${prefixSpecific}_MODEL`]) ? env[`${prefixSpecific}_MODEL`] : env[`${prefixDefault}_MODEL`];
    const baseURL = (subTask && env[`${prefixSpecific}_BASE_URL`]) ? env[`${prefixSpecific}_BASE_URL`] : env[`${prefixDefault}_BASE_URL`];
    let apiKey = (subTask && env[`${prefixSpecific}_API_KEY`]) ? env[`${prefixSpecific}_API_KEY`] : env[`${prefixDefault}_API_KEY`];

    // Global fallback for base keys
    if (!apiKey) {
        if (provider === 'gemini') apiKey = env.GEMINI_API_KEY;
        else if (provider === 'groq') apiKey = env.GROQ_API_TOKEN;
        else if (provider === 'openai' || provider === 'replicate') apiKey = env.OPENAI_API_TOKEN;
    }

    return {
        provider,
        model: model || '',
        baseURL: baseURL || undefined,
        apiKey: apiKey || undefined,
    };
}

let _openai: OpenAI;
let _groq: Groq;
let _gemini: GoogleGenAI;

export function getOpenAIClient(config: AIConfig): OpenAI {
    if (!_openai) {
        if (!config.apiKey && !config.baseURL?.includes('localhost')) {
            throw new Error(`API Key missing for OpenAI-compatible provider (${config.model})`);
        }
        _openai = new OpenAI({
            apiKey: config.apiKey || 'not-needed-for-local',
            baseURL: config.baseURL || undefined,
        });
    }
    return _openai;
}

export function getGroqClient(config: AIConfig): Groq {
    if (!_groq) {
        if (!config.apiKey) throw new Error(`API Key missing for Groq provider (${config.model})`);
        _groq = new Groq({ apiKey: config.apiKey });
    }
    return _groq;
}

export function getGeminiClient(config: AIConfig): GoogleGenAI {
    if (!_gemini) {
        if (!config.apiKey) throw new Error(`API Key missing for Gemini provider (${config.model})`);
        _gemini = new GoogleGenAI({ apiKey: config.apiKey });
    }
    return _gemini;
}

/**
 * Universal Text/JSON Generation Router (Queued, Retried, Logged)
 */
export async function generateText(
    systemPrompt: string, 
    userPrompt: string, 
    jsonMode: boolean = false, 
    jsonSchema?: any,
    taskName: string = 'Text Generation',
    tracking?: TaskContext,
    subTask?: string
): Promise<string> {
    const config = getAIConfig('TEXT', subTask);

    return apiQueue.add(async () => {
        if (config.provider === 'gemini') {
            const ai = getGeminiClient(config);
            const res = await withRetry(() => ai.models.generateContent({
                model: config.model || 'gemini-3.1-flash-lite',
                contents: [
                    { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
                ],
                config: {
                    temperature: 0.0,
                    responseMimeType: jsonMode ? 'application/json' : 'text/plain',
                    ...(jsonSchema ? { responseSchema: jsonSchema } : {})
                }
            }), 3, 2000, taskName, { prompt: systemPrompt + '\n\n' + userPrompt, provider: 'gemini', ...tracking });
            
            return res.text || '';
        } 
        
        if (config.provider === 'groq') {
            const groq = getGroqClient(config);
            // Groq does not support json_schema yet, only json_object
            const res = await withRetry(() => groq.chat.completions.create({
                model: config.model || 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.0,
                response_format: jsonMode ? { type: 'json_object' } : undefined
            }), 3, 2000, taskName, { prompt: systemPrompt + '\n\n' + userPrompt, provider: 'groq', ...tracking });
            
            return res.choices[0]?.message?.content || '';
        }

        // Default: Universal OpenAI Format
        const openai = getOpenAIClient(config);
        const res = await withRetry(() => openai.chat.completions.create({
            model: config.model || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.0,
            response_format: jsonMode ? (jsonSchema ? { type: 'json_schema', json_schema: { name: 'response', schema: jsonSchema, strict: true } } : { type: 'json_object' }) : undefined
        }), 3, 2000, taskName, { prompt: systemPrompt + '\n\n' + userPrompt, provider: 'openai', ...tracking });

        return res.choices[0]?.message?.content || '';
    }, tracking ? { ...tracking, description: taskName } : undefined);
}

/**
 * Universal Vision Router (Queued, Retried, Logged)
 */
export async function analyzeImage(
    promptText: string,
    mimeType: string,
    base64Data: string,
    jsonMode: boolean = false,
    jsonSchema?: any,
    taskName: string = 'Vision Analysis',
    tracking?: TaskContext & { path?: string },
    subTask?: string
): Promise<string> {
    const config = getAIConfig('VISION', subTask);

    return apiQueue.add(async () => {
        if (config.provider === 'openai') {
            const openai = getOpenAIClient(config);
            const res = await withRetry(() => openai.chat.completions.create({
                model: config.model || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: promptText },
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                        ]
                    }
                ],
                temperature: 0.0,
                response_format: jsonMode ? (jsonSchema ? { type: 'json_schema', json_schema: { name: 'response', schema: jsonSchema, strict: true } } : { type: 'json_object' }) : undefined
            }), 3, 2000, taskName, { prompt: promptText, provider: 'openai', ...tracking });
            
            return res.choices[0]?.message?.content || '';
        }

        // Default to Gemini as it's the most reliable for structured vision currently
        const ai = getGeminiClient(config);
        let rawText = '';
        const res = await withRetry(() => ai.models.generateContent({
            model: config.model || 'gemini-3.1-flash-lite',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: promptText },
                        { inlineData: { mimeType, data: base64Data } }
                    ]
                }
            ],
            config: {
                temperature: 0.0,
                responseMimeType: jsonMode ? 'application/json' : 'text/plain',
                ...(jsonSchema ? { responseSchema: jsonSchema } : {})
            }
        }), 3, 2000, taskName, { prompt: promptText, provider: 'gemini', ...tracking });

        rawText = res.text || '';
        if (rawText.length > 10000) {
            rawText = rawText.replace(/\s{10,}/g, ' ');
        }
        return rawText;
    }, tracking ? { ...tracking, description: taskName } : undefined);
}

/**
 * Universal Audio Transcription Router
 */
export async function transcribeAudio(
    audioFile: File,
    contextPrompt: string,
    subTask?: string
): Promise<{ text: string, usage: any, provider: string }> {
    const config = getAIConfig('AUDIO', subTask);

    if (config.provider === 'groq') {
        const groq = getGroqClient(config);
        const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: config.model || 'whisper-large-v3-turbo',
            prompt: contextPrompt,
            response_format: 'verbose_json'
        });
        return {
            text: transcription.text,
            usage: (transcription as any).x_groq?.usage || {},
            provider: 'groq'
        };
    }

    const openai = getOpenAIClient(config);
    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: config.model || 'whisper-1',
        prompt: contextPrompt,
        response_format: 'verbose_json'
    });
    
    return {
        text: transcription.text,
        usage: {}, 
        provider: 'openai'
    };
}