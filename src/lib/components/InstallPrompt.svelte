<script lang="ts">
    import { onMount } from 'svelte';
    import { fly, fade } from 'svelte/transition';
    import { cubicOut } from 'svelte/easing';

    let show = false;
    let isIOS = false;
    let deferredPrompt: any = null;

    onMount(() => {
        // Detect standalone PWA mode so we never nag users who already installed it
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        const dismissed = localStorage.getItem('troves_hide_install');

        if (isStandalone || dismissed) return;

        // 1. Android/Chrome Edge Method: Intercept the native install event
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault(); // Suppress the ugly default browser infobar
            deferredPrompt = e;
            show = true;
        });

        // 2. iOS Fallback: Safari doesn't support beforeinstallprompt, so we detect OS
        const ua = window.navigator.userAgent.toLowerCase();
        isIOS = /iphone|ipad|ipod/.test(ua);
        
        if (isIOS) {
            setTimeout(() => show = true, 2500); // Wait 2.5s to avoid clashing with page load
        }
    });

    async function installAndroid() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt(); // Triggers the native OS bottom sheet!
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') dismiss();
        deferredPrompt = null;
    }

    function dismiss() {
        show = false;
        localStorage.setItem('troves_hide_install', 'true');
    }
</script>

{#if show}
<div class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+1rem)] inset-x-4 z-[100] mx-auto max-w-sm pointer-events-none" 
     in:fly={{ y: 40, duration: 500, easing: cubicOut }} 
     out:fade={{ duration: 200 }}>
    <div class="bg-base-100/80 backdrop-blur-3xl border border-base-200 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] rounded-3xl p-4 flex gap-4 items-center pointer-events-auto relative overflow-hidden ring-1 ring-white/10">
        <div class="absolute -top-10 -right-10 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none"></div>
        <div class="w-12 h-12 bg-base-100 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-base-200/50 z-10">
            <img src="/troves512.webp" alt="Troves" class="w-8 h-8 rounded-lg" on:error={(e) => (e.currentTarget as HTMLElement).style.display='none'}/>
        </div>
        <div class="flex-1 z-10">
            <h3 class="text-sm font-bold text-base-content leading-tight tracking-tight">Install Troves</h3>
            <p class="text-[11px] text-base-content/60 leading-snug mt-0.5 pr-2">
                {#if isIOS}Tap <span class="bg-base-200 px-1 py-0.5 rounded text-base-content mx-0.5 border border-base-300 shadow-sm"><i class="bi bi-box-arrow-up text-[10px]"></i></span> then <strong class="text-base-content/80">Add to Home Screen</strong>.{:else}Add to your home screen for the full native experience.{/if}
            </p>
        </div>
        <div class="flex items-center gap-2 z-10">
            {#if !isIOS}<button class="btn btn-primary btn-sm rounded-xl px-4 shadow-md font-bold text-xs" on:click={installAndroid}>Install</button>{/if}
            <button class="btn btn-circle btn-ghost btn-sm bg-base-200/50 hover:bg-base-300 shrink-0 shadow-none text-base-content/50" on:click={dismiss} aria-label="Dismiss"><i class="bi bi-x text-lg"></i></button>
        </div>
    </div>
</div>
{/if}