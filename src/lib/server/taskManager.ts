import { EventEmitter } from 'events';

/**
 * ============================================================================
 * CENTRALIZED TASK MANAGER (THE "WHAT IS THE SERVER DOING" TRACKER)
 * ============================================================================
 * 
 * PURPOSE:
 * This acts as the single source of truth for all background, long-running, 
 * or heavy processing tasks (LLM calls, OCR, background removal, scraping). 
 * It prevents the UI from relying on brittle heuristics (like "if thumbPath is null 
 * and created < 5 mins ago") to determine if something is still loading.
 * 
 * SCOPE & SSE INTEGRATION:
 * When tasks start or end here, `taskEvents` emits an 'update'. The SSE stream 
 * (`/api/events/+server.ts`) listens to this and instantly tells the frontend 
 * to refresh via `invalidateAll()`. Because it's an in-memory map, if the Node 
 * process restarts, both the tasks and the frontend loading spinners clear 
 * automatically—no ghost loading states left trapped in the database.
 * 
 * HOW IT STRETCHES ACROSS THE CODEBASE:
 * This manager is deeply wired into `TaskQueue.ts`. 
 * You rarely need to call `taskManager.start()` manually! Instead, whenever 
 * you dispatch a job to `apiQueue`, `heavyMlQueue`, `lightMlQueue`, or `ioQueue`, 
 * just pass the `tracking` metadata parameter:
 * 
 *   apiQueue.add(() => doHeavyStuff(), { 
 *       targetType: 'item', 
 *       targetId: 123, 
 *       description: 'Extracting data...' 
 *   });
 * 
 * RULE OF THUMB:
 * If you are adding a NEW long-running task (a new API call, heavy image processing, 
 * web scraping, or file I/O), make sure it is passed into a queue with tracking 
 * or wrapped in a `taskManager.start()` / `finally { taskManager.end() }` block.
 * Otherwise, the user will experience a "dead" or frozen UI while the server spins.
 * ============================================================================
 */

export const taskEvents = new EventEmitter();

export type TaskTargetType = 'item' | 'note' | 'global' | 'plugin';

export interface TaskContext {
    targetType: TaskTargetType;
    targetId: number;
}

export interface TaskTrackingMeta extends TaskContext {
    description: string;
}

export interface Task {
    id: string;
    targetId: number;
    targetType: TaskTargetType;
    description: string;
    startTime: number;
    endTime?: number;
    status: 'running' | 'completed';
}

class TaskManager {
    private tasks = new Map<string, Task>();
    private completedTasks: Task[] = [];
    private MAX_COMPLETED = 50;

    start(targetType: TaskTargetType, targetId: number, description: string): string {
        const id = Math.random().toString(36).substring(2, 15);
        this.tasks.set(id, { id, targetId, targetType, description, startTime: Date.now(), status: 'running' });
        taskEvents.emit('update');
        return id;
    }

    update(id: string, description: string) {
        const task = this.tasks.get(id);
        if (task) {
            task.description = description;
            taskEvents.emit('update');
        }
    }

    end(id: string) {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'completed';
            task.endTime = Date.now();
            this.completedTasks.unshift(task); // Add to front
            if (this.completedTasks.length > this.MAX_COMPLETED) {
                this.completedTasks.pop();
            }
            this.tasks.delete(id);
            taskEvents.emit('update');
        }
    }

    getTasks(targetType: 'item' | 'note' | 'global', targetId: number): Task[] {
        return Array.from(this.tasks.values()).filter(t => t.targetType === targetType && t.targetId === targetId);
    }
    
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    getCompletedTasks(): Task[] {
        return this.completedTasks;
    }    
}

export const taskManager = new TaskManager();