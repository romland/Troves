<script lang="ts">
    export let item: any;
    import { createEventDispatcher } from 'svelte';
    import { isSlowConnection } from '$lib/client/utils';
    const dispatch = createEventDispatcher();

    $: mainPhoto = item?.photos?.find(p => p.type === 'product' && p.isPrimary) || item?.photos?.find(p => p.type === 'product') || item?.photos?.[0] || {};
    $: colorSource = item?.colors || mainPhoto?.colors;
    $: cols = colorSource && colorSource.length > 2 ? Object.keys(JSON.parse(colorSource)) : [];
    $: cb = mainPhoto?.updatedAt ? '?v=' + new Date(mainPhoto.updatedAt).getTime() : (item?.updatedAt ? '?v=' + new Date(item.updatedAt).getTime() : '');
    $: srcUrl = item.thumbPath || mainPhoto.thumbPath || mainPhoto.orgPath;
    
    let polyMap: number[][] | null = null;
    $: {
        try {
            polyMap = item.spatialMap ? JSON.parse(item.spatialMap) : (item.locations?.[0]?.spatialMap ? JSON.parse(item.locations[0].spatialMap) : null);
        } catch (e) { polyMap = null; }
    }

    const imgLoadStrategy = isSlowConnection() ? 'lazy' : 'eager';
</script>

<div class="flex items-center gap-3 bg-base-100 border border-base-200 p-2 rounded-xl shadow-sm w-full text-left group">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-base-200 flex items-center justify-center border border-base-300 cursor-zoom-in hover:opacity-80 transition-opacity relative" on:click={() => dispatch('zoom', item)}>
            {#if cols.length > 0}
                <div class="absolute inset-0 opacity-30 pointer-events-none" style="background: linear-gradient(135deg, {cols[0]}, {cols[1] || cols[0]});"></div>
            {/if}
        {#if polyMap && srcUrl}
            {@const clipPathStr = `polygon(${polyMap.map(p => `${(p[0]/10).toFixed(2)}% ${(p[1]/10).toFixed(2)}%`).join(', ')})`}
            <div class="relative w-full h-full flex items-center justify-center bg-base-300">
                <!-- Background: Dimmed & Blurred -->
                <img class="absolute inset-0 w-full h-full object-cover blur-[1px] brightness-[0.75] saturate-[0.8]" src="{srcUrl}{cb}" alt="Background" />
                
                <!-- Foreground: Spotlight Clipped -->
                <img src="{srcUrl}{cb}" alt={item.title} loading={imgLoadStrategy} class="absolute inset-0 w-full h-full object-cover drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)] z-10 scale-[1.02]" style="clip-path: {clipPathStr};" />
                
                <!-- Subtle Outer Glow Rim -->
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full pointer-events-none z-20 scale-[1.02]">
                    <polygon points={polyMap.map(p => p.join(',')).join(' ')} class="fill-transparent stroke-white/80 drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]" stroke-width="3" vector-effect="non-scaling-stroke" />
                </svg>
            </div>
        {:else if srcUrl}
            <img src="{srcUrl}{cb}" alt={item.title} loading={imgLoadStrategy} class="w-full h-full object-cover mix-blend-multiply dark:mix-blend-normal relative z-10" />
        {:else}
            <i class="bi bi-box text-xl text-gray-400 relative z-10"></i>
        {/if}
    </div>
    <a href="/{item.id}/{item.slug || 'view'}" class="flex-1 min-w-0 block">
        <div class="font-bold text-base-content text-sm truncate group-hover:text-primary transition-colors">{item.title}</div>
        <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold truncate mt-0.5">
            <i class="bi bi-box-seam mr-0.5"></i> {item.locationName || 'Unassigned'} <span class="mx-0.5 opacity-50">•</span> {item.categoryName || 'No Category'}
        </div>
    </a>
    <div class="shrink-0 pr-2 opacity-50 group-hover:opacity-100 group-hover:text-primary transition-opacity">
        <i class="bi bi-arrow-right-short text-2xl"></i>
    </div>
</div>
