<script lang="ts">
    export let container: any;
    export let allContainers: any[];
    export let depth: number = 0;
    import { slide } from 'svelte/transition';
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    $: children = allContainers.filter(c => c.parentId === container.id).sort((a,b) => a.name.localeCompare(b.name));
    let expanded = depth < 1;
</script>

<div class="relative {depth > 0 ? 'ml-4 sm:ml-8 mt-2' : 'mb-3 bg-base-100 rounded-[1.5rem] border border-base-200 shadow-sm'}">
    <!-- Subway Map Connecting Lines -->
    {#if depth > 0}
        <div class="absolute -left-4 sm:-left-8 -top-3 bottom-6 w-px bg-base-300"></div>
        <div class="absolute -left-4 sm:-left-8 top-6 w-4 sm:w-8 h-px bg-base-300"></div>
    {/if}

    <div class="flex items-center justify-between p-3 sm:p-4 hover:bg-base-50 transition-colors z-10 relative {depth === 0 ? 'rounded-[1.5rem]' : 'rounded-xl border border-base-200 bg-base-100 shadow-sm'}">
        <a href="/container/{encodeURIComponent(container.name)}" class="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-base-200 overflow-hidden shrink-0 border border-base-300 flex items-center justify-center">
                {#if container.photoPath}
                    <img class="w-full h-full object-cover" src="{container.photoPath}" alt="{container.name}"/>
                {:else}
                    <i class="bi bi-box-seam text-gray-400 text-lg sm:text-xl"></i>
                {/if}
            </div>
            <div class="flex-1 min-w-0 pr-2">
                <div class="font-semibold text-base sm:text-lg tracking-tight flex items-center gap-2 truncate">
                    {container.name}
                    {#if children.length > 0}
                        <span class="badge badge-sm badge-ghost text-[10px] uppercase font-bold text-gray-500">{children.length} Nested</span>
                    {/if}
                </div>
                <div class="text-xs text-gray-500 truncate flex gap-2">
                    {#if container.location}<span class="text-primary shrink-0"><i class="bi bi-geo-alt-fill"></i> {container.location}</span>{/if}
                    {#if container.description}<span class="truncate">{container.description}</span>{/if}
                </div>
            </div>
        </a>
        <div class="flex items-center gap-1 shrink-0 ml-2 relative z-20">
            <button type="button" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" on:click={() => dispatch('move', container)} aria-label="Move Container">
                <i class="bi bi-arrows-move text-lg"></i>
            </button>
            <a href="/container/{encodeURIComponent(container.name)}/edit" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" aria-label="Edit Container">
                <i class="bi bi-pencil text-lg"></i>
            </a>
            <button type="button" class="btn btn-ghost btn-circle btn-sm text-gray-400 hover:text-error hover:bg-error/10 transition-colors" on:click={() => dispatch('delete', container)} aria-label="Delete Container">
                <i class="bi bi-trash text-lg"></i>
            </button>
        </div>
    </div>

    {#if expanded && children.length > 0}
        <div class="flex flex-col pb-2" transition:slide|local={{duration: 200}}>
            {#each children as child (child.id)}
                <svelte:self container={child} {allContainers} depth={depth + 1} on:delete on:move />
            {/each}
        </div>
    {/if}
</div>
