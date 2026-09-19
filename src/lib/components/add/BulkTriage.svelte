<script lang="ts">
    import { flip } from 'svelte/animate';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { createEventDispatcher, onMount } from 'svelte';
    import pageTitle from '$lib/stores';
    import ContainerSelector from "$lib/components/ContainerSelector.svelte";
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import ContentUnavailable from "$lib/components/ContentUnavailable.svelte";
    import DuplicateResolution from "$lib/components/DuplicateResolution.svelte";
    import RelativeDate from "$lib/components/RelativeDate.svelte";
    import BottomSheet from "$lib/components/BottomSheet.svelte";
    import { ambientLocation } from '$lib/client/ambientContext';
    import { pluralize } from '$lib/client/utils';
	import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import { getCropStyles } from '$lib/shared/boundingBox';
    import { notify } from '$lib/client/notifications';

    export let isDirty = false;
    export let containers: any[] = [];
    export let categories: any[] = [];
    export let tags: any[] = [];
    void tags;
    const dispatch = createEventDispatcher();
    
   export async function processPastedFile(file: File) {
       // Trigger the exact same logic as if it was selected from gallery
       const dt = new DataTransfer();
       dt.items.add(file);
       if (fileInputGallery) {
           fileInputGallery.files = dt.files;
           fileInputGallery.dispatchEvent(new Event('change', { bubbles: true }));
       }
   }

    let fileInputCamera: HTMLInputElement;
    let fileInputGallery: HTMLInputElement;
    let isUploading = false;
    let isUploadingMessage = "";
    let uploadError = "";

    let draftPath = "";
    let draftNoteId: number | null = null;
    let collectionType = "";
    let items: any[] = [];
    let totalVisibleCount = 0;

    let selectedContainers: string[] = [...$ambientLocation];
    let globalCategory = "";
    let globalTags = "";
    let settingsExpanded = true;
	let collectionHint = "";
	let showHintInput = false;

    // Edit Modal State
    let editModal: BottomSheet;
    let editingIndex = -1;
    let editTitle = "";
    let editSubtitle = "";
    let lightbox: ImageLightbox;
	let confirmModal: ConfirmModal;

    pageTitle.set("Multi-Scan");

    onMount(() => {
        if (!collectionHint && $page.data.inventories) {
            const vault = $page.data.inventories.find((i: any) => i.id ===$page.data.activeInventoryId);
            if (vault) {
                // collectionHint = `${vault.description || ''}`.trim().substring(0, 100);
                // Yeah, turning off the hint for now ....
                collectionHint = "";
            }
        }
    });

    async function handleFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        uploadError = "";
        isUploading = true;
        isUploadingMessage = "Analyzing items...";
        dispatch('processingStart', { message: isUploadingMessage, taskId: 'bulk' });
        
        let wakeLock: any = null;
        try { if ('wakeLock' in navigator) wakeLock = await (navigator as any).wakeLock.request('screen'); } catch (err) {}

        const fd = new FormData();
        fd.append('file', file);
		if (collectionHint.trim()) fd.append('hint', collectionHint.trim());

        try {
            const res = await fetch('/api/analyze-multiscan', { method: 'POST', body: fd });

            let data;
            try { data = await res.json(); } catch (err) { data = null; }

            if (res.ok && data?.success) {
                draftPath = data.draftPath;
                draftNoteId = data.noteId;
                collectionType = data.collectionType;
                totalVisibleCount = data.totalVisibleCount || data.items.length;
                items = data.items.map((item: any, id: number) => {
                    let optedOut = false;
                    let resolution = null;
                    
                if (item._debugComparisons && item._debugComparisons.length > 0) {
                    console.groupCollapsed(`🔍 Multi-Scan Match Trace for: ${item.title}`);
                    item._debugComparisons.forEach((comp: any) => {
                        console.groupCollapsed(`Against DB Item: ${comp.dbTitle}`);
                        comp.trace.forEach((line: string) => console.log(line));
                        console.groupEnd();
                    });
                    console.groupEnd();
                }

                    if (item.isDuplicate) {
                        if (item.duplicateStrategy === 'AUTO_IGNORE') {
                            optedOut = true; resolution = 'ignore';
                        } else if (item.duplicateStrategy === 'AUTO_BUMP') {
                            resolution = 'merge';
                        } else {
                            resolution = 'prompt';
                        }
                        if (item.duplicateItemDetails?.debugTrace) {
                            console.group(`🔍 Match Trace for: ${item.title}`);
                            item.duplicateItemDetails.debugTrace.forEach((line: string) => console.log(line));
                            console.groupEnd();
                        }
                    }
                    return {
                        ...item,
                        id: id.toString(), // For keying flip animations
                        swipeOffset: 0,
                        isSwiping: false,
                        optedOut, resolution
                    };
                });

                // Pre-fill global category based on the most common item category detected
                const catCounts = items.reduce((acc, it) => {
                    const c = it.category?.toLowerCase() || '';
                    if (c) acc[c] = (acc[c] || 0) + 1;
                    return acc;
                }, {});

                // Only auto-fill the global category if the AI was unanimous.
                // If it's a mixed bag, leave it blank so we preserve the individual guesses.
                const uniqueCats = Object.keys(catCounts);
                globalCategory = uniqueCats.length === 1 ? uniqueCats[0] : '';
                isDirty = true;

            } else {
                uploadError = data?.error || "We couldn't process the image. Please try again.";
            }
        } catch (err) {
            uploadError = "Network connection lost. Please check your internet and try again.";
        } finally {
            isUploading = false;
            dispatch('processingComplete', { taskId: 'bulk', status: uploadError ? 'error' : 'success' });
            if (wakeLock) try { await wakeLock.release(); } catch (err) {}
        }
    }

    function toggleItem(id: string) {
        items = items.map(x => x.id === id ? { ...x, optedOut: !x.optedOut, swipeOffset: 0 } : x);
    }

    function openEdit(i: number) {
        editingIndex = i;
        editTitle = items[i].title;
        editSubtitle = items[i].subtitle;
        editModal.showModal();
    }
    
    function saveEdit() {
        if (editingIndex >= 0) {
            items[editingIndex].title = editTitle;
            items[editingIndex].subtitle = editSubtitle;
        }
        editModal.close();
    }

    let isSaving = false;

    $: activeItems = items.filter(i => !i.optedOut);
    $: discardedCount = items.length - activeItems.length;
    $: presentCategories = [...new Set(items.map(i => i.category || 'unknown'))];

    // Strictly flag ONLY items that lack a real title. A generic title like "Dress" is valid.
    const isCompletelyUnknown = (i: any) => !i.title || i.title.trim().toLowerCase() === 'unknown' || i.title.trim().toLowerCase() === 'unknown item';

    function toggleUnknowns() {
        const unknowns = items.filter(isCompletelyUnknown);
        if (unknowns.length === 0) return;
        const newState = !unknowns.every(i => i.optedOut);
        items = items.map(i => isCompletelyUnknown(i) ? { ...i, optedOut: newState, swipeOffset: 0 } : i);
    }

    function toggleCategory(cat: string) {
        const catItems = items.filter(i => (i.category || 'unknown') === cat);
        if (catItems.length === 0) return;
        const newState = !catItems.every(i => i.optedOut);
        items = items.map(i => (i.category || 'unknown') === cat ? { ...i, optedOut: newState, swipeOffset: 0 } : i);
    }

    async function saveCollection() {
        const vault = $page.data.inventories?.find((i: any) => i.id === $page.data.activeInventoryId);
        
        if (vault?.deepScanCollections && activeItems.length >= 20) {
            if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('troves_deepscan_confirmed')) {
                const proceed = await confirmModal.ask(
                    'Large Deep Scan', 
                    `You are saving ${activeItems.length} items with Deep Scan enabled. This will queue individual AI tasks for every item to extract fine details, which takes time and consumes API quota. Proceed?`, 
                    'Save & Analyze', 
                    'Cancel'
                );
                if (!proceed) return;
                
                sessionStorage.setItem('troves_deepscan_confirmed', 'true');
            }
        }

        if (selectedContainers.length === 0) {
			const res = await confirmModal.ask('No Location', "You haven't selected a location. Save these items without a location?", 'Save Anyway', 'Cancel');
			if (!res) {
                settingsExpanded = true;
                setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
                return;
            }
        }

        if (activeItems.length === 0) {
			notify('warning', "No items selected to save.");
            return;
        }

        isSaving = true;
        
        const res = await fetch('/api/bulk-save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inventoryId: $page.data.activeInventoryId,
                draftPath,
                noteId: draftNoteId,
                containers: selectedContainers,
                globalCategory,
                tagcsv: globalTags,
                items: activeItems.map(item => ({ title: item.title, subtitle: item.subtitle, description: item.description, category: item.category, box: item.box, extractedAttributes: item.extractedAttributes, physical_traits: item.physical_traits, prominent_text_or_graphic: item.prominent_text_or_graphic, distinctive_blemishes_or_wear: item.distinctive_blemishes_or_wear, color_mix: item.color_mix, resolution: item.resolution, duplicateItemDetails: item.duplicateItemDetails }))
            })
        });
        
        if (res.ok) {
            isDirty = false;
            await goto('/', { invalidateAll: true });
        } else {
			notify('error', "Failed to save.");
            isSaving = false;
        }
    }
</script>

<div class="max-w-md mx-auto w-full pt-2 pb-32 px-4">
    {#if uploadError}
        <ContentUnavailable 
            type="warning"
            icon="bi-robot"
            title="Analysis Interrupted" 
            message={uploadError} 
            actionLabel="Dismiss" 
            on:click={() => uploadError = ""} 
        />
    {:else if !draftPath}
        <div class="flex flex-col items-center justify-center p-6 text-center animate-fade-in mt-10">
            <div class="bg-primary/10 text-primary w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-sm">
                <i class="bi bi-collection text-4xl"></i>
            </div>
            <h2 class="text-2xl font-bold mb-3 tracking-tight">
                {#if $page.data.inventories}
                    Add to {$page.data.inventories.find(i => i.id ===$page.data.activeInventoryId)?.name || 'Trove'}
                {:else}
                    Multiple Items
                {/if}
            </h2>
            <p class="text-gray-500 mb-8 max-w-sm">Capture multiple books, games, whiskys, stamps, coins or CDs/DVDs in a single photo. Sky's the limit. We'll extract them all instantly.<br><br><strong>Tip:</strong> Keep the phone steady and ensure text is legible.</p>

			{#if !showHintInput}
				<button type="button" class="btn btn-ghost btn-sm text-gray-400 hover:text-primary mb-6 rounded-xl" on:click={() => showHintInput = true}>
					<i class="bi bi-lightbulb"></i> Add a hint
				</button>
			{:else}
				<div class="w-full max-w-sm mb-6 animate-fade-in text-left">
					<div class="flex justify-between items-center mb-1 px-1"><span class="text-[10px] font-semibold uppercase text-gray-500 tracking-wider">Optional Hint</span><button type="button" class="text-[10px] text-gray-400 hover:text-error uppercase tracking-wider font-bold" on:click={() => {showHintInput = false; collectionHint = "";}}>Remove</button></div>
					<input type="text" bind:value={collectionHint} placeholder="e.g. 'Games' 'Signs', or 'Books'" class="input input-bordered w-full rounded-2xl bg-base-100/50 focus:bg-base-100 transition-colors shadow-sm" />
				</div>
			{/if}

            {#if isUploading}
				<div class="btn btn-primary btn-lg w-full max-w-sm rounded-2xl opacity-80 cursor-not-allowed h-auto min-h-[4rem] py-3 flex flex-col justify-center leading-tight">
					<div class="flex items-center gap-3">
						<span class="loading loading-spinner shrink-0"></span> 
						<span class="whitespace-normal break-words">{isUploadingMessage}</span>
					</div>
                </div>
            {:else}
                <div class="flex gap-3 w-full max-w-sm justify-center">
                    <button type="button" class="btn btn-primary flex-1 shadow-lg rounded-2xl" on:click={() => fileInputCamera.click()}><i class="bi bi-camera text-xl"></i> Camera</button>
                    <button type="button" class="btn btn-secondary flex-1 shadow-lg rounded-2xl" on:click={() => fileInputGallery.click()}><i class="bi bi-images text-xl"></i> Gallery</button>
                </div>
            {/if}
            <input type="file" bind:this={fileInputCamera} accept="image/*" capture="environment" class="hidden" on:change={handleFileSelect} />
            <input type="file" bind:this={fileInputGallery} accept="image/*" class="hidden" on:change={handleFileSelect} />
        </div>
    {:else}
        <!-- Header -->
        <div class="mb-4 animate-fade-in bg-base-100/95 backdrop-blur-md sticky top-[60px] z-40 pt-3 pb-2 border-b border-base-200 shadow-sm -mx-4 px-4">
            <div class="flex justify-between items-end mb-1">
                <h2 class="text-2xl font-bold tracking-tight">Found {items.length} {collectionType || 'items'}</h2>
                <div class="text-right text-sm font-semibold tracking-tight pb-1">
                    <span class="text-success">{activeItems.length} Keep</span>
                    {#if discardedCount > 0}
                        <span class="text-gray-300 mx-1">•</span>
                        <span class="text-error">{discardedCount} Trash</span>
                    {/if}
                </div>
            </div>

            <!-- Quick Actions Bar -->
            <div class="flex flex-wrap items-center gap-2 mt-3 pb-2 text-sm">
                <span class="text-gray-500 font-semibold mr-1 whitespace-nowrap text-xs uppercase tracking-wider">Bulk Toggle:</span>
                {#if items.some(isCompletelyUnknown)}
                    {@const unknownItems = items.filter(isCompletelyUnknown)}
                    {@const allOut = unknownItems.every(i => i.optedOut)}
                    <button type="button" class="badge {allOut ? 'badge-success text-white border-transparent' : 'badge-warning'} gap-1 p-3 cursor-pointer whitespace-nowrap font-medium" on:click={toggleUnknowns}>
                        <i class="bi {allOut ? 'bi-arrow-counterclockwise' : 'bi-question-circle'}"></i> Unknown ({unknownItems.length})
                    </button>
                {/if}
                {#if items.some(i => i.isDuplicate && !i.optedOut)}
                    <button type="button" class="badge badge-error badge-outline gap-1 p-3 cursor-pointer whitespace-nowrap font-medium" on:click={() => {
                        items = items.map(i => i.isDuplicate ? { ...i, optedOut: true, resolution: 'ignore' } : i);
                    }}>
                        <i class="bi bi-trash3"></i> Trash All Duplicates
                    </button>
                {/if}
                {#each presentCategories as cat}
                    {@const catItems = items.filter(i => (i.category || 'unknown') === cat)}
                    {@const allOut = catItems.every(i => i.optedOut)}
                    <button type="button" class="badge {allOut ? 'badge-success text-white border-transparent' : 'badge-outline bg-base-100 hover:bg-error/10 hover:text-error hover:border-error/50'} gap-1 p-3 cursor-pointer whitespace-nowrap font-medium" on:click={() => toggleCategory(cat)}>
                        <i class="bi {allOut ? 'bi-arrow-counterclockwise' : 'bi-trash3'}"></i> All {pluralize(cat)} ({catItems.length})
                    </button>
                {/each}
            </div>
        </div>

        <!-- The Interactive List -->
        <div class="flex flex-col gap-0 pb-8">
            {#each items as item (item.id)}
                {@const styles = getCropStyles(item.box)}

                <div animate:flip={{duration: 250}} class="mb-4">
                    <!-- Swipe container - pan-y stops mobile Safari backwards nav! -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="relative w-full rounded-2xl {item.optedOut ? 'bg-success/90' : 'bg-error/90'} overflow-hidden shadow-sm" style="touch-action: pan-y;"
                     on:touchstart={(e) => { item.touchStartX = e.touches[0].clientX; item.isSwiping = true; }}
                     on:touchmove={(e) => { 
                         if (!item.isSwiping) return; 
                         const diff = e.touches[0].clientX - item.touchStartX; 
                         if (diff < 0) { item.swipeOffset = diff; items = items; } 
                     }}
                     on:touchend={(e) => { 
                         item.isSwiping = false; 
                         if (item.swipeOffset < -80) { 
                             toggleItem(item.id);
                             if (navigator.vibrate) navigator.vibrate(40);
                         }
                         item.swipeOffset = 0; items = items; 
                     }}
                >
                        <div class="absolute inset-y-0 right-0 flex items-center pr-6 text-white pointer-events-none">
                            <i class="bi {item.optedOut ? 'bi-arrow-counterclockwise' : 'bi-trash3-fill'} text-xl"></i>
                        </div>

                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div class="group flex items-center gap-4 bg-base-100 shadow-sm border border-base-200 p-3 rounded-2xl w-full select-none relative z-10 {item.optedOut ? 'opacity-40 grayscale' : 'hover:border-primary/30'}"
                            style="transform: translate3d({item.swipeOffset}px, 0, 0); transition: {item.isSwiping ? 'none' : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'};"
                            on:click={() => { 
                                if (Math.abs(item.swipeOffset) > 5) return;
                                if (item.optedOut) toggleItem(item.id);
                                else openEdit(items.indexOf(item)); 
                            }}
                            role="button" tabindex="0"
                        >
                            <!-- The Magic Zoom -->
                            <button type="button" class="relative w-16 h-20 overflow-hidden rounded-lg shrink-0 bg-base-300 border-none p-0 cursor-zoom-in flex items-center justify-center" on:click|stopPropagation={() => lightbox.open({ orgPath: draftPath, thumbPath: draftPath, showOriginal: true, box: item.box })}>
                                {#if styles}
                                    <div style={styles.wrapper}>
                                        <img src="{draftPath}" class="block" style={styles.image} alt="{item.title}" />
                                    </div>
                                {:else}
                                    <img src="{draftPath}" class="w-full h-full object-cover" alt="{item.title}" />
                                {/if}
                            </button>

                            <div class="flex-1 min-w-0 pr-2">
                                <div class="font-bold text-base text-base-content truncate {item.optedOut ? 'line-through' : ''}">{item.title}</div>
                                <div class="text-sm text-gray-500 truncate">{item.subtitle || 'Unknown Detail'}</div>
                                <div class="flex gap-2 mt-1">
                                    <span class="badge badge-ghost badge-sm text-[10px] uppercase font-bold border-base-300">{item.category}</span>
                                    {#if item.category && !categories.some(c => c.name.toLowerCase() === item.category.toLowerCase())}
                                        <span class="badge badge-warning badge-sm text-[10px] uppercase font-bold text-warning-content shadow-sm" title="This will create a new category"><i class="bi bi-stars mr-1"></i> New Category</span>
                                    {/if}
                                    {#if isCompletelyUnknown(item)}
                                        <span class="badge badge-warning badge-sm text-[10px] uppercase font-bold whitespace-nowrap" title="Missing all identifiable information"><i class="bi bi-question-circle mr-1"></i> Unknown</span>
                                    {/if}
                                </div>
                            </div>

                            <!-- Desktop Hover Delete/Restore Button -->
                            <button class="hidden md:flex btn btn-circle btn-ghost btn-sm transition-all z-10 {item.optedOut ? 'text-success hover:bg-success/10 opacity-100' : 'text-gray-300 hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100'}" 
                                    on:click|stopPropagation={() => toggleItem(item.id)} aria-label="Toggle item">
                                <i class="bi {item.optedOut ? 'bi-arrow-counterclockwise text-xl' : 'bi-trash3-fill'}"></i>
                            </button>
                            
                            <i class="bi bi-chevron-right text-gray-300 shrink-0 md:hidden pointer-events-none"></i>
                        </div>
                    </div>

                    {#if item.isDuplicate && !item.optedOut}
                        <div class="mt-2 mx-1 animate-fade-in">
                            <DuplicateResolution 
                                scannedTitle={item.title} 
                                matchDetails={item.duplicateItemDetails} 
                                currentAction={item.resolution} 
                                scannedItem={item}
                                on:resolve={(e) => { item.resolution = e.detail; item.optedOut = e.detail === 'ignore'; items = items; }}
                                on:zoom={(e) => lightbox.open({ orgPath: e.detail.orgPath || e.detail.thumbPath, showOriginal: true })}
                            />
                        </div>
                    {/if}
                </div>
            {/each}
        </div>

        <!-- Bulk Settings Accordion -->
        <div class="collapse collapse-arrow bg-base-200 mb-6 rounded-2xl border border-base-300 shadow-sm animate-fade-in">
            <input type="checkbox" bind:checked={settingsExpanded} /> 
            <div class="collapse-title font-bold flex items-center gap-3">
                <div class="bg-primary/20 text-primary w-8 h-8 rounded-full flex items-center justify-center shrink-0"><i class="bi bi-sliders"></i></div>
                Settings & Location
            </div>
            <div class="collapse-content flex flex-col gap-4">
                <div class="bg-base-100 rounded-xl p-1 border border-base-200">
                    <ContainerSelector 
                        containers={containers} 
                        values={selectedContainers.map(name => ({ container: { name } }))} 
                        on:change={(e) => { 
                            selectedContainers = e.detail.containers; 
                            ambientLocation.setContext(selectedContainers); 
                        }} 
                    />
                </div>
                
                <div>
                    <FormInput label="Apply a category for all" bind:value={globalCategory} placeholder="e.g. book, dvd, cd" inputClass="bg-base-100" />
                    {#if globalCategory && !categories.some(c => c.name.toLowerCase() === globalCategory.toLowerCase())}
                        <div class="label pt-1 pb-0"><span class="label-text-alt text-warning font-semibold"><i class="bi bi-exclamation-triangle"></i> New category will be created</span></div>
                    {/if}
                    {#if globalCategory && items.some(i => i.category && i.category.toLowerCase() !== globalCategory.toLowerCase())}
                        <div class="label pt-1 pb-0"><span class="label-text-alt text-error font-semibold"><i class="bi bi-exclamation-octagon"></i> Warning: This overwrites assigned categories (like "{items.find(i => i.category && i.category.toLowerCase() !== globalCategory.toLowerCase())?.category}") for all items!</span></div>
                    {/if}
                </div>
                
                <FormInput label="Apply tags for all" bind:value={globalTags} placeholder="e.g. donate, trash, read, living-room" hint="Comma separated" inputClass="bg-base-100" />
            </div>
        </div>

        <div class="p-4 bg-base-100 border border-base-200 mt-4 rounded-2xl shadow-sm mb-8">
            <button class="btn btn-primary btn-lg w-full max-w-md mx-auto block rounded-2xl shadow-lg" on:click={saveCollection} disabled={isSaving || activeItems.length === 0}>
                {#if isSaving}
                    <span class="loading loading-spinner"></span> Saving...
                {:else}
                    Save {activeItems.length} Item{activeItems.length === 1 ? '' : 's'}
                {/if}
            </button>
        </div>
    {/if}
</div>

<!-- Native Bottom Sheet Editor -->
<BottomSheet bind:this={editModal} title="Edit Item" on:close={() => editingIndex = -1}>
    <FormInput label="Title" bind:value={editTitle} class="mb-1" />
    <FormInput label="Subtitle" bind:value={editSubtitle} class="mb-2" />
    <div slot="actions" class="flex gap-2">
        <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={() => editModal.close()}>Cancel</button>
        <button type="button" class="btn btn-primary flex-1 rounded-xl shadow-md" on:click={saveEdit}>Save Changes</button>
    </div>
</BottomSheet>

<ConfirmModal bind:this={confirmModal} />

<ImageLightbox bind:this={lightbox} itemTitle="Multi-Scan" />
