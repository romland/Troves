<script lang="ts">
    import { onMount } from "svelte";

    export let analyzeWithVision: boolean = false;
    export let removeBackground: boolean = true;

    let initialized = false;

    onMount(() => {
        if (typeof localStorage !== 'undefined') {
            const storedVision = localStorage.getItem('troves_spatial_vision');
            if (storedVision !== null) analyzeWithVision = storedVision === 'true';

            const storedBg = localStorage.getItem('troves_spatial_bg');
            if (storedBg !== null) removeBackground = storedBg === 'true';
        }
        initialized = true;
    });

    $: if (initialized && typeof localStorage !== 'undefined') {
        localStorage.setItem('troves_spatial_vision', String(analyzeWithVision));
        localStorage.setItem('troves_spatial_bg', String(removeBackground));
    }
</script>

<div class="flex flex-col gap-1 mt-1 mb-1">
    <label class="label cursor-pointer py-0 justify-start gap-2">
        <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={analyzeWithVision} />
        <span class="label-text text-xs text-gray-500 flex flex-col">
            <span class="font-bold text-base-content">Analyze items</span>
            <span>Extracts further details from items using Vision Model, but takes much longer.</span>
        </span>
    </label>
    <label class="label cursor-pointer py-0 justify-start gap-2">
        <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={removeBackground} />
        <span class="label-text text-xs text-gray-500 flex flex-col">
            <span class="font-bold text-base-content">Remove Background</span>
            <span>Uses AI to cut out the item cleanly, but may struggle with items touching tray walls.</span>
        </span>
    </label>
</div>