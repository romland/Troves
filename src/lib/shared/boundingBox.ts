export function parseBoundingBox(boxRaw: any): [number, number][] | null {
    if (!boxRaw) return null;
    try {
        let box = typeof boxRaw === 'string' ? JSON.parse(boxRaw) : boxRaw;
        
        // Handle object format: {ymin, xmin, ymax, xmax}
        if (typeof box === 'object' && box !== null && !Array.isArray(box)) {
            if ('ymin' in box && 'xmin' in box && 'ymax' in box && 'xmax' in box) {
                const ymin = Number(box.ymin);
                const xmin = Number(box.xmin);
                const ymax = Number(box.ymax);
                const xmax = Number(box.xmax);
                return [
                    [xmin, ymin],
                    [xmax, ymin],
                    [xmax, ymax],
                    [xmin, ymax]
                ];
            }
        }

        if (Array.isArray(box)) {
            // LLMs hallucinate bracket depth constantly. 
            // Flatten everything into a 1D array to reliably extract the raw numbers.
            const nums = box.flat(Infinity).map(Number).filter(n => !isNaN(n));
            
            // If we got exactly 8 numbers, it's 4 [x,y] points 
            // (Works even if the LLM grouped them weirdly like [[x,y,x,y], [x,y,x,y]])
            if (nums.length === 8) {
                return [
                    [nums[0], nums[1]],
                    [nums[2], nums[3]],
                    [nums[4], nums[5]],
                    [nums[6], nums[7]]
                ];
            }
            
            // If we got exactly 4 numbers, assume legacy flat format [ymin, xmin, ymax, xmax]
            if (nums.length === 4) {
                return [
                    [nums[1], nums[0]], // Top-Left
                    [nums[3], nums[0]], // Top-Right
                    [nums[3], nums[2]], // Bottom-Right
                    [nums[1], nums[2]]  // Bottom-Left
                ];
            }
        }
        
    } catch (e) {
        console.warn("[boundingBox] Failed to parse box:", boxRaw, e);
    }
    return null;
}

export function getBoxMetrics(boxRaw: any, padding: number = 0) {
    const box = parseBoundingBox(boxRaw);
    if (!box) return null;

    const xs = box.map(p => p[0]);
    const ys = box.map(p => p[1]);
    
    const xmin = Math.max(0, Math.min(...xs) - padding);
    const ymin = Math.max(0, Math.min(...ys) - padding);
    const xmax = Math.min(1000, Math.max(...xs) + padding);
    const ymax = Math.min(1000, Math.max(...ys) + padding);
    
    const w = Math.max(1, xmax - xmin);
    const h = Math.max(1, ymax - ymin);

    return { xmin, ymin, xmax, ymax, w, h };
}

export function getCropStyles(boxRaw: any, padding: number = 25) {
    const metrics = getBoxMetrics(boxRaw, padding);
    if (!metrics) return null;

    const cx = (metrics.xmin + metrics.w / 2) / 10;
    const cy = (metrics.ymin + metrics.h / 2) / 10;
    
    // Zoom to fit the bounding box within the container (simulating object-fit: contain).
    // Using Math.max ensures the largest relative dimension of the box fits the container.
    const maxDim = Math.max(1, Math.max(metrics.w, metrics.h));
    const zoomFactor = 1000 / maxDim;

    const wrapper = `position: relative; overflow: hidden; width: 100%; height: 100%; min-width: 100%; min-height: 100%; flex-shrink: 0; border-radius: inherit;`;
    const image = `position: absolute; width: ${zoomFactor * 100}%; height: auto; max-width: none; max-height: none; top: 50%; left: 50%; transform: translate(-${cx}%, -${cy}%);`;

    return { wrapper, image };
}

export function getHighlightStyle(boxRaw: any): string {
    const metrics = getBoxMetrics(boxRaw, 0);
    if (!metrics) return "";
    return `top: ${metrics.ymin / 10}%; left: ${metrics.xmin / 10}%; width: ${(metrics.w) / 10}%; height: ${(metrics.h) / 10}%;`;
}
