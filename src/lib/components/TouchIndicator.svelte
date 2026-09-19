<script lang="ts">
	let { enabled = false } = $props<{ enabled?: boolean }>();
	
	type Touch = {
		id: string;
		x: number;
		y: number;
		targetX: number;
		targetY: number;
		startX: number;
		startY: number;
		angle: number;
		stretchX: number;
		stretchY: number;
		pressing: boolean;
		swiping: boolean;
		fading: boolean;
	};
	
	type ClickParticle = {
		id: string;
		x: number;
		y: number;
		label: string;
	};
	
	let touches = $state<Touch[]>([]);
	let particles = $state<ClickParticle[]>([]);$effect(() => {
		if (!enabled) {
			touches = [];
			particles = [];
			return;
		}
		
		const handleStart = (id: string, x: number, y: number) => {
			if (!touches.find(t => t.id === id)) {
				touches.push({
					id, x, y, 
					targetX: x, targetY: y,
					startX: x, startY: y,
					angle: 0, stretchX: 1, stretchY: 1,
					pressing: true, swiping: false, fading: false
				});
			}
		};
		
		const handleMove = (id: string, x: number, y: number) => {
			const touch = touches.find(t => t.id === id);
			if (touch) {
				touch.targetX = x;
				touch.targetY = y;
			}
		};
		
		const handleEnd = (id: string) => {
			const touch = touches.find(t => t.id === id);
			if (touch && !touch.fading) {
				touch.pressing = false;
				touch.swiping = false;
				touch.fading = true;
				
				setTimeout(() => {
					touches = touches.filter(t => t.id !== id);
				}, 600); // Increased so the user's eye can follow the release
			}
		};
		
		let rafId: number;
		const tick = () => {
			for (let i = 0; i < touches.length; i++) {
				const touch = touches[i];
				
				const dx = touch.targetX - touch.x;
				const dy = touch.targetY - touch.y;
				
				// Lower lerp (0.15) creates the heavy "chase" lag you need for video demos
				const lerp = 0.15;
				touch.x += dx * lerp;
				touch.y += dy * lerp;
				
				if (touch.fading) continue; // Keep lerping while fading, but stop math updates
				
				const velocity = Math.hypot(dx * lerp, dy * lerp);
				
				if (!touch.swiping && Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > 10) {
					touch.swiping = true;
					touch.pressing = false; 
				}
				
				if (touch.swiping) {
					// Update angle only if moving intentionally
					if (velocity > 0.1) {
						const targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
						let diff = targetAngle - (touch.angle % 360);
						if (diff > 180) diff -= 360;
						if (diff < -180) diff += 360;
						touch.angle += diff * 0.8; // Smooth angle tracking
					}
					
					// Dramatic tail stretching based on the slower velocity
					touch.stretchX = 1 + Math.min(velocity / 5, 2.5); 
					touch.stretchY = Math.max(0.3, 1 - (velocity / 12));
				} else {
					// Spring back to a perfect circle smoothly when resting
					touch.stretchX += (1 - touch.stretchX) * 0.2;
					touch.stretchY += (1 - touch.stretchY) * 0.2;
				}
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		
		let isTouchDevice = false; 
		const onTouchStart = (e: TouchEvent) => {
			isTouchDevice = true;
			for (let i = 0; i < e.changedTouches.length; i++) {
				const t = e.changedTouches[i];
				handleStart(`touch-${t.identifier}`, t.clientX, t.clientY);
			}
		};
		const onTouchMove = (e: TouchEvent) => {
			for (let i = 0; i < e.changedTouches.length; i++) {
				const t = e.changedTouches[i];
				handleMove(`touch-${t.identifier}`, t.clientX, t.clientY);
			}
		};
		const onTouchEnd = (e: TouchEvent) => {
			for (let i = 0; i < e.changedTouches.length; i++) {
				const t = e.changedTouches[i];
				handleEnd(`touch-${t.identifier}`);
			}
		};
		
		let isMouseDown = false;
		let activeMouseId: string | null = null;
		
		const onMouseDown = (e: MouseEvent) => {
			if (isTouchDevice) return;
			isMouseDown = true;
			// Unique ID per click allows rapid clicking while old traces fade out
			activeMouseId = `mouse-${Date.now()}`;
			handleStart(activeMouseId, e.clientX, e.clientY);
			
			// Spawn the click particle
			const id = `click-${Date.now()}-${Math.random()}`;
			const label = e.button === 2 ? 'Right' : (e.button === 1 ? 'Middle' : 'Left');
			particles.push({ id, x: e.clientX, y: e.clientY, label });
			setTimeout(() => {
				particles = particles.filter(p => p.id !== id);
			}, 600);
		};
		const onMouseMove = (e: MouseEvent) => {
			if (isMouseDown && !isTouchDevice && activeMouseId) handleMove(activeMouseId, e.clientX, e.clientY);
		};
		const onMouseUp = () => {
			if (isTouchDevice) return;
			isMouseDown = false;
			if (activeMouseId) handleEnd(activeMouseId);
			activeMouseId = null;
		};
		
		window.addEventListener('touchstart', onTouchStart, { passive: true });
		window.addEventListener('touchmove', onTouchMove, { passive: true });
		window.addEventListener('touchend', onTouchEnd);
		window.addEventListener('touchcancel', onTouchEnd);
		
		window.addEventListener('mousedown', onMouseDown);
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		
		return () => {
			window.removeEventListener('touchstart', onTouchStart);
			window.removeEventListener('touchmove', onTouchMove);
			window.removeEventListener('touchend', onTouchEnd);
			window.removeEventListener('touchcancel', onTouchEnd);
			window.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			cancelAnimationFrame(rafId);
		};
	});
</script>

{#if enabled}
	{#each particles as p (p.id)}
		<div class="demo-click-particle" style="left: {p.x}px; top: {p.y}px;">
			<span class="px-2 py-1 rounded-full bg-black/70 text-white backdrop-blur-md shadow-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border border-white/10">
				<i class="bi {p.label === 'Right' ? 'bi-mouse3' : 'bi-mouse'}"></i> {p.label} Click
			</span>
		</div>
	{/each}

	{#each touches as touch (touch.id)}
		<div
			class="demo-touch-indicator"
			class:pressing={touch.pressing}
			class:swiping={touch.swiping}
			class:fading={touch.fading}
			style="
				left: {touch.x}px; 
				top: {touch.y}px;
				--angle: {touch.angle}deg;
				--stretch-x: {touch.stretchX};
				--stretch-y: {touch.stretchY};
			"
		></div>
	{/each}
{/if}

<style>
	.demo-touch-indicator {
		position: fixed;
		width: 60px;
		height: 60px;
		background: rgba(255, 255, 255, 0.6); /* More visible */
		border-radius: 50%;
		
		/* We use CSS variables for dynamic stretching! */
		transform: translate(-50%, -50%) rotate(var(--angle, 0deg)) translateX(0px) scaleX(1) scaleY(1);
		
		pointer-events: none; 
		z-index: 2147483647; 
		transition: transform 0.15s cubic-bezier(0.17, 0.67, 0.83, 0.67), 
		opacity 0.6s ease-out, /* Slower fade to stick around */
		background 0.15s, 
		border 0.15s;
	}
	
	.demo-click-particle {
		position: fixed;
		pointer-events: none;
		z-index: 2147483647;
		transform: translate(-50%, -50%);
		animation: float-up-fade 0.6s cubic-bezier(0.17, 0.67, 0.2, 1) forwards;
	}

	@keyframes float-up-fade {
		0% { opacity: 0; transform: translate(-50%, -5px) scale(0.8); }
		20% { opacity: 1; transform: translate(-50%, -20px) scale(1.1); }
		100% { opacity: 0; transform: translate(-50%, -50px) scale(0.9); }
	}

	/* TAP STATE: Ignore angle, just shrink */
	.pressing {
		transform: translate(-50%, -50%) rotate(0deg) translateX(0px) scaleX(0.6) scaleY(0.6);
		background: rgba(255, 255, 255, 0.7);
		border: 2px solid rgba(0, 0, 0, 0.2);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(2px);
	}
	
	/* SWIPE STATE: Apply the math variables */
	.swiping {
		/* Base scale is 1.1. */
		transform: translate(-50%, -50%) rotate(var(--angle)) scaleX(calc(1.1 * var(--stretch-x))) scaleY(calc(1.1 * var(--stretch-y)));
		
		/* CSS transforms disabled so the physics loop has full physical control */
		transition: opacity 0.6s ease-out, background 0.15s, border 0.15s; /* Slower fade to stick around */
		
		background: rgba(255, 255, 255, 0.28); /* More visible during swipe */
		border: 2px solid transparent;
		box-shadow: none;
		backdrop-filter: none;
	}
	
	.fading {
		opacity: 0;
		transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0px) scaleX(1.1) scaleY(1.1);
	}
</style>