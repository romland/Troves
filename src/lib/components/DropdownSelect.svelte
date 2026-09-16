<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { enhance } from '$app/forms';
    const dispatch = createEventDispatcher();

    export let options: { value: string | number, label: string }[] = [];
    export let value: string | number | null = null;
    export let buttonClass: string = "btn-sm btn-ghost bg-base-200/40 hover:bg-base-200/80 font-medium tracking-tight rounded-lg gap-2 shadow-sm border border-base-content/5";
    export let menuClass: string = "w-56 bg-base-100/95 backdrop-blur-2xl rounded-[1.25rem] border border-base-content/10 mt-2 p-1.5 gap-0.5 max-h-[60vh] overflow-y-auto flex-nowrap shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)]";
    export let dropdownClass: string = "dropdown-bottom";
    export let chevronClass: string = "bi-chevron-down text-[10px] opacity-50";
    export let labelPrefix: string = "";
    
    // Form submission behavior
    export let name: string = "";
    export let formAction: string = "";
    export let reload: boolean = false;

    function handleSelect(optValue: string | number, e: MouseEvent) {
        value = optValue;
        dispatch('change', optValue);
        
        if (!formAction && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }
    
        function handleInteraction(e: MouseEvent | TouchEvent) {
            const btn = e.currentTarget as HTMLButtonElement;
            if (document.activeElement === btn) {
                e.preventDefault();
                btn.blur();
            }
        }

    $: selectedLabel = options.find(o => String(o.value) === String(value))?.label || 'Select...';
</script>

<div class="dropdown {dropdownClass}">
    <button type="button" tabindex="0" class="btn {buttonClass}" on:mousedown={handleInteraction} on:touchstart={handleInteraction}>
        <span class="truncate">{labelPrefix}{selectedLabel}</span>
        <i class="bi {chevronClass} shrink-0"></i>
    </button>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <ul tabindex="0" class="dropdown-content z-[100] menu shadow-2xl {menuClass}">
        <slot name="header" />
        {#each options as opt}
            <li>
                {#if formAction}
                    <form action={formAction} method="POST" use:enhance class="w-full m-0 p-0 block" on:submit>
                        <input type="hidden" {name} value={opt.value}>
                        <button type="submit" class="flex w-full items-center justify-between py-3 sm:py-2 px-3 text-base sm:text-[14px] font-medium rounded-lg transition-colors {String(opt.value) === String(value) ? 'bg-base-content/10 text-base-content' : 'text-base-content/80 hover:bg-base-content/5 hover:text-base-content'}">
                            <span class="truncate">{opt.label}</span>
                            {#if String(opt.value) === String(value)}
                                <i class="bi bi-check-lg shrink-0 text-base"></i>
                            {/if}
                        </button>
                    </form>
                {:else}
                    <button type="button" class="flex w-full items-center justify-between py-3 sm:py-2 px-3 text-base sm:text-[14px] font-medium rounded-lg transition-colors {String(opt.value) === String(value) ? 'bg-base-content/10 text-base-content' : 'text-base-content/80 hover:bg-base-content/5 hover:text-base-content'}" on:click={(e) => handleSelect(opt.value, e)}>
                        <span class="truncate">{opt.label}</span>
                        {#if String(opt.value) === String(value)}
                            <i class="bi bi-check-lg shrink-0 text-base"></i>
                        {/if}
                    </button>
                {/if}
            </li>
        {/each}
        <slot name="footer" />
    </ul>
    {#if !formAction && name}
        <input type="hidden" {name} {value}>
    {/if}
</div>