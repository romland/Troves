<script lang="ts">
    export let photo: any;
    export let onOpenLightbox: () => void;

    let copiedField: string | null = null;

    // 1. Try to parse the structured LLM data (if it exists and is valid)
    $: llmData = (() => {
        if (!photo?.llmAnalysis) return null;
        try {
            // Handle cases where the LLM might have wrapped it in markdown code blocks
            const cleanJson = photo.llmAnalysis.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (e) {
            return null;
        }
    })();

    // 2. Safely extract the raw text from PaddleOCR output
    $: rawText = (() => {
        if (!photo?.ocr) return "";
        try {
            const parsed = JSON.parse(photo.ocr);
            const dataBlocks = parsed?.data?.[0] || [];
            // block[1][0] contains the text, block[1][1] contains confidence
            return dataBlocks
                .filter((block: any) => block[1][1] > 0.6) // Filter out garbage confidence
                .map((block: any) => block[1][0])
                .join('\n');
        } catch (e) {
            return "";
        }
    })();

    function handleCopy(text: string | null | undefined, fieldName: string) {
        if (!text) return;
        navigator.clipboard.writeText(String(text)).then(() => {
            copiedField = fieldName;
            setTimeout(() => { copiedField = null; }, 2000);
        });
    }
</script>

<div class="flex flex-col sm:flex-row gap-4 bg-base-100 border border-base-200 rounded-2xl p-4 shadow-sm">
    <!-- Left: The Image -->
    <button 
        type="button" 
        class="shrink-0 relative group rounded-xl overflow-hidden border border-base-200 shadow-sm sm:w-40 sm:h-40 w-full h-48 bg-base-200 cursor-zoom-in"
        on:click={onOpenLightbox}
    >
        <img 
            src={photo.orgPath} 
            alt="Invoice" 
            class="w-full h-full object-cover group-hover:scale-105 duration-300"
        >
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
    </button>

    <!-- Right: The Data -->
    <div class="flex-1 flex flex-col min-w-0">
        
        {#if llmData && (llmData.supplier || llmData.total || llmData.date)}
            <!-- STRUCTURED DATA (LLM ENHANCED) -->
            <div class="flex justify-between items-start mb-4">
                <div class="min-w-0">
                    <h4 class="text-lg font-bold truncate tracking-tight">
                        {typeof llmData.supplier === 'string' ? llmData.supplier : (llmData.supplier?.name || llmData.supplier?.vendor || 'Unknown Supplier')}
                    </h4>
                    <div class="text-sm text-gray-500 mt-0.5 flex gap-3 flex-wrap">
                        {#if llmData.date}
                            <span class="flex items-center gap-1">
                                <i class="bi bi-calendar3"></i> {typeof llmData.date === 'string' ? llmData.date : JSON.stringify(llmData.date)}
                            </span>
                        {/if}
                        {#if llmData.invoiceNo}
                            <span class="flex items-center gap-1">
                                <i class="bi bi-receipt"></i> #{typeof llmData.invoiceNo === 'string' ? llmData.invoiceNo : JSON.stringify(llmData.invoiceNo)}
                            </span>
                        {/if}
                    </div>
                </div>
                {#if llmData.total}
                    <div class="text-right shrink-0 ml-4">
                        <div class="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total</div>
                        <div class="text-xl font-bold text-base-content">{typeof llmData.total === 'string' ? llmData.total : (llmData.total?.amount || JSON.stringify(llmData.total))}</div>
                    </div>
                {/if}
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {#if llmData.invoiceNo}
                    {@const invStr = typeof llmData.invoiceNo === 'string' ? llmData.invoiceNo : JSON.stringify(llmData.invoiceNo)}
                    <button class="btn btn-sm btn-ghost bg-base-200/50 justify-start h-auto py-2" on:click={() => handleCopy(invStr, 'invoice')}>
                        <i class="bi {copiedField === 'invoice' ? 'bi-check-lg text-success' : 'bi-clipboard'}"></i>
                        <div class="flex flex-col items-start ml-1 overflow-hidden">
                            <span class="text-[10px] uppercase text-gray-500 leading-none">Invoice No</span>
                            <span class="text-xs font-semibold truncate w-full text-left">{invStr}</span>
                        </div>
                    </button>
                {/if}
                {#if llmData.date}
                    {@const dateStr = typeof llmData.date === 'string' ? llmData.date : JSON.stringify(llmData.date)}
                    <button class="btn btn-sm btn-ghost bg-base-200/50 justify-start h-auto py-2" on:click={() => handleCopy(dateStr, 'date')}>
                        <i class="bi {copiedField === 'date' ? 'bi-check-lg text-success' : 'bi-clipboard'}"></i>
                        <div class="flex flex-col items-start ml-1 overflow-hidden">
                            <span class="text-[10px] uppercase text-gray-500 leading-none">Date</span>
                            <span class="text-xs font-semibold truncate w-full text-left">{dateStr}</span>
                        </div>
                    </button>
                {/if}
                {#if llmData.total}
                    {@const totStr = typeof llmData.total === 'string' ? llmData.total : (llmData.total?.amount || JSON.stringify(llmData.total))}
                    <button class="btn btn-sm btn-ghost bg-base-200/50 justify-start h-auto py-2" on:click={() => handleCopy(totStr, 'total')}>
                        <i class="bi {copiedField === 'total' ? 'bi-check-lg text-success' : 'bi-clipboard'}"></i>
                        <div class="flex flex-col items-start ml-1 overflow-hidden">
                            <span class="text-[10px] uppercase text-gray-500 leading-none">Total</span>
                            <span class="text-xs font-semibold truncate w-full text-left">{totStr}</span>
                        </div>
                    </button>
                {/if}
            </div>

            <!-- Line Items -->
            {#if llmData.items && Array.isArray(llmData.items) && llmData.items.length > 0}
                <details class="collapse collapse-arrow bg-base-200/30 border border-base-200 mb-4 rounded-xl">
                    <summary class="collapse-title text-sm font-semibold min-h-0 py-3">
                        Show Line Items ({llmData.items.length})
                    </summary>
                    <div class="collapse-content pb-3">
                        <div class="overflow-x-auto">
                            <table class="table table-xs w-full">
                                <thead>
                                    <tr class="border-base-300">
                                        <th class="pl-0">Item</th>
                                        <th class="text-right">Qty</th>
                                        <th class="text-right pr-0">Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each llmData.items as item}
                                        <tr class="border-base-200/50">
                                            <td class="pl-0 whitespace-normal break-words max-w-[200px] text-gray-600">{item.description || '-'}</td>
                                            <td class="text-right">{item.quantity || 1}</td>
                                            <td class="text-right pr-0 font-medium">{item.price || '-'}</td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>
            {/if}
        {/if}

        <!-- RAW OCR FALLBACK (Always available) -->
        {#if rawText}
            <div class="mt-auto">
                <details class="collapse collapse-plus bg-base-200/50 border border-base-200 rounded-xl">
                    <summary class="collapse-title text-sm font-semibold min-h-0 py-3 text-gray-500">
                        <i class="bi bi-fonts mr-2"></i> Raw OCR Text
                    </summary>
                    <div class="collapse-content pb-3">
                        <div class="bg-base-100 border border-base-300 rounded-lg p-3 relative group">
                            <pre class="text-xs font-mono text-gray-500 whitespace-pre-wrap break-words max-h-48 overflow-y-auto hide-scrollbar">{rawText}</pre>
                            <button 
                                class="btn btn-sm btn-circle btn-primary absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                                on:click={() => handleCopy(rawText, 'raw')}
                                title="Copy all text"
                            >
                                <i class="bi {copiedField === 'raw' ? 'bi-check-lg' : 'bi-clipboard'}"></i>
                            </button>
                        </div>
                    </div>
                </details>
            </div>
        {/if}
    </div>
</div>