export function getSharedEdges(polys: number[][][]) {
    if (!polys || polys.length === 0) return [];
    const edges = [];
    const threshold = 2;

    for (let i = 0; i < polys.length; i++) {
        for (let j = i + 1; j < polys.length; j++) {
            const shared = [];
            const unsharedI = [];
            const unsharedJ = [];
            
            for (let pi = 0; pi < 4; pi++) {
                let isShared = false;
                for (let pj = 0; pj < 4; pj++) {
                    if (Math.abs(polys[i][pi][0] - polys[j][pj][0]) < threshold && Math.abs(polys[i][pi][1] - polys[j][pj][1]) < threshold) {
                        shared.push(polys[i][pi]);
                        isShared = true;
                        break;
                    }
                }
                if (!isShared) unsharedI.push(polys[i][pi]);
            }
            
            for (let pj = 0; pj < 4; pj++) {
                let isShared = false;
                for (let pi = 0; pi < 4; pi++) {
                    if (Math.abs(polys[j][pj][0] - polys[i][pi][0]) < threshold && Math.abs(polys[j][pj][1] - polys[i][pi][1]) < threshold) {
                        isShared = true;
                        break;
                    }
                }
                if (!isShared) unsharedJ.push(polys[j][pj]);
            }

            if (shared.length === 2 && unsharedI.length === 2 && unsharedJ.length === 2) {
                edges.push({ poly1: i, poly2: j, unshared: [...unsharedI, ...unsharedJ], x1: shared[0][0], y1: shared[0][1], x2: shared[1][0], y2: shared[1][1] });
            }
        }
    }
    return edges;
}

export function getIntersections(polys: number[][][]) {
    if (!polys || polys.length === 0) return [];
    const threshold = 2;
    const clusters: { x: number, y: number, points: { pIdx: number, ptIdx: number, pt: number[] }[] }[] = [];

    for (let pIdx = 0; pIdx < polys.length; pIdx++) {
        for (let ptIdx = 0; ptIdx < 4; ptIdx++) {
            const pt = polys[pIdx][ptIdx];
            let found = false;
            for (let c of clusters) {
                if (Math.abs(c.x - pt[0]) < threshold && Math.abs(c.y - pt[1]) < threshold) {
                    c.points.push({ pIdx, ptIdx, pt });
                    found = true;
                    break;
                }
            }
            if (!found) {
                clusters.push({ x: pt[0], y: pt[1], points: [{ pIdx, ptIdx, pt }] });
            }
        }
    }
    return clusters.filter(c => c.points.length === 4);
}

export function calculateMergedEdge(edge: any, currentPolygons: number[][][]) {
    const outerPoints = [...edge.unshared];
    const cx = outerPoints.reduce((sum: number, p: number[]) => sum + p[0], 0) / 4;
    const cy = outerPoints.reduce((sum: number, p: number[]) => sum + p[1], 0) / 4;
    outerPoints.sort((a: number[], b: number[]) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    
    const nextPolygons = currentPolygons.filter((_, idx) => idx !== edge.poly1 && idx !== edge.poly2);
    nextPolygons.push(outerPoints);
    return { polygons: nextPolygons, activeIndex: nextPolygons.length - 1 };
}

export function calculateSplitCell(idx: number, mode: 'v' | 'h' | 'q', currentPolygons: number[][][]) {
    const nextPolygons = [...currentPolygons];
    const poly = nextPolygons[idx];
    const p0 = poly[0], p1 = poly[1], p2 = poly[2], p3 = poly[3];

    const mTop = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const mBot = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
    const mRight = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const mLeft = [(p3[0] + p0[0]) / 2, (p3[1] + p0[1]) / 2];
    const c = [(p0[0] + p1[0] + p2[0] + p3[0]) / 4, (p0[1] + p1[1] + p2[1] + p3[1]) / 4];

    nextPolygons.splice(idx, 1);

    if (mode === 'v') {
        nextPolygons.push([p0, mTop, mBot, p3], [mTop, p1, p2, mBot]);
    } else if (mode === 'h') {
        nextPolygons.push([p0, p1, mRight, mLeft], [mLeft, mRight, p2, p3]);
    } else if (mode === 'q') {
        nextPolygons.push([p0, mTop, c, mLeft], [mTop, p1, mRight, c], [c, mRight, p2, mBot], [mLeft, c, mBot, p3]);
    }

    return { polygons: nextPolygons };
}

export function calculateMergedIntersection(intersection: any, currentPolygons: number[][][]) {
    const polyIndicesToRemove = intersection.points.map((p: any) => p.pIdx);
    const polysToRemove = polyIndicesToRemove.map((i: number) => currentPolygons[i]);
    
    const allPoints: number[][] = [];
    polysToRemove.forEach((poly: number[][]) => { poly.forEach((pt: number[]) => allPoints.push(pt)); });
    
    const outerPoints: number[][] = [];
    for (let i = 0; i < allPoints.length; i++) {
        const pt1 = allPoints[i];
        let count = 0;
        for (let j = 0; j < allPoints.length; j++) {
            const pt2 = allPoints[j];
            if (Math.abs(pt1[0] - pt2[0]) < 2 && Math.abs(pt1[1] - pt2[1]) < 2) count++;
        }
        if (count === 1) outerPoints.push(pt1);
    }
    
    if (outerPoints.length === 4) {
        const cx = outerPoints.reduce((sum, p) => sum + p[0], 0) / 4;
        const cy = outerPoints.reduce((sum, p) => sum + p[1], 0) / 4;
        outerPoints.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
        
        const nextPolygons = currentPolygons.filter((_, idx) => !polyIndicesToRemove.includes(idx));
        nextPolygons.push(outerPoints);
        return { polygons: nextPolygons, activeIndex: nextPolygons.length - 1 };
    }
    
    return null;
}