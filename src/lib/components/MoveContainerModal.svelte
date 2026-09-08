<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import ContainerSelector from "$lib/components/ContainerSelector.svelte";
    import { createEventDispatcher } from "svelte";
    import { invalidateAll } from "$app/navigation";
    import { notify } from "$lib/client/notifications";

    export let allContainers: any[] = [];
    
    let modal: Modal;
    let isMoving = false;
    let containerToMove: any = null;
    let selectedParentName = "";
    
    export function show(container: any) {
        containerToMove = container;
        selectedParentName = "";
        modal.showModal();
    }

    async function moveContainer(detach = false) {
        if (!containerToMove) return;
        isMoving = true;
        try {
            const res = await fetch('/api/containers', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: containerToMove.name, parentName: detach ? '' : selectedParentName })
            });
            const data = await res.json();
            if (res.ok) {
                notify('success', data.message);
                invalidateAll();
                modal.close();
            } else {
                notify('error', data.error || 'Failed to move container');
            }
        } catch (e) { notify('error', 'Network error.'); } 
        finally { isMoving = false; }
    }
</script>

<Modal bind:this={modal} position="bottom" boxClass="p-0 bg-base-100 shadow-2xl sm:rounded-[2.5rem] border border-base-200">
    {#if containerToMove}
        <div class="p-6 border-b border-base-200 bg-base-200/30">
            <h3 class="font-bold text-xl mb-1 flex items-center gap-2"><i class="bi bi-arrows-move text-primary"></i> Move Container</h3>
            <p class="text-xs text-gray-500 mb-0">Select a new parent container for "{containerToMove.name}".</p>
            <p class="text-[10px] text-gray-500 italic mt-1 font-medium">Any nested trays inside this container will move with it.</p>
        </div>
        <div class="p-6 pb-2"><ContainerSelector containers={allContainers.filter(c => c.id !== containerToMove.id)} defaultTab="select" on:change={(e) => selectedParentName = e.detail.containers[0]} /></div>
        <div class="p-4 bg-base-100 flex flex-col gap-3">
            <div class="flex gap-2">
                <button type="button" class="btn btn-neutral flex-1 rounded-xl" on:click={() => modal.close()}>Cancel</button>
                <button type="button" class="btn btn-primary flex-[2] rounded-xl shadow-md" disabled={!selectedParentName || isMoving} on:click={() => moveContainer(false)}>
                    {#if isMoving}<span class="loading loading-spinner"></span>{:else}Move Inside Selected{/if}
                </button>
            </div>
            {#if containerToMove.parentId}
                <div class="divider my-0 text-xs text-gray-400 uppercase tracking-wider font-bold">Or</div>
                <button type="button" class="btn btn-outline border-base-300 text-gray-500 hover:text-base-content rounded-xl w-full" disabled={isMoving} on:click={() => moveContainer(true)}>
                    <i class="bi bi-layer-backward"></i> Detach to Top Level
                </button>
            {/if}
        </div>
    {/if}
</Modal>