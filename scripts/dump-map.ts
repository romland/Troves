import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const container = await prisma.container.findFirst({
        where: { spatialMap: { not: null } },
        orderBy: { updatedAt: 'desc' }
    });

    if (container && container.spatialMap) {
        const map = JSON.parse(container.spatialMap);
        
        console.log(`\n=== CONCISE GRID FOR: ${container.name} ===`);
        
        if (map.warpMap) {
            console.log(`Grid: ${map.warpMap.cols} cols x ${map.warpMap.rows} rows`);
            console.log(`Outer Corners (TL, TR, BR, BL):`);
            console.log(JSON.stringify(map.warpMap.corners.map((c: number[]) => [Math.round(c[0]), Math.round(c[1])])));
        } else if (Array.isArray(map) || map.polygons) {
            const polys = Array.isArray(map) ? map : map.polygons;
            console.log(`Grid: ${polys.length} total cells`);
            console.log(`Top-Left Cell TL:`, Math.round(polys[0][0][0]), Math.round(polys[0][0][1]));
            console.log(`Bottom-Right Cell BR:`, Math.round(polys[polys.length-1][2][0]), Math.round(polys[polys.length-1][2][1]));
        }
        console.log(`============================================\n`);
    } else {
        console.log("No spatial maps found.");
    }
}

main()
  .then(async () => await prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });