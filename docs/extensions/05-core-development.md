# Adding New Core Events

When building new features in Troves, you may want to expose new system events (like `onItemAdded`, `onDeepScanCompleted`, or `onUserRegistered`) to the plugin ecosystem. 

Because the Extension Engine uses strict TypeScript types, adding a new event requires updating the core engine before you can trigger it.

## Step 1: Register the Event Type
To ensure type safety and prevent typos, all valid event names must be explicitly defined.

Open `src/lib/server/extensions/types.ts` and add your new event string to the `EventName` union type:

```typescript
// src/lib/server/extensions/types.ts
export type EventName = 
    | 'onContainerCreated' 
    | 'onPrintLabelRequested'
    | 'onItemAdded'; // <-- Your new event

```

## Step 2: Trigger the Event

Find the logical conclusion of the action in your SvelteKit backend (usually inside a `+page.server.ts` action or an API route in `src/routes/api/...`).

Import the `extensionManager` and fire the trigger. **You must strictly adhere to the "Fat Payload" pattern.** Plugins rely on this standard shape to avoid querying the database themselves.

```typescript
import { extensionManager } from '$lib/server/extensions/ExtensionManager';

// ... inside your database creation logic ...

const item = await db.item.create({ data: { ... } });

// 1. Construct the Fat Payload
extensionManager.trigger('onItemAdded', {
    entity: item,                   // The core object created/modified
    context: {
        user: locals.user,          // Always pass the acting user
        inventoryId: locals.activeInventoryId // The silo the event happened in
    },
    intent: {
        // Any transient UI data (e.g., checkboxes, dropdown values)
        // that isn't saved to the DB but might matter to a plugin.
        isRapidScan: mode === 'rapid' 
    }
});

```

## Step 3: Document It

Whenever you add a new trigger to the core system, immediately document its exact payload structure in `docs/extensions/02-triggers-and-actions.md` so plugin developers (and future you) know what variables are available in the `entity` and `intent` objects.

## Guidelines for Core Triggers

* **Never `await` the trigger:** `extensionManager.trigger` pushes the execution to the background `ioQueue`. Do not `await` it in your route handlers, or you will accidentally block the UI waiting for plugins to finish.
* **Always fire unconditionally:** Even if `intent.someAction` is false, fire the event anyway. Another plugin might be listening to the same event for a completely different reason (e.g., auditing or webhooks). Let the plugins evaluate the intent.
