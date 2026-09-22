<script lang="ts">
    /**
    Some lessons learned (do not alter the render pipeline)

    - THE NATIVE BLINK: If you swap the `src` attribute of a visible <img> tag, 
      the browser blanks it for 1 frame while decoding the new file. We MUST use 
      a Double-Buffer (two physical <img> tags) to crossfade them seamlessly.

    - CSS BATCHING TRAP: If you mount an image off-screen and apply a CSS 
      transition in the exact same JS frame, the browser optimizes it and skips 
      the animation (it just snaps). You MUST wait for the DOM to paint 
      (using double requestAnimationFrame) before triggering the opacity swap.

    - SVELTE INFINITE LOOPS: Never track "in-flight" or intermediate download 
      states inside a reactive `$:` block. Svelte will re-evaluate, see the DOM 
      hasn't caught up, and fire 15 downloads a second. Strictly track `targetSrc`.

    - THE BACKGROUND WORKER COLLISION: Background ML tasks (like thumbnail 
      generation) often cache-bust the URL right after a user action (like rotation).
      If the base URL is identical, we do a "soft" transition to prevent a jarring
      double-animation.
    */
    import { onMount, tick } from 'svelte';

    export let src: string;
    export let fallbackSrc: string = '';
    export let placeholder: string | null = null;
    export let alt: string = '';
    export let loading: 'lazy' | 'eager' = 'lazy';
    export let imgClass: string = 'object-contain w-full h-full';

    type BufferStatus = 'active' | 'outgoing' | 'incoming' | 'idle';
    interface BufferSlot {
        id: number;
        src: string | null;
        status: BufferStatus;
        soft: boolean;
    }

    // Double-Buffer: We never change the 'src' of an image you are actively looking at.
    let buffer: BufferSlot[] = [
        { id: 0, src: src, status: 'active', soft: false },
        { id: 1, src: null, status: 'idle', soft: false }
    ];

    let targetSrc = src;
    let isLoaded = false;
    let errorFired = false;

    let transitionTimer: ReturnType<typeof setTimeout>;

    onMount(() => {
        setTimeout(() => { isLoaded = true; }, 100);
    });

    // Strict target tracking prevents Svelte from infinite-looping re-evaluations
    $: if (src && src !== targetSrc) {
        targetSrc = src;
        errorFired = false;
        preloadImage(src);
    }

    function preloadImage(urlToLoad: string) {
        if (typeof window === 'undefined') return;

        const img = new Image();
        img.onload = async () => {
            // If Svelte requested a newer image while this was downloading, drop this one.
            if (targetSrc !== urlToLoad) return;

            const activeIdx = buffer.findIndex(b => b.status === 'active');
            let nextIdx = buffer.findIndex(b => b.status === 'idle');
            if (nextIdx === -1) nextIdx = buffer.findIndex(b => b.status === 'outgoing');
            if (nextIdx === -1) nextIdx = 0; // Failsafe

            const baseCurrent = buffer[activeIdx]?.src?.split('?')[0] || '';
            const baseNext = urlToLoad.split('?')[0];

            // If updating the same image (rotation or background worker), use a gentle soft crossfade
            const isSoftSwap = baseCurrent === baseNext;

            // 1. Mount new image in the background invisibly so the browser paints it
            buffer[nextIdx].src = urlToLoad;
            buffer[nextIdx].status = 'incoming';
            buffer[nextIdx].soft = isSoftSwap; 
            buffer = [...buffer];

            if (transitionTimer) clearTimeout(transitionTimer);

            await tick();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // 2. Browser has painted. Swap opacities to trigger CSS animation.
                    buffer[nextIdx].status = 'active';
                    
                    if (activeIdx !== -1 && activeIdx !== nextIdx) {
                        buffer[activeIdx].status = 'outgoing';
                        buffer[activeIdx].soft = isSoftSwap;
                    }
                    
                    buffer = [...buffer];

                    // 3. Cleanup old DOM nodes after animation finishes
                    transitionTimer = setTimeout(() => {
                        if (buffer[activeIdx] && buffer[activeIdx].status === 'outgoing') {
                            buffer[activeIdx].status = 'idle';
                            buffer = [...buffer];
                        }
                    }, 800);
                });
            });
        };
        img.onerror = () => {
            if (targetSrc === urlToLoad && fallbackSrc && !errorFired) {
                errorFired = true;
                targetSrc = fallbackSrc;
                preloadImage(fallbackSrc);
            }
        };
        img.src = urlToLoad;
    }
</script>

<div class="relative w-full h-full flex items-center justify-center">
    {#if placeholder && !isLoaded}
        <img src={placeholder} alt="Preview" class="absolute inset-0 animate-pulse opacity-80 {imgClass} z-0" />
    {/if}

    {#each buffer as slot (slot.id)}
        {#if slot.src}
            <img
                src={slot.src}
                {alt}
                {loading}
                class="absolute inset-0 {imgClass} {slot.soft ? 'transition-opacity duration-700 ease-in-out' : 'transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]'} {slot.status === 'active' ? 'opacity-100 scale-100 blur-0 z-10' : slot.status === 'incoming' ? (slot.soft ? 'opacity-0 scale-100 blur-0 z-20' : 'opacity-0 scale-[1.05] blur-[12px] z-20') : slot.status === 'outgoing' ? (slot.soft ? 'opacity-0 scale-100 blur-0 z-0' : 'opacity-0 scale-[0.95] blur-[12px] z-0') : 'invisible opacity-0 scale-[0.95] blur-[12px] z-0'}"
                on:load={() => { if (slot.status === 'active') isLoaded = true; }}
            />
        {/if}
    {/each}
</div>