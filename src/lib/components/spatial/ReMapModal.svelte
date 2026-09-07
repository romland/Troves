<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import TrayBank from "./TrayBank.svelte";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();
    let modal: Modal;

    export let unmappedEntities: any[] = [];
    export let polygonCount: number = 0;

    export function show() { modal.showModal(); }
    export function close() { modal.close(); }
</script>

<Modal bind:this={modal} title="Re-Map Container" boxClass="p-6 bg-base-100 rounded-3xl border border-base-200">
    <p class="text-xs text-gray-500 mb-4 mt-[-10px]">We detected <strong>{polygonCount}</strong> slots in your new photo. You have <strong>{unmappedEntities.length}</strong> existing items or trays to reconcile.</p>
    
    <div class="mb-6">
        <TrayBank entities={unmappedEntities} />
    </div>

    <div class="flex gap-2">
        <button class="btn btn-ghost flex-1 rounded-xl" on:click={() => { dispatch('autoMatch'); close(); }}>Auto-Match</button>
        <button class="btn btn-primary flex-1 rounded-xl shadow-sm" on:click={() => close()}>Done</button>
    </div>
</Modal>