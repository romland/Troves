<script lang="ts">
    export let polygons: number[][][] = [];
    export let activeIndex: number | null = null;
    export let mappedIndices: number[] = [];
    export let referenceImage: string | null = null;
</script>

<div class="relative w-full rounded-2xl overflow-hidden bg-base-100 border border-base-300 shadow-sm flex items-center justify-center">
    {#if referenceImage}
        <!-- Invisible scaffold to perfectly match the physical container's aspect ratio without DB schema changes -->
        <img src={referenceImage} class="w-full h-auto block opacity-0 pointer-events-none select-none" alt="" />
    {:else}
        <!-- Fallback square if no image exists -->
        <div class="w-full aspect-square"></div>
    {/if}
    
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full [transform:translateZ(0)]">
        {#each polygons as p, i}
            {@const isActive = activeIndex === i}
            {@const isMapped = mappedIndices.includes(i)}
            <polygon 
                points={p.map(pt => pt.join(',')).join(' ')} 
                class="transition-colors duration-300 {isActive ? 'fill-primary/30 stroke-primary' : (isMapped ? 'fill-base-content/20 stroke-base-content/80' : 'fill-transparent stroke-base-content/50')} hover:fill-base-content/10" 
                stroke-width={isActive ? "3" : "1.5"} 
                vector-effect="non-scaling-stroke" 
                stroke-linejoin="round"
            />
        {/each}
    </svg>
</div>
