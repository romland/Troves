<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    export let value: string = 'EMPTY';
    export let showHeader: boolean = true;

    const fillStatusMap = ['EMPTY', 'SPARSE', 'HALF_FULL', 'FULL', 'OVERFLOWING'];
    
    let currentIndex = 0;
    
    // Reactively snap the slider to the correct position when the value changes externally
    $: {
        const idx = fillStatusMap.indexOf(value || 'EMPTY');
        currentIndex = idx !== -1 ? idx : 0;
    }

    function handleInput(e: Event) {
        currentIndex = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        value = fillStatusMap[currentIndex];
    }

    function handleChange() {
        // Broadcast the change so parent forms can automatically submit
        dispatch('change', value);
    }
</script>

<div class="form-control w-full">
    {#if showHeader}
        <div class="flex justify-between items-center mb-3">
            <span class="font-bold text-xs text-gray-500 uppercase tracking-wider">Fill Status</span>
            <span class="text-xs font-bold text-primary">{fillStatusMap[currentIndex].replace('_', ' ')}</span>
        </div>
    {:else}
        <label class="label px-0"><span class="label-text font-bold text-xs text-gray-500 uppercase tracking-wider">Fill Status</span></label>
    {/if}
    <input type="range" min="0" max="4" value={currentIndex} on:input={handleInput} on:change={handleChange} class="range range-primary range-sm" />
    <div class="w-full flex justify-between text-[9px] px-1 mt-2 text-gray-400 font-bold uppercase">
        <span>Empty</span><span>Sparse</span><span>Half</span><span>Full</span><span>Over</span>
    </div>
</div>