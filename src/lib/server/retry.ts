import { logActivity } from './logger';
import { taskManager } from './taskManager';
import { recordLLMLog } from './llmLogger';
import { dev } from '$app/environment';
import { systemHealth } from './systemHealth';

// Define limits per service
const serviceQuotas: Record<string, { maxRPM: number, requests: number, minuteResetTime: number }> = {
    gemini: { maxRPM: 14, requests: 0, minuteResetTime: Date.now() + 60000 }, // Google Free Tier is 15 RPM, we cap at 14
    groq: { maxRPM: 29, requests: 0, minuteResetTime: Date.now() + 60000 },   // Typical free limit
    openai: { maxRPM: 499, requests: 0, minuteResetTime: Date.now() + 60000 }, 
    replicate: { maxRPM: 59, requests: 0, minuteResetTime: Date.now() + 60000 }
};

export async function withRetry<T>(
    fn: () => Promise<T>, 
    maxRetries = 3, 
    delayMs = 1500, 
    taskName = 'LLM Operation',
    context?: { itemId?: number, taskId?: string | number, prompt?: any, path?: string, provider?: string }
): Promise<T> {
    let attempt = 0;

    // Auto-infer service from taskName
    const nameLower = taskName.toLowerCase();
    let service = context?.provider || (nameLower.includes('groq') ? 'groq' : nameLower.includes('openai') ? 'openai' : nameLower.includes('replicate') ? 'replicate' : 'gemini');
    if (!serviceQuotas[service]) service = 'openai';
    const quota = serviceQuotas[service];

    while (true) {
        try {
            attempt++;
            
            // Pre-emptive quota protection (Google Gemini Free Tier = 15 RPM)
            if (quota.requests >= quota.maxRPM) {
                const waitTime = Math.max(1000, quota.minuteResetTime - Date.now());
                console.log(`[Quota] Holding back ${taskName} (${service}) for ${Math.ceil(waitTime/1000)}s to respect limits.`);
                if (context?.itemId) await logActivity(context.itemId, 'Quota Wait', `Holding back ${taskName} for ${Math.ceil(waitTime/1000)}s to respect ${service} limits.`, 'warning');
                if (context?.taskId) taskManager.update(String(context.taskId), `Waiting ${Math.ceil(waitTime/1000)}s for API quota...`);
                systemHealth.setDegraded(`AI quota limits reached. Pausing queue for ${Math.ceil(waitTime/1000)}s...`, waitTime);
                await new Promise(r => setTimeout(r, waitTime));
                systemHealth.clearDegraded();
            }

            if (Date.now() > quota.minuteResetTime) {
                quota.requests = 0;
                quota.minuteResetTime = Date.now() + 60000;
            }

            quota.requests++;
            // Execute and time the LLM call

            // // TEST: Force a fake 429 Quota rejection on the first attempt
            // if (attempt === 1) throw { status: 429, message: "Fake 429 Quota Exceeded (retry in 12s)" };

            const startTime = Date.now();
            const result = await fn();
            const durationMs = Date.now() - startTime;
            
            // Log it cleanly if a prompt was provided
            if (context?.prompt) {
                // Dynamically extract tokens based on SDK response structures
                const tokensIn = (result as any)?.usageMetadata?.promptTokenCount || (result as any)?.usage?.prompt_tokens || 0;
                const tokensOut = (result as any)?.usageMetadata?.candidatesTokenCount || (result as any)?.usage?.completion_tokens || 0;
                recordLLMLog(taskName, service, context.prompt, (result as any)?.text || (result as any)?.choices || result, durationMs, tokensIn, tokensOut, context.itemId, context.path);
                
                if (context.itemId && dev) {
                    const payload = JSON.stringify({ prompt: context.prompt, response: (result as any)?.text || (result as any)?.choices || result }, null, 2);
                    await logActivity(context.itemId, 'LLM Debug', `Dev Mode: Prompt & Response for ${taskName}`, 'info', payload);
                }
            }
            
            return result;
        } catch (error: any) {
            const errMessage = error?.message || String(error);
            const status = error?.status || error?.response?.status;
            
            // Parse 429 Quota Exhausted & dynamic retry delays
            if (status === 429 || status === 503 || errMessage.includes('429') || errMessage.includes('503') || errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('Quota exceeded') || errMessage.includes('overloaded')) {
                let waitTime = 60000;
                const match = errMessage.match(/retry in ([\d\.]+)s/);
                if (match && match[1]) {
                    waitTime = (parseFloat(match[1]) + 2) * 1000; // Add 2s safety buffer
                }
                
                console.warn(`[Quota Exceeded] ${taskName} (${service}) failed. Waiting ${Math.ceil(waitTime/1000)}s...`);
                quota.requests = 0;
                quota.minuteResetTime = Date.now() + waitTime;

                if (context?.itemId) await logActivity(context.itemId, 'LLM Retry', `${service} quota exceeded. Retrying ${taskName} in ${Math.ceil(waitTime/1000)}s.`, 'warning');
                if (context?.taskId) taskManager.update(String(context.taskId), `API Busy. Waiting ${Math.ceil(waitTime/1000)}s...`);
                systemHealth.setDegraded(`${service} API is rate-limited. Pausing queue for ${Math.ceil(waitTime/1000)}s...`, waitTime);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
                systemHealth.clearDegraded();
                continue; // Do not increment the failure attempt counter on pure quota pauses
            }

            if (attempt >= maxRetries) {
                console.error(`[Task Failure] ${taskName} failed after ${maxRetries} attempts:`, error);
                if (context?.itemId) await logActivity(context.itemId, 'LLM Error', `${taskName} failed after ${maxRetries} attempts.`, 'error');
                throw error;
            }

            console.warn(`[Task Retry] ${taskName} failed (Attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`, error.message);
            if (context?.taskId) taskManager.update(String(context.taskId), `Attempt ${attempt}/${maxRetries} failed. Retrying...`);
            
            await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
    }
}