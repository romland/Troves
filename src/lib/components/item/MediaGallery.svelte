<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { enhance } from '$app/forms';
    import RelativeDate from '$lib/components/RelativeDate.svelte';

    export let productPhotos: any[] = [];
    export let itemTitle: string = '';

    const dispatch = createEventDispatcher();
</script>

<div class="carousel carousel-center w-full max-w-md p-4 space-x-4 rounded-box max-h-80 bg-base-200 shadow-inner border border-base-300/50">
    {#each productPhotos as photo, i}
        {@const cols = photo.colors?.length > 2 ? Object.keys(JSON.parse(photo.colors)) : []}
        <div id="carousel-item{i}" class="carousel-item w-full justify-center cursor-zoom-in relative group rounded-2xl overflow-hidden bg-base-100 shadow-sm border border-base-200/60">
            {#if photo.cropPath}
                <form method="POST" action="?/toggleBackground" use:enhance={() => { return async ({ update }) => { await update({ reset: false }); } }} class="absolute top-2 right-2 z-30 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <input type="hidden" name="photoId" value={photo.id} />
                    <input type="hidden" name="showOriginal" value={photo.showOriginal ? 'false' : 'true'} />
                    <button type="submit" class="btn btn-circle btn-sm btn-ghost bg-base-100/80 shadow-md backdrop-blur-sm" title={photo.showOriginal ? "Show Cutout" : "Show Original"}>
                        <i class="bi {photo.showOriginal ? 'bi-scissors' : 'bi-image'} text-lg"></i>
                    </button>
                </form> 
            {/if}

            <button type="button" class="p-0 border-none bg-transparent h-full w-full flex justify-center items-center relative overflow-hidden" on:click={() => dispatch('zoom', photo)}>
                {#if cols.length > 0}
                    <div class="absolute inset-0 opacity-20 dark:opacity-30 mix-blend-screen pointer-events-none transition-opacity duration-500 group-hover:opacity-40 print:hidden" style="background: radial-gradient(circle at 20% 20%, {cols[0]}, transparent 60%), radial-gradient(circle at 80% 80%, {cols[1] || cols[0]}, transparent 60%);"></div>
                {/if}
                {#if photo.orgPath.match(/\.(mp4|webm|mov|ogg|mkv)$/i)}
                    <video src="{photo.orgPath}#t=0.1" class="object-scale-down max-h-full max-w-full rounded-xl relative z-10" muted playsinline></video>
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 rounded-xl z-20">
                        <i class="bi bi-play-circle-fill text-5xl text-white drop-shadow-md"></i>
                    </div>
                {:else}
                    {@const cb = photo.updatedAt ? '?v=' + new Date(photo.updatedAt).getTime() : ''}
                    <img src="{(photo.showOriginal ? photo.orgPath : photo.cropPath) + cb}" alt="{photo.llmAnalysis ? JSON.parse(photo.llmAnalysis).description : itemTitle}" class="object-scale-down max-h-full max-w-full relative z-10 drop-shadow-2xl">
                {/if}
            </button>

            <div class="absolute bottom-2 left-2 bg-base-100/80 backdrop-blur-sm px-2 py-1 rounded-lg shadow-sm opacity-0 md:group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                <span class="text-[10px] font-medium text-base-content/80"><RelativeDate date={photo.createdAt} /></span>
            </div>
        </div> 
    {/each}
</div>

<div class="flex justify-start w-full py-2 gap-2 overflow-x-auto hide-scrollbar">
    {#each productPhotos as photo, i}
        {@const cols = photo.colors?.length > 2 ? Object.keys(JSON.parse(photo.colors)) : []}
        <button aria-label="View photo {i + 1}" on:click={()=> { document.getElementById("carousel-item" + i)?.scrollIntoView({ block: 'nearest', inline: 'center' }) }} class="btn shrink-0 p-0 overflow-hidden relative border border-base-300 bg-base-100 hover:border-primary transition-colors">
            {#if cols.length > 0}
                <div class="absolute inset-0 opacity-20 pointer-events-none print:hidden" style="background: linear-gradient(135deg, {cols[0]}, {cols[1] || cols[0]});"></div>
            {/if}
            {#if photo.orgPath.match(/\.(mp4|webm|mov|ogg|mkv)$/i)}
                <video class="object-cover w-12 h-12 bg-black rounded relative z-10" src="{photo.orgPath}#t=0.1" muted playsinline></video>
            {:else}
                <img class="object-scale-down w-12 h-12 bg-transparent relative z-10" src="{(photo.showOriginal ? photo.orgPath?.replace(/\.[^/.]+(?=\?|$)/, '_org_thumb.webp') : photo.thumbPath)}{photo.updatedAt ? '?v=' + new Date(photo.updatedAt).getTime() : ''}" on:error={(e) => { if (!(e.currentTarget).dataset.fb) { (e.currentTarget).dataset.fb = '1'; (e.currentTarget).src = photo.thumbPath || photo.orgPath || ''; } }} alt="Thumbnail {i + 1}"/>
            {/if}
        </button>
    {/each}
</div>