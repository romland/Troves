<script lang="ts">
    import type { PageServerData } from "./$types";
    import Delete from "$lib/components/delete.svelte";
    import Items from "$lib/components/items.svelte";
    import Navigation from "$lib/components/navigation.svelte";
    import { enhance } from "$app/forms";
    import { notify } from "$lib/client/notifications";
    import SpatialGridMap from "$lib/components/spatial/SpatialGridMap.svelte";
    import SpatialMap from "$lib/components/spatial/SpatialMap.svelte";
    import PolygonActionSheet from "$lib/components/spatial/PolygonActionSheet.svelte";
    import TrayBank from "$lib/components/spatial/TrayBank.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import SpatialItemSettings from "$lib/components/spatial/SpatialItemSettings.svelte";
    import ContainerBreadcrumbs from "$lib/components/ContainerBreadcrumbs.svelte";
    import Modal from "$lib/components/Modal.svelte";
    import MoveContainerModal from "$lib/components/MoveContainerModal.svelte";
    import { saveToQueue, outboxStore, completedOutboxStore } from "$lib/client/offlineQueue";
    import { invalidateAll, beforeNavigate, goto } from '$app/navigation';
    import FillStatusSlider from "$lib/components/spatial/FillStatusSlider.svelte";
    import BottomSheet from "$lib/components/BottomSheet.svelte";
    import ActionCard from "$lib/components/ActionCard.svelte";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import ContentUnavailable from "$lib/components/ContentUnavailable.svelte";

    export let data: PageServerData;

    import pageTitle from '$lib/stores';
    pageTitle.set("Container " + data.item?.name);

    let spatialMapRef: SpatialMap;
    let actionSheet: PolygonActionSheet;

    let polygons = data.polygons || [];
    let warpMap = data.warpMap || null;
    let renderAsGrid = data.renderAsGrid || false;
    let isMapping = false;
    let isMapDirty = false;
    let activePolyIdx: number | null = null;

    let gridCols = data.warpMap?.cols || 5;
    let gridRows = data.warpMap?.rows || 4;
    let warpCorners = data.warpMap?.corners || [[100, 100], [900, 100], [900, 900], [100, 900]];

    let isWarpMode = false;
    let showSpatialSetup = false;

    let initialPolygonsStr = JSON.stringify(data.polygons || []);

    $: if (!isMapDirty && !isWarpMode) {
        polygons = data.polygons || [];
        warpMap = data.warpMap || null;
        renderAsGrid = data.renderAsGrid || false;
        if (data.warpMap) {
            gridCols = data.warpMap.cols;
            gridRows = data.warpMap.rows;
            warpCorners = data.warpMap.corners;
        } else if (!data.warpMap && polygons.length === 0) {
            gridCols = 5; gridRows = 4; warpCorners = [[100, 100], [900, 100], [900, 900], [100, 900]];
        }
    }

    // Deep Scan Triage State
    let postSaveWizard: Modal;
    let triageModal: HTMLDialogElement;
    let isDeepScanning = false;
    let deepScanItems: any[] = [];
    let currentTriageIdx = 0;
    let moveModal: MoveContainerModal;
    let analyzeWithVision = false;
    let removeBackground = false;
    let confirmModal: ConfirmModal;

    // New Audit Flow State
    let isAuditing = false;
    let auditFileInput: HTMLInputElement;
    let auditData: any = null;
    let auditResolutionSheet: BottomSheet;
    let activeAuditSlotIndex: number | null = null;
    $: activeAuditSlot = activeAuditSlotIndex !== null && auditData?.slots ? auditData.slots[activeAuditSlotIndex] : null;
    let auditModal: HTMLDialogElement;

    let pendingNav: string | null = null;
    beforeNavigate(async ({ cancel, to }) => {
        if (isMapDirty && !pendingNav) {
            cancel();
            const res = await confirmModal.ask('Unsaved Map', 'You have unsaved changes to the spatial map. Leave without saving?', 'Leave', 'Stay', true);
            if (res) {
                isMapDirty = false;
                pendingNav = to?.url?.href || '/';
                goto(pendingNav);
            }
        }
    });

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
                if (json.warpMap) {
                    warpMap = json.warpMap;
                    gridCols = warpMap.cols;
                    gridRows = warpMap.rows;
                    warpCorners = warpMap.corners;
                    setTimeout(() => { spatialMapRef?.enterWarpMode(); }, 100);
                }
                isMapDirty = true;
                if (json.newPhotoPath) {
                    data.item.photoPath = json.newPhotoPath;
                }
                notify('success', 'Mapping Complete!');
            } else {
                notify('warning', json.message || 'No compartments detected.');
            }
        } catch (e) {
            notify('error', 'Mapping failed.');
        } finally {
            isMapping = false;
        }
    }

    async function triggerDeepScan(force = false) {
        const emptySlots = polygons
            .map((p, i) => ({ polygon: p, originalIndex: i }))
            .filter((_, i) => !mappedEntities[i]);
            
        if (emptySlots.length === 0) return notify('info', 'All slots are already mapped.');

        if (!force && typeof sessionStorage !== 'undefined') {
            const cached = sessionStorage.getItem(`deepscan_${data.item?.id}`);
            const cachedIdx = sessionStorage.getItem(`deepscan_idx_${data.item?.id}`);
            if (cached) {
                deepScanItems = JSON.parse(cached);
                currentTriageIdx = cachedIdx ? parseInt(cachedIdx, 10) : 0;
                if (currentTriageIdx < deepScanItems.length) {
                    triageModal.showModal();
                    return;
                }
            }
        }

        isDeepScanning = true;
        triageModal.showModal();
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
                if (typeof sessionStorage !== 'undefined') {
                    sessionStorage.setItem(`deepscan_${data.item?.id}`, JSON.stringify(deepScanItems));
                    sessionStorage.setItem(`deepscan_idx_${data.item?.id}`, '0');
                }
            } else {
                triageModal.close();
                notify('warning', 'No items detected in any slots.');
            }
        } catch (e) { 
            triageModal.close(); 
            notify('error', 'Deep Scan failed.'); 
        } finally { 
            isDeepScanning = false; 
        }
    }

    function nextTriageItem() {
        if (currentTriageIdx < deepScanItems.length - 1) {
            currentTriageIdx++;
            if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`deepscan_idx_${data.item?.id}`, currentTriageIdx.toString());
        } else {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem(`deepscan_${data.item?.id}`);
                sessionStorage.removeItem(`deepscan_idx_${data.item?.id}`);
            }
            triageModal.close();
            invalidateAll();
        }
    }

    let auditErrorTitle: string | null = null;
    let auditErrorMessage: string | null = null;

    async function runAudit(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        isAuditing = true;
        auditData = null;
        auditErrorTitle = null;
        if (auditModal && !auditModal.open) auditModal.showModal();
        
        const fd = new FormData();
        fd.append('file', file);
        fd.append('scopeValue', data.item.name);
        
        try {
            const res = await fetch('/api/spatial-audit', { method: 'POST', body: fd });
            const json = await res.json();
            if (res.ok && json.success) {
                auditData = json;
            } else {
                auditErrorTitle = json.error || 'Audit Failed';
                auditErrorMessage = json.message || 'The layout could not be verified.';
            }
        } catch(e) {
            auditErrorTitle = 'Network Error';
            auditErrorMessage = 'Could not reach the server.';
        } finally {
            isAuditing = false;
            if (auditFileInput) auditFileInput.value = '';
            if (!auditData && !auditErrorTitle) auditModal.close();
        }
    }

    function handlePolySelect(e: CustomEvent<number>) {
        activePolyIdx = e.detail;
        actionSheet.show();
    }

    $: allTrayBankEntities = [
        ...(data.item?.children || []).map((c: any) => ({ id: c.id, type: 'container' as const, name: c.name, hasMap: !!c.spatialMap })),
        ...(data.mappedItems || []).map((loc: any) => ({ id: loc.item.id, type: 'item' as const, name: loc.item.title, hasMap: true })),
        ...(data.unmappedItems || []).map((loc: any) => ({ id: loc.item.id, type: 'item' as const, name: loc.item.title, hasMap: false }))
    ].sort((a, b) => {
        if (a.hasMap === b.hasMap) return a.name.localeCompare(b.name);
        return a.hasMap ? 1 : -1;
    });

    async function handleAssign(e: CustomEvent) {
        const { polygonIndex, polygon, entity } = e.detail;
        try {
            const res = await fetch('/api/spatial-assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentContainerId: data.item?.id, entity, polygon })
            });
            if (res.ok) { notify('success', `Mapped ${entity.name}`); invalidateAll(); }
            else { notify('error', 'Failed to map entity.'); }
        } catch (err) { notify('error', 'Network error.'); }
    }

    // Calculate tray breakdown
    $: childItemCount = data.items.filter(i => i.locations.some(l => l.container?.name !== data.item?.name)).length;
    $: directItemCount = data.items.length - childItemCount;

    $: combinedOutbox = [...$outboxStore, ...$completedOutboxStore].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
    $: ghostQuickCreates = combinedOutbox.filter(job => job.endpoint === '/api/spatial-quick-create');

    $: mappedEntities = polygons.map(poly => {
        const polyStr = JSON.stringify(poly);
        
        for (const ghost of ghostQuickCreates) {
            const fdData = ghost.payload as Record<string, any>;
            const ghostContainerId = Array.isArray(fdData.parentContainerId) ? fdData.parentContainerId[0] : fdData.parentContainerId;
            if (ghostContainerId && Number(ghostContainerId) === data.item?.id) {
                const ghostPoly = Array.isArray(fdData.polygon) ? fdData.polygon[0] : fdData.polygon;
                if (ghostPoly === polyStr) {
                    const title = Array.isArray(fdData.title) ? fdData.title[0] : fdData.title;
                    const imgPath = Array.isArray(fdData.parentImagePath) ? fdData.parentImagePath[0] : fdData.parentImagePath;
                    const cat = Array.isArray(fdData.categoryName) ? fdData.categoryName[0] : fdData.categoryName;
                    return { 
                        type: 'item', name: title, title: title, spatialMapRaw: ghostPoly, isGhost: true,
                        thumbPath: imgPath,
                        locationName: data.item?.name,
                        categoryName: cat || 'Processing...',
                        locations: [{ spatialMap: ghostPoly, container: { photoPath: imgPath, parent: {} } }]
                    };
                }
            }
        }

        for (const loc of (data.mappedItems || [])) {
                if (!loc.spatialMap) continue;
                try {
                    const parsed = JSON.parse(loc.spatialMap);
                    const p = Array.isArray(parsed) ? parsed : parsed.polygon;
                    if (JSON.stringify(p) === polyStr) return { ...loc.item, type: 'item', spatialMapRaw: loc.spatialMap };
                } catch(e) {}
        }
        
        for (const child of (data.item?.children || [])) {
            if (!child.spatialMap) continue;
            try {
                const parsed = JSON.parse(child.spatialMap);
                const p = Array.isArray(parsed) ? parsed : parsed.polygon;
                if (JSON.stringify(p) === polyStr) return { ...child, type: 'container', spatialMapRaw: child.spatialMap };
            } catch(e) {}
        }

        return null;
    });
</script>

<article style="padding-bottom: 100px;" class="max-w-4xl mx-auto">

    <div class="mb-4 ml-2">
        <a href="/container" class="btn btn-sm btn-ghost text-gray-500 hover:text-primary"><i class="bi bi-arrow-left"></i> All Containers</a>
    </div>

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
                    {#if data.item?.parentId}
                        <ContainerBreadcrumbs containerId={data.item.id} containers={data.allContainers} />
                    {/if}                
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
                    <button class="btn btn-circle btn-ghost bg-base-100/50 backdrop-blur-md hover:bg-base-100 transition-colors" title="Move Container" on:click={() => moveModal.show(data.item)}>
                        <i class="bi bi-arrows-move text-lg"></i>
                    </button>
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
            {#if directItemCount > 0 && polygons.length === 0 && !showSpatialSetup}
                <div class="border border-dashed border-base-300 rounded-2xl p-6 text-center bg-base-50 flex flex-col items-center animate-fade-in mx-2 sm:mx-0 opacity-80 hover:opacity-100 transition-opacity">
                    <div class="w-12 h-12 bg-base-200/50 rounded-full flex items-center justify-center mb-3">
                        <i class="bi bi-grid-3x3 text-xl text-gray-400"></i>
                    </div>
                    <h3 class="font-bold text-lg mb-1 tracking-tight text-base-content/80">Spatial Map</h3>
                    <p class="text-xs text-gray-500 mb-4 max-w-xs leading-relaxed">Optionally trace compartments to track exactly where items are stored inside.</p>
                    <button class="btn btn-sm btn-outline border-base-300 rounded-xl" on:click={() => showSpatialSetup = true}>Create Map</button>
                </div>
            {:else}
                <div class="flex justify-between items-end px-2">
                    <h3 class="font-bold text-lg">Spatial Map</h3>
                    <div class="flex gap-2">
                        {#if isMapDirty}
                            <form method="POST" action="?/saveSpatialMap" class="m-0" use:enhance={() => {
                                return async ({ update }) => { 
                                    isMapDirty = false; 
                                    await update({ reset: false }); 
                                    const hasMapped = mappedEntities.some(e => e !== null);
                                    if (polygons.length > 0 && !hasMapped) {
                                        postSaveWizard.showModal();
                                    } else {
                                        initialPolygonsStr = JSON.stringify(polygons);
                                        notify('success', 'Map saved!'); 
                                    }
                                };
                            }}>
                                <input type="hidden" name="spatialMap" value={JSON.stringify({ polygons, warpMap: { cols: gridCols, rows: gridRows, corners: warpCorners }, renderAsGrid })}>
                                <button type="submit" class="btn btn-sm btn-success text-white rounded-xl shadow-sm"><i class="bi bi-check-lg"></i> Save Layout</button>
                            </form>
                        {/if}
                        {#if !isWarpMode}
                            {#if polygons.length === 0}
                                <button class="btn btn-sm btn-primary shadow-sm rounded-xl" on:click={triggerAiMapping} disabled={isMapping}>
                                    {#if isMapping}<span class="loading loading-spinner loading-xs"></span> Mapping...{:else}<i class="bi bi-stars"></i> Map Automatically{/if}
                                </button>
                                <button class="btn btn-sm btn-outline border-base-300 rounded-xl" on:click={() => { spatialMapRef?.enterWarpMode(); }}>
                                    <i class="bi bi-grid-3x3"></i> Draw Grid
                                </button>
                                {:else}
                                <div class="dropdown dropdown-end">
                                    <button tabindex="0" class="btn btn-circle btn-ghost bg-base-100/50 backdrop-blur-md border border-base-200 shadow-sm" aria-label="Map Options">
                                        <i class="bi bi-three-dots text-xl"></i>
                                    </button>
                                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                    <ul tabindex="0" class="dropdown-content z-50 p-2 shadow-2xl bg-base-100/95 backdrop-blur-xl border border-base-200 rounded-2xl w-64 mt-2 gap-1 menu">
                                        <li class="menu-title text-[10px] font-bold uppercase tracking-wider text-gray-400 pb-1">Automations</li>
                                        <li>
                                            <button class="font-medium text-base-content hover:text-primary" on:click={triggerDeepScan} disabled={isDeepScanning}>
                                                {#if isDeepScanning}<span class="loading loading-spinner loading-xs"></span>{:else}<i class="bi bi-stars text-primary text-lg opacity-80"></i> Auto-Detect Contents{/if}
                                            </button>
                                        </li>
                                        <li>
                                            <button class="font-medium text-base-content hover:text-secondary" on:click={() => auditFileInput.click()} disabled={isAuditing}>
                                                <i class="bi bi-camera text-secondary text-lg opacity-80"></i> Verify Contents
                                            </button>
                                        </li>
                                        <div class="divider my-0 h-[1px] bg-base-200"></div>
                                        <li class="menu-title text-[10px] font-bold uppercase tracking-wider text-gray-400 pb-1 pt-2">Display & Map</li>
                                        <li>
                                            <button class="font-medium text-base-content" on:click={() => { spatialMapRef?.enterWarpMode(); (document.activeElement)?.blur(); }}>
                                                <i class="bi bi-grid-3x3 text-lg opacity-70"></i> Adjust Grid Alignment
                                            </button>
                                        </li>
                                        <li>
                                            <label class="cursor-pointer flex items-center justify-between hover:bg-base-200/50 p-3 rounded-lg mt-1">
                                                <span class="font-medium text-sm flex items-center gap-2"><i class="bi bi-image text-lg opacity-70"></i> Hide Photo</span>
                                                <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={renderAsGrid} on:change={() => isMapDirty = true} />
                                            </label>
                                        </li>
                                        <div class="divider my-0 h-[1px] bg-base-200"></div>
                                        <li>
                                            <form method="POST" action="?/clearSpatialMap" class="m-0 p-0 block w-full" use:enhance={() => {
                                                return async ({ update }) => { 
                                                    polygons = []; 
                                                    isMapDirty = false; 
                                                    notify('success', 'Map cleared. Ready to start over.'); 
                                                    await update({ reset: false }); 
                                                };
                                            }}>
                                                <button class="w-full text-left font-medium text-error hover:bg-error/10 hover:text-error py-2 px-3 rounded-lg" on:click|preventDefault={(e) => { if(confirm('Clear the entire map and start over?')) e.currentTarget.closest('form').submit(); }}>
                                                    <i class="bi bi-trash text-lg opacity-80 mr-2"></i> Delete Map
                                                </button>
                                            </form>
                                        </li>
                                    </ul>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
                
                <div class="relative w-full rounded-[2rem] overflow-hidden">
                    <SpatialMap 
                        bind:this={spatialMapRef}
                        imageUrl={data.item.photoPath} 
                        bind:polygons 
                        mappedEntities={mappedEntities}
                        on:change={() => isMapDirty = JSON.stringify(polygons) !== initialPolygonsStr}
                        on:select={handlePolySelect}
                        on:assign={handleAssign}
                        bind:isWarpMode
                        bind:warpCols={gridCols}
                        bind:warpRows={gridRows}
                        bind:warpCorners={warpCorners}
                    />
                    {#if isMapping}
                        <div class="absolute inset-0 z-50 bg-base-100/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-[2rem] animate-fade-in">
                            <div class="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center shadow-inner mb-4">
                                <span class="loading loading-spinner loading-lg"></span>
                            </div>
                            <h3 class="font-bold text-2xl tracking-tight text-base-content">Tracing Compartments</h3>
                            <p class="text-sm text-gray-500 font-medium mt-2 max-w-xs text-center">Our vision model is extracting the walls and dimensions of your container.</p>
                        </div>
                    {/if}
                </div>
                {#if allTrayBankEntities.length > 0}
                    <div class="mt-2 animate-fade-in">
                        <TrayBank entities={allTrayBankEntities} />
                    </div>
                {/if}
            {/if}
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

<MoveContainerModal bind:this={moveModal} allContainers={data.allContainers} />

<!-- Unified Audit Modal -->
<dialog bind:this={auditModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close={() => { auditData = null; auditErrorTitle = null; }}>
    <div class="modal-box p-0 overflow-hidden w-11/12 max-w-5xl bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem] flex flex-col">
        {#if isAuditing}
            <div class="flex flex-col items-center justify-center py-20 px-6 text-center gap-6">
                <div class="relative w-32 h-32">
                    <div class="absolute inset-0 border-[4px] border-base-200 rounded-full"></div>
                    <div class="absolute inset-0 border-[4px] border-secondary rounded-full border-t-transparent animate-spin"></div>
                    <div class="absolute inset-0 border-[4px] border-primary rounded-full border-b-transparent animate-spin" style="animation-duration: 2s; animation-direction: reverse;"></div>
                    <i class="bi bi-camera absolute inset-0 flex items-center justify-center text-4xl text-primary animate-pulse"></i>
                </div>
                <div>
                    <h3 class="font-bold text-2xl tracking-tight text-base-content mb-2">Auditing Container</h3>
                    <p class="text-sm text-gray-500 font-medium max-w-xs mx-auto">Aligning grid, inspecting compartments, and verifying items against your Trove.</p>
                </div>
            </div>
        {:else if auditErrorTitle}
            <div class="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
                <ContentUnavailable type="error" icon="bi-exclamation-triangle" title={auditErrorTitle} message={auditErrorMessage || ''} actionLabel="Try Again" actionIcon="bi-camera" on:click={() => { auditErrorTitle = null; auditFileInput.click(); }} />
                <button class="btn btn-ghost mt-4 font-bold text-gray-500 hover:text-base-content" on:click={() => auditModal.close()}>Cancel</button>
            </div>
        {:else if auditData}
            <div class="flex items-center justify-between p-4 shrink-0 border-b border-base-200 bg-base-100">
                <div>
                    <h2 class="text-xl font-bold tracking-tight">Audit Results</h2>
                    <p class="text-xs text-gray-500">
                        <span class="text-success font-bold">{auditData.slots.filter(s => s.status === 'MATCH').length} Matched</span> •
                        <span class="text-error font-bold">{auditData.slots.filter(s => s.status === 'MISSING').length} Missing</span> •
                        <span class="text-warning font-bold">{auditData.slots.filter(s => s.status === 'ANOMALY').length} Anomalies</span>
                    </p>
                </div>
                <button class="btn btn-sm btn-ghost btn-circle" on:click={() => auditModal.close()}><i class="bi bi-x-lg text-lg"></i></button>
            </div>
            
            {#if auditData.totalVisibleCount - auditData.slots.length > 0}
                 <div class="alert bg-info/10 border-info/30 text-info-content shadow-sm rounded-none border-x-0 border-t-0 flex items-start">
                     <i class="bi bi-info-circle-fill mt-0.5 text-info"></i>
                     <div>
                         <h3 class="font-bold text-sm text-info">Unmapped Slots Skipped</h3>
                         <p class="text-xs text-info/80">{auditData.totalVisibleCount - auditData.slots.length} compartments don't have items assigned in Troves yet.</p>
                     </div>
                 </div>
            {/if}
            
            <div class="flex-1 overflow-hidden p-2 sm:p-6 flex flex-col items-center bg-base-300 max-h-[70vh]">
                <div class="w-full max-w-4xl mx-auto h-full flex flex-col items-center justify-center">
                    <SpatialMap imageUrl={auditData.draftPath} auditSlots={auditData.slots} readonly={true} bind:activePolyIndex={activeAuditSlotIndex} on:selectAudit={(e) => { activeAuditSlotIndex = e.detail; auditResolutionSheet.showModal(); }} />
                </div>
            </div>
        {/if}
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<!-- Audit Resolution Drawer -->
<BottomSheet bind:this={auditResolutionSheet} title="Slot Details" on:close={() => activeAuditSlotIndex = null}>
    {#if activeAuditSlot}
        <div class="flex flex-col gap-4">
            <div class="flex items-center gap-4 bg-base-200/50 p-4 rounded-3xl border border-base-300">
                <div class="w-16 h-16 rounded-2xl overflow-hidden bg-base-300 shrink-0 flex items-center justify-center shadow-inner">
                    {#if activeAuditSlot.expectedItem?.thumbPath}
                         <img src={activeAuditSlot.expectedItem.thumbPath} class="w-full h-full object-cover" alt="Item Thumbnail" />
                    {:else}
                         <i class="bi bi-box-seam text-2xl text-gray-400"></i>
                    {/if}
                </div>
                <div class="flex flex-col min-w-0">
                     <span class="text-[10px] font-bold uppercase tracking-wider mb-0.5">
                         {#if activeAuditSlot.status === 'MATCH'} <span class="text-success"><i class="bi bi-check-circle-fill"></i> Verified Present</span>
                         {:else if activeAuditSlot.status === 'MISSING'} <span class="text-error"><i class="bi bi-x-circle-fill"></i> Missing Item</span>
                         {:else} <span class="text-warning"><i class="bi bi-exclamation-circle-fill"></i> Unexpected Item</span> {/if}
                     </span>
                     <span class="font-bold text-lg leading-tight truncate text-base-content">{activeAuditSlot.expectedItem?.title || 'Empty Slot'}</span>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                {#if activeAuditSlot.status === 'MATCH' && activeAuditSlot.expectedItem}
                    <div class="bg-base-200/50 p-4 rounded-3xl border border-base-300 flex flex-col gap-2 mt-2">
                        <h4 class="font-bold text-sm text-base-content/70 uppercase tracking-wider">Volume & Fill</h4>
                        <div class="grid grid-cols-2 gap-2">
                            <div class="bg-base-100 rounded-2xl p-3 border border-base-200 shadow-sm">
                                <div class="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-0.5">Expected Fill</div>
                                <div class="font-bold text-sm">{activeAuditSlot.expectedFillStatus ? activeAuditSlot.expectedFillStatus.replace('_', ' ') : 'Not set'}</div>
                            </div>
                            <div class="bg-base-100 rounded-2xl p-3 border border-base-200 shadow-sm">
                                <div class="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-0.5">Detected Fill</div>
                                <div class="font-bold text-sm {activeAuditSlot.fill_status === activeAuditSlot.expectedFillStatus ? 'text-success' : (activeAuditSlot.expectedFillStatus ? 'text-warning' : 'text-primary')}">{activeAuditSlot.fill_status ? activeAuditSlot.fill_status.replace('_', ' ') : 'Unknown'}</div>
                            </div>
                        </div>
                        {#if activeAuditSlot.expectedItem.amount !== null}
                            <div class="text-xs text-gray-500 mt-1"><strong>Database Quantity:</strong> {activeAuditSlot.expectedItem.amount}</div>
                        {/if}
                        <div class="text-xs text-gray-500 mt-1"><strong>Note:</strong> To edit this item fully, finish your audit and return to the main inventory.</div>
                    </div>
                {:else if activeAuditSlot.status === 'ANOMALY'}
                    <ActionCard title="Accept New Reality" subtitle="Add '{activeAuditSlot.detectedTitle || 'Unknown'}' to database" icon="bi-plus-lg" iconColorClass="bg-warning/20 text-warning" variant="flat" buttonClass="border border-base-200 hover:border-warning rounded-2xl" on:click={() => { auditResolutionSheet.close(); notify('info', 'Routing to Add Screen... (Will be queued)'); }} />
                    {#if activeAuditSlot.expectedItem}
                        <ActionCard title="Mark Expected as Missing" subtitle="It's not here anymore" icon="bi-trash3" iconColorClass="bg-error/20 text-error" variant="flat" buttonClass="border border-base-200 hover:border-error rounded-2xl" on:click={() => { auditResolutionSheet.close(); notify('success', 'Marked as missing.'); }} />
                    {/if}
                {:else if activeAuditSlot.status === 'MISSING' && activeAuditSlot.expectedItem}
                    <form method="POST" action="/timeline?/capture" class="w-full" use:enhance={() => { return async ({ update }) => { notify('success', 'Added to Buy List'); auditResolutionSheet.close(); await update({ reset: false }); }; }}>
                        <input type="hidden" name="content" value="Need to find/replace: {activeAuditSlot.expectedItem.title}">
                        <input type="hidden" name="category" value="to buy">
                        <input type="hidden" name="linkedItemIds[]" value={activeAuditSlot.expectedItem.id}>
                        <ActionCard type="submit" title="Add to Buy List" subtitle="Track this missing item" icon="bi-cart-plus" iconColorClass="bg-error/20 text-error" variant="flat" buttonClass="border border-base-200 hover:border-error rounded-2xl" />
                    </form>
                {/if}
            </div>
        </div>
    {/if}
</BottomSheet>

<input type="file" bind:this={auditFileInput} accept="image/*" capture="environment" class="hidden" on:change={runAudit} />

<PolygonActionSheet 
    bind:this={actionSheet} 
    parentContainerId={data.item?.id} 
    parentImagePath={data.item?.photoPath}
    polygonIndex={activePolyIdx}
    polygonCoords={activePolyIdx !== null ? polygons[activePolyIdx] : null}
        mappedEntity={activePolyIdx !== null ? mappedEntities[activePolyIdx] : null}
        categories={data.categories}
        on:deleteSlot={(e) => { polygons.splice(e.detail, 1); polygons = [...polygons]; isMapDirty = true; activePolyIdx = null; }}
/>

<dialog bind:this={triageModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm">
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        {#if isDeepScanning}
            <div class="flex flex-col items-center justify-center py-20 px-6 text-center gap-6">
                <div class="relative w-32 h-32">
                    <div class="absolute inset-0 border-[4px] border-base-200 rounded-full"></div>
                    <div class="absolute inset-0 border-[4px] border-primary rounded-full border-t-transparent animate-spin"></div>
                    <div class="absolute inset-0 border-[4px] border-secondary rounded-full border-b-transparent animate-spin" style="animation-duration: 2s; animation-direction: reverse;"></div>
                    <i class="bi bi-magic absolute inset-0 flex items-center justify-center text-4xl text-primary animate-pulse"></i>
                </div>
                <div>
                    <h3 class="font-bold text-2xl tracking-tight text-base-content mb-2">Analyzing Compartments</h3>
                    <p class="text-sm text-gray-500 font-medium max-w-xs mx-auto">Scanning container and reading your labels...</p>
                    <p class="text-xs text-base-content/40 mt-3 font-semibold">This might take a few moments per compartment. Grab a coffee!</p>
                </div>
            </div>
        {:else if deepScanItems.length > 0 && deepScanItems[currentTriageIdx]}
            {@const currentItem = deepScanItems[currentTriageIdx]}
            {@const poly = polygons[currentItem.slotIndex]}
            <div class="p-4 border-b border-base-200 bg-base-200/30 flex flex-col gap-1">
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-lg"><i class="bi bi-robot text-primary mr-1"></i> Review Scanned Result</h3>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-ghost btn-xs text-gray-500" on:click={() => triggerDeepScan(true)} title="Force Rescan"><i class="bi bi-arrow-clockwise"></i></button>
                        <div class="badge badge-primary badge-outline font-bold">{currentTriageIdx + 1} of {deepScanItems.length}</div>
                    </div>
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
                
                {@const cx = (minX + maxX) / 2 / 10}
                {@const cy = (minY + maxY) / 2 / 10}
                {@const maxDim = Math.max(boxW, boxH)}
                {@const zoomFactor = Math.max(1, Math.min(6, 400 / maxDim))}
                
                <div class="w-full h-48 sm:h-64 bg-base-300 relative overflow-hidden">
                    
                    <!-- Minimap Abstract Context Overlay -->
                    <div class="absolute pointer-events-none transition-all duration-500 ease-out" style="width: {zoomFactor * 100}%; top: 50%; left: 50%; transform: translate(-{cx}%, -{cy}%);">
                        <img src={data.item?.photoPath} class="w-full h-auto block" alt="Slot View" />
                        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full">
                            <path d="M 0,0 L 1000,0 L 1000,1000 L 0,1000 Z M {poly[0].join(',')} L {poly[1].join(',')} L {poly[2].join(',')} L {poly[3].join(',')} Z" fill="rgba(0,0,0,0.6)" fill-rule="evenodd" />
                            <polygon points={poly.map(pt => pt.join(',')).join(' ')} class="fill-primary/10 stroke-primary" stroke-width="3" vector-effect="non-scaling-stroke" />
                        </svg>
                    </div>
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
                
                <div class="mt-2">
                    <FillStatusSlider bind:value={currentItem.fill_status} showHeader={false} />
                </div>

                <SpatialItemSettings bind:analyzeWithVision bind:removeBackground />

                <div class="flex gap-2 mt-4">
                    <button class="btn btn-ghost text-error hover:bg-error/10 flex-1 rounded-xl" on:click={nextTriageItem}>Skip</button>
                    <button class="btn btn-primary flex-[2] shadow-md rounded-xl" on:click={async () => {
                        const fd = new FormData();
                        fd.append('clientId', typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
                        fd.append('parentContainerId', String(data.item?.id));
                        fd.append('polygon', JSON.stringify(poly));
                        fd.append('parentImagePath', data.item?.photoPath);
                        fd.append('title', currentItem.title);
                        if (currentItem.description) fd.append('description', currentItem.description);
                        if (currentItem.fill_status) fd.append('fillStatus', currentItem.fill_status);
                        fd.append('skipVision', String(!analyzeWithVision));
                        fd.append('removeBackground', String(removeBackground));
                        await saveToQueue('/api/spatial-quick-create', fd);
                        window.dispatchEvent(new CustomEvent('outbox-trigger'));
                        notify('success', 'Added to Queue');
                        nextTriageItem();
                    }}>Accept & Next <i class="bi bi-arrow-right"></i></button>
                </div>
            </div>
        {/if}
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<ConfirmModal bind:this={confirmModal} />

<Modal bind:this={postSaveWizard} position="bottom" boxClass="p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
    <div class="flex flex-col items-center text-center gap-4 py-10 px-6">
        <div class="w-20 h-20 bg-success/10 text-success rounded-full flex items-center justify-center mb-2 shadow-inner">
            <i class="bi bi-grid-3x3-gap-fill text-4xl"></i>
        </div>
        <div>
            <h3 class="text-3xl font-bold tracking-tight text-base-content mb-3">Layout Saved</h3>
            <p class="text-gray-500 text-sm max-w-sm leading-relaxed">Your grid is ready. Would you like Troves to scan the compartments and automatically detect the items inside?</p>
        </div>
        
        <div class="flex flex-col gap-3 w-full max-w-xs mt-4">
            <button class="btn btn-primary rounded-2xl shadow-lg w-full text-base h-14" on:click={() => { postSaveWizard.close(); triggerDeepScan(); }}>
                <i class="bi bi-stars text-xl"></i> Auto-Detect Contents
            </button>
            <button class="btn btn-ghost rounded-2xl w-full text-gray-500 font-semibold h-12" on:click={() => { postSaveWizard.close(); notify('success', 'Ready for manual mapping.'); }}>
                I'll map them manually
            </button>
        </div>
    </div>
</Modal>
