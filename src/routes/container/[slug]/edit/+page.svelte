<script lang="ts">
    import type { ActionData, PageServerData } from "./$types";
    import Alert from "$lib/components/alert.svelte";
    import { enhance } from "$app/forms";
    import FormInput from "$lib/components/FormInput.svelte";
  
    export let data: PageServerData;
    export let form: ActionData;

    import pageTitle from '$lib/stores';
    pageTitle.set("Edit container " + data.item?.name);

    let showPhotoWarning = false;
    $: hasSpatialMap = !!data.item?.spatialMap;

    let cb = Date.now();
    $: if (form?.success) {
        cb = Date.now();
    }

    function handleFileChange(e: Event) {
        const input = e.target as HTMLInputElement;
        if (hasSpatialMap && input.files && input.files.length > 0) {
            showPhotoWarning = true;
        } else {
            showPhotoWarning = false;
        }
    }
</script>

{#if form?.error}
    <Alert>{@html form?.message}</Alert>
{/if}

{#if form?.success}
    <div class="alert alert-success shadow-sm rounded-xl p-3 text-sm flex gap-2 mb-4 max-w-2xl mx-auto">
        <i class="bi bi-check-circle text-xl shrink-0"></i>
        <span>{@html form?.message}</span>
    </div>
{/if}

<form method="post" action="?/save" enctype="multipart/form-data" use:enhance={() => {
    return async ({ update }) => {
        await update({ reset: false });
    };
}} class="flex flex-col gap-5 max-w-2xl mx-auto pb-8 mt-4">
    <input type="hidden" name="id" value="{data.item?.name}">

    <FormInput label="Container Name" id="name" name="name" value={data.item?.name} inputClass="shadow-sm" hint="<span class='text-warning font-semibold'><i class='bi bi-exclamation-triangle'></i> Changing the name will break existing physical QR codes printed for this container.</span>" />

    <FormInput label="Location" id="location" name="location" placeholder="e.g. Living Room Bookshelf" value={data.item?.location} inputClass="shadow-sm" />

    <FormInput label="Number of Child Trays" id="numtrays" name="numtrays" value={data.item?.children?.length || 0} inputClass="shadow-sm bg-base-200 text-base-content/60 cursor-not-allowed" readonly hint="Child trays are read-only and must be edited individually." />

    {#if data.item?.photoPath}
        <div class="mb-1 flex flex-col gap-3">
            <div class="label pb-1 pt-0"><span class="label-text font-semibold">Current Photo</span></div>
            <div class="flex items-start gap-4">
                <img class="w-32 h-32 object-cover rounded-xl border border-base-300 shadow-sm" src="{data.item?.photoPath}?v={cb}" alt="Container thumbnail"/>
                <button type="submit" formaction="?/rotate" class="btn btn-outline border-base-300 shadow-sm rounded-xl" on:click={(e) => {
                    if (hasSpatialMap && !confirm('Rotating this image will misalign your existing spatial map. You will need to re-map it. Continue?')) {
                        e.preventDefault();
                    }
                }}>
                    <i class="bi bi-arrow-clockwise"></i> Rotate 90°
                </button>
            </div>
        </div>
    {/if}

    <div>
        <FormInput type="file" label="{data.item?.photoPath ? 'Replace Photo' : 'Photo'}" id="photoPath" name="photoPath" accept="image/*" inputClass="shadow-sm" on:change={handleFileChange} />
        {#if showPhotoWarning}
            <div class="alert alert-warning mt-2 shadow-sm rounded-xl p-3 text-sm flex gap-2">
                <i class="bi bi-exclamation-triangle text-xl shrink-0"></i>
                <span>Replacing this photo will misalign your existing spatial map. You will need to re-map the compartments!</span>
            </div>
        {/if}
    </div>

    <FormInput type="textarea" label="Description" id="description" name="description" rows="4" placeholder="Optional notes about what goes in here..." value={data.item?.description} inputClass="shadow-sm leading-relaxed" />

    <div class="mt-2 flex justify-end">
        <button type="submit" class="btn btn-primary w-full sm:w-auto sm:px-12 shadow-sm">Save Changes</button>
    </div>
</form>
