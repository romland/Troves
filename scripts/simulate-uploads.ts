/// <reference types="node" />

// npx tsx scripts/simulate-uploads.ts

// Bypass self-signed certificate errors for local development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ==========================================
// CONFIGURATION
// ==========================================
const BASE_URL = "https://localhost:5173"; // Update if your dev server runs on a different port
const TARGET_INVENTORY_NAME = "Clothes24"; // Exact name of the inventory in the DB
const USER_ID = 2; // User ID to execute as
const DELAY_BETWEEN_UPLOADS_MS = 5000; // 20 seconds to respect LLM quotas (adjust as needed)

const CLOTHES_PATH = "/mnt/k/development/2024/inventory/USE_WSL_itemlens/static/images/tests/clothes";

// Provide the absolute or relative paths to the images on your disk
// Batch 1 - a mix 1
const singleImages: string[] = [
    CLOTHES_PATH+"/6695.jpg",
    CLOTHES_PATH+"/6857.jpg",
    CLOTHES_PATH+"/6878.jpg",
    CLOTHES_PATH+"/7191.jpg",
    CLOTHES_PATH+"/7200.jpg",
    CLOTHES_PATH+"/7202.jpg",
    CLOTHES_PATH+"/7348.jpg",
    CLOTHES_PATH+"/7410.jpg",
    CLOTHES_PATH+"/7571.jpg",
    CLOTHES_PATH+"/7577.jpg",
    CLOTHES_PATH+"/38981.jpg",
    CLOTHES_PATH+"/38994.jpg",
    CLOTHES_PATH+"/41667.jpg",
    CLOTHES_PATH+"/41811.jpg",
    CLOTHES_PATH+"/41852.jpg",
];

// Batch 2 - a mix 2
const singleImages2: string[] = [
    CLOTHES_PATH+"/6703.jpg",
    CLOTHES_PATH+"/6863.jpg",
    CLOTHES_PATH+"/7054.jpg",
    CLOTHES_PATH+"/7199.jpg",
    CLOTHES_PATH+"/7201.jpg",
    CLOTHES_PATH+"/7316.jpg",
    CLOTHES_PATH+"/7409.jpg",
    CLOTHES_PATH+"/7424.jpg",
    CLOTHES_PATH+"/7572.jpg",
    CLOTHES_PATH+"/7798.jpg",
    CLOTHES_PATH+"/38982.jpg",
    CLOTHES_PATH+"/41629.jpg",
    CLOTHES_PATH+"/41672.jpg",
    CLOTHES_PATH+"/41814.jpg",
    CLOTHES_PATH+"/41890.jpg",
    CLOTHES_PATH+"/7651.jpg",
    CLOTHES_PATH+"/7687.jpg",
    CLOTHES_PATH+"/5026.jpg",
    CLOTHES_PATH+"/7032.jpg",
    CLOTHES_PATH+"/7049.jpg",
    CLOTHES_PATH+"/7051.jpg",
    CLOTHES_PATH+"/7053.jpg",
    CLOTHES_PATH+"/7054.jpg",
];

// Bright t-shirts
const singleImages3: string[] = [
    CLOTHES_PATH+"/3339.jpg",
    CLOTHES_PATH+"/3345.jpg",
    CLOTHES_PATH+"/3351.jpg",
    CLOTHES_PATH+"/3354.jpg",
    CLOTHES_PATH+"/3358.jpg",
    CLOTHES_PATH+"/3360.jpg",
    CLOTHES_PATH+"/3413.jpg",
    CLOTHES_PATH+"/3415.jpg",
    CLOTHES_PATH+"/3419.jpg",
    CLOTHES_PATH+"/3421.jpg",
    CLOTHES_PATH+"/3478.jpg",
    CLOTHES_PATH+"/3486.jpg",
    CLOTHES_PATH+"/3495.jpg",
    CLOTHES_PATH+"/3516.jpg",
    CLOTHES_PATH+"/3519.jpg",
    CLOTHES_PATH+"/3543.jpg",
    CLOTHES_PATH+"/3544.jpg",
    CLOTHES_PATH+"/3572.jpg",
    CLOTHES_PATH+"/3680.jpg",
    CLOTHES_PATH+"/3714.jpg",
    CLOTHES_PATH+"/3719.jpg",
    CLOTHES_PATH+"/3723.jpg",
    CLOTHES_PATH+"/3757.jpg",
    CLOTHES_PATH+"/3761.jpg",
    CLOTHES_PATH+"/3846.jpg",
    CLOTHES_PATH+"/3847.jpg",
    CLOTHES_PATH+"/3859.jpg",
    CLOTHES_PATH+"/3861.jpg",
    CLOTHES_PATH+"/3864.jpg",
    CLOTHES_PATH+"/3868.jpg",
    CLOTHES_PATH+"/3869.jpg",
    CLOTHES_PATH+"/3870.jpg",
];
// CLOTHES_PATH+"/",

// Pants
const singleImages4: string[] = [
    CLOTHES_PATH+"/4770.jpg",
    CLOTHES_PATH+"/4773.jpg",
    CLOTHES_PATH+"/4774.jpg",
    CLOTHES_PATH+"/4775.jpg",
    CLOTHES_PATH+"/4785.jpg",
    CLOTHES_PATH+"/4786.jpg",
    CLOTHES_PATH+"/4787.jpg",
    CLOTHES_PATH+"/4796.jpg",
    CLOTHES_PATH+"/4797.jpg",
    CLOTHES_PATH+"/4808.jpg",
    CLOTHES_PATH+"/4825.jpg",
    CLOTHES_PATH+"/4826.jpg",
    CLOTHES_PATH+"/4827.jpg",
    CLOTHES_PATH+"/4828.jpg",
    CLOTHES_PATH+"/4829.jpg",
    CLOTHES_PATH+"/4830.jpg",
    CLOTHES_PATH+"/4831.jpg",
    CLOTHES_PATH+"/4832.jpg",
    CLOTHES_PATH+"/4833.jpg",
    CLOTHES_PATH+"/4834.jpg",
    CLOTHES_PATH+"/4835.jpg",
    CLOTHES_PATH+"/4849.jpg",
    CLOTHES_PATH+"/4851.jpg",
    CLOTHES_PATH+"/4965.jpg",
    CLOTHES_PATH+"/4966.jpg",
    CLOTHES_PATH+"/5027.jpg",
    CLOTHES_PATH+"/5809.jpg",
    CLOTHES_PATH+"/6579.jpg",
    CLOTHES_PATH+"/6588.jpg",
];

// Jerseys
const singleImages5: string[] = [
    CLOTHES_PATH+"/4857.jpg",
    CLOTHES_PATH+"/4858.jpg",
    CLOTHES_PATH+"/4859.jpg",
    CLOTHES_PATH+"/4860.jpg",
    CLOTHES_PATH+"/4861.jpg",
    CLOTHES_PATH+"/4862.jpg",
    CLOTHES_PATH+"/4863.jpg",
    CLOTHES_PATH+"/4864.jpg",
    CLOTHES_PATH+"/4865.jpg",
    CLOTHES_PATH+"/4866.jpg",
    CLOTHES_PATH+"/4867.jpg",
    CLOTHES_PATH+"/4986.jpg",
];


const collectionImages: string[] = [
    // "./test-images/bookshelf.jpg",
    // "./test-images/crate-of-games.jpg",
    // 7020.jpg 7021.jpg 7023.jpg 7026.jpg 7027.jpg
];
// ==========================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function getMimeType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

async function getAuthHeaders() {
    const user = await prisma.user.findUnique({ where: { id: USER_ID } });
    if (!user) throw new Error(`User ID ${USER_ID} not found.`);
    
    const inv = await prisma.inventory.findFirst({ where: { name: TARGET_INVENTORY_NAME } });
    if (!inv) throw new Error(`Inventory '${TARGET_INVENTORY_NAME}' not found.`);

    const rawSessionToken = crypto.randomBytes(32).toString('hex');
    const sessionHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');

    await prisma.session.create({
        data: {
            sessionHash,
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
            userAgent: 'Simulator/1.0',
            ipAddress: '127.0.0.1'
        }
    });

    return {
        "Cookie": `session=${rawSessionToken}; activeInventoryId=${inv.id}`
    };
}

async function uploadSingleItem(filePath: string, headers: Record<string, string>) {
    console.log(`\n[Single] 📸 Starting upload for: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    const filename = path.basename(filePath);

    // ---------------------------------------------------------
    // STEP 1: Analyze Draft (Trigger Vision LLM)
    // ---------------------------------------------------------
    console.log(`[Single] 🧠 Analyzing draft...`);
    const fdDraft = new FormData();
    fdDraft.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
    fdDraft.append('type', 'product');

    const draftRes = await fetch(`${BASE_URL}/api/analyze-draft`, {
        method: 'POST',
        headers,
        body: fdDraft
    });

    if (!draftRes.ok) throw new Error(`Draft analysis failed: ${draftRes.statusText}`);
    const draftData = await draftRes.json();
    console.log(`[Single] ✅ Draft analyzed! Detected as: "${draftData.aiData?.title || 'Unknown'}"`);

    // ---------------------------------------------------------
    // STEP 2: Save Item (Replicate SvelteKit Form Action)
    // ---------------------------------------------------------
    console.log(`[Single] 💾 Saving item to database...`);
    const fdSave = new FormData();
    fdSave.append('title', draftData.aiData?.title || 'Unknown Item');
    fdSave.append('description', draftData.aiData?.description || '');
    fdSave.append('amount', '1');
    fdSave.append('clientId', crypto.randomUUID());
    
    // Pass the file again (UI behavior)
    fdSave.append('file.0', new Blob([fileBuffer], { type: mimeType }), filename);
    fdSave.append('file.type.0', 'product');
    fdSave.append('file.draft.0', draftData.draftPath);

    const saveRes = await fetch(`${BASE_URL}/add`, {
        method: 'POST',
        headers: { ...headers, 'x-sveltekit-action': 'true', 'Accept': 'application/json' },
        body: fdSave
    });

    if (!saveRes.ok) throw new Error(`Form submission failed: ${saveRes.statusText}`);
    const saveData = await saveRes.json();
    
    if (saveData.type === 'redirect') {
        console.log(`[Single] 🎉 Successfully saved! Redirecting to: ${saveData.location}`);
    } else if (saveData.type === 'failure') {
        console.error(`[Single] ❌ Save failed:`, saveData.data);
    }
}

async function uploadCollection(filePath: string, headers: Record<string, string>) {
    console.log(`\n[Collection] 📸 Starting bulk upload for: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    const filename = path.basename(filePath);

    // ---------------------------------------------------------
    // STEP 1: Analyze Collection (Trigger Bounding Boxes)
    // ---------------------------------------------------------
    console.log(`[Collection] 🧠 Scanning collection...`);
    const fdColl = new FormData();
    fdColl.append('file', new Blob([fileBuffer], { type: mimeType }), filename);

    const collRes = await fetch(`${BASE_URL}/api/analyze-multiscan`, {
        method: 'POST',
        headers,
        body: fdColl
    });

    if (!collRes.ok) throw new Error(`Collection analysis failed: ${collRes.statusText}`);
    const collData = await collRes.json();
    console.log(`[Collection] ✅ Scan complete! Found ${collData.items?.length || 0} items.`);

    if (!collData.items || collData.items.length === 0) {
        console.log(`[Collection] ⚠️ Skipping save, no items detected.`);
        return;
    }

    // ---------------------------------------------------------
    // STEP 2: Bulk Save (Simulate user clicking "Save All")
    // ---------------------------------------------------------
    console.log(`[Collection] 💾 Dispatching bulk save to background worker...`);
    
    // Map items exactly how the frontend Svelte component maps them
    const itemsToSave = collData.items.map((item: any) => ({
        title: item.title,
        subtitle: item.subtitle,
        category: item.category,
        box: item.box,
        extractedAttributes: item.extractedAttributes,
        physical_traits: item.physical_traits,
        prominent_text_or_graphic: item.prominent_text_or_graphic,
        distinctive_blemishes_or_wear: item.distinctive_blemishes_or_wear,
        color_mix: item.color_mix,
        resolution: 'new', // Force insert as new (ignore deduplication for script simulation)
        duplicateItemDetails: null
    }));

    const saveRes = await fetch(`${BASE_URL}/api/bulk-save`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            draftPath: collData.draftPath,
            noteId: collData.noteId,
            containers: [], // Assigning to "Unassigned"
            globalCategory: "",
            tagcsv: "",
            items: itemsToSave
        })
    });

    if (!saveRes.ok) throw new Error(`Bulk save failed: ${saveRes.statusText}`);
    console.log(`[Collection] 🎉 Bulk save queued successfully!`);
}

async function run() {
    try {
        console.log("=== TROVES UPLOAD SIMULATOR ===");
        const headers = await getAuthHeaders();
        console.log("🔓 Authentication successful.");

        for (const file of singleImages) {
            if (fs.existsSync(file)) {
                await uploadSingleItem(file, headers);
                console.log(`⏳ Sleeping for ${DELAY_BETWEEN_UPLOADS_MS / 1000} seconds to cool down LLM...`);
                await sleep(DELAY_BETWEEN_UPLOADS_MS);
            } else {
                console.warn(`⚠️ File not found: ${file}`);
            }
        }

        for (const file of collectionImages) {
            if (fs.existsSync(file)) {
                await uploadCollection(file, headers);
                console.log(`⏳ Sleeping for ${DELAY_BETWEEN_UPLOADS_MS / 1000} seconds to cool down LLM...`);
                await sleep(DELAY_BETWEEN_UPLOADS_MS);
            } else {
                console.warn(`⚠️ File not found: ${file}`);
            }
        }

        console.log("\n✅ All simulated uploads finished!");
    } catch (e) {
        console.error("\n❌ Fatal Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();