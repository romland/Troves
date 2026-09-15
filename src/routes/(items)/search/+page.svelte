<script lang="ts">
    import { page } from '$app/stores';
    import type { PageServerData } from "./$types";
    import Navigation from "$lib/components/navigation.svelte";
    import Items from "$lib/components/items.svelte";
    import Search from "$lib/components/search.svelte";
    import { enhance } from "$app/forms";
    import { goto } from "$app/navigation";
    import InteractiveColorMix from "$lib/components/InteractiveColorMix.svelte";
    import BottomSheet from "$lib/components/BottomSheet.svelte";
    import CompareAttributeSheet from "$lib/components/compare/CompareAttributeSheet.svelte";
    import DocumentList from "$lib/components/search/DocumentList.svelte";
    import DocumentLightbox from "$lib/components/DocumentLightbox.svelte";
    import ImageLightbox from "$lib/components/ImageLightbox.svelte";
    import Modal from "$lib/components/Modal.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
    import FormSelect from "$lib/components/FormSelect.svelte";
    import Badge from "$lib/components/Badge.svelte";
    import DropdownSelect from "$lib/components/DropdownSelect.svelte";

    export let data: PageServerData;


	let bulkMode = false;
	let selectedIds: number[] = [];
	let bulkAction = 'addTag';
	let bulkValue = '';
	let isSubmitting = false;
    let bulkDeleteModal: Modal;
    let exportCsvModal: Modal;
    let exportConfig = { core: true, locs: true, attrs: true, tags: true, images: false };
    let isExporting = false;

	let navLoadedPages: any[] = [];
    let filterModal: BottomSheet;
    let filterAttrs: Record<string, string> = {};
    let selectedCategory = data.cat || '';
    let filterForm: HTMLFormElement;
    let docLightbox: DocumentLightbox;
    let imgLightbox: ImageLightbox;

    // Hydrate tab state from session memory safely
    let searchTab: 'items' | 'documents' = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('troves_search_tab')) as any || 'items';
    $: if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('troves_search_tab', searchTab);

    // Smart Tab Auto-Selection: If the current tab has no hits, but the other does, flip to the one with hits
    $: {
        if (data.items.length === 0 && data.documentResults?.length > 0 && searchTab === 'items') {
            searchTab = 'documents';
        } else if (data.documentResults?.length === 0 && data.items.length > 0 && searchTab === 'documents') {
            searchTab = 'items';
        }
    }

    // Toggle: Set to true to drop the attribute key and show only the friendly value in pills
    const COMPACT_PILLS = true;

	$: allLoadedItems = [...data.items, ...(navLoadedPages || []).flat()];

   let isAllSelectedGlobally = false;
	// Check if EVERY visible item on the screen is currently in the selected list
	$: isAllSelected = allLoadedItems.length > 0 && allLoadedItems.every(item => selectedIds.includes(item.id));

   // Auto-select new items if we are in "select all" mode
   $: if (isAllSelectedGlobally && allLoadedItems.length > 0) {
       const newIds = new Set(selectedIds);
       let added = false;
       allLoadedItems.forEach(item => {
           if (!newIds.has(item.id)) { newIds.add(item.id); added = true; }
       });
       if (added) selectedIds = Array.from(newIds);
   }

	$: {
		console.log('[DEBUG-BULK] State Update ->', {
			dataItems: data.items.length, 
			navPages: navLoadedPages.length, 
			allLoaded: allLoadedItems.length, 
			selected: selectedIds.length, 
			isAllSelected
		});
	}

	// Helper for slot-safe checkbox binding
	function toggleSelection(id, checked) {
		console.log(`[DEBUG-BULK] Toggling item ${id} to ${checked}`);
		if (checked) {
			if (!selectedIds.includes(id)) selectedIds = [...selectedIds, id];
		}
       else {
           selectedIds = selectedIds.filter(x => x !== id);
           isAllSelectedGlobally = false;
       }
	}

	function toggleAll(checked) {
		console.log(`[DEBUG-BULK] Toggling ALL visible items to ${checked}`);
		if (checked) {
           isAllSelectedGlobally = true;
			const newIds = new Set(selectedIds);
			allLoadedItems.forEach(item => newIds.add(item.id));
			selectedIds = Array.from(newIds);
		} else {
           isAllSelectedGlobally = false;
			const visibleIds = new Set(allLoadedItems.map(i => i.id));
			selectedIds = selectedIds.filter(id => !visibleIds.has(id));
		}
	}

	// Cleanly build the query string for pagination, omitting blanks
	$: searchParamsStr = new URLSearchParams(
		Object.entries({
            ids: $page.url.searchParams.get('ids') || '',
			q: data.q, category: data.cat, tag: data.tag, container: data.container,
            title: data.titleStr, desc: data.descStr, doc: data.docStr, reason: data.reasonStr, duplicateStatus: data.duplicateStatus, color: data.color,
            docType: data.docType,
			minAmount: data.minAmount, maxAmount: data.maxAmount,
            unassigned: data.unassigned ? 'true' : '',
            attrs: $page.url.searchParams.get('attrs') || ''
		}).filter(([_, v]) => v) 
	).toString();

    // Sync filterAttrs from URL reactively (handles back button and Clear All)
    let lastUrlAttrs = '__init__';
    $: {
        try {
            const currentUrlAttrs = $page.url.searchParams.get('attrs') || '';
            if (currentUrlAttrs !== lastUrlAttrs) {
                lastUrlAttrs = currentUrlAttrs;
                filterAttrs = currentUrlAttrs ? JSON.parse(currentUrlAttrs) : {};
            }
        } catch(e) { filterAttrs = {}; }
    }

    function removeFilter(type: string, key?: string) {
        if (type === 'attrs' && key) {
            delete filterAttrs[key];
            filterAttrs = filterAttrs; // trigger reactivity
        } else if (type === 'tag') {
            const el = filterForm.elements.namedItem('tag') as HTMLSelectElement;
            if (el) el.value = '';
        } else if (type === 'container') {
            const el = filterForm.elements.namedItem('container') as HTMLSelectElement;
            if (el) el.value = '';
        } else if (type === 'docType') {
            const el = filterForm.elements.namedItem('docType') as HTMLSelectElement;
            if (el) el.value = '';
        } else if (type === 'doc') {
            const el = filterForm.elements.namedItem('doc') as HTMLInputElement;
            if (el) el.value = '';
        } else if (type === 'reason') {
            const el = filterForm.elements.namedItem('reason') as HTMLInputElement;
            if (el) el.value = '';
        } else if (type === 'category') {
            selectedCategory = '';
        } else if (type === 'unassigned') {
            const el = filterForm.elements.namedItem('unassigned') as HTMLInputElement;
            if (el) el.checked = false;
        }
        setTimeout(() => filterForm.requestSubmit(), 0);
    }

    async function downloadCSV() {
        isExporting = true;
        try {
            const res = await fetch('/api/export-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemIds: selectedIds, config: exportConfig })
            });
            if (!res.ok) throw new Error('Export failed');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'export.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            exportCsvModal.close();
        } catch (e) {
			notify('error', 'Failed to export CSV.');
        } finally {
            isExporting = false;
        }
    }

    // Dynamically filter and deduplicate attributes based on the selected category
    $: dynamicSchema = (() => {
        let fields = data.activeSchema || [];
        if (selectedCategory && selectedCategory !== '_uncategorized') {
            const lowerCat = selectedCategory.toLowerCase();
            fields = fields.filter(f => f.categoryId === null || (f.categoryName || '').toLowerCase() === lowerCat);
        }
        
        // Deduplicate keys (e.g. if 'fabric' exists in 5 categories, merge into one dropdown with all unique options)
        const merged = new Map();
        for (const f of fields) {
            if (!merged.has(f.name)) {
                merged.set(f.name, { ...f, options: f.options ? [...f.options] : null });
            } else {
                const existing = merged.get(f.name);
                if (f.options && existing.options) {
                    existing.options = [...new Set([...existing.options, ...f.options])];
                }
            }
        }
        return Array.from(merged.values());
    })();

    import pageTitle from '$lib/stores';
    import { notify } from '$lib/client/notifications';
	$: pageTitle.set(data.cat ? "Category: " + data.cat : (data.q ? "Search for " + data.q : "Search"));

    $: currentInventory = $page.data.inventories?.find(i => i.id === $page.data.activeInventoryId);
</script>

<div class="flex justify-between items-center mb-6 px-2">
	<h1 class="text-2xl font-bold tracking-tight">
		Results
	</h1>
    <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm bg-base-200/50 hover:bg-base-300 shadow-sm rounded-xl border border-base-300" on:click={() => filterModal.showModal()}>
            <i class="bi bi-funnel"></i> Filters
        </button>
        <button class="btn btn-outline btn-sm shadow-sm rounded-xl border-base-300" on:click={() => { bulkMode = !bulkMode; selectedIds = []; searchTab = 'items'; }}>
            {#if bulkMode}Cancel Bulk Edit{:else}<i class="bi bi-ui-checks-grid"></i> Bulk Edit{/if}
        </button>
    </div>
</div>

<!-- Active Filter Chips -->
{#if data.tag || data.container || data.cat || data.unassigned || data.docType || data.docStr || data.reasonStr || Object.keys(filterAttrs).length > 0}
<div class="flex flex-wrap gap-2 px-2 mb-6">
    {#if data.tag}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-hash" removable on:click={() => removeFilter('tag')}>{data.tag}</Badge>{/if}
    {#if data.container}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-box-seam" removable on:click={() => removeFilter('container')}>{data.container}</Badge>{/if}
    {#if data.cat}<Badge color="primary" class="p-3 font-semibold shadow-sm capitalize" icon="bi-tags" removable on:click={() => removeFilter('category')}>{data.cat}</Badge>{/if}
    {#if data.unassigned}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-pin-map" removable on:click={() => removeFilter('unassigned')}>Unassigned</Badge>{/if}
    {#if data.docStr}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-file-text" removable on:click={() => removeFilter('doc')}>{data.docStr}</Badge>{/if}
    {#if data.docType}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-file-earmark" removable on:click={() => removeFilter('docType')}>{data.docType.toUpperCase()}</Badge>{/if}
    {#if data.reasonStr}<Badge color="primary" class="p-3 font-semibold shadow-sm" icon="bi-question-circle" removable on:click={() => removeFilter('reason')}>{data.reasonStr}</Badge>{/if}
    {#each Object.entries(filterAttrs) as [k,v]}
        {@const schemaField = (data.activeSchema || []).find(f => f.name === k)}
        {@const friendlyKey = schemaField?.uiLabel || k.replace(/_/g, ' ')}
        <Badge color="secondary" class="p-3 font-semibold shadow-sm capitalize" removable on:click={() => removeFilter('attrs', k)}>{COMPACT_PILLS ? v : `${friendlyKey}: ${v}`}</Badge>
    {/each}
    <button class="btn btn-xs btn-ghost text-gray-400" on:click={() => { goto('/search'); }}>Clear All</button>
</div>
{/if}

{#if !bulkMode && currentInventory?.enableDocuments !== false}
<div class="bg-base-200 p-1 rounded-2xl flex w-full max-w-md mx-auto mb-6 mt-2 relative z-10 border border-base-300 shadow-inner">
    <button type="button" class="flex-1 btn btn-sm border-none {searchTab === 'items' ? 'bg-base-100 shadow-sm hover:bg-base-100 text-base-content' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={() => searchTab = 'items'}>
        Items <Badge color="ghost" size="sm" class="ml-1">{data.totalCount}</Badge>
    </button>
    <button type="button" class="flex-1 btn btn-sm border-none {searchTab === 'documents' ? 'bg-base-100 shadow-sm hover:bg-base-100 text-base-content' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={() => searchTab = 'documents'}>
        Documents <Badge color="ghost" size="sm" class="ml-1">{data.documentResults.length}</Badge>
    </button>
</div>
{/if}

	<BottomSheet bind:this={filterModal} title="Search Filters">
        <form bind:this={filterForm} method="GET" action="/search" class="flex flex-col gap-3" on:submit|preventDefault={(e) => {
            filterModal.close();
            const params = new URLSearchParams(new FormData(e.currentTarget) as any);
            goto(`/search?${params.toString()}`);
        }}>
            <input type="hidden" name="attrs" value={JSON.stringify(filterAttrs)}>
			
			<div class="flex gap-4 flex-col sm:flex-row">
                <FormSelect label="Has Tag" name="tag" selectClass="select-sm rounded-lg font-normal" labelClass="text-xs uppercase tracking-wider mb-0">
                    <option value="">Any Tag</option>
                    {#each (data.tags || []) as t}
                        <option value={t.slug} selected={data.tag === t.slug}>{t.name}</option>
                    {/each}
                </FormSelect>
                <FormSelect label="In Container" name="container" selectClass="select-sm rounded-lg font-normal" labelClass="text-xs uppercase tracking-wider mb-0">
                    <option value="">Any Container</option>
                    {#each (data.containers || []) as c}
                        <option value={c.name} selected={data.container === c.name}>{c.name}</option>
                    {/each}
                </FormSelect>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">

                <FormSelect label="Category" name="category" bind:value={selectedCategory} selectClass="select-sm rounded-lg font-normal capitalize" labelClass="text-xs uppercase tracking-wider mb-0">
                    <option value="">Any Category</option>
                    <option value="_uncategorized">Uncategorized</option>
                    {#each data.categories as c}
                        <option value={c.name} class="capitalize">{c.name}</option>
                    {/each}
                </FormSelect>
                <FormInput label="Title" name="title" value={data.titleStr || ''} placeholder="e.g. raspberry or Aerosmith..." inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0" />
                <FormInput label="Description" name="desc" value={data.descStr || ''} placeholder="Description content..." inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0" />
                <FormInput label="Document Contains" name="doc" value={data.docStr || ''} placeholder="Search manuals, notes, extracts..." inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0" />
                <FormSelect label="Document Type" name="docType" value={data.docType || ''} selectClass="select-sm rounded-lg font-normal" labelClass="text-xs uppercase tracking-wider mb-0">
                    <option value="">Any Type</option>
                    <option value="pdf">PDF</option>
                    <option value="epub">EPUB</option>
                    <option value="html">Webpage</option>
                    <option value="video">Video</option>
                    <option value="note">Notes / Q&A</option>
                </FormSelect>
                <FormInput label="Reason" name="reason" value={data.reasonStr || ''} placeholder="e.g. Curiosity" inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0" />

				<div class="form-control w-full flex flex-row gap-2 items-end">
                    <FormInput label="Min Qty" name="minAmount" type="number" value={data.minAmount || ''} placeholder="0" inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0 block" class="w-1/2" />
                    <FormInput label="Max Qty" name="maxAmount" type="number" value={data.maxAmount || ''} placeholder="10" inputClass="input-sm rounded-lg" labelClass="text-xs uppercase tracking-wider mb-0 block" class="w-1/2" />
				</div>

                <div class="form-control w-full sm:col-span-2 overflow-x-auto pb-2">
                    <span class="label-text text-xs font-semibold mb-1 uppercase tracking-wider">Color Mix</span>
                    <InteractiveColorMix initialMixStr={data.color} bind:valueStr={data.color} />
                    <input type="hidden" name="color" value={data.color} />
                </div>
			</div>

            <div class="divider my-1">Attributes</div>
            <CompareAttributeSheet 
                mode="filter" 
                bind:localAttributes={filterAttrs} 
                activeSchema={dynamicSchema} 
                attributeCounts={data.attributeCounts}
                on:change={(e) => filterAttrs = e.detail} 
            />
            <div class="flex flex-col sm:flex-row gap-4 mt-2">
                <label class="flex items-center gap-2 cursor-pointer mt-1">
                    <input type="checkbox" name="unassigned" value="true" class="checkbox checkbox-sm checkbox-primary" checked={data.unassigned} />
                    <span class="text-sm font-medium">No location assigned</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer mt-1">
                    <input type="checkbox" name="duplicateStatus" value="FLAGGED" class="checkbox checkbox-sm checkbox-warning" checked={data.duplicateStatus === 'FLAGGED'} />
                    <span class="text-sm font-medium">Flagged Duplicates only</span>
                </label>
            </div>
            <div class="sticky bottom-0 bg-base-100 p-2 mt-4 border-t border-base-200">
                <button type="submit" class="btn btn-primary w-full shadow-sm rounded-xl">Apply Filters</button>
            </div>
		</form>
	</BottomSheet>

{#if bulkMode}
    <form id="bulkEditForm" method="POST" action="?/bulkEdit" class="pb-32" use:enhance={() => {
		isSubmitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			isSubmitting = false;
			bulkMode = false;
			selectedIds = [];
		};
	}}>
		<!-- Master Checkbox Bar -->
		<div class="flex items-center justify-between bg-base-200/50 p-3 rounded-xl border border-base-200 shadow-inner mb-3">
			<label class="flex items-center gap-3 cursor-pointer">
				<input type="checkbox" class="checkbox checkbox-sm checkbox-primary" checked={isAllSelected} on:change={(e) => toggleAll(e.currentTarget.checked)} />
				<span class="text-sm font-bold text-gray-500 uppercase tracking-wider">Select All Loaded</span>
			</label>
			<span class="text-xs font-bold bg-base-100 px-2 py-1 rounded-md shadow-sm text-gray-500">{selectedIds.length} selected</span>
		</div>

		<div class="flex flex-col gap-2">
			{#each data.items as item}
				<label class="flex items-center gap-4 p-3 bg-base-100 border border-base-200 shadow-sm rounded-xl cursor-pointer hover:border-primary transition-colors">
					<input type="checkbox" class="checkbox checkbox-primary" name="itemIds[]" value={item.id} checked={selectedIds.includes(item.id)} on:change={(e) => toggleSelection(item.id, e.currentTarget.checked)}>
					<div class="w-12 h-12 rounded-lg bg-base-200 overflow-hidden shrink-0">
						{#if item.photos?.[0]?.thumbPath}
							<img src={item.photos[0].thumbPath} alt={item.title} class="w-full h-full object-cover">
						{:else}
							<div class="w-full h-full flex items-center justify-center"><i class="bi bi-box text-xl text-gray-400"></i></div>
						{/if}
					</div>
					<div class="flex flex-col min-w-0 flex-1">
						<span class="font-bold text-base-content truncate">{item.title}</span>
						<span class="text-xs text-gray-500 line-clamp-1">{item.description || 'No description'}</span>
					</div>
				</label>
			{/each}
		</div>

		<Navigation href="/search?{searchParamsStr}&" prevPage={data.prevPage} nextPage={data.nextPage} on:pagesUpdated={(e) => navLoadedPages = e.detail} let:items={pageItems}>
			<div class="flex flex-col gap-2 mt-2">
				{#each pageItems as item}
					<label class="flex items-center gap-4 p-3 bg-base-100 border border-base-200 shadow-sm rounded-xl cursor-pointer hover:border-primary transition-colors">
						<input type="checkbox" class="checkbox checkbox-primary" name="itemIds[]" value={item.id} checked={selectedIds.includes(item.id)} on:change={(e) => toggleSelection(item.id, e.currentTarget.checked)}>
						<div class="w-12 h-12 rounded-lg bg-base-200 overflow-hidden shrink-0">
							{#if item.photos?.[0]?.thumbPath}
								<img src={item.photos[0].thumbPath} alt={item.title} class="w-full h-full object-cover">
							{:else}
								<div class="w-full h-full flex items-center justify-center"><i class="bi bi-box text-xl text-gray-400"></i></div>
							{/if}
						</div>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="font-bold text-base-content truncate">{item.title}</span>
							<span class="text-xs text-gray-500 line-clamp-1">{item.description || 'No description'}</span>
						</div>
					</label>
				{/each}
			</div>
		</Navigation>

		{#if selectedIds.length > 0}
            <div class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 w-full p-4 bg-base-100/95 backdrop-blur-xl border-t border-base-200 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-40 animate-fade-in">
				<div class="max-w-2xl mx-auto flex flex-col sm:flex-row items-end gap-3">
					<DropdownSelect 
						name="bulkAction" 
						bind:value={bulkAction} 
						options={[
							{value: 'addTag', label: 'Add Tag'},
							{value: 'removeTag', label: 'Remove Tag'},
							{value: 'addContainer', label: 'Add to Container'},
							{value: 'removeContainer', label: 'Remove Container'},
							{value: 'setCategory', label: 'Set Category'},
							{value: 'flagDuplicate', label: 'Flag as Duplicate'},
							{value: 'dismissDuplicate', label: 'Dismiss Duplicate'},
							{value: 'clearDuplicate', label: 'Clear Duplicate Status'},
							{value: 'deleteItems', label: 'Delete Items'},
							{value: 'exportCSV', label: 'Export to CSV'}
						]}
						buttonClass="btn-md btn-ghost bg-base-200 hover:bg-base-300 font-semibold rounded-xl gap-2 shadow-sm border border-base-300 w-full sm:w-auto shrink-0 justify-between"
						menuClass="w-full sm:w-56 bg-base-100/95 backdrop-blur-xl rounded-xl border border-base-200 mb-2 gap-1 max-h-[60vh] overflow-y-auto flex-nowrap shadow-2xl z-[100]"
						dropdownClass="dropdown-top w-full sm:w-auto shrink-0"
					/>
                    {#if bulkAction === 'setCategory' && data.categories}
						<DropdownSelect 
							name="bulkValue" 
							bind:value={bulkValue} 
							options={data.categories.map(c => ({value: c.name, label: c.name}))}
							labelPrefix="Category: "
							buttonClass="btn-md btn-ghost bg-base-200 hover:bg-base-300 font-semibold rounded-xl gap-2 shadow-sm border border-base-300 w-full flex-1 justify-between capitalize"
							menuClass="w-full bg-base-100/95 backdrop-blur-xl rounded-xl border border-base-200 mb-2 gap-1 max-h-[60vh] overflow-y-auto flex-nowrap shadow-2xl z-[100] capitalize"
							dropdownClass="dropdown-top w-full flex-1"
						/>
                    {:else if (bulkAction === 'addContainer' || bulkAction === 'removeContainer') && data.containers}
						<DropdownSelect 
							name="bulkValue" 
							bind:value={bulkValue} 
							options={data.containers.map(c => ({value: c.name, label: c.name}))}
							labelPrefix="Container: "
							buttonClass="btn-md btn-ghost bg-base-200 hover:bg-base-300 font-semibold rounded-xl gap-2 shadow-sm border border-base-300 w-full flex-1 justify-between"
							menuClass="w-full bg-base-100/95 backdrop-blur-xl rounded-xl border border-base-200 mb-2 gap-1 max-h-[60vh] overflow-y-auto flex-nowrap shadow-2xl z-[100]"
							dropdownClass="dropdown-top w-full flex-1"
						/>
                    {:else if bulkAction === 'removeTag'}
						<DropdownSelect 
							name="bulkValue" 
							bind:value={bulkValue} 
							options={data.tags.map(t => ({value: t.name, label: t.name}))}
							labelPrefix="Tag: "
							buttonClass="btn-md btn-ghost bg-base-200 hover:bg-base-300 font-semibold rounded-xl gap-2 shadow-sm border border-base-300 w-full flex-1 justify-between"
							menuClass="w-full bg-base-100/95 backdrop-blur-xl rounded-xl border border-base-200 mb-2 gap-1 max-h-[60vh] overflow-y-auto flex-nowrap shadow-2xl z-[100]"
							dropdownClass="dropdown-top w-full flex-1"
						/>
                    {:else if bulkAction === 'addTag'}
                        <input type="text" name="bulkValue" bind:value={bulkValue} placeholder="Value..." required class="input input-bordered input-md rounded-xl w-full flex-1 bg-base-200" autocomplete="off" />
                    {:else}
                        <input type="hidden" name="bulkValue" value="action_only" />
                    {/if}
                    <button type="submit" class="btn btn-md {bulkAction === 'deleteItems' ? 'btn-error' : (bulkAction === 'exportCSV' ? 'btn-secondary' : 'btn-primary')} w-full sm:w-auto shadow-md shrink-0 rounded-xl" 
                            disabled={isSubmitting || (!bulkValue.trim() && !['deleteItems', 'flagDuplicate', 'dismissDuplicate', 'clearDuplicate', 'exportCSV'].includes(bulkAction))}
                            on:click={(e) => {
                                if (bulkAction === 'deleteItems') {
                                    e.preventDefault();
                                    bulkDeleteModal.showModal();
                                } else if (bulkAction === 'exportCSV') {
                                    e.preventDefault();
                                    exportCsvModal.showModal();
                                }
                            }}>
                        {#if isSubmitting}<span class="loading loading-spinner"></span>{:else if bulkAction === 'exportCSV'}<i class="bi bi-download"></i> Export {selectedIds.length}{:else}Apply to {selectedIds.length}{/if}
					</button>
				</div>
			</div>
		{/if}
	</form>

    <Modal bind:this={bulkDeleteModal} title="<i class='bi bi-exclamation-triangle-fill'></i> Delete {selectedIds.length} Items?" titleClass="font-bold text-lg text-error flex items-center gap-2" boxClass="border border-error/50">
        <p class="py-4 text-sm text-gray-600 mt-[-10px]">You are about to permanently delete <strong>{selectedIds.length}</strong> items. This action cannot be undone and will destroy all associated photos, documents, and data.</p>
        <div class="modal-action">
            <button type="button" class="btn btn-ghost" on:click={() => bulkDeleteModal.close()}>Cancel</button>
            <button type="button" class="btn btn-error" on:click={() => { bulkDeleteModal.close(); document.getElementById('bulkEditForm')?.requestSubmit(); }}>Delete Forever</button>
        </div>
    </Modal>

    <Modal bind:this={exportCsvModal} title="<i class='bi bi-filetype-csv text-secondary'></i> Export to CSV" titleClass="font-bold text-xl flex items-center gap-2 mb-2" boxClass="p-6 sm:rounded-3xl border border-base-200">
        <p class="text-sm text-gray-500 mb-6 mt-[-10px]">Select what data to include in your spreadsheet for the {selectedIds.length} selected items.</p>
        
        <div class="flex flex-col gap-3 mb-6 bg-base-200/50 p-4 rounded-xl border border-base-200">
            <label class="flex justify-between items-center cursor-pointer hover:bg-base-200 p-1 rounded transition-colors"><span class="font-semibold text-sm text-base-content">Core Details <span class="font-normal text-xs text-gray-500 block">Title, Qty, Desc</span></span> <input type="checkbox" class="toggle toggle-primary" bind:checked={exportConfig.core} /></label>
            <label class="flex justify-between items-center cursor-pointer hover:bg-base-200 p-1 rounded transition-colors"><span class="font-semibold text-sm text-base-content">Storage Locations <span class="font-normal text-xs text-gray-500 block">Where it lives</span></span> <input type="checkbox" class="toggle toggle-primary" bind:checked={exportConfig.locs} /></label>
            <label class="flex justify-between items-center cursor-pointer hover:bg-base-200 p-1 rounded transition-colors"><span class="font-semibold text-sm text-base-content">Attributes & Traits <span class="font-normal text-xs text-gray-500 block">Dynamically creates columns per attribute</span></span> <input type="checkbox" class="toggle toggle-primary" bind:checked={exportConfig.attrs} /></label>
            <label class="flex justify-between items-center cursor-pointer hover:bg-base-200 p-1 rounded transition-colors"><span class="font-semibold text-sm text-base-content">Tags</span> <input type="checkbox" class="toggle toggle-primary" bind:checked={exportConfig.tags} /></label>
            <label class="flex justify-between items-center cursor-pointer hover:bg-base-200 p-1 rounded transition-colors"><span class="font-semibold text-sm text-base-content">Primary Image Link <span class="font-normal text-xs text-gray-500 block">Absolute server URL</span></span> <input type="checkbox" class="toggle toggle-primary" bind:checked={exportConfig.images} /></label>
        </div>
        <div class="modal-action mt-0 flex gap-2">
            <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={() => exportCsvModal.close()} disabled={isExporting}>Cancel</button>
            <button type="button" class="btn btn-secondary flex-1 rounded-xl shadow-md" on:click={downloadCSV} disabled={isExporting}>
                {#if isExporting}
                    <span class="loading loading-spinner loading-sm"></span> Generating...
                {:else}
                    <i class="bi bi-download"></i> Download CSV
                {/if}
            </button>
        </div>
    </Modal>
{:else if searchTab === 'documents'}
    <DocumentList documents={data.documentResults} on:openDoc={(e) => docLightbox.open(e.detail)} on:openImage={(e) => imgLightbox.open(e.detail)} />
{:else}
	<Items items={data.items} />
	<Navigation href="/search?{searchParamsStr}&" prevPage={data.prevPage} nextPage={data.nextPage} />
{/if}

<DocumentLightbox bind:this={docLightbox} />
<ImageLightbox bind:this={imgLightbox} itemTitle="Search Result" />
