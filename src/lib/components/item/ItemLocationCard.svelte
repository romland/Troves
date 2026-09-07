<script lang="ts">
    import { enhance } from '$app/forms';
    import { notify } from '$lib/client/notifications';
    import ContainerSelector from '$lib/components/ContainerSelector.svelte';
    import { ambientLocation } from '$lib/client/ambientContext';
    import Modal from "$lib/components/Modal.svelte";

    export let item: any;
    export let canEdit: boolean = false;
    export let itemCategories: string[] = [];

    let moveModal: HTMLDialogElement;
    let isMoving = false;
    let globalContainers: any[] = [];
    let isLoadingContainers = false;

    let mapModal: Modal;
    let activeMapLoc: any = null;
    let activePolyMap: number[][] | null = null;

    async function openMoveModal() {
        if (!moveModal) return;
        moveModal.showModal();
        if (globalContainers.length === 0) {
            isLoadingContainers = true;
            try {
                const res = await fetch('/api/containers');
                if (res.ok) globalContainers = await res.json();
            } finally { isLoadingContainers = false; }
        }
    }

    async function quickMove(newContainer: string) {
        if (!item?.id) return;
        isMoving = true;
        try {
            const res = await fetch('/api/item', { 
                method: 'PATCH', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ itemId: item.id, newContainer }) 
            });
            if (res.ok) {
                notify('success', `Moved to ${newContainer}`);
				// Optimistic UI update to prevent the jarring page flash
				const newContData = globalContainers.find(c => c.name === newContainer) || { name: newContainer };
				item.locations = [{ container: newContData }];
				item = item; // Trigger Svelte reactivity
            } else notify('error', 'Failed to move item.');
        } catch (e) { notify('error', 'Network error.'); } 
        finally { isMoving = false; moveModal.close(); }
    }

    function openMapModal(loc: any) {
        activeMapLoc = loc;
        activePolyMap = loc.spatialMap ? JSON.parse(loc.spatialMap) : (loc.container?.spatialMap && loc.container.parentId ? JSON.parse(loc.container.spatialMap) : null);
        mapModal.showModal();
    }

</script>

<form id="incStockForm" method="POST" action="?/incStock" style="display: none;" use:enhance={() => {
    if (item.amount === null) item.amount = 1; else item.amount += 1;
    return async ({ update }) => { await update({ reset: false }); notify('success', 'Stock increased (+1)'); };
}}>
    <button id="incStockBtn" type="submit"></button>
</form>
<form id="decStockForm" method="POST" action="?/decStock" style="display: none;" use:enhance={() => {
    if (item.amount !== null && item.amount > 0) item.amount -= 1;
    return async ({ update }) => { await update({ reset: false }); notify('info', 'Stock decreased (-1)'); };
}}>
    <button id="decStockBtn" type="submit"></button>
</form>

<!-- MOBILE ONLY: Compact Side-by-Side Row -->
<div class="md:hidden bg-base-100 shadow-sm border border-base-200 rounded-xl p-3 flex flex-col gap-3">
    <div class="flex items-center gap-3">
        {#if item?.inventory?.trackQuantity}
        <div class="flex flex-col justify-center bg-base-200/60 px-2 py-2 rounded-xl text-center shrink-0 min-w-[4.5rem]">
            <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Stock</div>
            <div class="text-2xl font-bold leading-tight flex items-center justify-center gap-1 {item.amount === 0 ? 'opacity-50' : ''}">
                {#if canEdit}
                    <button class="btn btn-xs btn-ghost p-0 w-5 h-5 -ml-1" on:click={() => item.amount > 0 && document.getElementById('decStockBtn')?.click()} disabled={item.amount === 0}><i class="bi bi-dash"></i></button>
                {/if}
                <span>{item.amount !== null ? item.amount : '-'}</span>
                {#if canEdit}
                    <button class="btn btn-xs btn-ghost p-0 w-5 h-5 -mr-1" on:click={() => document.getElementById('incStockBtn')?.click()}><i class="bi bi-plus"></i></button>
                {/if}
            </div>
            {#if item.amount === 0 && item?.inventory?.enableNotebook}
                <form method="POST" action="/timeline?/capture" use:enhance={() => { return async ({ update }) => { notify('success', 'Added to Shopping List!'); await update({ reset: false }); }; }}>
                    <input type="hidden" name="content" value="Need to restock: {item.title}">
                    <input type="hidden" name="category" value="to buy">
                    <input type="hidden" name="linkedItemIds[]" value={item.id}>
                    <button type="submit" class="text-[9px] font-bold text-primary hover:bg-primary/20 bg-primary/10 rounded-full px-2 py-1 mt-1 transition-colors leading-tight block mx-auto whitespace-nowrap active:scale-95 transition-transform"><i class="bi bi-cart-plus"></i> Buy List</button>
                </form>
            {/if}
        </div>
        {/if}

        {#if item.locations?.[0]}
            {@const loc = item.locations[0]}
            {@const polyMap = loc.spatialMap ? JSON.parse(loc.spatialMap) : (loc.container?.spatialMap && loc.container.parentId ? JSON.parse(loc.container.spatialMap) : null)}
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_interactive_supports_focus -->
                <div class="w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-base-200 bg-base-50 flex items-center justify-center relative cursor-zoom-in hover:opacity-80 transition-opacity" on:click={() => openMapModal(loc)} role="button">
                    {#if polyMap && (loc.container.parent?.photoPath || loc.container?.photoPath)}
                        <div class="relative max-w-full max-h-full flex items-center justify-center">
                            <img class="block max-w-full max-h-full" src="{loc.container.parent?.photoPath ? loc.container.parent.photoPath.replace(/\.[^/.]+$/, '_thumb.webp') : loc.container.photoPath.replace(/\.[^/.]+$/, '_thumb.webp')}" alt="Container thumbnail" on:error={(e) => { if (!(e.currentTarget).dataset.fb) { (e.currentTarget).dataset.fb = '1'; (e.currentTarget).src = loc.container.parent?.photoPath || loc.container.photoPath; } }}/>
                            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full pointer-events-none drop-shadow-lg">
                                <polygon points={polyMap.map(p => p.join(',')).join(' ')} vector-effect="non-scaling-stroke" class="fill-primary/40 stroke-primary stroke-[3px] animate-pulse" />
                            </svg>
                        </div>
                    {:else if loc.container.parent?.photoPath || loc.container?.photoPath}
                        <img class="w-full h-full object-cover" src="{loc.container.parent?.photoPath ? loc.container.parent.photoPath.replace(/\.[^/.]+$/, '_thumb.webp') : loc.container.photoPath.replace(/\.[^/.]+$/, '_thumb.webp')}" alt="Container thumbnail" on:error={(e) => { if (!(e.currentTarget).dataset.fb) { (e.currentTarget).dataset.fb = '1'; (e.currentTarget).src = loc.container.parent?.photoPath || loc.container.photoPath; } }}/>
                    {:else}
                        <i class="bi bi-box-seam text-2xl text-gray-400"></i>
                    {/if}
                </div>
                <div class="flex flex-col justify-center min-w-0">
                    <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold leading-none mb-0.5">Location</div>
                    <a href="/container/{encodeURIComponent(loc.container.name)}" class="font-bold text-sm leading-tight truncate hover:text-primary hover:underline">{loc.container.name}</a>
                    <div class="text-xs text-gray-500 leading-snug line-clamp-1 mt-0.5">{loc.container?.parent?.description || loc.container?.description || 'No description'}</div>
                </div>
            </div>
        {:else}
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-dashed border-base-300 bg-base-50 flex items-center justify-center">
                    <i class="bi bi-pin-map text-2xl text-gray-400"></i>
                </div>
                <div class="flex flex-col justify-center min-w-0">
                    <div class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold leading-none mb-0.5">Location</div>
                    <div class="font-bold text-sm leading-tight truncate text-warning">Unassigned</div>
                    {#if canEdit}
                        <button class="text-[11px] font-bold text-primary hover:underline text-left mt-0.5 w-max shrink-0 whitespace-nowrap" on:click={openMoveModal}>+ Assign</button>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    {#if item.locations?.length > 1 || item.reason}
        <div class="divider m-0 h-0"></div>
        <div class="flex flex-col gap-1.5 text-xs">
            {#if item.reason}<div><span class="font-semibold text-gray-500 uppercase">Reason:</span> {item.reason}</div>{/if}
            {#if item.locations?.length > 1}
                <div class="text-gray-500 font-semibold uppercase text-[10px] mt-0.5">Other Locations:</div>
                <div class="flex flex-wrap gap-1">
                    {#each item.locations.slice(1) as loc}
                        <a href="/container/{encodeURIComponent(loc.container.name)}" class="badge badge-ghost badge-sm hover:border-primary hover:text-primary transition-colors">{loc.container.name}</a>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>

<!-- DESKTOP ONLY: Stacked Layout -->
<div class="hidden md:flex flex-col gap-4">
    {#if item?.inventory?.trackQuantity}
    <div class="stats shadow w-full">
        <div class="stat">
            <div class="stat-title"><span class="text-xs">Stock</span></div>
            <div class="stat-value text-secondary flex items-center gap-2 {item.amount === 0 ? 'opacity-50' : ''}">
                {#if canEdit}
                    <button class="btn btn-sm btn-ghost p-0 w-8 h-8" on:click={() => item.amount > 0 && document.getElementById('decStockBtn')?.click()} disabled={item.amount === 0}><i class="bi bi-dash"></i></button>
                {/if}
                <span>{#if item.amount !== null}{item.amount}{:else}-{/if}</span>
                {#if canEdit}
                    <button class="btn btn-sm btn-ghost p-0 w-8 h-8" on:click={() => document.getElementById('incStockBtn')?.click()}><i class="bi bi-plus"></i></button>
                {/if}
            </div>
            <div class="stat-desc mt-1 h-5">
                {#if item.amount === 0 && item?.inventory?.enableNotebook}
                    <form method="POST" action="/timeline?/capture" class="flex items-center gap-2" use:enhance={() => { return async ({ update }) => { notify('success', 'Added to Shopping List!'); await update({ reset: false }); }; }}>
                        <span class="text-error/80 font-medium">Out of stock</span>
                        <input type="hidden" name="content" value="Need to restock: {item.title}">
                        <input type="hidden" name="category" value="to buy">
                        <input type="hidden" name="linkedItemIds[]" value={item.id}>
                        <button type="submit" class="text-[10px] font-bold text-primary hover:bg-primary/20 bg-primary/10 rounded-full px-2 py-0.5 transition-colors active:scale-95 transition-transform"><i class="bi bi-cart-plus"></i> Add to list</button>
                    </form>
                {:else}
                    &nbsp;
                {/if}
            </div>
        </div>
    </div>
    {/if}

    {#if !item.locations || item.locations.length === 0}
        <div class="card bg-base-100 shadow-sm border border-dashed border-base-300 w-full overflow-hidden">
            <figure class="w-full h-20 border-b border-dashed border-base-300 bg-base-50 m-0 flex items-center justify-center">
                <i class="bi bi-pin-map text-4xl text-gray-400"></i>
            </figure>
            <div class="card-body p-4 gap-1 relative">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Location</div>
                        <div class="card-title text-lg m-0 text-warning leading-none">Unassigned</div>
                    </div>
                    {#if canEdit}
                        <button class="btn btn-sm btn-outline border-base-300 rounded-xl hover:border-primary text-xs shrink-0 whitespace-nowrap" on:click={openMoveModal}>
                            <i class="bi bi-pin-map-fill"></i> Assign
                        </button>
                    {/if}
                </div>
                <p class="text-sm text-gray-500 m-0 mt-1">This does not have a home.</p>
            </div>
        </div>
    {/if}

    {#each item.locations || [] as loc, i}
        <div class="card bg-base-100 shadow-sm border border-base-200 w-full overflow-hidden">
            {#if i === 0}
                {@const polyMap = loc.spatialMap ? JSON.parse(loc.spatialMap) : (loc.container?.spatialMap && loc.container.parentId ? JSON.parse(loc.container.spatialMap) : null)}
                <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_interactive_supports_focus -->
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <figure class="w-full h-20 border-b border-base-200 bg-base-200 m-0 flex items-center justify-center cursor-zoom-in hover:opacity-80 transition-opacity" on:click={() => openMapModal(loc)} role="button">
                    {#if polyMap && (loc.container.parent?.photoPath || loc.container?.photoPath)}
                        <div class="relative max-w-full max-h-full flex items-center justify-center">
                            <img class="block max-w-full max-h-full" src="{loc.container.parent?.photoPath ? loc.container.parent.photoPath.replace(/\.[^/.]+$/, '_thumb.webp') : loc.container.photoPath.replace(/\.[^/.]+$/, '_thumb.webp')}" alt="Container thumbnail" on:error={(e) => { if (!(e.currentTarget).dataset.fb) { (e.currentTarget).dataset.fb = '1'; (e.currentTarget).src = loc.container.parent?.photoPath || loc.container.photoPath; } }}/>
                            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full pointer-events-none drop-shadow-lg">
                                <polygon points={polyMap.map(p => p.join(',')).join(' ')} vector-effect="non-scaling-stroke" class="fill-primary/40 stroke-primary stroke-[3px] animate-pulse" />
                            </svg>
                        </div>
                    {:else if loc.container.parent?.photoPath || loc.container?.photoPath}
                        <img class="w-full h-full object-cover" src="{loc.container.parent?.photoPath ? loc.container.parent.photoPath.replace(/\.[^/.]+$/, '_thumb.webp') : loc.container.photoPath.replace(/\.[^/.]+$/, '_thumb.webp')}" alt="Container thumbnail" on:error={(e) => { if (!(e.currentTarget).dataset.fb) { (e.currentTarget).dataset.fb = '1'; (e.currentTarget).src = loc.container.parent?.photoPath || loc.container.photoPath; } }}/>
                    {:else}
                        <div class="w-full h-full flex items-center justify-center"><i class="bi bi-box-seam text-4xl text-gray-400"></i></div>
                    {/if}
                </figure>
            {/if}
            <div class="card-body p-4 gap-1 relative">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="text-xs text-gray-500 uppercase tracking-wider font-semibold">Location {i > 0 ? `#${i+1}` : ''}</div>
                        <a href="/container/{encodeURIComponent(loc.container.name)}" class="card-title text-lg m-0 hover:text-primary hover:underline w-max">{loc.container.name}</a>
                    </div>
                    <button class="btn btn-sm btn-outline border-base-300 rounded-xl hover:border-primary text-xs" on:click={openMoveModal}>
                        <i class="bi bi-arrows-move"></i> Move it
                    </button>
                </div>
                <p class="text-sm text-gray-600 m-0">{loc.container?.parent?.description || loc.container?.description || 'No description'}</p>
            </div>
        </div>
    {/each}

    {#if item.reason}
        <div class="mb-3 text-sm">Reason: {item.reason}<br/></div>
    {/if}
</div>

<!-- Tags & Categories -->
{#if (item?.tags && item.tags.length > 0) || itemCategories.length > 0}
    <div class="flex flex-wrap justify-start gap-2 mt-4 md:mt-1">
        {#each itemCategories as cat}
            <div class="badge badge-primary badge-outline badge-sm shadow-sm">
                <a href="/search?category={encodeURIComponent(cat)}">{cat}</a>
            </div>
        {/each}
        {#each item?.tags || [] as tag}
            <div class="badge badge-ghost badge-sm hover:border-primary hover:text-primary transition-colors">
                <a href="/tag/{tag.slug}">{tag.name}</a>
            </div>
        {/each}
    </div>
{/if}

<dialog bind:this={moveModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm">
    <div class="modal-box p-4 bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        <h3 class="font-bold text-xl mb-1 flex items-center gap-2"><i class="bi bi-arrows-move text-primary"></i> Move Item</h3>
        <p class="text-xs text-gray-500 mb-4">Select the new container for this item.</p>
        {#if isLoadingContainers}
            <div class="flex justify-center p-8"><span class="loading loading-spinner text-primary"></span></div>
        {:else}
            <ContainerSelector containers={globalContainers} defaultTab="select" on:change={(e) => { if (e.detail.containers.length > 0) quickMove(e.detail.containers[0]); }} />
        {/if}
    </div>
    <form method="dialog" class="modal-backdrop"><button disabled={isMoving}>close</button></form>
</dialog>

<Modal bind:this={mapModal} title="" position="bottom" boxClass="p-0 overflow-hidden bg-base-100 shadow-2xl sm:rounded-[2.5rem] border border-base-200">
    {#if activeMapLoc}
        <div class="relative w-full h-[50vh] sm:h-[60vh] bg-base-300 flex items-center justify-center border-b border-base-200 p-2 sm:p-4">
            {#if activeMapLoc.container.parent?.photoPath || activeMapLoc.container?.photoPath}
                <div class="relative max-w-full max-h-full flex items-center justify-center">
                    <img src={activeMapLoc.container.parent?.photoPath || activeMapLoc.container?.photoPath} class="block max-w-full max-h-full drop-shadow-md" alt="Container" />
                    {#if activePolyMap}
                        {@const cx = (activePolyMap[0][0] + activePolyMap[1][0] + activePolyMap[2][0] + activePolyMap[3][0]) / 4}
                        {@const cy = (activePolyMap[0][1] + activePolyMap[1][1] + activePolyMap[2][1] + activePolyMap[3][1]) / 4}
                        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full z-10 pointer-events-none drop-shadow-lg">
                            <polygon points={activePolyMap.map(p => p.join(',')).join(' ')} class="fill-primary/40 stroke-primary stroke-[6px] animate-pulse" vector-effect="non-scaling-stroke" />
                            <text x={cx} y={cy} font-family="sans-serif" font-weight="900" font-size="40" fill="white" stroke="rgba(0,0,0,0.8)" stroke-width="8" paint-order="stroke fill" text-anchor="middle" dominant-baseline="middle" class="drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">{item.title}</text>
                        </svg>
                    {/if}
                </div>
            {:else}
                <i class="bi bi-box-seam text-6xl text-gray-400"></i>
            {/if}
        </div>
        <div class="p-6 bg-base-100 flex flex-col items-center text-center gap-1">
            <h3 class="font-bold text-xl">{activeMapLoc.container.name}</h3>
            {#if activeMapLoc.container.description || activeMapLoc.container.parent?.description}
                <p class="text-sm text-gray-500">{activeMapLoc.container.description || activeMapLoc.container.parent?.description}</p>
            {/if}
            <button class="btn btn-neutral w-full rounded-xl mt-4" on:click={() => mapModal.close()}>Close</button>
        </div>
    {/if}
</Modal>
