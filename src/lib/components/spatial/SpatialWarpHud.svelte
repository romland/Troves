<script lang="ts">
    export let warpCols: number;
    export let warpRows: number;
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
</script>

<div class="absolute top-4 sm:top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col sm:flex-row gap-3 bg-base-100/95 backdrop-blur-2xl p-2 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.3)] border border-base-200/50 items-center animate-fade-in w-[95%] max-w-[350px] sm:w-auto pointer-events-auto">
    <div class="flex items-center justify-center gap-4 px-2 w-full sm:w-auto">
        <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/60">Cols</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" aria-label="Decrease Columns" on:click={() => warpCols = Math.max(1, warpCols - 1)}><i class="bi bi-dash"></i></button>
            <span class="font-mono w-4 text-center font-bold text-base-content">{warpCols}</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" aria-label="Increase Columns" on:click={() => warpCols++}><i class="bi bi-plus"></i></button>
        </div>
        <div class="w-px h-6 bg-base-300 hidden sm:block"></div>
        <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/60">Rows</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" aria-label="Decrease Rows" on:click={() => warpRows = Math.max(1, warpRows - 1)}><i class="bi bi-dash"></i></button>
            <span class="font-mono w-4 text-center font-bold text-base-content">{warpRows}</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" aria-label="Increase Rows" on:click={() => warpRows++}><i class="bi bi-plus"></i></button>
        </div>
    </div>
    <div class="flex gap-2 w-full sm:w-auto px-1">
        <button class="btn btn-ghost btn-sm rounded-xl flex-1 hover:bg-base-200" on:click={() => dispatch('cancel')}>Cancel</button>
        <button class="btn btn-primary btn-sm rounded-xl shadow-sm flex-1" on:click={() => dispatch('apply')}>Apply</button>
    </div>
</div>