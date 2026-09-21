<script lang="ts">
	import { enhance } from "$app/forms";
	import { createEventDispatcher } from "svelte";
	import Modal from "$lib/components/Modal.svelte";
	import FormInput from "$lib/components/FormInput.svelte";
    import { page } from "$app/stores";
	
	const dispatch = createEventDispatcher();
	let modal: Modal;
	export function showModal() { modal.showModal(); }
	
	let name = '';
	let contentsHint = '';
	let isHintDirty = false;
	
	// =============================================================================
	// [ARCHETYPE DEFAULTS CONFIGURATION - UI NOTE]
	// When creating an inventory, the archetype determines intelligent system defaults.
	// For example:
	// - Apparel needs deep scanning (parsing huge piles of clothes) and AI taxonomy.
	// - Media/Books needs deep scanning but NOT background removal (boxes/covers are flat).
	//
	// If you add new archetypes or tweak defaults below, ensure they are mirrored in:
	// 1. Backend creation (src/routes/troves/collections/+page.server.ts -> createInventory)
	// 2. The LLM prompts (src/lib/server/ontology.ts)
	// =============================================================================
	let selectedArchetype = 'hardware';
	
	// Auto-fill the contents hint based on the archetype if the user hasn't typed a custom one
	$: activeArch =$page.data.archetypes?.find((a: any) => a.id === selectedArchetype);
	$: if (activeArch?.contentsHint && !isHintDirty) {
		contentsHint = activeArch.contentsHint;
	}

	function handleEnhance({ formElement }: any) {
		return async ({ result, update }: any) => {
			if (result.type === 'success' || result.type === 'redirect') {
				dispatch('success', result.data?.message || 'Trove created successfully!');
				modal.close();
				name = '';
				contentsHint = '';
				isHintDirty = false;
				selectedArchetype = 'hardware';
				formElement.reset();
			} else {
				dispatch('error', result.data?.message || 'An error occurred while creating Trove.');
			}
			await update({ reset: false });
		};
	}
</script>

<Modal bind:this={modal} boxClass="p-0 overflow-hidden sm:rounded-[2.5rem] max-w-[90vw] lg:max-w-6xl flex flex-col max-h-[90vh]">
	<div class="p-6 pb-4 border-b border-base-200 bg-base-100/90 sticky top-0 z-10 flex justify-between items-center">
		<div>
			<h3 class="font-bold text-xl leading-tight">Create New Trove</h3>
			<p class="text-xs text-gray-500 mt-1">Select an archetype to automatically configure optimal system defaults.</p>
            <p class="text-xs font-bold text-warning mt-1">⚠️ Important: Archetype and the "what will be in it" choice fundamentally changes how Troves extract data and which tools are active. Choose with care!</p>
		</div>
        <button type="button" aria-label="Close" class="btn btn-sm btn-circle btn-ghost" on:click={() => modal.close()}><i class="bi bi-x-lg"></i></button>
	</div>
	
    <form method="POST" action="/settings/troves?/createInventory" use:enhance={handleEnhance} class="flex flex-col overflow-hidden">
		<div class="p-4 sm:p-6 overflow-y-auto flex flex-col gap-6 bg-base-50">
			<FormInput label="Name your Trove" labelClass="font-semibold text-lg" name="name" bind:value={name} placeholder="e.g., Garage Workbench, Wine Cellar, Electronics, Shed..." required autocomplete="off" inputClass="input-lg rounded-2xl shadow-inner focus:border-primary" />
			
			<FormInput label="What will be in it? (1-3 words)" labelClass="font-semibold text-lg" name="contentsHint" bind:value={contentsHint} on:input={() => isHintDirty = true} placeholder="e.g. vintage stamps, lego, cables, electronics, whiskey, clothes..." required inputClass="rounded-2xl shadow-inner focus:border-primary" class="-mt-2" />
			
			<div>
                <div class="label pb-2"><span class="label-text font-semibold text-lg">Select Archetype</span></div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {#each $page.data.archetypes as type}
					<label class="cursor-pointer relative">
						<input type="radio" name="archetype" value={type.id} bind:group={selectedArchetype} class="peer sr-only" />
						<div class="card bg-base-100 border-2 transition-all duration-200 h-full p-4 peer-checked:border-primary peer-checked:shadow-[0_0_15px_rgba(var(--p),0.2)] peer-checked:bg-primary/5 border-base-200 hover:border-primary/50">
							<div class="absolute top-4 right-4 text-primary opacity-0 peer-checked:opacity-100 transition-opacity"><i class="bi bi-check-circle-fill text-xl"></i></div>
							<div class="flex items-start gap-3 h-full">
								<div class="w-10 h-10 rounded-xl bg-base-200 flex items-center justify-center text-xl shrink-0 text-base-content peer-checked:bg-primary peer-checked:text-primary-content transition-colors"><i class="bi {type.icon}"></i></div>
								<div class="flex flex-col flex-1 min-w-0 pr-6 h-full">
									<span class="font-bold text-lg leading-tight mb-1">{type.name}</span>
									<span class="text-xs text-gray-500 leading-snug mb-3">{type.examples || 'Custom collection archetype.'}</span>
									<div class="mt-auto pt-3 border-t border-base-200/60 flex flex-wrap gap-1.5 w-full min-w-0">
										{#each (type.defaults || []) as def}
										<span class="badge badge-sm badge-ghost text-[10px] font-bold uppercase tracking-wider max-w-full transition-colors {def.highlight ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20' : 'opacity-70 hover:opacity-100 hover:bg-base-200'}" title="{def.tooltip}">
											<i class="bi {def.icon} mr-1 shrink-0"></i> 
											<span class="truncate">{def.label}</span>
										</span>
										{/each}
									</div>
								</div>
							</div>
						</div>
					</label>
					{/each}
				</div>
			</div>
		</div>
		<div class="p-4 bg-base-100 border-t border-base-200 sticky bottom-0 z-10">
			<button type="submit" class="btn btn-primary btn-lg w-full rounded-2xl shadow-lg" disabled={!name.trim()}>Create "{name.trim() || 'Trove'}"</button>
		</div>
	</form>
</Modal>
