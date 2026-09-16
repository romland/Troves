<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import InteractiveColorMix from '../InteractiveColorMix.svelte';
    const dispatch = createEventDispatcher();

    export let item: any = null;
    export let activeSchema: any[] = [];
    export let showAll: boolean = false;
    export let mode: 'edit' | 'filter' = 'edit';
    export let attributeCounts: Record<string, Record<string, number>> = {};

    export let localAttributes: Record<string, string> = {};
    let customInputs: Record<string, boolean> = {};

    // Reactively determine which fields require human intervention
    $: if (item && mode === 'edit') {
        const raw = { ...(item.extractedAttributes || {}) };
        for (const k in raw) {
            if (typeof raw[k] === 'object' && raw[k] !== null) raw[k] = JSON.stringify(raw[k]);
        }
        localAttributes = raw;
    }

    $: requiredFields = mode === 'filter' ? activeSchema.filter(f => f.name !== 'color_mix') : (showAll ? activeSchema : activeSchema.filter(f => 
        f.extractionMethod === 'HUMAN_REQUIRED' || 
        (f.extractionMethod === 'HYBRID' && !localAttributes[f.name])
    ));

    function setEnum(name: string, value: string) {
        if (mode === 'filter' && (value === '' || localAttributes[name] === value)) {
            delete localAttributes[name];
            localAttributes = localAttributes;
        } else {
            localAttributes[name] = value;
        }
        dispatch('change', localAttributes);
    }

    function save() {
        dispatch('save', { item, attributes: localAttributes });
    }

    function formatEnumLabel(str: string, fieldName: string) {
        let label = str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        if (mode === 'filter' && attributeCounts[fieldName]?.[str]) {
            label += ` (${attributeCounts[fieldName][str]})`;
        }
        return label;
    }

    function getProcessedOptions(options: string[] | null, fieldName: string) {
        if (!options && !(mode === 'filter' && attributeCounts[fieldName])) return [];

        const getSortedTokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
        const unique = [];
        const seenTokens = new Set();
        for (const opt of (options || [])) {
            const tokens = getSortedTokens(opt);
            if (!seenTokens.has(tokens)) {
                seenTokens.add(tokens);
                unique.push(opt);
            }
        }

        let finalOptions = unique;
        if (mode === 'filter' && attributeCounts[fieldName]) {
            const dbValues = Object.keys(attributeCounts[fieldName]);
            const combined = Array.from(new Set([...finalOptions, ...dbValues]));
            finalOptions = combined.filter(opt => attributeCounts[fieldName][opt] > 0);
        }
        return finalOptions.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }

    function isFreetextLike(options: string[] | null) {
        if (!options || options.length === 0) return false;
        
        // Absolute sanity limit for UI real estate
        if (options.length > 40) return true;

        let totalWords = 0;
        let totalLength = 0;
        let phraseCount = 0; // Tracks items with 3+ words

        for (const opt of options) {
            totalLength += opt.length;
            // Split by space, underscore, or dash to count actual words
            const wordCount = opt.split(/[\s_-]+/).filter(w => w.trim().length > 0).length;
            totalWords += wordCount;
            if (wordCount >= 3) phraseCount++;
        }

        const avgLength = totalLength / options.length;
        const avgWords = totalWords / options.length;

        // Triggers for free-text masquerading as enums
        if (options.length > 3 && (phraseCount / options.length) > 0.3) return true;
        if (avgWords >= 2.5) return true;
        if (avgLength > 18) return true;

        return false;
    }

    function getPlaceholder(fieldName: string) {
        switch(fieldName) {
            case 'distinctive_blemishes_or_wear': return '';
            case 'brand_or_creator': return '';
            case 'prominent_text_or_graphic': return '';
            default: return 'Enter value...';
        }
    }
</script>

<div class="p-6 bg-base-100 flex flex-col gap-5">
    {#if mode === 'edit'}
        <div>
            <h3 class="font-bold text-xl leading-tight">Attributes</h3>
            <p class="text-xs text-gray-500 mt-1">Details for "{item?.title}"</p>
        </div>
    {/if}

    <div class="flex flex-col gap-4 {mode === 'edit' ? 'overflow-y-auto max-h-[50vh] pr-2' : ''}">
        {#each requiredFields as field}
            <div class="form-control w-full">
                <div class="label pb-1"><span class="label-text font-semibold">{field.uiLabel}</span></div>
                
                {#if field.type === 'enum' && field.options}
                {@const processedOptions = getProcessedOptions(field.options, field.name)}
                {@const isFreetext = isFreetextLike(processedOptions)}
                
                {#if mode === 'filter'}
                    <select class="select select-bordered w-full rounded-xl bg-base-50 capitalize" 
                            value={localAttributes[field.name] || ''} 
                            on:change={(e) => setEnum(field.name, e.currentTarget.value)}>
                        <option value="">Any</option>
                        {#each processedOptions as opt}
                            <option value={opt}>{formatEnumLabel(opt, field.name)}</option>
                        {/each}
                    </select>
                {:else if isFreetext}
                    <input list="datalist-{field.name}" bind:value={localAttributes[field.name]} placeholder={getPlaceholder(field.name)} class="input input-bordered w-full rounded-xl bg-base-50" />
                    <datalist id="datalist-{field.name}">
                        {#each processedOptions as opt}
                            <option value={opt}>{formatEnumLabel(opt, field.name)}</option>
                        {/each}
                    </datalist>
                {:else}
                    <div class="flex flex-wrap gap-2 mt-1">
                        {#each processedOptions as opt}
                            <button 
                                type="button" 
                                class="badge badge-lg py-4 px-4 hover:border-primary transition-all capitalize {localAttributes[field.name] === opt ? 'badge-primary shadow-md' : 'badge-ghost border-base-300'}"
                                on:click={() => setEnum(field.name, opt)}>
                                {formatEnumLabel(opt, field.name)}
                            </button>
                        {/each}
                        {#if localAttributes[field.name] && !processedOptions.includes(localAttributes[field.name]) && mode === 'edit'}
                            <button type="button" class="badge badge-lg badge-primary py-4 px-4 shadow-md transition-all capitalize" on:click={() => setEnum(field.name, '')}>
                                {formatEnumLabel(localAttributes[field.name], field.name)} <i class="bi bi-x ml-1"></i>
                            </button>
                        {/if}

                        {#if customInputs[field.name]}
                            <input type="text" placeholder="Add new..." class="input input-bordered input-sm rounded-lg w-28" 
                                on:keydown={(e) => { if(e.key === 'Enter') { setEnum(field.name, e.currentTarget.value); customInputs[field.name] = false; } }} 
                                on:blur={(e) => { if(e.currentTarget.value) setEnum(field.name, e.currentTarget.value); customInputs[field.name] = false; }} />
                        {:else}
                            <button type="button" class="badge badge-lg badge-outline border-dashed hover:border-primary py-4 px-4 transition-all text-gray-500" on:click={() => customInputs[field.name] = true}>+ Custom</button>
                        {/if}
                    </div>
                {/if}
                {:else if field.type === 'number'}
                    <input type="number" bind:value={localAttributes[field.name]} placeholder="0" class="input input-bordered w-full rounded-xl bg-base-50" />
                {:else if field.name === 'color_mix'}
                    <InteractiveColorMix initialMixStr={item?.extractedAttributes?.color_mix || item?.color_mix || '[]'} bind:valueStr={localAttributes[field.name]} />
                {:else}
                <input type="text" bind:value={localAttributes[field.name]} placeholder={getPlaceholder(field.name)} class="input input-bordered w-full rounded-xl bg-base-50" />
                {/if}
            </div>
        {/each}
    </div>

    {#if mode === 'edit'}
        <div class="pt-2 border-t border-base-200 flex gap-2">
            <button class="btn btn-ghost flex-1 rounded-xl" on:click={() => dispatch('cancel')}>Skip</button>
            <button class="btn btn-primary flex-1 rounded-xl shadow-md" on:click={save}>Save Item</button>
        </div>
    {/if}
</div>