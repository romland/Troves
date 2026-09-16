<script lang="ts">
    export let container: any;
    export let allContainers: any[];
    export let depth: number = 0;
    import { slide } from 'svelte/transition';
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    $: children = allContainers.filter(c => c.parentId === container.id).sort((a,b) => a.name.localeCompare(b.name));
    let expanded = depth < 1;
    let showAllChildren = false;

    $: visibleChildren = showAllChildren ? children : children.slice(0, 12);
</script>

{#if depth === 0}
    <!-- Master Container (Top Level) -->
    <div class="mb-4 bg-base-100 rounded-[1.5rem] border border-base-200 shadow-sm overflow-hidden">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="flex items-center justify-between p-4 hover:bg-base-50 transition-colors cursor-pointer" on:click={() => expanded = !expanded}>
            <a href="/container/{encodeURIComponent(container.name)}" class="flex items-center gap-4 flex-1 min-w-0" on:click|stopPropagation>
                <div class="w-12 h-12 rounded-xl bg-base-200 overflow-hidden shrink-0 border border-base-300 flex items-center justify-center">
                    {#if container.photoPath}
                        <img class="w-full h-full object-cover" src="{container.photoPath}" alt="{container.name}"/>
                    {:else}
                        <i class="bi bi-box-seam text-gray-400 text-xl"></i>
                    {/if}
                </div>
                <div class="flex-1 min-w-0 pr-2">
                    <div class="font-bold text-lg tracking-tight flex items-center gap-2 truncate">
                        {container.name}
                        {#if children.length > 0}
                            <span class="badge badge-sm badge-ghost text-[10px] uppercase font-bold text-gray-500">{children.length} Trays</span>
                        {/if}
                    </div>
                    <div class="text-xs text-gray-500 truncate flex gap-2 font-medium mt-0.5">
                        {#if container.location}<span class="text-primary shrink-0"><i class="bi bi-geo-alt-fill"></i> {container.location}</span>{/if}
                        {#if container.description}<span class="truncate">{container.description}</span>{/if}
                    </div>
                </div>
            </a>
            <div class="flex items-center gap-1 shrink-0 ml-2">
                <button type="button" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-primary transition-colors" on:click|stopPropagation={() => dispatch('move', container)} aria-label="Move"><i class="bi bi-arrows-move text-lg"></i></button>
                <a href="/container/{encodeURIComponent(container.name)}/edit" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-primary transition-colors" aria-label="Edit" on:click|stopPropagation><i class="bi bi-pencil text-lg"></i></a>
                <button type="button" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-error transition-colors" on:click|stopPropagation={() => dispatch('delete', container)} aria-label="Delete"><i class="bi bi-trash text-lg"></i></button>
            </div>
        </div>

        {#if expanded && children.length > 0}
            <!-- Dense Grid for Children -->
            <div class="p-4 pt-0 bg-base-100" transition:slide|local={{duration: 200}}>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {#each visibleChildren as child (child.id)}
                        <svelte:self container={child} {allContainers} depth={depth + 1} on:delete on:move />
                    {/each}
                </div>
                {#if !showAllChildren && children.length > 12}
                    <button class="btn btn-sm btn-ghost w-full text-gray-500 hover:text-primary mt-2 rounded-xl" on:click={() => showAllChildren = true}>
                        Show all {children.length} trays
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{:else}
    <!-- Condensed Child Tray (Compact Chip) -->
    <div class="flex flex-col bg-base-200/50 border border-base-200 rounded-xl hover:bg-base-200 transition-colors shadow-sm">
        <div class="flex items-center justify-between p-2.5 gap-2">
            <a href="/container/{encodeURIComponent(container.name)}" class="flex items-center gap-3 flex-1 min-w-0 pr-2">
                <div class="w-10 h-10 rounded-lg bg-base-100 border border-base-300 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                    {#if container.photoPath}
                        <img src="{container.photoPath}" alt="{container.name}" class="w-full h-full object-cover" />
                    {:else}
                        <i class="bi bi-ui-checks text-gray-400 text-sm"></i>
                    {/if}
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="font-bold text-sm text-base-content truncate tracking-tight">{container.name}</span>
                    <span class="text-[10px] text-gray-500 uppercase tracking-wider font-semibold truncate flex gap-1.5 items-center mt-0.5">
                        {#if children.length > 0}<span class="text-primary"><i class="bi bi-diagram-2"></i> {children.length}</span>{/if}
                        {#if container.description}<span class="truncate">{container.description}</span>{/if}
                    </span>
                </div>
            </a>
            <div class="flex items-center shrink-0 gap-0.5">
                <button type="button" class="btn btn-ghost btn-square btn-sm h-8 w-8 min-h-0 text-gray-400 hover:text-primary" on:click={() => dispatch('move', container)} aria-label="Move"><i class="bi bi-arrows-move"></i></button>
                <button type="button" class="btn btn-ghost btn-square btn-sm h-8 w-8 min-h-0 text-gray-400 hover:text-error" on:click={() => dispatch('delete', container)} aria-label="Delete"><i class="bi bi-trash"></i></button>
            </div>
        </div>

        {#if expanded && children.length > 0}
            <!-- Deeply nested trays just stack cleanly inside the parent card -->
            <div class="flex flex-col gap-2 p-2 pt-0" transition:slide|local={{duration: 200}}>
                {#each visibleChildren as child (child.id)}
                    <svelte:self container={child} {allContainers} depth={depth + 1} on:delete on:move />
                {/each}
                {#if !showAllChildren && children.length > 12}
                    <button class="btn btn-xs btn-ghost text-gray-500 w-full hover:text-primary" on:click={() => showAllChildren = true}>
                        Show {children.length - 12} more...
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}
