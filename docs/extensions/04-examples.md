# Plugin Cookbook & Examples

This section contains real-world examples of plugins to demonstrate how to leverage the Troves Extension Engine. You can copy these files directly into your `data/plugins/` directory and modify them to suit your needs.

---

## 1. Custom Thermal Label Printer (Label Studio)

**Suggested Filename:** `data/plugins/label-studio.js`

**The Goal:** Automatically print physical thermal labels (containing QR codes and container names) when creating new storage boxes in Troves.

**How it works:**
- It listens to the automatic `onContainerCreated` event and the manual `onPrintLabelRequested` event.
- It intercepts the `intent` payload to determine if the user actually wanted to print a label (`intent.printLabel`), and whether they wanted the `small` or `large` format.
- It safely reads the printer's local IP and API key from the `.env` file.
- It executes sequentially in the background `ioQueue`, ensuring the Troves UI never freezes while waiting for the printer to spool.

```javascript
/**
 * This plugin depend on two .env keys:
 *      EXT_PRINTER_URL="http://192.168.178.194:8080"
 *      EXT_PRINTER_API_KEY="xxx"
 * 
 * ...but is other than that completely stand-alone. Just dump it in Troves' data/plugins/
 */
export default function register({ on, sysLog, fetch, env }) {
    async function printContainerLabel(entity, size) {
        const apiUrl = env.EXT_PRINTER_URL;
        const token = env.EXT_PRINTER_API_KEY;
        
        if (!apiUrl || !token) {
            sysLog.warn("Label Studio plugin skipped: EXT_PRINTER_URL or EXT_PRINTER_API_KEY is missing from .env");
            return;
        }
        
        try {
            // Generate QR Code
            const qrRes = await fetch(`${apiUrl}/api/barcode`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 'qr', data: entity.name })
            });
            
            if (!qrRes.ok) throw new Error(`Barcode generation failed: ${qrRes.statusText}`);
            const qrData = await qrRes.json();
            
            // Build Render Engine Layout
            const items = [{ type: 'image', data: qrData.image }];
            
            if (size === 'large') {
                items.push({
                    type: 'text',
                    content: entity.name,
                    size: 80,
                    align: 'center'
                });
            }
            
            // Dispatch to Label Studio Queue
            const printRes = await fetch(`${apiUrl}/api/v1/print`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ items, auto_length: true })
            });
            
            if (!printRes.ok) throw new Error(`Print queue rejected: ${printRes.statusText}`);
            sysLog.info(`[Label Studio Plugin] Successfully queued print job for container: ${entity.name}`);
            
        } catch (error) {
            sysLog.error(`[Label Studio Plugin] Printer extension failed:`, error);
        }
    }
    
    on('onContainerCreated', async (payload) => {
        if (payload.intent.printLabel) {
            await printContainerLabel(payload.entity, payload.intent.labelSize || 'large');
        }
    });
    
    on('onPrintLabelRequested', async (payload) => {
        await printContainerLabel(payload.entity, payload.intent.labelSize || 'large');
    });
}
```
