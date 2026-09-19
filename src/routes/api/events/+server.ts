import { dbEvents, db } from '$lib/server/database';
import { taskEvents } from '$lib/server/taskManager';
import { systemHealth } from '$lib/server/systemHealth';
import { taskManager } from '$lib/server/taskManager';

export function GET({ locals }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

    let listener: () => void;
    let healthListener: (data: any) => void;
    let taskListener: () => void;
    let debounceTimeout: NodeJS.Timeout;
    let lastFireTime = 0;

    const stream = new ReadableStream({
        async start(controller) {
            // Streams in SvelteKit must be byte arrays, not plain strings
            const encoder = new TextEncoder();
            
            // Send an immediate empty comment to establish the connection for Firefox
            controller.enqueue(encoder.encode(': connected\n\n'));

            // Dispatch immediate health state on connect
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'health', ...systemHealth.getStatus() })}\n\n`));

            const sendTasks = async () => {
                try {
                    const allTasks = taskManager.getAllTasks();
                    const allCompleted = taskManager.getCompletedTasks();

                    const itemIds = Array.from(new Set([...allTasks, ...allCompleted].filter(t => t.targetType === 'item').map(t => t.targetId)));

                    let allowedItemIds = new Set<number>();
                    if (itemIds.length > 0 && locals.activeInventoryId) {
                        const items = await db.item.findMany({
                            where: { id: { in: itemIds }, inventoryId: locals.activeInventoryId },
                            select: { id: true }
                        });
                        allowedItemIds = new Set(items.map(i => i.id));
                    }

                    const filterTasks = (tasks: any[]) => tasks.filter(t => t.targetType === 'item' ? allowedItemIds.has(t.targetId) : false);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tasks', tasks: filterTasks(allTasks), completedTasks: filterTasks(allCompleted) })}\n\n`));
                } catch (e) {}
            };

            await sendTasks();

            listener = () => {
                const now = Date.now();
                const fire = () => {
                    lastFireTime = Date.now();
                    try {
                        controller.enqueue(encoder.encode('data: update\n\n'));
                    } catch (e) {
                        // Client disconnected silently
                    }
                };

                clearTimeout(debounceTimeout);
                // Prevent starvation: If mutations are pouring in constantly, 
                // force an update at least every 1.5 seconds so the UI trickles in data.
                if (now - lastFireTime >= 1500) {
                    fire();
                } else {
                    // Otherwise, group rapid successive mutations after a 500ms quiet period
                    debounceTimeout = setTimeout(fire, 500);
                }
            };
            
            healthListener = (data: any) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'health', ...data })}\n\n`));
                } catch (e) {
                    // Client disconnected silently
                }
            };

            taskListener = () => {
                sendTasks();
            };

            // Listen for the Prisma extension triggers and active Task updates
            dbEvents.on('mutation', listener);
            taskEvents.on('update', taskListener);
            systemHealth.on('update', healthListener);
        },
        cancel() {
            clearTimeout(debounceTimeout);
            // Clean up memory the instant the client disconnects
            dbEvents.off('mutation', listener);
            taskEvents.off('update', taskListener);
            systemHealth.off('update', healthListener);
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            // 'Connection': 'keep-alive'
        }
    });
}