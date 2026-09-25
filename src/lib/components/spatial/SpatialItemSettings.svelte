<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";

    export let analyzeWithVision: boolean = false;
    export let removeBackground: boolean = false;
    export let straightenPerspective: boolean = true;

    let initialized = false;

    onMount(() => {
        // Force off if vision capabilities are missing
        if (!$page.data.capabilities.hasVision) {
            analyzeWithVision = false;
        }

        if (typeof localStorage !== 'undefined') {
            const storedVision = localStorage.getItem('troves_spatial_vision');
            if (storedVision !== null) analyzeWithVision = storedVision === 'true';

            const storedBg = localStorage.getItem('troves_spatial_bg');
            if (storedBg !== null) removeBackground = storedBg === 'true';

            const storedPersp = localStorage.getItem('troves_spatial_straighten');
            if (storedPersp !== null) straightenPerspective = storedPersp === 'true';
        }
        initialized = true;
    });

    $: if (initialized && typeof localStorage !== 'undefined') {
        localStorage.setItem('troves_spatial_vision', String(analyzeWithVision));
        localStorage.setItem('troves_spatial_bg', String(removeBackground));
        localStorage.setItem('troves_spatial_straighten', String(straightenPerspective));
    }
</script>

<div class="flex flex-col gap-1 mt-1 mb-1">
    <label class="label cursor-pointer py-0 justify-start gap-2">
        <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={analyzeWithVision} disabled={!$page.data.capabilities.hasVision} />
        <span class="label-text text-xs text-gray-500 flex flex-col">
            <span class="font-bold text-base-content">Analyze items</span>
            <span>{$page.data.capabilities.hasVision ? 'Extracts further details from items using Vision Model, but takes much longer.' : 'Requires Vision Engine API keys.'}</span>
        </span>
    </label>
    <label class="label cursor-pointer py-0 justify-start gap-2">
        <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={removeBackground} />
        <span class="label-text text-xs text-gray-500 flex flex-col">
            <span class="font-bold text-base-content">Remove Background</span>
            <span>Cut out the item cleanly, but may struggle with items touching tray walls.</span>
        </span>
    </label>
    <label class="label cursor-pointer py-0 justify-start gap-2">
        <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={straightenPerspective} />
        <span class="label-text text-xs text-gray-500 flex flex-col">
            <span class="font-bold text-base-content">Straighten Perspective</span>
            <span>Mathematically flattens skewed compartments into perfect top-down squares.</span>
        </span>
    </label>
</div>