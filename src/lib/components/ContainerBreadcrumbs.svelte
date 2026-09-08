<script lang="ts">
    export let containerId: number;
    export let containers: any[] = [];
    
    $: path = (() => {
        let res = [];
        let curr = containers.find(c => c.id === containerId);
        let safe = 0;
        while (curr && safe < 15) {
            res.unshift(curr);
            curr = containers.find(c => c.id === curr.parentId);
            safe++;
        }
        // If the path includes the immediate container itself, we typically pop it 
        // so the breadcrumbs represent the *ancestors*. 
        if (res.length > 0) res.pop(); 
        return res;
    })();
</script>

{#if path.length > 0}
    <div class="flex flex-wrap items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold leading-none mb-1">
        {#each path as node, i}
            <a href="/container/{encodeURIComponent(node.name)}" class="hover:text-primary transition-colors truncate max-w-[120px]" title={node.name}>{node.name}</a>
            {#if i < path.length - 1}<i class="bi bi-chevron-right text-[8px] opacity-50 mx-0.5"></i>{/if}
        {/each}
    </div>
{/if}