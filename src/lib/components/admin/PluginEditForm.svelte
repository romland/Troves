<script lang="ts">
    import { enhance } from "$app/forms";
    import { createEventDispatcher } from "svelte";

    export let plugin: any;
    export let enhanceFn: any;

    const dispatch = createEventDispatcher();
</script>

<div class="bg-base-200 rounded-xl border border-base-300 p-4 shadow-sm">
    <form method="POST" action="?/savePlugin" use:enhance={enhanceFn} class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
            <span class="font-bold font-mono text-sm">{plugin.name}</span>
            <input type="hidden" name="name" value={plugin.name}>
        </div>
        <textarea name="content" class="textarea textarea-bordered font-mono text-xs w-full h-64 bg-base-100 leading-relaxed" spellcheck="false">{plugin.content}</textarea>
        <div class="flex gap-2 justify-end mt-2">
            <button type="button" class="btn btn-sm btn-ghost" on:click={() => dispatch('cancel')}>Cancel</button>
            <button type="submit" class="btn btn-sm btn-primary">Save & Reload</button>
        </div>
    </form>
</div>