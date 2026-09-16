<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import ItemMiniCard from '../ItemMiniCard.svelte';
    import ColorMixBar from '../ColorMixBar.svelte';
    import Badge from '../Badge.svelte';
    import { getCropStyles } from '$lib/shared/boundingBox';
    export let item: any;
    export let type: 'unregistered' | 'missing' | 'elsewhere' | 'correct';
    export let draftPath: string;
    
    import { spring } from 'svelte/motion';
    const dispatch = createEventDispatcher();

    // Swipe Physics State
    const swipePos = spring(0, { stiffness: 0.1, damping: 0.5 });
    let touchStartX = 0;
    let isSwiping = false;

    function handleTouchEnd() {
        isSwiping = false;
        if (type !== 'unregistered') { swipePos.set(0); return; }

        if ($swipePos < -80) {
            dispatch('discard', item);
            if (navigator.vibrate) navigator.vibrate(40);
        } else if ($swipePos > 80) {
            dispatch('link', item);
            if (navigator.vibrate) navigator.vibrate(40);
            swipePos.set(0); // Let the spring handle the bounce back
        } else {
            swipePos.set(0);
        }
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative w-full rounded-2xl overflow-hidden {$swipePos < -5 ? 'bg-error/90' : ($swipePos > 5 ? 'bg-info/90' : 'bg-transparent')}" 
     style="touch-action: pan-y;"
     on:touchstart={(e) => { if (type === 'unregistered') { touchStartX = e.touches[0].clientX; isSwiping = true; } }}
     on:touchmove={(e) => { if (isSwiping) swipePos.set(e.touches[0].clientX - touchStartX, { hard: true }); }}
     on:touchend={handleTouchEnd}
>
    <!-- Background Swipe Icons -->
    {#if type === 'unregistered'}
        <div class="absolute inset-y-0 right-0 flex items-center pr-6 text-white pointer-events-none">
            <i class="bi bi-trash3-fill text-xl"></i>
        </div>
        <div class="absolute inset-y-0 left-0 flex items-center pl-6 text-white pointer-events-none">
            <i class="bi bi-link-45deg text-xl"></i>
        </div>
    {/if}

    <div class="bg-base-100 border border-base-200 p-4 rounded-2xl shadow-sm flex items-center justify-between gap-3 hover:border-primary/40 relative z-10"
         style="transform: translate3d({$swipePos}px, 0, 0);"
    >
        {#if item.box}
            {@const styles = getCropStyles(item.box)}
            <button type="button" class="relative w-16 h-20 overflow-visible shrink-0 border-none p-0 cursor-zoom-in block" on:click|stopPropagation={() => dispatch('zoom', item)}>
                {#if item.count > 1}
                    <div class="absolute -top-2 -left-2 z-20 bg-neutral text-neutral-content text-[11px] font-black px-2 py-0.5 rounded-lg shadow-md border border-base-100">
                        {item.count}x
                    </div>
                {/if}
                <div class="w-full h-full overflow-hidden rounded-lg bg-base-300 relative flex items-center justify-center">
                    {#if styles}
                        <div style={styles.wrapper}>
                            <img src="{draftPath}" class="block" style={styles.image} alt="{item.title}" />
                        </div>
                    {:else}
                        <img src="{draftPath}" class="w-full h-full object-cover" alt="{item.title}" />
                    {/if}
                </div>
            </button>
        {:else if item.thumbPath}
            <button type="button" class="relative w-16 h-20 overflow-visible shrink-0 border-none p-0 cursor-zoom-in block" on:click|stopPropagation={() => dispatch('zoom', item)}>
                <div class="w-full h-full overflow-hidden rounded-lg bg-base-300 relative">
                    <img src="{item.thumbPath}" class="w-full h-full object-cover" alt="{item.title}" />
                </div>
            </button>
        {/if}
        <div class="flex flex-col min-w-0 flex-1">
            <span class="font-bold text-base-content text-sm leading-tight truncate">{item.title}</span>
            
            {#if type === 'missing'}
                <span class="text-xs text-gray-500 truncate mt-0.5">
                    {#if item.isShortfall}
                        Expected {item.expected}. Scanned {item.count || 0}.
                    {:else}
                        Expected {item.expected}. Scanned 0.
                    {/if}
                </span>
            {:else if type === 'correct' || type === 'elsewhere'}
                <span class="text-xs text-gray-500 truncate mt-0.5">
                    {#if item.matchedItem?.dbTotalAmount === item.count}
                        All accounted for.
                    {:else if item.matchedItem?.dbTotalAmount > item.count}
                        Trove expects {item.matchedItem.dbTotalAmount} total.
                    {:else if item.matchedItem?.dbTotalAmount < item.count}
                        Scanned extra (Trove expects {item.matchedItem.dbTotalAmount}).
                    {/if}
                </span>
            {:else if item.subtitle}
                <span class="text-xs text-gray-500 truncate mt-0.5">{item.subtitle}</span>
            {/if}

            <!-- EAV Semantic Badges -->
            {#if item.extractedAttributes}
                <div class="flex flex-wrap gap-1 mt-1.5">
                    {#each Object.entries(item.extractedAttributes).filter(([_, v]) => v !== null) as [key, val]}
                        {#if key === 'color_mix'}
                            <div class="w-full mb-1"><ColorMixBar colorMixStr={val as string} /></div>
                        {:else}
                            <Badge color="ghost" size="xs" class="uppercase tracking-wider font-mono opacity-80 border-base-300 text-[9px]">{val}</Badge>
                        {/if}
                    {/each}
                </div>
            {/if}
            
            {#if item.fill_status}
                <div class="mt-1.5 flex">
                    <Badge class="uppercase tracking-wider font-bold opacity-80 border-base-300 text-[9px]" color="ghost" size="xs"><i class="bi bi-pie-chart-fill mr-1 opacity-50"></i> {item.fill_status.replace('_', ' ')}</Badge>
                </div>
            {/if}

            <div class="flex items-center gap-2 mt-2">
                {#if type === 'unregistered'}
                    <Badge color="ghost" size="xs" class="text-[10px] uppercase font-bold w-max text-primary/80 bg-primary/10 border-none">Not in Trove</Badge>
                {:else if type === 'missing'}
                    <Badge color="error" variant="outline" size="sm" class="text-[10px] uppercase font-bold">Missing</Badge>
                    {#if item.locationName}
                        <span class="text-[10px] text-gray-400">Last in: {item.locationName}</span>
                    {/if}
                {:else if type === 'elsewhere'}
                    <Badge color="warning" variant="outline" size="sm" class="text-[10px] uppercase font-bold">Wrong Location</Badge>
                    <span class="text-[10px] text-gray-400">Belongs in: {item.matchedItem?.locationName}</span>
                {:else}
                    <Badge color="success" size="sm" class="text-[10px] uppercase font-bold text-white" icon="bi-check-lg">Match</Badge>
                    {#if item.matchedItem?.locationName}
                        <Badge color="ghost" size="sm" class="text-xs font-mono text-gray-500 border-none" icon="bi-box-seam text-gray-400">{item.matchedItem.locationName}</Badge>
                    {/if}
                {/if}
            </div>

            {#if item.matchedItem && (type === 'correct' || type === 'elsewhere')}
                <div class="mt-2 pt-2 border-t border-base-200/60">
                    <div class="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Matched Against:</div>
                    <div class="bg-base-200/50 rounded-lg">
                        <ItemMiniCard item={item.matchedItem} on:zoom={() => dispatch('zoomMatch', item.matchedItem)} />
                    </div>
                </div>
            {/if}
        </div>
        
        
        <div class="flex items-center gap-2 shrink-0">
            <slot name="actions"></slot>
        </div>
    </div>
</div>