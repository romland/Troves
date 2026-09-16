<script lang="ts">
    import { onMount } from 'svelte';
    import { parseColorMix, BASE_COLORS, BASE_COLORS_RGB } from '$lib/shared/colors';

    export let initialMixStr: string = "[]";
    export let valueStr: string = "[]";

    let segments: { name: string, pct: number, hex: string }[] = [];
    let originalSegments: { name: string, pct: number, hex: string }[] = [];
    let isDirty = false;
    let barRef: HTMLElement;
    let activeIdx: number = -1;

    let isDragging = false;
    let dragIdx = -1;
    let startX = 0;
    let startPct1 = 0;
    let startPct2 = 0;

    onMount(() => {
        originalSegments = parseColorMix(initialMixStr);
        segments = JSON.parse(JSON.stringify(originalSegments));
        updateValue();
    });

    function updateValue() {
        const out = segments.map(s => ({ color: s.name, pct: Number(s.pct.toFixed(3)) }));
        valueStr = JSON.stringify(out);
    }

    function startDrag(e: PointerEvent, idx: number) {
        isDragging = true;
        dragIdx = idx;
        startX = e.clientX;
        startPct1 = segments[idx].pct;
        startPct2 = segments[idx + 1].pct;
        activeIdx = -1; // clear active selection

        window.addEventListener('pointermove', onDrag);
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);
        if (navigator.vibrate) navigator.vibrate(10);
    }

    function onDrag(e: PointerEvent) {
        if (!isDragging || !barRef) return;
        
        const deltaX = e.clientX - startX;
        const barWidth = barRef.clientWidth;
        const deltaPct = deltaX / barWidth;

        let newPct1 = startPct1 + deltaPct;
        let newPct2 = startPct2 - deltaPct;

        const MIN = 0.05; // 5% minimum width per color
        if (newPct1 < MIN) {
            newPct2 -= (MIN - newPct1);
            newPct1 = MIN;
        }
        if (newPct2 < MIN) {
            newPct1 -= (MIN - newPct2);
            newPct2 = MIN;
        }

        segments[dragIdx].pct = newPct1;
        segments[dragIdx + 1].pct = newPct2;
        segments = [...segments];
        isDirty = true;
        updateValue();
    }

    function stopDrag() {
        isDragging = false;
        dragIdx = -1;
        window.removeEventListener('pointermove', onDrag);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);
    }

    function toggleActive(idx: number) {
        if (isDragging) return;
        activeIdx = activeIdx === idx ? -1 : idx;
    }

    function removeColor(idx: number) {
        const removed = segments.splice(idx, 1)[0];
        if (segments.length > 0) {
            const dist = removed.pct / segments.length;
            segments.forEach(s => s.pct += dist);
        }
        segments = [...segments];
        activeIdx = -1;
        isDirty = true;
        updateValue();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function addColor(colorName: string) {
        const existing = segments.find(s => s.name.toLowerCase() === colorName.toLowerCase());
        if (existing) {
            // Tap existing puck to highlight it for removal
            activeIdx = segments.indexOf(existing);
            return;
        }
        
        const rgb = BASE_COLORS_RGB[Object.keys(BASE_COLORS_RGB).find(k => k.toLowerCase() === colorName.toLowerCase()) as string];
        const hex = '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');

        const newColor = { name: colorName.toLowerCase(), pct: 0.1, hex };
        
        // Squeeze existing colors by 10%
        const scale = 0.9;
        segments.forEach(s => s.pct *= scale);
        segments.push(newColor);
        
        segments = [...segments];
        isDirty = true;
        activeIdx = -1; // Let the user see the new label instead of the delete button
        updateValue();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function reset() {
        segments = JSON.parse(JSON.stringify(originalSegments));
        isDirty = false;
        activeIdx = -1;
        updateValue();
    }
</script>

<div class="flex flex-col gap-4 select-none w-full">
    <!-- The iOS-style tactile storage bar -->
    <div bind:this={barRef} class="flex w-full h-14 rounded-2xl overflow-hidden shadow-inner border border-base-300 bg-base-200 relative">
        {#if segments.length === 0}
            <div class="w-full h-full flex items-center justify-center text-xs text-gray-400 font-semibold uppercase tracking-wider">Tap a color below to add</div>
        {/if}
        
        {#each segments as seg, i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="h-full relative flex items-center justify-center cursor-pointer {isDragging ? '' : 'transition-[width] duration-150 ease-out'}" 
                 style="width: {seg.pct * 100}%; background-color: {seg.hex};"
                 on:click={() => toggleActive(i)}>
                
                {#if activeIdx === i}
                    <div class="absolute inset-0 bg-black/40 flex items-center justify-center animate-fade-in">
                        <button type="button" class="bg-white/90 hover:bg-white text-black w-8 h-8 rounded-full shadow-lg flex items-center justify-center" 
                                on:click|stopPropagation={() => removeColor(i)} aria-label="Remove color">
                            <i class="bi bi-x-lg text-lg leading-none"></i>
                        </button>
                    </div>
                {:else if seg.pct >= 0.095}
                    <span class="bg-black/40 backdrop-blur-md text-white px-1.5 py-0.5 rounded shadow-sm font-bold text-[10px] uppercase tracking-wider pointer-events-none truncate">
                        {seg.name} ({Math.round(seg.pct * 100)}%)
                    </span>
                {/if}
            </div>
            
            {#if i < segments.length - 1}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="w-8 -ml-4 -mr-4 h-full relative z-10 flex items-center justify-center cursor-col-resize group touch-none"
                     on:pointerdown={(e) => startDrag(e, i)}>
                    <div class="w-1.5 h-6 bg-white/50 group-hover:bg-white group-active:bg-white rounded-full shadow-sm transition-colors"></div>
                </div>
            {/if}
        {/each}
    </div>

    <div class="w-full flex flex-col">
        <!-- Full-width scrolling pucks -->
        <div class="flex gap-2 overflow-x-auto hide-scrollbar pb-2 px-1 w-full after:content-[''] after:w-2 after:shrink-0">
            {#each Object.keys(BASE_COLORS_RGB) as colorName}
                    <button type="button" class="w-8 h-8 shrink-0 rounded-full shadow-sm border-2 {segments.some(s => s.name.toLowerCase() === colorName.toLowerCase()) ? 'border-primary ring-2 ring-primary/30 opacity-50' : 'border-base-200 hover:border-base-300'}"
                        style="background-color: #{BASE_COLORS_RGB[colorName].map(x => x.toString(16).padStart(2, '0')).join('')}"
                        on:click={() => addColor(colorName)} aria-label="Add {colorName}"></button>
            {/each}
        </div>
        <!-- Dedicated reset row to prevent layout shift and overlapping -->
        <div class="flex justify-end h-6 mt-1">
            {#if isDirty}
                <button type="button" class="btn btn-ghost btn-xs text-gray-500 hover:text-primary animate-fade-in font-normal" on:click={reset}><i class="bi bi-arrow-counterclockwise"></i> Reset</button>
            {/if}
        </div>
    </div>
</div>