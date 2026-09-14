/**
 * This module replaces heavy OpenCV/Python sandbox dependencies. It utilizes FAST 
 * (Features from Accelerated Segment Test) for corner detection and BRIEF (Binary 
 * Robust Independent Elementary Features) for descriptors. 
 * 
 * To avoid melting the CPU compared to the POC, we swapped out SIFT for FAST
 * (Features from Accelerated Segment Test) and BRIEF (Binary Robust Independent 
 * Elementary Features).
 * 
 * SIFT relies heavily on building Gaussian pyramids and computing floating-point 
 * gradients, which is computationally devastating in pure JavaScript. FAST + BRIEF, 
 * on the other hand, operates almost entirely on simple pixel thresholding and 32-bit 
 * integer bitwise operations (XOR). V8's JIT compiler will optimize bitwise matching 
 * to near-native C++ speeds.
 * 
 * This will allow us to compute Homography (perspective distortion) natively in Node.js
 * in under 500ms without IPC latency or WASM bundle bloat.
 */
import sharp from 'sharp';

export interface KeyPoint { x: number; y: number; score: number; }
export interface Match { queryIdx: number; trainIdx: number; distance: number; }

// ============================================================================
// DETERMINISTIC PRNG & GAUSSIAN DISTRIBUTION FOR BRIEF
// ============================================================================

/**
 * Linear Congruential Generator (LCG).
 * Ensures our BRIEF pattern generation is 100% deterministic across server restarts.
 */
function lcg(seed: number) {
    return function() {
        seed = Math.imul(seed, 1664525) + 1013904223 | 0;
        return (seed >>> 0) / 4294967296;
    }
}
const rand = lcg(42);

/** Generate numbers with a Gaussian distribution using Box-Muller transform */
function randnBM() {
    let u = 0, v = 0;
    while(u === 0) u = rand();
    while(v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Pre-compute the BRIEF spatial pattern (256 pairs of coordinates)
const BRIEF_PATTERN: number[][] = [];
const SIGMA = 6;
for (let i = 0; i < 256; i++) {
    // Clamp the pattern to a 31x31 patch (radius 15)
    const rx1 = Math.max(-15, Math.min(15, Math.round(randnBM() * SIGMA)));
    const ry1 = Math.max(-15, Math.min(15, Math.round(randnBM() * SIGMA)));
    const rx2 = Math.max(-15, Math.min(15, Math.round(randnBM() * SIGMA)));
    const ry2 = Math.max(-15, Math.min(15, Math.round(randnBM() * SIGMA)));
    BRIEF_PATTERN.push([rx1, ry1, rx2, ry2]);
}

// ============================================================================
// FEATURE DETECTION & EXTRACTION
// ============================================================================

/**
 * Detects corners using the FAST algorithm.
 * Evaluates a circle of 16 pixels around a candidate pixel. If at least 12 contiguous 
 * pixels are all significantly brighter or darker than the center, it's a corner.
 */
export function detectFAST(data: Uint8Array, width: number, height: number, threshold: number = 20): KeyPoint[] {
    const keypoints: KeyPoint[] = [];
    const offsets = [
        [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
        [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3]
    ];
    const circle = offsets.map(o => o[1] * width + o[0]);
    const quickIds = [0, 8, 4, 12]; // NSEW points for rapid rejection
    const scores = new Int32Array(width * height);
    
    // Scan inner image to avoid boundary checks
    for (let y = 3; y < height - 3; y++) {
        for (let x = 3; x < width - 3; x++) {
            const ptr = y * width + x;
            const val = data[ptr];
            
            // Fast rejection: Check N, S, E, W. At least 3 must be different.
            let countDark = 0, countBright = 0;
            for (let i = 0; i < 4; i++) {
                const p = data[ptr + circle[quickIds[i]]];
                if (p < val - threshold) countDark++;
                if (p > val + threshold) countBright++;
            }
            if (countDark < 3 && countBright < 3) continue;
            
            // Full circle contiguous test
            let maxDark = 0, maxBright = 0, cDark = 0, cBright = 0, score = 0;
            for (let i = 0; i < 27; i++) { // Loop past 16 to handle wrap-around natively
                const p = data[ptr + circle[i % 16]];
                if (p < val - threshold) {
                    cDark++; cBright = 0;
                    if (cDark > maxDark) maxDark = cDark;
                    score += (val - p);
                } else if (p > val + threshold) {
                    cBright++; cDark = 0;
                    if (cBright > maxBright) maxBright = cBright;
                    score += (p - val);
                } else {
                    cDark = 0; cBright = 0;
                }
            }
            
            if (maxDark >= 12 || maxBright >= 12) scores[ptr] = score;
        }
    }
    
    // Non-Max Suppression: Only keep the strongest corner in a 3x3 neighborhood
    for (let y = 4; y < height - 4; y++) {
        for (let x = 4; x < width - 4; x++) {
            const ptr = y * width + x;
            const score = scores[ptr];
            if (score > 0) {
                let isMax = true;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (scores[(y + dy) * width + (x + dx)] >= score) { isMax = false; break; }
                    }
                    if (!isMax) break;
                }
                if (isMax) keypoints.push({ x, y, score });
            }
        }
    }
    
    // Sort by strength and cap to prevent CPU starvation on high-texture surfaces
    keypoints.sort((a, b) => b.score - a.score);
    return keypoints.slice(0, 3000); 
}

/**
 * Extracts a 256-bit (32-byte) binary signature for each KeyPoint.
 * Does this by comparing the intensity of pixel pairs in the pre-computed pattern.
 */
export function computeBRIEF(data: Uint8Array, width: number, height: number, keypoints: KeyPoint[]): Uint32Array[] {
    const descriptors: Uint32Array[] = [];
    const PATCH_SIZE = 16;
    
    for (const kp of keypoints) {
        // Discard points too close to the edge to fit the patch
        if (kp.x < PATCH_SIZE || kp.y < PATCH_SIZE || kp.x >= width - PATCH_SIZE || kp.y >= height - PATCH_SIZE) {
            descriptors.push(new Uint32Array(8)); // Dummy empty descriptor
            continue;
        }
        const desc = new Uint32Array(8); // 8 * 32 bits = 256 bits
        for (let i = 0; i < 256; i++) {
            const [dx1, dy1, dx2, dy2] = BRIEF_PATTERN[i];
            const p1 = data[(kp.y + dy1) * width + (kp.x + dx1)];
            const p2 = data[(kp.y + dy2) * width + (kp.x + dx2)];
            // Binary test: If pixel 1 is darker than pixel 2, flip the specific bit to 1
            if (p1 < p2) desc[i >> 5] |= (1 << (i & 31));
        }
        descriptors.push(desc);
    }
    return descriptors;
}

// ============================================================================
// FEATURE MATCHING & RANSAC MATH
// ============================================================================

/** Computes population count (number of set bits) using a fast parallel method */
function popcnt32(n: number) {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return Math.imul((n + (n >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

/**
 * Matches two sets of descriptors using Hamming distance and Lowe's Ratio Test.
 */
export function matchFeatures(desc1: Uint32Array[], desc2: Uint32Array[], ratioTest: number = 0.8, maxDistance: number = 60): Match[] {
    const matches: Match[] = [];
    for (let i = 0; i < desc1.length; i++) {
        const d1 = desc1[i];
        if (d1[0] === 0 && d1[1] === 0) continue; // Skip edge-clamped dummies
        
        let bestDist = 256, secondBestDist = 256, bestIdx = -1;
        
        for (let j = 0; j < desc2.length; j++) {
            const d2 = desc2[j];
            let dist = 0;
            // XOR bits, then count how many 1s resulted (Hamming distance)
            for (let k = 0; k < 8; k++) dist += popcnt32(d1[k] ^ d2[k]);
            
            if (dist < bestDist) {
                secondBestDist = bestDist; bestDist = dist; bestIdx = j;
            } else if (dist < secondBestDist) {
                secondBestDist = dist;
            }
        }
        
        // Lowe's Ratio Test: The best match must be significantly better than the second best.
        // Also cap absolute distance to prevent forcing garbage matches.
        if (bestDist <= secondBestDist * ratioTest && bestDist < maxDistance) {
            matches.push({ queryIdx: i, trainIdx: bestIdx, distance: bestDist });
        }
    }
    return matches;
}

/** Solves a system of equations to find the Homography matrix for exactly 4 points */
function getHomography4Pt(src: number[][], dst: number[][]): number[] | null {
    let A: number[][] = [];
    for (let i = 0; i < 4; i++) {
        let [x, y] = src[i];
        let [u, v] = dst[i];
        A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
        A.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
    }
    // Gaussian Elimination
    for (let i = 0; i < 8; i++) {
        let pivot = i;
        for (let j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
        let temp = A[i]; A[i] = A[pivot]; A[pivot] = temp;
        
        let pVal = A[i][i];
        if (Math.abs(pVal) < 1e-10) return null; // Singular matrix (collinear points)
        for (let k = i; k < 9; k++) A[i][k] /= pVal;
        
        for (let j = 0; j < 8; j++) {
            if (i !== j) {
                let factor = A[j][i];
                for (let k = i; k < 9; k++) A[j][k] -= factor * A[i][k];
            }
        }
    }
    return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1.0];
}

/** Random Sample Consensus (RANSAC) to find the best Homography while ignoring outliers */
export function findHomographyRANSAC(kp1: KeyPoint[], kp2: KeyPoint[], matches: Match[], maxIters: number = 2000, threshold: number = 5.0) {
    if (matches.length < 4) return null;
    let bestInliers = 0;
    let bestH: number[] | null = null;
    
    for (let iter = 0; iter < maxIters; iter++) {
        const src: number[][] = [], dst: number[][] = [];
        const indices = new Set<number>();
        // Pick 4 random distinct matches
        while(indices.size < 4) indices.add(Math.floor(rand() * matches.length));
        
        const idxArr = Array.from(indices);
        const p0 = kp1[matches[idxArr[0]].queryIdx], p1 = kp1[matches[idxArr[1]].queryIdx], p2 = kp1[matches[idxArr[2]].queryIdx];
        
        // Guard: Prevent strictly collinear selections (area of triangle < epsilon)
        const area = Math.abs((p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y)) / 2);
        if (area < 500) continue; 
        
        for (let idx of indices) {
            const m = matches[idx];
            src.push([kp1[m.queryIdx].x, kp1[m.queryIdx].y]);
            dst.push([kp2[m.trainIdx].x, kp2[m.trainIdx].y]);
        }
        
        const H = getHomography4Pt(src, dst);
        if (!H) continue;
        
        // Count inliers that fit this proposed model
        let inliers = 0;
        for (const m of matches) {
            const pt1 = kp1[m.queryIdx], pt2 = kp2[m.trainIdx];
            const w = H[6]*pt1.x + H[7]*pt1.y + H[8];
            if (Math.abs(w) < 1e-6) continue;
            
            const predX = (H[0]*pt1.x + H[1]*pt1.y + H[2]) / w;
            const predY = (H[3]*pt1.x + H[4]*pt1.y + H[5]) / w;
            const errSq = (predX - pt2.x)**2 + (predY - pt2.y)**2;
            
            if (errSq < threshold * threshold) inliers++;
        }
        
        if (inliers > bestInliers) {
            bestInliers = inliers;
            bestH = H;
        }
    }
    
    // We require a mathematically sound baseline of inliers to trust the warp
    if (bestInliers < 12) return null; 
    return bestH;
}

export function warpPolygonHomography(poly: number[][], H: number[]): number[][] {
    const warped = [];
    for (const [x, y] of poly) {
        const w = H[6]*x + H[7]*y + H[8];
        warped.push([(H[0]*x + H[1]*y + H[2]) / w, (H[3]*x + H[4]*y + H[5]) / w]);
    }
    return warped;
}

// ============================================================================
// SANITY GUARDS & VALIDATION
// ============================================================================

/** Prevents self-intersecting or 'bow-tie' polygon warps */
function isConvex(poly: number[][]): boolean {
    if (poly.length < 3) return false;
    let crossProductSign = 0;
    for (let i = 0; i < poly.length; i++) {
        const p0 = poly[i], p1 = poly[(i + 1) % poly.length], p2 = poly[(i + 2) % poly.length];
        const cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
        const sign = Math.sign(cross);
        if (sign !== 0) {
            if (crossProductSign === 0) crossProductSign = sign;
            else if (crossProductSign !== sign) return false;
        }
    }
    return true;
}

/** Computes the absolute area of a 2D polygon */
function polygonArea(poly: number[][]): number {
    let area = 0;
    for(let i = 0; i < poly.length; i++) {
        let j = (i + 1) % poly.length;
        area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    return Math.abs(area / 2.0);
}

// ============================================================================
// MASTER PIPELINE ENTRYPOINT
// ============================================================================

/** Decodes, normalizes, and forces the image to grayscale buffer */
async function extractImageData(imagePath: string, maxDim: number = 1024) {
    const meta = await sharp(imagePath).metadata();
    let width = meta.width || 1024, height = meta.height || 1024;
    
    // Pre-calculate true dimensions post EXIF-orientation
    if (meta.orientation && meta.orientation >= 5) {
        width = meta.height || 1024; height = meta.width || 1024;
    }
    
    const scale = Math.max(width, height) > maxDim ? maxDim / Math.max(width, height) : 1.0;
    const finalWidth = Math.round(width * scale);
    const finalHeight = Math.round(height * scale);
    
    const rawData = await sharp(imagePath)
        .rotate() // Auto-orient
        .resize({ width: finalWidth, height: finalHeight, fit: 'inside' })
        .grayscale()
        .normalize() // Pseudo-CLAHE: Maximizes contrast to expose dark plastic seams
        .blur(0.8) // Defeat WebP compression artifacts that corrupt FAST corners
        .raw()
        .toBuffer();
        
    return { data: new Uint8Array(rawData), width: finalWidth, height: finalHeight, scale, origW: width, origH: height };
}

/**
 * Main public entrypoint. 
 * Takes a baseline photo, a newly skewed photo, and an array of (0-1000) normalized polygons.
 * Returns the polygons mathematically snapped and mapped to the new perspective.
 */
export async function alignPolygonsToNewImage(baselinePath: string, newPath: string, baselinePolygons: number[][][]) {
    const base = await extractImageData(baselinePath);
    const newImg = await extractImageData(newPath);
    
    // Attempt 1: Moderate Tolerance
    let kp1 = detectFAST(base.data, base.width, base.height, 12);
    let kp2 = detectFAST(newImg.data, newImg.width, newImg.height, 12);
    let desc1 = computeBRIEF(base.data, base.width, base.height, kp1);
    let desc2 = computeBRIEF(newImg.data, newImg.width, newImg.height, kp2);
    
    let matches = matchFeatures(desc1, desc2, 0.80, 50);

    // Fallback: If starved for features (poor lighting/blurry), relax the thresholds and try again
    if (matches.length < 20) {
        console.warn(`[CV Pipeline] Strict matching starved (${matches.length} matches). Relaxing constraints...`);
        kp1 = detectFAST(base.data, base.width, base.height, 6);
        kp2 = detectFAST(newImg.data, newImg.width, newImg.height, 6);
        desc1 = computeBRIEF(base.data, base.width, base.height, kp1);
        desc2 = computeBRIEF(newImg.data, newImg.width, newImg.height, kp2);
        matches = matchFeatures(desc1, desc2, 0.92, 90);
    }
    
    if (matches.length < 15) {
        throw new Error(`Found only ${matches.length} structural anchors. Make sure you hold the camera at the same orientation (Landscape/Portrait) as the original map.`);
    }
    
    // Scale keypoints back to absolute Mega-Pixel resolution before solving Homography
    const absKp1 = kp1.map(p => ({ x: p.x / base.scale, y: p.y / base.scale, score: p.score }));
    const absKp2 = kp2.map(p => ({ x: p.x / newImg.scale, y: p.y / newImg.scale, score: p.score }));
    
    // Relaxing the RANSAC pixel threshold from 5.0 to 10.0 allows minor distortions to still fit the model
    const H = findHomographyRANSAC(absKp1, absKp2, matches, 5000, 15.0);
    if (!H) {
        // CV_HOMOGRAPHY_FAILED
        throw new Error("Not enough distinct anchor points matched to align the perspective.");
    }
    
    // Sanity Guard: Check if the Homography folded the image or created a micro-singularity
    const wBase = base.origW, hBase = base.origH, wNew = newImg.origW, hNew = newImg.origH;
    const warpedCorners = warpPolygonHomography([[0,0], [wBase, 0], [wBase, hBase], [0, hBase]], H);
    
    if (!isConvex(warpedCorners)) {
        // CV_GEOMETRY_ERROR
        throw new Error("Homography folded the geometry (Pretzel Warp).");
    }
    
    const area = polygonArea(warpedCorners);
    if (area < (wNew * hNew * 0.05) || area > (wNew * hNew * 5.0)) {
        // CV_SCALE_ERROR
        throw new Error(`Improbable warped area ratio. (${area})`);
    }
    
    // Everything is sane. Warp the actual compartment polygons.
    const warpedNormalized: number[][][] = [];
    for (const poly of baselinePolygons) {
        // Convert DB (0-1000) norm -> Baseline Absolute -> Warp -> New Absolute -> New (0-1000) norm
        const absPoly = poly.map(pt => [(pt[0] / 1000.0) * wBase, (pt[1] / 1000.0) * hBase]);
        const wPoly = warpPolygonHomography(absPoly, H);
        warpedNormalized.push(wPoly.map(pt => [(pt[0] / wNew) * 1000.0, (pt[1] / hNew) * 1000.0]));
    }
    
    return warpedNormalized;
}