<script lang="ts">
    import { enhance } from "$app/forms";
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { browser } from "$app/environment";
    import { beforeNavigate } from "$app/navigation";

    export let plugin: any;
    export let confirmModal: any;
    export let enhanceFn: any;

    const dispatch = createEventDispatcher();
    let containerEl: HTMLElement;
    let editor: any;
    let originalContent = plugin.content;
    
    $: isDirty = plugin.content !== originalContent;
    let isFullscreen = false;

    beforeNavigate((navigation) => {
        if (isDirty) {
            navigation.cancel();
            confirmModal.ask('Discard changes?', 'You have unsaved changes. Are you sure you want to abandon them?', 'Discard', 'Stay', true).then((res: boolean) => {
                if (res) {
                    isDirty = false;
                    plugin.content = originalContent;
                    if (navigation.to) window.location.assign(navigation.to.url.href);
                }
            });
        }
    });

    async function handleCancel() {
        if (isDirty) {
            const res = await confirmModal.ask('Discard changes?', 'You have unsaved changes. Are you sure you want to abandon them?', 'Discard', 'Cancel', true);
            if (!res) return;
        }
        plugin.content = originalContent;
        dispatch('cancel');
    }

    function onEditorKeydown(e: KeyboardEvent) {
        if (!editor || !editor.textarea || !containerEl) return;
        
        if ((e.key === 'Home' || e.key === 'End') && e.ctrlKey) {
            e.preventDefault();
            const pos = e.key === 'Home' ? 0 : editor.textarea.value.length;
            
            if (e.shiftKey) {
                const start = editor.textarea.selectionStart;
                const end = editor.textarea.selectionEnd;
                const anchor = e.key === 'Home' ? end : start;
                editor.textarea.setSelectionRange(Math.min(anchor, pos), Math.max(anchor, pos), e.key === 'Home' ? 'backward' : 'forward');
            } else {
                editor.textarea.setSelectionRange(pos, pos);
            }
            
            const scroller = containerEl.querySelector('.prism-editor') || containerEl.firstElementChild || containerEl;
            if (scroller) (scroller as HTMLElement).scrollTop = e.key === 'Home' ? 0 : scroller.scrollHeight;
            return;
        }

        if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            const sign = e.key === 'PageUp' ? -1 : 1;
            
            const scroller = containerEl.querySelector('.prism-editor') || containerEl.firstElementChild || containerEl;
            const cs = getComputedStyle(editor.textarea);
            const lineHeight = cs.lineHeight === 'normal' ? 19.5 : parseFloat(cs.lineHeight) || 19.5;
            const linesPerPage = Math.max(1, Math.floor((scroller ? scroller.clientHeight : 450) / lineHeight) - 2);
            
            const text = editor.textarea.value;
            const start = editor.textarea.selectionStart;
            const end = editor.textarea.selectionEnd;
            const activePos = sign === -1 ? start : end;
            
            console.log(`[PG-DEBUG] -----------------`);
            console.log(`[PG-DEBUG] Action: ${e.key}, sign: ${sign}`);
            console.log(`[PG-DEBUG] Scroller clientHeight: ${scroller?.clientHeight}, scrollHeight: ${scroller?.scrollHeight}, scrollTop (before): ${scroller?.scrollTop}`);
            console.log(`[PG-DEBUG] Calculated lineHeight: ${lineHeight}, linesPerPage: ${linesPerPage}`);
            
            let currentLine = 0;
            let currentLineStart = 0;
            for (let i = 0; i < activePos; i++) {
                if (text[i] === '\n') {
                    currentLine++;
                    currentLineStart = i + 1;
                }
            }
            const charOffset = activePos - currentLineStart;
            const targetLine = Math.max(0, currentLine + (sign * linesPerPage));
            
            console.log(`[PG-DEBUG] activePos: ${activePos}, charOffset: ${charOffset}`);
            console.log(`[PG-DEBUG] currentLine: ${currentLine}, targetLine: ${targetLine}`);
            
            let targetLineStart = 0;
            let currentLineCount = 0;
            if (targetLine > 0) {
                for (let i = 0; i < text.length; i++) {
                    if (text[i] === '\n') {
                        currentLineCount++;
                        if (currentLineCount === targetLine) {
                            targetLineStart = i + 1;
                            break;
                        }
                    }
                }
                if (currentLineCount < targetLine) targetLineStart = text.length;
            }
            
            let lineLength = 0;
            for (let i = targetLineStart; i < text.length; i++) {
                if (text[i] === '\n' || text[i] === '\r') break;
                lineLength++;
            }
            
            const newPos = targetLineStart + Math.min(charOffset, lineLength);
            
            console.log(`[PG-DEBUG] targetLineStart: ${targetLineStart}, targetLineLength: ${lineLength}`);
            console.log(`[PG-DEBUG] newPos (cursor): ${newPos}`);
            
            if (e.shiftKey) {
                const anchor = sign === -1 ? end : start;
                editor.textarea.setSelectionRange(Math.min(anchor, newPos), Math.max(anchor, newPos), sign === -1 ? 'backward' : 'forward');
            } else {
                editor.textarea.setSelectionRange(newPos, newPos);
            }
            
            if (scroller) {
                (scroller as HTMLElement).scrollTop += sign * (linesPerPage * lineHeight);
                console.log(`[PG-DEBUG] scrolled by: ${sign * (linesPerPage * lineHeight)}`);
            }
            
            console.log(`[PG-DEBUG] scrollTop (after): ${scroller?.scrollTop}`);
            console.log(`[PG-DEBUG] -----------------`);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.textarea.selectionStart;
            const end = editor.textarea.selectionEnd;
        const dir = editor.textarea.selectionDirection;
            const text = editor.textarea.value;

            // Find the absolute start of the first line touching the selection
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;

            if (!e.shiftKey && start === end) {
                document.execCommand('insertText', false, '    ');
            } else {
                const isIndent = !e.shiftKey;
                
                // Ignore trailing newlines so we don't accidentally indent the completely unselected line below
                let effectiveEnd = end;
                if (end > start && text[end - 1] === '\n') {
                    effectiveEnd = end - 1;
                    if (effectiveEnd > start && text[effectiveEnd - 1] === '\r') effectiveEnd--;
                }
                
                console.log(`[TAB-DEBUG] -----------------`);
                console.log(`[TAB-DEBUG] Action: Tab, isIndent: ${isIndent}`);
                console.log(`[TAB-DEBUG] start: ${start}, end: ${end}`);
                console.log(`[TAB-DEBUG] lineStart: ${lineStart}, effectiveEnd: ${effectiveEnd}`);
                
                editor.textarea.setSelectionRange(lineStart, effectiveEnd);
                const lines = text.substring(lineStart, effectiveEnd).split('\n');
                
                let firstLineChars = 0;
                let totalChars = 0;

                const newText = lines.map((line, idx) => {
                    if (isIndent) {
                        if (idx === 0) firstLineChars = 4;
                        totalChars += 4;
                        return '    ' + line;
                    } else {
                        let remove = 0;
                        if (line.startsWith('\t')) remove = 1;
                        else while (remove < 4 && line[remove] === ' ') remove++;
                        
                        if (idx === 0) firstLineChars = -remove;
                        totalChars -= remove;
                        return line.substring(remove);
                    }
                }).join('\n');

                console.log(`[TAB-DEBUG] totalChars Delta: ${totalChars}, firstLineChars Delta: ${firstLineChars}`);
                console.log(`[TAB-DEBUG] newText length: ${newText.length}`);

                const oldLen = editor.textarea.value.length;
                document.execCommand('insertText', false, newText);
                const actualDelta = editor.textarea.value.length - oldLen;

                const newStart = start === lineStart ? start : Math.max(lineStart, start + firstLineChars);
                const newEnd = Math.max(newStart, end + actualDelta);
                
                setTimeout(() => {
                    const finalLen = editor.textarea.value.length;
                    console.log(`[TAB-DEBUG] text length after execCommand: ${finalLen}`);
                    console.log(`[TAB-DEBUG] target newStart: ${newStart}, target newEnd: ${newEnd}`);
                    editor.textarea.setSelectionRange(Math.min(newStart, finalLen), Math.min(newEnd, finalLen), dir);
                    console.log(`[TAB-DEBUG] -----------------`);
                }, 0);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation(); // Stop Prism from doubling it up
            
            const start = editor.textarea.selectionStart;
            const text = editor.textarea.value;
            
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            const currentLine = text.substring(lineStart, start);
            const match = currentLine.match(/^\s*/);
            let indent = match ? match[0] : '';
            
            const lastChar = currentLine.trim().slice(-1);
            const nextChar = text[start] || '';
            let isBetweenBrackets = false;
            const baseIndent = indent;

            if (['{', '[', '('].includes(lastChar)) {
                indent += '    ';
                if ((lastChar === '{' && nextChar === '}') || 
                    (lastChar === '[' && nextChar === ']') || 
                    (lastChar === '(' && nextChar === ')')) {
                    isBetweenBrackets = true;
                }
            }

            const insertString = isBetweenBrackets ? '\n' + indent + '\n' + baseIndent : '\n' + indent;
            document.execCommand('insertText', false, insertString);
            
            setTimeout(() => {
                if (isBetweenBrackets) {
                    const newPos = editor.textarea.selectionStart - baseIndent.length - 1;
                    editor.textarea.setSelectionRange(newPos, newPos);
                }
                
                const scroller = containerEl.querySelector('.prism-editor') || containerEl.firstElementChild || containerEl;
                if (scroller) {
                    const cursorLine = editor.textarea.value.substring(0, editor.textarea.selectionStart).split('\n').length;
                    const cs = getComputedStyle(editor.textarea);
                    const lineHeight = cs.lineHeight === 'normal' ? 19.5 : parseFloat(cs.lineHeight) || 19.5;
                    const cursorY = cursorLine * lineHeight;
                    const scrollTop = (scroller as HTMLElement).scrollTop;
                    const clientHeight = scroller.clientHeight;
                    
                    if (cursorY > scrollTop + clientHeight - (lineHeight * 2)) {
                        (scroller as HTMLElement).scrollTop = cursorY - clientHeight + (lineHeight * 2);
                    } else if (cursorY < scrollTop + (lineHeight * 2)) {
                        (scroller as HTMLElement).scrollTop = Math.max(0, cursorY - (lineHeight * 2));
                    }
                }
            }, 0);
        }
    }

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
            if (containerEl) {
                containerEl.addEventListener('keydown', onEditorKeydown, true);
            }

        }
    });

    onDestroy(() => {
        if (containerEl) containerEl.removeEventListener('keydown', onEditorKeydown, true);
        if (editor) editor.remove();
    });
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && isFullscreen) { e.preventDefault(); isFullscreen = false; } }} />

<div class="{isFullscreen ? 'fixed inset-0 z-[100] bg-base-200/90 backdrop-blur-2xl p-4 sm:p-8 flex flex-col animate-fade-in' : 'bg-base-200 rounded-xl border border-base-300 p-4 shadow-sm'} transition-colors duration-300">
    <form method="POST" action="?/savePlugin" use:enhance={() => {
        const innerEnhance = enhanceFn();
        return async (opts) => {
            await innerEnhance(opts);
            if (opts.result.type === 'success' || opts.result.type === 'redirect') {
                originalContent = plugin.content;
            }
        };
    }} class="flex flex-col gap-3 {isFullscreen ? 'w-full max-w-6xl mx-auto h-full relative' : ''}">
        <div class="flex items-center justify-between">
            <span class="font-bold font-mono text-sm">{plugin.name}</span>
            <div class="flex items-center gap-2">
                <button type="button" class="btn btn-xs btn-ghost text-base-content/50 hover:text-base-content" on:click={() => isFullscreen = !isFullscreen} title="Toggle Fullscreen">
                    <i class="bi {isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}"></i>
                </button>
                <input type="hidden" name="name" value={plugin.name}>
            </div>
        </div>

        <!-- Hidden input to pass the code back to the SvelteKit form action -->
        <input type="hidden" name="content" value={plugin.content} />
        
        <!-- The editor container -->
        <div 
            bind:this={containerEl} 
            class="w-full flex flex-col bg-base-100 rounded-xl border border-base-300 overflow-hidden focus-within:ring-2 focus-within:ring-primary/50 transition-all text-[13px] font-mono {isFullscreen ? 'flex-1 min-h-0 shadow-2xl' : 'h-[450px] shadow-inner'}"
        ></div>
        
        <div class="{isFullscreen ? 'mt-4 flex-none bg-base-100/80 backdrop-blur-xl border border-base-300 shadow-xl rounded-full p-2 flex justify-center gap-2 self-center animate-fade-in' : 'flex gap-2 justify-end mt-2'}">
            <button type="button" class="btn {isFullscreen ? 'btn-ghost rounded-full px-6' : 'btn-sm btn-ghost'}" on:click={handleCancel}>Cancel</button>
            <button type="submit" class="btn {isFullscreen ? 'btn-primary rounded-full shadow-md px-8' : 'btn-sm btn-primary'}" disabled={!isDirty}>Save & Reload</button>
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
