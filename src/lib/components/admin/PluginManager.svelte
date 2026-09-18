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
            <button type="submit" class="btn btn-sm btn-outline btn-primary shadow-sm"><i class="bi bi-arrow-clockwise"></i> Hot Reload Plugins</button>
        </form>
    </div>
    
    <div class="overflow-x-auto bg-base-200 rounded-lg mb-4 border border-base-300">
        <table class="table table-sm">
            <thead><tr><th>Plugin File</th><th>Status</th><th>Hooks/Actions</th><th></th></tr></thead>
            <tbody>
                {#each plugins || [] as p}
                    {#if editPluginName === p.name}
                        <tr>
                            <td colspan="4" class="p-4 bg-base-300">
                                <form method="POST" action="?/savePlugin" use:enhance={createEnhancer} class="flex flex-col gap-3">
                                    <div class="flex items-center justify-between">
                                        <span class="font-bold font-mono">{p.name}</span>
                                        <input type="hidden" name="name" value={p.name}>
                                    </div>
                                    <textarea name="content" class="textarea textarea-bordered font-mono text-xs w-full h-64 bg-base-100 leading-relaxed" spellcheck="false">{p.content}</textarea>
                                    <div class="flex gap-2 justify-end mt-2">
                                        <button type="button" class="btn btn-sm btn-ghost" on:click={() => editPluginName = null}>Cancel</button>
                                        <button type="submit" class="btn btn-sm btn-primary">Save & Reload</button>
                                    </div>
                                </form>
                            </td>
                        </tr>
                    {:else}
                        <tr>
                            <td class="font-mono font-bold">{p.name}</td>
                            <td>
                                {#if p.isLoaded}<span class="badge badge-success badge-sm text-white">Active</span>{:else}<span class="badge badge-error badge-sm text-white">Error/Off</span>{/if}
                            </td>
                            <td>
                                <div class="flex flex-col gap-1 text-[10px]">
                                    {#if p.hooks.length}<span class="text-gray-500 font-mono"><b>Hooks:</b> {p.hooks.join(', ')}</span>{/if}
                                    {#if p.actions.length}<span class="text-gray-500 font-mono"><b>Actions:</b> {p.actions.join(', ')}</span>{/if}
                                    {#if !p.hooks.length && !p.actions.length}<span class="text-gray-400 italic">No registered events</span>{/if}
                                </div>
                            </td>
                            <td class="text-right">
                                <div class="flex items-center justify-end gap-1">
                                    <button type="button" class="btn btn-ghost btn-xs" on:click={() => editPluginName = p.name}><i class="bi bi-pencil"></i> Edit</button>
                                    <form method="POST" action="?/deletePlugin" use:enhance={async ({ cancel }) => { const res = await confirmModal.ask('Delete Plugin?', `Permanently delete ${p.name}?`, 'Delete', 'Cancel', true); if (!res) { cancel(); return; } return createEnhancer(); }} class="m-0 p-0 inline-block">
                                        <input type="hidden" name="name" value={p.name}>
                                        <button type="submit" class="btn btn-ghost btn-xs text-error hover:bg-error/10" title="Delete Plugin"><i class="bi bi-trash"></i></button>
                                    </form>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="4" class="p-0 border-none">
                                <button type="button" class="btn btn-xs btn-ghost text-info w-full rounded-none hover:bg-info/10" on:click={() => promptModal.show(p.content, p.name)}><i class="bi bi-magic"></i> Ask an LLM to modify this plugin...</button>
                            </td>
                        </tr>
                    {/if}
                {/each}
                {#if plugins.length === 0}
                    <tr><td colspan="4" class="text-center p-4 text-gray-500 italic">No plugins found in data/plugins/</td></tr>
                {/if}
            </tbody>
        </table>
    </div>
    <div class="flex justify-start items-center">
        <form method="POST" action="?/savePlugin" use:enhance={createEnhancer} class="m-0 flex gap-2">
            <input type="hidden" name="content" value={defaultPluginTemplate}>
            <input type="text" name="name" placeholder="new-plugin.js" class="input input-sm input-bordered" required pattern="^[a-zA-Z0-9_-]+\.(js|mjs)$" title="Must end in .js or .mjs">
            <button type="submit" class="btn btn-sm btn-secondary shadow-sm"><i class="bi bi-plus-lg"></i> Create Plugin</button>
        </form>
        <button type="button" class="btn btn-sm btn-ghost text-info ml-4" on:click={() => promptModal.show()}><i class="bi bi-magic"></i> Generate Prompt</button>
    </div>
</div>

<PromptBuilderModal bind:this={promptModal} {extensionDocs} />