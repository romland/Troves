<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { enhance } from '$app/forms';
    import { marked } from 'marked';
    import { notify } from "$lib/client/notifications";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import { getFileInfo } from "$lib/client/utils";
    import { isPdf, isEpub, isMarkdown, isHtml, isVideo, isImage } from "$lib/shared/fileutils";
    import ItemSelectorModal from "$lib/components/ItemSelectorModal.svelte";

    export let documents: any[] = [];
    const dispatch = createEventDispatcher();
    let confirmModal: ConfirmModal;
    let itemSelector: ItemSelectorModal;
    let movingDocId: number | null = null;

    function alterSummary(txt: string) {
        if(!txt) return "";
        return marked.parse(txt, {gfm:true,breaks:true});
    }

</script>

<div class="flex flex-col gap-2 w-full min-w-0">
    {#each documents as doc, i}
        {@const info = getFileInfo(doc)}
        {@const cleanPath = (doc.path || '').toLowerCase().split('#')[0]}
        <div class="collapse collapse-arrow bg-base-200 border border-base-300 overflow-hidden">
            <input type="radio" name="my-accordion-2" checked={i===0} />
			<div class="collapse-title font-semibold bg-base-300 flex items-center gap-3 overflow-hidden pr-12">
                {#if doc.thumbPath}
                    <div class="relative w-8 h-8 shrink-0">
                        <img src={doc.thumbPath} alt={doc.title || 'Document thumbnail'} class="w-full h-full rounded object-cover border border-base-300 shadow-sm bg-base-100" />
                    </div>
                {:else}
					<div class="w-8 h-8 rounded bg-base-200 flex items-center justify-center shrink-0 border border-base-300/50 shadow-sm">
						<i class="bi {info.icon} {info.color} text-lg"></i>
					</div>
                {/if}
                <span class="truncate flex-1 min-w-0 flex items-center gap-2" title={doc.title}>
                    {#if doc.title}
                        <span class="truncate">{doc.title}</span>
                    {:else}
                        <span class="text-gray-400 italic">Processing document...</span>
                        <span class="loading loading-spinner loading-xs text-primary"></span>
                    {/if}
                </span>
				<div class="shrink-0 flex items-center gap-1.5 bg-base-200/50 px-2 py-0.5 rounded border border-base-300 shadow-sm text-base-content/70">
					<i class="bi {info.icon} text-[10px] {info.color}"></i>
					<span class="text-[9px] uppercase font-bold tracking-wider">{info.label}</span>
				</div>
            </div>
            <div class="collapse-content flex flex-col">
                <div class="prose prose-sm max-w-none break-words max-h-48 overflow-y-auto custom-scrollbar mb-4">
                    {@html alterSummary(doc.summary)}
                </div>

                <div class="flex justify-between items-center mt-auto pt-2 border-t border-base-200/50">
                    <div class="flex justify-start items-center gap-3 flex-1 min-w-0 pr-4">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 shrink-0">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        
                        {#if isEpub(cleanPath)}
                            <button type="button" class="btn btn-sm btn-primary rounded-xl shrink-0" on:click={() => dispatch('openDoc', doc)}>
                                <i class="bi bi-book"></i> Read Book
                            </button>
                        {:else if isMarkdown(cleanPath) || doc.type === 'note'}
                            <button type="button" class="btn btn-sm btn-secondary rounded-xl shadow-sm shrink-0" on:click={() => dispatch('openDoc', doc)}>
                                <i class="bi bi-file-text"></i> Read Note
                            </button>
                        {:else if isVideo(cleanPath)}
                            <button type="button" class="btn btn-sm btn-info text-info-content rounded-xl shadow-sm shrink-0" on:click={() => dispatch('openImage', { orgPath: doc.path, type: 'video' })}>
                                <i class="bi bi-play-circle"></i> Play Video
                            </button>
                        {:else if isImage(cleanPath)}
                            <button type="button" class="btn btn-sm btn-success text-success-content rounded-xl shadow-sm shrink-0" on:click={() => dispatch('openImage', { orgPath: doc.path, showOriginal: true })}>
                                <i class="bi bi-image"></i> View Image
                            </button>
                        {:else if isPdf(cleanPath) || isHtml(cleanPath)}
                            <button type="button" class="btn btn-sm btn-neutral text-neutral-content rounded-xl shadow-sm shrink-0" on:click={() => dispatch('openDoc', doc)}>
                                <i class="bi bi-file-earmark"></i> View Document
                            </button>
                        {:else if doc.path}
                            <button type="button" class="btn btn-sm btn-neutral text-neutral-content rounded-xl shadow-sm shrink-0" on:click={() => dispatch('openDoc', doc)}>
                                <i class="bi bi-hdd-network"></i> Local Cache
                            </button>
                        {:else}
                            <a href="{doc.path || doc.source}" target="_blank" class="truncate flex-1 min-w-0 block text-primary hover:underline font-medium" title="{doc.source}">
                                {doc.source}
                            </a>
                        {/if}
                            
                        {#if doc.path && (isEpub(cleanPath) || isMarkdown(cleanPath) || isPdf(cleanPath) || isHtml(cleanPath) || isVideo(cleanPath) || isImage(cleanPath)) && doc.source && doc.source.startsWith('http')}
                            <span class="text-gray-300 shrink-0 hidden sm:inline mx-1">•</span>
                            <a href="{doc.source}" target="_blank" rel="noopener noreferrer" class="text-xs text-gray-500 hover:text-primary hover:underline truncate flex items-center gap-1 min-w-0 max-w-[150px] sm:max-w-[300px]" title="{doc.source}">
                                <i class="bi bi-link-45deg text-sm shrink-0"></i> <span class="truncate font-mono">{doc.source.replace(/^https?:\/\//, '')}</span>
                            </a>
                        {/if}
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                        <form id="move-doc-form-{doc.id}" action="?/moveDocument" method="POST" class="hidden" use:enhance={() => { return async ({ update }) => { await update(); notify('success', 'Document moved to new item.'); }; }}>
                            <input type="hidden" name="docId" value={doc.id}>
                            <input type="hidden" name="targetItemId" value="">
                        </form>
                        <button type="button" class="btn btn-sm btn-ghost text-base-content hover:bg-base-200 rounded-xl" title="Move Document" on:click={() => { movingDocId = doc.id; itemSelector.showModal(); }}>
                            <i class="bi bi-box-arrow-right"></i>
                        </button>
                        <form method="POST" action="?/deleteDocument" use:enhance={() => { return async ({ update }) => { await update(); notify('success', 'Document deleted.'); }; }}>
                            <input type="hidden" name="docId" value={doc.id}>
                            <button type="button" class="btn btn-sm btn-ghost text-error hover:bg-error/10 rounded-xl" title="Delete Document" on:click={async (e) => { const form = e.currentTarget.closest('form'); const res = await confirmModal.ask('Delete Document?', `Are you sure you want to permanently delete "${doc.title}"?`, 'Delete', 'Cancel', true); if (res) form.requestSubmit(); }}>
                                <i class="bi bi-trash3"></i>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    {/each}
</div>

<ConfirmModal bind:this={confirmModal} />
<ItemSelectorModal bind:this={itemSelector} title="Move Document" subtitle="Select the item to move this document to" on:select={(e) => {
    if (movingDocId) {
        const form = document.getElementById(`move-doc-form-${movingDocId}`) as HTMLFormElement;
        if (form) {
            const input = form.querySelector('input[name="targetItemId"]') as HTMLInputElement;
            if (input) input.value = e.detail.id;
            form.requestSubmit();
        }
    }
}} />
