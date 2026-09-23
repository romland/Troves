<script lang="ts">
    import { enhance } from "$app/forms";
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { browser } from "$app/environment";

    export let plugin: any;
    export let enhanceFn: any;

    const dispatch = createEventDispatcher();
    let containerEl: HTMLElement;
    let editor: any;

    onMount(async () => {
        if (browser) {
            // Dynamically import to bypass SSR completely
            const { createEditor } = await import('prism-code-editor');
            const { matchBrackets } = await import('prism-code-editor/match-brackets');
            const { defaultCommands } = await import('prism-code-editor/commands');
            
            // Use the editor's own ES-module safe languages instead of the legacy global PrismJS components
            await import('prism-code-editor/prism/languages/javascript');
            await import('prism-code-editor/layout.css');
            await import('prism-code-editor/scrollbar.css');
            // CRITICAL: A base theme MUST be loaded to apply the textarea overlay transparency and cursor rendering!
            await import('prism-code-editor/themes/github-dark.css');

            editor = createEditor(
                containerEl,
                {
                    language: 'javascript',
                    value: plugin.content || '',
                    lineNumbers: true,
                    onUpdate(code) {
                        plugin.content = code;
                    }
                },
                matchBrackets(true),
                defaultCommands()
            );
        }
    });

    onDestroy(() => {
        if (editor) editor.remove();
    });
</script>

<div class="bg-base-200 rounded-xl border border-base-300 p-4 shadow-sm">
    <form method="POST" action="?/savePlugin" use:enhance={enhanceFn} class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
            <span class="font-bold font-mono text-sm">{plugin.name}</span>
            <input type="hidden" name="name" value={plugin.name}>
        </div>
        
        <!-- Hidden input to pass the code back to the SvelteKit form action -->
        <input type="hidden" name="content" value={plugin.content} />
        
        <!-- The editor container -->
        <div 
            bind:this={containerEl} 
            class="w-full h-[450px] flex flex-col bg-base-100 rounded-xl border border-base-300 overflow-hidden focus-within:ring-2 focus-within:ring-primary/50 transition-shadow text-[13px] font-mono shadow-inner"
        ></div>
        
        <div class="flex gap-2 justify-end mt-2">
            <button type="button" class="btn btn-sm btn-ghost" on:click={() => dispatch('cancel')}>Cancel</button>
            <button type="submit" class="btn btn-sm btn-primary">Save & Reload</button>
        </div>
    </form>
</div>

<style>
    /* Map Prism Code Editor themes directly into DaisyUI variables for universal compatibility */
    :global(.prism-editor) {
        flex: 1;
        min-height: 0;
        --editor__bg: oklch(var(--b1));
        --editor__text-color: oklch(var(--bc));
        --editor__bg-highlight: oklch(var(--b2) / 0.5);
        --editor__bg-selection-match: oklch(var(--p) / 0.2);
        --editor__bg-active-line: oklch(var(--b2) / 0.3);
        --editor__line-number-color: oklch(var(--bc) / 0.3);
        --editor__line-number-active-color: oklch(var(--bc) / 0.7);
    }

    /* Standard Syntax Colors matched to DaisyUI intent colors */
    :global(.token.comment), :global(.token.prolog), :global(.token.doctype), :global(.token.cdata) { color: oklch(var(--bc) / 0.4); font-style: italic; }
    :global(.token.punctuation) { color: oklch(var(--bc) / 0.6); }
    :global(.token.namespace) { opacity: .7; }
    :global(.token.property), :global(.token.tag), :global(.token.boolean), :global(.token.number), :global(.token.constant), :global(.token.symbol), :global(.token.deleted) { color: oklch(var(--er)); }
    :global(.token.selector), :global(.token.attr-name), :global(.token.string), :global(.token.char), :global(.token.builtin), :global(.token.inserted) { color: oklch(var(--su)); }
    :global(.token.operator), :global(.token.entity), :global(.token.url), :global(.language-css .token.string), :global(.style .token.string) { color: oklch(var(--wa)); }
    :global(.token.atrule), :global(.token.attr-value), :global(.token.keyword) { color: oklch(var(--p)); font-weight: bold; }
    :global(.token.function), :global(.token.class-name) { color: oklch(var(--s)); }
    :global(.token.regex), :global(.token.important), :global(.token.variable) { color: oklch(var(--a)); }
</style>
