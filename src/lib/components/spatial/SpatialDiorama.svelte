<script lang="ts">
    export let imageUrl: string;
    export let polygon: number[][] | null = null;
    export let containerClass: string = "w-full h-full";
    
    $: clipPathStr = polygon ? `polygon(${polygon.map(p => `${(p[0]/10).toFixed(2)}% ${(p[1]/10).toFixed(2)}%`).join(', ')})` : '';
</script>

<div class="relative overflow-visible p-2 {containerClass}" style="perspective: 1200px;">
    <!-- 3D Stage with Subpixel Anti-Aliasing to prevent WebKit rasterization blur -->
    <div class="relative w-full h-full transform-3d rounded-2xl bg-base-300/40 border border-white/10 shadow-2xl transition-transform duration-500 ease-out hover:rotate-x-6 hover:-rotate-y-6" style="transform-style: preserve-3d; transform: rotateX(14deg) rotateY(-16deg);">
        
        <!-- Ambient Top-Light Gradient Overlay -->
        <div class="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/10 via-transparent to-black/40 z-10 pointer-events-none" style="transform: translateZ(0px);"></div>
        
        <!-- Recessed Background Plane -->
        <img src="{imageUrl}" class="absolute inset-0 w-full h-full object-cover brightness-75 contrast-110 blur-[1px] opacity-50 rounded-2xl pointer-events-none subpixel-antialiased" style="transform: translateZ(-15px) scale(0.98); backface-visibility: hidden;" alt="Container Base" />
        
        <!-- True Spatial Cutout Extrusion -->
        {#if polygon}
            <!-- Layered Occlusion Shadow -->
            <div class="absolute inset-0 w-full h-full bg-black/60 filter blur-md pointer-events-none" style="clip-path: {clipPathStr}; transform: translateZ(10px) scale(1.02);" aria-hidden="true"></div>
            
            <!-- Floating Cutout Image -->
            <img src="{imageUrl}" class="absolute inset-0 w-full h-full object-cover drop-shadow-[0_20px_25px_rgba(0,0,0,0.7)] pointer-events-none subpixel-antialiased" style="clip-path: {clipPathStr}; transform: translateZ(28px) scale(1.02); backface-visibility: hidden; will-change: transform;" alt="Spatial Cutout" />
            
            <!-- Laser-Etched Precision Rim Highlight (1.5px crisp stroke) -->
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="absolute inset-0 w-full h-full pointer-events-none" style="transform: translateZ(29px) scale(1.02); backface-visibility: hidden;">
                <polygon points={polygon.map(p => p.join(',')).join(' ')} class="fill-white/5 stroke-white/90 drop-shadow-[0_0_4px_rgba(255,255,255,0.9)]" stroke-width="2" vector-effect="non-scaling-stroke" />
            </svg>
        {/if}
    </div>
</div>

<style>
    .transform-3d {
        transform-style: preserve-3d;
        -webkit-font-smoothing: subpixel-antialiased;
    }
</style>
