import { ioQueue } from '$lib/server/queue/index';
import { sysLog } from '$lib/server/logger';
import fs from 'fs';
import path from 'path';
import { env } from '$env/dynamic/private';
import fetch from 'node-fetch';
import { db } from '$lib/server/database';
import { logActivity } from '$lib/server/logger';
import { extractPluginMeta } from '$lib/shared/pluginMeta';
import type { EventName, EventHandler, HookOptions, ItemActionDef, ModifierName, HookRegistration, ModifierRegistration, VoiceIntentDef, VoiceIntentHandler, VoiceIntentRegistration } from './types';
import { createItemOpsSandbox } from './itemOps';


/**
 * Central orchestrator for the plugin ecosystem.
 * Maintains in-memory routing tables mapping system events and UI buttons to specific plugin handlers.
 */
class ExtensionManager {
    // Primary execution maps determining what code runs when an event fires
	private listeners: Map<EventName, HookRegistration[]> = new Map();
	private itemActions: Map<string, ItemActionDef & { pluginName: string, handler?: EventHandler }> = new Map();
    private modifiers: Map<ModifierName, ModifierRegistration[]> = new Map();
    private archetypes: Map<string, any> = new Map();
    private voiceIntents: Map<string, VoiceIntentRegistration> = new Map();
    private voiceVocabularies: Map<string, Record<string, string>> = new Map();

    // Reverse lookups used exclusively by the Admin UI to display plugin capabilities
	private pluginSubscriptions: Map<string, string[]> = new Map();
	private pluginRegisteredActions: Map<string, string[]> = new Map();
    private pluginRegisteredModifiers: Map<string, string[]> = new Map();
    private pluginRegisteredArchetypes: Map<string, string[]> = new Map();
    private pluginRegisteredVoiceIntents: Map<string, string[]> = new Map();
	private loadedPluginNames: Set<string> = new Set();	
    private pluginMetadata: Map<string, Record<string, string>> = new Map();
	private isLoaded = false;
	private pluginRateLimits: Map<string, { requests: number, minuteResetTime: number }> = new Map();
	
    private parseConfig(enabledPluginsStr: string | null): Record<string, { active: boolean, hooks: string[], actions: string[], modifiers: string[], voiceIntents: string[] }> {
		if (!enabledPluginsStr) return {};
		try {
			const parsed = JSON.parse(enabledPluginsStr);
			if (Array.isArray(parsed)) {
				const config: any = {};
                parsed.forEach(p => { config[p] = { active: true, hooks: ['*'], actions: ['*'], modifiers: ['*'], voiceIntents: ['*'] }; });
				return config;
			}
			return parsed;
		} catch (e) { return {}; }
	}
	
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
	
    private registerArchetype(pluginName: string, def: any) {
        this.archetypes.set(def.id, { ...def, pluginSource: pluginName });
        
        if (!this.pluginRegisteredArchetypes.has(pluginName)) this.pluginRegisteredArchetypes.set(pluginName, []);
        this.pluginRegisteredArchetypes.get(pluginName)!.push(def.id);
    }

    private registerVoiceIntent(pluginName: string, def: VoiceIntentDef, handler: VoiceIntentHandler) {
        this.voiceIntents.set(def.id, { pluginName, def, handler });
        if (!this.pluginRegisteredVoiceIntents.has(pluginName)) this.pluginRegisteredVoiceIntents.set(pluginName, []);
        this.pluginRegisteredVoiceIntents.get(pluginName)!.push(def.id);
    }

    private registerVoiceVocabulary(pluginName: string, replacements: Record<string, string>) {
        if (!this.voiceVocabularies.has(pluginName)) {
            this.voiceVocabularies.set(pluginName, {});
        }
        Object.assign(this.voiceVocabularies.get(pluginName)!, replacements);
    }

    private addModifier(pluginName: string, name: ModifierName, handler: (value: any, context: any) => any | Promise<any>) {
        if (!this.modifiers.has(name)) this.modifiers.set(name, []);
        this.modifiers.get(name)!.push({ pluginName, handler });
        
        if (!this.pluginRegisteredModifiers.has(pluginName)) this.pluginRegisteredModifiers.set(pluginName, []);
        this.pluginRegisteredModifiers.get(pluginName)!.push(name);
    }

    getArchetype(id: string) {
        return this.archetypes.get(id);
    }

    getArchetypes() {
        return Array.from(this.archetypes.values());
    }

    async getEnabledVoiceIntents(inventoryId: number): Promise<VoiceIntentRegistration[]> {
        const inventory = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
        const config = this.parseConfig(inventory?.enabledPlugins);
        return Array.from(this.voiceIntents.values()).filter(intent => {
            const pluginConf = config[intent.pluginName];
            return pluginConf?.active && (!pluginConf.voiceIntents || pluginConf.voiceIntents.includes('*') || pluginConf.voiceIntents.includes(intent.def.id));
        });
    }

    async getEnabledVoiceVocabulary(inventoryId: number): Promise<Record<string, string>> {
        const inventory = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
        const config = this.parseConfig(inventory?.enabledPlugins);
        const combined: Record<string, string> = {};
        
        for (const [pluginName, replacements] of this.voiceVocabularies.entries()) {
            if (config[pluginName]?.active) {
                Object.assign(combined, replacements);
            }
        }
        return combined;
    }

    async applyModifiers(name: ModifierName, value: any, context: any = {}): Promise<any> {
        const mods = this.modifiers.get(name) || [];
        let config: any = null;
        if (context.inventoryId) {
            try {
                const inventory = await db.inventory.findUnique({ where: { id: context.inventoryId }, select: { enabledPlugins: true } });
                config = this.parseConfig(inventory?.enabledPlugins);
            } catch (err) {}
        }

        let result = value;
        for (const mod of mods) {
            if (config && (!config[mod.pluginName]?.active || (!config[mod.pluginName].modifiers.includes('*') && !config[mod.pluginName].modifiers.includes(name)))) {
                continue;
            }
            try {
                const modified = await mod.handler(result, context);
                if (modified !== undefined) {
                    result = modified;
                }
            } catch (err) {
                sysLog.error(`[ExtensionManager] Modifier '${name}' in plugin ${mod.pluginName} failed:`, err);
            }
        }
        return result;
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
            meta: this.pluginMetadata.get(name) || {},
            hooks: this.pluginSubscriptions.get(name) || [],
            actions: this.pluginRegisteredActions.get(name) || [],
            modifiers: this.pluginRegisteredModifiers.get(name) || [],
            voiceIntents: this.pluginRegisteredVoiceIntents.get(name) || [],
            vocabCount: Object.keys(this.voiceVocabularies.get(name) || {}).length,
            archetypes: this.pluginRegisteredArchetypes.get(name) || []
        }));
    }

	/**
	 * Returns UI actions registered by currently enabled plugins for a specific Trove.
	 */
	async getEnabledItemActions(inventoryId: number): Promise<ItemActionDef[]> {
		const inventory = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
		const config = this.parseConfig(inventory?.enabledPlugins);
		return Array.from(this.itemActions.values())
			.filter(action => config[action.pluginName]?.active && (config[action.pluginName].actions.includes('*') || config[action.pluginName].actions.includes(action.id)))
			.map(({ id, label, icon, urlTemplate, mode }) => ({ id, label, icon, urlTemplate, mode }));
	}
	
	/**
	 * Checks if there is at least one active, whitelisted plugin listening to a specific event.
	 * Useful for conditionally hiding UI elements (like Print buttons) when no handler exists.
	 */
	async hasActiveListeners(event: EventName, inventoryId: number): Promise<boolean> {
		const hooks = this.listeners.get(event) || [];
		if (hooks.length === 0) return false;
		
		const inventory = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
		const config = this.parseConfig(inventory?.enabledPlugins);
		
		// Return true if at least one hook is active and permitted
		return hooks.some(hook => config[hook.pluginName]?.active && (config[hook.pluginName].hooks.includes('*') || config[hook.pluginName].hooks.includes(event)));
	}
	
    /**
     * Wraps execution in a basic leaky-bucket rate limiter and exponential backoff.
     * Prevents Troves from getting IP-banned by external APIs during mass-scan/bulk-import 
     * events where dozens of items might trigger the same plugin simultaneously.
     */
    private async executeWithRetryAndLimits(pluginName: string, config: HookOptions, fn: () => Promise<any>) {
		const maxRetries = config.maxRetries || 1;
		const retryDelayMs = config.retryDelayMs || 2000;
        const rateLimitRpm = config.rateLimitRpm ?? 30; // Protect 3rd party APIs with 30 RPM default limit
		
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
     * Executes a plugin action synchronously and returns a resolved URL for redirection.
     * Used by the Magic Redirect proxy for plugins running in { mode: 'resolve' }.
     */
    async resolveItemAction(actionId: string, payload: any): Promise<string | null> {
        const action = this.itemActions.get(actionId);
        if (!action || !action.handler || action.mode !== 'resolve') {
            sysLog.warn(`[ExtensionManager] Action ${actionId} is not a valid resolver.`);
            return null;
        }

        const prefix = `[Plugin:${action.pluginName}]`;
        sysLog.debug(`${prefix} Resolving dynamic URL for '${action.label}'...`);
        const startTime = Date.now();
        
        try {
            let url: string | null = null;
            await this.executeWithRetryAndLimits(action.pluginName, action, async () => {
                url = await action.handler!(payload);
            });
            
            const duration = Date.now() - startTime;
            sysLog.info(`${prefix} Resolved URL for '${action.label}' successfully in ${duration}ms.`);
            return url;
        } catch (err) {
            sysLog.error(`${prefix} Error resolving action '${action.label}':`, err);
            return null;
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
		
        (async () => {
            let config: any = null;
            const inventoryId = payload?.context?.inventoryId;
            if (inventoryId) {
                try {
                    const inventory = await db.inventory.findUnique({ where: { id: inventoryId }, select: { enabledPlugins: true } });
                    config = this.parseConfig(inventory?.enabledPlugins);
                } catch (err) {}
            }

            const activeHooks = config ? hooks.filter(hook => config[hook.pluginName]?.active && (config[hook.pluginName].hooks.includes('*') || config[hook.pluginName].hooks.includes(event))) : hooks;
            if (activeHooks.length === 0) return;

            sysLog.info(`[ExtensionManager] Event '${event}' fired. Queuing ${activeHooks.length} plugin hook(s).`);
            
            for (const hook of activeHooks) {
                const prefix = `[Plugin:${hook.pluginName}]`;
                
                // Extract entity name if available for UI display
                const entityName = payload?.entity?.name ? ` for ${payload.entity.name}` : (payload?.entity?.title ? ` for ${payload.entity.title}` : '');
                const description = `${hook.pluginName} ➔ ${event}${entityName}`;
                
                ioQueue.add(async () => {
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
                }, { targetType: 'plugin', targetId: 0, description });
            }
        })();
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
		}, { targetType: 'plugin', targetId: 0, description });
	}
	
    async reloadPlugins() {
        sysLog.info('[ExtensionManager] Hot-reloading all plugins...');
        this.listeners.clear();
        this.itemActions.clear();
        this.pluginSubscriptions.clear();
        this.pluginRegisteredActions.clear();
        this.pluginRegisteredModifiers.clear();
        this.pluginRegisteredArchetypes.clear();
        this.pluginRegisteredVoiceIntents.clear();
        this.loadedPluginNames.clear();
        this.modifiers.clear();
        this.voiceIntents.clear();
        this.voiceVocabularies.clear();
        this.pluginMetadata.clear();
        this.archetypes.clear();
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
                    const content = fs.readFileSync(pluginPath, 'utf-8');
                    this.pluginMetadata.set(file, extractPluginMeta(content));


                    // Shadow Copy Technique: Node's ES Module loader aggressively caches based on the 
                    const itemOps = createItemOpsSandbox();
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
                            registerArchetype: (def: any) => this.registerArchetype(file, def),
                            addModifier: (name: ModifierName, handler: any) => this.addModifier(file, name, handler),
                            registerVoiceIntent: (def: VoiceIntentDef, handler: VoiceIntentHandler) => this.registerVoiceIntent(file, def, handler),
                            registerVoiceVocabulary: (replacements: Record<string, string>) => this.registerVoiceVocabulary(file, replacements),
							sysLog,
							logActivity,
							fetch,
							env,
                            db, // The keys to the kingdom
                            itemOps
						});
						const subs = this.pluginSubscriptions.get(file) || [];
						const actions = this.pluginRegisteredActions.get(file) || [];
                        const mods = this.pluginRegisteredModifiers.get(file) || [];
                        const archs = this.pluginRegisteredArchetypes.get(file) || [];
                        const voices = this.pluginRegisteredVoiceIntents.get(file) || [];
                        sysLog.info(
                            `[ExtensionManager] Loaded plugin: ${file} ➔ ` +
                            `Hooks: [${subs.length ? subs.join(', ') : 'none'}]` +
                            ` | UI Actions: [${actions.length ? actions.join(', ') : 'none'}]` +
                            ` | Voice: [${voices.length ? voices.join(', ') : 'none'}]`
                        );
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
