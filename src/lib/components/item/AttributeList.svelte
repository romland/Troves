<script lang="ts">
    import ColorMixBar from "$lib/components/ColorMixBar.svelte";
    import { createEventDispatcher } from 'svelte';
    export let attributes: any[] = [];
    export let photoAttributes: any[] = [];
    export let activeSchema: any[] = [];

    const dispatch = createEventDispatcher();

    const SHOWN_ATTRIBUTES = 10;

    let showAll = false;
    $: visibleAttributes = showAll ? attributes : attributes.slice(0, SHOWN_ATTRIBUTES);
</script>

<div class="bg-base-100 rounded-3xl border border-base-200 shadow-sm p-4 sm:p-6 mb-6">
	<div class="flex items-center justify-end mb-2 -mt-2">
        {#if activeSchema.length > 0}
            <button type="button" class="btn btn-xs btn-ghost text-primary gap-1" on:click={() => dispatch('edit')}>
                <i class="bi bi-pencil-square"></i> Quick Tweak
            </button>
        {/if}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="flex flex-col gap-2">
            {#each visibleAttributes as attrib}
                {@const schemaField = activeSchema.find(f => f.name === attrib.key)}
                {@const displayKey = attrib.key === 'color_mix' ? 'Colors' : (schemaField?.uiLabel || attrib.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))}
                {@const displayVal = (() => {
                    const normalizedAttr = attrib.value.replace(/_/g, ' ').toLowerCase();
                    if (schemaField?.options) {
                        const optMatch = schemaField.options.find(o => o.toLowerCase().replace(/_/g, ' ') === normalizedAttr);
                        if (optMatch) return optMatch;
                    }
                    if (attrib.value.includes('_')) {
                        return attrib.value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    }
                    return attrib.value;
                })()}
                
                <div class="flex flex-col sm:flex-row sm:justify-between py-2 border-b border-base-200/50 last:border-0">
                    <span class="text-sm text-gray-500 font-medium">{displayKey}</span>
                    {#if attrib.key === 'color_mix'}
                        <div class="sm:w-1/2 mt-1 sm:mt-0"><ColorMixBar colorMixStr={attrib.value} /></div>
                    {:else if attrib.value.startsWith('/images/')}
                        {@const ext = attrib.value.split('.').pop()?.toUpperCase()?.split('?')[0] || 'FILE'}
                        <button type="button" class="text-sm font-bold text-primary hover:underline break-all text-left sm:text-right line-clamp-1 flex items-center justify-start sm:justify-end gap-1.5" on:click={() => dispatch('zoom', attrib.value)}>
                            <i class="bi bi-image"></i> Original File ({ext})
                        </button>
                    {:else}
                        <span class="text-sm font-bold text-base-content break-words text-left sm:text-right">{displayVal}</span>
                    {/if}
                </div>
            {/each}
            {#if attributes.length > SHOWN_ATTRIBUTES}
                <button type="button" class="btn btn-ghost btn-xs text-primary mt-1 self-start" on:click={() => showAll = !showAll}>
                    {showAll ? 'Show Less' : `Show All (${attributes.length})`}
                </button>
            {/if}
        </div>

        {#if photoAttributes.length > 0}
            <div class="flex flex-col gap-2 bg-base-200/40 p-4 rounded-2xl border border-base-200">
                <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-2">
                    <i class="bi bi-upc-scan"></i> Detected Text (OCR)
                </div>
                <div class="flex flex-wrap gap-2">
                    {#each photoAttributes as attrib}
                        <span class="badge badge-ghost text-xs py-3 font-mono opacity-80 border-base-300 shadow-sm">{attrib.value}</span>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>