<script lang="ts">
    import { enhance } from "$app/forms";
    import DeviceSessionList from "$lib/components/DeviceSessionList.svelte";
    import ActionCard from "$lib/components/ActionCard.svelte";
    import ConfirmModal from "$lib/components/ConfirmModal.svelte";
    import { notify } from "$lib/client/notifications";
    import { clearEntireQueue } from "$lib/client/offlineQueue";
    import { nukeAllCaches } from "$lib/client/utils";
    import pageTitle from '$lib/stores';
    import { page } from "$app/stores";
    import { onMount } from "svelte";

    pageTitle.set("Preferences");
    
    let avatarPreview: string | null = null;
    let confirmModal: ConfirmModal;

    // --- Preferences State ---
    let availableVoices: SpeechSynthesisVoice[] = [];
    let currentTheme = "";
    onMount(() => {
        currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const observer = new MutationObserver(() => {
            currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            const populateVoices = () => {
                availableVoices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en') || v.lang.startsWith('nl'));
            };
            populateVoices();
            window.speechSynthesis.onvoiceschanged = populateVoices;
        }

        return () => observer.disconnect();
    });

    const themes = [
        { id: 'rehoboam', name: 'Westworld', icon: 'bi-record-circle', bright: false },
        { id: 'matrix', name: 'The Matrix', icon: 'bi-code-square', bright: false },
        { id: 'abyss', name: 'Abyss', icon: 'bi-water', bright: false },
        { id: 'nebula', name: 'Nebula', icon: 'bi-stars', bright: false },
        { id: 'forge', name: 'Forge', icon: 'bi-fire', bright: false },
        { id: 'black', name: 'Black', icon: 'bi-circle-fill', bright: false },
        { id: 'caramellatte', name: 'Caramellatte', icon: 'bi-cup', bright: false },
        { id: 'synthwave', name: 'Synthwave', icon: 'bi-grid-3x3-gap', bright: false },
        { id: 'dracula', name: 'Dracula', icon: 'bi-droplet', bright: false },
        { id: 'luxury', name: 'Luxury', icon: 'bi-gem', bright: false },
        { id: 'coffee', name: 'Coffee', icon: 'bi-cup-hot', bright: false },
        { id: 'manhattan', name: 'Manhattan', icon: 'bi-building', bright: false },
        { id: 'dim', name: 'Dim', icon: 'bi-paperclip', bright: false },
        { id: 'dark', name: 'Default Dark', icon: 'bi-moon', bright: false },
        { id: 'light', name: 'Default Light', icon: 'bi-sun', bright: true },
        { id: 'cyberpunk', name: 'Cyberpunk', icon: 'bi-lightning-charge', bright: true },
        { id: 'nord', name: 'Nord', icon: 'bi-snow', bright: true },
        { id: 'emerald', name: 'Emerald', icon: 'bi-shield-check', bright: true },
        { id: 'cupcake', name: 'Cupcake', icon: 'bi-cake2', bright: true },
        { id: 'winter', name: 'Winter', icon: 'bi-snow2', bright: true },
        { id: 'retro', name: 'Retro', icon: 'bi-telephone', bright: true },
    ];

    let currentPrefs = JSON.parse($page.data.user?.preferences || '{}');
    let shortcuts = {
        newSingle: 'n', newCollection: 'c', settings: 's', profile: 'p',
        editItem: 'e', setDefaultContainer: 'l', goHome: 'h',
        tab1: '1', tab2: '2', tab3: '3', tab4: '4',
        stockInc: '+', stockDec: '-',
        ...(currentPrefs.shortcuts || {})
    };

    function recordKey(e: KeyboardEvent, id: string) {
        e.preventDefault();
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        let combo = [];
        if (e.ctrlKey) combo.push('ctrl');
        if (e.altKey) combo.push('alt');
        if (e.metaKey) combo.push('meta');
        
        if (e.shiftKey && e.key.toLowerCase() !== e.key.toUpperCase()) combo.push('shift');
        combo.push(e.key.toLowerCase());
        shortcuts[id] = combo.join('+');
        shortcuts = shortcuts;
    }

    // --- Form Handlers ---
    function createEnhancer() {
        return async ({ result, update }: any) => {
            if (result.type === 'success' || result.type === 'redirect') {
                notify('success', result.data?.message || 'Saved successfully');
                if (result.data?.message?.includes('Profile')) avatarPreview = null; 
            } else if (result.type === 'failure' || result.type === 'error') {
                notify('error', result.data?.message || 'An error occurred');
            }
            await update({ reset: false });
        };
    }

    function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        if (target.files && target.files.length > 0) avatarPreview = URL.createObjectURL(target.files[0]);
    }
</script>

<div class="max-w-2xl mx-auto flex flex-col gap-8 pb-12">
    {#if !$page.data.user?.isAdmin && !$page.data.user?.canCreateInventories && $page.data.inventories?.length === 0}
        <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6 text-center animate-fade-in relative overflow-hidden">
            <div class="absolute top-0 left-0 w-full h-1 bg-warning/50"></div>
            <div class="w-16 h-16 bg-warning/10 text-warning rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="bi bi-hourglass-split text-3xl"></i>
            </div>
            <h3 class="font-bold text-lg mb-2">Pending Approval</h3>
            <p class="text-gray-500 text-sm">Your account is created, but you need an administrator to grant you access to an existing trove or permission to create your own.</p>
        </div>
    {/if}

    <!-- APPEARANCE SECTION -->
    <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6">
        <h2 class="text-2xl font-bold mb-1">Appearance</h2>
        <p class="text-sm text-gray-500 mb-5">Set your default viewing modes.</p>
        
        <form method="POST" action="?/updatePreferences" use:enhance={createEnhancer} class="flex items-center gap-3">
            <input type="hidden" name="preferences" value={JSON.stringify({ ...currentPrefs, shortcuts, documentDarkMode: currentPrefs.documentDarkMode })} />
            <input type="checkbox" class="toggle toggle-primary" bind:checked={currentPrefs.documentDarkMode} on:change={(e) => { e.currentTarget.form?.requestSubmit(); }} />
            <div class="flex flex-col"><span class="font-semibold text-sm">Force Dark Mode</span>
            <span class="text-[11px] text-gray-500">Inverts colors mathematically while attempting to preserve image hues.</span></div>
        </form>

        <form method="POST" action="?/updatePreferences" use:enhance={createEnhancer} class="flex items-center gap-3 mt-4 mb-6">
            <input type="hidden" name="preferences" value={JSON.stringify(currentPrefs)} />
            <input type="checkbox" class="toggle toggle-primary" bind:checked={currentPrefs.largeFont} on:change={(e) => { e.currentTarget.form?.requestSubmit(); document.documentElement.style.fontSize = currentPrefs.largeFont ? '110%' : ''; }} />
            <div class="flex flex-col"><span class="font-semibold text-sm">Large Font Mode</span>
            <span class="text-[11px] text-gray-500">Increases base text size for better readability.</span></div>
        </form>

		<form method="POST" action="?/updatePreferences" use:enhance={createEnhancer} class="flex items-center gap-3 mt-4 mb-6">
			<input type="hidden" name="preferences" value={JSON.stringify(currentPrefs)} />
			<input type="checkbox" class="toggle toggle-primary" bind:checked={currentPrefs.enableVoiceSearch} on:change={(e) => { e.currentTarget.form?.requestSubmit(); }} />
			<div class="flex flex-col"><span class="font-semibold text-sm">Voice Search</span>
			<span class="text-[11px] text-gray-500">Show a microphone icon in the search bar for voice dictation.</span></div>
		</form>

        <form method="POST" action="?/updatePreferences" use:enhance={createEnhancer} class="flex items-center gap-3 mt-4 mb-6">
            <input type="hidden" name="preferences" value={JSON.stringify(currentPrefs)} />
            <input type="checkbox" class="toggle toggle-primary" bind:checked={currentPrefs.enableScannerVoiceFeedback} on:change={(e) => { e.currentTarget.form?.requestSubmit(); }} />
            <div class="flex flex-col"><span class="font-semibold text-sm">Scanner Voice Feedback</span>
            <span class="text-[11px] text-gray-500">Audibly announce when a container or item is successfully scanned.</span></div>
        </form>

        <h3 class="font-bold text-lg mb-4">Application Theme</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {#each themes as theme}
                <form method="POST" action="/?/setTheme&theme={theme.id}" use:enhance={({ formData }) => {
                    console.log(`[DEBUG-THEME-CLIENT] Form submitted for theme: ${theme.id}`);
                    document.documentElement.setAttribute('data-theme', theme.id);
                    currentTheme = theme.id;
                    return async ({ result }) => {
                        console.log(`[DEBUG-THEME-CLIENT] Server returned result type: ${result.type}`, result);
                        // Force client-side cookie explicitly, to bypass any HttpOnly artifacts
                        document.cookie = `theme=${theme.id}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
                    };
                }}>
                    <input type="hidden" name="theme" value={theme.id}>
                    <button type="submit" class="btn h-auto py-4 w-full flex flex-col items-center gap-2 rounded-xl border transition-all {currentTheme === theme.id ? 'border-primary ring-2 ring-primary/30 bg-base-300' : 'border-base-300 hover:border-primary/50 bg-base-200 hover:bg-base-300'}">
                        <i class="bi {theme.icon} text-2xl"></i>
                        <span class="font-semibold text-sm">{theme.name} {theme.bright ? '🔆' : ''}</span>
                    </button>
                </form>
            {/each}
        </div>

    </div>

    <!-- SHORTCUTS SECTION -->
    <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6">
        <h3 class="font-bold text-lg mb-1">Keyboard Shortcuts</h3>
        <p class="text-sm text-gray-500 mb-6">Press single keys to navigate faster. These apply globally when not typing.</p>
        
        <form method="POST" action="?/updatePreferences" use:enhance={createEnhancer}>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-6">
                {#each [
                    { id: 'goHome', label: 'Home Page' },
                    { id: 'newSingle', label: 'New Single Item' },
                    { id: 'newCollection', label: 'New MultiScan' },
                    { id: 'profile', label: 'Profile Menu' },
                    { id: 'settings', label: 'Settings' },
                    { id: 'setDefaultContainer', label: 'Set Default Box' },
                    { id: 'editItem', label: 'Edit Current Item' },
                    { id: 'tab1', label: 'Edit Hub: Photos' },
                    { id: 'tab2', label: 'Edit Hub: Location' },
                    { id: 'tab3', label: 'Edit Hub: Details' },
                    { id: 'tab4', label: 'Edit Hub: Links' },
                    { id: 'stockInc', label: 'Stock Up (+)' },
                    { id: 'stockDec', label: 'Stock Down (-)' }
                ] as sc}
                    <div class="flex justify-between items-center bg-base-200/50 p-2 px-3 rounded-lg border border-base-200">
                        <span class="text-sm font-semibold">{sc.label}</span>
                        <input type="text" class="input input-xs input-bordered w-32 text-center font-mono bg-base-100 cursor-pointer" readonly placeholder="Press keys..." on:keydown={(e) => recordKey(e, sc.id)} value={shortcuts[sc.id] || ''} />
                    </div>
                {/each}
            </div>
            <input type="hidden" name="preferences" value={JSON.stringify({ ...currentPrefs, shortcuts })} />
            <button type="submit" class="btn btn-neutral">Save Shortcuts</button>
        </form>

		{#if currentPrefs.enableVoiceSearch}
			<form method="POST" action="?/updatePreferences" use:enhance={createEnhancer} class="flex items-center gap-3 mt-4 mb-6">
				<input type="hidden" name="preferences" value={JSON.stringify(currentPrefs)} />
				<select class="select select-sm select-bordered w-full max-w-xs" bind:value={currentPrefs.voiceURI} on:change={(e) => { e.currentTarget.form?.requestSubmit(); }}>
					<option value="">System Default Voice</option>
					{#each availableVoices as voice}
						<option value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
					{/each}
				</select>
				<div class="flex flex-col"><span class="font-semibold text-sm">Assistant Voice</span>
				<span class="text-[11px] text-gray-500">Choose the voice used for dictation replies.</span></div>
			</form>
		{/if}

    </div>

    <!-- PROFILE SECTION -->
    <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6">
        <h2 class="text-2xl font-bold mb-6">Profile Details</h2>
        <form method="POST" action="?/updateProfile" enctype="multipart/form-data" class="flex flex-col gap-5" use:enhance={createEnhancer}>
            <div class="flex items-center gap-6 mb-2">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="avatar relative group cursor-pointer" on:click={() => document.getElementById('avatarUpload')?.click()} role="button" tabindex="0">
                    <div class="w-20 rounded-full border-4 border-base-100 shadow-md bg-base-200">
                        {#if avatarPreview}
                            <img src={avatarPreview} alt="Preview" class="object-cover" />
                        {:else if $page.data.user?.avatar}
                            <img src={$page.data.user.avatar} alt="Current avatar" class="object-cover" />
                        {:else}
                            <div class="w-full h-full flex items-center justify-center text-3xl font-bold text-gray-400">
                                {$page.data.user?.name ? $page.data.user.name.charAt(0).toUpperCase() : '?'}
                            </div>
                        {/if}
                    </div>
                    <div class="absolute bottom-0 right-0 bg-primary text-white rounded-full w-7 h-7 flex items-center justify-center shadow-sm border-2 border-base-100">
						<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
							<path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/>
							<path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1m9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0"/>
						</svg>
                    </div>
                </div>
                <input type="file" id="avatarUpload" name="avatar" accept="image/*" class="hidden" on:change={handleFileChange} />
                <div class="text-sm text-gray-500">Tap to upload a new profile picture.</div>
            </div>
            
            <div class="form-control w-full">
                <div class="label"><span class="label-text font-semibold">Display Name</span></div>
                <input type="text" name="name" value={$page.data.user?.name || ''} class="input input-bordered w-full bg-base-100" />
            </div>
            
            <div class="form-control w-full">
                <div class="label"><span class="label-text font-semibold">Email Address</span></div>
                <input type="email" name="email" value={$page.data.user?.email || ''} class="input input-bordered w-full bg-base-100" />
            </div>
            <button type="submit" class="btn btn-primary mt-2">Save Profile</button>
        </form>
        
        <div class="divider my-6">Password</div>
        <form method="POST" action="?/updatePassword" use:enhance={createEnhancer} class="flex flex-col gap-4">
            <div class="flex flex-col sm:flex-row gap-2">
                <input type="password" name="password" placeholder="New Password" class="input input-bordered w-full bg-base-100" required>
                <input type="password" name="passwordConfirm" placeholder="Repeat Password" class="input input-bordered w-full bg-base-100" required>
                <button type="submit" class="btn btn-neutral sm:w-auto">Update Password</button>
            </div>
        </form>
    </div>

    <!-- DEVICES SECTION -->
    <div>
        <h2 class="text-2xl font-bold mb-4">Device Management</h2>
        <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl overflow-hidden mb-6">
            <ActionCard
                title="Clear Offline Cache"
                subtitle="Free up space and force a hard resync on this device."
                icon="bi-trash3-fill"
                iconColorClass="bg-error/10 text-error"
                variant="flat"
                showChevron={false}
                on:click={async () => {
                    const res = await confirmModal.ask('Clear Caches?', 'This will clear all offline data, queues, and force a hard reload. Any pending uploads will be deleted. Continue?', 'Clear', 'Cancel', true);
                    if (res) { await clearEntireQueue(); nukeAllCaches(true); }
                }}
            >
                <i class="bi bi-arrow-clockwise opacity-50"></i>
            </ActionCard>
        </div>

        <h3 class="font-bold text-lg mb-4 mt-2">Connected Sessions</h3>
        <div class="bg-base-100 border border-base-200 shadow-sm rounded-xl p-6">
            <DeviceSessionList sessions={$page.data.activeSessions} currentSessionHash={$page.data.currentSessionHash} />
        </div>
    </div>
</div>

<ConfirmModal bind:this={confirmModal} />

<style>
.avatar > div {
    display: flex;
}
</style>