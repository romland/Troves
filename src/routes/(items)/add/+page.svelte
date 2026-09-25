<!-- src/routes/(items)/add/+page.svelte -->
<script lang="ts">
    /* Integrates the ItemHub similarly into Add mode, achieving 100% parity across forms and screens. */
    import { enhance } from "$app/forms";
    import Alert from "$lib/components/alert.svelte";
    import type { ActionData, PageServerData } from "./$types";
    import type { SubmitFunction } from '@sveltejs/kit';
    import { beforeNavigate } from '$app/navigation';
    import PasteHandler from "$lib/components/PasteHandler.svelte";
    import ItemHub from "$lib/components/ItemHub.svelte";
    import BulkTriage from "$lib/components/add/BulkTriage.svelte";
    import pageTitle from '$lib/stores';
    import { saveToQueue } from '$lib/client/offlineQueue';
    import { goto } from '$app/navigation';
    import { onMount } from 'svelte';
	import { notify } from "$lib/client/notifications";
	import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import { ambientLocation } from '$lib/client/ambientContext';
    import { page } from '$app/stores';

    const CONTINUOUS_SCANNING = false;

    let saving = false;
    let isDirty = false;
    let hasSubmitted = false;
    let pastedDocCount = 0;
    
    let pasteHandler: PasteHandler;

    // Generate an idempotency key (Browser-safe fallback for SSR)
    let clientId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    
    let bulkTriageComponent: BulkTriage;
    let itemHubComponent: ItemHub;
	let confirmModal: ConfirmModal;
	let pendingNav: string | null = null;

    // Rapid Intake State
    let rapidScanCount = 0;
    let rapidFileInput: HTMLInputElement;
    let isRapidSaving = false;
    let wakeLock: any = null;

    async function handleRapidFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        isRapidSaving = true;
        const fd = new FormData();
        fd.append('file.0', file);
        fd.append('file.type.0', 'product');
        const rClientId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        fd.append('clientId', rClientId);
        fd.append('inventoryId', $page.data.activeInventoryId.toString());
        $ambientLocation.forEach(loc => fd.append('containers', loc));
        try {
            await saveToQueue('/add', fd);
            rapidScanCount++;
            notify('success', 'Item secured in outbox!');
            window.dispatchEvent(new CustomEvent('outbox-trigger'));
        } catch (err) {
            notify('error', 'Failed to capture item.');
        } finally {
            isRapidSaving = false;
            if (rapidFileInput) rapidFileInput.value = '';
        }
    }

	beforeNavigate(async ({ cancel, to }) => {
		if (isDirty && !hasSubmitted && !pendingNav) {
			cancel();
			const res = await confirmModal.ask('Unsaved Changes', 'You have unsaved changes. Are you sure you want to leave?', 'Leave', 'Stay', true);
			if (res) {
				isDirty = false;
				pendingNav = to?.url?.href || '/';
				goto(pendingNav);
			}
        }
    });
    
    export let form: ActionData;
    export let data: PageServerData;
    
    let mode: 'single' | 'collection' | 'rapid' = (data as any).activeAddMode === 'compare' ? 'single' : (data as any).activeAddMode;
    
    function setMode(newMode: 'single' | 'collection' | 'rapid') {
        mode = newMode;
        document.cookie = `troves_add_mode=${mode}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }

    onMount(() => {
        // FIX: Bypass SvelteKit layout caching staleness by reading the real browser cookie.
        const match = document.cookie.match(/(?:^|;\s*)troves_add_mode=([^;]*)/);
        if (match && match[1] && ['single', 'collection', 'rapid'].includes(match[1])) {
            console.log('[Add Hub] Cookie sync on mount:', match[1]);
            if (mode !== match[1]) mode = match[1] as any;
        }

        // Request screen wake lock to prevent phone from sleeping while scanning
        if ('wakeLock' in navigator) {
            (navigator as any).wakeLock.request('screen').then((lock: any) => wakeLock = lock).catch(() => console.warn("WakeLock not supported or denied."));
        }

		const handleShortcutMode = async (e: CustomEvent) => {
            const newMode = e.detail;
            console.log('[Add Hub] Received shortcut event:', newMode);
            if (mode !== newMode) {
				if (isDirty) {
					const res = await confirmModal.ask('Unsaved Changes', 'You have unsaved changes. Switch modes and lose them?', 'Switch Mode', 'Cancel', true);
					if (!res) return;
				}
				isDirty = false;
                setMode(newMode);
            }
        };
        window.addEventListener('shortcut:addMode', handleShortcutMode as unknown as EventListener);
        return () => {
            window.removeEventListener('shortcut:addMode', handleShortcutMode as unknown as EventListener);
            if (wakeLock) wakeLock.release().catch(() => {});
        };
    });


    
    pageTitle.set("Add new product");
    $:  pageTitle.set(mode === 'single' ? "Add new product" : mode === 'collection' ? "Multi-scan" : "Rapid Intake");
    
</script>

<!-- CRITICAL: Wrapper tracks unsaved state to prevent background syncs from destroying user input when switching tabs -->
<div style="display: contents" data-dirty={isDirty}>
<PasteHandler 
bind:this={pasteHandler}
formId="eltForm" 
forcePhotoType={mode === 'collection' ? 'product' : null}
on:save={(ev) => {
    if (mode === 'collection' && ev.detail.file) {
        bulkTriageComponent?.processPastedFile(ev.detail.file);
    }
}}
on:success={(ev) => { notify("success", ev.detail); isDirty = true; }}
on:processingStart={(ev) => notify("loading", ev.detail.message, ev.detail.taskId)}
on:processingComplete={(ev) => { 
    notify(ev.detail.status, ev.detail.message, ev.detail.taskId);
    if (ev.detail.status === 'success') {
        isDirty = true;
        pastedDocCount++;
    }
}}
/>

{#if form && form.error}
<div class="mb-6 max-w-2xl mx-auto">
    <Alert>{@html form.message}</Alert>
</div>
{/if}

{#if data.isBootstrapping}
    <div class="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md mx-auto px-4">
        <div class="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6 shadow-sm">
            <span class="loading loading-ring loading-lg"></span>
        </div>
        <h2 class="text-2xl font-bold mb-3 tracking-tight">Initializing Trove...</h2>
        <p class="text-gray-500 mb-8">Troves is currently analyzing your trove's archetype and building a custom taxonomy schema. This usually takes 10ish seconds.</p>
        <button type="button" class="btn btn-outline" on:click={() => window.location.reload()}>
            <i class="bi bi-arrow-clockwise"></i> Refresh Status
        </button>
    </div>
{:else}
    <div class="bg-base-200 p-1 rounded-2xl flex w-full max-w-md mx-auto mb-6 mt-2 relative z-10 border border-base-300">
        <button type="button" class="flex-1 btn btn-sm border-none {mode === 'single' ? 'bg-base-100 shadow-sm hover:bg-base-100 text-base-content' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={async () => {
            if (mode !== 'single' && isDirty) {
                const res = await confirmModal.ask('Unsaved Items', 'You have unsaved scanned items. Switch modes and lose them?', 'Switch Mode', 'Cancel', true);
                if (!res) return;
            }
            isDirty = false;
            setMode('single');
        }}>Single</button>
        <button type="button" class="flex-1 btn btn-sm border-none {mode === 'collection' ? 'bg-base-100 shadow-sm hover:bg-base-100 text-base-content' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" disabled={!$page.data.capabilities.hasVision} title={!$page.data.capabilities.hasVision ? 'Requires Vision Engine' : ''} on:click={async () => {
            if (mode !== 'collection' && isDirty) {
                const res = await confirmModal.ask('Unsaved Changes', 'You have unsaved changes. Switch modes and lose them?', 'Switch Mode', 'Cancel', true);
                if (!res) return;
            }
            isDirty = false;
            setMode('collection');
        }}>Multi-scan</button>
        
        <button type="button" class="flex-1 btn btn-sm border-none {mode === 'rapid' ? 'bg-base-100 shadow-sm hover:bg-base-100 text-base-content font-bold text-secondary' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={() => {
            isDirty = false;
            setMode('rapid');
            setTimeout(() => rapidFileInput?.click(), 100);
        }}>Rapid</button>
    </div>

    {#if mode === 'single'}
            <ItemHub 
            bind:this={itemHubComponent}
            containers={data.containers} 
            saving={saving}
            bind:isDirty
            bind:hasSubmitted
            pastedDocCount={pastedDocCount}
            formAction="/add"
            successRedirect="/"
            isContinuous={CONTINUOUS_SCANNING}
            {clientId}
            on:queued={() => pasteHandler?.clearQueue()}
            on:success={(ev) => notify("success", ev.detail)} 
            on:processingStart={(ev) => notify("loading", ev.detail.message, ev.detail.taskId)}
            on:processingComplete={(ev) => notify(ev.detail.status, ev.detail.message, ev.detail.taskId)}
            />
    {:else if mode === 'rapid'}
        <div class="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-sm mx-auto px-4 animate-fade-in">
            <div class="w-32 h-32 bg-base-100 border border-base-200 text-secondary rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl relative">
                {#if isRapidSaving}
                    <span class="loading loading-spinner loading-lg"></span>
                {:else}
                    <i class="bi bi-lightning-charge-fill text-6xl"></i>
                    {#if rapidScanCount > 0}
                        <div class="absolute -top-3 -right-3 bg-success text-white w-10 h-10 rounded-full flex items-center justify-center font-bold shadow-md border-[3px] border-base-100 text-lg animate-fade-in">
                            {rapidScanCount}
                        </div>
                    {/if}
                {/if}
            </div>
            <h2 class="text-3xl font-bold mb-3 tracking-tight">Rapid Intake</h2>
            <p class="text-gray-500 mb-6 text-sm">
                {#if rapidScanCount > 0}
                    <strong>{rapidScanCount} item{rapidScanCount === 1 ? '' : 's'}</strong> secured in your outbox.
                {:else}
                    Skip the details. Just snap, save, and sort it out later.
                {/if}
            </p>

            <div class="w-full max-w-sm mb-6 bg-base-100 p-4 rounded-2xl border border-base-200 shadow-sm flex flex-col gap-2 text-left">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500"><i class="bi bi-pin-angle-fill mr-1"></i> Default Location (L)</span>
                    <button type="button" class="btn btn-xs btn-ghost text-primary h-auto min-h-0 py-1" on:click={() => document.getElementById('ambient-container-btn')?.click()}>Change</button>
                </div>
                <div class="font-medium text-sm text-base-content truncate">
                    {#if $ambientLocation.length > 0}
                        {$ambientLocation.join(', ')}
                    {:else}
                        <span class="text-gray-400 italic">Unassigned</span>
                    {/if}
                </div>
            </div>

            <div class="flex flex-col w-full gap-4">
                <button type="button" class="btn btn-secondary btn-lg w-full rounded-2xl shadow-xl text-lg h-16" disabled={isRapidSaving} on:click={() => rapidFileInput.click()}>
                    <i class="bi bi-camera-fill text-2xl mr-2"></i> {#if rapidScanCount > 0}Scan Next Item{:else}Start Scanning{/if}
                </button>
                {#if rapidScanCount > 0}
                    <button type="button" class="btn btn-ghost btn-lg w-full rounded-2xl text-lg h-16 font-semibold" on:click={() => { rapidScanCount = 0; setMode('single'); goto('/', { invalidateAll: true }); }}>I'm Done</button>
                {/if}
            </div>
            <input type="file" bind:this={rapidFileInput} accept="image/*" capture="environment" class="hidden" on:change={handleRapidFileSelect} />
        </div>
    {:else if mode === 'collection'}
        <BulkTriage 
            bind:this={bulkTriageComponent}
            containers={data.containers} 
            categories={data.categories}
            tags={data.tags}
            bind:isDirty
            on:processingStart={(ev) => notify("loading", ev.detail.message, ev.detail.taskId)}
            on:processingComplete={(ev) => notify(ev.detail.status, ev.detail.message, ev.detail.taskId)}
        />
    {/if}
{/if}

<ConfirmModal bind:this={confirmModal} />
</div>
