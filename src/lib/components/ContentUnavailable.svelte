<script lang="ts">
    export let title: string;
    export let message: string;
    export let icon: string = 'bi-exclamation-triangle';
    export let actionLabel: string = '';
    export let actionIcon: string = 'bi-arrow-clockwise';
    export let type: 'error' | 'warning' | 'info' | 'default' = 'error';

    $: colorClasses = {
        error: 'text-error bg-error/10',
        warning: 'text-warning bg-warning/10',
        info: 'text-primary bg-primary/10',
        default: 'text-gray-400 bg-base-200'
    }[type];
</script>

<div class="flex flex-col items-center justify-center p-8 text-center animate-fade-in w-full h-full min-h-[50vh]">
    <div class="w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-sm {colorClasses}">
        <i class="bi {icon} text-4xl"></i>
    </div>
    <h2 class="text-2xl font-bold mb-3 tracking-tight text-base-content">{title}</h2>
    <p class="text-base-content/60 mb-8 max-w-sm leading-relaxed text-sm">
        {message}
    </p>

    {#if actionLabel}
        <button type="button" class="btn btn-primary rounded-2xl shadow-md px-8" on:click>
            <i class="bi {actionIcon} mr-1"></i> {actionLabel}
        </button>
    {/if}
</div>