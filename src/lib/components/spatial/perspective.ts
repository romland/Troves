/**
 * Maps a standard 2D grid (columns * rows) into a 3D projective perspective (Homography)
 * based strictly on 4 outer corner coordinates.
 */
export function computePerspectiveGrid(cols: number, rows: number, corners: number[][]): number[][][] {
    // corners order: [TopLeft, TopRight, BottomRight, BottomLeft]
    const [x0, y0] = corners[0];
    const [x1, y1] = corners[1];
    const [x2, y2] = corners[2];
    const [x3, y3] = corners[3];

    const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;

    // Calculate homography coefficients
    const denominator = (dx1 * dy2 - dy1 * dx2) || 1e-10; 
    const g = (sx * dy2 - sy * dx2) / denominator;
    const h = (dx1 * sy - dy1 * sx) / denominator;

    const a = x1 - x0 + g * x1;
    const b = x3 - x0 + h * x3;
    const c = x0;
    const d = y1 - y0 + g * y1;
    const e = y3 - y0 + h * y3;
    const f = y0;

    const project = (u: number, v: number) => {
        const denom = g * u + h * v + 1;
        return [
            (a * u + b * v + c) / denom,
            (d * u + e * v + f) / denom
        ];
    };

    const grid: number[][][] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid.push([
                project(c / cols, r / rows),                 // TL
                project((c + 1) / cols, r / rows),           // TR
                project((c + 1) / cols, (r + 1) / rows),     // BR
                project(c / cols, (r + 1) / rows)            // BL
            ]);
        }
    }
    return grid;
}