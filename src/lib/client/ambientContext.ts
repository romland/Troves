import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const CACHE_KEY = 'troves_ambient_location_map';
const TTL_MS = 60 * 60 * 1000; // 1 hour

function createAmbientLocationStore() {
    const { subscribe, set } = writable<string[]>([]);
    let currentInvId: number | null = null;
    let memory: Record<number, { containers: string[], timestamp: number }> = {};

    if (browser) {
        const stored = sessionStorage.getItem(CACHE_KEY);
        if (stored) {
            try {
                memory = JSON.parse(stored);
            } catch (e) {
                sessionStorage.removeItem(CACHE_KEY);
            }
        }
    }
    
    const flush = () => {
        if (browser) sessionStorage.setItem(CACHE_KEY, JSON.stringify(memory));
    };

    return {
        subscribe,
        switchTrove: (invId: number) => {
            currentInvId = invId;
            const data = memory[invId];
            if (data && Date.now() - data.timestamp < TTL_MS) {
                set(data.containers);
                console.log(`🛠️ [DEBUG AMBIENT] Switched context to trove ${invId}:`, data.containers);
            } else {
                set([]);
            }
        },
        setContext: (containers: string[], invId?: number) => {
            const targetInvId = invId || currentInvId;
            if (!targetInvId) {
                set(containers || []); // Fallback
                return;
            }
            if (containers && containers.length > 0) {
                memory[targetInvId] = { containers, timestamp: Date.now() };
                flush();
            } else {
                delete memory[targetInvId];
                flush();
            }
            if (targetInvId === currentInvId) {
                set(containers || []);
            }
        },
        clear: (invId?: number) => {
            const targetInvId = invId || currentInvId;
            if (targetInvId) delete memory[targetInvId];
            flush();
            if (targetInvId === currentInvId) set([]);
        }
    };
}

export const ambientLocation = createAmbientLocationStore();