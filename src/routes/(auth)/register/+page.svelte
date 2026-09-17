<script lang="ts">
    import { enhance } from "$app/forms";
    import type { ActionData } from "./$types";
    import pageTitle from '$lib/stores';
    import FormInput from "$lib/components/FormInput.svelte";
    import Logo from "$lib/components/Logo.svelte";

    export let form: ActionData;
    let isRegistering = false;

    pageTitle.set("Create Account");
</script>

<div class="min-h-[80vh] flex items-center justify-center px-4 py-12">
    <div class="max-w-sm w-full bg-base-100/90 backdrop-blur-2xl border border-base-200 shadow-2xl rounded-[2.5rem] p-8 sm:p-10 animate-fade-in">
        <div class="flex justify-center mb-6">
            <Logo size="lg" />
        </div>
        
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-center text-base-content mb-2">Create an account</h1>
        <p class="text-sm text-gray-500 text-center mb-8 font-medium">Set up your personal troves.</p>

        {#if form?.error}
            <div class="mb-4 text-center animate-fade-in">
                <span class="text-[13px] font-medium text-error bg-error/10 px-4 py-2 rounded-xl inline-flex items-center gap-2">
                    <i class="bi bi-exclamation-circle-fill"></i> {@html form?.message}
                </span>
            </div>
        {/if}

        <form method="post" class="flex flex-col gap-4" use:enhance={() => {
            isRegistering = true;
            return async ({ update }) => { await update(); isRegistering = false; };
        }}>
            <FormInput autofocus icon="bi-person" name="username" placeholder="Choose a Username" required autocomplete="username" inputClass="bg-base-200/50 focus:bg-base-100 transition-colors shadow-inner" />
            
            <FormInput type="password" icon="bi-shield-lock" name="password" placeholder="Create a Password" required autocomplete="new-password" inputClass="bg-base-200/50 focus:bg-base-100 transition-colors shadow-inner" class="mb-2" />
            <FormInput type="password" icon="bi-shield-check" name="passwordConfirm" placeholder="Repeat Password" required autocomplete="new-password" inputClass="bg-base-200/50 focus:bg-base-100 transition-colors shadow-inner" class="mb-2" />

            <button type="submit" class="btn btn-primary w-full rounded-xl shadow-lg text-base h-12" disabled={isRegistering}>
                {#if isRegistering}<span class="loading loading-spinner loading-sm"></span>{/if}
                Register
            </button>

            <div class="text-center mt-6">
                <span class="text-sm text-gray-500">Already have an account?</span>
                <a href="/login" class="text-sm text-primary font-bold hover:underline ml-1">Sign in</a>
            </div>

            <div class="mt-8 flex w-full justify-center">
                <!-- a href="https://github.com/romland/troves" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors font-medium">
                    <i class="bi bi-github text-lg"></i> Troves on GitHub
                </a -->
            </div>            
        </form>
    </div>
</div>
