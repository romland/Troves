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

### `onItemAdded` & `onItemUpdated`
**Instant Hooks.** These fire the millisecond an item is saved to the database. They are perfect for chat notifications (Discord/Slack webhooks) or pushing audit logs to external tools. **Warning:** Heavy ML extraction (OCR, background removal, category guessing) has not completed yet when these fire.
**Payload Structure:**
- `entity` (Object): The Prisma Item entity.
- `context.user` (Object): The user acting upon the item.
- `context.inventoryId` (Number): The active Trove ID.
- `intent.isNew` (boolean): `true` for `onItemAdded`, `false` for `onItemUpdated`.

### `onItemProcessed`
**The Late-Stage Hook.** This fires *after* all heavy async background processing (LLM Classification, OCR, background removal, duplicate sweeps) has fully completed for an item. 
**Use Cases:**
This is the hook you want for **Data Enrichment** (e.g., fetching book covers, ISBN, etc from Google APIs based, scraping technical PDFs based on the identified model number, or getting album art or checking eBay prices). 
**Payload Structure:**
- `entity` (Object): The *fully hydrated* Prisma Item entity (includes the newly extracted `.attributes`, `.photos`, and `.tags` arrays).
- `context.user` (Object): The user who initiated the save.
- `context.inventoryId` (Number): The active Trove ID.
- `intent.isNew` (boolean): Flag to determine if this item was just created (`true`) or just updated (`false`), allowing your enrichment scripts to easily skip updates if they only run on creation.

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
- `mode` (String): Optional. Defaults to `'queue'` (runs async in background). Set to `'resolve'` to enable synchronous link resolution via backend proxy.

### Execution Modes

#### 1. Background Queue (`mode: 'queue'`)
The default behavior. The UI button triggers an asynchronous background job in the `ioQueue`. The UI does not wait for a response. Ideal for heavy API calls, printing physical labels, or downloading files.

#### 2. Synchronous Link Resolvers (`mode: 'resolve'`)
When a plugin action requires dynamic data manipulation to construct a URL, but the user expects a new browser tab to open immediately, use `mode: 'resolve'`.

**How it works:**
1. The UI renders a standard HTML anchor tag (`<a target="_blank" href="/api/ext/actionId/itemId">`). This ensures mobile and desktop browsers do not trigger popup blockers.
2. Clicking the link hits a secure SvelteKit proxy endpoint.
3. The proxy invokes the plugin's `handler` synchronously.
4. The plugin performs its logic, constructs the target URL, and returns it as a string.
5. The proxy issues an HTTP `302 Found` redirect to the browser.

**Return Type Requirement:** Handlers running in `resolve` mode MUST return a valid `string` URL.

**Common Use Cases for Resolvers:**

* **Just-In-Time Taxonomy Parsing (Market Searches):**  
  Extracting and transforming dynamic KVP attributes (like JSON color arrays or sizes) into query parameters for external marketplaces (eBay, Vinted, Amazon) right when the user clicks.
  ```javascript
  registerItemAction({ id: 'market-search', label: 'Search Market', mode: 'resolve' }, async (payload) => {
      const size = payload.entity.attributes.find(a => a.key === 'Size')?.value || '';
      return `https://marketplace.example.com/search?q=${payload.entity.title}&size=${size}`;
  });
  ```

* **Dynamic Authenticated Deep Links (SSO):**  
  Generating short-lived access tokens or signing URLs securely on the backend before redirecting the user to a third-party vendor portal or protected S3 bucket.
  ```javascript
  registerItemAction({ id: 'vendor-portal', label: 'Open Vendor Portal', mode: 'resolve' }, async (payload) => {
      const token = await fetchTemporaryAuthToken(env.VENDOR_SECRET);
      return `https://vendor.example.com/portal/${payload.entity.id}?auth=${token}`;
  });
  ```

* **Local Network Device Routing (IoT):**  
  Opening the local web interface for an associated hardware device where the IP address is dynamic or stored in the database.
  ```javascript
  registerItemAction({ id: 'open-device-ui', label: 'Configure Device', mode: 'resolve' }, async (payload) => {
      const ipAddress = payload.entity.attributes.find(a => a.key === 'LAN IP')?.value;
      if (!ipAddress) throw new Error("No IP configured");
      return `http://${ipAddress}:8080/admin`;
  });
  ```

* **Format Conversion & Export Proxies:**  
  Routing the user to an external service that requires complex encoded data in the URI.
  ```javascript
  registerItemAction({ id: 'export-label', label: 'Generate PDF Label', mode: 'resolve' }, async (payload) => {
      const encodedData = Buffer.from(JSON.stringify(payload.entity)).toString('base64');
      return `https://pdf-generator.example.com/render?data=${encodedData}`;
  });
  ```

* **LLM wrote an ELI5 of the above**  
Here is why a "magic link" that thinks before it opens is better than a normal link:

* **Finding moving targets (Smart Devices):** If you have a 3D printer or a smart camera, your home internet router sometimes changes its internal web address. A normal link would just break. A magic link asks the router "where is the printer today?" right as you click it, and sends you to the right place.
* **Smart Shopping:** Let's say you click "Buy Replacement." If Troves knows the exact barcode of the item, the link drops you directly on the store's checkout page. If Troves only knows it's a generic "red shirt," the link sends you to a general search page instead. The link makes a decision based on what it knows.
* **Opening locked files securely:** If you store a highly sensitive PDF (like a tax return or a passport scan) in a private cloud vault, a normal link won't work unless you make the file public to the whole internet. A magic link quietly generates a temporary, 60-second VIP pass in the background, downloads the file for you, and then destroys the pass.
* **The Vinted Example:** Instead of a link that just searches Vinted for "shirt" (because that's what the title says), the magic link peeks into the item's details right as you click it, grabs the color, the fabric, and the brand, and builds the perfect, highly-specific search for you instantly.

Basically: A normal link is a dumb signpost. A magic link acts like a concierge that figures out exactly what you need right when you ask for it.


## Future Events (To Be Implemented)
*The engine is designed to scale. As new integrations (like Google Books or Farnell scraping) are needed, we will add hooks here.*

- **`onDeepScanCompleted`**: Will fire after a spatial map deep scan finishes processing.

