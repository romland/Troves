<script lang="ts">
    export let title: string = '';
    export let subtitle: string = '';
    
    let dialog: HTMLDialogElement;
    
    export function showModal() { dialog?.showModal(); }
    export function close() { dialog?.close(); }
</script>

<dialog bind:this={dialog} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close>
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 flex flex-col max-h-[85vh] sm:max-h-[90vh] sm:rounded-[2.5rem] w-full max-w-lg mx-auto">
        <div class="p-6 pb-4 border-b border-base-200 bg-base-100/90 sticky top-0 z-10 flex justify-between items-center">
            <div class="flex-1 min-w-0 pr-4">
                <h3 class="font-bold text-lg leading-tight truncate">
                    <slot name="title">{title}</slot>
                </h3>
                {#if subtitle || $$slots.subtitle}
                    <p class="text-xs text-gray-500 mt-1 truncate">
                        <slot name="subtitle">{subtitle}</slot>
                    </p>
                {/if}
            </div>
            <button type="button" class="btn btn-sm btn-circle btn-ghost shrink-0" aria-label="Close" on:click={close}><i class="bi bi-x-lg"></i></button>
        </div>
        
        <div class="overflow-y-auto p-4 sm:p-6 flex flex-col gap-4 bg-base-50">
            <slot></slot>
        </div>
        
        {#if $$slots.actions}
            <div class="p-4 pt-3 border-t border-base-200 bg-base-100 sticky bottom-0 z-10">
                <slot name="actions"></slot>
            </div>
        {/if}
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>