# Writing Troves Plugins

Troves supports a zero-config, drop-in plugin architecture. To add a new integration, simply place a `.js` file into the `data/plugins/` directory. Troves will automatically load it when the server starts.

## The Plugin Toolkit
Plugins must `export default function`. Troves securely injects a toolkit object containing everything the plugin needs to operate, so you never have to worry about internal module resolution or SvelteKit SSR rules.

### The Injected Arguments:
- `on(eventName, handler)`: Registers your listener to a system event.
- `registerItemAction(definition, handler?)`: Registers a UI button on items (can execute a background task or open a URL).
- `sysLog`: The internal logger (`sysLog.info`, `sysLog.warn`, `sysLog.error`). Use this instead of `console.log` so your logs align with the system formatting.
- `fetch`: A pure Node.js `fetch` implementation. **Always use this** instead of the global `fetch` to prevent SvelteKit SSR warnings.
- `env`: Read-only access to the server's `.env` variables for your API keys.
- `db`: Full access to the Prisma database client. Allows your plugin to read or modify Troves data (e.g., creating documents, reading tags, updating stock).

## Monitoring & Telemetry
You don't need to manually configure logging or queue tracking. Troves handles this automatically for every plugin hook:
1. **System Activity Panel:** When your plugin hook is triggered, it registers as a tracked task in the core `Disk/DB I/O` queue, displaying your plugin filename and target entity in the UI activity feed.
2. **Structured Logs:** Always use the provided `sysLog` interface (`sysLog.info`, `sysLog.warn`, `sysLog.error`) rather than raw `console.log`. Troves automatically prefixes these messages with `[Plugin: your-plugin.js]` and reports execution duration down to the millisecond.
3. **Error Isolation:** If your plugin throws an unhandled exception or fails an API request, Troves catches it in the background queue, logs the failure with the correct plugin author tag, and prevents the crash from taking down the main server thread.

## Example: A Custom Webhook Plugin
Here is how you would write a plugin that pings a Discord webhook whenever a container is created.

**File: `data/plugins/discord-notify.js`**
```javascript
export default function register({ on, sysLog, fetch, env }) {
    on('onContainerCreated', async (payload) => {
        const webhookUrl = env.DISCORD_WEBHOOK_URL;
        
        if (!webhookUrl) {
            sysLog.warn("Discord plugin skipped: DISCORD_WEBHOOK_URL missing.");
            return;
        }

        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `📦 **New Container:** ${payload.entity.name} created by ${payload.context.user.name}.`
                })
            });
            
            sysLog.info(`[Discord Plugin] Notification sent for ${payload.entity.name}`);
        } catch (err) {
            sysLog.error(`[Discord Plugin] Failed to send webhook:`, err);
        }
    });
}
```


## Distributing Plugins

Because plugins are self-contained, single files, you can share them easily via GitHub Gists. Users just download the `.js` file, put it in `data/plugins/`, configure their `.env` variables, and restart the Troves Docker container.
