<!-- src/lib/components/add/MediaHub.svelte -->
<script lang="ts">
    import MultiImageFetcher from "$lib/components/MultiImageFetcher.svelte";
    import MultiImageUpload from "$lib/components/MultiImageUpload.svelte";
    import { createEventDispatcher } from 'svelte';
    
    const dispatch = createEventDispatcher();

    export let photoTypes = [];
    export let photoValues = [];
    
    // View state for tabs
    let activeTab = 'device'; // 'device' | 'web'
    
    let deletedImageIds: number[] = [];
    let refreshedImageIds: number[] = [];

    // Map existing photos to extract vision/LLM category and format it cleanly
    $: displayValues = photoValues.map(photo => {
        let category = photo.category?.name || "";
        
        // Try to pull the category from the LLM analysis or legacy ML classification
        if (!category && photo.llmAnalysis) {
            try { category = JSON.parse(photo.llmAnalysis).subCategory || ""; } catch(e) {}
        } else if (!category && photo.classTrash) {
            try { category = JSON.parse(photo.classTrash).predicted_classes?.[0] || ""; } catch(e) {}
        }
        
        // Capitalize the base type (e.g., 'product' -> 'Product')
        const typeStr = photo.type ? photo.type.charAt(0).toUpperCase() + photo.type.slice(1) : "Unknown";
        
        return {
            ...photo,
            displayInfo: category ? `${typeStr} — ${category}` : typeStr
        };
    });

    function toggleDelete(id: number) {
        if (deletedImageIds.includes(id)) deletedImageIds = deletedImageIds.filter(x => x !== id);
        else deletedImageIds = [...deletedImageIds, id];
        dispatch('change');
    }
    
    function toggleRefresh(id: number) {
        if (refreshedImageIds.includes(id)) refreshedImageIds = refreshedImageIds.filter(x => x !== id);
        else refreshedImageIds = [...refreshedImageIds, id];
        dispatch('change');
    }
</script>

<div class="flex flex-col w-full">
    <!-- Tab Navigation -->
    <div role="tablist" class="flex bg-base-200/70 p-1 mb-4 w-full rounded-xl">
        <button 
            type="button" 
            role="tab" 
            class="flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center flex-nowrap whitespace-nowrap {activeTab === 'device' ? 'bg-base-100 shadow text-base-content' : 'text-gray-500 hover:text-gray-700'}"
            on:click={() => activeTab = 'device'}
        >
            <i class="bi bi-camera mr-2 whitespace-nowrap"></i> <span class="truncate">From Device</span>
        </button>
        <button 
            type="button" 
            role="tab" 
            class="flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center flex-nowrap whitespace-nowrap {activeTab === 'web' ? 'bg-base-100 shadow text-base-content' : 'text-gray-500 hover:text-gray-700'}"
            on:click={() => activeTab = 'web'}
        >
            <i class="bi bi-link-45deg mr-2 whitespace-nowrap"></i> <span class="truncate">From Web</span>
        </button>
    </div>

    <!-- Dropzone Area with tighter mobile padding -->
    <div class="bg-base-50/50 rounded-xl border-2 border-dashed border-base-300 p-2 sm:p-6 min-h-[220px] flex flex-col items-center justify-center transition-all">
        
        {#if activeTab === 'device'}
            {#if photoValues.length === 0}
            <div class="text-center mb-4 animate-fade-in">
                <div class="bg-base-200 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="bi bi-cloud-arrow-up text-2xl text-gray-500"></i>
                </div>
                <h3 class="font-semibold text-lg">Upload Images</h3>
                <p class="text-sm text-gray-400">Snap an image or browse files</p>
            </div>
            {/if}
            
            <div class="w-full max-w-sm">
                <MultiImageUpload 
                    {photoTypes} 
                    values={photoValues}
                    on:success 
                    on:analyzingStart
                    on:analyzingComplete
                    on:pendingChange
                />
            </div>

        {:else}
            <div class="text-center mb-4 animate-fade-in">
                <div class="bg-base-200 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="bi bi-globe text-2xl text-gray-500"></i>
                </div>
                <h3 class="font-semibold text-lg">Fetch from URL</h3>
                <p class="text-sm text-gray-400">Paste a direct link to an image</p>
            </div>
            
            <div class="w-full max-w-sm">
                <MultiImageFetcher {photoTypes} on:success />
            </div>
        {/if}
    </div>
    
    {#if photoValues.length > 0}
        <div class="mb-6 bg-base-50/50 p-4 rounded-xl border border-base-200">
            <h3 class="font-semibold text-sm text-gray-500 mb-3 flex items-center gap-2"><i class="bi bi-images"></i> Existing Photos</h3>
            <div class="flex flex-col gap-2">
                {#each displayValues as photo}
                    <div class="flex items-center p-2 sm:p-3 bg-base-100 border border-base-200 shadow-sm rounded-xl gap-3 transition-all {deletedImageIds.includes(photo.id) ? 'opacity-50 grayscale scale-[0.98]' : ''}">
                        <div class="w-12 h-12 sm:w-16 sm:h-16 shrink-0 rounded-lg overflow-hidden border border-base-200 bg-base-50 flex items-center justify-center">
                            {#if photo.thumbPath || photo.orgPath}
                                <img src={photo.thumbPath || photo.orgPath} alt="Item photo" class="w-full h-full object-cover" />
                            {:else}
                                <i class="bi bi-image text-2xl text-gray-400"></i>
                            {/if}
                        </div>
                        <div class="flex-1 min-w-0 flex flex-col justify-center">
                            <span class="font-bold text-sm sm:text-base text-base-content leading-tight truncate">{photo.displayInfo}</span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0 ml-auto">
                            <button type="button" class="btn btn-circle btn-sm btn-ghost {refreshedImageIds.includes(photo.id) ? 'text-primary bg-primary/10' : 'text-base-content/50 hover:text-primary'}" on:click={() => toggleRefresh(photo.id)} title="Re-process Image AI">
                                <i class="bi bi-arrow-clockwise {refreshedImageIds.includes(photo.id) ? 'animate-spin' : ''}"></i>
                            </button>
                            <button type="button" class="btn btn-circle btn-sm btn-ghost {deletedImageIds.includes(photo.id) ? 'text-error bg-error/10' : 'text-base-content/50 hover:text-error hover:bg-error/10'}" on:click={() => toggleDelete(photo.id)} title={deletedImageIds.includes(photo.id) ? "Undo Delete" : "Delete"}>
                                <i class="bi {deletedImageIds.includes(photo.id) ? 'bi-arrow-counterclockwise' : 'bi-trash3'}"></i>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
            <input type="hidden" name="delete_images" value={JSON.stringify(deletedImageIds)} />
            <input type="hidden" name="refresh_images" value={JSON.stringify(refreshedImageIds)} />
        </div>
    {/if}


</div>
