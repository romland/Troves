<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import { notify } from "$lib/client/notifications";

    export let extensionDocs: string = '';
    
    let promptModal: Modal;
    let pluginIdea = "";
    let apiDocs = "";
    let authRequirements = "";
    let allowExploration = true;
    let tweakPluginCode: string | null = null;
    let tweakPluginName: string | null = null;

    export function show(pluginContent: string | null = null, pluginName: string | null = null) {
        tweakPluginCode = pluginContent;
        tweakPluginName = pluginName;
        pluginIdea = "";
        apiDocs = "";
        authRequirements = "";
        allowExploration = true;
        promptModal.showModal();
    }

    export function close() {
        promptModal.close();
    }

    async function copyPromptToClipboard() {
        let prompt = `I am building a plugin for Troves, my personal inventory and collection management system. It uses a drop-in, event-driven JS plugin architecture.\n\n`;
        
        prompt += `### CONTEXT: WHAT TROVES IS\n`;
        prompt += `- **Vision-First & Domain Agnostic:** Troves manages ANY physical collection (electronics, books, garden plants, rare coins, wine cellars, aquariums, etc.). Users simply take photos. Background ML pipelines (Vision models, OCR) identify the item and dynamically extract relevant custom attributes (like 'Vintage' for wine, 'Watering Schedule' for plants, or 'Mint Mark' for coins).\n`;
        prompt += `- **Self-Organizing Taxonomy & Deduplication:** The Entity-Attribute-Value (EAV) taxonomy automatically tailors schemas on the fly based on the collection. Categories automatically grow and vaporize as needed. It mathematically cross-references visual traits and text to identify items and catch duplicates (the Comparison Lens) without relying on rigid barcodes.\n`;
        prompt += `- **Spatial & Bulk Intelligence:** It supports bulk 'Multi-Scan' imports and 'Deep Scan Grid' spatial mapping to track the exact physical slot an item occupies inside a subdivided drawer or tacklebox.\n`;
        prompt += `- **The Pipeline ('onItemProcessed'):** When a user takes a photo, the item is created instantly, but background ML extraction takes time. Plugins that need item metadata (like fetching a datasheet, looking up a plant care guide, or scraping coin prices) MUST listen to 'onItemProcessed'. This event fires only *after* the ML has fully populated the item's title and attributes.\n`;
        prompt += `- **UI Actions ('registerItemAction'):** Plugins can inject custom buttons into the UI. When a user clicks it, the plugin receives the item and can execute background logic (e.g., pinging an API, sending a webhook).\n`;

        if (tweakPluginCode) {
        prompt += `- **Offline-First & Async:** All plugins execute in a background I/O queue. They must never block the UI or rely on synchronous user input during execution.\n`;
        prompt += `- **Environment Agnostic:** Troves can run bare-metal via Node.js or containerized via Docker (it is purely optional). Do not assume a strict Docker environment or hardcode container-only internal network paths.\n\n`;
            prompt += `Here is my existing plugin (${tweakPluginName}):\n\`\`\`javascript\n${tweakPluginCode}\n\`\`\`\n\n`;
            prompt += `I need you to modify it to do the following:\n${pluginIdea}\n\n`;
        } else {
            prompt += `I need a new plugin that does the following:\n${pluginIdea}\n\n`;
        }

        if (apiDocs.trim()) {
            prompt += `Here is the relevant documentation, endpoints, or context for the external services we are interacting with:\n${apiDocs}\n\n`;
        }
        if (authRequirements.trim()) {
            prompt += `Authentication details or API key structures to keep in mind:\n${authRequirements}\n\n`;
        }
        if (allowExploration) {
            prompt += `IMPORTANT: If I haven't specified a clear API to use, or if my request lacks critical technical details to write a robust plugin, PLEASE pause. Suggest 2-3 appropriate APIs or ask me clarifying questions before you output the final code. We want to do this right.\n\n`;
        }

        prompt += `CRITICAL RULES:\n
1. You MUST deliver the code enclosed in a single \`\`\`javascript codeblock. Do NOT output any conversational text, explanations, or markdown outside of this codeblock. Nothing else is accepted.
2. Security is paramount. Users of the extension might not be trusted. Close vectors around filesystem access or unescaped database queries.
3. Implement proper error handling, logging via the injected \`sysLog\`, and utilize \`{ maxRetries, retryDelayMs, rateLimitRpm }\` for external API calls.
4. If API keys are required, specify them clearly in a header block comment at the very top of the file. Remind me to add them to my .env file.
5. ABSOLUTE TRANSPARENCY (NO EXCEPTIONS): You MUST use \`logActivity(item.id, 'Action Name', 'Description', 'info', JSON.stringify(payload))\` for EVERY single action. If you build a URL, log the exact URL. If you hit an API, log the exact request and response. NEVER perform an action silently. If you omit \`logActivity\`, the user cannot see what the plugin is doing in the UI and you have failed.
6. Provenance Header: You MUST start the file with a comment block containing the exact user request so I know what generated it. Format it like: \`/* Troves Plugin generated for: "${pluginIdea.replace(/"/g, "'").substring(0, 100)}..." */\`.\n\n`;
        prompt += `Here is the official Extension Engine documentation and examples for context:\n${extensionDocs}`;

        await navigator.clipboard.writeText(prompt);
        notify('success', 'Prompt copied! Paste it into your preferred LLM.');
        close();
    }
</script>

<Modal bind:this={promptModal} title={tweakPluginName ? `Tweak ${tweakPluginName}` : "Generate a Troves Extension"} boxClass="p-0 overflow-hidden sm:rounded-[2.5rem] border border-base-200 w-11/12 max-w-2xl bg-base-100">
    <div class="p-6 max-h-[75vh] overflow-y-auto">
        <div class="text-sm text-gray-500 mb-6 mt-[-10px] space-y-3">
            <p>Describe your goal. We'll bundle your request with Troves' architectural guidelines so the language model writes code that fits the vision-first workflow.</p>
            <details class="group bg-info/10 text-base-content rounded-xl border border-info/20 text-xs overflow-hidden">
                <summary class="flex items-center justify-between p-3 cursor-pointer font-bold uppercase tracking-wider text-info select-none hover:bg-info/20 transition-colors">
                    <span><i class="bi bi-lightbulb-fill mr-1"></i> Ideas on what to include</span>
                    <i class="bi bi-chevron-down transition-transform group-open:-rotate-180"></i>
                </summary>
                <div class="p-3 pt-0 border-t border-info/20 mt-1">
                    <ul class="list-disc list-inside space-y-1 text-base-content/90 mt-2">
                        <li><b>Your Goal:</b> "Fetch release years for my CD collection"</li>
                        <li><b>Triggers:</b> "Do this automatically when scanned, but also add a manual UI button"</li>
                        <li><b>Constraints:</b> "I don't want to pay for an API, but I don't mind registering for a free one"</li>
                        <li><b>Context & Assets:</b> "I already have a Spotify developer account if that helps"</li>
                    </ul>
                </div>
            </details>
        </div>
        
        <div class="form-control w-full mb-4">
            <div class="label"><span class="label-text font-bold">What should the plugin do?</span></div>
            <textarea bind:value={pluginIdea} class="textarea textarea-bordered w-full h-32 rounded-xl bg-base-200 leading-relaxed" placeholder={tweakPluginName ? "e.g. Add a 5 second delay before sending the webhook..." : "e.g. When a new plant is processed, grab the extracted species and query a botanical API to attach a watering schedule note..."}></textarea>
        </div>

        <details class="group bg-base-200/50 rounded-2xl border border-base-200 mb-4 overflow-hidden">
            <summary class="flex items-center justify-between p-4 cursor-pointer font-bold text-sm select-none hover:bg-base-200 transition-colors">
                <div class="flex items-center gap-2"><i class="bi bi-code-slash text-primary"></i> Provide other API Docs & Context</div>
                <i class="bi bi-chevron-down transition-transform group-open:-rotate-180"></i>
            </summary>
            <div class="p-4 pt-0 flex flex-col gap-4 border-t border-base-200 mt-2">
                <div class="form-control w-full">
                    <div class="label"><span class="label-text text-xs font-semibold text-gray-500">API Endpoints or Raw JSON Examples</span></div>
                    <textarea bind:value={apiDocs} class="textarea textarea-bordered w-full h-24 rounded-xl font-mono text-xs bg-base-100" placeholder="Paste curl examples, JSON responses, or documentation snippets here..."></textarea>
                </div>
                <div class="form-control w-full">
                    <div class="label"><span class="label-text text-xs font-semibold text-gray-500">Authentication Scheme</span></div>
                    <input type="text" bind:value={authRequirements} class="input input-sm input-bordered w-full rounded-lg bg-base-100" placeholder="e.g. Requires an 'X-Api-Key' header">
                </div>
            </div>
        </details>

        <label class="cursor-pointer flex items-center gap-3 p-2 hover:bg-base-200/50 rounded-xl transition-colors">
            <input type="checkbox" bind:checked={allowExploration} class="checkbox checkbox-sm checkbox-primary" />
            <span class="label-text font-medium text-sm">Ask the model to suggest APIs if I haven't provided enough info</span>
        </label>
    </div>

    <div class="modal-action m-0 p-4 bg-base-200/30 border-t border-base-200">
        <button type="button" class="btn btn-ghost rounded-xl" on:click={close}>Cancel</button>
        <button type="button" class="btn btn-info rounded-xl shadow-sm text-white" on:click={copyPromptToClipboard} disabled={!pluginIdea.trim()}><i class="bi bi-clipboard"></i> Copy Prompt</button>
    </div>
</Modal>