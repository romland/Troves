import { TaskQueue } from './TaskQueue';

// ============================================================================
// VITE HMR WORKAROUND: QUEUE CONCURRENCY PERSISTENCE
// ============================================================================
// Vite's dev server reloads this file on every save, which would normally reset
// these queues. If a queue resets, it loses its concurrency locks and allows
// unbound parallel execution (e.g., 5 heavy ML tasks running at once, crashing the PC).
// Storing them in `globalThis` ensures the concurrency limits and queued tasks
// survive hot-reloads during development.
// ============================================================================
const g = globalThis as any;

/** Rembg (Background removal) is extremely memory/CPU intensive. Strictly 1 at a time. */
export const heavyMlQueue: TaskQueue = g.__heavyMlQueue || new TaskQueue('HeavyML', 1);

/** OCR (PaddleOCR) runs locally. Strictly 1 at a time to prevent pegging all cores via OpenMP. */
export const lightMlQueue: TaskQueue = g.__lightMlQueue || new TaskQueue('LightML (OCR)', 1);

/** External APIs (Gemini, Groq) handle scale well, but limited to prevent rate limits. */
export const apiQueue: TaskQueue = g.__apiQueue || new TaskQueue('External API', 5);

/** Network I/O (Downloading PDFs, scraping URLs) is mostly waiting. */
export const ioQueue: TaskQueue = g.__ioQueue || new TaskQueue('Disk/DB I/O', 10);

if (!g.__heavyMlQueue) {
    g.__heavyMlQueue = heavyMlQueue;
    g.__lightMlQueue = lightMlQueue;
    g.__apiQueue = apiQueue;
    g.__ioQueue = ioQueue;
}
