<script lang="ts">
    import type { PageServerData } from "./$types";
    import CompareHub from "$lib/components/compare/CompareHub.svelte";
    import PasteHandler from "$lib/components/PasteHandler.svelte";
    import { notify } from "$lib/client/notifications";
    import pageTitle from '$lib/stores';

    export let data: PageServerData;
    let compareHubComponent: CompareHub;

    pageTitle.set("Audit Lens");
</script>

<PasteHandler 
    formId="lensForm" 
    forcePhotoType="product"
    on:save={(ev) => { 
        if (ev.detail.file) compareHubComponent?.processPastedFile(ev.detail.file); 
    }}
    on:success={(ev) => notify("success", ev.detail)}
    on:processingStart={(ev) => notify("loading", ev.detail.message, ev.detail.taskId)}
    on:processingComplete={(ev) => notify(ev.detail.status, ev.detail.message, ev.detail.taskId)}
/>

<div class="pt-4 animate-fade-in w-full">
    <CompareHub 
        bind:this={compareHubComponent}
        containers={data.containers}
        categories={data.categories}
        tags={data.tags}
        on:processingStart={(ev) => notify("loading", ev.detail.message, ev.detail.taskId)}
        on:processingComplete={(ev) => notify(ev.detail.status, ev.detail.message, ev.detail.taskId)}
        on:success={(ev) => notify("success", ev.detail)}
        on:notify={(ev) => notify(ev.detail.status, ev.detail.message)}
    />
</div>