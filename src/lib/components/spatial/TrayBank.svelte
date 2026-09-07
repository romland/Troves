<script lang="ts">
    export let entities: { id: number, type: 'container' | 'item', name: string, hasMap: boolean }[] = [];
    
    function handleDragStart(e: DragEvent, entity: any) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', JSON.stringify(entity));
        e.dataTransfer.effectAllowed = 'link';
    }
</script>

<div class="bg-base-200/50 border border-base-300 rounded-2xl p-3 flex flex-col gap-2">
    <div class="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex justify-between">
        <span>Tray Bank</span>
        <span>{entities.filter(e => !e.hasMap).length} Unmapped</span>
    </div>
    
    <div class="flex overflow-x-auto gap-2 pb-2 hide-scrollbar snap-x">
        {#each entities as entity (entity.type + entity.id)}
            <div 
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, entity)}
                class="snap-center shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-grab active:cursor-grabbing {entity.hasMap ? 'bg-base-100 border-base-300 opacity-50' : 'bg-base-100 border-primary shadow-sm hover:scale-105'}"
            >
                <i class="bi {entity.type === 'container' ? 'bi-box-seam' : 'bi-tag'} {entity.hasMap ? 'text-gray-400' : 'text-primary'}"></i>
                <span class="text-xs font-semibold whitespace-nowrap max-w-[120px] truncate">{entity.name}</span>
            </div>
        {:else}
            <div class="text-xs text-gray-400 italic p-2">No unmapped items or trays here.</div>
        {/each}
    </div>
</div>