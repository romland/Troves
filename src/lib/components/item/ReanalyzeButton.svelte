<script lang="ts">
    import { notify } from "$lib/client/notifications";
    import type ConfirmModal from "$lib/components/ConfirmModal.svelte";

    export let item: { id: number, slug: string };
    export let confirmModal: ConfirmModal;
    export let asMenuItem: boolean = false;

    let isQueuing = false;

    async function triggerReanalyze() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const res = await confirmModal.ask(
            'Re-analyze Item', 
            'Troves will scan this item\'s photos using the vision model to extract deeper attributes. All auto-generated attributes will be replaced. Manual attributes are kept. Continue?', 
            'Re-analyze', 
            'Cancel'
        );
        
        if (!res) return;

        isQueuing = true;
        try {
            const fd = new FormData();
            const req = await fetch(`/${item.id}/${item.slug}?/reanalyze`, { 
                method: 'POST', 
                body: fd, 
                headers: { 'x-sveltekit-action': 'true' } 
            });
            if (req.ok) {
                notify('info', 'Item queued for re-analysis.');
            } else {
                notify('error', 'Failed to queue re-analysis.');
            }
        } catch(err) {
            notify('error', 'Network error while queuing.');
        } finally {
            isQueuing = false;
        }
    }
</script>

{#if asMenuItem}
    <button type="button" class="font-medium text-base-content hover:text-primary" on:click={triggerReanalyze} disabled={isQueuing}>
        {#if isQueuing}
            <span class="loading loading-spinner loading-xs text-primary"></span>
        {:else}
            <i class="bi bi-magic text-lg opacity-70"></i>
        {/if}
        Re-analyze
    </button>
{:else}
    <button type="button" class="btn btn-sm btn-outline border-base-300 bg-base-100/50 hover:bg-base-200 rounded-xl w-full text-base-content/70" on:click={triggerReanalyze} disabled={isQueuing}>
        {#if isQueuing}
            <span class="loading loading-spinner loading-xs text-primary"></span> Queuing...
        {:else}
            <i class="bi bi-magic text-primary"></i> Re-analyze with Vision Model
        {/if}
    </button>
{/if}