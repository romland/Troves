<script lang="ts">
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import { createEventDispatcher, onMount } from 'svelte';
    import { beforeNavigate } from '$app/navigation';
    import { page } from "$app/stores";
    import ARImagePreview from './ARImagePreview.svelte';
    import CompareEmptyState from './CompareEmptyState.svelte';
    import CompareItemCard from './CompareItemCard.svelte';
    import CompareAttributeSheet from './CompareAttributeSheet.svelte';
    import BottomSheet from "$lib/components/BottomSheet.svelte";
    import StatTab from './StatTab.svelte';
    import ActionCard from '../ActionCard.svelte';
    import SpatialMap from "$lib/components/spatial/SpatialMap.svelte";
    import { ambientLocation } from '$lib/client/ambientContext';

    export let results: {
        draftPath: string;
        totalDetected: number;
        inCollection: any[];
        newToYou: any[];
        missingFromScope: any[];
        scopeType?: string;
        scopeValue?: string;
        activeSchema?: any[];
    };
    export let containerSpatialBaseline: any[] = [];
    export let containers: any[] = [];
    export let categories: any[] = [];
    export let tags: any[] = [];

    const dispatch = createEventDispatcher();
    let savingTitles: Set<string> = new Set();
    let lightbox: ImageLightbox;
    let mergeModal: BottomSheet;
    let mergeSourceItem: any = null;
    let filterModal: BottomSheet;
    let isRefiltering = false;
    let autoGuessed = false;
    let strictAuditMode = false;

    let actionModal: BottomSheet;
    let actionItem: any = null;

    let attributeSheetModal: HTMLDialogElement;
    let pendingItemForAdd: any = null;
    let pendingTarget: 'inventory' | 'to buy' | 'todo' | null = null;

    $: scopeType = results.scopeType || 'all';
    $: scopeValue = results.scopeValue || '';
    
    const normalizeStr = (s: string) => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    // The Stacking Engine
    function groupDetected(items: any[]) {
        const groups: any = {};
        for (const item of items) {
            const key = normalizeStr(item.matchedItem ? item.matchedItem.title : item.title);
            if (!groups[key]) groups[key] = { ...item, count: 0 };
            groups[key].count++;
        }
        return Object.values(groups);
    }

    // Raw flat arrays needed for the bulk action footers
    $: unregistered = results.newToYou || [];
    $: correct = (results.inCollection || []).filter(i => scopeType !== 'container' || i.matchedItem?.locationName === scopeValue);
    $: elsewhere = (results.inCollection || []).filter(i => scopeType === 'container' && i.matchedItem?.locationName !== scopeValue);

    // Compute human-intent categories (Grouped for Stacking)
    $: groupedUnregistered = groupDetected(results.newToYou || []) as any[];
    $: groupedCorrect = groupDetected(correct) as any[];
    $: groupedElsewhere = groupDetected(elsewhere) as any[];

    // Consolidate completely missing items
    $: completelyMissing = (() => {
        const groups: any = {};
        for (const m of (results.missingFromScope || [])) {
            const norm = normalizeStr(m.title);

            // If we found AT LEAST ONE in the photo, the shortfalls logic handles it. Skip here!
            if ((results.inCollection || []).some(c => normalizeStr(c.matchedItem.title) === norm)) continue;

            if (!groups[norm]) groups[norm] = { ...m, expected: 0, count: 0 };
            groups[norm].expected += (m.amount || 1);
        }
        return Object.values(groups);
    })();

    // Audit missing items (calculate shortfalls)
    $: missingShortfalls = (() => {
        if (!strictAuditMode) return [];
        const allMatchedGroups = groupDetected(results.inCollection || []);
        const shortfalls = [];
        for (const mg of (allMatchedGroups as any[])) {
            const expected = mg.matchedItem.dbTotalAmount || 1;
            if (mg.count < expected) {
                shortfalls.push({
                    id: mg.matchedItem.id,
                    title: mg.matchedItem.title,
                    slug: mg.matchedItem.slug,
                    locationName: mg.matchedItem.locationName,
                    expected: expected,
                    count: mg.count,
                    isShortfall: true,
                    box: mg.box,
                    spatialMap: mg.matchedItem.spatialMap
                });
            }
        }
        return shortfalls;
    })();

    // Final Missing List
    $: missing = [...completelyMissing, ...missingShortfalls];

    let activeTab: 'unregistered' | 'missing' | 'elsewhere' | 'correct' = 'unregistered';
    
    $: activeInvName = $page.data.inventories?.find((i) => i.id === $page.data.activeInventoryId)?.name || 'Inventory';

    // Late binding logic: Auto-select the most emotionally relevant tab upon scan completion
    $: if (results) {
        if (scopeType === 'all') activeTab = (results.newToYou?.length || 0) > 0 ? 'unregistered' : 'correct';
        else activeTab = missing.length > 0 ? 'missing' : (groupedElsewhere.length > 0 ? 'elsewhere' : (groupedUnregistered.length > 0 ? 'unregistered' : 'correct'));
    }

    onMount(() => {
        // Auto-guess intent if the user didn't pre-filter
        if (results.scopeType === 'all' && (results.inCollection.length > 0 || results.newToYou.length > 0)) {
            const catCounts: Record<string, number> = {};
            const locCounts: Record<string, number> = {};
            
            const allDetected = [...results.inCollection, ...results.newToYou];
            
            allDetected.forEach(i => {
                const cat = i.category?.toLowerCase();
                if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
            });
            results.inCollection.forEach(i => {
                const loc = i.matchedItem?.locationName;
                if (loc) locCounts[loc] = (locCounts[loc] || 0) + 1;
            });
            
            let bestCat = '', bestLoc = '';
            let maxCat = 0, maxLoc = 0;
            
            for (const [k, v] of Object.entries(catCounts)) if (v > maxCat) { maxCat = v; bestCat = k; }
            for (const [k, v] of Object.entries(locCounts)) if (v > maxLoc) { maxLoc = v; bestLoc = k; }

            // If >50% of detected items belong to a known category, auto-scope to it!
            if (maxCat >= allDetected.length / 2 && maxCat > 0) {
                const realCat = categories.find(c => c.name.toLowerCase() === bestCat);
                if (realCat) { autoGuessed = true; updateScope('category', realCat.name); return; }
            }
            
            // Fallback: If >50% of matched items are in one specific box, auto-scope to it!
            if (maxLoc >= results.inCollection.length / 2 && maxLoc > 0) {
                const realLoc = containers.find(c => c.name === bestLoc);
                if (realLoc) { autoGuessed = true; updateScope('container', realLoc.name); return; }
            }
        }
    });

    // Map state to colors for AR glowing boxes
    $: arBoxes = [
        ...unregistered.map(i => ({ box: i.box, colorClass: 'border-primary shadow-[0_0_15px_rgba(var(--p),0.8)]', id: i.title })),
        ...elsewhere.map(i => ({ box: i.box, colorClass: 'border-warning shadow-[0_0_15px_rgba(var(--wa),0.8)]', id: i.title })),
        ...correct.map(i => ({ box: i.box, colorClass: 'border-success shadow-[0_0_15px_rgba(var(--su),0.8)]', id: i.title }))
    ];

    async function quickAdd(item: any, target: 'inventory' | 'to buy' | 'todo', skipHumanCheck = false) {
        // Check for HUMAN_REQUIRED fields if adding to inventory
        if (target === 'inventory' && !skipHumanCheck && results.activeSchema) {
            const localAttributes = item.extractedAttributes || {};
            const needsHuman = results.activeSchema.some(f => 
                f.extractionMethod === 'HUMAN_REQUIRED' || 
                (f.extractionMethod === 'HYBRID' && !localAttributes[f.name])
            );
            if (needsHuman) {
                pendingItemForAdd = item;
                pendingTarget = target;
                attributeSheetModal.showModal();
                return;
            }
        }
        savingTitles.add(item.title);
        savingTitles = savingTitles;

        try {
            const fd = new FormData();
            let res;
            if (target === 'inventory') {
                fd.append('title', item.title);
                if (item.subtitle) fd.append('description', item.subtitle);
                if (results.draftPath) fd.append('draftPath', results.draftPath);
                if (item.box) fd.append('box', JSON.stringify(item.box));
                if (scopeType === 'container' && scopeValue) fd.append('container', scopeValue);
                else if ($ambientLocation.length > 0) fd.append('container', $ambientLocation[0]);

                if (scopeType === 'category' && scopeValue) fd.append('categoryName', scopeValue);
                if (scopeType === 'tag' && scopeValue) fd.append('tagcsv', scopeValue);
                if (item.extractedAttributes) fd.append('extractedAttributes', JSON.stringify(item.extractedAttributes));
                res = await fetch('/api/item', { method: 'POST', body: fd });
            } else {
                fd.append('content', `${target === 'to buy' ? 'Buy: ' : 'Task: '} ${item.title} ${item.subtitle ? `(${item.subtitle})` : ''}`);
                fd.append('category', target);
                res = await fetch('/timeline?/capture', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true', 'accept': 'application/json' } });
            }

            if (res.ok) {
                dispatch('notify', { status: 'success', message: `Added "${item.title}" to ${target === 'inventory' ? 'Collection' : 'Notebook'}` });
                results.newToYou = results.newToYou.filter(i => i.title !== item.title);
                if (target === 'inventory') results.inCollection = [{ ...item, matchedItem: { title: item.title, amount: 1 } }, ...results.inCollection];
            }
        } catch (e) {
            dispatch('notify', { status: 'error', message: 'Failed to add item.' });
        } finally {
            savingTitles.delete(item.title);
            savingTitles = savingTitles;
        }
    }

    function handleAttributeSave(e: CustomEvent) {
        const { item, attributes } = e.detail;
        item.extractedAttributes = attributes;
        attributeSheetModal.close();
        if (pendingTarget) {
            quickAdd(item, pendingTarget, true);
        }
    }

    async function quickMove(itemId: number, newContainer: string) {
        try {
            await fetch('/api/item', { 
                method: 'PATCH', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ itemId, newContainer }) 
            });
        } catch (e) {
            dispatch('notify', { status: 'error', message: 'Failed to move item.' });
        }
    }

   function confirmMerge(dbItem: any) {
       if (!mergeSourceItem) return;
       
       results.newToYou = results.newToYou.filter(i => i.title !== mergeSourceItem.title);
       results.missingFromScope = results.missingFromScope.filter(i => i.id !== dbItem.id);
       
       results.inCollection = [{ 
           ...mergeSourceItem, 
           matchedItem: { id: dbItem.id, title: dbItem.title, slug: dbItem.slug, locationName: dbItem.locationName } 
       }, ...results.inCollection];

       mergeModal.close();
       mergeSourceItem = null;
       dispatch('notify', { status: 'success', message: 'Match linked successfully!' });
   }

   async function updateScope(type: string, value: string) {
       filterModal.close();
       if (type === scopeType && value === scopeValue) return;
       
       isRefiltering = true;
       autoGuessed = false; // User manually intervened
       scopeType = type;
       scopeValue = value;
       results.scopeType = type;
       results.scopeValue = value;

       const matchedIds = results.inCollection.map(i => i.matchedItem.id);
       const res = await fetch('/api/compare-missing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeType, scopeValue, matchedIds }) });
       if (res.ok) {
           const data = await res.json();
           results.missingFromScope = data.missing;
       }
       isRefiltering = false;
   }
</script>

<div class="flex flex-col gap-4 w-full max-w-lg mx-auto animate-fade-in pb-32">

    <!-- The "Mad Libs" Sentence (Natural Language Scope) -->
    <div class="flex justify-center -mb-2 z-10 relative text-sm text-gray-500 px-4 text-center">
        <span>
            {#if autoGuessed}
                <i class="bi bi-magic text-warning mr-1"></i> Auto-comparing against 
            {:else}
                Comparing against 
            {/if}
            <button class="font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors px-2 py-0.5 rounded ml-1" on:click={() => filterModal.showModal()}>
                {scopeType === 'all' ? 'Entire Library' : scopeValue} <i class="bi bi-chevron-down text-xs ml-1"></i>
            </button>
        </span>
    </div>

    <ARImagePreview src={results.draftPath} boxes={arBoxes} on:clickBox={(e) => {
        const title = e.detail;
        if (unregistered.some(i => i.title === title)) activeTab = 'unregistered';
        else if (elsewhere.some(i => i.title === title)) activeTab = 'elsewhere';
        else activeTab = 'correct';
        
        setTimeout(() => {
            document.getElementById('card-' + title.replace(/\s+/g, '-'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    }} />

    <div class="grid {scopeType === 'container' ? 'grid-cols-2 md:grid-cols-4' : (scopeType !== 'all' ? 'grid-cols-3' : 'grid-cols-2')} gap-1 bg-base-200/80 p-1 rounded-2xl border border-base-300 w-full">
        {#if scopeType !== 'all'}
            <StatTab 
                active={activeTab === 'missing'} 
                count={missing.length} 
                label="Missing" 
                icon="⚠️" 
                activeColorClass="text-error" 
                sublabel={scopeType === 'container' ? `in ${scopeValue}` : ''}
                loading={isRefiltering}
                on:click={() => activeTab = 'missing'} 
            />
            {#if scopeType === 'container'}
                <StatTab 
                    active={activeTab === 'elsewhere'} 
                    count={groupedElsewhere.length} 
                    label="Elsewhere" 
                    icon="📦" 
                    activeColorClass="text-warning" 
                    on:click={() => activeTab = 'elsewhere'} 
                />
            {/if}
        {/if}
        <StatTab 
            active={activeTab === 'unregistered'} 
            count={groupedUnregistered.length} 
            label="New" 
            icon="✨" 
            activeColorClass="text-primary" 
            on:click={() => activeTab = 'unregistered'} 
        />
        <StatTab 
            active={activeTab === 'correct'} 
            count={groupedCorrect.length} 
            label={scopeType === 'all' ? 'Owned' : (scopeType === 'container' ? 'In Place' : 'In Stock')} 
            icon="✓" 
            activeColorClass="text-success" 
            on:click={() => activeTab = 'correct'} 
        />
    </div>

    {#if activeTab === 'missing'}
        <div class="form-control bg-base-200/50 p-3 rounded-2xl border border-base-200 mb-2">
            {#if containerSpatialBaseline.length > 0}
                <div class="mb-6 bg-base-200/50 p-4 rounded-3xl border border-base-200">
                    <h4 class="font-bold text-sm mb-2 flex items-center gap-2"><i class="bi bi-intersect text-warning"></i> Spatial Audit Baseline</h4>
                    <div class="text-xs text-gray-500">Comparing scanned photo against {containerSpatialBaseline.length} mapped container slots. Anomalies are color-coded below.</div>
                
                <div class="w-full mt-4 relative overflow-hidden shadow-sm border border-base-300 bg-base-300 rounded-[2rem]">
                     <SpatialMap 
                         imageUrl={results.draftPath} 
                         polygons={containerSpatialBaseline} 
                         readonly={true} 
                         activePolyIndex={null}
                         mappedEntities={containerSpatialBaseline.map(p => {
                              const pStr = JSON.stringify(p);
                              const m = missing.find(m => m.spatialMap === pStr);
                              if (m) return { title: m.title, isError: true };
                              return { title: 'Present', isError: false };
                         })}
                     />
                </div>
                
                <button class="btn btn-outline btn-sm w-full mt-4 rounded-xl" on:click={() => dispatch('remap', results.draftPath)}>
                    <i class="bi bi-bounding-box-circles"></i> Update Map with this Photo
                </button>
                </div>
            {/if}
            <label class="label cursor-pointer py-0">
                <span class="label-text flex flex-col">
                    <span class="font-bold text-sm">Strict Quantity Audit</span>
                    <span class="text-xs text-gray-500">Show exact missing counts (including duplicates)</span>
                </span>
                <input type="checkbox" class="toggle toggle-primary" bind:checked={strictAuditMode} />
            </label>
        </div>

        {#if missing.length === 0} <CompareEmptyState type="missing" /> {:else}
            <div class="flex flex-col gap-2.5">
                {#each missing as item}
                    <div id="card-{item.title.replace(/\s+/g, '-')}" class="scroll-mt-24">
                        <CompareItemCard {item} type="missing" draftPath={results.draftPath}
                            on:zoom={() => item.thumbPath ? lightbox.open({ orgPath: item.thumbPath, showOriginal: true }) : lightbox.open({ orgPath: results.draftPath, thumbPath: results.draftPath, showOriginal: true, box: item.box })}
                        >
                            <div slot="actions">
                                <a href="/{item.id}/{item.slug || 'view'}" class="btn btn-ghost btn-xs text-error">View</a>
                            </div>
                        </CompareItemCard>
                    </div>
                {/each}
            </div>
        {/if}
    {:else if activeTab === 'unregistered'}
        {#if groupedUnregistered.length === 0} <CompareEmptyState type="unregistered" /> {:else}
            <div class="flex flex-col gap-2.5">
                {#each groupedUnregistered as item}
                    <div id="card-{item.title.replace(/\s+/g, '-')}" class="scroll-mt-24">
                        <CompareItemCard {item} type="unregistered" draftPath={results.draftPath} 
                            on:zoom={() => lightbox.open({ orgPath: results.draftPath, thumbPath: results.draftPath, showOriginal: true, box: item.box })}
                            on:discard={(e) => results.newToYou = results.newToYou.filter(i => i.title !== e.detail.title)}
                            on:link={(e) => { mergeSourceItem = e.detail; mergeModal.showModal(); }}
                        >
                            <div slot="actions">
                                <button type="button" class="btn btn-sm btn-primary rounded-xl shadow-sm shrink-0 gap-1 {savingTitles.has(item.title) ? 'btn-disabled' : ''}" on:click={() => { actionItem = item; actionModal.showModal(); }}>
                                    {#if savingTitles.has(item.title)}<span class="loading loading-spinner loading-xs"></span>
                                    {:else}<i class="bi bi-plus-lg"></i> Add{/if}
                                </button>
                            </div>
                        </CompareItemCard>
                    </div>
                {/each}
            </div>
        {/if}
    {:else if activeTab === 'elsewhere'}
        {#if groupedElsewhere.length === 0} <CompareEmptyState type="elsewhere" /> {:else}
            <div class="flex flex-col gap-2.5">
                {#each groupedElsewhere as item}
                    <div id="card-{item.title.replace(/\s+/g, '-')}" class="scroll-mt-24">
                        <CompareItemCard {item} type="elsewhere" draftPath={results.draftPath} on:zoom={() => lightbox.open({ orgPath: results.draftPath, thumbPath: results.draftPath, showOriginal: true, box: item.box })} on:zoomMatch={(e) => lightbox.open({ orgPath: e.detail.thumbPath || e.detail.orgPath, showOriginal: true })}>
                            <div slot="actions" class="flex flex-col sm:flex-row items-center gap-1">
                                <button type="button" aria-label="Add" class="btn btn-circle btn-ghost btn-sm text-gray-400 hover:text-primary" title="Force add as new" on:click={() => { actionItem = item; actionModal.showModal(); }}><i class="bi bi-plus-lg text-lg"></i></button>
                                <a href="/{item.matchedItem?.id}/{item.matchedItem?.slug || 'view'}" class="btn btn-ghost btn-xs text-warning">View</a>
                            </div>
                        </CompareItemCard>
                    </div>
                {/each}
            </div>
        {/if}
    {:else if activeTab === 'correct'}
        {#if groupedCorrect.length === 0} <CompareEmptyState type="correct" /> {:else}
            <div class="flex flex-col gap-2.5">
                {#each groupedCorrect as item}
                    <div id="card-{item.title.replace(/\s+/g, '-')}" class="scroll-mt-24">
                        <CompareItemCard {item} type="correct" draftPath={results.draftPath} on:zoom={() => lightbox.open({ orgPath: results.draftPath, thumbPath: results.draftPath, showOriginal: true, box: item.box })} on:zoomMatch={(e) => lightbox.open({ orgPath: e.detail.thumbPath || e.detail.orgPath, showOriginal: true })}>
                            <div slot="actions" class="flex flex-col sm:flex-row items-center gap-1">
                                <button type="button" aria-label="Add" class="btn btn-circle btn-ghost btn-sm text-gray-400 hover:text-primary" title="Force add as new" on:click={() => { actionItem = item; actionModal.showModal(); }}><i class="bi bi-plus-lg text-lg"></i></button>
                                <a href="/{item.matchedItem?.id}/{item.matchedItem?.slug || 'view'}" aria-label="View Match" class="btn btn-circle btn-ghost btn-sm text-gray-400 hover:text-primary"><i class="bi bi-arrow-right-short text-2xl"></i></a>
                            </div>
                        </CompareItemCard>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}

    <!-- Sticky Contextual Footer for Bulk Actions -->
    {#if activeTab === 'missing' && missing.length > 0}
        <div class="mt-4 p-4 bg-base-100 border border-base-200 rounded-2xl shadow-sm flex justify-center gap-3 mb-8">
            <button class="btn btn-error shadow-lg w-full max-w-sm rounded-2xl" on:click={async () => {
                for(let m of missing) await quickAdd({title: m.title, subtitle: m.locationName ? `Was in ${m.locationName}` : ''}, 'to buy');
                results.missingFromScope = [];
                dispatch('notify', { status: 'success', message: 'Added missing items to Shopping List!' });
            }}>
                <i class="bi bi-cart-plus text-lg"></i> Add {missing.length} Missing to List
            </button>
        </div>
    {/if}

    {#if activeTab === 'unregistered' && unregistered.length > 0}
        <div class="mt-4 p-4 bg-base-100 border border-base-200 rounded-2xl shadow-sm flex justify-center gap-3 mb-8">
            <button class="btn btn-primary shadow-lg flex-1 max-w-sm rounded-2xl" on:click={async () => {
                for(let u of unregistered) await quickAdd(u, 'inventory');
                results.newToYou = [];
                dispatch('notify', { status: 'success', message: `Added ${unregistered.length} items to Collection!` });
            }}>
                <i class="bi bi-box-seam"></i> Add {unregistered.length} to Collection
            </button>
        </div>
    {/if}

    {#if activeTab === 'elsewhere' && elsewhere.length > 0 && scopeType === 'container'}
        <div class="mt-4 p-4 bg-base-100 border border-base-200 rounded-2xl shadow-sm flex justify-center gap-3 mb-8">
            <button class="btn btn-warning shadow-lg flex-1 max-w-sm rounded-2xl" on:click={async () => {
                for(let e of elsewhere) await quickMove(e.matchedItem.id, scopeValue);
                // Update local state instantly to reflect the move
                results.inCollection = results.inCollection.map(i => elsewhere.includes(i) ? {...i, matchedItem: {...i.matchedItem, locationName: scopeValue}} : i);
                dispatch('notify', { status: 'success', message: `Moved ${elsewhere.length} items to ${scopeValue}!` });
            }}>
                <i class="bi bi-arrows-move"></i> Move All to {scopeValue}
            </button>
        </div>
    {/if}

</div>

<ImageLightbox bind:this={lightbox} itemTitle="Comparison Match" />

<!-- Manual Link Assistant Modal -->
<BottomSheet bind:this={mergeModal} title="Link to Existing Item" subtitle={`Select the item that matches "${mergeSourceItem?.title}"`} on:close={() => mergeSourceItem = null}>
    <div class="flex flex-col gap-2">
        {#each results.missingFromScope as missingItem}
                <ActionCard 
                    title={missingItem.title} 
                    subtitle={missingItem.locationName ? `IN ${missingItem.locationName.toUpperCase()}` : ''}
                    icon="bi-link"
                    iconColorClass="bg-base-200 text-gray-400"
                    variant="flat"
                    buttonClass="border border-base-200 shadow-sm hover:border-warning hover:bg-warning/10 rounded-2xl"
                    on:click={() => confirmMerge(missingItem)}
                />
        {/each}
    </div>
    <div slot="actions">
        <button type="button" class="btn btn-neutral w-full rounded-xl" on:click={() => mergeModal.close()}>Cancel</button>
    </div>
</BottomSheet>

<!-- Human Input Modal -->
<dialog bind:this={attributeSheetModal} class="modal modal-bottom sm:modal-middle backdrop-blur-sm" on:close={() => { pendingItemForAdd = null; pendingTarget = null; }}>
    <div class="modal-box p-0 overflow-hidden bg-base-100 shadow-2xl border border-base-200 sm:rounded-[2.5rem]">
        <CompareAttributeSheet item={pendingItemForAdd} activeSchema={results.activeSchema || []} on:save={handleAttributeSave} on:cancel={() => attributeSheetModal.close()} />
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<!-- Target Scope Bottom Sheet -->
<BottomSheet bind:this={filterModal} title="Narrow down the comparison" subtitle="Select a specific category, tag, or box to see what's missing from it.">
    <button type="button" class="btn btn-outline h-auto py-4 px-4 w-full flex justify-start items-center rounded-2xl {scopeType === 'all' ? 'border-primary bg-primary/5' : 'border-base-300'}" on:click={() => updateScope('all', '')}>
        <i class="bi bi-infinity text-2xl mr-3 {scopeType === 'all' ? 'text-primary' : 'text-gray-400'}"></i>
        <div class="text-left"><div class="font-bold">Entire Library</div><div class="text-xs text-gray-500 font-normal">Check for any new, unowned items</div></div>
    </button>

    {#if categories.length > 0}
        <div>
            <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1"><i class="bi bi-tags-fill mr-1"></i> By Category</div>
            <div class="flex flex-wrap gap-2">
                {#each categories as c}
                    <button class="badge badge-lg py-4 px-4 hover:border-primary transition-all capitalize {scopeType === 'category' && scopeValue === c.name ? 'badge-primary shadow-md' : 'badge-ghost border-base-300'}" on:click={() => updateScope('category', c.name)}>{c.name}</button>
                {/each}
            </div>
        </div>
    {/if}

    {#if containers.length > 0}
        <div>
            <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1"><i class="bi bi-box-seam-fill mr-1"></i> By Location</div>
            <div class="flex flex-wrap gap-2">
                {#each containers as c}
                    <button class="badge badge-lg py-4 px-4 hover:border-primary transition-all {scopeType === 'container' && scopeValue === c.name ? 'badge-primary shadow-md' : 'badge-ghost border-base-300'}" on:click={() => updateScope('container', c.name)}>{c.name}</button>
                {/each}
            </div>
        </div>
    {/if}

    {#if tags.length > 0}
        <div>
            <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 px-1"><i class="bi bi-hash mr-1"></i> By Tag</div>
            <div class="flex flex-wrap gap-2">
                {#each tags as t}
                    <button class="badge badge-lg py-4 px-4 hover:border-primary transition-all {scopeType === 'tag' && scopeValue === t.slug ? 'badge-primary shadow-md' : 'badge-ghost border-base-300'}" on:click={() => updateScope('tag', t.slug)}>{t.name}</button>
                {/each}
            </div>
        </div>
    {/if}
</BottomSheet>

<!-- Action Picker Bottom Sheet -->
<BottomSheet bind:this={actionModal} title="Add to..." subtitle={`Where should "${actionItem?.title}" go?`} on:close={() => actionItem = null}>
    <div class="flex flex-col gap-3">
        <ActionCard title={activeInvName} subtitle="Add to collection" icon="bi-box-seam" iconColorClass="text-primary bg-transparent" variant="flat" buttonClass="border border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 rounded-2xl" on:click={() => { actionModal.close(); quickAdd(actionItem, 'inventory'); }} />
        <ActionCard title="Shopping List" subtitle="Add to your buy list" icon="bi-cart" iconColorClass="text-warning bg-transparent" variant="flat" buttonClass="border border-base-300 bg-base-100 hover:border-warning hover:bg-warning/5 rounded-2xl" on:click={() => { actionModal.close(); quickAdd(actionItem, 'to buy'); }} />
        <ActionCard title="To-Do List" subtitle="Add as a task" icon="bi-list-check" iconColorClass="text-success bg-transparent" variant="flat" buttonClass="border border-base-300 bg-base-100 hover:border-success hover:bg-success/5 rounded-2xl" on:click={() => { actionModal.close(); quickAdd(actionItem, 'todo'); }} />
        {#if missing.length > 0}
            <div class="divider my-2 text-xs text-gray-400">OR</div>
            <ActionCard title="Link to Existing..." subtitle="Match it to an expected item" icon="bi-link-45deg" iconColorClass="text-info bg-transparent" variant="flat" buttonClass="border border-base-300 bg-base-100 hover:border-info hover:bg-info/5 rounded-2xl text-info" on:click={() => { actionModal.close(); mergeSourceItem = actionItem; mergeModal.showModal(); }} />
        {/if}
    </div>
</BottomSheet>
