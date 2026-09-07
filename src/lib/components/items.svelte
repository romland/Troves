<script context="module">
    import { writable } from 'svelte/store';
    export const sharedViewMode = writable(null);
</script>

<script lang="ts">
    import Alert from "$lib/components/alert.svelte";
    import type { Item } from "@prisma/client";
    import Delete from "./delete.svelte";
    import { navigating } from '$app/stores';
    import { goto } from '$app/navigation';
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import { outboxStore, completedOutboxStore } from "$lib/client/offlineQueue";
    import { flip } from 'svelte/animate';
    import { fade } from 'svelte/transition';
    import { browser } from '$app/environment';
    import ContentUnavailable from "$lib/components/ContentUnavailable.svelte";
    import { isSlowConnection } from '$lib/client/utils';
    import Badge from "$lib/components/Badge.svelte";

    export let items: any[] = [];
    export let brief: boolean = false;
    export let showControls: boolean = true;
    export let forceListView: boolean = false;

    const sortOptions = [
        { id: 'newest', label: 'Newest Added', icon: 'bi-sort-numeric-down-alt' },
        { id: 'oldest', label: 'Oldest Added', icon: 'bi-sort-numeric-down' },
        { id: 'name_asc', label: 'Name (A-Z)', icon: 'bi-sort-alpha-down' },
        { id: 'name_desc', label: 'Name (Z-A)', icon: 'bi-sort-alpha-down-alt' },
        { id: 'updated', label: 'Recently Updated', icon: 'bi-clock-history' },
        { id: 'dust', label: 'Dust Collectors', icon: 'bi-hourglass-bottom' },
        { id: 'amount_asc', label: 'Quantity (Low-High)', icon: 'bi-sort-numeric-down' },
        { id: 'amount_desc', label: 'Quantity (High-Low)', icon: 'bi-sort-numeric-down-alt' }
    ];
    $: activeSort = $page.url.searchParams.get('sort') || $page.data.activeSort || 'newest';
    $: activeSortLabel = sortOptions.find(o => o.id === activeSort)?.label || 'Newest Added';

    $: {
        console.log(`[DEBUG-SORT] Reactivity triggered. URL sort: ${$page.url.searchParams.get('sort')}, DB Sort: ${$page.data.activeSort}, Active: ${activeSort}`);
    }

    function applySort(sortId: string) {
        console.log(`[DEBUG-SORT] 1. applySort() called with: ${sortId}`);
        const url = new URL($page.url);
        url.searchParams.set('sort', sortId);
        
        console.log(`[DEBUG-SORT] 2. Firing goto: ${url.toString()}`);
        goto(url.toString(), { noScroll: true });
        console.log(`[DEBUG-SORT] 3. goto dispatched.`);
        
		try {
            console.log(`[DEBUG-SORT] 4. Parsing preferences...`);
			const currentPrefs = JSON.parse($page.data.user?.preferences || '{}');
			if (!currentPrefs.defaultSorts) currentPrefs.defaultSorts = {};
			if (currentPrefs.defaultSorts[$page.data.activeInventoryId] !== sortId) {
                console.log(`[DEBUG-SORT] 5. Pref mismatch detected. Updating from ${currentPrefs.defaultSorts[$page.data.activeInventoryId]} to ${sortId}`);
				currentPrefs.defaultSorts[$page.data.activeInventoryId] = sortId;
				const fd = new FormData();
				fd.append('preferences', JSON.stringify(currentPrefs));
                console.log(`[DEBUG-SORT] 6. Executing fetch to /profile?/updatePreferences`);
				fetch('/profile?/updatePreferences', {
					method: 'POST',
					body: fd,
					headers: { 'x-sveltekit-action': 'true' }
				}).then(async (res) => {
                    console.log(`[DEBUG-SORT] 7. Fetch resolved. Status: ${res.status}`);
                }).catch(err => {
                    console.error(`[DEBUG-SORT] X. Fetch threw error:`, err);
                });
			} else {
                console.log(`[DEBUG-SORT] 5. Prefs already match. Skipping fetch.`);
			}
		} catch (e) {
            console.error(`[DEBUG-SORT] X. Exception caught in applySort:`, e);
        }
    }

    function getFirstProductPhoto(item) {
        if (item?.photos?.length > 0) {
            const primary = item.photos.find((p) => p.type === "product" && p.isPrimary);
            if (primary) return primary;

            for (let i = 0; i < item.photos.length; i++) {
                if (item.photos[i].type === "product") {
                    return item.photos[i];
                }
            }
        }
        return { thumbPath: "", orgPath: "", showOriginal: false, classTrash: null };
    }

    function hasSummarizedDocuments(item) {
        if (!item?.documents) return false;
        for (let i = 0; i < item.documents.length; i++) {
            if (item.documents[i].summary !== null) {
                return true;
            }
        }
        return false;
    }

    let lightbox: ImageLightbox;

    // Sync server-side cookie state to prevent hydration flash
    // During SSR, always apply user's cookie to prevent leaking state between requests
    if (!browser || !$sharedViewMode) {
        $sharedViewMode = $page.data.activeViewMode || 'list';
    }

    function toggleViewMode(mode: string) {
        $sharedViewMode = mode;
        document.cookie = `troves_viewmode_${$page.data.activeInventoryId}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }

    // --- Unified Reactive Projection ---
    const ghostUrls = new Map<string, string>();
    
    onDestroy(() => {
        ghostUrls.forEach(url => URL.revokeObjectURL(url));
    });

    let loadedUrls = new Set<string>();
    function markLoaded(url: string) {
        loadedUrls.add(url);
        loadedUrls = loadedUrls; // trigger Svelte reactivity
    }

    $: serverClientIds = new Set(items.map(i => i.clientId).filter(Boolean));
    
    // Deduplicate jobs to prevent keyed-each errors during the brief handoff from pending to completed
    $: combinedOutbox = [...$outboxStore, ...$completedOutboxStore].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
    
    $: ghostItems = combinedOutbox
        .filter(job => job.endpoint === '/add')
        .map(job => {
            const getVal = (key: string) => Array.isArray(job.payload[key]) ? job.payload[key][0] : job.payload[key];

            // Prevent ghosts from haunting the wrong troves
            const inventoryId = getVal('inventoryId');
            if (inventoryId && Number(inventoryId) !== $page.data.activeInventoryId) return null;

            const clientId = getVal('clientId');
            if (!clientId || serverClientIds.has(clientId)) return null;
            
            if (!ghostUrls.has(clientId)) {
                const fileObj = getVal('file.0') || getVal('file');
                if (fileObj && fileObj._isFile && fileObj.buffer) {
                    const blob = new Blob([fileObj.buffer], { type: fileObj.type });
                    ghostUrls.set(clientId, URL.createObjectURL(blob));
                }
            }
            
            return {
                id: 'ghost-' + clientId,
                clientId: clientId,
                title: getVal('title') || "Saving item...",
                description: getVal('description') || "",
                isGhost: true,
                status: job.status,
                photos: ghostUrls.has(clientId) ? [{ thumbPath: ghostUrls.get(clientId), orgPath: ghostUrls.get(clientId), type: 'product', showOriginal: false }] : [],
                locations: []
            };
        })
        .filter(Boolean);
        
    // Only prepend ghost items to the primary container to prevent duplicates on infinite scroll pages
    $: displayItems = showControls ? [...ghostItems, ...items] : [...items];

    // Detect if the user is actively filtering to show context-aware empty states
    $: hasActiveFilters = browser && Array.from($page.url.searchParams.keys()).some(k => !['sort', 'theme', 'c', 'page'].includes(k));

    const imgLoadStrategy = isSlowConnection() ? 'lazy' : 'eager';

</script>

{#if showControls}
    <div class="flex justify-between items-center mb-3 mt-1 gap-2">
        <div class="dropdown dropdown-bottom">
            <button tabindex="0" class="btn btn-sm bg-base-200/60 border-base-300/50 shadow-sm font-medium text-base-content hover:bg-base-300 gap-1.5 sm:gap-2 rounded-lg h-8 min-h-0">
                <i class="bi bi-sort-down text-gray-500 text-lg"></i>
                <span class="hidden sm:inline"></span> {activeSortLabel}
                <i class="bi bi-chevron-down text-[10px] opacity-50 ml-0.5"></i>
            </button>
            <ul tabindex="0" class="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-xl w-56 border border-base-200 mt-2 gap-1">
                {#each sortOptions as opt}
                    <li>
                        <button type="button" class="flex justify-between items-center py-2.5 {activeSort === opt.id ? 'text-primary font-bold bg-primary/5' : 'text-base-content hover:bg-base-200'}" on:click={() => applySort(opt.id)}>
                            <span class="flex items-center gap-3"><i class="bi {opt.icon} opacity-60 text-lg"></i> {opt.label}</span>
                            {#if activeSort === opt.id}<i class="bi bi-check-lg text-lg"></i>{/if}
                        </button>
                    </li>
                {/each}
                </ul>
        </div>

        <div class="join bg-base-200/60 p-0.5 rounded-lg border border-base-300/60 shadow-sm">
            <button type="button" class="join-item btn btn-sm border-none shadow-none h-8 min-h-0 {$sharedViewMode === 'list' ? 'bg-base-100 text-base-content font-bold' : 'bg-transparent text-gray-500 hover:bg-base-300'}" on:click={() => toggleViewMode('list')} aria-label="List View"><i class="bi bi-list-ul text-lg"></i></button>
            <button type="button" class="join-item btn btn-sm border-none shadow-none h-8 min-h-0 {$sharedViewMode === 'grid' ? 'bg-base-100 text-base-content font-bold' : 'bg-transparent text-gray-500 hover:bg-base-300'}" on:click={() => toggleViewMode('grid')} aria-label="Grid View"><i class="bi bi-grid text-lg"></i></button>
        </div>
    </div>
{/if}

{#if (!displayItems || displayItems.length === 0)}
    {#if showControls}
        <div class="py-12 border border-base-200/50 bg-base-100/50 rounded-3xl mt-4">
            <ContentUnavailable 
                type="default"
                icon={hasActiveFilters ? 'bi-search' : 'bi-box-seam'} 
                title={hasActiveFilters ? 'No Results Found' : 'It\'s empty in here'} 
                message={hasActiveFilters ? "Try adjusting your filters or search terms to find what you're looking for." : "Start digitizing your trove by adding your first item."}
                actionLabel={hasActiveFilters ? 'Clear Filters' : ''}
                actionIcon="bi-funnel"
                on:click={() => { if(hasActiveFilters) goto(window.location.pathname); }}
            />
        </div>
    {/if}
{:else}
    {#if $sharedViewMode === 'list' || forceListView}
        <div class="overflow-x-auto bg-base-100 border border-base-200 rounded-xl shadow-sm">
        <table class="table w-full">
            <tbody>
                {#each displayItems as item (item.clientId || item.id)}
                    <!-- 
                        Check if the URL we are waiting for starts with this item's ID.
                        This catches clicks on the image, the title, AND the edit button!
                    -->
                    {@const isNavigatingToThis = $navigating?.to?.url.pathname.startsWith(`/${item.id}/`)}
                    {@const mainPhoto = getFirstProductPhoto(item)}
                    {@const cols = mainPhoto.colors?.length > 2 ? Object.keys(JSON.parse(mainPhoto.colors)) : []}
                    {@const serverSrc = mainPhoto.showOriginal ? mainPhoto.orgPath?.replace(/\.[^/.]+(?=\?|$)/, '_org_thumb.webp') : (mainPhoto.thumbPath || mainPhoto.orgPath)}
                    {@const cb = mainPhoto.updatedAt ? '?v=' + new Date(mainPhoto.updatedAt).getTime() : ''}
                    {@const localBlob = item.clientId ? ghostUrls.get(item.clientId) : null}
                    {@const isLoaded = serverSrc ? loadedUrls.has(serverSrc) : false}

                    <tr animate:flip={{ duration: 300 }} in:fade={{ duration: 200 }} class="hover:bg-base-200/50 transition-all duration-200 border-b border-base-200/50 last:border-none relative {isNavigatingToThis ? 'opacity-50 pointer-events-none scale-[0.98]' : ''} {item.isGhost ? 'opacity-80 grayscale-[50%] pointer-events-none animate-pulse duration-1000' : ''}">
                       <td class="w-16 sm:w-20 min-w-[4rem] sm:min-w-[5rem] shrink-0 py-3">
                            <div class="flex items-center gap-3">
                                <div class="avatar">
                                   <div class="w-14 h-14 bg-base-100 rounded-2xl shadow-sm border border-base-200/60 overflow-hidden flex items-center justify-center relative z-0">
                                       {#if cols.length > 0}
                                           <div class="absolute inset-0 opacity-30 pointer-events-none" style="background: linear-gradient(135deg, {cols[0]}, {cols[1] || cols[0]});"></div>
                                       {/if}
                                       <a href="/{item.id}/{item.slug}" class="w-full h-full flex items-center justify-center bg-transparent relative z-10">
                                           <div class="relative w-full h-full flex items-center justify-center">
                                               {#if localBlob && !isLoaded}
													<img src={localBlob} class="absolute inset-0 object-contain w-full h-full p-1 rounded-xl z-0 opacity-80 animate-pulse transition-opacity duration-700" alt="Preview"/>
                                               {/if}
                                               {#if serverSrc}
                                                   <img class="object-contain w-full h-full p-1 rounded-xl drop-shadow-md relative z-10 transition-opacity duration-700 {localBlob && !isLoaded ? 'opacity-0' : 'opacity-100'}"
                                                        src="{serverSrc}{cb}"
                                                        loading={imgLoadStrategy}
                                                        on:load={() => markLoaded(serverSrc)}
                                                        on:error={(e) => { const target = e.currentTarget as HTMLImageElement; if (!target.dataset.fb) { target.dataset.fb = '1'; target.src = mainPhoto.orgPath || ''; } }} 
                                                        alt="{item.title || 'Item image'}"/>
                                               {:else if !localBlob}
                                                   <i class="bi bi-box text-2xl text-gray-300 relative z-10"></i>
                                               {/if}
                                           </div>
                                       </a>
                                   </div>
                                </div>
                            </div>
                        </td>

                        <td class="hidden sm:table-cell w-20 min-w-[5rem]">
                            <div class="flex flex-col gap-1 min-w-[4rem] relative z-20">
                                {#if item.locations}
                                    {#each item.locations as loc}
                                        <Badge color="ghost" size="sm" class="w-20 overflow-hidden shrink-0">
                                            <a href="/container/{encodeURIComponent(loc.container.name)}" class="truncate w-full text-center" title="{loc.container.name}">{loc.container.name}</a>
                                        </Badge>
                                    {/each}
                                {/if}
                            </div>
                        </td>

                        <td class="w-full relative max-w-[200px] sm:max-w-none">
                            {#if !item.isGhost}
                                <!-- Overlay Link: Restores right-click / middle-click while letting SvelteKit intercept normal clicks. Moved inside TD to fix iOS Safari bug where position:relative on TR is ignored -->
                                <a href="/{item.id}/{item.slug}" class="absolute inset-0 z-10" aria-label={item.title}></a>
                            {/if}
                            <div class="flex items-center gap-2">
                                <a class="text-base font-semibold" href="/{item.id}/{item.slug}">{item.title}</a>
                                {#if item.hasDuplicate}
                                    <span class="w-2.5 h-2.5 rounded-full bg-error shrink-0" title="Potential duplicate detected"></span>
                                {/if}
                                <!-- Show a loading spinner right next to the title while we wait -->
                                {#if isNavigatingToThis}
                                    <span class="loading loading-spinner loading-sm text-primary"></span>
                                {/if}
                                {#if item.photos?.some(p => !p.thumbPath && p.orgPath)}
                                    <span class="loading loading-dots loading-xs text-primary" title="Processing AI background tasks"></span>
                                {/if}
                                {#if item.isGhost}
                                    <span class="loading loading-ring loading-xs text-gray-400"></span>
                                    <span class="text-[10px] text-gray-500 uppercase tracking-wider font-bold ml-1">Syncing</span>
                                {/if}
                            </div>

                            <!-- MOBILE ONLY LOCATIONS -->
                            <div class="sm:hidden mt-1 flex flex-col gap-1.5 w-full">
                                {#if item.description && !brief}
                                    <div class="text-[11px] text-gray-500 line-clamp-1 leading-tight">{item.description}</div>
                                {/if}
                                <div class="flex flex-wrap gap-1 relative z-20">
                                    {#if item.locations}
                                        {#each item.locations as loc}
                                            <Badge color="ghost" class="text-[10px] px-1.5 py-0.5 h-auto whitespace-nowrap">
                                                <a href="/container/{encodeURIComponent(loc.container.name)}" class="truncate w-full text-center" title="{loc.container.name}">{loc.container.name}</a>
                                            </Badge>
                                        {/each}
                                    {/if}
                                </div>
                            </div>

                            {#if !brief}
                            <div class="hidden lg:block mt-1">
                                <div class="line-clamp-2 text-sm text-gray-500">
                                    {item.description}
                                </div>

                                <div class="hidden lg:flex pt-2 gap-2 flex-wrap items-center relative z-20">
                                    {#if item.tags}
                                        {#each item.tags as tag}
                                            <Badge color="ghost" size="sm">
                                                <a href="/tag/{tag.slug}">{tag.name}</a>
                                            </Badge>
                                        {/each}
                                    {/if}

                                    {#if item.documents && item.documents.length > 0}
                                        <Badge color="ghost" size="sm">
                                            <i class="bi bi-files"></i>
                                            {item.documents.length}
                                            {#if !hasSummarizedDocuments(item)}
                                                <span class="text-warning ml-1">TODO: Need summary!</span>
                                            {/if}
                                        </Badge>
                                    {/if}

                                    {#if mainPhoto.category?.name || mainPhoto.llmAnalysis}
                                        <span class="text-xs text-gray-400 capitalize">
                                            {mainPhoto.category?.name || JSON.parse(mainPhoto.llmAnalysis || '{}')?.subCategory || 'Unknown'}
                                        </span>
                                    {/if}
                                </div>
                            </div>
                            {/if}                        
                        </td>

                        {#if !brief}
                        <td class="whitespace-nowrap relative z-20">
                            <a href="/{item.id}/edit" title="Edit Item" class="text-gray-500 hover:text-primary">
                                <i class="bi bi-pencil-square"></i>
                            </a>
                        </td>
                        {/if}                        
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
    {:else}
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6 pb-4 px-2 sm:px-0">
            {#each displayItems as item (item.clientId || item.id)}
                {@const isNavigatingToThis = $navigating?.to?.url.pathname.startsWith(`/${item.id}/`)}
                {@const mainPhoto = getFirstProductPhoto(item)}
                {@const cols = mainPhoto.colors?.length > 2 ? Object.keys(JSON.parse(mainPhoto.colors)) : []}
                {@const serverSrc = mainPhoto.showOriginal ? mainPhoto.orgPath?.replace(/\.[^/.]+(?=\?|$)/, '_org_thumb.webp') : (mainPhoto.thumbPath || mainPhoto.orgPath)}
                {@const cb = mainPhoto.updatedAt ? '?v=' + new Date(mainPhoto.updatedAt).getTime() : ''}
                {@const localBlob = item.clientId ? ghostUrls.get(item.clientId) : null}
                {@const isLoaded = serverSrc ? loadedUrls.has(serverSrc) : false}
                
                <div animate:flip={{ duration: 300 }} in:fade={{ duration: 200 }} class="card group bg-base-100 shadow-sm border border-base-200 hover:border-primary/50 transition-all duration-200 relative flex flex-col h-full {isNavigatingToThis ? 'opacity-50 pointer-events-none scale-[0.98]' : ''} {item.isGhost ? 'opacity-80 grayscale-[50%] pointer-events-none animate-pulse duration-1000' : ''}">
                    <!-- Overlay Link: Restores right-click / middle-click while letting SvelteKit intercept normal clicks -->
                    {#if !item.isGhost}
                        <a href="/{item.id}/{item.slug}" class="absolute inset-0 z-10" aria-label={item.title}></a>
                    {/if}

                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <figure class="aspect-square bg-base-200/50 border-b border-base-200 p-2 relative z-20 cursor-pointer" on:click|stopPropagation={() => lightbox.open(mainPhoto)}>
						{#if $page.data.user && ($page.data.user.isAdmin || $page.data.role === 'EDITOR' || $page.data.role === 'OWNER')}
                            <a href="/{item.id}/edit" on:click|stopPropagation title="Edit Item" class="absolute top-2 left-2 z-40 w-7 h-7 rounded-full bg-base-100/40 backdrop-blur-md border border-base-200/50 shadow-sm hidden md:flex items-center justify-center text-base-content/60 hover:text-primary hover:bg-base-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200">
								<i class="bi bi-pencil-square text-xs"></i>
							</a>
						{/if}
                        {#if item.hasDuplicate}
                            <div class="absolute top-3 right-3 w-3 h-3 bg-error rounded-full border-2 border-base-100 shadow-sm z-10" title="Potential duplicate detected"></div>
                        {/if}
                        <div class="relative w-full h-full flex items-center justify-center rounded-lg overflow-hidden">
                            {#if cols.length > 0}
                                <div class="absolute inset-0 opacity-30 pointer-events-none" style="background: linear-gradient(135deg, {cols[0]}, {cols[1] || cols[0]});"></div>
                            {/if}
                            {#if localBlob && !isLoaded}
                                <img src={localBlob} class="absolute inset-0 object-contain w-full h-full rounded-lg mix-blend-multiply dark:mix-blend-normal z-0 opacity-80 animate-pulse transition-opacity duration-700" alt="Preview"/>
                            {/if}
                            {#if serverSrc}
                                <img class="absolute inset-0 object-contain w-full h-full rounded-lg mix-blend-multiply dark:mix-blend-normal z-10 drop-shadow-md transition-opacity duration-700 {localBlob && !isLoaded ? 'opacity-0' : 'opacity-100'}"
                                     src="{serverSrc}{cb}"
                                     loading={imgLoadStrategy}
                                     on:load={() => markLoaded(serverSrc)}
                                     on:error={(e) => { const target = e.currentTarget as HTMLImageElement; if (!target.dataset.fb) { target.dataset.fb = '1'; target.src = mainPhoto.orgPath || ''; } }} 
                                     alt="{item.title || 'Item image'}"/>
                            {:else if !localBlob}
                                <i class="bi bi-box text-4xl text-gray-300 relative z-10"></i>
                            {/if}
                        </div>
                        {#if isNavigatingToThis}
                            <div class="absolute inset-0 bg-base-100/50 flex items-center justify-center">
                                <span class="loading loading-spinner text-primary"></span>
                            </div>
                        {:else if item.photos?.some(p => !p.thumbPath && p.orgPath)}
                            <div class="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-secondary/10 animate-pulse flex items-center justify-center pointer-events-none z-20">
                                <div class="bg-base-100/90 px-3 py-1.5 rounded-full shadow-md border border-base-200/50">
                                    <span class="loading loading-dots loading-sm text-primary"></span>
                                </div>
                            </div>
                        {/if}
                        {#if item.isGhost}
                            <div class="absolute inset-0 bg-base-100/30 flex items-center justify-center backdrop-blur-[1px]">
                                <div class="bg-base-100 shadow-lg rounded-full px-3 py-1 flex items-center gap-2 border border-base-200">
                                    <span class="loading loading-ring loading-xs text-gray-500"></span>
                                    <span class="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Syncing</span>
                                </div>
                            </div>
                        {/if}
                    </figure>
                    <div class="card-body p-3 gap-1 flex-1 flex-col justify-start">
                        <h3 class="font-bold text-sm leading-tight line-clamp-2">{item.title}</h3>
                        <div class="flex flex-wrap gap-1 mt-1 relative z-20">
                            {#if item.locations}
                                {#each item.locations as loc}
                                    <Badge color="ghost" class="text-[10px] px-1.5 py-0.5 h-auto whitespace-nowrap truncate max-w-[80%]">
                                        {loc.container.name}
                                    </Badge>
                                {/each}
                            {/if}
                            {#if mainPhoto.category?.name || mainPhoto.llmAnalysis}
                                <Badge color="primary" variant="outline" class="text-[10px] px-1.5 py-0.5 h-auto whitespace-nowrap capitalize">
                                    {mainPhoto.category?.name || JSON.parse(mainPhoto.llmAnalysis || '{}')?.subCategory || 'Unknown'}
                                </Badge>
                            {/if}
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    <ImageLightbox bind:this={lightbox} />
{/if}