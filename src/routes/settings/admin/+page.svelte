<script lang="ts">
    import { enhance } from "$app/forms";
    import { page } from "$app/stores";
    import { notify } from "$lib/client/notifications";
    import ActionCard from "$lib/components/ActionCard.svelte";
    import SystemDiagnostics from "$lib/components/SystemDiagnostics.svelte";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import pageTitle from '$lib/stores';

    pageTitle.set("System Administration");

    let editUserId: number | null = null;
    let editPluginName: string | null = null;
    let storageMetrics: any = null;
    let loadingStorage = false;
    let confirmModal: ConfirmModal;

    const defaultPluginTemplate = `export default function register({ on, sysLog, registerItemAction, fetch, env, db }) {
    // sysLog.info('Hello from new plugin!');
}`;

    function createEnhancer() {
        return async ({ result, update }: any) => {
            if (result.type === 'success' || result.type === 'redirect') {
                notify('success', result.data?.message || 'Saved successfully');
                editUserId = null;
            } else if (result.type === 'failure' || result.type === 'error') {
                notify('error', result.data?.message || 'An error occurred');
            }
            await update({ reset: false });
        };
    }

    async function loadStorageMetrics() {
        if (storageMetrics || loadingStorage) return;
        loadingStorage = true;
        try {
            const res = await fetch('/api/storage-metrics');
            if (res.ok) storageMetrics = await res.json();
        } finally {
            loadingStorage = false;
        }
    }
</script>

<div class="max-w-4xl mx-auto flex flex-col gap-8">
    <div class="bg-base-100 border border-error/20 shadow-sm rounded-xl p-6 relative overflow-hidden">
        <div class="absolute top-0 right-0 bg-error text-error-content text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">Admin Only</div>
        <h2 class="text-2xl font-bold mb-6">User Management</h2>
        
        <h3 class="font-bold text-lg mb-4 text-error"><i class="bi bi-shield-lock"></i> Add User</h3>
        <form method="POST" action="?/createUser" use:enhance={createEnhancer} class="flex flex-col sm:flex-row gap-2 mb-6">
            <input type="text" name="username" placeholder="Username" class="input input-bordered w-full" required autocomplete="off">
            <input type="password" name="password" placeholder="Password" class="input input-bordered w-full" required autocomplete="new-password">
            <input type="password" name="passwordConfirm" placeholder="Repeat Password" class="input input-bordered w-full" required autocomplete="new-password">
            <button type="submit" class="btn btn-error text-white">Create User</button>
        </form>

        <div class="overflow-x-auto bg-base-200 rounded-lg mb-8 border border-base-300">
            <table class="table table-sm">
                <thead><tr><th>Username</th><th>Name</th><th>Role</th><th></th></tr></thead>
                <tbody>
                    {#each $page.data.allUsers || [] as u}
                        {#if editUserId === u.id}
                            <tr>
                                <td colspan="4" class="p-4 bg-base-300">
                                    <form method="POST" action="?/updateUser" use:enhance={createEnhancer} class="flex flex-col gap-3">
                                        <input type="hidden" name="id" value={u.id}>
                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div class="form-control">
                                                <div class="label"><span class="label-text">Name</span></div>
                                                <input type="text" name="name" value={u.name || ''} class="input input-sm input-bordered bg-base-100" />
                                            </div>
                                            <div class="form-control">
                                                <div class="label"><span class="label-text">Email</span></div>
                                                <input type="email" name="email" value={u.email || ''} class="input input-sm input-bordered bg-base-100" />
                                            </div>
                                            <div class="form-control">
                                                <div class="label"><span class="label-text">New Password</span></div>
                                                <input type="password" name="password" class="input input-sm input-bordered bg-base-100" placeholder="Leave blank to keep" />
                                            </div>
                                            <div class="form-control">
                                                <div class="label"><span class="label-text">Repeat Password</span></div>
                                                <input type="password" name="passwordConfirm" class="input input-sm input-bordered bg-base-100" placeholder="Leave blank to keep" />
                                            </div>
                                            <div class="form-control justify-end pb-1">
                                                <label class="label cursor-pointer justify-start gap-3 w-fit">
                                                    <input type="checkbox" name="isAdmin" value="true" checked={u.isAdmin} class="checkbox checkbox-sm checkbox-error" />
                                                    <span class="label-text font-bold text-error">System Admin</span>
                                                </label>
                                                <label class="label cursor-pointer justify-start gap-3 w-fit mt-[-10px]">
                                                    <input type="checkbox" name="canCreateInventories" value="true" checked={u.canCreateInventories} class="checkbox checkbox-sm checkbox-primary" />
                                                    <span class="label-text font-bold text-primary">Can Create Troves</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div class="flex gap-2 justify-end mt-2">
                                            <button type="button" class="btn btn-sm btn-ghost" on:click={() => editUserId = null}>Cancel</button>
                                            <button type="submit" class="btn btn-sm btn-primary">Save Changes</button>
                                        </div>
                                    </form>
                                </td>
                            </tr>
                        {:else}
                            <tr>
                                <td><span class="font-bold">{u.username}</span></td>
                                <td>{u.name || '-'}</td>
                                <td>
                                    {#if u.isAdmin}<span class="badge badge-error badge-sm text-white">Admin</span>{:else}<span class="badge badge-ghost badge-sm">User</span>{/if}
                                </td>
                                <td class="text-right">
                                    <div class="flex items-center justify-end gap-1">
                                        <button type="button" class="btn btn-ghost btn-xs" on:click={() => editUserId = u.id}><i class="bi bi-pencil"></i> Edit</button>
                                        {#if u.id !== $page.data.user?.id}
                                            <form method="POST" action="?/deleteUser" use:enhance={async ({ cancel }) => { const res = await confirmModal.ask('Delete User?', `Permanently delete user "${u.username}" and all their data?`, 'Delete', 'Cancel', true); if (!res) { cancel(); return; } return createEnhancer(); }} class="m-0 p-0 inline-block">
                                                <input type="hidden" name="id" value={u.id}>
                                                <button type="submit" class="btn btn-ghost btn-xs text-error hover:bg-error/10" title="Delete User"><i class="bi bi-trash"></i></button>
                                            </form>
                                        {/if}
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </div>
    </div>

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
                    {#each $page.data.plugins || [] as p}
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
                        {/if}
                    {/each}
                    {#if $page.data.plugins.length === 0}
                        <tr><td colspan="4" class="text-center p-4 text-gray-500 italic">No plugins found in data/plugins/</td></tr>
                    {/if}
                </tbody>
            </table>
        </div>
        <div class="flex justify-start">
            <form method="POST" action="?/savePlugin" use:enhance={createEnhancer} class="m-0 flex gap-2">
                <input type="hidden" name="content" value={defaultPluginTemplate}>
                <input type="text" name="name" placeholder="new-plugin.js" class="input input-sm input-bordered" required pattern="^[a-zA-Z0-9_-]+\.(js|mjs)$" title="Must end in .js or .mjs">
                <button type="submit" class="btn btn-sm btn-secondary shadow-sm"><i class="bi bi-plus-lg"></i> Create Plugin</button>
            </form>
        </div>
    </div>

    <div class="bg-base-100 border border-error/20 shadow-sm rounded-xl p-6 relative overflow-hidden">
        <h2 class="text-2xl font-bold mb-6">System Status</h2>
        
        <div class="bg-base-200/50 rounded-xl p-5 mb-6 border border-base-200">
            <div class="flex justify-between items-center mb-4">
                <h4 class="font-bold text-sm uppercase tracking-wider text-gray-500">Storage Usage</h4>
                {#if !storageMetrics}
                    <button type="button" class="btn btn-xs btn-outline rounded-lg" on:click={loadStorageMetrics}>
                        {#if loadingStorage}<span class="loading loading-spinner loading-xs"></span>{:else}Calculate{/if}
                    </button>
                {/if}
            </div>
            {#if storageMetrics}
                {@const dbMb = (storageMetrics.dbBytes / (1024 * 1024)).toFixed(1)}
                {@const uploadsMb = (storageMetrics.uploadsBytes / (1024 * 1024)).toFixed(1)}
                {@const totalMb = ((storageMetrics.dbBytes + storageMetrics.uploadsBytes) / (1024 * 1024)).toFixed(1)}
                {@const freeGb = storageMetrics.freeBytes ? (storageMetrics.freeBytes / (1024 * 1024 * 1024)).toFixed(1) : null}
                <div class="flex items-end justify-between mb-2">
                    <span class="text-2xl font-bold">{totalMb} <span class="text-sm font-medium text-gray-400">MB Used</span></span>
                    {#if freeGb !== null}
                        <span class="text-sm font-bold text-base-content/70">{freeGb} GB <span class="font-medium text-gray-400">Disk Free</span></span>
                    {/if}
                </div>
                <!-- Stacked bar -->
                <div class="w-full h-3 bg-base-300 rounded-full overflow-hidden flex shadow-inner mb-3">
                    <div class="bg-primary h-full" style="width: {(storageMetrics.dbBytes / storageMetrics.totalBytes) * 100}%" title="Database ({dbMb} MB)"></div>
                    <div class="bg-secondary h-full" style="width: {(storageMetrics.uploadsBytes / storageMetrics.totalBytes) * 100}%" title="Media & Uploads ({uploadsMb} MB)"></div>
                </div>
                <div class="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-primary"></div> Database ({dbMb} MB)</div>
                    <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-secondary"></div> Media ({uploadsMb} MB)</div>
                </div>
            {:else if loadingStorage}
                <div class="w-full h-3 bg-base-300 rounded-full overflow-hidden mb-3 animate-pulse"></div>
                <div class="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-gray-500 opacity-50">
                    <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-base-300"></div> Scanning...</div>
                </div>
            {/if}
        </div>

        <div class="bg-base-200/50 rounded-xl p-5 border border-base-200 mb-6">
            <div class="flex items-center gap-2 mb-4">
                <h4 class="font-bold text-sm uppercase tracking-wider text-gray-500 m-0">System Diagnostics</h4>
            </div>
            
            <SystemDiagnostics diagnostics={$page.data.diagnostics} />
        </div>

        <div class="flex flex-col gap-3">
            <ActionCard
                title="System Activity Log"
                href="/activity"
                icon="bi-activity"
                iconColorClass="bg-info/10 text-info"
                variant="flat"
            />
            <ActionCard
                title="Backup Database"
                href="/api/backup"
                target="_blank"
                icon="bi-database-down"
                iconColorClass="bg-success/10 text-success"
                variant="flat"
                showChevron={false}
            >
                <i class="bi bi-download text-gray-400"></i>
            </ActionCard>
        </div>
    </div>
</div>

<ConfirmModal bind:this={confirmModal} />