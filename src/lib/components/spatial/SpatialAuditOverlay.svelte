<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
    export let auditSlots: any[];
    export let activePolyIndex: number | null;
</script>

{#each auditSlots as slot, i}
    {@const isActive = activePolyIndex === i}
    {@const isDimmed = activePolyIndex !== null && !isActive}
    {@const cx = (slot.polygon[0][0] + slot.polygon[1][0] + slot.polygon[2][0] + slot.polygon[3][0]) / 4}
    {@const cy = (slot.polygon[0][1] + slot.polygon[1][1] + slot.polygon[2][1] + slot.polygon[3][1]) / 4}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <g class="cursor-pointer transition-all duration-300 {isDimmed ? 'opacity-30 grayscale' : 'opacity-100 hover:opacity-80'}" on:click|stopPropagation={() => dispatch('selectAudit', i)}>
        <polygon 
            points={slot.polygon.map((pt: number[]) => pt.join(',')).join(' ')} 
            class="transition-colors duration-300 status-{slot.status} {isActive ? 'active-slot' : ''}" 
            vector-effect="non-scaling-stroke" stroke-linejoin="round"
        />
        <!-- Colorblind accessible iconography overlay -->
        {#if slot.status === 'MATCH'}
            <foreignObject x={cx - 15} y={cy - 15} width="30" height="30" class="overflow-visible pointer-events-none" xmlns="http://www.w3.org/1999/xhtml">
                <div class="w-[30px] h-[30px] shrink-0 aspect-square rounded-full bg-success text-success-content flex items-center justify-center shadow-lg border-2 border-white/20"><i class="bi bi-check-lg text-lg drop-shadow-md"></i></div>
            </foreignObject>
        {:else if slot.status === 'MISSING'}
            <foreignObject x={cx - 15} y={cy - 15} width="30" height="30" class="overflow-visible pointer-events-none" xmlns="http://www.w3.org/1999/xhtml">
                <div class="w-[30px] h-[30px] shrink-0 aspect-square rounded-full bg-error text-error-content flex items-center justify-center shadow-lg border-2 border-white/20"><i class="bi bi-x-lg text-sm drop-shadow-md"></i></div>
            </foreignObject>
        {:else if slot.status === 'ANOMALY'}
            <foreignObject x={cx - 15} y={cy - 15} width="30" height="30" class="overflow-visible pointer-events-none" xmlns="http://www.w3.org/1999/xhtml">
                <div class="w-[30px] h-[30px] shrink-0 aspect-square rounded-full bg-warning text-warning-content flex items-center justify-center shadow-lg border-2 border-white/20"><i class="bi bi-question-lg text-lg drop-shadow-md"></i></div>
            </foreignObject>
        {/if}
    </g>
{/each}
