# Extension Triggers & Payloads

## System Events
Events are fired unconditionally by the system. Extensions listen to these events and decide whether or not to act based on the `intent` or `context` provided.

### `onContainerCreated`
Fires when a new spatial container or nested tray is saved to the database.
**Payload Structure:**
- `entity` (Object): The Prisma Container entity.
- `context.user` (Object): The user who created the container.
- `context.inventoryId` (Number): The active Trove ID.
- `intent.printLabel` (boolean): Flag indicating if a physical label is requested.
- `intent.labelSize` ('small' | 'large'): Enum for the requested format.

### `onPrintLabelRequested`
Fires when a user manually requests a label reprint from the UI.
**Payload Structure:**
- `entity` (Object): The Prisma Container entity.
- `context.user` (Object): The user who requested the print.
- `context.inventoryId` (Number): The active Trove ID.
- `intent.labelSize` ('small' | 'large'): Enum for the requested format.

---

## UI Actions
Instead of listening to system events, plugins can inject explicit buttons into the Troves interface.

### `registerItemAction(definition, handler?)`
Adds a button to the "..." menu of an Item.
**Definition Structure:**
- `id` (String): Unique identifier for the action.
- `label` (String): The text displayed on the button.
- `icon` (String): Optional Bootstrap Icon class (e.g., `bi-google`).
- `urlTemplate` (String): Optional. If provided, the UI renders a `<a target="_blank">` client-side link instead of a background job. Supports `{{title}}` interpolation.

**Payload Structure (if handler is provided):**
Executes in the `ioQueue`. Matches the "Fat Payload" pattern (`entity` is the Item, plus `context.user` and `context.inventoryId`).

---

## Future Events (To Be Implemented)
*The engine is designed to scale. As new integrations (like Google Books or Farnell scraping) are needed, we will add hooks here.*

- **`onItemAdded`**: Will fire when a new item is captured via single, multi, or rapid scan.
- **`onItemUpdated`**: Will fire when an item's attributes or details are manually modified.
- **`onDeepScanCompleted`**: Will fire after a spatial map deep scan finishes processing.

