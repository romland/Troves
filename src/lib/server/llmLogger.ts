import { db } from './database';

export interface LLMLogEntry {
    timestamp: number;
    taskName: string;
    service: string;
    model: string;
    modelSettings: any;
    input: any;
    output: any;
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    itemId?: number;
    path?: string;
}

const llmLogs: LLMLogEntry[] = [];
const MAX_LLM_LOGS = 50;

export const llmUsageStats: Record<string, { requests: number, tokensIn: number, tokensOut: number }> = {};

export function recordLLMLog(taskName: string, service: string, model: string, modelSettings: any, input: any, output: any, durationMs: number, tokensIn: number = 0, tokensOut: number = 0, itemId?: number, path?: string) {
    // Keep the last 50 in memory (newest first)
    llmLogs.unshift({ timestamp: Date.now(), taskName, service, model, modelSettings, input, output, durationMs, tokensIn, tokensOut, itemId, path });

    if (llmLogs.length > MAX_LLM_LOGS) llmLogs.pop();
    
    // Maintain running totals for upgrade decisions
    if (!llmUsageStats[service]) {
        llmUsageStats[service] = { requests: 0, tokensIn: 0, tokensOut: 0 };
    }
    llmUsageStats[service].requests++;
    llmUsageStats[service].tokensIn += tokensIn;
    llmUsageStats[service].tokensOut += tokensOut;

    // 1. Write telemetry to our new metrics table (Fire and forget)
    db.systemMetric.create({
        data: {
            category: 'MODEL_USAGE',
            provider: service,
            model: model,
            operation: taskName,
            count1: tokensIn || 0,
            count2: tokensOut || 0,
            durationMs: durationMs || 0,
            modelSettings: JSON.stringify(modelSettings || {})
        }
    }).catch(e => console.error("[Telemetry] Failed to record metric:", e));

    // FUTURE EXTENSIBILITY: Write to disk or db or whatever
    // import fs from 'fs';
    // fs.appendFileSync('llm_audit_log.jsonl', JSON.stringify({ timestamp: Date.now(), taskName, service, input, output, durationMs, tokensIn, tokensOut, itemId, path }) + '\n');
}

export function getLLMLogs() {
    return llmLogs;
}