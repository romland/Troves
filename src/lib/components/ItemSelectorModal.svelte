<script lang="ts">
    export let title: string = "Select Item";
    export let subtitle: string = "Choose an item from your library";
    
    import { createEventDispatcher, onMount } from 'svelte';
    import ItemMiniCard from './ItemMiniCard.svelte';
    import Modal from './Modal.svelte';
    import FormInput from './FormInput.svelte';
    
    const dispatch = createEventDispatcher();
    let modal: Modal;
    
    let query = '';
    let items: any[] = [];
    let loading = false;
    let page = 1;
    let hasMore = true;
    
    async function fetchItems(reset = false) {
        if (loading) return;
        if (reset) { page = 1; items = []; }
        loading = true;
        
        try {
            const res = await fetch(`/api/items?q=${encodeURIComponent(query)}&c=12&page=${page}&sort=newest`);
            const data = await res.json();
            if (data && data.items) {
                items = reset ? data.items : [...items, ...data.items];
                hasMore = data.nextPage > 0;
            }
        } finally {
            loading = false;
        }
    }
    
    onMount(() => fetchItems(true));
    
    let searchTimer: any;
    function handleInput() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => fetchItems(true), 300);
    }
    
    export function showModal() { modal?.showModal(); }
    export function close() { modal?.close(); }
</script>

<Modal bind:this={modal} boxClass="p-0 overflow-hidden border border-base-200 flex flex-col max-h-[85vh] sm:rounded-[2.5rem] w-full max-w-lg mx-auto" on:close>
        <div class="p-6 pb-4 border-b border-base-200 bg-base-100/90 sticky top-0 z-10 flex justify-between items-center">
            <div>
                <h3 class="font-bold text-lg leading-tight">{title}</h3>
                <p class="text-xs text-gray-500 mt-1">{subtitle}</p>
            </div>
            <button type="button" aria-label="Close" class="btn btn-sm btn-circle btn-ghost" on:click={close}><i class="bi bi-x-lg"></i></button>
        </div>
        
        <div class="p-4 bg-base-50 border-b border-base-200">
            <FormInput placeholder="Filter by name, tag, or attribute..." bind:value={query} on:input={handleInput} inputClass="bg-base-100" />
        </div>
        
        <div class="overflow-y-auto p-4 flex flex-col gap-2 max-h-[50vh]">
            {#each items as item}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_interactive_supports_focus -->
                <div role="button" class="cursor-pointer bg-base-100 hover:bg-base-200 rounded-2xl transition-colors border border-base-200 shadow-sm" on:click|preventDefault|capture={() => { dispatch('select', item); close(); }}>
                    <ItemMiniCard {item} />
                </div>
            {/each}
            
            {#if hasMore}
                <button type="button" class="btn btn-ghost btn-sm w-full my-2 text-primary" on:click={() => { page++; fetchItems(); }} disabled={loading}>
                    {#if loading}<span class="loading loading-spinner"></span>{:else}Load More...{/if}
                </button>
            {/if}
        </div>
</Modal>
