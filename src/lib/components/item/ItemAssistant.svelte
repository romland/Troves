<script lang="ts">
    import { notify } from "$lib/client/notifications";
    import { invalidateAll } from '$app/navigation';
    import { page } from "$app/stores";
    export let itemId: number;
    export let hasPhotos: boolean = false;

    let aiQuestion = "";
    let isAskingAi = false;
    let includePhotoContext = true;

    $: archetype = $page.data.inventories?.find((i: any) => i.id === $page.data.activeInventoryId)?.archetype || 'generic';
    $: exampleQuestion = $page.data.archetypes?.find((a: any) => a.id === archetype)?.askTrovesExample || "What kind of batteries does this take?";

    $: hasTextCap =$page.data.capabilities.hasText;
    $: hasVisionCap =$page.data.capabilities.hasVision;
    
    // Auto-disable photo context if vision is missing
    $: if (!hasVisionCap) includePhotoContext = false;

    async function askAiQuestion() {
        if (!aiQuestion.trim() || !itemId) return;
        isAskingAi = true;
        try {
            const res = await fetch('/api/ask-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId, question: aiQuestion, includePhoto: includePhotoContext && hasPhotos })
            });
            if (res.ok) {
                notify('success', 'Answer added to Local Archive!');
                aiQuestion = "";
                invalidateAll();
            } else {
                const errData = await res.json().catch(() => ({}));
                notify('error', errData.error || 'Failed to generate answer.');
            }
        } catch (e) { notify('error', 'Network error reaching server.'); } 
        finally { isAskingAi = false; }
    }
</script>

<div class="title font-bold mb-3 flex items-center gap-2">
    <i class="bi bi-robot text-primary"></i> Ask Troves
</div>
<div class="mb-6 bg-base-200/50 p-4 rounded-2xl border border-base-200">
    <p class="text-xs text-gray-500 mb-3">Ask questions about this item based on its photos, OCR text, and downloaded manuals.</p>
    <div class="flex gap-2 relative">
        <div class="relative w-full flex items-center">
            <input type="text" bind:value={aiQuestion} placeholder={hasTextCap ? `e.g. ${exampleQuestion}` : "Text Engine API keys required"} class="input input-sm input-bordered w-full rounded-xl pr-20 {hasPhotos && hasVisionCap ? 'pl-24' : 'pl-4'}" on:keydown={(e) => e.key === 'Enter' && askAiQuestion()} disabled={isAskingAi || !hasTextCap} />
            
            {#if hasPhotos && hasVisionCap}
                <button type="button" class="absolute left-2 top-1/2 -translate-y-1/2 badge badge-sm gap-1.5 transition-all cursor-pointer font-medium {includePhotoContext ? 'badge-primary shadow-sm' : 'badge-ghost text-gray-400 border-base-300'}" on:click={() => includePhotoContext = !includePhotoContext} title={includePhotoContext ? "Click to exclude photo context" : "Click to include photo context"}>
                    <i class="bi bi-image"></i> <span>Photo</span>
                </button>
            {/if}
        </div>
        <button type="button" class="btn btn-sm btn-primary absolute right-0 top-0 rounded-l-none rounded-r-xl" on:click={askAiQuestion} disabled={isAskingAi || !aiQuestion.trim() || !hasTextCap}>
            {#if isAskingAi}<span class="loading loading-spinner loading-xs"></span>{:else}Ask{/if}
        </button>
    </div>
    {#if isAskingAi}
        <div class="mt-4 flex items-start gap-3 animate-fade-in text-sm text-gray-500">
            <i class="bi bi-robot text-primary/50 animate-pulse text-2xl mt-1"></i>
            <div class="bg-base-100 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3 border border-base-200">
                <span class="loading loading-dots loading-xs text-primary"></span>
                <span class="font-medium text-base-content/80">Analyzing your item...</span>
            </div>
        </div>
    {/if}
</div>
