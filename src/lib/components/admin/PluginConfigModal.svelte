<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import { enhance } from "$app/forms";
    import { invalidateAll } from '$app/navigation';
    import { notify } from "$lib/client/notifications";
    import { hookDescriptions, modifierDescriptions } from '$lib/shared/pluginMeta';
    import PluginMetaDisplay from './PluginMetaDisplay.svelte';
    
    let modal: Modal;
    let plugin: any = null;
    let trove: any = null;
    let config: any = { hooks: [], actions: [], modifiers: [] };
    
    export function show(p: any, t: any, existingConfig: any) {
        plugin = p;
        trove = t;
        
        // If new enablement, enable everything by default to preserve simple UX
        if (!existingConfig) {
            config = {
                hooks: [...(plugin.hooks || [])],
                actions: [...(plugin.actions || [])],
                modifiers: [...(plugin.modifiers || [])],
                voiceIntents: [...(plugin.voiceIntents || [])]
            };
        } else {
            // If it's a legacy wildcard config ['*'], expand it to all capabilities
            config = {
                hooks: existingConfig.hooks?.includes('*') ? [...(plugin.hooks || [])] : [...(existingConfig.hooks || [])],
                actions: existingConfig.actions?.includes('*') ? [...(plugin.actions || [])] : [...(existingConfig.actions || [])],
                modifiers: existingConfig.modifiers?.includes('*') ? [...(plugin.modifiers || [])] : [...(existingConfig.modifiers || [])],
                voiceIntents: existingConfig.voiceIntents?.includes('*') ? [...(plugin.voiceIntents || [])] : [...(existingConfig.voiceIntents || [])]
            };
        }
        modal.showModal();
    }
    
    function toggleArray(arr: string[], item: string, e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        if (checked && !arr.includes(item)) arr.push(item);
        if (!checked) {
            const idx = arr.indexOf(item);
            if (idx > -1) arr.splice(idx, 1);
        }
        return arr;
    }
</script>

<Modal bind:this={modal} title="Configure Extension" boxClass="sm:rounded-[2.5rem] border border-base-200 shadow-2xl bg-base-100 w-11/12 max-w-lg">
    {#if plugin && trove}
        <form method="POST" action="/settings/troves?/savePluginConfig" class="p-6" use:enhance={() => {
            return async ({ result, update }) => {
                if (result.type === 'success') {
                    notify('success', 'Extension configured successfully.');
                    invalidateAll();
                } else {
                    notify('error', 'Failed to save configuration.');
                }
                modal.close();
                await update({ reset: false });
            };
        }}>
            <input type="hidden" name="id" value={trove.id} />
            <input type="hidden" name="pluginName" value={plugin.name} />
            <input type="hidden" name="active" value="true" />
            <input type="hidden" name="config" value={JSON.stringify(config)} />
            
            <div class="flex items-center gap-3 mb-4 text-primary">
                <i class="bi bi-sliders text-3xl"></i>
                <div class="flex-1 min-w-0">
                    <h3 class="font-bold text-xl leading-tight truncate" title={plugin.name}>{plugin.meta?.name || plugin.name}</h3>
                    {#if plugin.archetypes?.length > 0}
                        <p class="text-xs text-base-content/60 truncate">Contributes archetype: <strong>{plugin.archetypes.join(', ')}</strong></p>
                    {:else}
                        <p class="text-xs text-base-content/60 truncate">Active in Trove: <strong>{trove.name}</strong></p>
                    {/if}
                </div>
            </div>
            
            <div class="bg-base-200/50 rounded-xl p-4 mb-6 border border-base-200">
                <PluginMetaDisplay {plugin} showFilename={true} />
            </div>

            <p class="text-sm text-base-content/80 mb-6">Select which capabilities this extension is allowed to use in this Trove.</p>
            
            <div class="flex flex-col gap-4 bg-base-200/50 p-4 rounded-xl border border-base-200 mb-6">
                {#if plugin.hooks?.length > 0}
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-base-content/60 block mb-2">Automated Background Hooks</span>
                        <div class="flex flex-col gap-2">
                            {#each plugin.hooks as hook}
                                <label class="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" class="checkbox checkbox-sm checkbox-primary mt-0.5" checked={config.hooks.includes(hook)} on:change={(e) => config.hooks = toggleArray(config.hooks, hook, e)} />
                                    <div class="flex flex-col">
                                        <span class="text-sm font-semibold">{hookDescriptions[hook] || hook}</span>
                                        <span class="text-[10px] font-mono text-base-content/50">{hook}</span>
                                    </div>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}
                
                {#if plugin.actions?.length > 0}
                    {#if plugin.hooks?.length > 0}<div class="divider my-0 h-[1px]"></div>{/if}
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-base-content/60 block mb-2">UI Actions & Buttons</span>
                        <div class="flex flex-col gap-2">
                            {#each plugin.actions as action}
                                <label class="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" class="checkbox checkbox-sm checkbox-info" checked={config.actions.includes(action)} on:change={(e) => config.actions = toggleArray(config.actions, action, e)} />
                                    <span class="text-sm">{action}</span>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}
                
                {#if plugin.modifiers?.length > 0}
                    {#if plugin.hooks?.length > 0 || plugin.actions?.length > 0}<div class="divider my-0 h-[1px]"></div>{/if}
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-base-content/60 block mb-2">Prompt Modifiers</span>
                        <div class="flex flex-col gap-2">
                            {#each plugin.modifiers as mod}
                                <label class="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" class="checkbox checkbox-sm checkbox-warning mt-0.5" checked={config.modifiers.includes(mod)} on:change={(e) => config.modifiers = toggleArray(config.modifiers, mod, e)} />
                                    <div class="flex flex-col">
                                        <span class="text-sm font-semibold">{modifierDescriptions[mod] || mod}</span>
                                        <span class="text-[10px] font-mono text-base-content/50">{mod}</span>
                                    </div>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}
                
                {#if plugin.voiceIntents?.length > 0}
                    {#if plugin.hooks?.length > 0 || plugin.actions?.length > 0 || plugin.modifiers?.length > 0}<div class="divider my-0 h-[1px]"></div>{/if}
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-base-content/60 block mb-2">Voice Commands</span>
                        <div class="flex flex-col gap-2">
                            {#each plugin.voiceIntents as intent}
                                <label class="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" class="checkbox checkbox-sm checkbox-success mt-0.5" checked={config.voiceIntents.includes(intent)} on:change={(e) => config.voiceIntents = toggleArray(config.voiceIntents, intent, e)} />
                                    <div class="flex flex-col">
                                        <span class="text-sm font-semibold">{intent}</span>
                                    </div>
                                </label>
                            {/each}
                        </div>
                    </div>
                {/if}
                
                {#if !plugin.hooks?.length && !plugin.actions?.length && !plugin.modifiers?.length && !plugin.voiceIntents?.length}
                    <div class="text-xs text-gray-500 italic">This plugin exposes no configurable endpoints.</div>
                {/if}
            </div>
            
            <div class="modal-action mt-0 flex gap-2">
                <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={() => modal.close()}>Cancel</button>
                <button type="submit" class="btn btn-primary flex-1 rounded-xl shadow-md">Save Configuration</button>
            </div>
        </form>
    {/if}
</Modal>