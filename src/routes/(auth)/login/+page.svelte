<script lang="ts">
    import { enhance } from "$app/forms";
    import { fade, fly } from "svelte/transition";
    import type { ActionData } from "./$types";
    import FormInput from "$lib/components/FormInput.svelte";
    import Logo from "$lib/components/Logo.svelte";
    import pageTitle from '$lib/stores';

    export let form: ActionData;
    let isLoggingIn = false;

    pageTitle.set("Log in");
</script>

<!-- The Ambient Mesh Gradient -->
<div class="fixed inset-0 z-[-1] overflow-hidden bg-base-100" in:fade={{ duration: 1000 }}>
    <div class="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] rounded-full bg-primary/20 blur-[80px] md:blur-[120px] animate-blob"></div>
    <div class="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] md:w-[35vw] md:h-[35vw] rounded-full bg-secondary/20 blur-[80px] md:blur-[120px] animate-blob animation-delay-2000"></div>
    <div class="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] md:w-[45vw] md:h-[45vw] rounded-full bg-accent/20 blur-[80px] md:blur-[120px] animate-blob animation-delay-4000"></div>
</div>

<div class="min-h-[75vh] flex flex-col items-center justify-center p-4 relative z-10 gap-8">
    <!-- Centered Frosted Glass Card -->
    <div class="w-full max-w-sm bg-base-100/60 backdrop-blur-3xl border border-base-200/50 shadow-2xl rounded-[2.5rem] p-8 sm:p-10" 
         in:fly={{ y: 30, duration: 800, delay: 100 }}>
        
        <!-- Animated Logo -->
        <div class="flex justify-center mb-6" in:fly={{ y: 20, duration: 600, delay: 250 }}>
            <Logo size="lg" />
        </div>
        
        <!-- Animated Titles -->
        <div class="text-center mb-8" in:fly={{ y: 20, duration: 600, delay: 350 }}>
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-base-content mb-2">Welcome back</h1>
            <p class="text-sm text-base-content/60 font-medium">Enter your details to sign in.</p>
        </div>

        {#if form?.error}
            <div class="mb-6" in:fly={{ y: -10, duration: 300 }}>
                <span class="text-sm font-medium text-error bg-error/10 px-4 py-3 rounded-xl inline-flex items-center justify-center gap-2 w-full">
                    <i class="bi bi-shield-exclamation"></i> {@html form.message}
                </span>
            </div>
        {/if}

        <!-- Animated Form -->
        <div in:fly={{ y: 20, duration: 600, delay: 450 }}>
            <form method="post" class="flex flex-col gap-4" use:enhance={() => {
                isLoggingIn = true;
                return async ({ update }) => { 
                    await update(); 
                    isLoggingIn = false; 
                };
            }}>
                <FormInput autocomplete="username" icon="bi-person" inputClass="bg-base-200/40 focus:bg-base-100 shadow-inner backdrop-blur-md text-base" name="username" placeholder="Username" required/>
                
                <FormInput autocomplete="current-password" icon="bi-lock" inputClass="bg-base-200/40 focus:bg-base-100 shadow-inner backdrop-blur-md text-base" name="password" placeholder="Password" required type="password" class="mb-2"/>

                <button type="submit" class="btn btn-primary w-full rounded-xl shadow-lg shadow-primary/20 text-base h-12 mt-2 transition-all" disabled={isLoggingIn}>
                    {#if isLoggingIn}
                        <span class="loading loading-spinner loading-sm"></span>
                    {/if}
                    Sign In
                </button>

                <!-- Restored Register Link -->
                <div class="text-center mt-6">
                    <span class="text-sm text-base-content/60">Don't have an account?</span>
                    <a href="/register" class="text-sm text-primary font-bold hover:underline ml-1">Create one</a>
                </div>
            </form>
        </div>

        <a href="https://github.com/romland/troves" target="_blank" rel="noopener noreferrer" class="flex w-full justify-center items-center gap-2 text-sm text-base-content/40 hover:text-base-content/80 transition-colors font-medium mt-6" in:fly={{ y: 20, duration: 600, delay: 550 }}>
            <i class="bi bi-github text-lg"></i> Troves on GitHub
        </a>
    </div>
</div>

<style>
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