<script lang="ts">
    import QRreader from "$lib/components/QRreader.svelte";
    import { createEventDispatcher, tick } from 'svelte'
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
    import { page } from "$app/stores";
    import { speak } from "$lib/client/utils";
    const dispatch = createEventDispatcher();

    export let values = [];
    export let containers = [];
    export let defaultTab = 'scan';
    export let mini = false;
    // To satisfy Svelte -- mini is unused
    void mini;

    let scanningContainers = false;
    let addedContainers = [];
    let manualSelected = [];
	let isCreatingContainer = false;
	let explicitNewName = "";
	let confirmModal: ConfirmModal;

    $: userPrefs = (() => { try { return JSON.parse($page.data.user?.preferences || '{}'); } catch(e) { return {}; } })();
    $: enableScannerVoiceFeedback = userPrefs.enableScannerVoiceFeedback === true;

    // View state for tabs
    let activeTab = defaultTab; // 'scan' | 'select'
    let searchQuery = '';

    let searchInput: HTMLInputElement;
    function focusSearch() {
        if (typeof window !== 'undefined' && window.innerWidth >= 768) {
            setTimeout(() => searchInput?.focus(), 50);
        }
    }

    // Flatten parent/child hierarchy for easier searching and displaying
    $: flatContainers = containers.reduce((acc, c) => {
        acc.push({ ...c, isChild: false });
        if (c.children && c.children.length > 0) {
            c.children.forEach(child => acc.push({ ...child, isChild: true, parent: c.name }));
        }
        return acc;
    }, []);
    $: filteredContainers = flatContainers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) || (c.location && c.location.toLowerCase().includes(searchQuery.toLowerCase())));

    // // Combine QR-scanned containers and manually selected ones
    // // and dispatch back to MobileAddHub to show on badges
    // $: allContainers = Array.from(new Set([...addedContainers, ...manualSelected]));

    // Prevent Svelte string-spread bug by forcing array
    $: safeManualSelected = Array.isArray(manualSelected) ? manualSelected : (manualSelected ? [manualSelected] : []);
    $: allContainers = Array.from(new Set([...addedContainers, ...safeManualSelected]));

    // Reactively sync when parent modifies the array (e.g. clicking 'X' on a location pill)
    $: syncFromParent(values);

    function syncFromParent(newValues) {
        const incoming = newValues.map(v => v.container?.name || v.containerName || (typeof v === 'string' ? v : '')).filter(Boolean);
        const currentSafe = Array.isArray(manualSelected) ? manualSelected : (manualSelected ? [manualSelected] : []);
        const current = [...addedContainers, ...currentSafe];
        const isDifferent = incoming.length !== current.length || incoming.some(v => !current.includes(v));

        if (isDifferent) {
            manualSelected = incoming.filter(name => flatContainers.some(c => c.name === name));
            addedContainers = incoming.filter(name => !flatContainers.some(c => c.name === name));
        }
    }

    // Sync OUTWARDS only on explicit user actions
    async function dispatchUserChange() {
        await tick();
        dispatch('change', { containers: allContainers });
    }

    function toggleSelection(name) {
        if (manualSelected.includes(name)) {
            manualSelected = manualSelected.filter(n => n !== name);
        } else {
            manualSelected = [...manualSelected, name];
        }
        dispatchUserChange();
    }

    function announce(text: string) {
        if (enableScannerVoiceFeedback) {
            speak(text, userPrefs.voiceURI);
        }
    }

    function isValidContainer(txt)
    {
        // const containerRegExp = /(^[A-Z])|(\s[0-9]{3})/g
        // return containerRegExp.test(txt) || `QR said ${txt}, QR should be ID such as 'B 003'`;
        if (!txt || txt.trim() === '') return "Empty QR code";

        // const exists = flatContainers.some(c => c.name === txt);
        // if (!exists) return `Container "${txt}" not found in this Trove.`;
        return true;
    }

    function scannedContainer(ev: any, inputEltName: string, notify = true)
    {
        const exists = flatContainers.some(c => c.name === ev.detail);
        if (!exists) {
            scanningContainers = false;
			confirmModal.ask('Container Not Found', `Container "${ev.detail}" not found in this Trove. Create it now?`, 'Create', 'Cancel').then(res => {
                if (res) {
                    createContainer(ev.detail);
                }
			});
            announce("Container not found.");
            return;
        }

        if (!addedContainers.includes(ev.detail) || addedContainers.length !== 1 || manualSelected.length > 0) {
            addedContainers = [ev.detail];
            manualSelected = []; // Clear manual selections to cleanly switch the ambient box context
            dispatchUserChange();
            announce("Added to " + ev.detail);
        }

        // option.selected = true;

        if(notify) {
            dispatch("success", `Added container: ${ev.detail}`);
        }
    }

	async function removeScannedContainer(containerToRemove) {
		const res = await confirmModal.ask('Remove Container', `Remove container "${containerToRemove}"?`, 'Remove', 'Cancel', true);
		if (res) {
            addedContainers = addedContainers.filter(c => c !== containerToRemove);
            dispatchUserChange();
            dispatch("success", `Removed container: ${containerToRemove}`);
        }
    }    

	async function createContainer(nameToCreate) {
		if (!nameToCreate.trim()) return;
		isCreatingContainer = true;
		try {
			const res = await fetch('/api/containers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: nameToCreate })
			});
			if (res.ok) {
				const newC = await res.json();
				newC.isChild = false;
				containers = [...containers, newC];
				manualSelected = [...manualSelected, newC.name];
                dispatchUserChange();
				dispatch('success', `Created location: ${newC.name}`);
                announce("Created " + newC.name);
				if (searchQuery === nameToCreate) searchQuery = '';
				explicitNewName = '';
			} else {
				dispatch('error', 'Failed to create location.');
			}
		} finally {
			isCreatingContainer = false;
		}
	}

</script>

<div class="flex flex-col w-full">
    <!-- Tab Navigation -->
    {#snippet containerItem(container)}
        <div class="flex flex-col p-3 hover:bg-base-200/50 rounded-xl cursor-pointer transition-colors border border-base-200 shadow-sm">
            <label class="flex items-center gap-3 cursor-pointer w-full">
                <input type="checkbox" bind:group={manualSelected} value="{container.name}" class="checkbox checkbox-sm checkbox-primary" on:change={dispatchUserChange} />
                <div class="flex flex-col flex-1 {container.isChild ? 'ml-6' : ''}">
                    <span class="font-semibold text-sm leading-none flex items-center gap-2">
                        {#if container.isChild}<i class="bi bi-arrow-return-right text-gray-400 text-xs"></i>{/if}
                        {container.name}
                    </span>
                    {#if container.description}
                        <span class="text-xs text-gray-500 mt-1 opacity-80">{container.description}</span>
                    {/if}
                </div>
            </label>
            {#if container.children && container.children.length > 0 && !searchQuery.trim()}
                <div class="ml-8 mt-2 flex flex-wrap gap-1.5">
                    {#each container.children as child}
                        <button type="button" class="badge gap-1 p-3 cursor-pointer transition-colors {manualSelected.includes(child.name) ? 'badge-primary shadow-sm' : 'badge-ghost bg-base-200 border-base-300 hover:border-primary/50'}" on:click|preventDefault|stopPropagation={() => toggleSelection(child.name)}>
                            {child.name}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    {/snippet}
	<div role="tablist" class="flex bg-base-200/70 p-1 mb-4 w-full rounded-xl">
        <button 
            type="button" 
            role="tab" 
			class="flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center flex-nowrap whitespace-nowrap {activeTab === 'scan' ? 'bg-base-100 shadow text-base-content' : 'text-gray-500 hover:text-gray-700'}"
            on:click={() => activeTab = 'scan'}
        >
            <i class="bi bi-qr-code-scan mr-2 whitespace-nowrap"></i> <span class="truncate">Scan QR</span>
        </button>
        <button 
            type="button" 
            role="tab" 
			class="flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center flex-nowrap whitespace-nowrap {activeTab === 'select' ? 'bg-base-100 shadow text-base-content' : 'text-gray-500 hover:text-gray-700'}"
            on:click={() => { activeTab = 'select'; focusSearch(); }}
        >
            <i class="bi bi-list-check mr-2 whitespace-nowrap"></i> <span class="truncate">Manual</span>
        </button>
    </div>

    <!-- Content Area with tighter mobile padding -->
    <div class="bg-base-50/50 rounded-xl border-2 border-dashed border-base-300 p-2 sm:p-6 min-h-[200px] flex flex-col transition-all">
        
        <div class="flex flex-col items-center justify-center h-full w-full animate-fade-in" class:hidden={activeTab !== 'scan'}>
            {#if scanningContainers}
                <QRreader validator={isValidContainer} title="Scan QR-code on container" on:scan={(ev) => { scannedContainer(ev, "containers") } } on:stop={()=>{ scanningContainers=false }}></QRreader>
            {:else}
                <div class="bg-base-200 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="bi bi-box-seam text-2xl text-gray-500"></i>
                </div>
                <h3 class="font-semibold text-lg mb-1">Scan Container</h3>
                <p class="text-sm text-gray-400 text-center mb-4">Point your camera at a storage box QR code.</p>
                
                <button class="btn btn-primary btn-wide shadow-sm" type="button" on:click={()=>{scanningContainers=true;}}>
                    <i class="bi bi-qr-code-scan mr-2"></i> Open Scanner
                </button>
            {/if}

            {#if addedContainers.length > 0}
                <div class="mt-4 w-full text-center">
                    <span class="text-sm text-gray-500 block mb-2">Located in:</span>
                    <div class="flex flex-wrap gap-2 justify-center">
                        {#each addedContainers as container}
                            <button type="button" class="badge badge-primary badge-outline gap-1 p-3 font-mono hover:bg-error hover:border-error hover:text-error-content transition-colors cursor-pointer" on:click={() => removeScannedContainer(container)} title="Remove {container}">
                                <i class="bi bi-box"></i> {container} <i class="bi bi-x ml-1 opacity-70 text-lg leading-none -mr-1"></i>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <div class="flex flex-col h-full w-full animate-fade-in" class:hidden={activeTab !== 'select'}>
			<!-- Persistent Inline Create -->
			<div class="flex items-center gap-2 mb-3 bg-base-200/50 p-2 rounded-xl border border-base-200">
				<input type="text" placeholder="Quick create new container..." class="input input-sm border-none shadow-inner bg-base-100 flex-1" bind:value={explicitNewName} on:keydown={(e) => e.key === 'Enter' && (e.preventDefault(), createContainer(explicitNewName))} />
				<button type="button" class="btn btn-sm btn-primary shadow-sm" disabled={isCreatingContainer || !explicitNewName.trim()} on:click={() => createContainer(explicitNewName)}>
					{#if isCreatingContainer && explicitNewName.trim()}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<i class="bi bi-plus-lg"></i> Create
					{/if}
				</button>
			</div>

            <div class="form-control mb-3">
                <div class="input input-bordered flex items-center gap-2 rounded-xl shadow-sm">
                    <i class="bi bi-search text-gray-400"></i>
                    <input type="text" bind:this={searchInput} bind:value={searchQuery} placeholder="Search containers..." class="grow bg-transparent border-none focus:outline-none" />
                </div>
            </div>

            {#if searchQuery.trim().length > 0}
                <div class="bg-base-100 border border-base-200 rounded-xl overflow-y-auto max-h-64 p-2 flex flex-col gap-1 shadow-inner">
                    {#each filteredContainers as container}
                        {@render containerItem(container)}
                    {:else}
                        <div class="p-6 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
                            <i class="bi bi-inbox text-2xl"></i>
                            No containers found matching "{searchQuery}"

                            {#if searchQuery.trim().length > 0}
                                <button type="button" class="btn btn-primary btn-sm mt-3 shadow-sm rounded-xl" disabled={isCreatingContainer} on:click={() => createContainer(searchQuery)}>
                                    {#if isCreatingContainer && searchQuery.trim()}
                                        <span class="loading loading-spinner loading-xs"></span>
                                    {:else}
                                        Create "{searchQuery}"
                                    {/if}
                                </button>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="bg-base-100 border border-base-200 rounded-xl overflow-y-auto max-h-64 p-2 flex flex-col gap-2 shadow-inner">
                    {#each containers as container}
                        {@render containerItem(container)}
                    {:else}
                        <div class="p-6 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
                            <i class="bi bi-inbox text-2xl"></i>
                            No containers found in this Trove.
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

    </div>
</div>

<ConfirmModal bind:this={confirmModal} />
