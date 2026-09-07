<script lang="ts">
    import type { SubmitFunction } from "./$types";
    import { enhance } from "$app/forms";
    import { page, navigating } from "$app/stores";
    import { onNavigate, beforeNavigate, invalidateAll } from '$app/navigation';
    import { browser } from '$app/environment';
    import Search from "$lib/components/search.svelte";
    import ReloadPrompt from "$lib/components/ReloadPrompt.svelte";
    import pageTitle from '$lib/stores';
    
    // Demo only (show where taps are for recording purposes)
    import TouchIndicator from '$lib/components/TouchIndicator.svelte';
    
    import "../app.css";
    
    // Check out the virtual:pwa-info documentation to learn more about the virtually exposed module pwa-info.
    // https://vite-pwa-org.netlify.app/frameworks/#accessing-pwa-info
    import { onMount, onDestroy } from 'svelte'
    // @ts-expect-error virtual module provided by vite-pwa
    import { pwaInfo } from 'virtual:pwa-info'
    import { outboxStore, completedOutboxStore, getQueue, clearQueueItem, clearEntireQueue, deserializeToFormData, updateQueueItemStatus, refreshStore } from '$lib/client/offlineQueue';
    import { nukeAllCaches } from '$lib/client/utils';
    
    import Notifications from "$lib/components/Notifications.svelte";
    import { notifications, notify } from "$lib/client/notifications";
    
    import KeyboardManager from '$lib/components/KeyboardManager.svelte';
    import ContainerSelector from "$lib/components/ContainerSelector.svelte";
    import CreateInventoryModal from "$lib/components/CreateInventoryModal.svelte";
    import { ambientLocation } from '$lib/client/ambientContext';
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import InstallPrompt from "$lib/components/InstallPrompt.svelte";
    import ActionCard from "$lib/components/ActionCard.svelte";
    import Modal from "$lib/components/Modal.svelte";
    import DropdownSelect from "$lib/components/DropdownSelect.svelte";
    import Logo from "$lib/components/Logo.svelte";
    
    let mounted = false;    
    let confirmModal: ConfirmModal;
    
    onMount(async () => {
        mounted = true;
        // Service worker is managed reliably by <ReloadPrompt />.
        // Removing redundant manual registration to prevent race conditions.
    })
    
    // REALTIME SYNC ENGINE
    if (browser) {
        let evtSource: EventSource | null = null;
        
        const safeInvalidate = () => {
            const activeTag = document.activeElement?.tagName;
            const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
            const isDropdownOpen = !!document.querySelector('.dropdown-open') || !!document.activeElement?.closest('.dropdown');
            
            if (isTyping || isDropdownOpen || $navigating) {
                console.log("🕵️‍♂️ [DEBUG-SYNC] User is interacting or navigating. Deferring invalidateAll().");
                const attemptSync = () => {
                    const active = document.activeElement?.tagName;
                    const dropdown = document.querySelector('.dropdown-open') || document.activeElement?.closest('.dropdown');
                    if (active === 'INPUT' || active === 'TEXTAREA' || active === 'SELECT' || dropdown || $navigating) {
                        setTimeout(attemptSync, 1000);
                    } else {
                        console.log("🕵️‍♂️ [DEBUG-SYNC] Interaction complete. Syncing UI via invalidateAll().");
                        invalidateAll();
                    }
                };
                setTimeout(attemptSync, 1000);
            } else {
                console.log("🕵️‍♂️ [DEBUG-SYNC] Syncing UI instantly via invalidateAll().");
                invalidateAll();
            }
        };
        
        const connectSync = () => {
            if (evtSource) return;
            console.log("[DEBUG-CACHE] 🔌 Attempting to connect SSE...");
            evtSource = new EventSource('/api/events');
            evtSource.onmessage = (event) => {
                if (event.data === 'update') {
                    console.log("[DEBUG-CACHE] 🔔 SSE Event received! DB mutated. Firing app-sync & safeInvalidate().");
                    window.dispatchEvent(new CustomEvent('app-sync'));
                    safeInvalidate();
                } else {
                    try {
                        const payload = JSON.parse(event.data);
                        if (payload.type === 'health') {
                            sysHealth = { status: payload.status, reason: payload.reason };
                        }
                    } catch (e) {}
                }
            };
        };
        
        const disconnectSync = () => {
            if (evtSource) {
                evtSource.close();
                evtSource = null;
            }
        };
        
        onMount(() => {
            connectSync();
            
            // Aggressive battery saving: Kill connection when app goes to background.
            document.addEventListener('visibilitychange', () => {
                console.log(`[DEBUG-CACHE] 👁️ Visibility changed: ${document.visibilityState} | Network Online: ${navigator.onLine}`);
                if (document.visibilityState === 'visible') {
                    console.log(`[DEBUG-CACHE] 🚀 Waking up! Triggering connectSync & invalidateAll()...`);
                    connectSync();
                    invalidateAll(); // Fetch fresh data to catch up on what we missed while asleep
                } else {
                    console.log(`[DEBUG-CACHE] 💤 Going to sleep. Disconnecting SSE.`);
                    disconnectSync();
                }
            });
        });
        
        onDestroy(disconnectSync);
    }
    
    // GLOBAL SYNC ENGINE (Outbox)
    async function processOutbox() {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            await navigator.locks.request('troves-outbox-sync', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
                if (lock) await doProcessOutbox();
            });
        } else {
            await doProcessOutbox();
        }
    }
    
    let isSyncing = false;
    async function doProcessOutbox() {
        if (isSyncing || !navigator.onLine) return;
        isSyncing = true;
        try {
            const queue = await getQueue();
            for (const item of queue) {
                // Since we obtained the exclusive 'troves-outbox-sync' Web Lock, we know for a fact 
                // that no other tab is currently syncing. If an item is stuck in 'syncing' status, 
                // it's a zombie from a browser crash or closed tab. We should process it.
                // if (item.status === 'syncing') continue; 
                
                await updateQueueItemStatus(item.id!, 'syncing', item.retries);
                try {
                    const fd = deserializeToFormData(item.payload);
                    const cleanEndpoint = item.endpoint.replace('?/default', '');
                    
                    // Emulate SvelteKit native form action to prevent downloading full HTML pages on redirect
                    const res = await fetch(cleanEndpoint, { 
                        method: 'POST', 
                        body: fd,
                        headers: {
                            'x-sveltekit-action': 'true',
                            'accept': 'application/json'
                        }
                    });
                    
                    if (res.ok) {
                        // Bridge the temporal gap: Keep item in completed store permanently to prevent ghost disappearance. 
                        // items.svelte natively deduplicates it against the server response instantly.
                        completedOutboxStore.update(s => { const next = [...s, item]; return next.length > 50 ? next.slice(next.length - 50) : next; });
                        
                        await clearQueueItem(item.id!);
                        
                        console.log("[DEBUG-LAYOUT] Outbox item synced. Firing sync event.");
                        
                        // Explicitly trigger the app sync logic instantly without waiting for SSE
                        window.dispatchEvent(new CustomEvent('app-sync'));
                        safeInvalidate();
                        
                    } else if (res.status === 400 || res.status === 403 || res.status === 404) {
                        // Unrecoverable error (e.g., item deleted, inventory changed, validation failed).
                        // We drop the queue item to prevent an infinite sync loop.
                        console.warn(`[OFFLINE QUEUE] Unrecoverable error ${res.status}. Dropping payload for ${cleanEndpoint}`);
                        await clearQueueItem(item.id!);
                    } else {
                        await updateQueueItemStatus(item.id!, 'failed', item.retries + 1);
                    }
                } catch (e) {
                    await updateQueueItemStatus(item.id!, 'pending', item.retries + 1);
                    break; // Stop syncing if network drops
                }
            }
        } finally {
            isSyncing = false;
        }
    }
    
    let ambientContainerModal: HTMLDialogElement;
    let loadingContainers = false;
    let globalContainers: any[] = [];
    async function openAmbientModal() {
        ambientContainerModal.showModal();
        if (globalContainers.length === 0) {
            loadingContainers = true;
            try {
                const res = await fetch('/api/containers');
                if (res.ok) globalContainers = await res.json();
            } finally { loadingContainers = false; }
        }
    }
    
    let mobileMenuModal: HTMLDialogElement;
    let createInventoryModal: CreateInventoryModal;
    
    let sysHealth = { status: 'healthy', reason: null };
    
    let quickNoteModal: Modal;
    let quickNoteTimer: any;
    let quickNoteFired = false;
    let quickNoteReady = false;
    
    function quickNoteTouchStart(e: Event) {
        clearTimeout(quickNoteTimer);
        quickNoteFired = false;
        quickNoteReady = false;
        
        quickNoteTimer = setTimeout(() => {
            quickNoteFired = true;
            quickNoteReady = true;
            // Standard vibration for Android (iOS Safari ignores this natively)
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(50);
            }
        }, 400); // 400ms long press
    }
    function quickNoteTouchEnd(e: Event) {
        clearTimeout(quickNoteTimer);
        if (quickNoteFired) {
            e.preventDefault(); // stops the href from firing if long press was triggered
            quickNoteReady = false;
            quickNoteFired = false;
            quickNoteModal.showModal();
            const ta = quickNoteModal.querySelector('textarea');
            if (ta) setTimeout(() => ta.focus(), 50);
            // Keep the flag true for a split second to swallow the subsequent click event and gracefully hand off the UI
        } else {
            quickNoteReady = false;
        }
    }
    
    beforeNavigate(({ type, to, from }) => {
        console.log(`[DEBUG-LAYOUT] beforeNavigate: from ${from?.url?.pathname} to ${to?.url?.pathname}, type: ${type}`);
        
        // SCROLL FIX: We ONLY destroy the infinite-scroll cache if the user explicitly clicks 
        // a navigation link TO a list page (like clicking the 'Home' icon).
        if (type === 'link' && to && from?.url?.pathname !== to.url.pathname) {
            const path = to.url.pathname;
            const isListView = path === '/' || path.startsWith('/search') || path.startsWith('/container') || path.startsWith('/tag');
            
            if (isListView) {
                console.log("[DEBUG-LAYOUT] Navigating to a list view. Clearing nav caches.");
                try {
                    Object.keys(sessionStorage).forEach(key => {
                        if (key.startsWith('nav-cache-')) sessionStorage.removeItem(key);
                    });
                } catch (e) {}
            } else {
                console.log("[DEBUG-LAYOUT] Navigating into item/action. Preserving nav cache.");
            }
        }
    });
    
    onNavigate((navigation) => {
        if (!document.startViewTransition) {
            return;
        }
        
        // APPLE WEBKIT BUG: iOS 18 enabled View Transitions, but using them going forward 
        // destroys Safari's ability to cache the previous page snapshot. 
        // This results in a black screen when edge-swiping back. We opt Apple devices out to protect the native swipe.
        const isAppleDevice = typeof navigator !== 'undefined' && (
        /iPad|iPhone|iPod/.test(navigator.userAgent) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
        /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
        );
        if (isAppleDevice) return;
        
        // Bypassing View Transitions on popstate allows the native iOS swipe-back
        // snapshot to smoothly handoff without CSS animations jerking it around.
        if (navigation.type === 'popstate') return;
        
        // Prevent full-page crossfade "refresh" effect when merely updating search parameters (filters/tabs)
        // TODO: I am not sure how much this will bite me in the ass; this was added LONG after I started development.
        if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;
        
        // Determine if we're programmatically going backwards
        if (navigation.delta != null && navigation.delta < 0) {
            document.documentElement.classList.add('back-transition');
        } else {
            document.documentElement.classList.remove('back-transition');
        }
        
        return new Promise((resolve) => {
            const transition = document.startViewTransition(async () => {
                resolve();
                await navigation.complete;
            });
            
            // Clean up the class after the animation completes
            transition.finished.finally(() => {
                document.documentElement.classList.remove('back-transition');
            });
        });
    });    
    
    $: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : '';
    
    // TOOD:
    // Testing for more 'live' check of whether we are installed on homescreen or not.
    // It seems the "proper" way is to have a query param, say "installed" or so as base url
    // in the manifest.
    //
    // That said:
    // On my iPhone:
    //  installed: win: 647, scr: 667, full: false (20 pixels less than screen)
    //             To note here is probably if OS pops up password-vault and similar
    //             during this check the window height will likely be less.
    //  in safari: win: 548, scr: 667, full: false (...more)
    //
    
    onMount(() => {
        refreshStore();
        window.addEventListener('online', processOutbox);
        window.addEventListener('outbox-trigger', processOutbox); // Custom event to trigger sync instantly
        processOutbox();
        const outboxInterval = setInterval(processOutbox, 10000); // Failsafe check every 10s
        
        return () => {
            window.removeEventListener('online', processOutbox);
            window.removeEventListener('outbox-trigger', processOutbox);
            clearInterval(outboxInterval);
        };
    });
    
    let themeColor = "";
    onMount(() => {
        const updateThemeColor = () => {
            const bodyBg = getComputedStyle(document.body).backgroundColor;
            if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)') {
                themeColor = bodyBg;
            }
        };
        updateThemeColor();
        const observer = new MutationObserver(updateThemeColor);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
    
    // Dynamically enable tap visibility
    // Use the classic $: reactive statement instead of $derived
    $:  isDemoMode = 
    $page.url.hostname === 'localhost' || 
    $page.url.hostname.startsWith('192.168.178.');
    
    // Global Navigation Feedback (for slow/dropped connections)
    let showNavProgress = false;
    let navTimer: ReturnType<typeof setTimeout>;
        let slowNavTimer: ReturnType<typeof setTimeout>;
            
            // Scroll-to-hide Navigation State
            let scrollY = 0;
            let lastScrollY = 0;
            let hideNav = false;
            
            function handleScroll() {
                if (scrollY > 60 && scrollY > lastScrollY) {
                    hideNav = true;
                } else if (scrollY < lastScrollY || scrollY <= 60) {
                    hideNav = false;
                }
                lastScrollY = scrollY;
            }
            
            $: if ($navigating) {
                clearTimeout(navTimer);
                clearTimeout(slowNavTimer);
                navTimer = setTimeout(() => showNavProgress = true, 400); // Prevent flashing on fast links
                slowNavTimer = setTimeout(() => {
                    if ($navigating) notify('warning', 'Connection is struggling. Still trying to load...');
                }, 8000);
            } else {
                clearTimeout(navTimer);
                clearTimeout(slowNavTimer);
                showNavProgress = false;
            }
            
            $: activeVaultName = $page.data.inventories?.find(i => i.id === $page.data.activeInventoryId)?.name || '';
            $: vaultStr = activeVaultName ? ' | ' + (activeVaultName.length > 25 ? activeVaultName.substring(0, 25).trim() + '...' : activeVaultName) : '';
            
        </script>
        
        <svelte:head> 
        {#if mounted && webManifest}{@html webManifest}{/if}

        <title>{$pageTitle}{vaultStr} | Troves</title>
        <meta name="theme-color" content={themeColor || "#1d232a"} />
    </svelte:head>
    
    {#if $page.data.user}
        <KeyboardManager preferences={$page.data.user.preferences} />
    {/if}
    
    <TouchIndicator enabled={isDemoMode} />
    
    <svelte:window bind:scrollY on:scroll={handleScroll} />
    
<!-- Premium Static Ambient Wash (Disabled on Auth/Setup to avoid clashing with animated versions) -->
{#if !['/login', '/setup', '/register'].includes($page.url.pathname)}
    <div class="fixed inset-0 z-[-1] overflow-hidden bg-base-100 pointer-events-none transition-colors duration-500">
        <div class="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] md:w-[40vw] md:h-[40vw] rounded-full bg-primary/10 blur-[100px] md:blur-[150px]"></div>
        <div class="absolute top-[10%] right-[-10%] w-[60vw] h-[60vw] md:w-[35vw] md:h-[35vw] rounded-full bg-secondary/10 blur-[100px] md:blur-[150px]"></div>
        <div class="absolute bottom-[-10%] left-[10%] w-[80vw] h-[80vw] md:w-[50vw] md:h-[50vw] rounded-full bg-accent/10 blur-[100px] md:blur-[150px]"></div>
    </div>
{/if}

    {#if showNavProgress}
        <progress class="progress progress-primary bg-transparent w-full fixed top-0 left-0 z-[10000] rounded-none h-1"></progress>
    {/if}
    
    <div class="navbar bg-base-100/90 backdrop-blur-xl border-b border-base-200/50 sticky top-0 z-50 transition-transform duration-300 ease-out {hideNav ? '-translate-y-full md:translate-y-0' : 'translate-y-0'}">
        <!-- Mobile menu -->
        <div class="navbar-start pl-3">
            <button on:click={()=>history.back()} class="pt-1" aria-label="Go back">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
            </button>
            
            <div class="hidden lg:flex items-center ml-1">
                <a href="/" class="btn btn-ghost normal-case text-xl flex items-center gap-3 px-2 hover:bg-base-200 transition-colors rounded-xl">
                    <Logo size="sm" />
                    <span class="font-bold tracking-tight">Troves</span>
                </a>
                
                {#if $page.data.inventories && $page.data.inventories.length > 0}
                    <DropdownSelect
                        dropdownClass="dropdown-bottom ml-4"
                        options={
                            $page.data.inventories.slice()
                                .sort((a,b) => a.name.localeCompare(b.name))
                                .map(inv => ({ value: inv.id, label: inv.name }))
                        }
                        value={$page.data.activeInventoryId}
                        formAction="/?/switchVault"
                        name="inventoryId"
                        reload={false}
                        on:submit={() => mobileMenuModal.close()}
                    >
                        <div slot="header" class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Switch Trove</div>
                        <svelte:fragment slot="footer"></svelte:fragment>
                    </DropdownSelect>
                {:else if $page.data.user && ($page.data.user.isAdmin || $page.data.user.canCreateInventories)}
                    <button class="btn btn-sm btn-primary ml-4 rounded-xl shadow-sm" on:click={() => createInventoryModal.showModal()}>
                        <i class="bi bi-plus-lg"></i> Create Trove
                    </button>
                {/if}
            </div>
        </div>
        
        <div class="navbar-center">
            <!-- search; all screens -->
            <div class="form-control items-end">
                <Search />
            </div>
        </div>
        
        <div class="navbar-end">
            {#if sysHealth.status === 'degraded'}
                <div class="tooltip tooltip-bottom sm:tooltip-left mr-2" data-tip={sysHealth.reason || ''}>
                    <div class="flex items-center gap-1.5 px-3 py-1 bg-base-200/50 rounded-full border border-base-300 text-warning shadow-sm animate-fade-in cursor-help">
                        <i class="bi bi-pause-circle-fill"></i>
                        <span class="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Server Degration</span>
                    </div>
                </div>
            {/if}
            
            {#if $outboxStore.length > 0}
                <div class="tooltip tooltip-left mr-2" data-tip={sysHealth.status === 'degraded' ? (sysHealth.reason || '') : `Syncing ${$outboxStore.length} items to server`}>
                    <span class="btn btn-ghost btn-circle text-primary pointer-events-none">
                        <span class="indicator">
                            {#if sysHealth.status === 'degraded'}
                                <i class="bi bi-cloud-pause-fill text-xl text-warning"></i>
                                <span class="badge badge-xs badge-warning indicator-item">{$outboxStore.length}</span>
                            {:else}
                                <i class="bi bi-cloud-arrow-up text-xl {$outboxStore.some(i => i.status === 'syncing') ? 'animate-pulse' : ''}"></i>
                                <span class="badge badge-xs badge-primary indicator-item">{$outboxStore.length}</span>
                            {/if}
                        </span>
                    </span>
                </div>
            {/if}
            
            <button type="button" id="profile-menu-btn" class="btn btn-ghost btn-circle active:scale-95 transition-transform" on:click={() => mobileMenuModal.showModal()} aria-label="Open Menu">
                {#if $page.data.user}
                    <div class="avatar {$page.data.user.avatar ? '' : 'placeholder'}">
                        <div class="bg-base-200 text-base-content rounded-full w-9 shadow-sm border border-base-300 overflow-hidden">
                            {#if $page.data.user.avatar}
                                <img src={$page.data.user.avatar} alt="Profile" class="object-cover w-full h-full" />
                            {:else}
                                <span class="text-sm font-bold uppercase">{$page.data.user.name.charAt(0)}</span>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <i class="bi bi-three-dots text-2xl"></i>
                {/if}
            </button>
        </div>
    </div>

    <main class="container md:w-[800px] px-4 sm:px-6 md:px-8 mx-auto my-6 md:my-8" style="padding-bottom: 100px;">
        <slot />
    </main>

    {#if mounted}
        <ReloadPrompt />
    {/if}

    <div class="btm-nav" style="z-index: 50; padding-bottom: env(safe-area-inset-bottom); height: calc(5rem + env(safe-area-inset-bottom));">
        <a class="active:scale-95 transition-transform duration-200 flex flex-col items-center justify-center gap-1 {$page.url.pathname==='/' ? 'active' : ''}" href="/">
            <i class="bi bi-house-door text-xl"></i>
            <span class="btm-nav-label text-[10px]">Home</span>
        </a>
        
        {#if $page.data.user}
            <a class="active:scale-95 transition-transform duration-200 flex flex-col items-center justify-center gap-1 {$page.url.pathname==='/add' ? 'active' : ''}" href="/add" title="Add new item">
                <i class="bi bi-plus-circle text-xl"></i>
                <span class="btm-nav-label text-[10px]">New</span>
            </a>
        {/if}
        
        {#if $page.data.inventories?.find(i => i.id === $page.data.activeInventoryId)?.enableNotebook !== false}
            <a class="active:scale-95 transition-all duration-200 flex flex-col items-center justify-center gap-1 select-none relative {$page.url.pathname.startsWith('/timeline') ? 'active' : ''} {quickNoteReady ? 'text-primary drop-shadow-md' : ''}" href="/timeline"
                style="-webkit-touch-callout: none; touch-action: none;"
                on:click={(e) => { if (quickNoteFired) e.preventDefault(); }}
                on:pointerdown={quickNoteTouchStart}
                on:pointerup={quickNoteTouchEnd}
                on:pointercancel={quickNoteTouchEnd}
                on:pointerleave={quickNoteTouchEnd}
                on:contextmenu|preventDefault>
        
                <!-- Floating Indicator that pops up above the thumb when ready -->
                <div class="absolute left-1/2 -translate-x-1/2 transition-all duration-200 pointer-events-none z-50 flex flex-col items-center {quickNoteReady ? '-top-20 opacity-100 scale-110' : 'top-0 opacity-0 scale-50'}">
                    <div class="bg-primary text-primary-content px-4 py-2 rounded-full shadow-2xl text-xs font-bold whitespace-nowrap flex items-center gap-2">
                        <i class="bi bi-pencil-square text-lg"></i> Release to write
                    </div>
                    <div class="w-2 h-2 bg-primary rotate-45 -mt-1 rounded-sm"></div>
                </div>
                
                <i class="bi bi-journal-bookmark text-xl"></i>
                <span class="btm-nav-label text-[10px]">Notebook</span>
            </a>
        {/if}
    </div>

    <Modal bind:this={quickNoteModal} title="Quick Note" position="top" boxClass="mt-8 sm:mt-0 rounded-3xl sm:rounded-[2.5rem] p-6 border border-base-200">
        <form method="POST" action="/timeline?/capture" on:paste|stopPropagation use:enhance={({ formElement }) => {
            quickNoteModal.close();
            return async ({ result }) => { 
                if (result.type === 'success' || result.type === 'redirect') {
                    formElement.reset(); 
                    notify('success', 'Note saved to Notebook!');
                } else {
                    notify('error', 'Failed to save note.');
                }
            };
        }}>
            {#if $page.url.pathname !== '/timeline' && $page.url.pathname !== '/'}
                <input type="hidden" name="url" value={$page.url.href} />
            {/if}
            <textarea name="content" placeholder="Jot something down..." class="textarea textarea-bordered w-full resize-none h-32 rounded-xl mb-4"></textarea>
            <div class="modal-action mt-0 flex gap-2">
                <button type="button" class="btn btn-ghost flex-1 rounded-xl" on:click={() => quickNoteModal.close()}>Cancel</button>
                <button type="submit" class="btn btn-primary flex-1 rounded-xl shadow-md">Save Note</button>
            </div>
        </form>
    </Modal>

    <InstallPrompt />
    <Notifications bind:notifications={$notifications} />
    <CreateInventoryModal bind:this={createInventoryModal} on:success={(e) => { notify('success', e.detail); invalidateAll(); }} on:error={(e) => notify('error', e.detail)} />
        
    <!-- Global Ambient Container Selector -->
    <Modal bind:this={ambientContainerModal} title="Set Default Location" titleClass="font-bold text-xl mb-1" boxClass="p-4 sm:rounded-[2.5rem] border border-base-200">
        <p class="text-xs text-gray-500 mb-4 mt-[-10px]">This location will be automatically assigned to items you scan in this session.</p>
        {#if loadingContainers}
            <div class="flex justify-center p-8"><span class="loading loading-spinner text-primary"></span></div>
        {:else}
            <ContainerSelector containers={globalContainers} values={$ambientLocation.map(name => ({ container: { name } }))} defaultTab="select" on:change={(e) => { ambientLocation.setContext(e.detail.containers); ambientContainerModal.close(); }} />
        {/if}
    </Modal>
        
    <!-- Bottom Sheet Menu -->
    <Modal bind:this={mobileMenuModal} boxClass="sm:rounded-[2.5rem] p-4 sm:p-6 bg-base-100/95 shadow-2xl border border-base-200 !overflow-visible">
        <div class="flex justify-between items-center mb-6 px-2 mt-[-10px]">
            <h3 class="font-bold text-2xl tracking-tight">Menu <span class="text-xs text-slate-500">{import.meta.env.PUBLIC_APP_VERSION}</span></h3>
            <button type="button" class="btn btn-sm btn-circle btn-ghost bg-base-200/50" on:click={() => mobileMenuModal.close()}>✕</button>
        </div>
        
        <div class="flex flex-col gap-3">
            {#if $page.data.inventories && $page.data.inventories.length > 1}
                <div class="bg-base-200/50 rounded-2xl border border-base-200 flex flex-col shadow-sm mb-1 overflow-visible relative z-50">
                    <div class="flex items-center gap-4 p-4">
                        <div class="w-10 h-10 rounded-full bg-warning/10 text-warning flex items-center justify-center shrink-0">
                            <i class="bi bi-safe2-fill text-xl"></i>
                        </div>
                        <div class="flex-1">
                            <div class="text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Active Trove</div>
                            <DropdownSelect
                                dropdownClass="dropdown-bottom w-full"
                                buttonClass="btn-sm btn-ghost bg-transparent hover:bg-base-200 font-bold w-full justify-between px-2 -ml-2 h-auto min-h-0 text-lg shadow-none rounded-xl"
                                menuClass="bg-base-100 rounded-xl w-[calc(100%+2rem)] -ml-4 max-h-[50vh] overflow-y-auto flex-nowrap"
                                chevronClass="bi-chevron-expand text-sm opacity-50"
                                options={$page.data.inventories.slice().sort((a,b) => a.name.localeCompare(b.name)).map(inv => ({ value: inv.id, label: inv.name }))}
                                value={$page.data.activeInventoryId}
                                formAction="/?/switchVault"
                                name="inventoryId"
                                reload={false}
                                on:submit={() => mobileMenuModal.close()}
                            >
                                <svelte:fragment slot="footer"></svelte:fragment>
                            </DropdownSelect>
                        </div>
                    </div>
                </div>
            {/if}
        
            <!-- Group 1: Navigation -->
            <div class="bg-base-200/50 rounded-2xl border border-base-200 overflow-hidden flex flex-col shadow-sm">
                {#if $page.data.user}
                    <ActionCard 
                        title="Containers" 
                        href="/container" 
                        icon="bi-box-seam-fill" 
                        iconColorClass="bg-info/10 text-info" 
                        variant="flat" 
                        on:click={() => mobileMenuModal.close()} 
                    />
                    <ActionCard 
                        title="Categories" 
                        href="/categories" 
                        icon="bi-tags-fill" 
                        iconColorClass="bg-success/10 text-success" 
                        variant="flat" 
                        on:click={() => mobileMenuModal.close()} 
                    />
                {/if}
            </div>
        
            <!-- Group 2: Account & Settings -->
            <div class="bg-base-200/50 rounded-2xl border border-base-200 overflow-hidden flex flex-col shadow-sm mt-2">
                <ActionCard 
                    title="Preferences" 
                    href="/profile" 
                    icon="bi-person-circle" 
                    iconColorClass="bg-base-300 text-base-content" 
                    variant="flat" 
                    on:click={() => mobileMenuModal.close()} 
                />
                
                {#if $page.data.user?.isAdmin || $page.data.user?.canCreateInventories || ($page.data.inventories && $page.data.inventories.length > 0)}
                    <ActionCard 
                        title="Manage Troves" 
                        href="/settings/troves" 
                        icon="bi-collection-fill" 
                        iconColorClass="bg-secondary/10 text-secondary" 
                        variant="flat" 
                        on:click={() => mobileMenuModal.close()} 
                    />
                {/if}
                
                <!-- This is currently hidden; press the (by default) "L" keybind to trigger it -->
                <ActionCard 
                    id="ambient-container-btn"
                    style="display: none;"
                    title="Set Default Location" 
                    subtitle={$ambientLocation.length ? $ambientLocation.join(', ') : 'None'}
                    icon="bi-pin-angle-fill" 
                    iconColorClass="bg-primary/10 text-primary" 
                    variant="flat" 
                    on:click={() => { mobileMenuModal.close(); openAmbientModal(); }} 
                />
                
                {#if $page.data.user?.isAdmin}
                    <ActionCard 
                        title="System Admin" 
                        href="/settings/admin" 
                        icon="bi-shield-lock-fill" 
                        iconColorClass="bg-error/10 text-error" 
                        variant="flat" 
                        on:click={() => mobileMenuModal.close()} 
                    />
                    <ActionCard 
                        title="Clear Cache" 
                        icon="bi-trash3" 
                        iconColorClass="bg-error/10 text-error" 
                        buttonClass="hover:bg-error/10 hover:text-error"
                        showChevron={false}
                        variant="flat" 
                        on:click={async () => { 
                            mobileMenuModal.close(); 
                            const res = await confirmModal.ask('Clear Caches?', 'This will clear all offline data, queues, and force a hard reload. Any pending uploads will be deleted. Continue?', 'Clear', 'Cancel', true);
                            if (res) { await clearEntireQueue(); nukeAllCaches(true); }
                        }} 
                    />
                {/if}
                
                {#if !$page.data.user}
                    <ActionCard 
                        title="Log in" 
                        href="/login" 
                        icon="bi-box-arrow-in-right" 
                        iconColorClass="bg-base-300 text-base-content" 
                        showChevron={false}
                        variant="flat" 
                        on:click={() => mobileMenuModal.close()} 
                    />
                {:else}
                    <form method="POST" action="/logout" use:enhance on:submit={() => mobileMenuModal.close()} class="m-0">
                        <ActionCard 
                            title="Sign out" 
                            subtitle={$page.data.user?.name?.split(' ')[0] || $page.data.user?.username}
                            icon="bi-box-arrow-right" 
                            iconColorClass="bg-base-300 text-base-content" 
                            showChevron={false}
                            variant="flat" 
                            type="submit"
                        />
                    </form>
                {/if}
            </div>
        </div>
        <ConfirmModal bind:this={confirmModal} />
    </Modal>
