<script lang="ts">
    export let src: string;
    export let boxes: { box: number[], colorClass: string, id: string }[] = [];
    
    import { createEventDispatcher } from 'svelte';
    import { getHighlightStyle } from '$lib/shared/boundingBox';
    const dispatch = createEventDispatcher();
</script>

<div class="relative w-full rounded-3xl overflow-hidden shadow-lg border border-base-200 bg-base-300">
    <img {src} alt="Scan preview" class="w-full h-auto block object-contain max-h-[40vh]" />
    
    {#each boxes as b}
        {@const hlStyle = getHighlightStyle(b.box)}
        {#if hlStyle}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="absolute border-[3px] {b.colorClass} bg-transparent cursor-pointer transition-transform hover:scale-105 hover:bg-white/30 backdrop-contrast-125"
                 style={hlStyle}
                 on:click={() => dispatch('clickBox', b.id)}>
            </div>
        {/if}
    {/each}
</div>
