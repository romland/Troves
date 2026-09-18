<script lang="ts">
    export let size: 'sm' | 'lg' = 'sm';
    let className = '';
    export { className as class };

    $: containerClass = size === 'sm' ? `relative shrink-0 w-9 h-9 ${className}` : `relative shrink-0 w-48 h-48 ${className}`;
    $: imgClass = size === 'sm'
        ? "w-9 h-9 rounded-xl object-contain shadow-sm"
        : "w-48 h-48 rounded-[1.5rem] object-contain shadow-lg shadow-base-content/5 bg-base-100/50 p-3 border border-base-200/50";
</script>

<div class={containerClass}>
    <img src="/troves512.webp" alt="Troves Logo" class={imgClass} />
    {#if size === 'lg'}
        <!-- Hardware-Accelerated Sparkles -->
        <div class="absolute inset-x-0 top-0 h-1/2 pointer-events-none overflow-visible z-10">
            <svg class="sparkle s1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
            <svg class="sparkle s2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
            <svg class="sparkle s3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
            <svg class="sparkle s4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
            <svg class="sparkle s5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
            <svg class="sparkle s6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
            </svg>
        </div>
    {/if}
</div>

<style>
    .sparkle {
        position: absolute;
        width: 15%;
        height: 15%;
        opacity: 0;
        transform-origin: center;
        animation: sparkle-float 15s infinite ease-out;
        will-change: transform, opacity;
    }
    .s1 { top: 15%; left: 25%; animation-delay: 1s; color: #fbbf24; }
    .s4 { top: 25%; right: 35%; animation-delay: 3s; width: 14%; height: 14%; color: #34d399; }
    .s2 { top: 5%; right: 20%; animation-delay: 6s; width: 12%; height: 12%; color: #38bdf8; }
    .s5 { top: 10%; left: 45%; animation-delay: 9s; width: 9%; height: 9%; color: #fb7185; }
    .s3 { top: 30%; left: 55%; animation-delay: 11s; width: 10%; height: 10%; color: #a78bfa; }
    .s6 { top: 40%; right: 25%; animation-delay: 14s; width: 11%; height: 11%; color: #facc15; }

    @keyframes sparkle-float {
        0%, 8%, 100% { opacity: 0; transform: translate(0, 0) scale(0) rotate(0deg); }
        2% { opacity: 1; transform: translate(0, -5px) scale(1) rotate(45deg); }
        6% { opacity: 0; transform: translate(0, -15px) scale(0.5) rotate(90deg); }
    }
</style>