<script lang="ts">
    export let src: string;
    export let boxes: { box: number[], colorClass: string, id: string, status: string }[] = [];
    export let activeBoxId: string | null = null;
    
    import { createEventDispatcher } from 'svelte';
    import { getHighlightStyle } from '$lib/shared/boundingBox';
    const dispatch = createEventDispatcher();
</script>

<div class="relative w-full rounded-3xl overflow-hidden shadow-lg border border-base-200 bg-base-300">
    <img {src} alt="Scan preview" class="w-full h-auto block object-contain max-h-[40vh]" />
    
    {#if activeBoxId}
        <div class="absolute inset-0 bg-black/50 backdrop-contrast-75 transition-opacity duration-300 pointer-events-none z-10"></div>
    {/if}

    {#each boxes as b}
        {@const hlStyle = getHighlightStyle(b.box)}
        {@const isActive = activeBoxId === b.id}
        {@const isDimmed = activeBoxId !== null && !isActive}
        {#if hlStyle}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="absolute border-[3px] {b.colorClass} cursor-pointer transition-all duration-300 hover:scale-105 {isActive ? 'z-20 scale-[1.03] shadow-[0_0_30px_rgba(255,255,255,0.4)] bg-white/20' : 'z-0'} {isDimmed ? 'opacity-30 grayscale' : 'opacity-100 hover:bg-white/30 backdrop-contrast-125'}"
                 style="{hlStyle}"
                 on:click={() => dispatch('clickBox', b.id)}>
                <!-- Colorblind accessible iconography inside the box -->
                <div class="absolute -top-3 -left-3 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold drop-shadow-md {b.status === 'new' ? 'bg-primary' : b.status === 'missing' ? 'bg-error' : b.status === 'elsewhere' ? 'bg-warning' : 'bg-success'}">
                    {#if b.status === 'new'}<i class="bi bi-stars"></i>
                    {:else if b.status === 'missing'}<i class="bi bi-x-lg text-[10px]"></i>
                    {:else if b.status === 'elsewhere'}<i class="bi bi-exclamation-lg"></i>
                    {:else}<i class="bi bi-check-lg"></i>{/if}
                </div>
            </div>
        {/if}
    {/each}
</div>
