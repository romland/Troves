<script lang="ts">
    export let diagnostics: any = null;
</script>

{#if diagnostics}
<div class="flex flex-col gap-6 w-full">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-base-200/50 pb-4">
        <div class="flex items-center gap-3">
            <i class="bi bi-cpu text-2xl text-gray-400"></i>
            <h2 class="text-xl font-bold text-gray-500 m-0">System Diagnostics</h2>
        </div>
        <div class="text-right">
            <div class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Host Memory</div>
            <div class="text-lg font-bold text-base-content leading-none mt-1 text-nowrap">{diagnostics.totalRamGB.toFixed(1)} GB</div>
        </div>
    </div>

    <!-- Microservices (Docker) -->
    <div>
        <h5 class="text-xs font-bold uppercase tracking-wider text-base-content/50 mb-3">Microservices</h5>
        <ul class="flex flex-col gap-3">
            {#each diagnostics.microservices as ms}
                <li class="flex items-start gap-3">
                    {#if ms.running}
                        <i class="bi bi-check-circle-fill text-success text-lg mt-0.5"></i>
                    {:else if diagnostics.totalRamGB >= ms.ram}
                        <i class="bi bi-dash-circle-fill text-warning text-lg mt-0.5" title="Not running, but host has enough RAM"></i>
                    {:else}
                        <i class="bi bi-x-circle-fill text-error text-lg mt-0.5" title="Host does not have enough RAM"></i>
                    {/if}
                    
                    <div>
                        <div class="font-bold text-sm leading-tight">{ms.name} <span class="font-normal opacity-50 text-xs">({ms.ram}GB req)</span></div>
                        <div class="text-xs mt-0.5 {ms.running ? 'text-gray-500' : (diagnostics.totalRamGB >= ms.ram ? 'text-gray-500' : 'text-error')}">
                            {#if ms.running}
                                {ms.desc}.
                            {:else if diagnostics.totalRamGB >= ms.ram}
                                Offline. Host meets memory requirement.
                            {:else}
                                Offline. Host does not meet {ms.ram}GB memory requirement.
                            {/if}
                        </div>
                    </div>
                </li>
            {/each}
        </ul>
    </div>

    <!-- AI Providers -->
    <div>
        <h5 class="text-xs font-bold uppercase tracking-wider text-base-content/50 mb-3">AI Engines</h5>
        <ul class="flex flex-col gap-3">
            <li class="flex items-start gap-3">
                <i class="bi {diagnostics.apis.vision.configured ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-error'} text-lg mt-0.5"></i>
                <div>
                    <div class="font-bold text-sm leading-tight">Vision Engine: <span class="uppercase tracking-wider text-[10px] bg-base-200 px-1.5 py-0.5 rounded ml-1">{diagnostics.apis.vision.provider}</span></div>
                    <div class="text-xs text-gray-500 mt-0.5">Used for Image Classification, Auto-Tagging, & Deduplication.</div>
                </div>
            </li>
            <li class="flex items-start gap-3">
                <i class="bi {diagnostics.apis.text.configured ? 'bi-check-circle-fill text-success' : 'bi-dash-circle-fill text-warning'} text-lg mt-0.5"></i>
                <div>
                    <div class="font-bold text-sm leading-tight">Text Engine: <span class="uppercase tracking-wider text-[10px] bg-base-200 px-1.5 py-0.5 rounded ml-1">{diagnostics.apis.text.provider}</span></div>
                    <div class="text-xs text-gray-500 mt-0.5">Used for OCR JSON formatting, Summaries, and Ask Troves.</div>
                </div>
            </li>
            <li class="flex items-start gap-3">
                <i class="bi {diagnostics.apis.audio.configured ? 'bi-check-circle-fill text-success' : 'bi-dash-circle-fill text-warning'} text-lg mt-0.5"></i>
                <div>
                    <div class="font-bold text-sm leading-tight">Audio Engine: <span class="uppercase tracking-wider text-[10px] bg-base-200 px-1.5 py-0.5 rounded ml-1">{diagnostics.apis.audio.provider}</span></div>
                    <div class="text-xs text-gray-500 mt-0.5">Used for Voice Search dictation and parsing.</div>
                </div>
            </li>
        </ul>
    </div>

    <!-- Host Dependencies -->
    <div>
        <h5 class="text-xs font-bold uppercase tracking-wider text-base-content/50 mb-3">Host Dependencies</h5>
        <ul class="flex flex-col gap-3">
                {#each diagnostics.deps as dep}
                    <li class="flex items-start gap-3">
                        <i class="bi {dep.installed ? 'bi-check-circle-fill text-success' : (dep.id === 'ytdlp' ? 'bi-x-circle-fill text-warning' : 'bi-x-circle-fill text-error')} text-lg mt-0.5"></i>
                        <div>
                            <div class="font-bold text-sm leading-tight">{dep.name}</div>
                            <div class="text-xs text-gray-500 mt-0.5">
                                {dep.desc} {#if !dep.installed}Install via <code class="bg-base-200 px-1 rounded">{dep.cmd}</code>{/if}
                            </div>
                        </div>
                    </li>
                {/each}
        </ul>
    </div>
</div>
{/if}
