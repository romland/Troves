# Troves Extension Engine

AKA modding is fun. You get to feature creep and add bloat without consequences!

The Extension Engine abstracts external integrations (API calls, scrapers, physical hardware) away from the core business logic using an Event-Action paradigm.

## Core Tenets
1. **Asynchronous by Default:** All extensions execute inside the `ioQueue`. They must never block SvelteKit endpoints or delay the `invalidateAll()` loop for the end-user.
2. **Live Telemetry & Activity Tracking:** Every plugin hook execution is automatically wrapped with start/finish telemetry and piped directly into the Troves **System Activity** panel and server logs (`[Plugin:filename]`).
3. **Stateless Secrets:** Extensions must read tokens and API keys strictly from the server's `.env` runtime context. Credentials are never written to the SQLite database.
4. **Inversion of Control (Drop-In):** The core Troves codebase knows nothing about specific printers or external APIs. It simply broadcasts events. Independent `.js` files dropped into `data/plugins/` decide if they want to listen and act.
5. **The Bouncer (Per-Trove Whitelisting):** Plugins are toggled securely per-Trove. The core engine drops triggers if the plugin isn't explicitly enabled for the active inventory, preventing API spam across unrelated items.

## Execution Paradigms
Extensions interact with Troves in two distinct ways:
1. **System Events (`on`):** Implicit, background reactions to things happening in the system (e.g., a container is created, so print a label).
2. **UI Actions (`registerItemAction`):** Explicit buttons injected directly into the Svelte frontend (e.g., "Fetch Manual" or "Search Google") that users manually click.

## The "Fat Payload" Pattern
To prevent plugins from constantly pinging the database to figure out *who* triggered an event or *where* it happened, all triggers utilize a standardized "Fat Payload" consisting of three distinct buckets:

```typescript
{
  entity: any;  // The core object that was created/modified (e.g., the Container, the Item)
  context: {    // The environment state at the time of the event
    user: any;
    inventoryId: number;
  };
  intent: any;  // Transient UI requests or metadata (e.g., { printLabel: true })
}
