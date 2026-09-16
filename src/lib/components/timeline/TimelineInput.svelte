<script lang="ts">
    import { enhance } from '$app/forms';
    import { onMount } from 'svelte';
    import { createEventDispatcher } from 'svelte';
    import { saveToQueue } from '$lib/client/offlineQueue';
    import FormInput from '$lib/components/FormInput.svelte';

    const dispatch = createEventDispatcher();

    let content = "";
    let isUploading = false;
    let fileInput: HTMLInputElement;
    
    let latitude: number | null = null;
    let longitude: number | null = null;
    let locationStatus = "";
    let isOffline = false;

    // @-Mention state
    let showMentions = false;
    let mentionResults: any[] = [];
    let linkedItemIds = new Set<number>();
    let cursorPosition = 0;

    onMount(() => {
        isOffline = !navigator.onLine;
        window.addEventListener('online', () => { isOffline = false; });
        window.addEventListener('offline', () => isOffline = true);
    });

    async function handleInput(e: Event) {
        const target = e.target as HTMLTextAreaElement;
        target.style.height = 'auto';
        target.style.height = target.scrollHeight + 'px';
        
        cursorPosition = target.selectionStart;
        const textBeforeCursor = content.slice(0, cursorPosition);
        const match = textBeforeCursor.match(/@(\w+)$/);
        
        if (match) {
            showMentions = true;
            const res = await fetch(`/api/items?q=${encodeURIComponent(match[1])}&c=5`);
            const data = await res.json();
            mentionResults = data.items;
        } else {
            showMentions = false;
        }
    }

    function insertMention(item: any) {
        const markdownLink = `[${item.title}](/${item.id}/${item.slug}) `;
        const textBefore = content.slice(0, cursorPosition).replace(/@\w+$/, markdownLink);
        const textAfter = content.slice(cursorPosition);
        content = textBefore + textAfter;
        linkedItemIds.add(item.id);
        linkedItemIds = linkedItemIds; // trigger reactivity
        showMentions = false;
    }

    function requestLocation() {
        locationStatus = "locating...";
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    latitude = pos.coords.latitude;
                    longitude = pos.coords.longitude;
                    locationStatus = "📍 Tagged";
                },
                (err) => locationStatus = "Location failed",
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
            );
        }
    }

    function triggerCamera() {
        fileInput.click();
    }

    function submitForm(formData: FormData, cancelSubmit: () => void) {
        cancelSubmit(); // Always cancel default Sveltekit behavior
        const hasPasted = Array.from(formData.keys()).some(k => k.startsWith('pasted_') || k.startsWith('preprocessed_'));
        const hasFiles = Array.from(formData.values()).some(v => ((v as any) instanceof File || (v as any) instanceof Blob) && (v as any).size > 0);
        
        if (!content.trim() && !hasFiles && !hasPasted) return;
        if (isUploading) return;
        isUploading = true;

        saveToQueue('/timeline?/capture', formData).then(() => {
            content = "";
            if (fileInput) fileInput.value = "";
            linkedItemIds.clear();
            locationStatus = ""; //"Queued";
            document.querySelectorAll('#timelineForm input[name^="pasted_"], #timelineForm input[name^="preprocessed_"]').forEach(el => el.remove());
            dispatch('posted');
            window.dispatchEvent(new CustomEvent('outbox-trigger'));
            isUploading = false;
        });        
    }
</script>

<div class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 w-full bg-base-100/95 backdrop-blur-xl border-t border-base-200 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pb-2 z-40 box-border shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none">
    {#if showMentions && mentionResults.length > 0}
        <ul class="absolute bottom-full left-0 w-full max-w-2xl mx-auto bg-base-100 shadow-xl border border-base-200 rounded-t-xl max-h-48 overflow-y-auto p-2 m-0 mb-2">
            {#each mentionResults as item}
                <li>
                    <button type="button" class="w-full text-left p-2 hover:bg-base-200 rounded-lg text-sm font-semibold flex items-center gap-2" on:click={() => insertMention(item)}>
                        <i class="bi bi-box text-primary"></i> {item.title}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
    <form 
        id="timelineForm"
        method="POST" 
        action="/timeline?/capture" 
        enctype="multipart/form-data" 
        use:enhance={({ formData, cancel }) => {
            submitForm(formData, cancel);
        }}
        class="max-w-2xl mx-auto flex items-end gap-2 w-full box-border"
    >
        <input type="hidden" name="latitude" value={latitude || ''}>
        <input type="hidden" name="longitude" value={longitude || ''}>

        {#each Array.from(linkedItemIds) as id}
            <input type="hidden" name="linkedItemIds[]" value={id}>
        {/each}

        <!-- We use the same name format the rest of your app expects -->
        <input 
            bind:this={fileInput} 
            type="file" 
            name="file.0" 
            accept="image/*,video/*" 
            class="hidden" 
            on:change={() => { if (fileInput.files?.length) fileInput.form?.requestSubmit(); }}
        >
        <input type="hidden" name="file.type.0" value="information">

        <!-- Tools Column -->
		<div class="flex items-center gap-1 pb-1 shrink-0">
            <button type="button" class="btn btn-circle btn-ghost btn-sm text-gray-500" aria-label="Attach GPS location" title="Attach GPS" on:click={requestLocation}>
				<i class="bi bi-geo-alt{latitude ? '-fill text-primary' : ''} text-lg"></i>
            </button>
			<button type="button" class="btn btn-circle btn-secondary btn-md shadow-sm" aria-label="Attach image" on:click={triggerCamera}>
				<i class="bi bi-camera-fill text-xl"></i>
            </button>
        </div>

        <!-- Expanding Text Input -->
        <FormInput type="textarea"
                name="content"
                bind:value={content}
                placeholder="Type an idea, paste a link/image, or @mention an item..." 
                class="flex-1 rounded-2xl border border-base-300 bg-base-200 relative"
                inputClass="textarea-ghost min-h-[75px] max-h-32 bg-transparent border-0 focus:ring-0 resize-none py-3 px-4 leading-tight text-base"
                rows="1"
                on:input={handleInput}
                on:keydown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
                    }
                }}
        >
                {#if locationStatus}
                    <div class="absolute -top-6 left-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                        {locationStatus}
                    </div>
                {/if}
        </FormInput>

        <!-- Submit Button -->
		<div class="pb-1 shrink-0">
			<button type="submit" class="btn btn-circle btn-primary btn-md shadow-sm" aria-label="Submit note" disabled={isUploading || (!content.trim() && !fileInput?.files?.length)}>
				{#if isUploading}
					<span class="loading loading-spinner loading-md"></span>
				{:else}
					<i class="bi bi-arrow-up text-xl{isOffline ? ' text-warning' : ''}"></i>
				{/if}
			</button>
		</div>
    </form>
</div>
