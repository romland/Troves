<script lang="ts">
    import { enhance } from "$app/forms";
    import { notify } from "$lib/client/notifications";
    import type ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import PromptBuilderModal from "$lib/components/admin/PromptBuilderModal.svelte";

    export let plugins: any[] = [];
    export let extensionDocs: string = '';
    export let confirmModal: ConfirmModal;

    let editPluginName: string | null = null;
    let promptModal: PromptBuilderModal;

    const defaultPluginTemplate = `export default function register({ on, sysLog, registerItemAction, fetch, env, db }) {
    // sysLog.info('Hello from new plugin!');
}`;

    function createEnhancer() {
        return async ({ result, update }: any) => {
            if (result.type === 'success' || result.type === 'redirect') {
                notify('success', result.data?.message || 'Saved successfully');
                editPluginName = null;
            } else if (result.type === 'failure' || result.type === 'error') {
                notify('error', result.data?.message || 'An error occurred');
            }
            await update({ reset: false });
        };
    }
</script>

<div class="bg-base-100 border border-error/20 shadow-sm rounded-xl p-6 relative overflow-hidden">
    <div class="absolute top-0 right-0 bg-error text-error-content text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">Admin Only</div>
    <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-bold">Extension Engine</h2>
        <form method="POST" action="?/reloadPlugins" use:enhance={createEnhancer} class="m-0">
            <button type="submit" class="btn btn-sm btn-outline btn-primary shadow-sm" title="Hot Reload Plugins"><i class="bi bi-arrow-clockwise"></i><span class="hidden md:inline ml-1">Hot Reload Plugins</span></button>
        </form>
    </div>
    
    <div class="flex flex-col gap-3 mb-4">
        {#each plugins || [] as p}
            {#if editPluginName === p.name}
                <div class="bg-base-200 rounded-xl border border-base-300 p-4 shadow-sm">
                    <form method="POST" action="?/savePlugin" use:enhance={createEnhancer} class="flex flex-col gap-3">
                        <div class="flex items-center justify-between">
                            <span class="font-bold font-mono text-sm">{p.name}</span>
                            <input type="hidden" name="name" value={p.name}>
                        </div>
                        <textarea name="content" class="textarea textarea-bordered font-mono text-xs w-full h-64 bg-base-100 leading-relaxed" spellcheck="false">{p.content}</textarea>
                        <div class="flex gap-2 justify-end mt-2">
                            <button type="button" class="btn btn-sm btn-ghost" on:click={() => editPluginName = null}>Cancel</button>
                            <button type="submit" class="btn btn-sm btn-primary">Save & Reload</button>
                        </div>
                    </form>
                </div>
            {:else}
                <div class="bg-base-100 rounded-xl border border-base-200 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 group">
                    <div class="flex flex-col gap-2 flex-1 min-w-0">
                        <div class="flex items-center gap-3">
                            <span class="font-mono font-bold text-sm truncate">{p.name}</span>
                            {#if p.isLoaded}
                                <span class="badge badge-success badge-sm text-white">Active</span>
                            {:else}
                                <span class="badge badge-error badge-sm text-white">Error/Off</span>
                            {/if}
                        </div>
                        <div class="flex flex-col gap-1 text-[10px]">
                            {#if p.hooks.length}<span class="text-gray-500 font-mono truncate"><b>Hooks:</b> {p.hooks.join(', ')}</span>{/if}
                            {#if p.actions.length}<span class="text-gray-500 font-mono truncate"><b>Actions:</b> {p.actions.join(', ')}</span>{/if}
                            {#if !p.hooks.length && !p.actions.length}<span class="text-gray-400 italic">No registered events</span>{/if}
                        </div>
                    </div>
                    
                    <div class="flex items-center justify-between md:justify-end gap-2 w-full md:w-auto mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-0 border-base-200">
                        <button type="button" class="btn btn-xs btn-ghost text-info hover:bg-info/10 md:w-auto flex-1 md:flex-none justify-center" on:click={() => promptModal.show(p.content, p.name)}>
                            <i class="bi bi-magic"></i> Ask an LLM...
                        </button>
                        <button type="button" class="btn btn-ghost btn-xs flex-1 md:flex-none justify-center" on:click={() => editPluginName = p.name}>
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <form method="POST" action="?/deletePlugin" use:enhance={async ({ cancel }) => { const res = await confirmModal.ask('Delete Plugin?', `Permanently delete ${p.name}?`, 'Delete', 'Cancel', true); if (!res) { cancel(); return; } return createEnhancer(); }} class="m-0 p-0 inline-block flex-none">
                            <input type="hidden" name="name" value={p.name}>
                            <button type="submit" class="btn btn-ghost btn-xs text-error hover:bg-error/10" title="Delete Plugin"><i class="bi bi-trash"></i></button>
                        </form>
                    </div>
                </div>
            {/if}
        {/each}
        {#if plugins.length === 0}
            <div class="text-center p-8 bg-base-200 rounded-xl border border-base-300 text-gray-500 italic">No plugins found in data/plugins/</div>
        {/if}
    </div>
    <div class="flex flex-col md:flex-row justify-between md:items-center gap-4 mt-2 bg-base-200/50 p-4 rounded-xl border border-base-300">
        <form method="POST" action="?/savePlugin" use:enhance={createEnhancer} class="m-0 flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <input type="hidden" name="content" value={defaultPluginTemplate}>
            <input type="text" name="name" placeholder="new-plugin.js" class="input input-sm input-bordered w-full sm:w-64" required pattern="^[a-zA-Z0-9_-]+\.(js|mjs)$" title="Must end in .js or .mjs">
            <button type="submit" class="btn btn-sm btn-secondary shadow-sm w-full sm:w-auto"><i class="bi bi-plus-lg"></i> Create Plugin</button>
        </form>
        <button type="button" class="btn btn-sm btn-ghost text-info w-full md:w-auto justify-center" on:click={() => promptModal.show()}>
            <i class="bi bi-magic"></i> Generate Prompt
        </button>
    </div>
</div>

<PromptBuilderModal bind:this={promptModal} {extensionDocs} />
