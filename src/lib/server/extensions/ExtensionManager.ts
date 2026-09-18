import { ioQueue } from '$lib/server/queue/index';
import { sysLog } from '$lib/server/logger';
import fs from 'fs';
import path from 'path';
import { env } from '$env/dynamic/private';
import fetch from 'node-fetch';
import { db } from '$lib/server/database';
import { logActivity } from '$lib/server/logger';
import { getActiveSchema } from '$lib/server/ontology';
import { evaluateTextIdentity } from '$lib/server/matcher';

export type EventName = 'onContainerCreated' | 'onItemAdded' | 'onItemUpdated' | 'onItemProcessed' | 'onPrintLabelRequested';
export type EventHandler = (payload: any) => Promise<void>;
export type HookOptions = { maxRetries?: number; retryDelayMs?: number; rateLimitRpm?: number };
export type ItemActionDef = { id: string; label: string; icon?: string; urlTemplate?: string } & HookOptions;

type HookRegistration = { pluginName: string; handler: EventHandler; options?: HookOptions };

/**
 * Central orchestrator for the plugin ecosystem.
 * Maintains in-memory routing tables mapping system events and UI buttons to specific plugin handlers.
 */
class ExtensionManager {
    // Primary execution maps determining what code runs when an event fires
	private listeners: Map<EventName, HookRegistration[]> = new Map();
	private itemActions: Map<string, ItemActionDef & { pluginName: string, handler?: EventHandler }> = new Map();
    
    // Reverse lookups used exclusively by the Admin UI to display plugin capabilities
	private pluginSubscriptions: Map<string, string[]> = new Map();
	private pluginRegisteredActions: Map<string, string[]> = new Map();
	private loadedPluginNames: Set<string> = new Set();	
	private isLoaded = false;
	private pluginRateLimits: Map<string, { requests: number, minuteResetTime: number }> = new Map();
	
	private registerHook(pluginName: string, event: EventName, handler: EventHandler, options?: HookOptions) {
		if (!this.listeners.has(event)) this.listeners.set(event, []);
		this.listeners.get(event)!.push({ pluginName, handler, options });
		
		if (!this.pluginSubscriptions.has(pluginName)) {
			this.pluginSubscriptions.set(pluginName, []);
		}
		this.pluginSubscriptions.get(pluginName)!.push(event);
	}
	
	private registerItemAction(pluginName: string, def: ItemActionDef, handler?: EventHandler) {
		this.itemActions.set(def.id, { ...def, pluginName, handler });
		
		if (!this.pluginRegisteredActions.has(pluginName)) {
			this.pluginRegisteredActions.set(pluginName, []);
		}
		this.pluginRegisteredActions.get(pluginName)!.push(def.id);
		
		sysLog.debug(`[ExtensionManager] Plugin ${pluginName} registered UI action: ${def.id}`);
	}
	
	/**
	 * Returns a list of all successfully loaded plugin filenames.
	 */
	getLoadedPlugins(): string[] {
		return Array.from(this.loadedPluginNames);
	}
	
    getPluginDetails() {
        return Array.from(this.loadedPluginNames).map(name => ({
            name,
            hooks: this.pluginSubscriptions.get(name) || [],
            actions: this.pluginRegisteredActions.get(name) || []
        }));
    }

	/**
	 * Returns UI actions registered by currently enabled plugins for a specific Trove.
	 */
	async getEnabledItemActions(inventoryId: number): Promise<ItemActionDef[]> {
		const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
		const whitelist = JSON.parse(vault?.enabledPlugins || '[]');
		return Array.from(this.itemActions.values())
		.filter(action => whitelist.includes(action.pluginName))
		.map(({ id, label, icon, urlTemplate }) => ({ id, label, icon, urlTemplate }));
	}
	
	/**
	 * Checks if there is at least one active, whitelisted plugin listening to a specific event.
	 * Useful for conditionally hiding UI elements (like Print buttons) when no handler exists.
	 */
	async hasActiveListeners(event: EventName, inventoryId: number): Promise<boolean> {
		const hooks = this.listeners.get(event) || [];
		if (hooks.length === 0) return false;
		
		const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
		const whitelist = JSON.parse(vault?.enabledPlugins || '[]');
		
		// Return true if at least one hook belongs to an enabled plugin
		return hooks.some(hook => whitelist.includes(hook.pluginName));
	}
	
    /**
     * Wraps execution in a basic leaky-bucket rate limiter and exponential backoff.
     * Prevents Troves from getting IP-banned by external APIs during mass-scan/bulk-import 
     * events where dozens of items might trigger the same plugin simultaneously.
     */
	private async executeWithRetryAndLimits(pluginName: string, config: HookOptions, fn: () => Promise<void>) {
		const maxRetries = config.maxRetries || 1;
		const retryDelayMs = config.retryDelayMs || 2000;
		const rateLimitRpm = config.rateLimitRpm || 0;
		
		let attempt = 0;
		while (true) {
			try {
				attempt++;
				
				if (rateLimitRpm > 0) {
					if (!this.pluginRateLimits.has(pluginName)) {
						this.pluginRateLimits.set(pluginName, { requests: 0, minuteResetTime: Date.now() + 60000 });
					}
					const quota = this.pluginRateLimits.get(pluginName)!;
					
					if (quota.requests >= rateLimitRpm) {
						const waitTime = Math.max(1000, quota.minuteResetTime - Date.now());
						sysLog.info(`[Plugin:${pluginName}] Rate limit reached (${rateLimitRpm} RPM). Queued for ${waitTime}ms...`);
						await new Promise(r => setTimeout(r, waitTime));
					}
					
					if (Date.now() > quota.minuteResetTime) {
						quota.requests = 0;
						quota.minuteResetTime = Date.now() + 60000;
					}
					quota.requests++;
				}
				
				await fn();
				return;
			} catch (err) {
				if (attempt >= maxRetries) {
					throw err;
				}
				sysLog.warn(`[Plugin:${pluginName}] Failed (Attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs}ms...`);
				await new Promise(r => setTimeout(r, retryDelayMs * attempt));
			}
		}
	}
	
	/**
	 * Triggers all registered extensions for an event.
	 * Guaranteed to execute asynchronously in the background I/O queue 
	 * to prevent blocking the user's save workflow.
	 */
	trigger(event: EventName, payload: any) {
		const hooks = this.listeners.get(event) || [];
		if (hooks.length === 0) return;
		
		sysLog.info(`[ExtensionManager] Event '${event}' fired. Queuing ${hooks.length} plugin hook(s).`);
		
		for (const hook of hooks) {
			const prefix = `[Plugin:${hook.pluginName}]`;
			
			// Extract entity name if available for UI display (e.g., "romland-label-studio.js ➔ onContainerCreated for Box 001")
			const entityName = payload?.entity?.name ? ` for ${payload.entity.name}` : '';
			const description = `${hook.pluginName} ➔ ${event}${entityName}`;
			
			ioQueue.add(async () => {
				// The Bouncer: Drop the hook if the plugin is not whitelisted for this Trove
                // Checked at runtime rather than load-time so enabling/disabling is instantly applied per-Trove
				const inventoryId = payload?.context?.inventoryId;
				if (inventoryId) {
					try {
						const vault = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
						const whitelist = JSON.parse(vault?.enabledPlugins || '[]');
						if (!whitelist.includes(hook.pluginName)) {
							sysLog.debug(`[ExtensionManager] Skipping ${hook.pluginName} for '${event}' (Not enabled for Trove ID ${inventoryId})`);
							return;
						}
					} catch (err) {}
				}
				
				try {
					sysLog.debug(`${prefix} Starting execution for '${event}'...`);
					const startTime = Date.now();
					
                    // Take a database snapshot before handoff. If a buggy plugin overwrites vital 
                    // fields (like wiping a description), the user can restore the item via Version History.
					if (payload?.entity?.id && payload?.entity?.slug && event !== 'onItemAdded' && event !== 'onContainerCreated') {
						try {
							const { takeSnapshot } = await import('$lib/server/itemHistory');
							await takeSnapshot(payload.entity.id, `Plugin: ${hook.pluginName}`);
						} catch(e) { sysLog.error("Snapshot failed", e); }
					}
					
					await this.executeWithRetryAndLimits(hook.pluginName, hook.options || {}, () => hook.handler(payload));
					const duration = Date.now() - startTime;
					sysLog.info(`${prefix} Completed '${event}' successfully in ${duration}ms.`);
				} catch (err) {
					sysLog.error(`${prefix} Error executing '${event}':`, err);
				}
			}, { targetType: 'plugin', targetId: hook.pluginName, description });
		}
	}
	
	/**
	 * Triggers a specific UI action registered by a plugin.
	 */
	triggerItemAction(actionId: string, payload: any) {
		const action = this.itemActions.get(actionId);
		if (!action) {
			sysLog.warn(`[ExtensionManager] Attempted to trigger unknown action: ${actionId}`);
			return;
		}
		
		if (!action.handler) {
			sysLog.warn(`[ExtensionManager] Action ${actionId} has no backend handler (client-side only).`);
			return;
		}
		
		const prefix = `[Plugin:${action.pluginName}]`;
		const entityName = payload?.entity?.title || payload?.entity?.name ? ` for ${payload.entity.title || payload.entity.name}` : '';
		const description = `${action.pluginName} ➔ Action: ${action.label}${entityName}`;
		
		ioQueue.add(async () => {
			try {
				sysLog.debug(`${prefix} Starting UI action '${action.label}'...`);
				const startTime = Date.now();
				
				// Snapshot the item before UI action handoff
				if (payload?.entity?.id && payload?.entity?.slug) {
					try {
						const { takeSnapshot } = await import('$lib/server/itemHistory');
						await takeSnapshot(payload.entity.id, `Action: ${action.label}`);
					} catch(e) { sysLog.error("Snapshot failed", e); }
				}
				
				await this.executeWithRetryAndLimits(action.pluginName, action, () => action.handler!(payload));
				const duration = Date.now() - startTime;
				sysLog.info(`${prefix} Completed UI action '${action.label}' successfully in ${duration}ms.`);
			} catch (err) {
				sysLog.error(`${prefix} Error executing UI action '${action.label}':`, err);
			}
		}, { targetType: 'system', targetId: 0, description });
	}
	
    async reloadPlugins() {
        sysLog.info('[ExtensionManager] Hot-reloading all plugins...');
        this.listeners.clear();
        this.itemActions.clear();
        this.pluginSubscriptions.clear();
        this.pluginRegisteredActions.clear();
        this.loadedPluginNames.clear();
        this.isLoaded = false;
        await this.loadPlugins();
    }

	async loadPlugins() {
		if (this.isLoaded) return;
		this.isLoaded = true;
        sysLog.debug('[ExtensionManager] Starting loadPlugins sequence...');
		
		const pluginDir = path.resolve(process.cwd(), 'data/plugins');
		if (!fs.existsSync(pluginDir)) {
			fs.mkdirSync(pluginDir, { recursive: true });
		}
		
        const tmpDir = path.join(pluginDir, '.tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        
        // Clean up old shadow copies from previous reloads (silently ignore file locks on Windows)
        try { 
            fs.readdirSync(tmpDir).forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch(e) {} }); 
        } catch(e) {}

		const files = fs.readdirSync(pluginDir);
		for (const file of files) {
			if (file.endsWith('.js') || file.endsWith('.mjs')) {
				try {
					const pluginPath = path.join(pluginDir, file);
                    
                    // The ItemOps sandbox. Wraps raw Prisma mutations in idempotent safety checks 
                    // (e.g., verifying isAutoGenerated) so plugins don't overwrite manual user corrections.
                    const itemOps = {
                        async setAttribute(itemId: number, key: string, value: string) {
                            const existing = await db.kVP.findFirst({ where: { itemId, key } });
                            if (existing) {
                                if (!existing.isAutoGenerated) return false;
                                if (existing.value !== value) {
                                    await db.kVP.update({ where: { id: existing.id }, data: { value } });
                                    return true;
                                }
                                return false;
                            }
                            await db.kVP.create({ data: { itemId, key, value, isAutoGenerated: true } });
                            return true;
                        },
                        async attachDocument(itemId: number, doc: { title: string, source: string, path: string, extracts?: string, type?: string }) {
                            const existing = await db.document.findFirst({ where: { itemId, path: doc.path } });
                            if (existing) return false;
                            await db.document.create({ data: { itemId, ...doc, extracts: doc.extracts || '', type: doc.type || 'link' } });
                            return true;
                        },
                        async getSchema(inventoryId: number, categoryId?: number | null) {
                            return await getActiveSchema(inventoryId, categoryId, false);
                        },
                        compareTitles(scannedTitle: string, dbTitle: string, scanDesc: string = '', dbDesc: string = '', category: string = '') {
                            return evaluateTextIdentity(scannedTitle, scanDesc, dbTitle, dbDesc, category);
                        },
                        getFuzzyAttribute(item: any, keywords: string[]) {
                            if (!item.attributes) return null;
                            const match = item.attributes.find((a: any) => {
                                const keyLower = (a.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                                return keywords.some(kw => keyLower.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, '')));
                            });
                            return match ? match.value : null;
                        }						
                    };

                    // Shadow Copy Technique: Node's ES Module loader aggressively caches based on the 
                    // absolute file path. To force V8 to compile the hot-reloaded code as a completely 
                    // new module, we copy it to a `.tmp/` file with a unique timestamp baked directly 
                    // into the filename, import that file, and discard the old reference.
                    const safeName = file.replace(/\.m?js$/, '');
                    const shadowPath = path.join(tmpDir, `${safeName}_${Date.now()}.js`);
                    fs.copyFileSync(pluginPath, shadowPath);

                    const fileUrl = 'file://' + shadowPath;
                    sysLog.debug(`[ExtensionManager] Attempting dynamic import for: ${fileUrl}`);
                    const importStart = Date.now();
					const module = await import(/* @vite-ignore */ fileUrl);
                    sysLog.debug(`[ExtensionManager] Import resolved in ${Date.now() - importStart}ms. Type of default export: ${typeof module.default}`);
					
					if (typeof module.default === 'function') {
						this.loadedPluginNames.add(file);
						module.default({
							on: (eventName: EventName, handler: EventHandler, options?: HookOptions) => this.registerHook(file, eventName, handler, options),
							registerItemAction: (def: ItemActionDef, handler?: EventHandler) => this.registerItemAction(file, def, handler),
							sysLog,
							logActivity,
							fetch,
							env,
                            db, // The keys to the kingdom
                            itemOps
						});
						const subs = this.pluginSubscriptions.get(file) || [];
						const actions = this.pluginRegisteredActions.get(file) || [];
						sysLog.info(`[ExtensionManager] Loaded plugin: ${file} ➔ Hooks: [${subs.length ? subs.join(', ') : 'none'}] | UI Actions: [${actions.length ? actions.join(', ') : 'none'}]`);
					} else {
						sysLog.warn(`[ExtensionManager] Plugin ${file} must export a default function.`);
					}
				} catch (err) {
					sysLog.error(`[ExtensionManager] Failed to load plugin ${file}:`, err);
				}
			}
		}
	}
}

export const extensionManager = new ExtensionManager();
