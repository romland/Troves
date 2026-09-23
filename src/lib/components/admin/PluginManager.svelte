<script lang="ts">
    import { enhance } from "$app/forms";
    import { notify } from "$lib/client/notifications";
    import type ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import PromptBuilderModal from "$lib/components/admin/PromptBuilderModal.svelte";
    import PluginListItem from "./PluginListItem.svelte";
    import PluginEditForm from "./PluginEditForm.svelte";

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

    function createEditEnhancer() {
        return async ({ result, update }: any) => {
            if (result.type === 'success' || result.type === 'redirect') {
                notify('success', result.data?.message || 'Saved successfully');
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
                <PluginEditForm plugin={p} {confirmModal} enhanceFn={createEditEnhancer} on:cancel={() => editPluginName = null} />
            {:else}
                <PluginListItem plugin={p} {confirmModal} enhanceFn={createEnhancer} on:edit={(e) => editPluginName = e.detail.name} on:askLlm={(e) => promptModal.show(e.detail.content, e.detail.name)} />
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
