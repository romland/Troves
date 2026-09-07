<!-- src/lib/components/ItemHub.svelte -->
<script lang="ts">
    import MediaHub from "$lib/components/add/MediaHub.svelte";
    import ContainerSelector from "$lib/components/ContainerSelector.svelte";
    import QRurlScanner from "$lib/components/QRurlScanner.svelte";
    import AttributeAdder from "$lib/components/AttributeAdder.svelte";
    import ItemMiniCard from "$lib/components/ItemMiniCard.svelte";
    import DocumentList from "$lib/components/search/DocumentList.svelte";
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import DocumentLightbox from "$lib/components/DocumentLightbox.svelte";
    import RelativeDate from "$lib/components/RelativeDate.svelte";
    import { photoTypes } from "$lib/shared/constants";
    import ActionCard from "$lib/components/ActionCard.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import Modal from "$lib/components/Modal.svelte";
    import Badge from "$lib/components/Badge.svelte";
    import { marked } from 'marked';
    import { createEventDispatcher, onMount } from 'svelte';
    import { ambientLocation } from '$lib/client/ambientContext';
    import { page } from '$app/stores';

    const dispatch = createEventDispatcher();

    export let containers = [];
    export let item: any = null;
    export let saving = false;
    export let isDirty = false;
    export let mode: 'single' | 'rapid' = 'single';
    export let pastedDocCount = 0;

    onMount(() => {
        const handleTabShortcut = (e: any) => { activeView = e.detail; };
        window.addEventListener('shortcut:tab', handleTabShortcut);

        console.log("🛠️ [DEBUG AMBIENT] ItemHub Mounted. ambientLocation store is:", $ambientLocation);
        if (!item && selectedLocations.length > 0) {
            console.log("🛠️ [DEBUG AMBIENT] Hydrated selectedLocations from store:", selectedLocations);
            dispatch('success', `Location auto-set to ${selectedLocations.join(', ')}`);
        }
        return () => window.removeEventListener('shortcut:tab', handleTabShortcut);
    });

    // Expose a hard-reset function for continuous scanning workflows
    export function reset() {
        currentTitle = "";
        currentDescription = "";
        amount = "";
        reason = "";
        tagcsv = "";
        currentAttributes = [];
        deletedDocIds = [];
        refreshedDocIds = [];
        pendingPhotos = [];
        qrScannerCount = 0;
        pastedDocCount = 0;
        selectedLocations = [...$ambientLocation]; // Works here because reset() is always client-side
        currentDraftPath = "";
        isDuplicateWarning = false;
        duplicateDetails = null;
        duplicateDismissed = false;
        activeView = 'hub';
        isDirty = false;

        if (selectedLocations.length > 0) {
            dispatch('success', `Location auto-set to ${selectedLocations.join(', ')}`);
        }
    }

    export function triggerCamera() {
        const fileInputs = document.querySelectorAll('input[type="file"][name^="file."]');
        const fileInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
        const typeInputs = document.querySelectorAll('input[type="hidden"][name^="file.type."]');
        const typeInput = typeInputs[typeInputs.length - 1] as HTMLInputElement;
        if (fileInput && typeInput) {
            typeInput.value = 'product';
            fileInput.setAttribute('capture', 'environment');
            fileInput.click();
        }
    }

    // View state machine: 'hub', 'photos', 'location', 'links', 'details'
    let activeView = 'hub';
    $: defaultContainerMode = $page.data.inventories?.find((i: any) => i.id === $page.data.activeInventoryId)?.containerMode || 'scan';

    // State for the Hub Badges
    let photoCount = item?.photos?.length || 0;
    // Eagerly grab the ambient store value so the child component receives the correct initial prop
    let selectedLocations = item?.locations?.map(l => l.container?.name) || (item ? [] : [...$ambientLocation]);

    let qrScannerCount = 0;
    $: linkCount = (item?.documents?.length || 0) + qrScannerCount + pastedDocCount;

    let currentTitle = item?.title || "";
    let currentDescription = item?.description || "";
    let amount = item?.amount || "";
    let reason = item?.reason || "";
    let tagcsv = item?.tagcsv || "";
    let currentAttributes = item?.attributes ? [...item.attributes] : [];

    let isAnalyzing = false;
    let pendingPhotos: any[] = [];
    let showPreview = false;
    let currentDraftPath = "";
    let isDuplicateWarning = false;
    let duplicateDetails: any = null;
    let duplicateDismissed = false;
    let showNudgeTip = false;
    
    let deletedDocIds: number[] = [];
    let refreshedDocIds: number[] = [];

    // Dirty State Reactivity
    $: {
        let dirty = false;
        if (currentTitle !== (item?.title || "")) dirty = true;
        if (currentDescription !== (item?.description || "")) dirty = true;
        if (String(amount) !== String(item?.amount || "")) dirty = true;
        if (reason !== (item?.reason || "")) dirty = true;
        if (tagcsv !== (item?.tagcsv || "")) dirty = true;
        if (pendingPhotos.length > 0) dirty = true;
        if (qrScannerCount > 0) dirty = true;
        if (pastedDocCount > 0) dirty = true;
        if (deletedDocIds.length > 0) dirty = true;
        if (refreshedDocIds.length > 0) dirty = true;
        
        // FIX: If it's a new item, the baseline location is the ambient location, not an empty string.
        const initialLocations = item ? (item.locations?.map(l => l.container?.name).sort().join(',') || "") : [...$ambientLocation].sort().join(',');
        const currentLocs = [...selectedLocations].sort().join(',');
        if (initialLocations !== currentLocs) dirty = true;
        
        if (dirty) isDirty = true;
    }

    // Default draft preview logic
    $: previewImagePath = pendingPhotos.length > 0
        ? pendingPhotos[pendingPhotos.length - 1].localUrl 
        : item?.photos?.find(p => p.type === 'product')?.cropPath || item?.photos?.find(p => p.type === 'product')?.orgPath || "";

    $: serverImagePath = currentDraftPath 
        || item?.photos?.find(p => p.type === 'product')?.cropPath 
        || item?.photos?.find(p => p.type === 'product')?.orgPath 
        || "";

    let showAiDrawer = false;
    let userHint = "";
    let isRefining = false;
    let aiDialog: Modal;
    let lightbox: ImageLightbox;
    let docLightbox: DocumentLightbox;


    function handleAnalyzingStart(ev: any) {
        isAnalyzing = true;
    }

    function handleAnalyzingComplete(ev: any) {
        isAnalyzing = false;
        const data = ev.detail;
        if (data && data.draftPath) {
            currentDraftPath = data.draftPath;
        }        
        if (data && data.aiData) {
            if (data.aiData.isDuplicate && !item) {
                isDuplicateWarning = true;
                duplicateDetails = data.aiData.duplicateItemDetails;
                dispatch('notify', { status: 'warning', message: 'Potential duplicate detected in Trove!' });
                if (duplicateDetails.debugTrace) {
                    console.group(`🔍 Match Trace for: ${data.aiData.title}`);
                    duplicateDetails.debugTrace.forEach((line: string) => console.log(line));
                    console.groupEnd();
                }
            }
            let autofilled = false;
            if (!currentTitle && data.aiData.title) {
                currentTitle = data.aiData.title;
                autofilled = true;
            }
            if (!currentDescription && data.aiData.description) {
                currentDescription = data.aiData.description;
                autofilled = true;
            }
            if (data.aiData.extractedAttributes) {
                try {
                    const attrs = typeof data.aiData.extractedAttributes === 'string' ? JSON.parse(data.aiData.extractedAttributes) : data.aiData.extractedAttributes;
                    let foundNew = false;
                    for (const [k, v] of Object.entries(attrs)) {
                        if (v !== null && v !== '') {
                            if (!currentAttributes.some(a => a.key === k)) {
                                currentAttributes = [...currentAttributes, { key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }];
                                foundNew = true;
                            }
                        }
                    }
                    if (foundNew) { autofilled = true; isDirty = true; }
                } catch (e) { console.error("Failed to parse attributes", e); }
            }

            if (data.aiData.prominent_text_or_graphic && !currentAttributes.some(a => a.key === 'prominent_text_or_graphic')) {
                currentAttributes = [...currentAttributes, { key: 'prominent_text_or_graphic', value: data.aiData.prominent_text_or_graphic }];
                autofilled = true; isDirty = true;
            }

            if (data.aiData.distinctive_blemishes_or_wear && !currentAttributes.some(a => a.key === 'distinctive_blemishes_or_wear')) {
                currentAttributes = [...currentAttributes, { key: 'distinctive_blemishes_or_wear', value: data.aiData.distinctive_blemishes_or_wear }];
                autofilled = true; isDirty = true;
            }

            if (autofilled) {
                dispatch('success', 'Details are auto-filled');
                showNudgeTip = true;
                setTimeout(() => showNudgeTip = false, 60000);
            }
        }
    }   

    function handlePendingChange(ev: any) {
        pendingPhotos = ev.detail;
        photoCount = (item?.photos?.length || 0) + pendingPhotos.length;
        
        if (mode === 'rapid' && pendingPhotos.length > 0) {
            setTimeout(() => {
                const form = document.getElementById('eltForm') as HTMLFormElement;
                if (form) form.requestSubmit();
            }, 50);
        }
    }

    function changePendingType(index: number, newType: string) {
        // Find the hidden input generated by MultiImageUpload and force its value
        const hiddenInput = document.querySelector(`input[name="file.type.${index}"]`) as HTMLInputElement;
        if (hiddenInput) {
            hiddenInput.value = newType;
        }
        pendingPhotos = pendingPhotos.map(p => p.index === index ? { ...p, type: newType } : p);
    }

    async function runAiRefine() {
        if (!userHint.trim() || !serverImagePath) return;
        
        isRefining = true;
        try {
            let res;
            if (item?.id) {
                res = await fetch('/api/ai-refine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        itemId: item.id,
                        hint: userHint 
                    })
                });
            } else {
                res = await fetch('/api/analyze-draft-refine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        draftPath: serverImagePath,
                        hint: userHint 
                    })
                });
            }
            
            if (res.ok) {
                const result = await res.json();
                const aiData = result.aiData || result;
                if (aiData.title) currentTitle = aiData.title;
                if (aiData.description) currentDescription = aiData.description;
                aiDialog.close();
                userHint = "";
                dispatch('success', 'Item details enhanced by model!');
            } else {
				notify('error', "AI Refinement failed. Check server logs.");
                aiDialog.close();
            }
        } catch (e) {
            console.error(e);
        } finally {
            isRefining = false;
        }
    }
</script>

<div class="relative w-full md:max-w-2xl mx-auto bg-base-100 md:rounded-[2rem] rounded-xl shadow-lg md:shadow-2xl border border-base-200 flex flex-col">
    
    <!-- ================= THE HUB VIEW ================= -->
    <div class="{activeView === 'hub' ? 'flex' : 'hidden'} flex-col flex-1 p-4 sm:p-8 pb-0 animate-fade-in">
        <div class="text-center mb-8">
            <h2 class="text-2xl font-bold">{currentTitle || (item ? 'Edit Item' : 'New Item')}</h2>
            {#if !item && $page.data.inventories}
                <div class="text-[10px] uppercase tracking-wider font-bold text-primary mt-1 mb-1">
                    Adding to: {$page.data.inventories.find(i => i.id === $page.data.activeInventoryId)?.name || 'Trove'}
                </div>
            {/if}
            <p class="text-gray-500 text-sm">
                {#if isAnalyzing}
                    <span class="loading loading-spinner loading-xs text-primary align-middle mr-1"></span> Analyzing...
                {:else}
                    {item ? 'Update sections below' : 'Tap camera to start, or select a section below'}
                {/if}
            </p>
        </div>

        {#if isDuplicateWarning && duplicateDetails}
            <div class="alert bg-warning/20 border border-warning/50 text-warning-content shadow-sm rounded-xl mb-6 py-3 animate-fade-in items-start">
                <i class="bi bi-intersect text-warning text-xl mt-0.5"></i>
                <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start mb-2">
                            <h3 class="font-bold text-sm">Potential Duplicate</h3>
							<button type="button" class="btn btn-xs btn-ghost text-warning hover:bg-warning/20 p-1 h-auto min-h-0" on:click={() => { console.group('🐞 DEBUG DUPLICATE'); console.log('SCANNED', {title: currentTitle, attributes: currentAttributes, aiData: duplicateDetails._rawAiData}); console.log('DB ITEM', duplicateDetails); if (duplicateDetails.debugTrace) { console.log('TRACE'); duplicateDetails.debugTrace.forEach((l: string) => console.log(l)); } console.groupEnd(); notify('info', 'Debug data dumped to browser console!'); }} title="Dump debug data"><i class="bi bi-bug-fill text-sm"></i></button>
                        </div>
                    
                    <ItemMiniCard item={duplicateDetails} on:zoom={() => lightbox.open({ orgPath: duplicateDetails.orgPath || duplicateDetails.thumbPath, showOriginal: true })} />

                    <div class="text-[11px] mt-2 flex flex-col gap-1">
                        <div class="flex items-center justify-between gap-2 px-1">
                            <span class="text-gray-500 font-bold uppercase tracking-wider text-[9px]">Original Added:</span> 
                            <span class="font-medium text-right"><RelativeDate date={duplicateDetails.createdAt} /></span>
                        </div>
                        {#if duplicateDetails.sharedAttributes?.length > 0}
                            <div class="flex flex-col mt-1 pt-1.5 border-t border-warning/10">
                                <span class="text-gray-500 font-semibold uppercase tracking-wider mb-1">Matched Attributes:</span>
                                <div class="flex flex-wrap gap-1">
                                    {#each duplicateDetails.sharedAttributes as attr}
                                        <span class="badge badge-warning badge-outline text-[9px] font-mono font-bold h-auto py-0.5">{attr.key}: {attr.value}</span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="Dismiss" on:click={() => { isDuplicateWarning = false; duplicateDismissed = true; }}><i class="bi bi-x-lg"></i></button>
            </div>
        {/if}

        <!-- HERO CAMERA BUTTON (Pure 1-Tap Capture) -->
        <div class="flex justify-center items-center gap-4 mb-4 relative">
            <!-- Gallery Button -->
            <button type="button" class="btn btn-secondary btn-circle h-14 w-14 shadow-lg hover:scale-105 active:scale-95 transition-transform p-0 bg-base-100 text-base-content border-base-200" aria-label="Add from Gallery"
                on:click={() => {
                    const fileInputs = document.querySelectorAll('input[type="file"][name^="file."]');
                    const fileInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
                    const typeInputs = document.querySelectorAll('input[type="hidden"][name^="file.type."]');
                    const typeInput = typeInputs[typeInputs.length - 1] as HTMLInputElement;
                    if (fileInput && typeInput) {
                        typeInput.value = 'product';
                        fileInput.removeAttribute('capture');
                        fileInput.click();
                    }
                }}>
                <i class="bi bi-images text-xl"></i>
            </button>

            <div class="relative flex items-center justify-center">
                {#if !previewImagePath && photoCount === 0}
                    <!-- Soft radar pulse to draw the eye -->
                    <div class="absolute w-28 h-28 rounded-full bg-primary/40 animate-ping pointer-events-none" style="animation-duration: 3s;"></div>
                {/if}

                <button type="button" class="btn btn-primary btn-circle relative h-28 w-28 shadow-2xl shadow-primary/40 hover:scale-105 active:scale-95 transition-all duration-300 overflow-hidden p-0 z-10 border-4 border-base-100 group" aria-label="Quick Take Photo"
                on:click={triggerCamera}>
                {#if pendingPhotos.length > 0 && pendingPhotos[pendingPhotos.length - 1].isAnalyzing}
                    <div class="absolute inset-0 bg-base-100/60 backdrop-blur-sm flex items-center justify-center z-10">
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                {/if}
                
                {#if previewImagePath}
                    <img src={previewImagePath} alt="Preview" class="w-full h-full object-cover" />
                {:else}
                    <!-- glass sheen sweep -->
                    <div class="absolute top-0 -left-[100%] w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-20deg] animate-shimmer pointer-events-none"></div>
                    <i class="bi bi-camera text-5xl relative z-10 drop-shadow-md group-hover:scale-110 transition-transform duration-300"></i>
                {/if}
                </button>
                {#if photoCount > 0}
                    <div class="absolute top-0 right-[calc(50%-4rem)] bg-success text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shadow-md border-2 border-base-100 z-10 pointer-events-none">
                        <i class="bi bi-check-lg"></i>
                    </div>
                {/if}
            </div>

            <!-- File/Doc Button -->
            <button type="button" class="btn btn-secondary btn-circle h-14 w-14 shadow-lg hover:scale-105 active:scale-95 transition-transform p-0 bg-base-100 text-base-content border-base-200" aria-label="Add Document"
                on:click={() => {
                    const fileInputs = document.querySelectorAll('input[type="file"][name^="file."]');
                    const fileInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
                    const typeInputs = document.querySelectorAll('input[type="hidden"][name^="file.type."]');
                    const typeInput = typeInputs[typeInputs.length - 1] as HTMLInputElement;
                    if (fileInput && typeInput) {
                        typeInput.value = 'information';
                        fileInput.removeAttribute('capture');
                        fileInput.click();
                    }
                }}>
                <i class="bi bi-folder2-open text-xl"></i>
            </button>
        </div>

        <!-- RECENT CAPTURES FILMSTRIP -->
        {#if pendingPhotos.length > 0}
            <div class="flex gap-3 overflow-x-auto py-2 mb-8 max-w-lg mx-auto snap-x hide-scrollbar">
                {#each pendingPhotos as photo}
                    <div class="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden shadow-sm border border-base-200 snap-center bg-base-200 group">
                        <img src={photo.localUrl} class="w-full h-full object-cover" alt="Captured" />
                        {#if photo.isAnalyzing}
                            <div class="absolute inset-0 bg-base-100/50 flex items-center justify-center">
                                <span class="loading loading-spinner loading-sm text-primary"></span>
                            </div>
                        {:else}
                            <div class="absolute bottom-0 w-full opacity-90 group-hover:opacity-100 transition-opacity">
                                <select 
                                    class="select select-xs w-full bg-base-300 text-base-content border-none focus:outline-none rounded-none text-[10px] h-6 min-h-0 px-1 font-semibold"
                                    value={photo.type}
                                    on:change={(e) => changePendingType(photo.index, e.currentTarget.value)}
                                >
                                    <option value="product">Product</option>
                                    <option value="invoice or receipt">Receipt</option>
                                    <option value="information">Info</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}

        <div class="flex flex-col gap-3 max-w-lg mx-auto flex-1 w-full {!pendingPhotos.length ? 'mt-10' : ''}">
            <ActionCard 
                title="Photos" subtitle="Upload or fetch" icon="bi-camera" iconColorClass="bg-blue-100 text-blue-600"
                on:click={() => activeView = 'photos'}
            >
                {#if photoCount > 0}
                    <Badge color="primary">{photoCount}</Badge>
                {/if}
            </ActionCard>

            <ActionCard 
                title="Location" subtitle="Scan QR or select" icon="bi-box-seam" iconColorClass="bg-purple-100 text-purple-600"
                on:click={() => activeView = 'location'}
            >
                {#if selectedLocations.length > 0}
                    {#each selectedLocations.slice(0,2) as loc}
                            <Badge color="primary" size="sm" class="font-mono pl-1.5 pr-1 gap-1">
                            {#if !item && $ambientLocation.includes(loc)}
                                <i class="bi bi-pin-angle-fill text-[8px] opacity-70" title="Sticky Session Context"></i>
                            {/if}
                            {loc}
                            <button type="button" class="btn btn-ghost btn-xs min-h-0 h-auto w-auto p-0 ml-0.5 hover:text-error" aria-label="Remove" on:click|stopPropagation={() => { selectedLocations = selectedLocations.filter(l => l !== loc); ambientLocation.setContext(selectedLocations); }}>
                                <i class="bi bi-x"></i>
                            </button>
                            </Badge>
                    {/each}
                    {#if selectedLocations.length > 2}
                            <Badge color="primary" size="sm">+{selectedLocations.length - 2}</Badge>
                    {/if}
                {/if}
            </ActionCard>

            <ActionCard 
                title="Item Details" subtitle="Title, qty, tags..." icon="bi-pencil-square" iconColorClass="bg-orange-100 text-orange-600"
                on:click={() => activeView = 'details'}
            >
                {#if showNudgeTip}
                    <span role="button" tabindex="0" class="text-primary hover:scale-110 transition-transform animate-bounce cursor-pointer p-1" title="Refine with AI" 
                          on:click|stopPropagation={(e) => { e.preventDefault(); showNudgeTip = false; aiDialog.showModal(); }} 
                          on:keydown|stopPropagation={(e) => { if (e.key === 'Enter') { e.preventDefault(); showNudgeTip = false; aiDialog.showModal(); } }}>
                        <i class="bi bi-stars text-xl"></i>
                    </span>
                {/if}
            </ActionCard>

            <ActionCard 
                title="Documents" subtitle="Manual or scan QR" icon="bi-link-45deg" iconColorClass="bg-emerald-100 text-emerald-600"
                on:click={() => activeView = 'links'}
            >
                {#if linkCount > 0}
                    <Badge color="primary">{linkCount}</Badge>
                {/if}
            </ActionCard>
        </div>

        <!-- STICKY FOOTER -->
        <input type="hidden" name="duplicateDismissed" value={duplicateDismissed.toString()} />
        <input type="hidden" name="isDuplicateWarning" value={isDuplicateWarning.toString()} />
        
        {#each selectedLocations as loc}
            <input type="hidden" name="containers" value={loc} />
        {/each}

        <div class="sticky bottom-16 left-0 w-full p-4 bg-base-100/90 backdrop-blur-md border-t border-base-200 rounded-b-xl md:rounded-b-[2rem] mt-6">
            <button disabled={saving || !isDirty} type="submit" class="btn btn-primary btn-lg w-full max-w-lg mx-auto block rounded-xl shadow-md transition-all active:scale-95">
                {#if saving}
                    <span class="loading loading-spinner"></span> Saving...
                {:else}
                    <i class="bi bi-save mr-2 text-xl"></i> {item ? 'Save Changes' : 'Save Item'}
                {/if}
            </button>
        </div>
    </div>

    <!-- ================= SUB-VIEWS ================= -->

    <!-- PHOTOS VIEW -->
    <div class="{activeView === 'photos' ? 'flex' : 'hidden'} flex-col bg-base-100 rounded-xl md:rounded-[2rem] animate-fade-in">
        <div class="flex items-center p-4 sm:p-6 pb-2">
            <button type="button" class="btn btn-circle btn-ghost bg-base-200" aria-label="Back to Hub" on:click={() => activeView = 'hub'}><i class="bi bi-arrow-left text-xl"></i></button>
            <h2 class="text-xl font-bold ml-4">Photos</h2>
        </div>
        <div class="px-2 sm:px-6 pb-6">
            <div class="max-w-lg mx-auto w-full">
                <MediaHub 
                    photoTypes={photoTypes} 
                    photoValues={item?.photos || []}
                    on:success={(ev) => dispatch('success', ev.detail)} 
                    on:analyzingStart={handleAnalyzingStart}
                    on:analyzingComplete={handleAnalyzingComplete}
                    on:pendingChange={handlePendingChange}
                />
            </div>
        </div>
        <div class="sticky bottom-16 p-4 sm:p-6 bg-base-100 border-t border-base-200 rounded-b-xl md:rounded-b-[2rem] ">
            <button type="button" class="btn btn-neutral btn-lg w-full max-w-lg mx-auto block rounded-xl shadow-sm" on:click={() => activeView = 'hub'}><i class="bi bi-check2-circle mr-2"></i> Done</button>
        </div>
    </div>

    <!-- LOCATION VIEW -->
    <div class="{activeView === 'location' ? 'flex' : 'hidden'} flex-col bg-base-100 rounded-xl md:rounded-[2rem] animate-fade-in">
        <div class="flex items-center p-4 sm:p-6 pb-2">
            <button type="button" class="btn btn-circle btn-ghost bg-base-200" aria-label="Back to Hub" on:click={() => activeView = 'hub'}><i class="bi bi-arrow-left text-xl"></i></button>
            <h2 class="text-xl font-bold ml-4">Storage Location</h2>
        </div>
        <div class="px-2 sm:px-6 pb-6">
            <div class="max-w-lg mx-auto w-full">
                <ContainerSelector 
                    containers={containers} 
                    defaultTab={defaultContainerMode}
                    values={selectedLocations.map(name => ({ container: { name } }))}
                    on:change={(ev) => { 
                        console.log("🛠️ [DEBUG AMBIENT] ContainerSelector on:change fired with:", ev.detail.containers);
                        selectedLocations = ev.detail.containers; 
                        ambientLocation.setContext(selectedLocations); 
                    }}
                />
            </div>
        </div>
        <div class="sticky bottom-16 p-4 sm:p-6 bg-base-100 border-t border-base-200 rounded-b-xl md:rounded-b-[2rem] ">
            <button type="button" class="btn btn-neutral btn-lg w-full max-w-lg mx-auto block rounded-xl shadow-sm" on:click={() => activeView = 'hub'}><i class="bi bi-check2-circle mr-2"></i> Done</button>
        </div>
    </div>

    <!-- LINKS VIEW -->
    <div class="{activeView === 'links' ? 'flex' : 'hidden'} flex-col bg-base-100 rounded-xl md:rounded-[2rem] animate-fade-in">
        <div class="flex items-center p-4 sm:p-6 pb-2">
            <button type="button" class="btn btn-circle btn-ghost bg-base-200" aria-label="Back to Hub" on:click={() => activeView = 'hub'}><i class="bi bi-arrow-left text-xl"></i></button>
            <h2 class="text-xl font-bold ml-4">Documents</h2>
        </div>
        <div class="px-2 sm:px-6 pb-6">
            <div class="max-w-lg mx-auto w-full">
                {#if item?.documents?.length > 0}
                    <div class="mb-6 bg-base-50/50 p-4 rounded-xl border border-base-200">
                        <h3 class="font-semibold text-sm text-gray-500 mb-3 flex items-center gap-2"><i class="bi bi-file-earmark-text"></i> Existing Documents</h3>
                        <DocumentList 
                            documents={item.documents} 
                            editable={true} 
                            showContextItem={false} 
                            containerClass="" 
                            bind:deletedIds={deletedDocIds} 
                            bind:refreshedIds={refreshedDocIds} 
                            on:openDoc={(e) => docLightbox.open(e.detail)} 
                            on:openImage={(e) => lightbox.open(e.detail)} 
                        />
                        <input type="hidden" name="delete_documents" value={JSON.stringify(deletedDocIds)} />
                        <input type="hidden" name="refresh_documents" value={JSON.stringify(refreshedDocIds)} />
                    </div>
                {/if}
                <QRurlScanner 
                    on:success={(ev) => dispatch('success', ev.detail)}
                    on:change={(ev) => qrScannerCount = ev.detail.count}
                    on:processingStart={(ev) => dispatch('processingStart', ev.detail)}
                    on:processingComplete={(ev) => dispatch('processingComplete', ev.detail)}
                />
            </div>
        </div>
        <div class="sticky bottom-16 p-4 sm:p-6 bg-base-100 border-t border-base-200 rounded-b-xl md:rounded-b-[2rem] ">
            <button type="button" class="btn btn-neutral btn-lg w-full max-w-lg mx-auto block rounded-xl shadow-sm" on:click={() => activeView = 'hub'}><i class="bi bi-check2-circle mr-2"></i> Done</button>
        </div>
    </div>

    <!-- DETAILS VIEW -->
    <div class="{activeView === 'details' ? 'flex' : 'hidden'} flex-col bg-base-100 rounded-xl md:rounded-[2rem] animate-fade-in">
        <div class="flex items-center p-4 sm:p-6 pb-2">
            <button type="button" class="btn btn-circle btn-ghost bg-base-200" aria-label="Back to Hub" on:click={() => activeView = 'hub'}><i class="bi bi-arrow-left text-xl"></i></button>
            <h2 class="text-xl font-bold ml-4">Item Details</h2>
        </div>

        <div class="px-4 sm:px-6 pb-6">
            <div class="flex flex-col gap-5 max-w-lg mx-auto w-full">
                <FormInput label="Title {isAnalyzing ? '<span class=\'loading loading-spinner loading-xs text-primary ml-2\'></span><span class=\'text-xs text-primary font-normal ml-1\'>Analyzing image...</span>' : ''}" name="title" bind:value={currentTitle} placeholder="Leave blank for auto-fill..." inputClass="pr-12 {isAnalyzing ? 'input-primary' : ''}">
                    {#if previewImagePath}
                        <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            {#if showNudgeTip}
                                <span class="text-[10px] font-bold text-primary uppercase tracking-wider animate-fade-in pointer-events-none drop-shadow-sm">Not quite right?</span>
                            {/if}
                            <button type="button" class="text-primary/70 hover:text-primary transition-all {showNudgeTip ? 'animate-bounce' : ''}" title="Refine with AI" on:click={() => { showNudgeTip = false; aiDialog.showModal(); }}>
                                <i class="bi bi-stars text-xl"></i>
                            </button>
                        </div>
                    {/if}
                </FormInput>

                <div class="form-control">
                    <div class="label flex justify-between pb-1 pt-0">
                        <span class="label-text font-semibold">Description</span>
                        <button type="button" class="btn btn-xs btn-ghost text-primary" on:click={() => showPreview = !showPreview}>
                            {showPreview ? 'Edit' : 'Preview'}
                        </button>
                    </div>
                    {#if showPreview}
                        <div class="prose prose-sm max-w-none bg-base-200/50 p-4 rounded-xl border border-base-200 min-h-[5rem]">
                            {@html currentDescription ? marked.parse(currentDescription, { breaks: true, gfm: true }) : '<span class="text-gray-400">Empty</span>'}
                        </div>
                    {:else}
                        <textarea name="description" bind:value={currentDescription} rows="3" placeholder="Notes (Markdown supported)..." class="textarea textarea-bordered w-full rounded-xl {isAnalyzing ? 'textarea-primary' : ''}"></textarea>
                    {/if}
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <FormInput label="Amount" name="amount" type="number" bind:value={amount} placeholder="1" />
                    <FormInput label="Reason" name="reason" bind:value={reason} placeholder="Project Apollo" />
                </div>

                <FormInput label="Tags" name="tagcsv" bind:value={tagcsv} placeholder="electronics, office, spare..." hint="Separated by comma." />

                <div class="form-control w-full">
                    <div class="label"><span class="label-text font-semibold">Attributes</span></div>
                    <div class="bg-base-200/50 p-3 rounded-xl border border-base-200" on:input={() => isDirty = true}>
                        {#key currentAttributes}
                            <AttributeAdder values={currentAttributes} on:change={() => isDirty = true} />
                        {/key}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="sticky bottom-16 p-4 sm:p-6 bg-base-100 border-t border-base-200 rounded-b-xl md:rounded-b-[2rem] ">
            <button type="button" class="btn btn-neutral btn-lg w-full max-w-lg mx-auto block rounded-xl shadow-sm" on:click={() => activeView = 'hub'}><i class="bi bi-check2-circle mr-2"></i> Done</button>
        </div>
    </div>
</div>

<!-- The Bottom Drawer for LLM Refinement -->
<Modal bind:this={aiDialog} position="top" title="<i class='bi bi-stars text-primary'></i> Refine Guess" titleClass="font-bold text-xl mb-2 flex items-center gap-2" boxClass="w-full max-w-[95vw] sm:max-w-md mx-auto mt-4 sm:mt-0 p-6 bg-base-100/95 backdrop-blur-xl rounded-3xl overflow-hidden shadow-2xl">
    <form on:submit|preventDefault={runAiRefine}>
    <p class="text-sm text-gray-500 mb-6 mt-[-10px]">Give the AI a nudge with a brand or model name to get a better match.</p>
    <FormInput bind:value={userHint} placeholder="e.g. It's actually a MITTZON desk" class="mb-4" />
    <div class="modal-action mt-0 flex gap-2">
        <button type="button" class="btn btn-ghost rounded-xl flex-1" on:click={() => aiDialog.close()}>Cancel</button>
        <button type="button" class="btn btn-primary rounded-xl flex-1 shadow-md" on:click={runAiRefine} disabled={isRefining}>
            {#if isRefining}
                <span class="loading loading-spinner"></span>
            {:else}
                Enhance
            {/if}
        </button>
    </div>
    </form>
</Modal>

<ImageLightbox bind:this={lightbox} />
<DocumentLightbox bind:this={docLightbox} />

<style>
    @keyframes shimmer {
        0% { left: -100%; }
        20% { left: 200%; }
        100% { left: 200%; }
    }
    .animate-shimmer {
        animation: shimmer 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
</style>