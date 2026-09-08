<script lang="ts">
    import type { PageServerData } from "./$types";
    import { goto } from "$app/navigation";
    import Delete from "$lib/components/delete.svelte";
    import Items from "$lib/components/items.svelte";
    import Navigation from "$lib/components/navigation.svelte";
    import { enhance } from "$app/forms";
    import { notify } from "$lib/client/notifications";
    import SpatialGridMap from "$lib/components/spatial/SpatialGridMap.svelte";
    import SpatialMap from "$lib/components/spatial/SpatialMap.svelte";
    import PolygonActionSheet from "$lib/components/spatial/PolygonActionSheet.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import { saveToQueue } from "$lib/client/offlineQueue";
    import { invalidateAll } from '$app/navigation';

    export let data: PageServerData;

    import pageTitle from '$lib/stores';
    pageTitle.set("Container " + data.item?.name);

    let spatialMapRef: SpatialMap;
    let actionSheet: PolygonActionSheet;

    let polygons = data.polygons || [];
    let isMapping = false;
    let isMapDirty = false;
    let activePolyIdx: number | null = null;
    let gridCols = 5;
    let gridRows = 4;
    let isWarpMode = false;

    // Deep Scan Triage State
    let triageModal: HTMLDialogElement;
    let isDeepScanning = false;
    let deepScanItems: any[] = [];
    let currentTriageIdx = 0;

    async function triggerAiMapping() {
        isMapping = true;
        try {
            const res = await fetch('/api/container-map', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ containerId: data.item?.id })
            });
            const json = await res.json();
            if (json.success) {
                polygons = json.polygons;
                if (json.newPhotoPath) {
                    data.item.photoPath = json.newPhotoPath;
                }
                notify('success', 'AI Mapping Complete!');
            } else {
                notify('warning', json.message || 'No compartments detected.');
            }
        } catch (e) {
            notify('error', 'Mapping failed.');
        } finally {
            isMapping = false;
        }
    }

    async function triggerDeepScan() {
        const emptySlots = polygons
            .map((p, i) => ({ polygon: p, originalIndex: i }))
            .filter((_, i) => !mappedEntities[i]);
            
        if (emptySlots.length === 0) return notify('info', 'All slots are already mapped.');

        isDeepScanning = true;
        try {
            const res = await fetch('/api/container-deep-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagePath: data.item?.photoPath, slots: emptySlots })
            });
            const json = await res.json();
            if (json.items && json.items.length > 0) {
                deepScanItems = json.items;
                currentTriageIdx = 0;
                triageModal.showModal();
            } else notify('warning', 'No items detected in any slots.');
        } catch (e) { notify('error', 'Deep Scan failed.'); } 
        finally { isDeepScanning = false; }
    }

    function handlePolySelect(e: CustomEvent<number>) {
        activePolyIdx = e.detail;
        actionSheet.show();
    }

    // Calculate tray breakdown
    $: childItemCount = data.items.filter(i => i.locations.some(l => l.container?.name !== data.item?.name)).length;
    $: directItemCount = data.items.length - childItemCount;

    $: mappedEntities = polygons.map(poly => {
        const polyStr = JSON.stringify(poly);
        const foundItem = data.items?.find(i => i.locations?.some(l => l.containerId === data.item?.id && l.spatialMap === polyStr));
        if (foundItem) return { ...foundItem, type: 'item' };
        const foundTray = data.item?.children?.find(c => c.spatialMap === polyStr);
        if (foundTray) return { ...foundTray, type: 'container' };
        return null;
    });
</script>

<article style="padding-bottom: 100px;" class="max-w-4xl mx-auto">

    <div class="relative w-full rounded-[2rem] overflow-hidden bg-base-200 border border-base-300 mb-8 shadow-sm group min-h-[250px] sm:min-h-[300px] flex items-end">
        {#if data.item?.photoPath}
            <!-- Blurred background -->
            <img src="{data.item.photoPath}" alt="Background" class="absolute inset-0 w-full h-full object-cover blur-xl opacity-40 scale-110" />
            <!-- Crisp foreground -->
            <div class="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/60 to-transparent"></div>
            <img src="{data.item.photoPath}" alt="{data.item.name}" class="absolute right-0 top-1/2 -translate-y-1/2 h-[120%] object-contain opacity-50 sm:opacity-100 sm:right-8 sm:h-[90%] drop-shadow-2xl mix-blend-overlay sm:mix-blend-normal pointer-events-none" />
        {/if}
        
        <div class="relative z-10 p-6 sm:p-10 w-full">
            <div class="flex justify-between items-start gap-4">
                <div class="flex-1">
                    <div class="badge badge-primary badge-sm font-mono mb-3 shadow-sm">{data.item?.name}</div>
                    <h1 class="text-4xl sm:text-5xl font-bold tracking-tight mb-2 text-base-content drop-shadow-sm">{data.item?.name}</h1>
                    
                    <div class="flex items-center gap-4 text-sm font-medium text-base-content/70 flex-wrap">
                        {#if data.item?.location}
                            <span class="flex items-center gap-1"><i class="bi bi-geo-alt-fill text-primary"></i> {data.item.location}</span>
                        {/if}
                        <span class="flex items-center gap-1"><i class="bi bi-box"></i> {data.totalCount} Items</span>
                        {#if data.item?.children?.length > 0}
                            <span class="flex items-center gap-1"><i class="bi bi-grid-3x3-gap"></i> {data.item.children.length} Trays</span>
                        {/if}
                    </div>

                    {#if data.item?.description}
                        <p class="mt-4 text-base-content/80 max-w-lg leading-relaxed">{data.item.description}</p>
                    {/if}
                </div>

                <!-- Action Buttons -->
                <div class="flex gap-2 shrink-0">
                    <a href="/container/{encodeURIComponent(data.item?.name || '')}/edit" class="btn btn-circle btn-ghost bg-base-100/50 backdrop-blur-md hover:bg-base-100 transition-colors" title="Edit Container">
                        <i class="bi bi-pencil-square text-lg"></i>
                    </a>
                    <!-- Delete wrapped safely -->
                    <div class="bg-base-100/50 backdrop-blur-md hover:bg-error/20 transition-colors rounded-full">
                        <Delete message='Delete this container?' action='/container/{encodeURIComponent(data.item?.name || '')}/delete' btnClass="btn btn-circle btn-ghost text-error" iconClass="bi bi-trash text-lg" />
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- SPATIAL EDITOR BLOCK -->
    {#if data.item?.photoPath}
        <div class="flex flex-col gap-3 mb-8">
            <div class="flex justify-between items-end px-2">
                <h3 class="font-bold text-lg">Spatial Map</h3>
                <div class="flex gap-2">
                    {#if !isWarpMode}
                        {#if polygons.length === 0}
                            <button class="btn btn-sm btn-primary shadow-sm rounded-xl" on:click={triggerAiMapping} disabled={isMapping}>
                                {#if isMapping}<span class="loading loading-spinner loading-xs"></span>{:else}<i class="bi bi-stars"></i> Auto-Map AI{/if}
                            </button>
                            <button class="btn btn-sm btn-outline border-base-300 rounded-xl" on:click={() => { spatialMapRef?.enterWarpMode(); }}>
                                <i class="bi bi-grid-3x3"></i> Draw Grid
                            </button>
                        {:else}
                        <div class="dropdown dropdown-end">
                            <button tabindex="0" class="btn btn-sm btn-outline border-base-300 rounded-xl"><i class="bi bi-pencil-square"></i> Edit Map</button>
                            <div tabindex="-1" class="dropdown-content z-50 p-4 shadow-xl bg-base-100 border border-base-200 rounded-2xl w-64 mt-2 flex flex-col gap-3">
                                <button class="btn btn-sm btn-primary w-full shadow-sm" on:click={triggerDeepScan} disabled={isDeepScanning}>
                                    {#if isDeepScanning}<span class="loading loading-spinner loading-xs"></span>{:else}<i class="bi bi-stars"></i> Deep Scan Grid{/if}
                                </button>
                                <button class="btn btn-sm btn-neutral w-full" on:click={() => { spatialMapRef?.enterWarpMode(); (document.activeElement as HTMLElement)?.blur(); }}>Adjust Warp Grid</button>
                                <form method="POST" action="?/clearSpatialMap" class="m-0" use:enhance={() => {
                                    return async ({ update }) => { 
                                        polygons = []; 
                                        isMapDirty = false; 
                                        notify('success', 'Map cleared. Ready to start over.'); 
                                        await update({ reset: false }); 
                                    };
                                }}>
                                    <button class="btn btn-sm btn-outline btn-error w-full" on:click|preventDefault={(e) => { if(confirm('Clear the entire map and start over?')) e.currentTarget.closest('form').submit(); }}><i class="bi bi-trash"></i> Delete Map</button>
                                </form>
                            </div>
                        </div>
                        {/if}
                        {#if isMapDirty}
                            <form method="POST" action="?/saveSpatialMap" use:enhance={() => {
                                return async ({ update }) => { isMapDirty = false; notify('success', 'Map saved!'); await update({ reset: false }); };
                            }}>
                                <input type="hidden" name="spatialMap" value={JSON.stringify(polygons)}>
                                <button type="submit" class="btn btn-sm btn-success text-white rounded-xl shadow-sm"><i class="bi bi-check-lg"></i> Save Layout</button>
                            </form>
                        {/if}
                    {/if}
                </div>
            </div>
            
            <SpatialMap 
                bind:this={spatialMapRef}
                imageUrl={data.item.photoPath} 
                bind:polygons 
                mappedEntities={mappedEntities}
                on:change={() => isMapDirty = true} 
                on:select={handlePolySelect}
                bind:isWarpMode
                bind:warpCols={gridCols}
                bind:warpRows={gridRows}
            />
        </div>
    {/if}

    {#if data.item?.children?.length > 0}
        <!-- Child Trays -->
        <div class="mb-8">
            <h3 class="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3 ml-2 flex items-center gap-2"><i class="bi bi-ui-checks"></i> Nested Trays</h3>
            <div class="flex flex-wrap gap-2">
                {#each data.item.children as tray}
                    <a href="/container/{encodeURIComponent(tray.name)}" class="badge badge-lg p-4 bg-base-200 hover:bg-primary hover:text-primary-content border border-base-300 transition-colors shadow-sm cursor-pointer font-mono text-sm">
                        {tray.name}
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Items inside -->
    <div>
        <div class="flex justify-between items-end mb-4 ml-2">
            <h2 class="text-xl font-bold tracking-tight">Items in Location</h2>
            {#if data.item?.children?.length > 0}
                <label class="cursor-pointer flex items-center gap-2 text-sm text-gray-500 font-medium hover:text-primary">
                    <input type="checkbox" class="checkbox checkbox-xs checkbox-primary" checked={data.includeTrays} on:change={(e) => {
                        const url = new URL(window.location.href);
                        if (e.currentTarget.checked) url.searchParams.set('includeTrays', 'true'); else url.searchParams.delete('includeTrays');
                        goto(url.href, { invalidateAll: true, keepFocus: true });
                    }} />
                    Include nested trays
                </label>
            {/if}
        </div>
        <div class="bg-base-100 rounded-[1.5rem] border border-base-200 shadow-sm overflow-hidden p-2">
            <Items items={data.items} />
        </div>
        <Navigation href={data.apiPath} prevPage={data.prevPage} nextPage={data.nextPage} />
    </div>

</article>

<PolygonActionSheet 
    bind:this={actionSheet} 
    parentContainerId={data.item?.id} 
    parentImagePath={data.item?.photoPath}
    polygonIndex={activePolyIdx}
    polygonCoords={activePolyIdx !== null ? polygons[activePolyIdx] : null}
        mappedEntity={activePolyIdx !== null ? mappedEntities[activePolyIdx] : null}
        on:deleteSlot={(e) => { polygons.splice(e.detail, 1); polygons = [...polygons]; isMapDirty = true; activePolyIdx = null; }}
/>

<dialog bind:this={triageModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm">
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        {#if deepScanItems.length > 0 && deepScanItems[currentTriageIdx]}
            {@const currentItem = deepScanItems[currentTriageIdx]}
            {@const poly = polygons[currentItem.slotIndex]}
            <div class="p-4 border-b border-base-200 bg-base-200/30 flex flex-col gap-1">
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-lg"><i class="bi bi-robot text-primary mr-1"></i> Review Scanned Items</h3>
                    <div class="badge badge-primary badge-outline font-bold">{currentTriageIdx + 1} of {deepScanItems.length}</div>
                </div>
                <div class="text-[10px] uppercase font-bold text-gray-500 tracking-wider">in {data.item?.name}</div>
            </div>
            
            {#if poly}
                {@const xs = poly.map(p => p[0])}
                {@const ys = poly.map(p => p[1])}
                {@const minX = Math.min(...xs)}
                {@const maxX = Math.max(...xs)}
                {@const minY = Math.min(...ys)}
                {@const maxY = Math.max(...ys)}
                {@const boxW = Math.max(1, maxX - minX)}
                {@const boxH = Math.max(1, maxY - minY)}
                
                <!-- Expand the view by 80% to show surrounding context and labels -->
                {@const padX = Math.max(100, boxW * 0.8)}
                {@const padY = Math.max(100, boxH * 0.8)}
                
                {@const paddedMinX = Math.max(0, minX - padX)}
                {@const paddedMaxX = Math.min(1000, maxX + padX)}
                {@const paddedMinY = Math.max(0, minY - padY)}
                {@const paddedMaxY = Math.min(1000, maxY + padY)}
                
                {@const paddedW = Math.max(1, paddedMaxX - paddedMinX)}
                {@const paddedH = Math.max(1, paddedMaxY - paddedMinY)}
                
                <div class="w-full h-48 sm:h-64 bg-base-300 relative overflow-hidden">
                    <!-- Padded Context Image -->
                    <img src={data.item?.photoPath} class="absolute max-w-none origin-top-left object-cover pointer-events-none" style="width: {100000 / paddedW}%; height: {100000 / paddedH}%; left: -{(paddedMinX / paddedW) * 100}%; top: -{(paddedMinY / paddedH) * 100}%;" alt="Slot View" />
                    
                    <!-- Exact Highlight Overlay -->
                    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute max-w-none origin-top-left pointer-events-none drop-shadow-md z-10" style="width: {100000 / paddedW}%; height: {100000 / paddedH}%; left: -{(paddedMinX / paddedW) * 100}%; top: -{(paddedMinY / paddedH) * 100}%;">
                        <polygon points={poly.map(pt => pt.join(',')).join(' ')} class="fill-primary/20 stroke-primary stroke-[5px]" vector-effect="non-scaling-stroke" />
                    </svg>
                    
                    <!-- Minimap Abstract Context Overlay -->
                    <div class="absolute top-3 right-3 w-24 sm:w-32 z-20 shadow-[0_10px_20px_rgba(0,0,0,0.3)] rounded-2xl ring-4 ring-base-100/50">
                        <SpatialGridMap 
                            activeIndex={currentItem.slotIndex} 
                            mappedIndices={mappedEntities.map((e, idx) => e ? idx : -1).filter(idx => idx !== -1)}
                            polygons={polygons} 
                            referenceImage={data.item?.photoPath} 
                        />
                    </div>
            
                </div>
            {/if}

            <div class="p-6 flex flex-col gap-3">
                <FormInput label="Suggested Title" bind:value={currentItem.title} required />
                <FormInput label="Description (Optional)" bind:value={currentItem.description} />
                
                <div class="flex gap-2 mt-4">
                    <button class="btn btn-ghost text-error hover:bg-error/10 flex-1 rounded-xl" on:click={() => { if (currentTriageIdx < deepScanItems.length - 1) currentTriageIdx++; else { triageModal.close(); invalidateAll(); } }}>Skip</button>
                    <button class="btn btn-primary flex-[2] shadow-md rounded-xl" on:click={async () => {
                        const fd = new FormData();
                        fd.append('parentContainerId', String(data.item?.id));
                        fd.append('polygon', JSON.stringify(poly));
                        fd.append('parentImagePath', data.item?.photoPath);
                        fd.append('title', currentItem.title);
                        if (currentItem.description) fd.append('description', currentItem.description);
                        await saveToQueue('/api/spatial-quick-create', fd);
                        window.dispatchEvent(new CustomEvent('outbox-trigger'));
                        if (currentTriageIdx < deepScanItems.length - 1) currentTriageIdx++; else { triageModal.close(); notify('success', 'Deep Scan Queued!'); invalidateAll(); }
                    }}>Accept & Next <i class="bi bi-arrow-right"></i></button>
                </div>
            </div>
        {/if}
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
