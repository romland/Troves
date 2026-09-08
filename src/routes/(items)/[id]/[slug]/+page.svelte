<script lang="ts">
    import type { PageServerData } from "./$types";
    import Delete from "$lib/components/delete.svelte";
    import { toTextDocument, refine, refineForLLM } from "$lib/shared/ocrparser";
    import { afterNavigate, beforeNavigate, invalidateAll } from '$app/navigation'
    import { marked } from "marked";
    import { enhance } from "$app/forms";
    import PasteHandler from "$lib/components/PasteHandler.svelte";
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import InvoiceViewer from "$lib/components/InvoiceViewer.svelte";
    import DuplicateResolution from "$lib/components/DuplicateResolution.svelte";
    import CompareAttributeSheet from "$lib/components/compare/CompareAttributeSheet.svelte";
    import RelativeDate from "$lib/components/RelativeDate.svelte";
    import DocumentLightbox from "$lib/components/DocumentLightbox.svelte";
    import ColorMixBar from "$lib/components/ColorMixBar.svelte";
    import ItemMiniCard from "$lib/components/ItemMiniCard.svelte";
    import ItemLocationCard from "$lib/components/item/ItemLocationCard.svelte";
    import MediaGallery from "$lib/components/item/MediaGallery.svelte";
    import AttributeList from "$lib/components/item/AttributeList.svelte";
    import ItemAssistant from "$lib/components/item/ItemAssistant.svelte";
    import DocumentArchive from "$lib/components/item/DocumentArchive.svelte";
    import ItemDebugTools from "$lib/components/item/ItemDebugTools.svelte";
    import { notify } from "$lib/client/notifications";
    import { dev } from '$app/environment';
    import { onMount } from 'svelte';

    export let data: PageServerData;
    
    let productPhotos = [], invoicePhotos = [], otherPhotos = [];
    let photoAttributes = [];
    let isSavingPasted = false;
    let lightbox: ImageLightbox;
    let docLightbox: DocumentLightbox;
    let isProcessingItem = false;
    let attrModal: HTMLDialogElement;
    let duplicateDeleteModal: Delete;
    let diagnosticModal: HTMLDialogElement;
    let pasteHandler: PasteHandler;
    onMount(() => {
        const handleInc = () => { 
            if (data.item?.inventory?.trackQuantity && data.canEdit) document.getElementById('incStockBtn')?.click();
        };
        const handleDec = () => { 
            if (data.item?.inventory?.trackQuantity && data.canEdit) document.getElementById('decStockBtn')?.click();
        };
        window.addEventListener('shortcut:stockInc', handleInc);
        window.addEventListener('shortcut:stockDec', handleDec);
        return () => {
            window.removeEventListener('shortcut:stockInc', handleInc);
            window.removeEventListener('shortcut:stockDec', handleDec);
        };
    });

    // Svelte Reactivity: Whenever SvelteKit's 'data' prop updates (via form action or SSE invalidateAll),
    // this block automatically re-runs and updates our local state instantly.
    $: {
        if(data.item?.photos?.length > 0) {
            productPhotos = data.item.photos.filter((photo) => { return photo.type === "product" });
            productPhotos.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
            invoicePhotos = data.item.photos.filter((photo) => { return photo.type === "invoice or receipt" });
            otherPhotos =  data.item.photos.filter((photo) => { return photo.type === "information" || photo.type === "other" });
        } else {
            productPhotos = []; invoicePhotos = []; otherPhotos = [];
        }
        
        // // Heuristic: If any photo lacks a thumbnail, or any web document lacks a downloaded path, we are still processing.
        // isProcessingItem = data.item?.photos?.some(p => !p.thumbPath) || 
        //                    data.item?.documents?.some(d => !d.path && d.type !== 'note');
        // // Heuristic: If any RECENT photo/doc lacks a thumbnail/path, we are still processing.
        // // We ignore items older than 5 minutes so legacy/failed items don't hang the UI forever.
        // const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
        // isProcessingItem = data.item?.photos?.some(p => !p.thumbPath && new Date(p.createdAt).getTime() > fiveMinsAgo) || 
        //                    data.item?.documents?.some(d => !d.path && d.type !== 'note' && new Date(d.createdAt).getTime() > fiveMinsAgo);
        // Driven completely by centralized server state now!
        isProcessingItem = data.activeTasks && data.activeTasks.length > 0;


        photoAttributes = [];
        if (data.item?.inventory?.showOcr) {
            for(let i = 0; i < data.item.photos?.length; i++) {
                const photo = data.item.photos[i];
                
                try {
                    const ocr = JSON.parse(photo.ocr)?.data[0] || [];
                    // console.log("photo ocr:", ocr, ocr.length);
                    for(let j = 0; j < ocr.length; j++) {
                        if(photo.type !== "product") {
                            continue;
                        }
                        
                        // Add text in product photos to attributes
                        const block = ocr[j];
                        
                        // Too low confidence
                        if(block[1][1] < 0.85) {
                            continue;
                        }
                        
                        // Too short string
                        if(block[1][0].length < 3) {
                            continue;
                        }
                        
                        photoAttributes.push({
                            photo: photo.id,
                            key: "OCR " + i + "." + j,
                            value: block[1][0]
                        })
                    }
                } catch(ex) {
                    // console.warn("No or faulty OCR data for photo", photo.id)
                }
            }
        }
    }
    
    import pageTitle from '$lib/stores';
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
$:  pageTitle.set(data.item?.title || 'Item Details');

$:	itemCategories = Array.from(new Set(data.item?.photos?.filter(p => p.category).map(p => p.category.name) || []));
$:  activeSchema = data.activeSchema || [];
$:  itemAttributes = data.item?.attributes?.reduce((acc: any, a: any) => { acc[a.key] = a.value; return acc; }, {}) || {};
$:  hasMissingFields = activeSchema.some(f => 
        f.extractionMethod === 'HUMAN_REQUIRED' || 
        (f.extractionMethod === 'HYBRID' && !itemAttributes[f.name])
    );

$: if (data.duplicateItemDetails?.debugTrace) {
    console.group(`🔍 Match Trace for: ${data.item?.title}`);
    data.duplicateItemDetails.debugTrace.forEach((line: string) => console.log(line));
    console.groupEnd();
}

</script>
<PasteHandler 
    bind:this={pasteHandler}
    formId="pasteForm"
    on:success={() => (document.getElementById('pasteForm') as HTMLFormElement)?.requestSubmit()}
    on:processingComplete={() => {}}
/>

<form id="pasteForm" action="?/addPasted" method="POST" class="hidden" enctype="multipart/form-data" use:enhance={() => {
    isSavingPasted = true;
    return async ({ update }) => {
        await update({ reset: true });
        isSavingPasted = false;
        
        pasteHandler?.clearQueue();
    };
}}></form>

<article style="padding-bottom: 100px;" class="">

    <div class="flex justify-between items-start gap-4 border-b border-base-200/60 pb-3 mb-4 mt-2">
        <div class="flex flex-col flex-1 min-w-0">
            <h1 class="text-3xl sm:text-4xl font-bold text-base-content hyphens-auto overflow-wrap-anywhere break-words leading-tight tracking-tight">
                {data.item?.title}
            </h1>
            <div class="text-[11px] text-gray-500 font-medium flex flex-wrap items-center gap-1.5 mt-2">
                <span class="flex items-center gap-1.5"><i class="bi bi-clock-history opacity-70"></i> Added <RelativeDate date={data.item?.createdAt} /></span>
                {#if data.item?.updatedAt && data.item.updatedAt !== data.item.createdAt}
                    <span class="mx-1 opacity-40 hidden sm:inline">•</span> 
                    <span class="hidden sm:flex items-center gap-1.5"><i class="bi bi-pencil opacity-70"></i> Updated <RelativeDate date={data.item.updatedAt} /></span>
                {/if}
            </div>
        </div>
        <div class="inline-flex gap-2 items-center shrink-0 pt-1">
            {#if isSavingPasted}
                <span class="loading loading-spinner loading-sm text-primary"></span>
            {/if}
            <div class="dropdown dropdown-end">
                <button tabindex="0" class="btn btn-circle btn-ghost bg-base-200/50 border-base-300 shadow-sm text-gray-500 hover:text-primary transition-all active:scale-95" aria-label="Item Options">
                    <i class="bi bi-three-dots text-xl"></i>
                </button>
                <ul tabindex="-1" role="menu" class="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-box w-52 border border-base-200 mt-2 gap-1">
                    <li>
                        <a href="/{data.item?.id}/edit" class="font-medium text-base-content hover:text-primary">
                            <i class="bi bi-pencil-square text-lg opacity-70"></i> Edit
                        </a>
                    </li>
                    <!--
                    {#if activeSchema.length > 0}
                        <li>
                            <button type="button" class="font-medium text-base-content hover:text-primary justify-between" on:click={() => attrModal.showModal()}>
                                <span class="flex items-center gap-2"><i class="bi bi-ui-checks-grid text-lg opacity-70"></i> Attributes</span>
                            </button>
                        </li>
                    {/if}
                    -->
                    <li>
                        <a href="https://www.google.com/search?q={encodeURIComponent(data.item?.title)}" target="_blank" rel="noopener noreferrer" class="font-medium text-base-content hover:text-primary">
                            <i class="bi bi-google text-lg opacity-70"></i> Search
                        </a>
                    </li>
                    <li class="divider my-0 h-[1px] bg-base-200"></li>
                    <li>
                        <div class="p-0 hover:bg-transparent block">
                            <!-- CSS injects the word "Delete" so we don't have to break the Delete component's isolation -->
                            <Delete message='Delete this item?' action='/{data.item?.id}/delete' btnClass="menu-delete-btn btn btn-ghost w-full justify-start hover:bg-error/10 hover:text-error px-4 py-2 h-auto min-h-0 rounded-lg font-medium" iconClass="bi bi-trash text-lg opacity-70" />
                        </div>
                    </li>
                </ul>
            </div>
        </div>
    </div>

    {#if data.duplicateItemDetails}
        <div class="mb-6 animate-fade-in max-w-2xl mx-auto">
            <DuplicateResolution 
                scannedTitle={data.item.title} 
                matchDetails={data.duplicateItemDetails} 
                scannedCreatedAt={String(data.item.createdAt)}
                isAfterTheFact={true}
                    scannedItem={data.item}
                on:resolve={(e) => {
                    if (e.detail === 'merge') (document.getElementById('mergeForm') as HTMLFormElement)?.requestSubmit();
                    else if (e.detail === 'new') (document.getElementById('dismissForm') as HTMLFormElement)?.requestSubmit();
                    else if (e.detail === 'ignore') {
                        duplicateDeleteModal.showModal();
                    }
                }}
                    on:zoom={(e) => lightbox.open({ orgPath: e.detail.orgPath || e.detail.thumbPath, showOriginal: true })}
            />
            <form id="mergeForm" method="POST" action="?/mergeDuplicate" class="hidden" use:enhance>
                <input type="hidden" name="targetId" value={data.duplicateItemDetails.id}>
            </form>
            <form id="dismissForm" method="POST" action="?/dismissDuplicate" class="hidden" use:enhance={() => {
                return async ({ update }) => {
                    data.duplicateItemDetails = null;
                    await update({ reset: false });
                };
            }}></form>
            <Delete bind:this={duplicateDeleteModal} action="?/deleteDuplicate" message="Are you sure you want to vaporize this anomaly? This cannot be undone." btnClass="hidden" />
        </div>
    {/if}

    <!-- End-User Processing Indicator -->
    {#if isProcessingItem}
        <div class="alert bg-base-200/50 border border-base-300 shadow-sm mb-6 rounded-xl flex items-start gap-3 animate-fade-in">
            <span class="loading loading-spinner text-primary mt-0.5"></span>
            <div>
                <h3 class="font-bold text-sm">Processing background tasks ({data.activeTasks.length})&hellip;</h3>
                <ul class="text-xs text-gray-500 mt-0.5 list-disc list-inside ml-1">
                    {#each data.activeTasks as task}
                        <li class="line-clamp-1">{task.description}</li>
                    {/each}
                </ul>
            </div>
        </div>
    {/if}

    {#if !isProcessingItem && data.item?.photos?.some(p => !p.thumbPath && p.orgPath)}
        <div class="alert bg-warning/20 border border-warning shadow-sm mb-6 rounded-xl flex items-start gap-3 animate-fade-in">
            <i class="bi bi-exclamation-triangle text-warning mt-0.5"></i>
            <div class="flex-1">
                <h3 class="font-bold text-sm">Processing Stalled</h3>
                <p class="text-xs text-gray-500 mt-0.5">Background tasks for this item were interrupted (e.g., server restart).</p>
            </div>
            <form method="POST" action="?/retryProcessing" use:enhance><button class="btn btn-warning btn-sm shadow-sm">Retry Now</button></form>
        </div>
    {/if}

    <!-- flex flex-row -->
    <div class="flex flex-col md:flex-row w-full gap-6 md:gap-4 mb-6">
        <div class="w-full md:w-2/3 pl-2">
            {#if productPhotos?.length > 0}
                <MediaGallery {productPhotos} itemTitle={data.item?.title} on:zoom={(e) => lightbox.open(e.detail)} />
            {/if}
        </div>

        <div class="w-full md:w-1/3 flex flex-col gap-4">
            <ItemLocationCard item={data.item} canEdit={data.canEdit} itemCategories={itemCategories} allContainers={data.allContainers} />
        </div>
    </div>

    {#if data.item?.contentToHtml?.length > 0}
        <div class="content prose max-w-none mb-3 break-words overflow-x-auto prose-pre:max-w-full">
            {@html data.item?.contentToHtml}
        </div>
    {/if}

    {#if data.item.attributes.length > 0 || photoAttributes.length > 0}
        <AttributeList 
            attributes={data.item.attributes} 
            {photoAttributes} 
            {activeSchema} 
            on:edit={() => attrModal.showModal()} 
            on:zoom={(e) => lightbox.open({ orgPath: e.detail, showOriginal: true })}
        />
    {/if}
    
    {#if data.item?.inventory?.showExif && productPhotos.some(p => p.exifData)}
        <div class="border-b border-base-300 pb-3 mb-3">
            <div class="title font-bold mb-3 flex items-center gap-2">
                <i class="bi bi-camera"></i> EXIF & Image Data
            </div>
            <div class="flex flex-col gap-2 mt-2">
                {#each productPhotos.filter(p => p.exifData) as photo}
                    {@const exif = JSON.parse(photo.exifData)}
                    <div class="bg-base-200/50 p-3 rounded-xl border border-base-200 text-xs font-mono break-all max-h-48 overflow-y-auto">
                        {#if exif.gps && exif.gps.GPSLatitude && exif.gps.GPSLongitude}
                            <div class="text-primary font-bold mb-2">GPS Location Found</div>
                            <div class="mb-2 text-gray-500">
                                Lat: {exif.gps.GPSLatitude.join(', ')} {exif.gps.GPSLatitudeRef} <br/>
                                Lon: {exif.gps.GPSLongitude.join(', ')} {exif.gps.GPSLongitudeRef}
                            </div>
                        {/if}
                        {#if exif.image?.Make || exif.image?.Model}
                            <div class="mb-2 text-gray-500">
                                Camera: {exif.image?.Make} {exif.image?.Model}
                            </div>
                        {/if}
                        <details>
                            <summary class="cursor-pointer text-gray-400 font-bold">View Raw EXIF JSON</summary>
                            <pre class="mt-2 text-[10px] bg-base-300 p-2 rounded-lg">{JSON.stringify(exif, null, 2)}</pre>
                        </details>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <div class="border-b border-base-300 pb-3 mb-3">
        {#if otherPhotos.length > 0}
            <div class="title font-bold  mb-3">
                More information
            </div>

            <div class="mb-3 flex flex-wrap gap-3">
                {#each otherPhotos as photo}
                    <button type="button" class="p-0 border-none bg-transparent" on:click={() => lightbox.open(photo)}>
                        <img 
                            src="{photo.thumbPath || photo.orgPath}"
                            alt="Additional detail view"
                            class="w-32 h-32 object-cover rounded-lg shadow-sm cursor-zoom-in">
                    </button>
                {/each}
            </div>
        {/if}

        {#if data.item?.inventory?.enableAskAi !== false}
            <ItemAssistant itemId={data.item.id} hasPhotos={productPhotos.length > 0} />
        {/if}

        {#if data.item?.inventory?.showRelatedItems && data.relatedItems?.length > 0}
            <div class="border-b border-base-300 pb-3 mb-3">
                <div class="title font-bold mb-3 flex items-center gap-2">
                    <i class="bi bi-collection"></i> Related Items
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {#each data.relatedItems as related}
                        <a href="/{related.id}/{related.slug}" class="block hover:scale-[1.02] transition-transform">
                            <ItemMiniCard item={related} />
                        </a>
                    {/each}
                </div>
            </div>
        {/if}

        {#if data.item.documents?.length > 0}
            <div class="title font-bold mb-3 mt-6">Local archive</div>
            <DocumentArchive 
                documents={data.item.documents} 
                on:openDoc={(e) => docLightbox.open(e.detail)}
                on:openImage={(e) => lightbox.open(e.detail)}
            />
        {/if}
    </div>
    
    {#if invoicePhotos.length > 0}
        <div class="border-b border-base-300 pb-3 mb-3">
            <div class="title font-bold mb-3">
                Purchase Information
            </div>

            <div class="flex flex-col gap-4 w-full">
                {#each invoicePhotos as photo}
                    <InvoiceViewer {photo} onOpenLightbox={() => lightbox.open(photo)} />
                {/each}
            </div>
        </div>
    {/if}

    {#if data.item?.inventory?.showColors}
        <div class="border-b border-base-300 pb-3 mb-3">
            <div class="title font-bold">
                Colors in product photos
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
                {#each productPhotos as photo}
                    {#if photo.colors?.length > 2}
                        {@const cols=Object.keys(JSON.parse(photo.colors))}
                        {@const names=Object.values(JSON.parse(photo.colors))}
                        {#each cols as col, i}
                            <div class="tooltip shadow text-xs items-center text-center rounded" data-tip="{names[i]} ({col})">
                                <div class="w-8 h-8 rounded border border-base-200/50" style="background-color:{col}">
                                </div>
                            </div>
                        {/each}
                    {/if}
                {/each}
            </div>
        </div>
    {/if}

    <!-- Background Activity Log -->
    {#if dev}
        <ItemDebugTools item={data.item} activeTasks={data.activeTasks} />
    {/if}
</article>

<form method="POST" action="?/saveAttributes" id="saveAttrsForm" use:enhance={() => {
    return async ({ update }) => { attrModal.close(); await update({ reset: false }); };
}}>
    <input type="hidden" name="attributes" id="attrsInput" />
</form>


<dialog bind:this={attrModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm">
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        <CompareAttributeSheet item={{...data.item, extractedAttributes: itemAttributes}} {activeSchema} showAll={true} on:cancel={() => attrModal.close()} on:save={(e) => { (document.getElementById('attrsInput') as HTMLInputElement).value = JSON.stringify(e.detail.attributes); (document.getElementById('saveAttrsForm') as HTMLFormElement).requestSubmit(); }} />
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>


<ImageLightbox bind:this={lightbox} itemTitle={data.item?.title} categories={data.categories} allowCategoryEdit={true} />
<DocumentLightbox bind:this={docLightbox} />



<style>
    :global(.menu-delete-btn::after) {
        content: "Delete";
        margin-left: 0.75rem;
    }
</style>
