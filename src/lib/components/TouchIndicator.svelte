<script lang="ts">
	let { enabled = false } = $props<{ enabled?: boolean }>();
	
	type Touch = {
		id: string;
		x: number;
		y: number;
		startX: number;
		startY: number;
		prevX: number;
		prevY: number;
		angle: number;
		stretchX: number;
		stretchY: number;
		pressing: boolean;
		swiping: boolean;
		fading: boolean;
		moveTimeout?: ReturnType<typeof setTimeout>;
	};
	
	let touches = $state<Touch[]>([]);
	
	$effect(() => {
		if (!enabled) {
			touches = [];
			return;
		}
		
		const handleStart = (id: string, x: number, y: number) => {
			if (!touches.find(t => t.id === id)) {
				touches.push({
					id, x, y, 
					startX: x, startY: y,
					prevX: x, prevY: y,
					angle: 0, stretchX: 1, stretchY: 1,
					pressing: true, swiping: false, fading: false
				});
			}
		};
		
		const handleMove = (id: string, x: number, y: number) => {
			const touch = touches.find(t => t.id === id);
			if (touch) {
				touch.x = x;
				touch.y = y;
				
				// Calculate total distance from where they first touched down
				if (!touch.swiping) {
					const totalDistance = Math.hypot(touch.x - touch.startX, touch.y - touch.startY);
					if (totalDistance > 10) {
						touch.swiping = true;
						touch.pressing = false; 
					}
				}
				
				// If they are swiping, calculate the elasticity
				if (touch.swiping) {
					const dx = x - touch.prevX;
					const dy = y - touch.prevY;
					
					// Only update angle/stretch if they actually moved coordinates
					if (dx !== 0 || dy !== 0) {
						// Speed = distance moved between this frame and the last frame
						const velocity = Math.hypot(dx, dy);
            
            // 1. Prevent micro-jitter: Only update angle if moving intentionally
            if (velocity > 1.5) {
              const rawAngle = Math.atan2(dy, dx) * (180 / Math.PI);
              // 2. Unwind CSS rotation: Prevent 360-degree backflips crossing the left axis
              let diff = rawAngle - (touch.angle % 360);
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              touch.angle += diff;
            }
						
						// Squash & Stretch Math: Max stretch of 2.2x, Max squish of 0.4x (High Velocity)
						touch.stretchX = 1 + Math.min(velocity / 8, 1.2); 
						touch.stretchY = 1 - Math.min(velocity / 20, 0.6);
						
						// If they hold their finger still, snap back to a perfect circle
						if (touch.moveTimeout) clearTimeout(touch.moveTimeout);
						touch.moveTimeout = setTimeout(() => {
							const t = touches.find(t => t.id === id);
							if (t) {
								t.stretchX = 1;
								t.stretchY = 1;
							}
						}, 80); 
					}
				}
				
				touch.prevX = x;
				touch.prevY = y;
			}
		};
		
		const handleEnd = (id: string) => {
			const touch = touches.find(t => t.id === id);
			if (touch && !touch.fading) {
				if (touch.moveTimeout) clearTimeout(touch.moveTimeout);
				
				touch.pressing = false;
				touch.swiping = false;
				touch.fading = true;
				
				setTimeout(() => {
					touches = touches.filter(t => t.id !== id);
				}, 200);
			}
		};
		
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
		const onMouseDown = (e: MouseEvent) => {
			if (isTouchDevice) return;
			isMouseDown = true;
			handleStart('mouse', e.clientX, e.clientY);
		};
		const onMouseMove = (e: MouseEvent) => {
			if (isMouseDown && !isTouchDevice) handleMove('mouse', e.clientX, e.clientY);
		};
		const onMouseUp = () => {
			if (isTouchDevice) return;
			isMouseDown = false;
			handleEnd('mouse');
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
		};
	});
</script>

{#if enabled}
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
		background: rgba(255, 255, 255, 0.4);
		border-radius: 50%;
		
		/* We use CSS variables for dynamic stretching! */
		transform: translate(-50%, -50%) rotate(var(--angle, 0deg)) translateX(0px) scaleX(1) scaleY(1);
		
		pointer-events: none; 
		z-index: 2147483647; 
		transition: transform 0.15s cubic-bezier(0.17, 0.67, 0.83, 0.67), 
		opacity 0.2s ease-out, 
		background 0.15s, 
		border 0.15s;
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
		/* Base scale is 1.1. We shift the X axis backwards based on the stretch so the cursor pulls the leading edge */
		transform: translate(-50%, -50%) rotate(var(--angle)) translateX(calc(-60px * (var(--stretch-x) - 1))) scaleX(calc(1.1 * var(--stretch-x))) scaleY(calc(1.1 * var(--stretch-y)));
		
		/* We use a much faster transition here so the rotation tracks your finger instantly without "wobbling" */
		transition: transform 0.05s linear, background 0.15s, border 0.15s;
		
		background: rgba(255, 255, 255, 0.15);
		border: 2px solid transparent;
		box-shadow: none;
		backdrop-filter: none;
	}
	
	.fading {
		opacity: 0;
		transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0px) scaleX(1.3) scaleY(1.3);
	}
</style>