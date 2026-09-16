<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { slide } from 'svelte/transition';
    
    export let value: 'auto' | 'ignore' | 'inside' | 'top' | 'bottom' | 'left' | 'right' = 'auto';
    
    const dispatch = createEventDispatcher();
    
    // Derive the macro mode from the specific value
    $: mode = ['top', 'bottom', 'left', 'right', 'inside'].includes(value) ? 'target' : value;

    function setMode(newMode: 'auto' | 'ignore' | 'target') {
        if (newMode === 'target') setValue('bottom'); // Default target when opening pad
        else setValue(newMode);
    }
    
    function setValue(val: string) {
        value = val as any;
        dispatch('change', value);
    }
</script>

<div class="flex flex-col w-full sm:w-64">
    <!-- iOS Style Segmented Control -->
    <div class="bg-base-200/60 p-1 rounded-xl flex w-full relative border border-base-300 shadow-inner">
        <button class="flex-1 btn btn-sm border-none transition-all {mode === 'auto' ? 'bg-base-100 shadow-sm text-base-content font-bold' : 'btn-ghost text-gray-500 hover:text-base-content font-medium'}" on:click={() => setMode('auto')}>Auto</button>
        <button class="flex-1 btn btn-sm border-none transition-all {mode === 'target' ? 'bg-base-100 shadow-sm text-primary font-bold' : 'btn-ghost text-gray-500 hover:text-base-content font-medium'}" on:click={() => setMode('target')}>Target</button>
        <button class="flex-1 btn btn-sm border-none transition-all {mode === 'ignore' ? 'bg-base-100 shadow-sm text-error font-bold' : 'btn-ghost text-gray-500 hover:text-base-content font-medium'}" on:click={() => setMode('ignore')}>Ignore</button>
    </div>

    <!-- The Spatial Focus Pad -->
    {#if mode === 'target'}
        <div transition:slide|local={{duration: 250, easing: (t) => 1 - Math.pow(1 - t, 3)}} class="pt-4 flex justify-center overflow-hidden">
            <div class="relative w-32 h-32 bg-base-200/40 rounded-[1.25rem] border-[1.5px] border-base-300 p-2 grid grid-cols-3 grid-rows-3 gap-1.5 shadow-inner">
                <!-- Edge Targets -->
                <button class="col-start-2 row-start-1 rounded-lg transition-all {value === 'top' ? 'bg-primary shadow-[0_0_12px_rgba(var(--p),0.4)] scale-105' : 'bg-base-300 hover:bg-base-content/20'}" on:click={() => setValue('top')} title="Top Edge"></button>
                <button class="col-start-1 row-start-2 rounded-lg transition-all {value === 'left' ? 'bg-primary shadow-[0_0_12px_rgba(var(--p),0.4)] scale-105' : 'bg-base-300 hover:bg-base-content/20'}" on:click={() => setValue('left')} title="Left Edge"></button>
                <button class="col-start-3 row-start-2 rounded-lg transition-all {value === 'right' ? 'bg-primary shadow-[0_0_12px_rgba(var(--p),0.4)] scale-105' : 'bg-base-300 hover:bg-base-content/20'}" on:click={() => setValue('right')} title="Right Edge"></button>
                <button class="col-start-2 row-start-3 rounded-lg transition-all {value === 'bottom' ? 'bg-primary shadow-[0_0_12px_rgba(var(--p),0.4)] scale-105' : 'bg-base-300 hover:bg-base-content/20'}" on:click={() => setValue('bottom')} title="Bottom Edge"></button>
                
                <!-- Center Target -->
                <button class="col-start-2 row-start-2 rounded-xl transition-all border-[1.5px] border-dashed flex items-center justify-center {value === 'inside' ? 'bg-primary/10 border-primary text-primary shadow-inner scale-105' : 'bg-base-100 border-base-300 hover:border-primary/50 text-gray-400'}" on:click={() => setValue('inside')} title="Inside Cavity">
                    <i class="bi bi-box text-[10px] font-black"></i>
                </button>
            </div>
        </div>
    {/if}
</div>