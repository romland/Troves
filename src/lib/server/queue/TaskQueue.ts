import { taskManager, type TaskTrackingMeta } from '../taskManager';

/**
 * A generic, promise-based concurrency queue.
 * Prevents server overload by limiting simultaneous task execution.
 */
export class TaskQueue {
    private name: string;
    private concurrency: number;
    private running: number = 0;
    private queue: { task: () => Promise<any>, resolve: (val: any) => void, reject: (err: any) => void, taskId?: string, desc?: string }[] = [];

    constructor(name: string, concurrency: number) {
        this.name = name;
        this.concurrency = concurrency;
    }

    /**
     * Adds a task to the queue. Returns a Promise that resolves when the task naturally completes.
     */
      public add<T>(task: () => Promise<T>, tracking?: TaskTrackingMeta): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let taskId: string | undefined;
            if (tracking) {
                taskId = taskManager.queue(tracking.targetType, tracking.targetId, tracking.description);
            }
            this.queue.push({ task, resolve, reject, taskId, desc: tracking?.description });
            console.log(`[Queue: ${this.name}] Added task. (Running: ${this.running}/${this.concurrency}, Queued: ${this.queue.length})`);
            this.processNext();
        });
    }

    private async processNext() {
        // Stop if we hit our concurrency cap, or if there's nothing to do
        if (this.running >= this.concurrency || this.queue.length === 0) return;
        
        this.running++;
        const job = this.queue.shift();
        
        if (job) {
            if (job.taskId) taskManager.start(job.taskId);
            const startTime = performance.now();
            try {
                console.log(`[Queue: ${this.name}] ▶️ Started: ${job.desc || 'task'}. (Running: ${this.running}/${this.concurrency}, Queued: ${this.queue.length})`);
                const result = await job.task();
                job.resolve(result);
            } catch (error) {
                console.error(`[Queue: ${this.name}] ❌ Failed: ${job.desc || 'task'}`, error);
                job.reject(error);
            } finally {
                const durationMs = performance.now() - startTime;
                const timeStr = durationMs > 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs.toFixed(0)}ms`;
                if (job.taskId) taskManager.end(job.taskId);
                this.running--;
                console.log(`[Queue: ${this.name}] ⏹️ Finished in ${timeStr}. (Running: ${this.running}/${this.concurrency}, Queued: ${this.queue.length})`);
                this.processNext();
            }
        }
    }
}