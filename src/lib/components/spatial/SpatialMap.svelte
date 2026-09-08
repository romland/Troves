<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import { computePerspectiveGrid } from './perspective';
    const dispatch = createEventDispatcher();

    export let imageUrl: string;
    export let polygons: number[][][] = []; // Array of 4-point arrays: [[[x,y], [x,y], [x,y], [x,y]], ...]
    export let readonly: boolean = false;
    export let activePolyIndex: number | null = null;
    export let mappedEntities: any[] = [];

    let svgNode: SVGSVGElement;
    let draggingPoint: { polyIdx: number, ptIdx: number, sharedPoints?: {pIdx: number, ptIdx: number}[] } | null = null;
    let draggingPoly: { polyIdx: number, startX: number, startY: number, initialPoints: number[][] } | null = null;
    
    const SNAP_THRESHOLD = 15; // 1.5% of viewBox
    let zoomLevel = 100;

    // History Management (Undo/Reset)
    let history: string[] = [];
    let initialPolygonsStr: string = "[]";
    
    onMount(() => {
        initialPolygonsStr = JSON.stringify(polygons);
    });

    function saveHistory() {
        history.push(JSON.stringify(polygons));
        if (history.length > 20) history.shift();
        history = history;
    }

    export function undo() {
        if (history.length > 0) {
            polygons = JSON.parse(history.pop()!);
            dispatch('change', polygons);
        }
    }

    export function reset() {
        polygons = JSON.parse(initialPolygonsStr);
        history = [];
        dispatch('change', polygons);
    }

    // Perspective Warp Mode State
    export let isWarpMode = false;
    export let warpCols = 5;
    export let warpRows = 4;
    export let warpCorners = [[100, 100], [900, 100], [900, 900], [100, 900]];
    
    $: previewGrid = isWarpMode ? computePerspectiveGrid(warpCols, warpRows, warpCorners) : [];

    function startDrag(polyIdx: number, ptIdx: number, e: PointerEvent) {
        if (readonly) return;
        saveHistory();
        let sharedPoints = [];
        if (polyIdx !== -1) {
            activePolyIndex = polyIdx;
            // Find all points sharing this exact coordinate to drag them together (Intersection Dragging)
            const startPt = polygons[polyIdx][ptIdx];
            for (let i = 0; i < polygons.length; i++) {
                for (let j = 0; j < 4; j++) {
                    if (Math.abs(polygons[i][j][0] - startPt[0]) < 2 && Math.abs(polygons[i][j][1] - startPt[1]) < 2) {
                        sharedPoints.push({ pIdx: i, ptIdx: j });
                    }
                }
            }
        }
        
        draggingPoint = { polyIdx, ptIdx, sharedPoints };
        
        if (polyIdx !== -1) {
            activePolyIndex = polyIdx;
        }
        
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
    }

    function startDragPoly(polyIdx: number, e: PointerEvent) {
        if (readonly || activePolyIndex !== polyIdx) return;
        const pt = getSvgPoint(e);
        if (!pt) return;
        saveHistory();
        draggingPoly = { polyIdx, startX: pt.x, startY: pt.y, initialPoints: JSON.parse(JSON.stringify(polygons[polyIdx])) };
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
    }

    function getSvgPoint(e: PointerEvent) {
        if (!svgNode) return null;
        const pt = svgNode.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const ctm = svgNode.getScreenCTM()?.inverse();
        return ctm ? pt.matrixTransform(ctm) : null;
    }

    function handlePointerMove(e: PointerEvent) {
        const svgP = getSvgPoint(e);
        if (!svgP) return;
        
        if (draggingPoint) {
            // Allow points to be dragged outside the image boundaries (e.g. if container is cropped)
            let x = Math.max(-1000, Math.min(2000, svgP.x));
            let y = Math.max(-1000, Math.min(2000, svgP.y));

            if (draggingPoint.polyIdx === -1) {
                warpCorners[draggingPoint.ptIdx] = [x, y];
                return; // Trigger reactivity natively
            }
            
            // Magnetic Snap-to-Edge logic against all other polygons
            const draggedPolyIndices = new Set(draggingPoint.sharedPoints?.map(sp => sp.pIdx) || []);
            for (let i = 0; i < polygons.length; i++) {
                if (draggedPolyIndices.has(i)) continue;
                for (const targetPt of polygons[i]) {
                    if (Math.abs(x - targetPt[0]) < SNAP_THRESHOLD && Math.abs(y - targetPt[1]) < SNAP_THRESHOLD) {
                        x = targetPt[0];
                        y = targetPt[1];
                    }
                }
            }
            
            if (draggingPoint.sharedPoints) {
                draggingPoint.sharedPoints.forEach(sp => {
                    polygons[sp.pIdx][sp.ptIdx] = [x, y];
                });
            } else {
                polygons[draggingPoint.polyIdx][draggingPoint.ptIdx] = [x, y];
            }
            polygons = [...polygons];
        } else if (draggingPoly) {
            const dx = svgP.x - draggingPoly.startX;
            const dy = svgP.y - draggingPoly.startY;
            polygons[draggingPoly.polyIdx] = draggingPoly.initialPoints.map(pt => [
                Math.max(-1000, Math.min(2000, pt[0] + dx)),
                Math.max(-1000, Math.min(2000, pt[1] + dy))
            ]);
            polygons = [...polygons];
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (draggingPoint || draggingPoly) {
            try {
                if ((e.target as Element).hasPointerCapture(e.pointerId)) {
                    (e.target as Element).releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
            draggingPoint = null;
            draggingPoly = null;
            if (isWarpMode) {
                // Update preview
            } else {
                dispatch('change', polygons);
            }
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!readonly && (e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
    }

    function makeActive(idx: number, e: MouseEvent) {
        e.stopPropagation();
        activePolyIndex = idx;
    }

    function handleDrop(idx: number, e: DragEvent) {
        e.preventDefault();
        const data = e.dataTransfer?.getData('text/plain');
        if (data) {
            dispatch('assign', { polygonIndex: idx, polygon: polygons[idx], entity: JSON.parse(data) });
        }
    }

    export function generateGhostGrid(cols: number, rows: number) {
        saveHistory();
        const newPolys: number[][][] = [];
        const cellW = 1000 / cols;
        const cellH = 1000 / rows;
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x1 = c * cellW, y1 = r * cellH;
                const x2 = x1 + cellW, y2 = y1;
                const x3 = x2, y3 = y1 + cellH;
                const x4 = x1, y4 = y3;
                newPolys.push([[x1, y1], [x2, y2], [x3, y3], [x4, y4]]);
            }
        }
        polygons = newPolys;
        dispatch('change', polygons);
    }

    export function bakeWarpGrid() {
        saveHistory();
        polygons = computePerspectiveGrid(warpCols, warpRows, warpCorners);
        isWarpMode = false;
        dispatch('change', polygons);
    }

    export function enterWarpMode() {
        // If we open a grid with polygons but the corners are purely default,
        // fall back to estimating the bounding box.
        if (polygons.length > 0 && JSON.stringify(warpCorners) === JSON.stringify([[100, 100], [900, 100], [900, 900], [100, 900]])) {
            let minX = 1000, minY = 1000, maxX = 0, maxY = 0;
            polygons.forEach(p => p.forEach(pt => {
                if (pt[0] < minX) minX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] > maxY) maxY = pt[1];
            }));
            warpCorners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
        }
        isWarpMode = true;
    }
</script>

<svelte:window 
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
    on:keydown={handleKeydown}
/>

<div class="relative w-full h-[50vh] sm:h-[65vh] bg-base-300 rounded-[2rem] overflow-hidden shadow-inner border border-base-200">
    <!-- Floating Apple-Style Zoom Pill -->
    <div class="absolute top-6 right-6 z-40 flex gap-2 bg-base-100/80 backdrop-blur-xl p-1.5 rounded-full shadow-lg border border-base-200/50 items-center transition-all">
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button class="btn btn-circle btn-sm btn-ghost text-base-content/70" on:click|stopPropagation={() => zoomLevel = Math.max(100, zoomLevel - 50)}><i class="bi bi-dash text-lg"></i></button>
        <div class="text-xs font-bold w-12 text-center select-none text-base-content/80">{zoomLevel}%</div>
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button class="btn btn-circle btn-sm btn-ghost text-base-content/70" on:click|stopPropagation={() => zoomLevel = Math.min(500, zoomLevel + 50)}><i class="bi bi-plus text-lg"></i></button>
    </div>

    {#if history.length > 0 && !isWarpMode && !readonly}
        <div class="absolute top-6 left-6 z-40 flex gap-2 animate-fade-in">
            <button class="btn btn-circle btn-sm btn-ghost bg-base-100/80 backdrop-blur-xl shadow-md border border-base-200" on:click|stopPropagation={undo} title="Undo (Ctrl+Z)"><i class="bi bi-arrow-counterclockwise text-base-content/70"></i></button>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-100/80 backdrop-blur-xl shadow-md border border-base-200" on:click|stopPropagation={reset} title="Reset to last save"><i class="bi bi-trash text-error/70"></i></button>
        </div>
    {/if}

    <!-- Floating Apple-Style Warp HUD -->
    {#if isWarpMode}
    <div class="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col sm:flex-row gap-3 bg-base-100/80 backdrop-blur-2xl p-2 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.3)] border border-base-200/50 items-center animate-fade-in">
        <div class="flex items-center gap-2 px-2">
            <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/60">Cols</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" on:click={() => warpCols = Math.max(1, warpCols - 1)}><i class="bi bi-dash"></i></button>
            <span class="font-mono w-4 text-center font-bold text-base-content">{warpCols}</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" on:click={() => warpCols++}><i class="bi bi-plus"></i></button>
        </div>
        <div class="w-px h-6 bg-base-300 hidden sm:block"></div>
        <div class="flex items-center gap-2 px-2">
            <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/60">Rows</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" on:click={() => warpRows = Math.max(1, warpRows - 1)}><i class="bi bi-dash"></i></button>
            <span class="font-mono w-4 text-center font-bold text-base-content">{warpRows}</span>
            <button class="btn btn-circle btn-sm btn-ghost bg-base-200/50" on:click={() => warpRows++}><i class="bi bi-plus"></i></button>
        </div>
        <div class="flex gap-2 w-full sm:w-auto px-1">
            <button class="btn btn-ghost btn-sm rounded-xl flex-1 hover:bg-base-200" on:click={() => { isWarpMode = false; }}>Cancel</button>
            <button class="btn btn-primary btn-sm rounded-xl shadow-sm flex-1" on:click={bakeWarpGrid}>Apply</button>
        </div>
    </div>
    {/if}

    <!-- Scrollable Canvas -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="w-full h-full overflow-auto custom-scrollbar px-4 sm:px-8 pt-24 sm:pt-28 pb-24 sm:pb-28" on:click={() => activePolyIndex = null}>
        <div class="relative origin-top-left transition-all duration-200 mx-auto shadow-2xl ring-1 ring-black/5" style="width: {zoomLevel}%;">
            <img src={imageUrl} alt="Container map" class="w-full h-auto block pointer-events-none" />
            
            <svg 
                bind:this={svgNode} 
                viewBox="0 0 1000 1000" 
                preserveAspectRatio="none" 
                class="absolute inset-0 w-full h-full cursor-crosshair z-10 overflow-visible"
            >
                {#if isWarpMode}
                    <!-- Render the Projected Inner Grid as a Preview -->
                    {#each previewGrid as poly}
                        <polygon points={poly.map(p => p.join(',')).join(' ')} class="fill-accent/10 stroke-accent/50 stroke-[2px] pointer-events-none" vector-effect="non-scaling-stroke" />
                    {/each}
                {:else}
                    {#each polygons as poly, i}
                        {@const isActive = activePolyIndex === i}
                        {@const isMapped = !!mappedEntities[i]}
                        {@const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4}
                        {@const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4}
                        <!-- Base Polygon Area -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <polygon 
                            points={poly.map(p => p.join(',')).join(' ')} 
                            class="transition-colors duration-200 {isActive ? 'fill-accent/40 stroke-accent stroke-[5px] drop-shadow-md' : (isMapped ? 'fill-success/20 stroke-success/60 stroke-[3px] hover:fill-success/40' : 'fill-base-content/10 stroke-base-content/40 stroke-[3px] hover:fill-base-content/20')} cursor-pointer"
                                vector-effect="non-scaling-stroke"
                                on:click={(e) => makeActive(i, e)}
                            on:pointerdown={(e) => startDragPoly(i, e)}
                            on:dragover|preventDefault
                            on:drop={(e) => handleDrop(i, e)}
                        />
                        {#if zoomLevel >= 250 && isMapped}
                            <text x={cx} y={cy} text-anchor="middle" dominant-baseline="middle" class="fill-white text-[12px] font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] hidden md:block pointer-events-none">
                                {mappedEntities[i].title || mappedEntities[i].name}
                            </text>
                        {/if}
                    {/each}
                {/if}
            </svg>

                            
            <!-- HTML OVERLAY FOR PERFECT CIRCLES -->
            <div class="absolute inset-0 w-full h-full z-20 pointer-events-none overflow-visible">
                {#if isWarpMode}
                    <!-- 4 Master Drag Handles -->
                    {#each warpCorners as pt, ptIdx}
                        <div 
                            class="absolute w-8 h-8 -ml-4 -mt-4 bg-base-100 rounded-full border-[4px] border-secondary cursor-move drop-shadow-xl hover:border-[6px] hover:bg-secondary transition-all pointer-events-auto"
                            style="left: {pt[0] / 10}%; top: {pt[1] / 10}%;"
                            on:pointerdown={(e) => startDrag(-1, ptIdx, e)}
                            on:click|stopPropagation
                        ></div>
                    {/each}
                {:else}
                    <!-- Center Markers (Not Active) -->
                    {#each polygons as poly, i}
                        {@const isActive = activePolyIndex === i}
                        {@const isMapped = !!mappedEntities[i]}
                        {@const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4}
                        {@const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4}
                        
                        {#if !isActive}
                            {#if isMapped}
                                <div class="absolute w-7 h-7 -ml-3.5 -mt-3.5 bg-success rounded-full shadow-sm flex items-center justify-center pointer-events-none" style="left: {cx / 10}%; top: {cy / 10}%;">
                                    <i class="bi bi-check text-white text-2xl mt-0.5"></i>
                                </div>
                            {:else}
                                <div class="absolute w-3 h-3 -ml-1.5 -mt-1.5 bg-base-content/30 rounded-full pointer-events-none" style="left: {cx / 10}%; top: {cy / 10}%;"></div>
                            {/if}
                        {/if}

                            {#if isMapped && zoomLevel >= 250}
                                <div class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none text-[8px] sm:text-[10px] font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] whitespace-nowrap hidden md:block" style="left: {cx / 10}%; top: {cy / 10}%; margin-top: 1.5rem;">
                                    <span class="truncate block px-1 py-0.5 bg-black/40 backdrop-blur-sm rounded max-w-[120px]">{mappedEntities[i].title || mappedEntities[i].name}</span>
                                </div>
                            {/if}
                    {/each}

                    <!-- Active Handles -->
                    {#each polygons as poly, i}
                        {@const isActive = activePolyIndex === i}
                        {@const isMapped = !!mappedEntities[i]}
                        {@const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4}
                        {@const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4}

                        {#if isActive && !readonly}
                            <!-- Corner Drag Handles -->
                            {#each poly as pt, ptIdx}
                                <div 
                                    class="absolute w-6 h-6 -ml-3 -mt-3 bg-base-100 rounded-full border-[3px] border-accent cursor-move drop-shadow-lg hover:border-[5px] transition-all pointer-events-auto"
                                    style="left: {pt[0] / 10}%; top: {pt[1] / 10}%;"
                                    on:pointerdown={(e) => startDrag(i, ptIdx, e)}
                                    on:click|stopPropagation
                                ></div>
                            {/each}

                            <!-- Action Center Button -->
                            <div 
                                class="absolute w-16 h-16 -ml-8 -mt-8 cursor-pointer pointer-events-auto flex items-center justify-center"
                                style="left: {cx / 10}%; top: {cy / 10}%;"
                                on:click|stopPropagation={() => dispatch('select', i)} 
                                on:pointerdown|stopPropagation
                            >
                                <div class="w-11 h-11 bg-base-100 rounded-full drop-shadow-xl hover:bg-base-200 transition-colors flex items-center justify-center relative">
                                    <div class="w-8 h-8 rounded-full flex items-center justify-center {isMapped ? 'bg-success text-white' : 'bg-accent text-white'}">
                                        {#if isMapped}
                                            <i class="bi bi-check text-2xl mt-0.5"></i>
                                        {:else}
                                            <i class="bi bi-three-dots text-lg"></i>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>
