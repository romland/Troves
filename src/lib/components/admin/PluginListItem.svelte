<script lang="ts">
    import { enhance } from "$app/forms";
    import { createEventDispatcher } from "svelte";
    import PluginMetaDisplay from './PluginMetaDisplay.svelte';

    export let plugin: any;
    export let confirmModal: any;
    export let enhanceFn: any;

    const dispatch = createEventDispatcher();
    
    let showDetails = false;
    $: meta = plugin.meta || {};
    $: hasMeta = Object.keys(meta).length > 0;
    $: displayName = meta.name || plugin.name;
    
</script>

<div class="bg-base-100 rounded-xl border border-base-200 shadow-sm flex flex-col group overflow-hidden">
    <div class="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex flex-col gap-2 flex-1 min-w-0">
        <div class="flex items-center gap-3">
                <span class="font-bold text-sm truncate">{displayName}</span>
                {#if displayName !== plugin.name}
                <span class="font-mono text-[10px] text-base-content/50 truncate" title={plugin.name}>{plugin.name}</span>
                {/if}
            {#if plugin.isLoaded}
                <span class="badge badge-success badge-sm text-white">Active</span>
            {:else}
                <span class="badge badge-error badge-sm text-white">Error/Off</span>
            {/if}
        </div>
        <div class="flex flex-col gap-1 text-[10px]">
            {#if plugin.hooks?.length}<span class="text-gray-500 font-mono truncate"><b>Hooks:</b> {plugin.hooks.join(', ')}</span>{/if}
            {#if plugin.actions?.length}<span class="text-gray-500 font-mono truncate"><b>Actions:</b> {plugin.actions.join(', ')}</span>{/if}
            {#if plugin.modifiers?.length}<span class="text-gray-500 font-mono truncate"><b>Modifiers:</b> {plugin.modifiers.join(', ')}</span>{/if}
            {#if plugin.archetypes?.length}<span class="text-gray-500 font-mono truncate"><b>Archetypes:</b> {plugin.archetypes.join(', ')}</span>{/if}
            {#if !plugin.hooks?.length && !plugin.actions?.length && !plugin.modifiers?.length && !plugin.archetypes?.length}<span class="text-gray-400 italic">No registered events</span>{/if}
        </div>
    </div>
    
        <div class="flex items-center justify-between md:justify-end gap-2 w-full md:w-auto mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-0 border-base-200">
            {#if hasMeta}
                <button type="button" class="btn btn-xs btn-ghost flex-1 md:flex-none justify-center" on:click={() => showDetails = !showDetails}>
                    <i class="bi {showDetails ? 'bi-chevron-up' : 'bi-info-circle'}"></i> Details
                </button>
            {/if}
            <button type="button" class="btn btn-xs btn-ghost text-info hover:bg-info/10 flex-1 md:flex-none justify-center" on:click={() => dispatch('askLlm', plugin)}>
                <i class="bi bi-magic"></i> Ask LLM...
            </button>
            <button type="button" class="btn btn-ghost btn-xs flex-1 md:flex-none justify-center" on:click={() => dispatch('edit', plugin)}>
                <i class="bi bi-pencil"></i> Edit
            </button>
            <form method="POST" action="?/deletePlugin" use:enhance={async ({ cancel }) => { const res = await confirmModal.ask('Delete Plugin?', `Permanently delete ${plugin.name}?`, 'Delete', 'Cancel', true); if (!res) { cancel(); return; } return enhanceFn(); }} class="m-0 p-0 inline-block flex-none">
                <input type="hidden" name="name" value={plugin.name}>
                <button type="submit" class="btn btn-ghost btn-xs text-error hover:bg-error/10" title="Delete Plugin"><i class="bi bi-trash"></i></button>
            </form>
        </div>
    </div>
    {#if showDetails && hasMeta}
        <div class="bg-base-200/50 border-t border-base-200 p-4 animate-fade-in">
            <PluginMetaDisplay {plugin} showFilename={true} />
        </div>
    {/if}
</div>
