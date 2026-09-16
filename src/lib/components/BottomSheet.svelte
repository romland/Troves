<script lang="ts">
    import { spring } from 'svelte/motion';
    export let title: string = '';
    export let subtitle: string = '';
    
    let dialog: HTMLDialogElement;
    let scrollArea: HTMLDivElement;
    
    // Spring physics for 1:1 finger tracking
    const dragY = spring(0, { stiffness: 0.1, damping: 0.6 });
    let startY = 0;
    let isDragging = false;

    export function showModal() { 
        dragY.set(0, { hard: true }); 
        dialog?.showModal(); 
    }
    
    export function close() { 
        dialog?.close(); 
        setTimeout(() => dragY.set(0, { hard: true }), 300);
    }

    function handleTouchStart(e: TouchEvent) {
        const target = e.target as HTMLElement;
        const isHeader = target.closest('.sheet-header');
        if (isHeader || (scrollArea && scrollArea.scrollTop <= 0)) {
            startY = e.touches[0].clientY;
            isDragging = true;
        }
    }

    function handleTouchMove(e: TouchEvent) {
        if (!isDragging) return;
        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > 0) {
            if (e.cancelable) e.preventDefault(); // Stop native iOS bounce
            dragY.set(deltaY, { hard: true }); // 'hard' bypasses spring lag for 1:1 tracking
        }
    }

    function handleTouchEnd() {
        if (!isDragging) return;
        isDragging = false;
        if ($dragY > 120) close();
        else dragY.set(0); // Snap back to top using spring physics
    }
</script>

<dialog bind:this={dialog} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close on:touchstart={handleTouchStart} on:touchmove={handleTouchMove} on:touchend={handleTouchEnd}>
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 flex flex-col max-h-[85vh] sm:max-h-[90vh] sm:rounded-[2.5rem] w-full max-w-lg mx-auto" style="transform: translate3d(0, {$dragY}px, 0); touch-action: pan-y;">
        <div class="sheet-header p-6 pb-4 border-b border-base-200 bg-base-100/90 sticky top-0 z-10 flex flex-col">
            <div class="w-12 h-1.5 bg-base-300 rounded-full mx-auto mb-4 cursor-grab active:cursor-grabbing"></div>
            <div class="flex justify-between items-center">
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
        </div>
        
        <div bind:this={scrollArea} class="overflow-y-auto p-4 sm:p-6 flex flex-col gap-4 bg-base-50" style="overscroll-behavior: contain;">
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