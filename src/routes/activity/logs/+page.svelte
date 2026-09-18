<script lang="ts">
    import type { PageServerData } from './$types';
    import pageTitle from '$lib/stores';
    import Modal from "$lib/components/Modal.svelte";

    export let data: PageServerData;

    pageTitle.set("System Logs");

    let payloadModal: Modal;
    let payloadModalTitle = "";
    let payloadModalContent = "";
    function openPayloadModal(log: any) {
        payloadModalTitle = log.action;
        payloadModalContent = log.payload;
        payloadModal.showModal();
    }

</script>

<div class="max-w-4xl mx-auto pb-12 animate-fade-in">
    <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold tracking-tight">Database Activity History</h1>
        <a href="/activity" class="btn btn-sm btn-ghost"><i class="bi bi-arrow-left"></i> Back to Live</a>
    </div>

    <div class="bg-base-100 border border-base-200 shadow-sm rounded-3xl overflow-hidden">
        <div class="overflow-x-auto">
            <table class="table table-zebra table-sm w-full">
                <thead>
                    <tr class="bg-base-200/50 text-gray-500">
						<th class="w-32 py-4 hidden sm:table-cell">Timestamp</th>
						<th class="w-24">Status</th>
                        <th>Action</th>
                        <th>Details</th>
						<th class="text-right hidden sm:table-cell">Target</th>
                    </tr>
                </thead>
                <tbody>
                    {#each data.logs as log}
                        <tr class="hover">
							<td class="text-xs font-mono text-gray-500 whitespace-nowrap hidden sm:table-cell">
                                {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                            </td>
                            <td>
								<span class="badge badge-sm border-none font-bold uppercase tracking-wider text-[10px] sm:w-full
                                    {log.level === 'success' ? 'bg-success/20 text-success' : 
                                     log.level === 'warning' ? 'bg-warning/20 text-warning' : 
                                     log.level === 'error' ? 'bg-error/20 text-error' : 
                                     'bg-info/20 text-info'}">
									<span class="hidden sm:inline">{log.level}</span>
									<span class="sm:hidden">
										<i class="bi {log.level === 'success' ? 'bi-check-lg' : log.level === 'warning' ? 'bi-exclamation-triangle' : log.level === 'error' ? 'bi-x-lg' : 'bi-info-circle'}"></i>
									</span>
                                </span>
                            </td>
                            <td class="font-semibold text-xs whitespace-nowrap">{log.action}</td>
							<td class="text-xs max-w-[150px] sm:max-w-xs truncate" title={log.message}>
                                {log.message}
                                {#if log.payload}
                                    <button type="button" class="btn btn-xs btn-outline btn-ghost ml-2 py-0 h-5 min-h-0 text-[10px]" on:click={() => openPayloadModal(log)}>View Details</button>
                                {/if}                                
                            </td>
							<td class="text-right hidden sm:table-cell">
                                {#if log.item}
                                    <a href="/{log.item.id}/{log.item.slug}" class="text-xs text-primary hover:underline flex items-center justify-end gap-1">
                                        <i class="bi bi-box"></i> {log.item.id}
                                    </a>
                                {:else}
                                    <span class="text-xs text-gray-400">System</span>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </div>
</div>

<Modal bind:this={payloadModal} title={payloadModalTitle} titleClass="font-bold text-lg leading-tight" boxClass="p-0 overflow-hidden sm:rounded-[2.5rem] w-11/12 max-w-5xl flex flex-col max-h-[90vh]">
    <div class="p-4 overflow-y-auto bg-base-200/50">
        <pre class="text-[10px] font-mono whitespace-pre-wrap break-words">{payloadModalContent}</pre>
    </div>
</Modal>
