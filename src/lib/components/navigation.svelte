<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { browser } from '$app/environment';
    import { beforeNavigate } from '$app/navigation';
    import { createEventDispatcher } from 'svelte';
    import Items from "$lib/components/items.svelte";
    import { page } from '$app/stores';
    
    export let prevPage: number;
    export let nextPage: number;
    void prevPage;
    export let href: string;
    
    let loadedPages: any[] = [];
    let reachedEnd = false;
    let loading = false;
    let observer: IntersectionObserver;
    const dispatch = createEventDispatcher();

    let currentHref = href;
    let currentInvId = $page.data.activeInventoryId;
    let cacheKey = `nav-cache-${currentInvId}-${href}`;

    // ====================================================================================
    // CRITICAL BUG FIX DOCUMENTATION: SVELTE PROP MUTATION & ASYNC DATA STORES
    // ====================================================================================
    // THE PROBLEM:
    // We previously tried to reset the infinite scroller on navigation by mutating the 
    // `export let nextPage` prop directly (e.g., `nextPage = $page.data.nextPage`).
    // Because SvelteKit's `$page` store updates asynchronously during client-side routing,
    // this reactive block would sometimes fire BEFORE the new page data finished loading.
    // It would grab the OLD `nextPage` (often `0` because the previous list hit the bottom).
    // Worse, Svelte's compiler dictates that if a child component internally mutates an 
    // `export let` prop, it severs the reactivity binding from the parent. When the parent 
    // finally passed down the correct new `nextPage`, the child ignored it and stayed stuck at 0.
    //
    // THE SOLUTION:
    // We decouple the external prop from the internal state using `internalNextPage`.
    // 1. `export let nextPage` is treated as strictly read-only by this component. It 
    //    acts ONLY as the initial seed value passed synchronously from the parent.
    // 2. We use `internalNextPage` to track the actual pagination state and cache it.
    //
    // GOING FORWARD (ANTI-PATTERNS TO AVOID):
    // - NEVER mutate `export let` props inside a component if you expect the parent to 
    //   continue updating them. Always create a local shadow variable (e.g., `let internalX = X`).
    // - NEVER rely on `$page.data` inside nested reactive blocks (`$:`) during 
    //   route transitions to reset state, as it creates unpredictable race conditions. 
    //   Rely on the synchronous props passed down from the parent layout instead.
    // ====================================================================================    
    let internalNextPage = nextPage;

    // 1. SYNCHRONOUS CACHE READ
    // By doing this here instead of in onMount, Svelte renders the full height on the VERY FIRST DOM frame.
    // This allows the browser to perfectly restore the Y-axis scroll position instantly.
    if (browser && typeof sessionStorage !== 'undefined') {
        console.log(`[DEBUG-SCROLL] 🛑 component init. Reading cache for: ${cacheKey}`);
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                loadedPages = parsed.loadedPages || [];
                internalNextPage = parsed.nextPage !== undefined ? parsed.nextPage : nextPage;
                reachedEnd = parsed.reachedEnd || false;
                console.log(`[DEBUG-SCROLL] ✅ Synchronously restored ${loadedPages.length} pages. (This enables scroll restore)`);
            } catch (e) { console.warn("Was a silenced exception", e); }
        }
    }

    // 2. REACTIVE CACHE RESET FOR URL CHANGES
    $: if (href !== currentHref || $page.data.activeInventoryId !== currentInvId) {
        console.log(`[DEBUG-SCROLL] 🛑 reactive check for changed href or vault: ${href}`);
        currentHref = href;
        currentInvId = $page.data.activeInventoryId;
        cacheKey = `nav-cache-${currentInvId}-${href}`;
        if (browser && typeof sessionStorage !== 'undefined') {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    loadedPages = parsed.loadedPages || [];
                    internalNextPage = parsed.nextPage !== undefined ? parsed.nextPage : nextPage;
                    reachedEnd = parsed.reachedEnd || false;
                    console.log(`[DEBUG-SCROLL] ✅ Synchronously restored ${loadedPages.length} pages.`);
                } catch (e) { console.warn("Was a silenced exception", e); }
            } else {
                // CRITICAL: If URL changed and no cache exists, wipe the old pages out!
                loadedPages = [];
                reachedEnd = false;
                internalNextPage = nextPage;
            }
        }
    }

    // Broadcast to any parent listening without mutating props
    $: dispatch('pagesUpdated', loadedPages);

    const handleSync = async () => {
        console.log(`[DEBUG-CACHE] 🔄 handleSync() triggered! Loaded pages to background-refresh: ${loadedPages.length}`);
        if (loadedPages.length === 0) return;
        
        let h = href.replace("/search?", "/api/items?").replace("/?", "/api/items?");
        for (let i = 0; i < loadedPages.length; i++) {
            const p = i + 2; // SvelteKit natively handles page 1, so loadedPages[0] is page 2
            const url = `${h}c=12&page=${p}`;
            try {
                console.log(`[DEBUG-CACHE] 📡 Fetching fresh data for page ${p}: ${url}`);
                const res = await fetch(url, { cache: 'no-store' });
                const data = await res.json();
                if (data && data.items) {
                    console.log(`[DEBUG-CACHE] 🟢 Successfully received ${data.items.length} fresh items for page ${p}. Injecting to DOM.`);
                    loadedPages[i] = data.items;
                }
            } catch (e) {
                console.error(`[DEBUG-CACHE] 🔴 Failed to refresh page ${p}:`, e);
            }
        }
        // Re-assign to trigger Svelte reactivity
        loadedPages = [...loadedPages];
        console.log("[DEBUG-CACHE] ✨ Background refresh loop complete.");
    };

    beforeNavigate((nav) => {
        console.log(`[DEBUG-SCROLL] 🧭 beforeNavigate fired. Type: ${nav.type}, To: ${nav.to?.url?.pathname}`);
        
        // CRITICAL FIX: If the user is hard-reloading (Ctrl+R) or closing the tab, BURN the cache.
        // NEVER save stale data on a reload.
        if (nav.type === 'leave') {
            console.log("[DEBUG-SCROLL] 💥 'leave' detected (Hard reload/Tab close). Nuking sessionStorage!");
            sessionStorage.removeItem(cacheKey);
            return;
        }

        console.log(`[DEBUG-SCROLL] 💾 Saving cache to sessionStorage: ${loadedPages.length} pages.`);

        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(cacheKey, JSON.stringify({
                loadedPages,
                nextPage: internalNextPage,
                reachedEnd
            }));
        }
    });

    async function query() {
        let h = href.replace("/search?", "/api/items?").replace("/?", "/api/items?");
        const url = `${h}c=12&page=${internalNextPage}`;
        
        try {
            // Explicitly command fetch to bypass browser disk cache
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            
            if(!data || !data.items || data.items.length === 0) {
                reachedEnd = true;
                return;
            }

            loadedPages = [...loadedPages, data.items];
        } catch (e) {
            console.error("Fetch error:", e);
        }
    }
    
    function handleIntersection(entries: IntersectionObserverEntry[]) {
        const entry = entries[0];
        
        if (!entry.isIntersecting) return;
        if (loading || reachedEnd || internalNextPage === 0) return;
        
        loading = true;
        query().then(() => {
            loading = false;
            if (!reachedEnd) {
                internalNextPage++;
            }
        });
    }
    
    onMount(async () => {
        console.log("[DEBUG-SCROLL] 🏔️ onMount fired. Setting up sync listeners.");
        window.addEventListener('app-sync', handleSync);

        // Run the seamless sync instantly on mount.
        // This guarantees that if you hit 'Back' (popstate), the instantly-restored cache is updated
        // with fresh database data milliseconds later without dropping your scroll position.
        handleSync();

        // Wait for Svelte to physically draw the restored items into the DOM.
        // This is CRUCIAL so the browser has enough page height to restore your scroll position.

        // Set up the observer
        const el = document.getElementById('postScrollArea');
        if (el) {
            observer = new IntersectionObserver(handleIntersection, {
                root: null,
                rootMargin: '1500px', // Pre-fetch 1.5 screens ahead to beat fast scroll velocity
                threshold: 0.1
            });
            observer.observe(el);
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') window.removeEventListener('app-sync', handleSync);
        if (observer) observer.disconnect();
    });
</script>

{#each loadedPages as page}
    <slot items={page}>
        <Items items={page} showControls={false} />
    </slot>
{/each}

{#if loading && !reachedEnd}
    <slot items={[]} loadingSkeletonCount={12}>
        <Items items={[]} showControls={false} loadingSkeletonCount={12} />
    </slot>
{/if}

<div id="postScrollArea" class="flex justify-center items-center gap-3 py-6 min-h-[4rem]">
</div>
