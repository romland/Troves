<script lang="ts">
    export let zoomLevel: number;
    export let hasHistory: boolean;
    export let readonly: boolean;
    export let isWarpMode: boolean;
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
</script>

<div class="absolute top-1/2 -translate-y-1/2 right-4 z-40 flex flex-col gap-1 bg-base-100/80 backdrop-blur-xl p-1.5 rounded-[1.25rem] shadow-lg border border-base-200/50 items-center transition-all pointer-events-auto">
    <button class="btn btn-circle btn-sm btn-ghost text-base-content/70" aria-label="Zoom In" on:click|stopPropagation={() => zoomLevel = Math.min(500, zoomLevel + 25)}><i class="bi bi-plus text-lg"></i></button>
    <div class="text-[10px] font-bold w-full text-center select-none text-base-content/80 py-0.5">{zoomLevel}%</div>
    <button class="btn btn-circle btn-sm btn-ghost text-base-content/70" aria-label="Zoom Out" on:click|stopPropagation={() => zoomLevel = Math.max(25, zoomLevel - 25)}><i class="bi bi-dash text-lg"></i></button>
    <div class="w-6 h-px bg-base-300 my-0.5"></div>
    <button class="btn btn-circle btn-sm btn-ghost text-base-content/70" on:click|stopPropagation={() => dispatch('recenter')} title="Recenter View"><i class="bi bi-arrows-collapse text-lg"></i></button>
</div>

{#if hasHistory && !isWarpMode && !readonly}
    <div class="absolute top-6 left-6 z-40 flex gap-2 animate-fade-in pointer-events-auto">
        <button class="btn btn-circle btn-sm btn-ghost bg-base-100/80 backdrop-blur-xl shadow-md border border-base-200" on:click|stopPropagation={() => dispatch('undo')} title="Undo (Ctrl+Z)"><i class="bi bi-arrow-counterclockwise text-base-content/70"></i></button>
        <button class="btn btn-circle btn-sm btn-ghost bg-base-100/80 backdrop-blur-xl shadow-md border border-base-200" on:click|stopPropagation={() => dispatch('reset')} title="Reset to last save"><i class="bi bi-trash text-error/70"></i></button>
    </div>
{/if}