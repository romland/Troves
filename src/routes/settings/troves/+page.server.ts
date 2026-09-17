import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/database';
import { bootstrapInventorySchema } from '$lib/server/ontology';
import type { PageServerLoad, Actions } from './$types';
 import { extensionManager } from '$lib/server/extensions/ExtensionManager';

export const load = (async ({ locals }) => {
    if (!locals.user) throw redirect(303, '/login');

    const inventoryWhere = locals.user.isAdmin ? {} : { users: { some: { userId: locals.user.id, role: 'OWNER' } } };
    
    const allInventories = await db.inventory.findMany({ 
        where: inventoryWhere,
        select: { 
            id: true, name: true, allowNewCategories: true, allowAutoTaxonomy: true, archetype: true,
            extractExif: true, deepScanCollections: true, bgRemovalEnabled: true,
            bgRemovalModel: true, bgRemovalPreCrop: true, enablePaddleOCR: true,
            duplicateStrategy: true, containerMode: true, defaultView: true,
            archiveSingleScans: true, trackQuantity: true, showExif: true,
            showColors: true, showOcr: true, enableAskAi: true, enableNotebook: true,
            showNoteContextUrl: true, enableDocuments: true, notebookCategories: true,
            enableFuzzySearch: true, showRelatedItems: true, enabledPlugins: true,
            templateFields: true,
            _count: { select: { items: true, notes: true, containers: true } }
        } 
    });

    let allUsers = [];
    let accessMap = [];
    if (locals.user.isAdmin) {
        allUsers = await db.user.findMany({ select: { id: true, username: true, name: true } });
    }
    
    if (locals.user.isAdmin || allInventories.length > 0) {
        accessMap = await db.userInventoryAccess.findMany({
            where: { inventoryId: { in: allInventories.map(i => i.id) } },
            include: { user: { select: { username: true } }, inventory: { select: { name: true } } },
            orderBy: [
                { user: { username: 'asc' } },
                { inventory: { name: 'asc' } }
            ]
        });
    }

    const availablePlugins = extensionManager.getLoadedPlugins();

    return { allInventories, accessMap, allUsers, availablePlugins };
}) satisfies PageServerLoad;

export const actions = {
    createInventory: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: true, message: "Unauthorized" });
        if (!locals.user.isAdmin && !locals.user.canCreateInventories) return fail(403, { error: true, message: "No permission to create new troves." });
        
        const data = await request.formData();
        const name = data.get('name') as string;
        const archetype = (data.get('archetype') as string) || "generic";
        const contentsHint = data.get('contentsHint') as string || name;

        if (!name || name.trim() === '') return fail(400, { error: true, message: "Inventory name required." });

        let allowNewCategories = true, allowAutoTaxonomy = false, extractExif = true;
        let deepScanCollections = false, bgRemovalEnabled = true, bgRemovalModel = 'bria-rmbg';
        let bgRemovalPreCrop = false, enablePaddleOCR = false, duplicateStrategy = 'PROMPT';
        let archiveSingleScans = false, trackQuantity = true, showExif = false;
        let showColors = false, showOcr = true, enableNotebook = true;
        let enableDocuments = true, enableFuzzySearch = true;
        let containerMode = 'scan', defaultView = 'grid';

        switch (archetype) {
            case 'media': deepScanCollections = true; bgRemovalEnabled = false; enablePaddleOCR = true; defaultView = 'list'; break;
            case 'apparel': allowAutoTaxonomy = true; deepScanCollections = true; showColors = true; bgRemovalPreCrop = true; break;
            case 'hardware': allowAutoTaxonomy = true; enablePaddleOCR = true; duplicateStrategy = 'AUTO_BUMP'; containerMode = 'select'; defaultView = 'list'; break;
            case 'consumables': deepScanCollections = true; bgRemovalEnabled = false; duplicateStrategy = 'AUTO_BUMP'; enableNotebook = false; enableDocuments = false; break;
            case 'collectibles': allowAutoTaxonomy = true; deepScanCollections = true; trackQuantity = false; showColors = true; break;
            case 'natural': allowAutoTaxonomy = true; bgRemovalPreCrop = true; trackQuantity = false; showExif = true; break;
        }

        const inventory = await db.inventory.create({
            data: {
                name: name.trim(), description: contentsHint.trim(), classes: "[]", archetype,
                allowNewCategories, allowAutoTaxonomy, extractExif, deepScanCollections,
                bgRemovalEnabled, bgRemovalModel, bgRemovalPreCrop, enablePaddleOCR,
                duplicateStrategy, archiveSingleScans, trackQuantity, showExif,
                showColors, showOcr, enableNotebook, enableDocuments, enableFuzzySearch,
                containerMode, defaultView, users: { create: { userId: locals.user.id, role: "OWNER" } }
            }
        });

        bootstrapInventorySchema(inventory.id, contentsHint).catch(console.error);
        return { success: true, message: `Inventory '${inventory.name}' created!` };
    },
    assignAccess: async ({ request, locals }) => {
        const data = await request.formData();
        const inventoryId = Number(data.get('inventoryId'));
        const userId = Number(data.get('userId'));
        const role = data.get('role') as string;

        if (!userId || !inventoryId || !role) return fail(400, { error: true, message: "Missing fields." });

        if (!locals.user?.isAdmin) {
            const access = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId, userId: locals.user!.id } } });
            if (access?.role !== 'OWNER') return fail(403, { error: true, message: "Forbidden. Owners only." });
        }

        await db.userInventoryAccess.upsert({
            where: { inventoryId_userId: { inventoryId, userId } },
            update: { role }, create: { inventoryId, userId, role }
        });

        return { success: true, message: "Access granted successfully." };
    },
    revokeAccess: async ({ request, locals }) => {
        const data = await request.formData();
        const inventoryId = Number(data.get('inventoryId'));
        const userId = Number(data.get('userId'));

        if (!locals.user?.isAdmin) {
            const access = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId, userId: locals.user!.id } } });
            if (access?.role !== 'OWNER') return fail(403, { error: true, message: "Forbidden. Owners only." });
        }

        if (userId === locals.user!.id && !locals.user?.isAdmin) {
            const targetAccess = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId, userId } } });
            if (targetAccess?.role === 'OWNER') return fail(400, { error: true, message: "You cannot revoke your own Owner access." });
        }

        await db.userInventoryAccess.deleteMany({ where: { inventoryId, userId } });
        return { success: true, message: "Access revoked." };
    },
    deleteInventory: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        if (!locals.user?.isAdmin) {
            const access = await db.userInventoryAccess.findUnique({ where: { inventoryId_userId: { inventoryId: id, userId: locals.user!.id } } });
            if (access?.role !== 'OWNER') return fail(403, { error: true, message: "Forbidden. Owners only." });
        }

        const confirmName = data.get('confirmName') as string;
        if (!id) return fail(400, { error: true, message: "Invalid ID." });

        const vault = await db.inventory.findUnique({ where: { id } });
        if (!vault) return fail(404, { error: true, message: "Inventory not found." });
        if (vault.name !== confirmName) return fail(400, { error: true, message: "Confirmation name did not match." });

        await db.inventory.delete({ where: { id } });
        return { success: true, message: `Inventory '${vault.name}' and all its contents completely deleted.` };
    },

    toggleAutoCategories: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('allowNewCategories') === 'true';
        await db.inventory.update({ where: { id }, data: { allowNewCategories: allow } });
        return { success: true, message: "Category generation settings updated." };
    },
    toggleAutoTaxonomy: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('allowAutoTaxonomy') === 'true';
        await db.inventory.update({ where: { id }, data: { allowAutoTaxonomy: allow } as any });
        return { success: true, message: "AI Taxonomy settings updated." };
    },
    toggleExtractExif: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('extractExif') === 'true';
        await db.inventory.update({ where: { id }, data: { extractExif: allow } });
        return { success: true, message: "EXIF extraction settings updated." };
    },
    toggleDeepScan: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('deepScan') === 'true';
        await db.inventory.update({ where: { id }, data: { deepScanCollections: allow } });
        return { success: true, message: "MultiScan scanning settings updated." };
    },
    toggleBgRemoval: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('bgRemovalEnabled') === 'true';
        await db.inventory.update({ where: { id }, data: { bgRemovalEnabled: allow } });
        return { success: true, message: "Background removal settings updated." };
    },
    toggleBgRemovalModel: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const model = data.get('bgRemovalModel') as string;
        await db.inventory.update({ where: { id }, data: { bgRemovalModel: model } });
        return { success: true, message: "Background removal model updated." };
    },
    toggleBgPreCrop: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('bgRemovalPreCrop') === 'true';
        await db.inventory.update({ where: { id }, data: { bgRemovalPreCrop: allow } });
        return { success: true, message: "Pre-crop settings updated." };
    },
    togglePaddleOCR: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('enablePaddleOCR') === 'true';
        await db.inventory.update({ where: { id }, data: { enablePaddleOCR: allow } });
        return { success: true, message: "OCR settings updated." };
    },
    updateInventoryStrategy: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const strategy = data.get('strategy')?.toString();
        if (id && strategy) await db.inventory.update({ where: { id }, data: { duplicateStrategy: strategy } });
        return { success: true, message: "Default duplicate strategy updated." };
    },
    updateContainerMode: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const containerMode = data.get('containerMode') as string;
        await db.inventory.update({ where: { id }, data: { containerMode } });
        return { success: true, message: "Container mode updated." };
    },
    updateDefaultView: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const defaultView = data.get('defaultView') as string;
        await db.inventory.update({ where: { id }, data: { defaultView } });
        return { success: true, message: "Default view updated." };
    },
    toggleArchiveSingle: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('archiveSingleScans') === 'true';
        await db.inventory.update({ where: { id }, data: { archiveSingleScans: allow } });
        return { success: true, message: "Archive setting updated." };
    },
    toggleTrackQuantity: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const allow = data.get('trackQuantity') === 'true';
        await db.inventory.update({ where: { id }, data: { trackQuantity: allow } });
        return { success: true, message: "Quantity tracking updated." };
    },
    toggleUiFlag: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const field = data.get('field') as string;
        const value = data.get('value') === 'true';
        if (['showExif', 'showColors', 'showOcr', 'enableAskAi', 'enableNotebook', 'enableDocuments', 'enableFuzzySearch', 'showNoteContextUrl', 'showRelatedItems'].includes(field)) {
            await db.inventory.update({ where: { id }, data: { [field]: value } });
        }
        return { success: true, message: "UI settings updated." };
    },
    updateNotebookCategories: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const csv = data.get('notebookCategories') as string;
        const cats = csv.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
        if (!cats.includes('archive')) cats.push('archive');
        await db.inventory.update({ where: { id }, data: { notebookCategories: JSON.stringify(cats) } });
        return { success: true, message: "Notebook categories updated." };
    },
    updateEnabledPlugins: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const plugins = data.getAll('plugins') as string[];
        await db.inventory.update({ where: { id }, data: { enabledPlugins: JSON.stringify(plugins) } });
        return { success: true, message: "Plugin whitelist updated." };
    },
    retrySchemaBootstrap: async ({ request, locals }) => {
        const data = await request.formData();
        const inventoryId = Number(data.get('inventoryId'));
        const name = data.get('name') as string;
        if (!inventoryId) return fail(400, { error: true, message: "Invalid ID." });
        await bootstrapInventorySchema(inventoryId, name);
        return { success: true, message: `Taxonomy rules regenerated for '${name}'!` };
    },
    rebuildDuplicates: async ({ request, locals }) => {
        const data = await request.formData();
        const inventoryId = Number(data.get('inventoryId'));
        if (!inventoryId) return fail(400, { error: true, message: "Invalid ID." });
        const { ioQueue } = await import('$lib/server/queue/index');
        const { retroactiveDuplicateSweep } = await import('$lib/server/matcher');
        ioQueue.add(() => retroactiveDuplicateSweep(inventoryId), { targetType: 'global', targetId: inventoryId, description: 'Retroactive duplicate sweep' }).catch(console.error);
        return { success: true, message: "Duplicate sweep started in the background!" };
    },
    beautifyTaxonomy: async ({ request, locals }) => {
        const data = await request.formData();
        const inventoryId = Number(data.get('inventoryId'));
        const { beautifyTaxonomyRules } = await import('$lib/server/ontology');
        await beautifyTaxonomyRules(inventoryId);
        return { success: true, message: "Taxonomy labels successfully translated to human-readable terms." };
    },
    updateTaxonomy: async ({ request, locals }) => {
        const data = await request.formData();
        const id = Number(data.get('id'));
        const taxonomyJson = data.get('taxonomyJson') as string;
        try {
            const fields = JSON.parse(taxonomyJson);
            await db.$transaction([
                db.templateField.deleteMany({ where: { inventoryId: id } }),
                db.templateField.createMany({
                    data: fields.map((f: any) => ({
                        name: f.name, uiLabel: f.uiLabel || f.name, type: f.type || 'string',
                        options: typeof f.options === 'string' ? f.options : JSON.stringify(f.options),
                        matchWeight: f.matchWeight || 'FUZZY_SECONDARY',
                        extractionMethod: f.extractionMethod || 'HYBRID',
                        inventoryId: id, categoryId: f.categoryId || null
                    }))
                })
            ]);
            return { success: true, message: "Taxonomy updated successfully." };
        } catch (e: any) {
            return fail(400, { error: true, message: "Invalid JSON or DB error: " + e.message });
        }
    }
} satisfies Actions;