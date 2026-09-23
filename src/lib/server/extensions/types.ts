export type EventName = 'onContainerCreated' | 'onItemAdded' | 'onItemUpdated' | 'onItemProcessed' | 'onPrintLabelRequested';
export type EventHandler = (payload: any) => Promise<any>;
export type HookOptions = { maxRetries?: number; retryDelayMs?: number; rateLimitRpm?: number };
export type ItemActionDef = { id: string; label: string; icon?: string; urlTemplate?: string; mode?: 'queue' | 'resolve' } & HookOptions;

export type ModifierName = 'beforeVisionClassification';

export type HookRegistration = { pluginName: string; handler: EventHandler; options?: HookOptions };
export type ModifierRegistration = { pluginName: string; handler: (value: any, context: any) => any | Promise<any> };

export type VoiceIntentDef = { id: string; regex: RegExp };
export type VoiceIntentHandler = (match: RegExpMatchArray, context: { inventoryId: number, user: any }) => Promise<{ query?: string, spokenReply: string | null, route?: string }>;
export type VoiceIntentRegistration = { pluginName: string; def: VoiceIntentDef; handler: VoiceIntentHandler };
