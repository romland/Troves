<script lang="ts">
    import { enhance } from '$app/forms';
    import { marked } from 'marked';
    import RelativeDate from "$lib/components/RelativeDate.svelte";
    import { notify } from "$lib/client/notifications";
	import { createEventDispatcher } from 'svelte';
    import TextButton from "$lib/components/TextButton.svelte";
    import FormInput from "$lib/components/FormInput.svelte";
	import { page } from '$app/stores';
	import { isVideo, isEpub, isMarkdown, isPdf, isHtml, isImage } from "$lib/shared/fileutils";

    export let note;
	const dispatch = createEventDispatcher();
	
	$: showContextUrl = $page.data.inventories?.find((i: any) => i.id === $page.data.activeInventoryId)?.showNoteContextUrl ?? true;
    
    let isEditing = false;
    let editContent = "";

    function getDocSnippet(doc: any) {
        if (doc.summary) return doc.summary;
        if (doc.extracts && doc.extracts !== '[]') {
            try {
                const parsed = JSON.parse(doc.extracts);
                if (parsed.length > 0) return parsed[0];
            } catch(e) {}
        }
        return "";
    }

    function openLinksInNewTab(node: HTMLElement) {
        const updateLinks = () => {
            node.querySelectorAll('a').forEach(a => {
                if (a.hostname !== window.location.hostname || a.href.startsWith('http')) {
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                }
            });
        };
        updateLinks();
        const observer = new MutationObserver(updateLinks);
        observer.observe(node, { childList: true, subtree: true });
        return { destroy() { observer.disconnect(); } };
    }    
</script>

<div class="card bg-base-100 shadow-sm border border-base-200 w-full overflow-visible">
    <!-- Top Header: Time, Tag, and Menu -->
    <div class="flex justify-between items-center px-4 pt-3 pb-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider">
        <div class="flex items-center gap-2">
            <span class="normal-case tracking-normal"><RelativeDate date={note.createdAt} capitalize={true} /></span>
            {#if note.latitude}
                <span class="text-primary"><i class="bi bi-geo-alt-fill"></i></span>
            {/if}
        </div>
        
        <div class="dropdown dropdown-end">
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button tabindex="0" class="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-primary">
                <i class="bi bi-three-dots"></i>
            </button>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-40 border border-base-200">
                <li><button class="flex items-center gap-3 w-full" on:click={(e) => { editContent = note.content || ""; isEditing = true; (document.activeElement as HTMLElement)?.blur(); }}><i class="bi bi-pencil w-4 text-center"></i> Edit</button></li>
                <li>
                    <button type="submit" form="delete-form-{note.id}" class="text-error hover:bg-error/10 hover:text-error flex items-center gap-3 w-full"><i class="bi bi-trash w-4 text-center"></i> Delete</button>
                </li>
            </ul>
            <form id="delete-form-{note.id}" action="/timeline?/delete" method="POST" use:enhance class="hidden">
                <input type="hidden" name="id" value={note.id}>
            </form>            
        </div>
    </div>
    <!-- Attached Photos -->
    {#if note.photos && note.photos.length > 0}
        <div class="flex overflow-x-auto snap-x bg-base-200 border-b border-base-200 max-h-64 hide-scrollbar">
            {#each note.photos as photo}
				<button type="button" class="shrink-0 w-full h-full snap-center block border-none p-0 bg-transparent cursor-zoom-in relative" aria-label="View Attachment" on:click={() => dispatch('openImage', photo)}>
                    {#if isVideo(photo.orgPath)}
                        <video src="{photo.orgPath}#t=0.1" class="w-full h-full object-cover" muted playsinline></video>
                        <div class="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                            <i class="bi bi-play-circle-fill text-4xl text-white drop-shadow-md"></i>
                        </div>
                    {:else}
                        <img src={photo.thumbPath || photo.orgPath} alt="Attachment" class="w-full h-full object-cover" />
                    {/if}
				</button>
            {/each}
        </div>
    {/if}

    <div class="card-body p-4 pt-2">
        <!-- Text Content -->
        {#if isEditing}
            <form action="/timeline?/edit" method="POST" use:enhance={() => { return async ({ update }) => { await update(); isEditing = false; }}}>
                <input type="hidden" name="id" value={note.id}>
                <FormInput 
                    type="textarea" 
                    name="content" 
                    bind:value={editContent} 
                    inputClass="text-sm leading-snug resize-none min-h-[4rem] max-h-[18rem] [field-sizing:content]" 
                    on:input={(e) => { const target = e.currentTarget as HTMLTextAreaElement; target.style.height = 'auto'; target.style.height = target.scrollHeight + 'px';}}
                    on:keydown={(e) => {
                        if (e.key === 'Escape') isEditing = false;
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit(); }
                    }}
                />
                <div class="flex justify-end gap-2 mt-2">
                    <button type="button" class="btn btn-ghost btn-sm" on:click={() => isEditing = false}>Cancel</button>
                    <button type="submit" class="btn btn-primary btn-sm">Save</button>
                </div>
            </form>
        {:else}
            {#if note.content}
                <div class="relative group">
                    <button class="absolute -top-1 -right-1 btn btn-xs btn-ghost btn-circle opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-primary" title="Copy text" on:click={() => { navigator.clipboard.writeText(note.content); notify('success', 'Note copied to clipboard!'); }}>
                        <i class="bi bi-clipboard"></i>
                    </button>
					<div class="prose prose-sm max-w-none text-base-content leading-snug break-words pr-6 whitespace-pre-wrap" use:openLinksInNewTab>
                        {@html marked.parse(note.content.replace(/^( {1,3})(?=\S)/gm, match => '&nbsp;'.repeat(match.length)), { breaks: true })}
                    </div>
                </div>
            {/if}

			{#if note.linkedItems && note.linkedItems.length > 0}
				<div class="mt-3 flex flex-wrap gap-2">
					{#each note.linkedItems as linkedItem}
						<div class="inline-flex bg-base-200/50 rounded-lg p-1.5 px-3 border border-base-300">
							<TextButton href={`/${linkedItem.id}/${linkedItem.slug}`} icon="bi-box-seam" colorClass="text-primary" isMono={false}>
								{linkedItem.title}
							</TextButton>
						</div>
					{/each}
				</div>
			{/if}

			{#if note.referenceUrl && showContextUrl}
				<div class="mt-3 inline-flex bg-base-200/50 rounded-lg p-1.5 px-3 border border-base-300">
					<TextButton href={note.referenceUrl} icon="bi-link-45deg" colorClass="text-primary" isMono={true}>
						{note.referenceUrl.replace(/^https?:\/\/(localhost:\d+|[^/]+)/, '') || 'Reference Link'}
					</TextButton>
				</div>
			{/if}
        {/if}

        <!-- Rich Document/Link Previews -->
        {#if note.documents && note.documents.length > 0}
            <div class="flex flex-col gap-2 {note.content ? 'mt-3' : ''}">
                {#each note.documents as doc}
                    <div class="flex flex-col border border-base-200 bg-base-200/30 rounded-xl p-3">
                        <div class="flex items-start gap-3">
                            {#if doc.thumbPath}
                                <div class="relative w-10 h-10 shrink-0">
                                    <img src={doc.thumbPath} alt={doc.title || 'Document thumbnail'} class="w-full h-full rounded-lg object-cover border border-base-300 shadow-sm bg-base-100" />
                                    <div class="absolute -bottom-1.5 -right-1.5 bg-base-100 text-gray-500 rounded-md px-1 py-0.5 flex items-center justify-center shadow-sm border border-base-200">
                                        <i class="bi {doc.type === 'note' ? 'bi-file-text' : 'bi-link-45deg'} text-[10px]"></i>
                                    </div>
                                </div>
                            {:else}
                                <div class="bg-base-300 text-gray-500 w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
                                    <i class="bi {doc.type === 'note' ? 'bi-file-text' : 'bi-link-45deg'} text-xl"></i>
                                </div>
                            {/if}
                            <div class="flex-1 min-w-0">
                                <h4 class="font-bold text-sm text-base-content line-clamp-1 m-0">{doc.title || doc.source}</h4>
                                <div class="flex items-center gap-3 mt-1.5">
                                    {#if doc.path}
										{#if isEpub(doc.path)}
                                            <TextButton colorClass="text-primary" icon="bi-book" on:click={() => dispatch('openDoc', doc)}>Read Book</TextButton>
										{:else if isMarkdown(doc.path) || doc.type === 'note'}
                                            <TextButton colorClass="text-primary" icon="bi-file-text" on:click={() => dispatch('openDoc', doc)}>Read Note</TextButton>
										{:else if isVideo(doc.path)}
                                            <TextButton colorClass="text-primary" icon="bi-play-circle" on:click={() => dispatch('openImage', { orgPath: doc.path, type: 'video' })}>Play Video</TextButton>
										{:else if isImage(doc.path)}
                                            <TextButton colorClass="text-primary" icon="bi-image" on:click={() => dispatch('openImage', { orgPath: doc.path, showOriginal: true })}>View Image</TextButton>
										{:else if isPdf(doc.path) || isHtml(doc.path)}
                                            <TextButton colorClass="text-primary" icon="bi-file-earmark" on:click={() => dispatch('openDoc', doc)}>View Document</TextButton>
										{:else}
                                            <TextButton colorClass="text-primary" icon="bi-hdd-network" on:click={() => dispatch('openDoc', doc)}>Local Cache</TextButton>
										{/if}
                                    {/if}
                                    
                                    {#if doc.source && doc.source.startsWith('http')}
                                        <TextButton href={doc.source} target="_blank" colorClass="text-gray-500 hover:text-base-content" icon="bi-globe" title={doc.source} isMono={true}>
                                            {doc.source.replace(/^https?:\/\//, '')}
                                        </TextButton>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        {#if getDocSnippet(doc)}
                            <div class="mt-2 text-xs text-gray-500 line-clamp-3 leading-relaxed prose prose-sm prose-p:my-1 prose-a:text-primary max-w-none" use:openLinksInNewTab>
                                {@html marked.parse(getDocSnippet(doc), { breaks: true })}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}        

        <!-- Metadata Footer -->
        <div class="flex justify-between items-center mt-3 pt-3 border-t border-base-200/50">
            <form action="/timeline?/updateCategory" method="POST" use:enhance class="m-0 p-0">
                <input type="hidden" name="id" value={note.id}>
                <select name="category" class="select select-ghost select-xs text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-primary focus:outline-none pl-0 pr-8" value={note.category} on:change={(e) => e.currentTarget.form?.requestSubmit()}>
                    <option value="idea">💡 Idea</option>
                    <option value="todo">✅ Todo</option>
                    <option value="to buy">🛒 Buy</option>
                    <option value="to read">🛒 Read</option>
                    <option value="other">📌 Other</option>
                    <option value="archive">📁 Archive</option>
                </select>
            </form>
            <form action="/timeline?/promote" method="POST" use:enhance class="m-0 p-0">
                <input type="hidden" name="id" value={note.id}>
                <button type="submit" class="btn btn-xs btn-ghost text-gray-500 hover:text-primary gap-1">
                    <i class="bi bi-box-arrow-in-right"></i> Promote to Item
                </button>
            </form>
        </div>
    </div>
</div>
