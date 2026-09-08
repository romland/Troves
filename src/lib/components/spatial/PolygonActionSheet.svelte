<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import ItemMiniCard from "$lib/components/ItemMiniCard.svelte";
    import { createEventDispatcher } from "svelte";
    import { goto, invalidateAll } from "$app/navigation";
    import { notify } from "$lib/client/notifications";
    import { saveToQueue } from "$lib/client/offlineQueue";
    import { enhance } from "$app/forms";

    const dispatch = createEventDispatcher();
    let modal: Modal;
    
    export let parentContainerId: number;
    export let polygonIndex: number | null = null;
    export let polygonCoords: number[][] | null = null;
    export let mappedEntity: any = null; // Item or Child Container currently in this polygon
    export let parentImagePath: string = "";

    let isReadingLabel = false;
    let aiSuggestedTitle = "";
    let itemTitle = "";
    let isCreating = false;
    let searchTimer: ReturnType<typeof setTimeout>;
    let existingMatches: any[] = [];

    $: if (aiSuggestedTitle && !itemTitle) itemTitle = aiSuggestedTitle;
    $: if (aiSuggestedTitle && !itemTitle) onTitleInput();

    function onTitleInput() {
        clearTimeout(searchTimer);
        const q = itemTitle.trim() || aiSuggestedTitle.trim();
        if (q.length < 2) { existingMatches = []; return; }
        
        searchTimer = setTimeout(async () => {
            const res = await fetch(`/api/items?q=${encodeURIComponent(q)}&c=3&unassigned=true`);
            if (res.ok) {
                const data = await res.json();
                existingMatches = data.items;
            }
        }, 300);
    }

    export function show() {
        aiSuggestedTitle = "";
        itemTitle = "";
        existingMatches = [];
        modal.showModal();
    }

    export function close() {
        modal.close();
    }

    async function readPhysicalLabel() {
        if (!polygonCoords) return;
        isReadingLabel = true;
        try {
            // Sends the coordinates to crop and read the Dymo label on the physical tray
            const res = await fetch('/api/spatial-read-label', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentImagePath, polygon: polygonCoords })
            });
            const data = await res.json();
            if (data.text) {
                aiSuggestedTitle = data.text;
            }
        } finally {
            isReadingLabel = false;
        }
    }

    async function assignExisting(entity: any) {
        try {
            const res = await fetch('/api/spatial-assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentContainerId, entity: { ...entity, type: 'item' }, polygon: polygonCoords })
            });
            if (res.ok) {
                notify('success', `Mapped "${entity.title}" to slot!`);
                dispatch('mapped');
                close();
                invalidateAll();
            }
        } catch (e) { notify('error', 'Failed to map item.'); }
    }

    async function quickCreate() {
        const finalTitle = itemTitle || aiSuggestedTitle;
        if (!finalTitle || finalTitle.trim() === '') {
            notify('warning', 'Please enter an item name.');
            return;
            
        }
        isCreating = true;
        try {
            const fd = new FormData();
            fd.append('parentContainerId', String(parentContainerId));
            fd.append('polygon', JSON.stringify(polygonCoords));
            fd.append('parentImagePath', parentImagePath);
            fd.append('title', finalTitle);

            await saveToQueue('/api/spatial-quick-create', fd);
            notify('success', `Item creation queued!`);
            window.dispatchEvent(new CustomEvent('outbox-trigger'));
            
            close();
            dispatch('created');
        } finally { isCreating = false; }
    }
</script>

<Modal bind:this={modal} position="bottom" boxClass="p-0 bg-base-100/95 backdrop-blur-2xl sm:rounded-t-[2.5rem] rounded-t-3xl overflow-hidden shadow-[0_-10px_40px_rgba(0,0,0,0.15)] border-t border-base-200">
    <div class="w-12 h-1.5 bg-base-300 rounded-full mx-auto mt-4 mb-2"></div>
    
    <div class="px-6 pb-8 pt-2 flex flex-col gap-4">
        {#if mappedEntity}
            <!-- Already mapped -->
            <div class="text-[10px] font-bold uppercase tracking-wider text-primary">Mapped Entity</div>
            <ItemMiniCard item={mappedEntity} />
            
            <form method="POST" action="?/unmapEntity" use:enhance={() => {
                return async ({ update }) => { dispatch('unmapped'); close(); await update({ reset: false }); };
            }}>
                <input type="hidden" name="entityId" value={mappedEntity.id}>
                <input type="hidden" name="entityType" value={mappedEntity.type || 'item'}>
                <input type="hidden" name="parentContainerId" value={parentContainerId}>
                <button type="submit" class="btn btn-outline btn-error w-full rounded-xl mt-2">Unlink from Map</button>
            </form>
        {:else}
            <!-- Empty Polygon -->
            <div class="flex flex-col gap-1.5">
                <div class="flex justify-between items-end">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-500">Compartment Contents</div>
                    <button class="btn btn-xs btn-ghost text-primary" on:click={readPhysicalLabel} disabled={isReadingLabel}>
                        {#if isReadingLabel}<span class="loading loading-spinner loading-xs"></span>{:else}<i class="bi bi-stars"></i> Read Label{/if}
                    </button>
                </div>
                <p class="text-xs text-base-content/60 leading-relaxed">
                    Map physical items directly into this slot. No need to create nested folder containers—just assign what lives here.
                </p>
            </div>

            {#if aiSuggestedTitle}
                <div class="bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded-xl flex items-center justify-between">
                    <span class="font-bold text-sm">"{aiSuggestedTitle}"</span>
                    <span class="text-[10px] uppercase font-bold tracking-wider opacity-60">Suggestion</span>
                </div>
            {/if}

            <!-- Quick Create Ghost Item -->
            <div class="flex flex-col gap-3 bg-base-200/50 p-4 rounded-xl border border-base-200">
                <h4 class="font-bold text-sm m-0">Quick Create</h4>
                <FormInput bind:value={itemTitle} on:input={onTitleInput} placeholder="What's in this compartment?..." required inputClass="input-sm rounded-lg shadow-inner bg-base-100" />
                <button type="button" class="btn btn-primary btn-sm rounded-lg shadow-sm" on:click={quickCreate} disabled={isCreating}>
                    {#if isCreating}<span class="loading loading-spinner loading-xs"></span>{:else}Create Here{/if}
                </button>
            </div>

            {#if existingMatches.length > 0}
                <div class="mt-2 flex flex-col gap-2">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-500">Or Map Existing Unassigned Item</div>
                    {#each existingMatches as match}
                        <button type="button" class="flex items-center justify-between p-2 rounded-xl bg-base-100 border border-base-200 hover:border-primary text-left transition-colors shadow-sm" on:click={() => assignExisting(match)}>
                            <div class="flex items-center gap-3 min-w-0">
                                {#if match.photos?.[0]?.thumbPath}
                                    <img src="{match.photos[0].thumbPath}" class="w-8 h-8 rounded-md object-cover" alt="Thumb"/>
                                {:else}
                                    <div class="w-8 h-8 rounded-md bg-base-200 flex items-center justify-center"><i class="bi bi-box text-gray-400"></i></div>
                                {/if}
                                <div class="truncate text-sm font-semibold">{match.title}</div>
                            </div>
                            <i class="bi bi-pin-map text-primary"></i>
                        </button>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
    
    {#if !mappedEntity}
        <div class="px-6 pb-6 mt-[-10px]">
            <button class="btn btn-outline btn-error btn-sm w-full rounded-xl" on:click={() => { dispatch('deleteSlot', polygonIndex); close(); }}><i class="bi bi-trash"></i> Delete Slot</button>
        </div>
    {/if}
</Modal>
