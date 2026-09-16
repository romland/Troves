<script lang="ts">
    import jsQR from 'jsqr';
    import { onMount } from 'svelte';
    import { createEventDispatcher } from 'svelte';

    let scanning = false;
    let showingError: { message: any } | null = null;
    let scanSuccessResult: string | null = null;
    let isProcessing = false;
    let modal: HTMLDialogElement;
    let autoScan = true;
    let manualTrigger = false;

    let videoElement: HTMLVideoElement;
    let canvasElement: HTMLCanvasElement;
    let stream: MediaStream | null = null;
    let scanFrameId: number;

    const dispatch = createEventDispatcher();
    export let validator: any = null;
    export let title = "Scan QR-code";

    onMount(init);

    function init() {
        if (typeof window !== 'undefined') {
            start();
        }
    }

    // Called by the parent component or button click
    export async function start() {
        scanSuccessResult = null;
        isProcessing = false;
        manualTrigger = false;
        showingError = null;
        modal.showModal();

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            
            // 1. Hardware-level Focus/Zoom
            const track = stream.getVideoTracks()[0];
            const caps = track.getCapabilities() as any;
            if (caps.zoom) {
                const zoomLvl = Math.max(caps.zoom.min, Math.min(caps.zoom.max, 2.0));
                await track.applyConstraints({ advanced: [{ zoom: zoomLvl } as any] }).catch(() => {});
            }

            videoElement.srcObject = stream;
            await videoElement.play();
            scanning = true;
            scanLoop();
        } catch (e) {
            showingError = { message: "Camera access denied or unavailable." };
        }
    }

    export function stop() {
        if (!scanning) return;
        scanning = false;
        scanSuccessResult = null;
        isProcessing = false;
        cancelAnimationFrame(scanFrameId);
        
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        if (videoElement) videoElement.srcObject = null;
        
        modal.close();
        dispatch('stop', {});
    }

    async function scanLoop() {
        if (!scanning || isProcessing) return;

        if (videoElement && videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            if (autoScan || manualTrigger) {
                try {
                    let decodedText = null;

                    // Tier 1: Apple/Google Native BarcodeDetector (Zero JS processing cost)
                    if ('BarcodeDetector' in window) {
                        // @ts-ignore
                        const detector = new BarcodeDetector({ formats: ['qr_code'] });
                        const barcodes = await detector.detect(videoElement);
                        if (barcodes.length > 0) decodedText = barcodes[0].rawValue;
                    } 
                    // Tier 2: Highly Optimized jsQR Fallback
                    else if (canvasElement) {
                        const ctx = canvasElement.getContext('2d', { willReadFrequently: true });
                        if (ctx) {
                            // Only grab the center 60% of the video to process
                            const size = Math.min(videoElement.videoWidth, videoElement.videoHeight) * 0.6;
                            const sX = (videoElement.videoWidth - size) / 2;
                            const sY = (videoElement.videoHeight - size) / 2;
                            
                            canvasElement.width = size;
                            canvasElement.height = size;
                            ctx.drawImage(videoElement, sX, sY, size, size, 0, 0, size, size);
                            const imgData = ctx.getImageData(0, 0, size, size);
                            
                            const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
                            if (code) decodedText = code.data;
                        }
                    }

                    if (decodedText) {
                        manualTrigger = false;
                        onScanSuccess(decodedText);
                        return;
                    } else if (manualTrigger) {
                        showingError = { message: "No valid QR code detected." };
                        setTimeout(() => showingError = null, 2000);
                        manualTrigger = false;
                    }
                } catch (e) {
                    // Ignore errors during scan frame
                }
            }
        }
        scanFrameId = requestAnimationFrame(scanLoop);
    }

    function onScanSuccess(decodedText: string) {
        if (isProcessing) return;
        isProcessing = true;

        let allowed: any = true;

        if (validator) {
            allowed = validator(decodedText);
        }

        if (allowed !== true) {
            if (showingError) {
                isProcessing = false;
                scanFrameId = requestAnimationFrame(scanLoop);
                return;
            }

            showingError = { message: allowed };
            setTimeout(() => { showingError = null; isProcessing = false; scanFrameId = requestAnimationFrame(scanLoop); }, 3000);
            if (navigator.vibrate) navigator.vibrate([50, 100, 50]); // Error haptic
            return;
        }

        // Success feedback!
        scanSuccessResult = decodedText;
        if (navigator.vibrate) navigator.vibrate(150); // Success haptic
        
        if (videoElement) videoElement.pause();

        setTimeout(() => {
            stop();
            dispatch('scan', decodedText);
        }, 1200); // Wait for animation to finish
    }
</script>

<style>
    @keyframes scan-laser {
        0%, 100% { top: 20%; opacity: 0; }
        10%, 90% { opacity: 1; }
        50% { top: 80%; }
    }
    .scan-laser {
        position: absolute;
        left: 15%;
        right: 15%;
        height: 2px;
        background: oklch(var(--p));
        box-shadow: 0 0 15px 4px oklch(var(--p) / 0.6);
        animation: scan-laser 2.5s ease-in-out infinite;
        border-radius: 50%;
    }
    .scale-in-bounce {
        animation: bounce-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    @keyframes bounce-in {
        0% { transform: scale(0.5); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
    }
</style>

<dialog bind:this={modal} on:close={() => stop()} id="modal" class="modal modal-bottom sm:modal-middle backdrop-blur-sm">
  <div class="modal-box sm:rounded-[2.5rem] p-4 sm:p-6 bg-base-100/95 shadow-2xl border border-base-200">
    <div class="flex justify-between items-center mb-4 px-2">
      <h3 class="font-bold text-xl tracking-tight">{title}</h3>
      <button type="button" class="btn btn-sm btn-circle btn-ghost bg-base-200/50" on:click={stop}>✕</button>
    </div>

    <main class="relative w-full rounded-3xl overflow-hidden bg-black shadow-inner aspect-[4/5] sm:aspect-square flex items-center justify-center isolate">
        
        {#if showingError !== null}
            <div class="absolute top-4 left-4 right-4 z-50 animate-fade-in">
                <div class="alert alert-error shadow-lg rounded-2xl text-white text-sm py-2 bg-error/90 backdrop-blur-md border-none">
                    <i class="bi bi-exclamation-triangle-fill text-lg"></i>
                    <span>{@html showingError.message}</span>
                </div>
            </div>
        {/if}
        
        <div class="w-full h-full relative flex items-center justify-center">
            <!-- playsinline is critical for iOS Safari -->
            <video bind:this={videoElement} class="w-full h-full object-cover rounded-3xl" autoplay playsinline muted></video>
            <canvas bind:this={canvasElement} class="hidden"></canvas>
            
            <!-- Center framing guide -->
            <div class="absolute w-3/5 aspect-square border-2 border-primary/40 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] z-0 pointer-events-none transition-all duration-300 {scanSuccessResult ? 'border-success scale-105 shadow-[0_0_0_9999px_rgba(0,0,0,0.8)]' : ''}"></div>
        </div>

        {#if scanning && !scanSuccessResult}
            <div class="absolute inset-0 z-10 pointer-events-none">
                <div class="scan-laser"></div>
            </div>
        {/if}

        {#if scanSuccessResult}
            <div class="absolute inset-0 bg-success/90 backdrop-blur-md flex flex-col items-center justify-center z-20 animate-fade-in text-success-content p-6 text-center">
                <i class="bi bi-check-circle-fill text-[5rem] mb-4 drop-shadow-xl scale-in-bounce text-white"></i>
                <span class="font-bold text-2xl tracking-tight drop-shadow-md mb-3 text-white">Captured!</span>
                <div class="bg-black/20 text-white/90 px-4 py-2 rounded-xl text-sm font-mono max-w-[80%] truncate shadow-inner border border-white/10">
                    {scanSuccessResult}
                </div>
            </div>
        {/if}

        <!-- Control Overlay -->
        <div class="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-4 z-50 pointer-events-auto">
            {#if !autoScan}
                <button type="button" aria-label="Manual Capture" class="btn btn-primary btn-circle h-16 w-16 shadow-xl hover:scale-105 border-4 border-base-100" on:click={() => manualTrigger = true}>
                    <i class="bi bi-camera text-2xl"></i>
                </button>
            {/if}
            <label class="cursor-pointer label bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg border border-white/10">
                <span class="label-text text-white/90 mr-3 font-medium text-xs uppercase tracking-wider">Auto-Scan</span>
                <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={autoScan} />
            </label>
        </div>
    </main>
  </div>
  <div class="modal-backdrop">
    <button type="button" on:click={stop}>close</button>
  </div>
</dialog>