<script lang="ts">
    export let plugin: any;
    export let showFilename: boolean = false;
    
    $: meta = plugin?.meta || {};
    
    function linkify(text: string) {
        if (!text) return '';
        return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-info hover:underline font-medium inline-flex items-center gap-1">$1 <i class="bi bi-box-arrow-up-right text-[10px] opacity-70"></i></a>');
    }
</script>

<div class="flex flex-col gap-4 text-xs">
    {#if meta.description}
        <div class="text-base-content/90 leading-relaxed">{@html linkify(meta.description)}</div>
    {/if}
    
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
        {#if showFilename}
            <div class="flex flex-col min-w-0">
                <span class="font-bold uppercase tracking-wider text-[9px] text-gray-500">Filename</span>
                <span class="truncate font-mono text-base-content/90" title={plugin.name}>{plugin.name}</span>
            </div>
        {/if}
        {#each Object.entries(meta).filter(([k]) => !['name', 'description'].includes(k)) as [key, value]}
            <div class="flex flex-col min-w-0">
                <span class="font-bold uppercase tracking-wider text-[9px] text-gray-500">{key.replace(/-/g, ' ')}</span>
                <span class="truncate" title={value as string}>{@html linkify(value as string)}</span>
            </div>
        {/each}
        {#if plugin.activeIn?.length > 0}
            <div class="flex flex-col min-w-0">
                <span class="font-bold uppercase tracking-wider text-[9px] text-gray-500">Active In Troves</span>
                <span class="truncate text-base-content/90" title={plugin.activeIn.join(', ')}>{plugin.activeIn.join(', ')}</span>
            </div>
        {/if}
    </div>
</div>
