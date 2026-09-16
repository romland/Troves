<script lang="ts">
    import { enhance } from "$app/forms";
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import FormInput from "$lib/components/FormInput.svelte";
    import SystemDiagnostics from "$lib/components/SystemDiagnostics.svelte";
    import Logo from "$lib/components/Logo.svelte";
    import CreateInventoryModal from "$lib/components/CreateInventoryModal.svelte";
    import pageTitle from '$lib/stores';

    export let data;
    export let form;
    
    let isSubmitting = false;
    let isRestoring = false;
    let step = 1; // 1: Admin, 2: Trove Prompt, 3: Done
    let createModal: CreateInventoryModal;
    let setupMode: 'new' | 'restore' = 'new';

    // Cinematic Intro State
    let showIntro = true;
    let greeting = "Hello.";

    onMount(() => {
        // Step 1: "Hello." stays for 1.8s, then swaps.
        setTimeout(() => greeting = "Welcome to Troves.", 1800);
        
        // Step 2: The entire intro curtain lifts at 3.8s.
        setTimeout(() => showIntro = false, 3800);
    });

    pageTitle.set("System Setup");
</script>

<!-- The Ambient Mesh Gradient (Runs persistently in the background) -->
<div class="fixed inset-0 z-[-1] overflow-hidden bg-base-100">
    <div class="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] rounded-full bg-primary/20 blur-[80px] md:blur-[120px] animate-blob"></div>
    <div class="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] md:w-[35vw] md:h-[35vw] rounded-full bg-secondary/20 blur-[80px] md:blur-[120px] animate-blob animation-delay-2000"></div>
    <div class="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] md:w-[45vw] md:h-[45vw] rounded-full bg-accent/20 blur-[80px] md:blur-[120px] animate-blob animation-delay-4000"></div>
</div>

<!-- Cinematic Intro Curtain -->
{#if showIntro}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-base-100" out:fade={{ duration: 1000 }}>
        <div class="relative flex items-center justify-center w-full h-40">
            {#key greeting}
                <h1 class="absolute text-5xl md:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-primary to-secondary drop-shadow-sm"
                    in:fly={{ y: 20, duration: 800, delay: 300 }}
                    out:fly={{ y: -20, duration: 600 }}>
                    {greeting}
                </h1>
            {/key}
        </div>
    </div>
{/if}

<!-- Main UI (Revealed after intro) -->
{#if !showIntro}
    <div class="min-h-[85vh] flex flex-col items-center justify-center p-4 relative z-10 gap-8">
        <div class="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
            
            <!-- LEFT: Setup Wizard Flow -->
            <div class="bg-base-100/60 backdrop-blur-3xl border border-base-200/50 shadow-2xl rounded-[2.5rem] p-8 sm:p-10" 
                 in:fly={{ y: 40, duration: 1000, delay: 200 }}>
                
                <div class="flex justify-start mb-6">
                    <Logo size="lg" />
                </div>
                
                <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-base-content mb-3">Troves</h1>
                
                {#if step === 1}
                    <div in:fade={{ duration: 400 }}>
                        <div class="bg-base-200/50 p-1 rounded-2xl flex w-full mb-6 border border-base-200/60 shadow-inner">
                            <button type="button" class="flex-1 btn btn-sm border-none {setupMode === 'new' ? 'bg-base-100 shadow-sm text-base-content font-bold' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={() => setupMode = 'new'}>New Install</button>
                            <button type="button" class="flex-1 btn btn-sm border-none {setupMode === 'restore' ? 'bg-base-100 shadow-sm text-base-content font-bold' : 'btn-ghost text-gray-500 hover:text-base-content hover:bg-base-300'}" on:click={() => setupMode = 'restore'}>Restore Backup</button>
                        </div>

                        {#if form?.error}
                            <div class="mb-6" in:fly={{ y: -10, duration: 300 }}>
                                <span class="text-sm font-medium text-error bg-error/10 px-4 py-3 rounded-xl inline-flex items-center gap-2 w-full">
                                    <i class="bi bi-exclamation-circle-fill"></i> {@html form.message}
                                </span>
                            </div>
                        {/if}

                        {#if setupMode === 'new'}
                            <p class="text-sm text-base-content/70 mb-6 font-medium leading-relaxed" in:fade={{ duration: 200 }}>
                                A self-hosted, offline-first inventory system for your physical items. It automatically builds a growing taxonomy and stays fully searchable, even when offline.
                            </p>
                            <form method="POST" action="?/setupAdmin" class="flex flex-col gap-5" in:fade={{ duration: 200 }} use:enhance={() => {
                            isSubmitting = true;
                            return async ({ result, update }) => { 
                                if (result.type === 'success') {
                                    step = 2; 
                                } else {
                                    await update(); 
                                }
                                isSubmitting = false; 
                            };
                        }}>
                            <div class="space-y-4">
                                <h3 class="text-[10px] font-bold uppercase tracking-widest text-base-content/40">1. Create Administrator Account</h3>
                                <div class="flex flex-col gap-4">
                                    <FormInput autocomplete="username" icon="bi-person" inputClass="bg-base-200/40 focus:bg-base-100 shadow-inner backdrop-blur-md" name="username" placeholder="Username" required/>
                                    <FormInput autocomplete="new-password" icon="bi-shield-lock" inputClass="bg-base-200/40 focus:bg-base-100 shadow-inner backdrop-blur-md" name="password" placeholder="Password" required type="password"/>
                                    <FormInput autocomplete="new-password" icon="bi-shield-check" inputClass="bg-base-200/40 focus:bg-base-100 shadow-inner backdrop-blur-md" name="passwordConfirm" placeholder="Repeat Password" required type="password"/>
                                </div>
                            </div>

                            <button type="submit" class="btn btn-primary w-full rounded-xl shadow-lg shadow-primary/20 text-base h-14 mt-4" disabled={isSubmitting}>
                                {#if isSubmitting}
                                    <span class="loading loading-spinner"></span> Securing...
                                {:else}
                                    Create Account
                                {/if}
                            </button>
                        </form>
                        {:else}
                            <p class="text-sm text-base-content/70 mb-6 font-medium leading-relaxed" in:fade={{ duration: 200 }}>
                                Overwrite this instance with a previously downloaded backup. All existing users, troves, and settings will be instantly restored.
                            </p>
                            <form method="POST" action="?/restoreBackup" enctype="multipart/form-data" in:fade={{ duration: 200 }} use:enhance={() => {
                            isRestoring = true;
                            return async ({ result, update }) => {
                                if (result.type === 'redirect') {
                                    window.location.href = result.location;
                                } else {
                                    await update();
                                }
                                isRestoring = false;
                            };
                        }}>
                            <div class="form-control w-full mb-3">
                                    <div class="label pb-2"><span class="label-text font-bold uppercase tracking-wider text-[10px] text-base-content/40">Database File (.db / .sqlite)</span></div>
                                    <input type="file" name="backup" accept=".db,.sqlite" class="file-input file-input-bordered file-input-md w-full bg-base-200/40 shadow-inner" required />
                            </div>
                            <button type="submit" class="btn btn-neutral w-full rounded-xl shadow-sm h-12 transition-all active:scale-[0.98]" disabled={isRestoring || isSubmitting}>
                                {#if isRestoring}
                                    <span class="loading loading-spinner loading-sm"></span> Restoring...
                                {:else}
                                    <i class="bi bi-database-up"></i> Upload & Restore
                                {/if}
                            </button>
                        </form>
                        {/if}
                    </div>

                {:else if step === 2}
                    <div class="flex flex-col gap-4 py-4" in:fly={{ x: 20, duration: 600, delay: 100 }}>
                        <div class="flex items-center gap-3 text-success font-bold text-lg mb-2">
                            <i class="bi bi-shield-check text-2xl"></i> Administrator added
                        </div>
                        <p class="text-base-content/70 text-sm">Before you can start adding items, you need to create your first trove. Click below to configure it.</p>
                        
                        <button type="button" class="btn btn-primary w-full rounded-xl shadow-lg shadow-primary/20 h-14 mt-2" on:click={() => createModal.showModal()}>
                            Open Trove Creator
                        </button>
                    </div>

                {:else if step === 3}
                    <div class="flex flex-col gap-4 py-4" in:fly={{ x: 20, duration: 600, delay: 100 }}>
                        <div class="flex items-center gap-3 text-success font-bold text-lg mb-2">
                            <i class="bi bi-check-circle-fill text-2xl"></i> System Ready
                        </div>
                        <p class="text-base-content/70 text-sm">Everything is configured. Welcome to your new inventory.</p>
                        
                        <button type="button" class="btn btn-success text-white w-full rounded-xl shadow-lg shadow-success/20 h-14 mt-2" on:click={() => window.location.href = '/'}>
                            Enter Troves <i class="bi bi-arrow-right"></i>
                        </button>
                    </div>
                {/if}
            </div>

            <!-- RIGHT: System Diagnostics -->
            <div class="bg-base-100/60 backdrop-blur-3xl border border-base-200/50 shadow-xl rounded-[2.5rem] p-8 sm:p-10" 
                 in:fly={{ y: 40, duration: 1000, delay: 400 }}>
                <SystemDiagnostics diagnostics={data.diagnostics} />
            </div>
            
        </div>

        <a href="https://github.com/romland/troves" target="_blank" rel="noopener noreferrer" class="flex w-full justify-center items-center gap-2 text-sm text-base-content/40 hover:text-base-content/80 transition-colors font-medium" in:fly={{ y: 20, duration: 600, delay: 600 }}>
            <i class="bi bi-github text-lg"></i> Troves on GitHub
        </a>
    </div>
{/if}

<CreateInventoryModal bind:this={createModal} on:success={() => step = 3} />

<style>
    /* hardware-accelerated animated mesh blobs */
    @keyframes blob {
        0% { transform: translate(0px, 0px) scale(1); }
        33% { transform: translate(30px, -50px) scale(1.1); }
        66% { transform: translate(-20px, 20px) scale(0.9); }
        100% { transform: translate(0px, 0px) scale(1); }
    }
    .animate-blob {
        animation: blob 15s infinite alternate cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform;
    }
    .animation-delay-2000 { animation-delay: 2s; }
    .animation-delay-4000 { animation-delay: 4s; }
</style>