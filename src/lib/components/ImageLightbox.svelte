<script lang="ts">
    import { fade, scale } from 'svelte/transition';
    import { cubicOut } from 'svelte/easing';
	import { spring } from 'svelte/motion';
    import { enhance } from '$app/forms';
    import { invalidateAll } from '$app/navigation';
    import { notify } from "$lib/client/notifications";
	import PromptModal from "$lib/components/PromptModal.svelte";
    import { isVideo } from "$lib/shared/fileutils";
    import { getHighlightStyle } from '$lib/shared/boundingBox';

    export let itemTitle = "";
    export let categories: any[] = [];
    export let allowCategoryEdit = false;

    let isOpen = false;
    let photo: any = null;
    let showOriginal = false;
	let showMenu = false;
	let fileDetails = { size: '...', type: '...', dimensions: '...' };

    // Pan & Zoom State
	// Tuned for a buttery, slight-bounce iOS feel
	let scaleVal = spring(1, { stiffness: 0.15, damping: 0.65 });
	let translateX = spring(0, { stiffness: 0.15, damping: 0.65 });
	let translateY = spring(0, { stiffness: 0.15, damping: 0.65 });
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    
    // Advanced Pinch & Focal State
    let pinchInitialDistance = 0;
    let pinchInitialScale = 1;
    let pinchInitialTx = 0;
    let pinchInitialTy = 0;
    let pinchFocalX = 0;
    let pinchFocalY = 0;
	let dragHasMoved = false;

	let isVideoLoading = true;
	let showLargeVideoWarning = false;
	let isMobile = false;
	let isCheckingVideoSize = false;

	// Momentum (Gliding) Trackers
    let swipeOffsetY = 0;
	let lastDragX = 0;
	let lastDragY = 0;
	let lastDragTime = 0;
	let velocityX = 0;
	let velocityY = 0;

    // Tap tracking for manual double-tap
    let lastTapTime = 0;

	let promptModal: PromptModal;

    export function open(p: any) {
        photo = p;
        showOriginal = p.showOriginal || false;
        resetZoom(true);
        showMenu = false;
        isVideoLoading = true;
        isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
		isCheckingVideoSize = isMobile && isVideo(p.orgPath);
        isOpen = true;
        fetchDetails();
    }

	async function fetchDetails() {
		if (!photo?.orgPath) return;
		fileDetails = { size: '...', type: '...', dimensions: '...' };

		try {
			const res = await fetch(photo.orgPath, { method: 'HEAD' });
			const bytes = res.headers.get('content-length');
			const type = res.headers.get('content-type');
			let sizeStr = 'Unknown';
			if (bytes) {
				const mb = parseInt(bytes) / (1024 * 1024);
				sizeStr = mb > 1 ? `${mb.toFixed(2)} MB` : `${(parseInt(bytes) / 1024).toFixed(0)} KB`;
				if (mb > 50 && isVideo(photo.orgPath)) {
					showLargeVideoWarning = true;
				}
			}
			fileDetails = { ...fileDetails, size: sizeStr, type: type || 'Unknown' };
		} catch (e) {}
		isCheckingVideoSize = false;

        if (isVideo(photo.orgPath)) {
			const vid = document.createElement('video');
			vid.onloadedmetadata = () => {
				fileDetails = { ...fileDetails, dimensions: `${vid.videoWidth} × ${vid.videoHeight}` };
			};
			vid.src = photo.orgPath;
		} else {
			const img = new Image();
			img.onload = () => {
				fileDetails = { ...fileDetails, dimensions: `${img.naturalWidth} × ${img.naturalHeight}` };
			};
			img.src = showOriginal ? photo.orgPath : (photo.cropPath || photo.orgPath);
		}
	}

    export function close(force: any = false) {
        // Fix: Svelte event handlers pass the Event object (which is truthy).
        // We strictly check if force is exactly the boolean 'true'.
        const isForce = force === true;

        // Auto-save rotation in the background
        if (!isForce && photo?.id && rotation % 360 !== 0) {
            saveRotationBackground(rotation, photo.id);
        }
        isOpen = false;
        setTimeout(() => {
            photo = null;
            rotation = 0;
            resetZoom(true);
        }, 300); // Matches transition duration
    }

    function saveRotationBackground(deg: number, pid: number) {
        const degrees = ((deg % 360) + 360) % 360;
        notify('info', 'Saving image rotation...');
        fetch('/api/photo-rotate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoId: pid, degrees })
        }).then(res => {
            if (res.ok) invalidateAll();
            else notify('error', 'Failed to save rotation');
        }).catch(e => notify('error', 'Network error during rotation save'));
    }

    function resetZoom(hard: boolean | Event = false) {
        const isHard = hard === true; // Protect against Svelte passing MouseEvents
        scaleVal.set(1, { hard: isHard });
        translateX.set(0, { hard: isHard });
        translateY.set(0, { hard: isHard });
        rotation = 0;
        isDragging = false;
        pinchInitialDistance = 0;
		dragHasMoved = false;
		velocityX = 0;
		velocityY = 0;
    }

    // Edge Constraints: Prevents panning out of bounds when zoomed in
    function applyBounds(tx: number, ty: number, scale: number) {
        if (scale <= 1) return { x: 0, y: 0 };
        const maxTx = Math.max(0, (window.innerWidth * (scale - 1)) / 2);
        const maxTy = Math.max(0, (window.innerHeight * (scale - 1)) / 2);
        return {
            x: Math.max(-maxTx, Math.min(maxTx, tx)),
            y: Math.max(-maxTy, Math.min(maxTy, ty))
        };
    }

    // True Focal-Point Zooming: Keeps the pixel under your finger/cursor exactly where it is
    function zoomTo(newScale: number, focalX: number, focalY: number, hard = false) {
        let targetScale = newScale;
        if (targetScale < 1 && hard) targetScale = 1 - (1 - targetScale) * 0.5; // Rubber banding
        else if (targetScale < 1) targetScale = 1; // Snap back instantly
		targetScale = Math.min(targetScale, 15);

        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        // Calculate where the focal point sits on the original un-scaled image
        const imageX = (focalX - cx - $translateX) / $scaleVal;
        const imageY = (focalY - cy - $translateY) / $scaleVal;

        // Project the new translation to keep that exact pixel under the focal point
        let newTx = (focalX - cx) - (imageX * targetScale);
        let newTy = (focalY - cy) - (imageY * targetScale);

        // Enforce edge gravity
        const bounded = applyBounds(newTx, newTy, targetScale);

        scaleVal.set(targetScale, { hard });
        translateX.set(bounded.x, { hard });
        translateY.set(bounded.y, { hard });
    }

    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        const delta = e.deltaY * -0.005;
        zoomTo($scaleVal + delta, e.clientX, e.clientY, false);
    }

    function startDrag(e: MouseEvent | TouchEvent) {
        isDragging = true;
		dragHasMoved = false;
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
		startX = clientX - $translateX;
		startY = clientY - $translateY;

		lastDragX = clientX;
		lastDragY = clientY;
		lastDragTime = performance.now();
		velocityX = 0;
		velocityY = 0;
    }

    function onDrag(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
		// Calculate velocity for gliding (pixels per millisecond)
		const now = performance.now();
		const dt = now - lastDragTime;
		if (dt > 0) {
			velocityX = (clientX - lastDragX) / dt;
			velocityY = (clientY - lastDragY) / dt;
		}
		lastDragX = clientX;
		lastDragY = clientY;
		lastDragTime = now;

		let rawX = clientX - startX;
		let rawY = clientY - startY;

        // If fully zoomed out, track vertical drag for swipe-to-close
        if ($scaleVal === 1) {
            swipeOffsetY = rawY;
            translateY.set(rawY, { hard: true });
            return;
        }

		// Determine bounds based on scale
		const maxTx = Math.max(0, (window.innerWidth * ($scaleVal - 1)) / 2);
		const maxTy = Math.max(0, (window.innerHeight * ($scaleVal - 1)) / 2);

		// Apply rubber-band resistance if dragging past the edges
		if (rawX > maxTx) rawX = maxTx + (rawX - maxTx) * 0.3;
		else if (rawX < -maxTx) rawX = -maxTx + (rawX + maxTx) * 0.3;

		if (rawY > maxTy) rawY = maxTy + (rawY - maxTy) * 0.3;
		else if (rawY < -maxTy) rawY = -maxTy + (rawY + maxTy) * 0.3;

		if (Math.abs(rawX - $translateX) > 3 || Math.abs(rawY - $translateY) > 3) dragHasMoved = true;

		translateX.set(rawX, { hard: true });
		translateY.set(rawY, { hard: true });
    }

    function endDrag() {
        isDragging = false;
        pinchInitialDistance = 0;
		
		if ($scaleVal < 1) {
			zoomTo(1, window.innerWidth / 2, window.innerHeight / 2, false);
            swipeOffsetY = 0;
			return;
		}

        if ($scaleVal === 1) {
			if (Math.abs(swipeOffsetY) > 75 || Math.abs(velocityY) > 0.6) {
				// Fling the image off-screen using your swipe momentum while fading
				const throwDir = swipeOffsetY > 0 ? 1 : -1;
				translateY.set(throwDir * (window.innerHeight || 800), { hard: false });
                close();
            } else {
                translateY.set(0);
            }
            swipeOffsetY = 0;
            return;
        }

		const maxTx = Math.max(0, (window.innerWidth * ($scaleVal - 1)) / 2);
		const maxTy = Math.max(0, (window.innerHeight * ($scaleVal - 1)) / 2);
		
		let targetTx = $translateX;
		let targetTy = $translateY;

		// Momentum Glide: If released while in motion (less than 50ms since last movement), throw it forward
		if (performance.now() - lastDragTime < 50) {
			const momentumMultiplier = 200; // Adjust for more/less slide distance
			targetTx += velocityX * momentumMultiplier;
			targetTy += velocityY * momentumMultiplier;
		}

		// Clamp the projected target to the boundaries. 
		// The spring will naturally decelerate and glide smoothly into these limits.
		const bounded = applyBounds(targetTx, targetTy, $scaleVal);
		translateX.set(bounded.x);
		translateY.set(bounded.y);
    }

    function handleDoubleTap(clientX: number, clientY: number) {
        if ($scaleVal > 1) zoomTo(1, clientX, clientY, false);
        else zoomTo(2.5, clientX, clientY, false);
    }

    function handleTouchStart(e: TouchEvent) {
        if (e.touches.length === 2) {
            pinchInitialDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            pinchFocalX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            pinchFocalY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            pinchInitialScale = $scaleVal;
            pinchInitialTx = $translateX;
            pinchInitialTy = $translateY;
            isDragging = false;
        } else {
           const now = Date.now();
           if (now - lastTapTime < 300) {
               handleDoubleTap(e.touches[0].clientX, e.touches[0].clientY);
               lastTapTime = 0;
               e.preventDefault();
           } else {
               lastTapTime = now;
               startDrag(e);
           }
        }
    }

    function handleTouchMove(e: TouchEvent) {
        if (e.touches.length === 2 && pinchInitialDistance) {
            e.preventDefault();
            const currentDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const currentFocalX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const currentFocalY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            let targetScale = pinchInitialScale * (currentDistance / pinchInitialDistance);
            if (targetScale < 1) targetScale = 1 - (1 - targetScale) * 0.5;
			targetScale = Math.min(targetScale, 15);

            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;

            // Calculate pan difference + zoom difference
            const imageX = (pinchFocalX - cx - pinchInitialTx) / pinchInitialScale;
            const imageY = (pinchFocalY - cy - pinchInitialTy) / pinchInitialScale;

            let newTx = (currentFocalX - cx) - (imageX * targetScale);
            let newTy = (currentFocalY - cy) - (imageY * targetScale);

            const bounded = applyBounds(newTx, newTy, targetScale);

            scaleVal.set(targetScale, { hard: true });
            translateX.set(bounded.x, { hard: true });
            translateY.set(bounded.y, { hard: true });
        } else {
            onDrag(e);
        }
    }
    
    function toggleOriginal() {
        showOriginal = !showOriginal;
    }

	function handleBackgroundClick() {
		// Prevent closing if the user was simply flicking/dragging the image and let go on the background
		if (dragHasMoved) {
			dragHasMoved = false;
			return;
		}
		close();
	}

	async function downloadImage() {
		try {
			const path = showOriginal ? photo.orgPath : (photo.cropPath || photo.orgPath);
			const res = await fetch(path);
			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.style.display = 'none';
			a.href = url;
			a.download = path.split('/').pop() || 'download.png';
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			showMenu = false;
		} catch (e) { console.error('Download failed', e); }
	}

	function copyLink() {
		const path = showOriginal ? photo.orgPath : (photo.cropPath || photo.orgPath);
		navigator.clipboard.writeText(window.location.origin + path);
		showMenu = false;
        notify('success', 'Link copied to clipboard!');
	}


    // Rotation State
	function copyImageToClipboard(withBackground = false) {
        try {
            const path = showOriginal ? photo.orgPath : (photo.cropPath || photo.orgPath);
            
            // iOS Safari requires navigator.clipboard.write to be called synchronously.
            // By passing a Promise into ClipboardItem, we keep the gesture trust window open 
            // while we fetch and safely transcode the image to PNG.
            const blobPromise = fetch(path)
                .then(res => res.blob())
                .then(blob => new Promise<Blob>((resolve, reject) => {
                    // Extracting from the pristine Blob prevents DOM CSS properties 
                    // (like mix-blend-multiply) from corrupting the canvas alpha channel on iOS.
                    if (blob.type === 'image/webp' || blob.type === 'image/jpeg' || withBackground) {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width; 
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            
                            if (withBackground) {
                                // Draw a sleek dark card background to neutralize WhatsApp's white outline
                                ctx.fillStyle = '#2a323c';
                                ctx.fillRect(0, 0, canvas.width, canvas.height);
                                
                                if (cols.length > 0) {
                                    ctx.globalAlpha = 0.3;
                                    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
                                    gradient.addColorStop(0, cols[0]);
                                    gradient.addColorStop(1, cols[1] || cols[0]);
                                    ctx.fillStyle = gradient;
                                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                                    ctx.globalAlpha = 1.0;
                                }
                            }
                            
                            ctx?.drawImage(img, 0, 0);
                            canvas.toBlob((pngBlob) => {
                                if (pngBlob) resolve(pngBlob);
                                else reject(new Error("Canvas toBlob failed"));
                            }, 'image/png');
                            URL.revokeObjectURL(img.src);
                        };
                        img.onerror = reject;
                        img.src = URL.createObjectURL(blob);
                    } else {
                        resolve(blob);
                    }
                }));

            navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
                .then(() => {
                    showMenu = false;
                    notify('success', withBackground ? 'Image with gradient copied!' : 'Image copied to clipboard!');
                })
                .catch((e) => {
                    console.error('Clipboard write failed:', e);
                    notify('error', 'Failed to copy image');
                });
        } catch (e) {
            console.error('Copy image setup failed', e);
            notify('error', 'Failed to copy image');
        }
    }

    async function makePrimary() {
        try {
            const res = await fetch('/api/photo-primary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photoId: photo.id, itemId: photo.itemId })
            });
            if (res.ok) {
                photo.isPrimary = true;
                notify('success', 'Set as key photo!');
                invalidateAll();
                showMenu = false;
            } else {
                notify('error', 'Failed to set key photo');
            }
        } catch (e) { notify('error', 'Network error'); }
    }

    let rotation = 0;
    function rotateLeft() { rotation -= 90; }
    function rotateRight() { rotation += 90; }

    $: ai = (() => {
        if (!photo?.llmAnalysis) return null;
        try {
            const cleanJson = photo.llmAnalysis.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (e) {
            return null;
        }
    })();

    $: parsedColors = (() => {
        if (!photo?.colors || photo.colors.length <= 2) return null;
        try { return JSON.parse(photo.colors); } catch(e) { return null; }
    })();
    
    $: cols = parsedColors ? Object.keys(parsedColors) : [];
    $: colNames = parsedColors ? Object.values(parsedColors) : [];
</script>

<svelte:window on:keydown={(e) => {
    if (e.key === 'Escape' && isOpen) {
        e.preventDefault(); // Stop browser from instantly dismissing the dialog we are about to open
        close();
    }
}} />

{#if isOpen}
    <!-- Backdrop & Container -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="fixed inset-0 z-[9999] flex flex-col items-center justify-center overscroll-none touch-none overflow-hidden {photo?.orgPath?.match(/\.(mp4|webm|mov|ogg|mkv)$/i) ? '' : 'backdrop-blur-xl'}"
        style="background-color: rgba(0,0,0, {Math.max(0, 0.95 - Math.abs($translateY) / 600)}); transition: background-color 0s linear;"
        transition:fade={{ duration: 250, easing: cubicOut }}
		on:click|self={handleBackgroundClick}
    >
        <!-- Header (Glassmorphic) -->
        <div class="absolute top-0 inset-x-0 p-4 sm:p-6 flex justify-between items-start bg-gradient-to-b from-black/60 to-transparent z-50 pointer-events-none">
            <div class="text-white drop-shadow-md pr-4 pointer-events-auto max-w-[80%]">
                <h2 class="text-xl sm:text-2xl font-bold tracking-tight line-clamp-1 sm:line-clamp-2">
                    {itemTitle}
                </h2>
                <div class="flex items-center gap-2 mt-1.5 opacity-90">
                    {#if photo?.type}
                        <span class="text-xs font-semibold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded backdrop-blur-md">
                            {photo.type}
                        </span>
                    {/if}
                    {#if ai?.subCategory}
                        <span class="text-xs font-semibold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded backdrop-blur-md">
                            {ai.subCategory}
                        </span>
                    {/if}
                    {#if ai?.description}
                        <details class="text-xs sm:text-sm text-gray-200 ml-1 group cursor-pointer">
                            <summary class="list-none line-clamp-1 group-open:line-clamp-none group-open:mb-2 outline-none">
                                &mdash; {ai.description}
                            </summary>
                        </details>
                    {/if}
                </div>
            </div>
			<div class="flex items-center gap-2 pointer-events-auto shrink-0 relative">
				<button 
					class="btn btn-circle btn-ghost bg-white/10 hover:bg-white/20 text-white border-none backdrop-blur-md" 
					on:click={() => showMenu = !showMenu}
					aria-label="More Actions"
				>
					<i class="bi bi-three-dots-vertical text-xl"></i>
				</button>
				{#if showMenu}
                    <!-- Invisible backdrop to catch clicks outside the menu -->
                    <div class="fixed inset-0 z-40" on:click|stopPropagation={() => showMenu = false} role="button" tabindex="0" aria-label="Close menu"></div>
					<div class="absolute top-14 right-0 w-56 bg-black/60 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col p-1 animate-fade-in z-50">
						<div class="px-3 py-2 border-b border-white/10 flex flex-col mb-1">
							<span class="text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">Details</span>
							<span class="text-xs text-white/90 truncate"><i class="bi bi-file-earmark mr-1"></i> {fileDetails.type}</span>
							<span class="text-xs text-white/90"><i class="bi bi-aspect-ratio mr-1"></i> {fileDetails.dimensions}</span>
							<span class="text-xs text-white/90"><i class="bi bi-hdd mr-1"></i> {fileDetails.size}</span>
						</div>

                        {#if photo?.type === 'product' && photo?.id && !photo.isPrimary}
                            <div class="border-b border-white/10 pb-1 mb-1">
                                <button class="btn btn-ghost btn-sm text-white hover:bg-white/20 justify-start h-10 px-3 font-medium rounded-xl w-full" on:click={makePrimary}>
                                    <i class="bi bi-star text-lg w-5 opacity-70"></i> Make Key Photo
                                </button>
                            </div>
                        {/if}

                        {#if allowCategoryEdit && photo?.type === 'product' && photo?.id}
                            <div class="border-b border-white/10 pb-1 mb-1">
                                <div class="relative w-full">
                                    <i class="bi bi-tag text-lg w-5 opacity-70 absolute left-3 top-2 pointer-events-none text-white"></i>
                                    <select class="select select-sm bg-transparent text-white hover:bg-white/20 border-none font-medium text-sm h-10 min-h-0 pl-10 pr-8 w-full rounded-xl outline-none cursor-pointer appearance-none" 
                                        value={photo.category?.name || ''} 
                                        on:change={async (e) => {
                                            e.currentTarget.blur();
                                            let newCat = e.currentTarget.value;
                                            if (newCat === '_new') {
											newCat = await promptModal.ask('New Category', 'Enter new category name:', 'e.g. Tools');
                                                if (!newCat || !newCat.trim()) {
                                                    e.currentTarget.value = photo.category?.name || '';
                                                    return;
                                                }
                                            }
                                            showMenu = false;
                                            
                                            const fd = new FormData();
                                            fd.append('photoId', photo.id.toString());
                                            fd.append('categoryName', newCat.trim());
                                            await fetch(window.location.pathname + '?/changeCategory', {
                                                method: 'POST',
                                                body: fd,
                                                headers: { 'x-sveltekit-action': 'true', 'accept': 'application/json' }
                                            });
                                            await invalidateAll();
                                        }}>
                                        <option value="" disabled>Category...</option>
                                        {#each categories as c}
                                            <option value={c.name} class="capitalize bg-base-100 text-base-content">{c.name}</option>
                                        {/each}
                                        <option value="_new" class="bg-base-100 text-base-content">+ New Category...</option>
                                    </select>
                                </div>
                            </div>
                        {/if}
                        
						{#if !photo?.orgPath?.match(/\.(mp4|webm|mov|ogg|mkv)$/i)}
                        <button class="btn btn-ghost btn-sm text-white hover:bg-white/20 justify-start h-10 px-3 font-medium rounded-xl" on:click={() => copyImageToClipboard(false)}>
                            <i class="bi bi-clipboard text-lg w-5 opacity-70"></i> Copy Image
                        </button>
                        <button class="btn btn-ghost btn-sm text-white hover:bg-white/20 justify-start h-10 px-3 font-medium rounded-xl" on:click={() => copyImageToClipboard(true)}>
                            <i class="bi bi-palette text-lg w-5 opacity-70"></i> Copy with Gradient
                        </button>
						{/if}
						<button class="btn btn-ghost btn-sm text-white hover:bg-white/20 justify-start h-10 px-3 font-medium rounded-xl" on:click={downloadImage}>
							<i class="bi bi-download text-lg w-5 opacity-70"></i> Save to Device
						</button>
						<button class="btn btn-ghost btn-sm text-white hover:bg-white/20 justify-start h-10 px-3 font-medium rounded-xl" on:click={copyLink}>
							<i class="bi bi-link-45deg text-lg w-5 opacity-70"></i> Copy Direct Link
						</button>
					</div>
				{/if}
				<button 
                   class="btn btn-circle btn-ghost bg-white/10 hover:bg-white/20 text-white border-none backdrop-blur-md hidden sm:inline-flex"
                    on:click={() => close()}
					aria-label="Close lightbox"
				>
					<i class="bi bi-x-lg text-xl"></i>
				</button>
			</div>
        </div>

        {#if isVideo(photo?.orgPath)}
            <!-- Pure Video Player (Bypasses gesture canvas to prevent Safari iOS freezing bugs) -->
            <div class="w-full h-full flex items-center justify-center p-4 z-10" on:click|self={handleBackgroundClick}>
                <!-- svelte-ignore a11y-media-has-caption -->
				{#if isCheckingVideoSize}
					<div class="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
						<span class="loading loading-spinner loading-lg text-primary drop-shadow-md"></span>
					</div>
				{:else if isMobile && showLargeVideoWarning}
					<div class="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 text-white p-6 text-center animate-fade-in backdrop-blur-md">
						<i class="bi bi-exclamation-triangle text-4xl text-warning mb-3"></i>
						<h3 class="font-bold text-lg mb-1">Large Video File</h3>
						<p class="text-xs text-gray-400 mb-6">{fileDetails.size}. Viewing this may cause buffering on mobile networks.</p>
						<button class="btn btn-primary btn-sm rounded-xl shadow-lg" on:click={() => showLargeVideoWarning = false}>Play Anyway</button>
					</div>
                <!-- svelte-ignore a11y-media-has-caption -->
				{:else}
					{#if isVideoLoading}
						<div class="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
							<span class="loading loading-spinner loading-lg text-primary drop-shadow-md"></span>
						</div>
					{/if}
	                <video 
	                    src="{photo?.orgPath}" 
						class="max-w-full max-h-full rounded-xl shadow-2xl bg-black outline-none {isVideoLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300" 
	                    controls playsinline preload="metadata" autoplay
	                    in:scale={{ start: 0.9, duration: 300, easing: cubicOut }}
						on:waiting={() => isVideoLoading = true}
						on:playing={() => isVideoLoading = false}
						on:canplay={() => isVideoLoading = false}
						on:loadeddata={() => isVideoLoading = false}
						on:error={() => isVideoLoading = false}
	                ></video>
				{/if}
            </div>
        {:else}
            <!-- Interactive Image Canvas -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div 
			    class="w-full h-full flex items-center justify-center overflow-hidden {$scaleVal > 1 ? 'cursor-move' : ''}"
                on:wheel|nonpassive={handleWheel}
                on:mousedown={startDrag}
                on:mousemove={onDrag}
                on:mouseup={endDrag}
                on:mouseleave={endDrag}
                on:touchstart|nonpassive={handleTouchStart}
                on:touchmove|nonpassive={handleTouchMove}
                on:touchend={endDrag}
			    on:dblclick={(e) => handleDoubleTap(e.clientX, e.clientY)}
			    on:click|self={handleBackgroundClick}
            >
                <div 
                    class="w-full h-full flex items-center justify-center origin-center will-change-transform"
                    style="transform: translate3d({$translateX}px, {$translateY}px, 0) scale({$scaleVal}); will-change: transform;"
                    in:scale={{ start: 0.9, duration: 300, easing: cubicOut }}
                    on:click|self={handleBackgroundClick}
                >
                    <!-- Tightly wrapped container ensures absolute percentage math perfectly matches the image -->
                    <div class="relative inline-flex max-w-full max-h-full shadow-2xl duration-300 ease-out {photo?.box ? 'overflow-hidden rounded-xl' : ''}" style="transform: rotate({rotation}deg);">
                        <img 
                            src="{(showOriginal ? photo?.orgPath : (photo?.cropPath || photo?.orgPath)) + (photo?.updatedAt ? '?v=' + new Date(photo.updatedAt).getTime() : '')}"
                            alt="Product preview" 
                            class="object-contain max-w-full max-h-full origin-center select-none"
                            id="lightbox-active-media"
                            draggable="false"
                        />
                    {#if photo?.box}
                        {@const hlStyle = getHighlightStyle(photo.box)}
                        {#if hlStyle}
                            <!-- The massive box-shadow dims everything OUTSIDE the bounding box -->
                            <div class="absolute border-4 border-primary z-10 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.8)]"
                                 style={hlStyle}>
                                <!-- Inner pulsing reticle -->
                                <div class="absolute inset-0 border-2 border-white/60 animate-pulse"></div>
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>

        <!-- Footer (Controls & Swatches) -->
        {/if}
        <div class="absolute bottom-0 inset-x-0 p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-50 pointer-events-none">
            
            <!-- Color Swatches -->
            <div class="flex gap-2 pointer-events-auto">
                {#each cols as col, i}
                    <div class="tooltip tooltip-top" data-tip="{colNames[i]}">
                        <div class="w-8 h-8 rounded-full border border-white/30 shadow-lg" style="background-color: {col};"></div>
                    </div>
                {/each}
            </div>

            <!-- Toolbar Controls -->
            <div class="flex items-center gap-1 sm:gap-4 bg-white/10 backdrop-blur-xl p-1.5 rounded-full border border-white/20 shadow-xl pointer-events-auto max-w-full overflow-x-auto hide-scrollbar">
                
                <!-- Segmented Control for Cutout/Original -->
                {#if photo?.cropPath && photo?.type === "product"}
                    <div class="flex bg-black/40 rounded-full p-1 relative">
                        <button 
                            class="relative z-10 px-4 py-1.5 text-sm font-semibold rounded-full transition-colors duration-200 {showOriginal ? 'text-white/60 hover:text-white' : 'text-black'}" 
                            on:click={() => showOriginal = false}
                        >
                            Cutout
                        </button>
                        <button 
                            class="relative z-10 px-4 py-1.5 text-sm font-semibold rounded-full transition-colors duration-200 {showOriginal ? 'text-black' : 'text-white/60 hover:text-white'}" 
                            on:click={() => showOriginal = true}
                        >
                            Original
                        </button>
                        <!-- Active Pill Background -->
                        <div 
                            class="absolute top-1 bottom-1 w-[calc(50%-0.25rem)] bg-white rounded-full shadow duration-300 ease-out"
                        style="transform: translate3d({showOriginal ? 'calc(100% + 0.25rem)' : '0'}, 0, 0);"
                        ></div>
                    </div>
                {/if}

                <!-- Tools (Rotate & Zoom) -->
                <div class="flex items-center gap-1 px-2 text-white/80">
                    <button class="btn btn-circle btn-sm btn-ghost hover:bg-white/20 hover:text-white border-none" on:click={rotateLeft} aria-label="Rotate Left"><i class="bi bi-arrow-counterclockwise"></i></button>
                    <button class="btn btn-circle btn-sm btn-ghost hover:bg-white/20 hover:text-white border-none" on:click={rotateRight} aria-label="Rotate Right"><i class="bi bi-arrow-clockwise"></i></button>
                    
                    <div class="w-px h-4 bg-white/20 mx-1 hidden sm:block"></div>
                    
					<button class="hidden sm:inline-flex btn btn-circle btn-sm btn-ghost hover:bg-white/20 hover:text-white border-none" on:click={() => zoomTo($scaleVal - 0.5, window.innerWidth / 2, window.innerHeight / 2)} aria-label="Zoom Out"><i class="bi bi-zoom-out"></i></button>
                    <button class="hidden sm:inline-flex btn btn-circle btn-sm btn-ghost hover:bg-white/20 hover:text-white border-none" on:click={resetZoom} aria-label="Reset"><i class="bi bi-arrows-collapse"></i></button>
					<button class="hidden sm:inline-flex btn btn-circle btn-sm btn-ghost hover:bg-white/20 hover:text-white border-none" on:click={() => zoomTo($scaleVal + 0.5, window.innerWidth / 2, window.innerHeight / 2)} aria-label="Zoom In"><i class="bi bi-zoom-in"></i></button>
                     <!-- Mobile close button inside the toolbar to prevent overlap -->
                     <button class="sm:hidden btn btn-circle btn-sm btn-ghost bg-white/20 text-white border-none ml-1" on:click={() => close()} aria-label="Close"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
        </div>

    </div>
{/if}

<PromptModal bind:this={promptModal} />
