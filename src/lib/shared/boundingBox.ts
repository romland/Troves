export function parseBoundingBox(boxRaw: any): [number, number][] | null {
    if (!boxRaw) return null;
    try {
        let box = typeof boxRaw === 'string' ? JSON.parse(boxRaw) : boxRaw;
        
        if (Array.isArray(box)) {
            // Unwrap hallucinated single-array wraps: [[ymin, xmin, ymax, xmax]]
            if (box.length === 1 && Array.isArray(box[0]) && box[0].length === 4 && typeof box[0][0] === 'number') {
                box = box[0];
            }

            // Backwards compatibility / Flat array handling [ymin, xmin, ymax, xmax]
            if (box.length === 4 && typeof box[0] === 'number') {
                const ymin = Number(box[0]);
                const xmin = Number(box[1]);
                const ymax = Number(box[2]);
                const xmax = Number(box[3]);
                return [
                    [xmin, ymin], // Top-Left
                    [xmax, ymin], // Top-Right
                    [xmax, ymax], // Bottom-Right
                    [xmin, ymax]  // Bottom-Left
                ];
            }

            // Handle the NEW 4-point polygon format: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            if (box.length >= 4 && Array.isArray(box[0])) {
                return box.slice(0, 4).map((p: any[]) => [Number(p[0]) || 0, Number(p[1]) || 0]);
            }
        }
        
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

export function getCropStyle(boxRaw: any, padding: number = 25): string {
    const metrics = getBoxMetrics(boxRaw, padding);
    if (!metrics) return "";
    return `width: ${100000 / metrics.w}%; height: ${100000 / metrics.h}%; left: -${(metrics.xmin / metrics.w) * 100}%; top: -${(metrics.ymin / metrics.h) * 100}%;`;
}

export function getHighlightStyle(boxRaw: any): string {
    const metrics = getBoxMetrics(boxRaw, 0);
    if (!metrics) return "";
    return `top: ${metrics.ymin / 10}%; left: ${metrics.xmin / 10}%; width: ${(metrics.w) / 10}%; height: ${(metrics.h) / 10}%;`;
}
