<script lang="ts">
    import { enhance } from "$app/forms";
    import { page } from "$app/stores";
    import { notify } from "$lib/client/notifications";
    import SettingToggle from "$lib/components/SettingToggle.svelte";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import CreateInventoryModal from "$lib/components/CreateInventoryModal.svelte";
    import pageTitle from '$lib/stores';

    pageTitle.set("Manage Troves");

    let deleteConfirmId: number | null = null;
    let deleteConfirmText: string = "";
    let confirmModal: ConfirmModal;
    let createInventoryModal: CreateInventoryModal;

    function createEnhancer() {
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

<div class="max-w-4xl mx-auto">
    {#if $page.data.user?.isAdmin || $page.data.user?.canCreateInventories}
        <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6 mb-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
                <h3 class="font-bold text-lg mb-1">Create New Trove</h3>
                <p class="text-sm text-gray-500">Set up a new isolated space for a specific group of items.</p>
            </div>
            <button type="button" class="btn btn-primary shadow-sm shrink-0 w-full sm:w-auto" on:click={() => createInventoryModal.showModal()}>
                <i class="bi bi-plus-lg"></i> Create Trove
            </button>
        </div>
    {/if}

    {#if $page.data.allInventories?.length > 0}
        <div class="bg-base-100 border border-warning/20 shadow-sm rounded-xl p-6 mb-8 relative overflow-hidden">
            <div class="absolute top-0 right-0 bg-warning text-warning-content text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">Owner Actions</div>
            
            <h3 class="font-bold text-lg mb-4 text-warning"><i class="bi bi-shield-check"></i> Trove Access</h3>
            {#if $page.data.user?.isAdmin}
                <form method="POST" action="?/assignAccess" use:enhance={createEnhancer} class="flex flex-col sm:flex-row gap-2 mb-6">
                    <select name="userId" class="select select-bordered w-full" required>
                        <option value="" disabled selected>Select User</option>
                        {#each $page.data.allUsers || [] as u}
                            <option value={u.id}>{u.username} ({u.name})</option>
                        {/each}
                    </select>
                    <select name="inventoryId" class="select select-bordered w-full" required>
                        <option value="" disabled selected>Select Trove</option>
                        {#each $page.data.allInventories || [] as v}
                            <option value={v.id}>{v.name}</option>
                        {/each}
                    </select>
                    <select name="role" class="select select-bordered w-full sm:w-auto" required>
                        <option value="OWNER">Owner</option>
                        <option value="EDITOR" selected>Editor</option>
                        <option value="VIEWER">Viewer</option>
                    </select>
                    <button type="submit" class="btn btn-neutral">Assign</button>
                </form>
            {/if}

            <div class="overflow-x-auto bg-base-200 rounded-lg mb-8">
                <table class="table table-sm">
                    <thead><tr><th>User</th><th>Trove</th><th>Role</th><th></th></tr></thead>
                    <tbody>
                        {#each $page.data.accessMap || [] as access}
                            <tr>
                                <td>{access.user.username}</td>
                                <td>{access.inventory.name}</td>
                                <td>
                                    {#if access.userId === $page.data.user?.id && !$page.data.user?.isAdmin}
                                        <span class="badge badge-sm">{access.role}</span>
                                    {:else}
                                        <form method="POST" action="?/assignAccess" use:enhance={createEnhancer} class="m-0">
                                            <input type="hidden" name="userId" value={access.userId}>
                                            <input type="hidden" name="inventoryId" value={access.inventoryId}>
                                            <select name="role" class="select select-bordered select-xs w-auto bg-base-100" on:change={(e) => e.currentTarget.form?.requestSubmit()}>
                                                <option value="OWNER" selected={access.role === 'OWNER'}>Owner</option>
                                                <option value="EDITOR" selected={access.role === 'EDITOR'}>Editor</option>
                                                <option value="VIEWER" selected={access.role === 'VIEWER'}>Viewer</option>
                                            </select>
                                        </form>
                                    {/if}
                                </td>
                                <td class="text-right">
                                    {#if access.userId === $page.data.user?.id && access.role === 'OWNER' && !$page.data.user?.isAdmin}
                                        <span class="text-[10px] text-gray-400 font-bold uppercase">Owner</span>
                                    {:else}
                                        <form method="POST" action="?/revokeAccess" use:enhance={createEnhancer}>
                                            <input type="hidden" name="userId" value={access.userId}>
                                            <input type="hidden" name="inventoryId" value={access.inventoryId}>
                                            <button type="submit" aria-label="Revoke Access" class="btn btn-ghost btn-xs text-error"><i class="bi bi-trash"></i></button>
                                        </form>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>

            <div class="divider my-6">Manage Settings per Trove</div>

            <div class="flex flex-col gap-6">
                {#each $page.data.allInventories || [] as v}
                    <div class="bg-base-200 p-4 rounded-xl border border-base-300">
                        <div class="flex justify-between items-start mb-4">
                            <div>
                                <div class="font-bold text-lg {deleteConfirmId === v.id ? 'text-error' : ''}">{v.name}</div>
                                <div class="text-[10px] text-gray-500 mt-0.5 capitalize">{v.archetype} trove &bull; {v._count?.items || 0} items &bull; {v._count?.notes || 0} notes &bull; {v._count?.containers || 0} containers</div>
                            </div>
                            
                            <div class="text-right">
                                {#if deleteConfirmId === v.id}
                                    <form method="POST" action="?/deleteInventory" use:enhance={() => { return async ({ result, update }) => { if(result.type === 'success') notify('success', 'Trove deleted'); deleteConfirmId = null; deleteConfirmText = ''; update(); }; }} class="flex items-center gap-2 justify-end">
                                        <input type="hidden" name="id" value={v.id}>
                                        <input type="text" name="confirmName" bind:value={deleteConfirmText} class="input input-xs input-bordered border-error focus:border-error w-32 bg-base-100" placeholder="Type name..." autocomplete="off">
                                        <button type="submit" class="btn btn-error btn-xs" disabled={deleteConfirmText !== v.name}>Delete</button>
                                        <button type="button" class="btn btn-ghost btn-xs" on:click={() => {deleteConfirmId = null; deleteConfirmText = '';}}>Cancel</button>
                                    </form>
                                {:else}
                                    <button type="button" class="btn btn-ghost btn-xs text-error" on:click={() => {deleteConfirmId = v.id; deleteConfirmText = '';}}>
                                        <i class="bi bi-trash"></i> Delete
                                    </button>
                                {/if}
                            </div>
                        </div>

                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleAutoCategories" name="allowNewCategories" checked={v.allowNewCategories} label="Allow automated creation of categories" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleAutoTaxonomy" name="allowAutoTaxonomy" checked={v.allowAutoTaxonomy} label="Enable Smart Taxonomy & Attribute Extractions" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleExtractExif" name="extractExif" checked={v.extractExif} label="Extract EXIF data (including GPS) from photos" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleDeepScan" name="deepScan" checked={v.deepScanCollections} label="Deep-scan: extract detailed attributes for all items in multi-scans" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleBgRemoval" name="bgRemovalEnabled" checked={v.bgRemovalEnabled} label="Remove image backgrounds" />

                        <form method="POST" action="?/toggleBgRemovalModel" use:enhance={createEnhancer} class="mt-2 flex flex-col sm:flex-row sm:items-center items-start gap-1 sm:gap-2">
                            <input type="hidden" name="id" value={v.id}>
                            <select name="bgRemovalModel" class="select select-bordered select-xs font-medium w-full sm:w-auto bg-base-100" disabled={!v.bgRemovalEnabled} on:change={(e) => e.currentTarget.form?.requestSubmit()} value={v.bgRemovalModel || 'bria-rmbg'}>
                                <option value="bria-rmbg">BRIA v2.0 (Slow / Best Quality)</option>
                                <option value="isnet-general-use">ISNet (Balanced)</option>
                                <option value="u2net">U2Net (Fast / Moderate)</option>
                            </select>
                            <span class="text-xs text-gray-500 font-medium" class:opacity-50={!v.bgRemovalEnabled}>Background removal model</span>
                        </form>

                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleBgPreCrop" name="bgRemovalPreCrop" checked={v.bgRemovalPreCrop} disabled={!v.bgRemovalEnabled} label="Pre-crop image before background removal (good for some item-types)" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/togglePaddleOCR" name="enablePaddleOCR" checked={v.enablePaddleOCR} label="Enable local PaddleOCR text extraction" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleArchiveSingle" name="archiveSingleScans" checked={v.archiveSingleScans} label="Save backup pictures of single item scans to Notebook" />
                        <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleTrackQuantity" name="trackQuantity" checked={v.trackQuantity} label="Track Quantity / Stock for items" />

                        <!-- UI View Toggles -->
                        <div class="mt-3 p-3 bg-base-300 rounded-lg border border-base-200">
                            <div class="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Inventory Features & UI</div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {#each [['showExif', 'Show EXIF Data'], ['showColors', 'Show Colors'], ['showOcr', 'Show Raw OCR Text'], ['enableAskAi', 'Enable Ask Troves'], ['enableNotebook', 'Enable Notebook'], ['showNoteContextUrl', 'Show Page Context on Quick Notes'], ['enableDocuments', 'Enable Documents'], ['enableFuzzySearch', 'Fuzzy Word Search'], ['showRelatedItems', 'Show Related Items']] as [field, label]}
                                    <SettingToggle enhanceFn={createEnhancer} id={v.id} action="?/toggleUiFlag" name={field} checked={v[field]} label={label} type="checkbox" payloadType="field" formClass="flex items-center gap-2" />
                                {/each}
                            </div>
                            {#if v.showRelatedItems && !v.allowAutoTaxonomy}
                                <div class="mt-3 text-[10px] text-warning flex items-start gap-1.5 font-bold bg-warning/10 p-2 rounded-lg">
                                    <i class="bi bi-exclamation-triangle-fill mt-0.5"></i> <span>Related items rely heavily on attributes and semantic tokens. Enable 'Smart Taxonomy & Extractions' above for accurate results.</span>
                                </div>
                            {/if}
                            {#if v.enableNotebook}
                                <div class="mt-3 pt-3 border-t border-base-200/50">
                                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">Notebook Tabs</span>
                                    <form method="POST" action="?/updateNotebookCategories" use:enhance={createEnhancer} class="flex gap-2">
                                        <input type="hidden" name="id" value={v.id}>
                                        <div class="flex-1">
                                            <input type="text" name="notebookCategories" class="input input-xs input-bordered w-full bg-base-100" value={JSON.parse(v.notebookCategories || '[]').join(', ')} />
                                            <div class="text-[9px] text-gray-400 mt-1 leading-tight">Comma separated. Removing a category hides the tab, but existing notes remain accessible under "All".</div>
                                        </div>
                                        <button type="submit" class="btn btn-xs btn-primary shrink-0">Save</button>
                                    </form>
                                </div>
                            {/if}
                        </div>

                        <form method="POST" action="?/updateInventoryStrategy" use:enhance={createEnhancer} class="mt-3 flex flex-col sm:flex-row sm:items-center items-start gap-1 sm:gap-2">
                            <input type="hidden" name="id" value={v.id}>
                            <select name="strategy" class="select select-bordered select-xs font-medium w-full sm:w-auto bg-base-100" on:change={(e) => e.currentTarget.form?.requestSubmit()} value={v.duplicateStrategy || 'PROMPT'}>
                                <option value="PROMPT">Ask Me</option>
                                <option value="AUTO_BUMP">Auto-Merge (+1)</option>
                                <option value="AUTO_IGNORE">Auto-Ignore</option>
                            </select>
                            <span class="text-xs text-gray-500 font-medium">is the default duplicate resolution</span>
                        </form>

                        <form method="POST" action="?/updateContainerMode" use:enhance={createEnhancer} class="mt-2 flex flex-col sm:flex-row sm:items-center items-start gap-1 sm:gap-2">
                            <input type="hidden" name="id" value={v.id}>
                            <select name="containerMode" class="select select-bordered select-xs font-medium w-full sm:w-auto bg-base-100" on:change={(e) => e.currentTarget.form?.requestSubmit()} value={v.containerMode || 'scan'}>
                                <option value="scan">Scan QR</option>
                                <option value="select">Manual List</option>
                            </select>
                            <span class="text-xs text-gray-500 font-medium">is default container selector mode</span>
                        </form>

                        <form method="POST" action="?/updateDefaultView" use:enhance={createEnhancer} class="mt-2 flex flex-col sm:flex-row sm:items-center items-start gap-1 sm:gap-2">
                            <input type="hidden" name="id" value={v.id}>
                            <select name="defaultView" class="select select-bordered select-xs font-medium w-full sm:w-auto bg-base-100" on:change={(e) => e.currentTarget.form?.requestSubmit()} value={v.defaultView || 'grid'}>
                                <option value="grid">Grid</option>
                                <option value="list">List</option>
                            </select>
                            <span class="text-xs text-gray-500 font-medium">is default item view</span>
                        </form>

                        <div class="flex flex-wrap gap-2 mt-3">
                            <form method="POST" action="?/beautifyTaxonomy" use:enhance={createEnhancer} on:submit={() => notify('info', 'Beautifying labels... This may take a few seconds.')}>
                                <input type="hidden" name="inventoryId" value={v.id}>
                                <button type="submit" class="btn btn-xs btn-outline btn-primary gap-1 text-[10px] bg-base-100"><i class="bi bi-magic"></i> Beautify Taxonomy Labels</button>
                            </form>

                            <form method="POST" action="?/retrySchemaBootstrap" use:enhance={async ({ cancel }) => {
                                const res = await confirmModal.ask('Regenerate Rules?', 'Are you sure you want to regenerate Taxonomy Rules? This will overwrite the current global schema.', 'Regenerate', 'Cancel', true);
                                if (!res) { cancel(); return; }
                                return createEnhancer();
                            }}>
                                <input type="hidden" name="inventoryId" value={v.id}>
                                <input type="hidden" name="name" value={v.name}>
                                <button type="submit" class="btn btn-xs btn-outline btn-ghost gap-1 text-[10px] bg-base-100"><i class="bi bi-arrow-repeat"></i> Regenerate Taxonomy Rules</button>
                            </form>

                            <form method="POST" action="?/rebuildDuplicates" use:enhance={async ({ cancel }) => {
                                const res = await confirmModal.ask('Re-scan Duplicates?', 'Re-scan the entire trove for duplicates? This runs in the background and may take a few moments.', 'Re-scan', 'Cancel');
                                if (!res) { cancel(); return; }
                                return createEnhancer();
                            }}>
                                <input type="hidden" name="inventoryId" value={v.id}>
                                <button type="submit" class="btn btn-xs btn-outline btn-warning gap-1 text-[10px] bg-base-100"><i class="bi bi-intersect"></i> Re-scan Duplicates</button>
                            </form>
                        </div>
                        
                        <details class="collapse bg-base-300 mt-3 rounded-xl border border-base-200">
                            <summary class="collapse-title text-[10px] font-bold px-3 py-2 min-h-0">Raw Taxonomy (JSON)</summary>
                            <div class="collapse-content px-3 pb-3">
                                <form method="POST" action="?/updateTaxonomy" use:enhance={createEnhancer} class="flex flex-col gap-2 mt-2">
                                    <input type="hidden" name="id" value={v.id}>
                                    <textarea name="taxonomyJson" class="textarea textarea-bordered font-mono text-[10px] h-64 whitespace-pre leading-tight bg-base-100" spellcheck="false">{JSON.stringify(v.templateFields, null, 2)}</textarea>
                                    <button type="submit" class="btn btn-primary btn-xs self-end shadow-sm">Save JSON</button>
                                </form>
                            </div>
                        </details>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<ConfirmModal bind:this={confirmModal} />
<CreateInventoryModal bind:this={createInventoryModal} on:success={(e) => notify('success', e.detail)} on:error={(e) => notify('error', e.detail)} />