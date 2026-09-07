/**
 * Automatically reconciles existing database entities (Tray Bank) 
 * with newly generated AI polygons after a container re-scan.
 */
export function autoMatchTrays(
    existingEntities: { id: number, name: string }[],
    newPolygons: number[][][]
): { polygonIndex: number, entityId: number }[] {
    const matches: { polygonIndex: number, entityId: number }[] = [];
    const usedPolys = new Set<number>();
    const usedEntities = new Set<number>();

    // Pass 1: Exact Name / OCR Match (If we later feed OCR data into this function)
    existingEntities.forEach((entity, eIdx) => {
        newPolygons.forEach((poly, pIdx) => {
            if (usedPolys.has(pIdx) || usedEntities.has(eIdx)) return;
            
            // Basic heuristic: Tray 1 maps to slot 0.
            if (entity.name.toLowerCase().trim() === `tray ${pIdx + 1}` || 
                entity.name.toLowerCase().includes(`slot ${pIdx + 1}`)) {
                matches.push({ polygonIndex: pIdx, entityId: entity.id });
                usedPolys.add(pIdx);
                usedEntities.add(eIdx);
            }
        });
    });

    // Pass 2: Sequential Fallback (Fill remaining slots in order)
    existingEntities.forEach((entity, eIdx) => {
        if (usedEntities.has(eIdx)) return;
        for (let pIdx = 0; pIdx < newPolygons.length; pIdx++) {
            if (!usedPolys.has(pIdx)) {
                matches.push({ polygonIndex: pIdx, entityId: entity.id });
                usedPolys.add(pIdx);
                usedEntities.add(eIdx);
                break;
            }
        }
    });

    return matches;
}