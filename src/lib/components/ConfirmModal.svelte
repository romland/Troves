<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
    export let title = "Confirm";
    export let message = "Are you sure?";
    export let confirmText = "Confirm";
    export let cancelText = "Cancel";
    export let isDestructive = false;

    let dialog: HTMLDialogElement;
    let resolvePromise: ((value: boolean) => void) | null = null;

    export function ask(newTitle?: string, newMessage?: string, newConfirmText?: string, newCancelText?: string, destructive: boolean = false): Promise<boolean> {
        if (newTitle) title = newTitle;
        if (newMessage) message = newMessage;
        if (newConfirmText) confirmText = newConfirmText;
        if (newCancelText) cancelText = newCancelText;
        isDestructive = destructive;
        
        dialog.showModal();
        return new Promise((resolve) => {
            resolvePromise = resolve;
        });
    }

    function handleConfirm() {
        dialog.close();
        if (resolvePromise) resolvePromise(true);
        dispatch('confirm');
    }

    function handleCancel() {
        dialog.close();
        if (resolvePromise) resolvePromise(false);
        dispatch('cancel');
    }
</script>

<dialog bind:this={dialog} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close={handleCancel}>
    <div class="modal-box bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        <h3 class="font-bold text-xl mb-4 flex items-center gap-2">
            <i class="bi {isDestructive ? 'bi-exclamation-triangle text-error' : 'bi-question-circle text-primary'}"></i> {title}
        </h3>
        <p class="text-sm text-gray-500 mb-6 leading-relaxed">{@html message}</p>
        <div class="modal-action mt-0 flex gap-2 w-full">
            <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={handleCancel}>{cancelText}</button>
            <button type="button" class="btn {isDestructive ? 'btn-error' : 'btn-primary'} flex-1 rounded-xl shadow-md" on:click={handleConfirm}>{confirmText}</button>
        </div>
    </div>
	<div class="modal-backdrop" role="button" tabindex="-1" on:click={handleCancel} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCancel(); }}>
		<button type="button" tabindex="-1" class="cursor-default w-full h-full outline-none border-none bg-transparent">close</button>
	</div>
</dialog>
