<script lang="ts">
    import { enhance } from "$app/forms";
    import Alert from "$lib/components/alert.svelte";
    import type { ActionData, PageServerData } from "./$types";
    import FormInput from "$lib/components/FormInput.svelte";

    export let form: ActionData;
    export let data: PageServerData;

    import pageTitle from '$lib/stores';
    pageTitle.set("Add container");

    let mode: 'single' | 'batch' = 'single';
    let printLabel = false;
    let isSaving = false;
</script>

{#if form?.error}
    <Alert>{@html form?.message}</Alert>
{/if}

<form method="post" enctype="multipart/form-data" use:enhance={() => {
    isSaving = true;
    return async ({ update }) => {
        await update();
        isSaving = false;
    };
}} class="flex flex-col gap-4 max-w-4xl mx-auto pb-8">
    <input type="hidden" name="mode" value={mode}>
    
    <!-- iOS-Style Segmented Control -->
    <div class="bg-base-200 p-1 rounded-xl flex w-full max-w-xs mx-auto mb-4">
        <button type="button" class="flex-1 btn btn-sm border-none {mode === 'single' ? 'bg-base-100 shadow-sm hover:bg-base-100' : 'btn-ghost hover:bg-base-300'}" on:click={() => mode = 'single'}>Single Box</button>
        <button type="button" class="flex-1 btn btn-sm border-none {mode === 'batch' ? 'bg-base-100 shadow-sm hover:bg-base-100' : 'btn-ghost hover:bg-base-300'}" on:click={() => mode = 'batch'}>Batch Trays</button>
    </div>

    <!-- Grid: 1 column on mobile, 2 columns on medium screens and up -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        
        <!-- Left Column: Core Identity -->
        <div class="flex flex-col gap-4">
            <FormInput label="Container Name" name="name" placeholder={mode === 'single' ? "e.g. Red 30x30 Cube" : "e.g. Shelf A"} inputClass="shadow-sm" />

            <FormInput label="Location" name="location" placeholder="e.g. Living Room Bookshelf" inputClass="shadow-sm" />

            {#if mode === 'batch'}
                <div class="flex gap-4">
                    <FormInput type="number" label="Number of trays" name="numtrays" value="10" placeholder="10" min="1" class="w-1/2" inputClass="shadow-sm" />
                    <FormInput type="number" label="Start number" name="starttray" value="1" min="1" class="w-1/2" inputClass="shadow-sm" />
                </div>
            {/if}
        </div>

        <!-- Right Column: Media & Extras -->
        <div class="flex flex-col gap-4">
            <FormInput type="file" label="Photo" name="photoPath" accept="image/*" inputClass="shadow-sm" />

            <FormInput type="textarea" label="Description" name="description" rows="2" placeholder="Optional notes about what goes in here..." inputClass="shadow-sm" />

            {#if data.canPrintLabels}
                <!-- Label Studio Configuration -->
                <div class="form-control bg-base-200 rounded-xl p-4 mt-2 border border-base-300">
                    <label class="label cursor-pointer justify-start gap-3 w-max p-0 mb-1">
                        <input type="checkbox" name="printLabel" bind:checked={printLabel} class="checkbox checkbox-primary" />
                        <span class="label-text font-semibold">Print physical label</span>
                    </label>
                    {#if printLabel}
                        <div class="flex gap-4 mt-3 pl-8">
                            {#if mode === 'batch'}
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="printScope" value="master" class="radio radio-primary radio-sm" checked />
                                    <span class="text-sm">Master Box Only</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="printScope" value="all" class="radio radio-primary radio-sm" />
                                    <span class="text-sm">Master + All Trays</span>
                                </label>
                            {:else}
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="labelSize" value="large" class="radio radio-primary radio-sm" checked />
                                    <span class="text-sm">Large (QR + Name)</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="labelSize" value="small" class="radio radio-primary radio-sm" />
                                    <span class="text-sm">Small (QR Only)</span>
                                </label>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="mt-6 flex justify-end">
        <button type="submit" class="btn btn-primary w-full md:w-auto md:px-12" disabled={isSaving}>
            {#if isSaving}<span class="loading loading-spinner"></span>{/if}
            Save Container
        </button>
    </div>
</form>
