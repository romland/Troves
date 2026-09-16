<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import { computePerspectiveGrid } from './perspective';
    import SpatialWarpHud from './SpatialWarpHud.svelte';
    import SpatialControls from './SpatialControls.svelte';
    import SpatialAuditOverlay from './SpatialAuditOverlay.svelte';
    import { getSharedEdges, getIntersections, calculateMergedEdge, calculateSplitCell, calculateMergedIntersection } from '$lib/client/spatialMath';
    const dispatch = createEventDispatcher();

    export let imageUrl: string;
    export let polygons: number[][][] = []; // Array of 4-point arrays: [[[x,y], [x,y], [x,y], [x,y]], ...]
    export let readonly: boolean = false;
    export let activePolyIndex: number | null = null;
    export let mappedEntities: any[] = [];
    export let auditSlots: { polygon: number[][], status: string, expectedItem?: any, detectedTitle?: string }[] = [];

    // Toggle for experimental perspective labels
    const EXPERIMENTAL_PERSPECTIVE_LABELS = false;

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
        const newState = JSON.stringify(polygons);
        console.log(`[DEBUG-UNDO] saveHistory called. Current stack size: ${history.length}`);
        if (history.length > 0 && history[history.length - 1] === newState) {
            console.log(`[DEBUG-UNDO] State identical to top of stack. Skipping save.`);
            return;
        }
        history.push(newState);
        if (history.length > 20) history.shift();
        history = history;
        console.log(`[DEBUG-UNDO] State pushed. New stack size: ${history.length}`);
    }

    export function undo() {
        console.log(`[DEBUG-UNDO] undo() requested. Stack size before pop: ${history.length}`);
        if (history.length > 0) {
            polygons = JSON.parse(history.pop()!);
            history = history;
            console.log(`[DEBUG-UNDO] State restored. Stack size after pop: ${history.length}`);
            dispatch('change', polygons);
        } else {
            console.log(`[DEBUG-UNDO] Cannot undo, stack is empty.`);
        }
    }

    export function reset() {
        polygons = JSON.parse(initialPolygonsStr);
        history = [];
        dispatch('change', polygons);
    }

    export function clearHistory() {
        console.log(`[DEBUG-UNDO] clearHistory() invoked. Wiping stack of size ${history.length}.`);
        history = [];
        initialPolygonsStr = JSON.stringify(polygons);
    }

    // Perspective Warp Mode State
    export let isWarpMode = false;
    export let warpCols = 5;
    export let warpRows = 4;
    export let warpCorners = [[100, 100], [900, 100], [900, 900], [100, 900]];
    
    $: previewGrid = isWarpMode ? computePerspectiveGrid(warpCols, warpRows, warpCorners) : [];

    $: isDragging = draggingPoint !== null || draggingPoly !== null;

    // --- INFINITE PAN & ZOOM CAMERA ---
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;
    let panStartX = 0;
    let panStartY = 0;

    function startPan(e: PointerEvent) {
        const target = e.target as HTMLElement;
        // Block pan ONLY on interactive elements: buttons, drag handles
        if (target.closest('button') || target.closest('.cursor-move')) return;
        
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        panStartX = e.clientX;
        panStartY = e.clientY;
    }

    function startDrag(polyIdx: number, ptIdx: number, e: PointerEvent) {
        if (readonly) return;
        console.log(`[DEBUG-UNDO] startDrag initiated on polygon ${polyIdx}, point ${ptIdx}.`);
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
        console.log(`[DEBUG-UNDO] startDragPoly initiated on polygon ${polyIdx}.`);
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

    $: sharedEdges = getSharedEdges(polygons);
    $: intersections = getIntersections(polygons);

    // Calculate polygon geometry and mapping state ONCE reactively
    $: enrichedPolys = polygons.map((poly, i) => {
        const isActive = activePolyIndex === i;
        const isMapped = !!mappedEntities[i];
        const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4;
        const cy = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4;
        const minY = Math.min(poly[0][1], poly[1][1], poly[2][1], poly[3][1]);
        const entity = mappedEntities[i] || {};
        return { poly, i, isActive, isMapped, cx, cy, minY, entity };
    });

    let lastEdgeTapTime = 0;
    let lastTapEdge: any = null;

    function handleEdgePointerDown(e: PointerEvent, edge: any) {
        if (readonly || isWarpMode) return;
        const now = Date.now();
        
        if (lastTapEdge === edge && (now - lastEdgeTapTime) < 400) {
            e.stopPropagation();
            e.preventDefault();
            console.log(`[DEBUG-SPATIAL-MAP] Edge double-tap! Merging cells ${edge.poly1} and ${edge.poly2}`);
            mergeEdge(edge);
            lastEdgeTapTime = 0;
            lastTapEdge = null;
            return;
        }
        lastEdgeTapTime = now;
        lastTapEdge = edge;
    }

    function mergeEdge(edge: any) {
        saveHistory();
        const res = calculateMergedEdge(edge, polygons);
        polygons = res.polygons;
        activePolyIndex = res.activeIndex;
        dispatch('change', polygons);
    }

    function splitCell(idx: number, mode: 'v' | 'h' | 'q') {
        saveHistory();
        const res = calculateSplitCell(idx, mode, polygons);
        polygons = res.polygons;
        activePolyIndex = null;
        dispatch('change', polygons);
    }

    let lastTapTime = 0;
    let lastTapIntersection: any = null;

    function handleIntersectionPointerDown(e: PointerEvent, intersection: any) {
        if (readonly || isWarpMode) return;
        e.stopPropagation();
        e.preventDefault();
        
        const now = Date.now();
        console.log(`[DEBUG-SPATIAL-MAP] Intersection tap. Time since last: ${now - lastTapTime}ms`);

        if (lastTapIntersection === intersection && (now - lastTapTime) < 400) {
            console.log(`[DEBUG-SPATIAL-MAP] Double-tap confirmed! Merging...`);
            mergeIntersection(intersection);
            lastTapTime = 0;
            lastTapIntersection = null;
            return;
        }
        
        lastTapTime = now;
        lastTapIntersection = intersection;
        
        console.log(`[DEBUG-SPATIAL-MAP] Starting drag on intersection.`);
        saveHistory();
        const basePt = intersection.points[0];
        activePolyIndex = basePt.pIdx;
        
        draggingPoint = {
            polyIdx: basePt.pIdx,
            ptIdx: basePt.ptIdx,
            sharedPoints: intersection.points.map((p: any) => ({ pIdx: p.pIdx, ptIdx: p.ptIdx }))
        };
        
        try { (e.target as Element).setPointerCapture(e.pointerId); } catch(err) {}
    }

    function mergeIntersection(intersection: any) {
        console.log(`[DEBUG-SPATIAL-MAP] Dissolving joint and merging ${intersection.points.length} polygons.`);
        saveHistory();
        
        const res = calculateMergedIntersection(intersection, polygons);
        if (res) {
            polygons = res.polygons;
            activePolyIndex = res.activeIndex;
            dispatch('change', polygons);
            console.log(`[DEBUG-SPATIAL-MAP] Merge complete. New polygon added at index ${activePolyIndex}.`);
        } else {
            console.warn(`[DEBUG-SPATIAL-MAP] Merge failed: Expected 4 outer corners.`);
        }
    }

    function handlePointerMove(e: PointerEvent) {
        if (isPanning) {
            panX += e.clientX - lastPanX;
            panY += e.clientY - lastPanY;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            return;
        }

        const svgP = getSvgPoint(e);
        if (!svgP) return;
        
        if (draggingPoint) {
            // Unlimited dragging: The auto-framer will keep it in view
            let x = svgP.x;
            let y = svgP.y;

            if (draggingPoint.polyIdx === -1) {
                warpCorners[draggingPoint.ptIdx] = [x, y];
                warpCorners = [...warpCorners]; // Trigger reactivity
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
                pt[0] + dx,
                pt[1] + dy
            ]);
            polygons = [...polygons];
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (isPanning) {
            isPanning = false;
            return;
        }

        if (draggingPoint || draggingPoly) {
            try {
                if ((e.target as Element).hasPointerCapture(e.pointerId)) {
                    (e.target as Element).releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
            draggingPoint = null;
            draggingPoly = null;
            console.log(`[DEBUG-UNDO] handlePointerUp completed drag. Dispatching change.`);
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
        // If the user was panning, ignore the click so we don't accidentally select a cell
        if (Math.abs(e.clientX - panStartX) > 5 || Math.abs(e.clientY - panStartY) > 5) return;
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
        console.log(`[DEBUG-SPATIAL-MAP] generateGhostGrid: cols=${cols}, rows=${rows}`);
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
        console.log(`[DEBUG-SPATIAL-MAP] Ghost grid generated ${polygons.length} polygons.`);
        dispatch('change', polygons);
    }

    export function bakeWarpGrid() {
        console.log(`[DEBUG-SPATIAL-MAP] bakeWarpGrid triggered. Cols=${warpCols}, Rows=${warpRows}`);
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

<div
    class="relative w-full h-[50vh] sm:h-[65vh] bg-base-300 rounded-[2rem] overflow-hidden shadow-inner border border-base-200">
    <SpatialControls 
        bind:zoomLevel 
        hasHistory={history.length > 0} 
        {readonly} 
        {isWarpMode} 
        on:recenter={() => { zoomLevel = 100; panX = 0; panY = 0; }}
        on:undo={undo}
        on:reset={reset}
    />

    {#if isWarpMode}
        <SpatialWarpHud 
            bind:warpCols 
            bind:warpRows 
            on:cancel={() => isWarpMode = false} 
            on:apply={bakeWarpGrid} 
        />

        <!-- Guidance Pill -->
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-base-100/95 backdrop-blur-xl px-4 sm:px-5 py-3 sm:py-4 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] border border-base-200/50 text-[11px] sm:text-sm font-medium text-base-content/80 flex items-center gap-3 sm:gap-4 text-left pointer-events-auto animate-fade-in w-[95%] max-w-[500px]">
            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-inner">
                <i class="bi bi-arrows-move text-xl sm:text-2xl"></i>
            </div>
            <div class="flex-1 leading-snug">
                <strong class="text-base-content block mb-0.5 sm:mb-1 font-bold text-sm sm:text-base">Align the grid perfectly</strong>
                Drag rings to match physical walls (adjust cols/rows if needed). If the photo cuts off the drawer, drag rings <em>outside</em> the image edge. We'll extrapolate the rest!
            </div>
        </div>
    {/if}

    <!-- Floating Apple-Style Hint -->
    {#if !isWarpMode && !readonly && polygons.length > 0}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-base-100/80 backdrop-blur-xl px-4 py-2 rounded-full shadow-lg border border-base-200/50 text-[10px] sm:text-xs font-medium text-base-content/80 flex items-center gap-2 pointer-events-none animate-fade-in whitespace-nowrap">
            <i class="bi bi-info-circle text-primary"></i>
            <span>Drag crosshairs to resize. <strong class="text-base-content font-bold">Double-tap</strong> corners or lines to merge compartments.</span>
        </div>
    {/if}

    <!-- Scrollable Canvas -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="w-full h-full relative overflow-hidden bg-base-300 select-none {isPanning ? 'cursor-grabbing' : 'cursor-grab'}" on:pointerdown={startPan} on:click={(e) => { if (Math.abs(e.clientX - panStartX) < 5 && Math.abs(e.clientY - panStartY) < 5) activePolyIndex = null; }}>
        <div class="absolute inset-0 flex items-center justify-center p-6 sm:p-12 pointer-events-none">
            <div class="relative origin-center shadow-2xl ring-1 ring-black/5 shrink-0 pointer-events-auto" style="width: {zoomLevel}%; transform: translate({panX}px, {panY}px); transition: width 0.2s ease-out;">
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
                    {:else if auditSlots.length > 0}
                        <SpatialAuditOverlay {auditSlots} bind:activePolyIndex on:selectAudit={(e) => dispatch('selectAudit', e.detail)} />
                    {:else}
                        <!-- STANDARD EDITOR MAP OVERLAY -->
                        {#each enrichedPolys as ep}
                            <!-- Base Polygon Area -->
                            <polygon 
                                points={ep.poly.map(p => p.join(',')).join(' ')} 
                                class="transition-colors duration-200 {ep.isActive ? 'fill-accent/40 stroke-accent stroke-[5px] drop-shadow-md' : (ep.isMapped ? 'fill-success/20 stroke-success/60 stroke-[3px] hover:fill-success/40' : 'fill-base-content/10 stroke-base-content/40 stroke-[3px] hover:fill-base-content/20')} cursor-pointer"
                                vector-effect="non-scaling-stroke"
                                on:click={(e) => makeActive(ep.i, e)}
                                on:pointerdown={(e) => startDragPoly(ep.i, e)}
                                on:dragover|preventDefault
                                on:drop={(e) => handleDrop(ep.i, e)}
                            />

                            {#if zoomLevel >= 250 && ep.isMapped && EXPERIMENTAL_PERSPECTIVE_LABELS}
                                <!-- 2.5D Affine Warp Projection -->
                                {@const w = Math.hypot(ep.poly[1][0] - ep.poly[0][0], ep.poly[1][1] - ep.poly[0][1]) || 1}
                                {@const h = Math.hypot(ep.poly[3][0] - ep.poly[0][0], ep.poly[3][1] - ep.poly[0][1]) || 1}
                                {@const ratio = h / w}
                                
                                {@const a = (ep.poly[1][0] - ep.poly[0][0]) / w}
                                {@const b = (ep.poly[1][1] - ep.poly[0][1]) / w}
                                {@const floorC = (ep.poly[3][0] - ep.poly[0][0]) / h}
                                {@const floorD = (ep.poly[3][1] - ep.poly[0][1]) / h}
                                
                                <!-- Smoothly transition from Floor plane to Wall plane as perspective steepens -->
                                {@const wallBlend = Math.max(0, Math.min(1, (0.8 - ratio) / 0.4))}
                                {@const c = floorC * (1 - wallBlend) + (-b) * wallBlend}
                                {@const d = floorD * (1 - wallBlend) + (a) * wallBlend}

                                <g transform="matrix({a}, {b}, {c}, {d}, {ep.cx}, {ep.cy})">
                                    <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" class="fill-transparent stroke-black/80 text-[14px] sm:text-[18px] font-black pointer-events-none hidden md:block" stroke-width="4" stroke-linejoin="round">
                                        {ep.entity.title || ep.entity.name}
                                    </text>
                                    <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" class="fill-white text-[14px] sm:text-[18px] font-black pointer-events-none hidden md:block">
                                        {ep.entity.title || ep.entity.name}
                                    </text>
                                </g>
                            {/if}
                        {/each}

                        {#if !readonly}
                            {#each sharedEdges as edge}
                                <line 
                                    x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                                    stroke="transparent" stroke-width="25"
                                    class="cursor-pointer pointer-events-auto hover:stroke-primary/40 transition-colors z-30"
                                    on:pointerdown={(e) => handleEdgePointerDown(e, edge)}
                                    on:click|stopPropagation
                                />
                            {/each}
                        {/if}
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
                        <!-- 4-Way Intersection Crosshair Targets -->
                        {#if !readonly}
                            {#each intersections as intersection}
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div 
                                    class="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-transparent hover:bg-primary/10 transition-colors z-40 flex items-center justify-center cursor-move pointer-events-auto"
                                    style="left: {intersection.x / 10}%; top: {intersection.y / 10}%;"
                                    on:pointerdown={(e) => handleIntersectionPointerDown(e, intersection)}
                                    on:click|stopPropagation
                                ><div class="w-1.5 h-1.5 bg-primary/40 rounded-full pointer-events-none"></div></div>
                            {/each}
                        {/if}

                        <!-- Consolidated Markers and Active Drag Handles -->
                        {#each enrichedPolys as ep}
                            {#if !ep.isActive}
                                {#if ep.isMapped}
                                    <div class="absolute w-7 h-7 -ml-3.5 -mt-3.5 bg-success rounded-full shadow-sm flex items-center justify-center pointer-events-none" style="left: {ep.cx / 10}%; top: {ep.cy / 10}%;">
                                        <i class="bi bi-check text-white text-2xl mt-0.5"></i>
                                    </div>
                                {:else}
                                    <div class="absolute w-3 h-3 -ml-1.5 -mt-1.5 bg-base-content/30 rounded-full pointer-events-none" style="left: {ep.cx / 10}%; top: {ep.cy / 10}%;"></div>
                                {/if}
                            {/if}

                            {#if ep.isMapped && zoomLevel >= 250 && !EXPERIMENTAL_PERSPECTIVE_LABELS}
                                <div class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none text-[8px] sm:text-[10px] font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] whitespace-nowrap hidden md:block" style="left: {ep.cx / 10}%; top: {ep.cy / 10}%; margin-top: 1.5rem;">
                                    <span class="truncate block px-1 py-0.5 bg-black/40 backdrop-blur-sm rounded max-w-[120px]">{ep.entity.title || ep.entity.name}</span>
                                </div>
                            {/if}

                            {#if ep.isActive && !readonly}
                                <!-- Corner Drag Handles -->
                                {#each ep.poly as pt, ptIdx}
                                    <div 
                                        class="absolute w-6 h-6 -ml-3 -mt-3 bg-base-100 rounded-full border-[3px] border-accent cursor-move drop-shadow-lg hover:border-[5px] transition-all pointer-events-auto"
                                        style="left: {pt[0] / 10}%; top: {pt[1] / 10}%;"
                                        on:pointerdown={(e) => startDrag(ep.i, ptIdx, e)}
                                        on:click|stopPropagation
                                    ></div>
                                {/each}

                                <!-- Split Actions Toolbar -->
                                <div 
                                    class="absolute w-max -translate-x-1/2 -translate-y-full -mt-3 pointer-events-auto bg-base-100/95 backdrop-blur-md shadow-lg rounded-full px-2 py-1.5 border border-base-200 flex items-center gap-1 animate-fade-in z-50"
                                    style="left: {ep.cx / 10}%; top: {ep.minY / 10}%;"
                                >
                                    <button class="btn btn-xs btn-ghost btn-circle text-gray-500 hover:text-primary hover:bg-primary/10" title="Split Vertically" on:click|stopPropagation={() => splitCell(ep.i, 'v')}><i class="bi bi-layout-split"></i></button>
                                    <button class="btn btn-xs btn-ghost btn-circle text-gray-500 hover:text-primary hover:bg-primary/10" title="Split Horizontally" on:click|stopPropagation={() => splitCell(ep.i, 'h')}><i class="bi bi-layout-split rotate-90"></i></button>
                                    <button class="btn btn-xs btn-ghost btn-circle text-gray-500 hover:text-primary hover:bg-primary/10" title="Split into 4" on:click|stopPropagation={() => splitCell(ep.i, 'q')}><i class="bi bi-grid"></i></button>
                                </div>

                                <!-- Action Center Button -->
                                <div 
                                    class="absolute w-16 h-16 -ml-8 -mt-8 cursor-pointer pointer-events-auto flex items-center justify-center"
                                    style="left: {ep.cx / 10}%; top: {ep.cy / 10}%;"
                                    on:click|stopPropagation={() => dispatch('select', ep.i)} 
                                    on:pointerdown|stopPropagation
                                >
                                    <div class="w-11 h-11 bg-base-100 rounded-full drop-shadow-xl hover:bg-base-200 transition-colors flex items-center justify-center relative">
                                        <div class="w-8 h-8 rounded-full flex items-center justify-center {ep.isMapped ? 'bg-success text-white' : 'bg-accent text-white'}">
                                            {#if ep.isMapped}
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
</div>

<style>
    @keyframes pulse-dash { 0%, 100% { stroke-opacity: 1; fill-opacity: 0.2; } 50% { stroke-opacity: 0.5; fill-opacity: 0.05; } }
    :global(.status-MATCH) { fill: oklch(var(--su)); stroke: oklch(var(--su)); opacity: 0.35; stroke-width: 2; }
    :global(.status-MISSING) { fill: oklch(var(--er)); stroke: oklch(var(--er)); stroke-width: 4; stroke-dasharray: 15 10; animation: pulse-dash 2s infinite; }
    :global(.status-ANOMALY) { fill: oklch(var(--wa)); stroke: oklch(var(--wa)); stroke-width: 4; fill-opacity: 0.3; }
    :global(.active-slot) { stroke-width: 6 !important; fill-opacity: 0.5 !important; filter: drop-shadow(0 0 10px currentColor); }
</style>