import fs from 'fs';
import { analyzeImage } from '$lib/server/ai/index';
import { getImageMimeType } from '$lib/server/fsUtils';
import type { TaskContext } from '$lib/server/taskManager';

export interface ContainerMapResult {
    isGrid: boolean;
    compartments: number[][][];
    warpMap?: { cols: number, rows: number, corners: number[][] };
}

function createProjector(src: number[][], dst: number[][]) {
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
        for (let j = i + 1; j < 8; j++) {
            if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
        }
        
        let temp = A[i]; 
        A[i] = A[pivot]; 
        A[pivot] = temp;
        
        let pVal = A[i][i];
        for (let k = i; k < 9; k++) A[i][k] /= pVal;
        
        for (let j = 0; j < 8; j++) {
            if (i !== j) {
                let factor = A[j][i];
                for (let k = i; k < 9; k++) A[j][k] -= factor * A[i][k];
            }
        }
    }
    
    let h = A.map(row => row[8]);
    
    return function project(col: number, row: number) {
        let w = (h[6] * col) + (h[7] * row) + 1;
        let px = ((h[0] * col) + (h[1] * row) + h[2]) / w;
        let py = ((h[3] * col) + (h[4] * row) + h[5]) / w;
        return [px, py];
    };
}

export async function mapContainerCompartments(localFilePath: string, tracking?: TaskContext): Promise<ContainerMapResult | null> {
    console.log(`[DEBUG-MAPPER] Starting mapContainerCompartments for ${localFilePath}`);
    const fileBuffer = fs.readFileSync(localFilePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = getImageMimeType(localFilePath);

    const promptText = `Analyze this top-down photo of a physical storage container (e.g., a drawer, shelf, tackle box, or gridfinity layout).
Your ONLY job is to find the distinct physical compartments/trays.

Extract exactly TWO things:
1. outerCorners: A 4-point polygon tracing the *inner rim* of the drawer/box that contains the slots. This provides the true macroscopic perspective plane. Order: Top-Left, Top-Right, Bottom-Right, Bottom-Left.
2. compartments: The 4-point bounding boxes for the INNER usable area of EVERY single compartment.

Rules:
- Coordinates must be normalized from 0 to 1000.
- If there are no internal compartments (just a single open box), set isGrid to false.
- YOU MUST INCLUDE PARTIAL COMPARTMENTS: If a compartment is partially obscured by the drawer lip or cut off by the photo edge, draw a bounding box for the visible portion.
- Ensure you capture perspective skew (the boxes do not need to be perfectly rectangular).
`;

    const jsonSchema = { 
        type: 'object', 
        properties: { 
            isGrid: { type: 'boolean' }, 
            outerCorners: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description: 'Exactly 4 points [[x,y], [x,y], [x,y], [x,y]] outlining the inner rim of the overall box.'
            },
            compartments: { 
                type: 'array', 
                items: { 
                    type: 'array', 
                    items: { type: 'array', items: { type: 'number' } },
                    description: 'Exactly 4 points [[x,y], [x,y], [x,y], [x,y]] outlining each individual compartment.'
                } 
            } 
        }, 
        required: ['isGrid', 'outerCorners', 'compartments'] 
    };

    try {
        console.log(`[DEBUG-MAPPER] Sending request to vision model...`);
        const rawText = await analyzeImage(promptText, mimeType, base64Data, true, jsonSchema, 'Container Compartment Mapping', tracking, 'MULTISCAN');
        const aiResult = JSON.parse(rawText);
        
        console.log(`[DEBUG-MAPPER] Vision Result received. isGrid: ${aiResult.isGrid}, outerCorners length: ${aiResult.outerCorners?.length}, compartments length: ${aiResult.compartments?.length}`);
        console.log(`[DEBUG-MAPPER] RAW vision outerCorners:`, JSON.stringify(aiResult.outerCorners));

        if (!aiResult.isGrid || !aiResult.outerCorners || aiResult.outerCorners.length !== 4 || !aiResult.compartments || aiResult.compartments.length === 0) {
            console.log(`[DEBUG-MAPPER] Not a valid grid or missing data. Returning raw compartments or empty.`);
            return { isGrid: false, compartments: aiResult.compartments || [] };
        }

        const flatSquare = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
        const projectToFlat = createProjector(aiResult.outerCorners, flatSquare);
        
        console.log(`[DEBUG-MAPPER] Homography mapped outerCorners to flat 1000x1000.`);

        let flatCentersX: number[] = [];
        let flatCentersY: number[] = [];

        aiResult.compartments.forEach((comp: number[][]) => {
            const cx = (comp[0][0] + comp[1][0] + comp[2][0] + comp[3][0]) / 4;
            const cy = (comp[0][1] + comp[1][1] + comp[2][1] + comp[3][1]) / 4;
            const flatCenter = projectToFlat(cx, cy);
            console.log(`[DEBUG-MAPPER] Compartment raw center: [${cx.toFixed(2)}, ${cy.toFixed(2)}] -> Flat center: [${flatCenter[0].toFixed(2)}, ${flatCenter[1].toFixed(2)}]`);
            
            flatCentersX.push(flatCenter[0]);
            flatCentersY.push(flatCenter[1]);
        });
        
        console.log(`[DEBUG-MAPPER] Extracted and projected ${flatCentersX.length} centers.`);

        let gapXs: number[] = [];
        let gapYs: number[] = [];
        
        for (let i = 0; i < flatCentersX.length; i++) {
            let x1 = flatCentersX[i], y1 = flatCentersY[i];
            let minR = 1000, minB = 1000;
            for (let j = 0; j < flatCentersX.length; j++) {
                if (i === j) continue;
                let dx = flatCentersX[j] - x1;
                let dy = flatCentersY[j] - y1;
                
                // Nearest neighbor to the right (within a generous ~56-degree forward cone to allow diagonal drift)
                if (dx > 20 && Math.abs(dy) < dx * 1.5 && dx < minR) minR = dx;
                // Nearest neighbor below
                if (dy > 20 && Math.abs(dx) < dy * 1.5 && dy < minB) minB = dy;
            }
            if (minR < 1000) gapXs.push(minR);
            if (minB < 1000) gapYs.push(minB);
        }

        gapXs.sort((a, b) => a - b);
        gapYs.sort((a, b) => a - b);
        
        const gapX = gapXs.length > 0 ? gapXs[Math.floor(gapXs.length / 2)] : 1000;
        const gapY = gapYs.length > 0 ? gapYs[Math.floor(gapYs.length / 2)] : 1000;

        console.log(`[DEBUG-MAPPER] Calculated true gaps: X=${gapX}, Y=${gapY}`);

        function getRobustTracks(points: number[], gap: number) {
            let tracks: number[][] = [];
            for (let p of points) {
                let added = false;
                for (let t of tracks) {
                    if (Math.abs(t[0] - p) < gap * 0.5) {
                        t.push(p);
                        added = true;
                        break;
                    }
                }
                if (!added) tracks.push([p]);
            }
            return tracks.filter(t => t.length >= 2).map(t => t.reduce((sum, val) => sum + val, 0) / t.length).sort((a, b) => a - b);
        }

        let validTracksX = getRobustTracks(flatCentersX, gapX);
        let validTracksY = getRobustTracks(flatCentersY, gapY);

        if (validTracksX.length === 0) validTracksX = [500];
        if (validTracksY.length === 0) validTracksY = [500];

        const minX = validTracksX[0];
        const maxX = validTracksX[validTracksX.length - 1];
        const cols = Math.max(1, Math.round((maxX - minX) / gapX) + 1);

        const minY = validTracksY[0];
        const maxY = validTracksY[validTracksY.length - 1];
        const rows = Math.max(1, Math.round((maxY - minY) / gapY) + 1);

        console.log(`[DEBUG-MAPPER] Density filtered bounds: minX=${minX.toFixed(1)}, maxX=${maxX.toFixed(1)} -> ${cols} cols`);
        console.log(`[DEBUG-MAPPER] Density filtered bounds: minY=${minY.toFixed(1)}, maxY=${maxY.toFixed(1)} -> ${rows} rows`);

        const projectToPixel = createProjector(flatSquare, aiResult.outerCorners);

        const flatTL = [minX - gapX / 2, minY - gapY / 2];
        const flatTR = [minX + (cols - 0.5) * gapX, minY - gapY / 2];
        const flatBR = [minX + (cols - 0.5) * gapX, minY + (rows - 0.5) * gapY];
        const flatBL = [minX - gapX / 2, minY + (rows - 0.5) * gapY];

        const warpCorners = [
            projectToPixel(flatTL[0], flatTL[1]),
            projectToPixel(flatTR[0], flatTR[1]),
            projectToPixel(flatBR[0], flatBR[1]),
            projectToPixel(flatBL[0], flatBL[1])
        ];
        
        let perfectGrid: number[][][] = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x1 = minX - gapX / 2 + c * gapX;
                const y1 = minY - gapY / 2 + r * gapY;
                const x2 = x1 + gapX;
                const y2 = y1;
                const x3 = x2;
                const y3 = y1 + gapY;
                const x4 = x1;
                const y4 = y3;

                perfectGrid.push([
                    projectToPixel(x1, y1),
                    projectToPixel(x2, y2),
                    projectToPixel(x3, y3),
                    projectToPixel(x4, y4)
                ]);
            }
        }
        
        console.log(`\n=== CONCISE GRID FOR: MAPPER ===`);
        console.log(`Grid: ${cols} cols x ${rows} rows`);
        console.log(`Outer Corners (TL, TR, BR, BL):`);
        console.log(JSON.stringify(warpCorners.map(c => [Math.round(c[0]), Math.round(c[1])])));
        console.log(`============================================\n`);

        console.log(`[DEBUG-MAPPER] Generated ${perfectGrid.length} perfect polygons. Finished mapping.`);

        return { isGrid: true, compartments: perfectGrid, warpMap: { cols, rows, corners: warpCorners } };

    } catch (e) {
        console.error("[DEBUG-MAPPER] Failed to map compartments.", e);
        return null;
    }
}
