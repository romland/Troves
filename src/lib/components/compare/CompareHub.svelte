<script lang="ts">
    import CompareResults from '$lib/components/compare/CompareResults.svelte';
    import ContentUnavailable from '$lib/components/ContentUnavailable.svelte';
    import { createEventDispatcher, onMount } from 'svelte';
    import { beforeNavigate } from '$app/navigation';

    export let containers: any[] = [];
    export let categories: any[] = [];
    export let tags: any[] = [];
    export let predefinedScopeType: string | null = null;
    export let predefinedScopeValue: string | null = null;
    const dispatch = createEventDispatcher();

    let fileInputCamera: HTMLInputElement;
    let fileInputGallery: HTMLInputElement;
    let isScanning = false;
    let scanHint = '';
    let uploadError = '';

    let compareResults: any = null;

    export async function processPastedFile(file: File) {
        const dt = new DataTransfer();
        dt.items.add(file);
        if (fileInputGallery) {
            fileInputGallery.files = dt.files;
            fileInputGallery.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    onMount(() => {
        if (typeof sessionStorage !== 'undefined') {
            const cached = sessionStorage.getItem('troves_compare_state');
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    compareResults = parsed.compareResults;
                    if (parsed.scanHint) scanHint = parsed.scanHint;
                } catch (e) {}
            }
        }
    });

    beforeNavigate(() => {
        if (typeof sessionStorage !== 'undefined') {
            if (compareResults) {
                sessionStorage.setItem('troves_compare_state', JSON.stringify({ compareResults, scanHint }));
            } else {
                sessionStorage.removeItem('troves_compare_state');
            }
        }
    });

    async function handleFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        uploadError = '';
        isScanning = true;
        dispatch('processingStart', { message: 'Comparing with your Trove...', taskId: 'compare' });

        let wakeLock: any = null;
        try { if ('wakeLock' in navigator) wakeLock = await (navigator as any).wakeLock.request('screen'); } catch (err) {}

        const fd = new FormData();
        fd.append('file', file);
        fd.append('scopeType', predefinedScopeType || 'all');
        fd.append('scopeValue', predefinedScopeValue || '');
        if (scanHint.trim()) fd.append('hint', scanHint.trim());

        try {
            const res = await fetch('/api/compare-collection', { method: 'POST', body: fd });

            const data = await res.json();
            if (res.ok && data.success) {
                compareResults = data;
                if (data.totalVisibleCount > data.totalDetected) {
                    dispatch('notify', { status: 'warning', message: `We saw ${data.totalVisibleCount} items but only extracted ${data.totalDetected}. Some may be missing.` });
                } else {
                    dispatch('success', `Found ${data.totalDetected} items!`);
                }
                dispatch('processingComplete', { taskId: 'compare', status: 'success' });
            } else {
                uploadError = data.error || 'Comparison failed.';
                dispatch('processingComplete', { taskId: 'compare', status: 'error', message: data.error || 'Comparison failed.' });
            }
        } catch (err) {
            uploadError = 'Network error while processing comparison.';
            dispatch('processingComplete', { taskId: 'compare', status: 'error', message: 'Network error while processing comparison.' });
        } finally {
            isScanning = false;
            if (wakeLock) try { await wakeLock.release(); } catch (err) {}
        }
    }

    export function reset() {
        compareResults = null;
        uploadError = '';
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('troves_compare_state');
    }
</script>

<div class="flex flex-col w-full max-w-lg mx-auto">
    {#if uploadError}
        <ContentUnavailable 
            type="error"
            icon="bi-exclamation-triangle"
            title="Analysis Interrupted" 
            message={uploadError} 
            actionLabel="Try Again" 
            actionIcon="bi-arrow-counterclockwise"
            on:click={() => uploadError = ""} 
        />
    {:else if !compareResults}
        <div class="text-center mb-6 animate-fade-in">
            <div class="bg-primary/10 text-primary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                <i class="bi bi-search-heart text-3xl"></i>
            </div>
            <h2 class="text-xl font-bold tracking-tight">Compare with Trove</h2>
            <p class="text-gray-500 text-xs mt-1">Snap a photo of shelves, crates, or groceries to see what you own and what you're missing.</p>
        </div>

        {#if !predefinedScopeType}
            <!-- Step 1: Context Hint -->
            <div class="mb-8">
                <input type="text" bind:value={scanHint} placeholder="Optional context (e.g. 'Sci-Fi paperbacks', 'Spices', 'Plants')..." class="input input-sm input-bordered w-full rounded-xl bg-base-100 text-xs shadow-inner" />
            </div>
        {/if}

        <!-- Step 2: Trigger Buttons -->
        {#if isScanning}
            <div class="btn btn-primary btn-lg w-full rounded-2xl opacity-80 cursor-not-allowed flex items-center justify-center gap-3">
                <span class="loading loading-spinner"></span>
                <span class="font-bold text-sm">Inspecting items...</span>
            </div>
        {:else}
            <div class="flex gap-3 w-full">
                <button type="button" class="btn btn-primary flex-1 shadow-lg rounded-2xl active:scale-95 transition-transform" on:click={() => fileInputCamera.click()}>
                    <i class="bi bi-camera text-xl"></i> Snap Photo
                </button>
                <button type="button" class="btn btn-secondary flex-1 shadow-lg rounded-2xl active:scale-95 transition-transform" on:click={() => fileInputGallery.click()}>
                    <i class="bi bi-images text-xl"></i> Gallery
                </button>
            </div>
        {/if}

        <input type="file" bind:this={fileInputCamera} accept="image/*" capture="environment" class="hidden" on:change={handleFileSelect} />
        <input type="file" bind:this={fileInputGallery} accept="image/*" class="hidden" on:change={handleFileSelect} />
    {:else}
        <div class="flex items-center justify-between mb-4 border-b border-base-200 pb-3">
            <h2 class="text-xl font-bold tracking-tight">Scan Results</h2>
            <button type="button" class="btn btn-sm btn-ghost rounded-xl gap-1 text-gray-500" on:click={reset}><i class="bi bi-arrow-counterclockwise"></i> Scan Again</button>
        </div>
        <CompareResults results={compareResults} {containers} {categories} {tags} on:notify={(e) => dispatch(e.detail.status, e.detail.message)} />
    {/if}
</div>
