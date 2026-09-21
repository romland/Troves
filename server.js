import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';

// Auto-create data folders to prevent ENOENT crashes
const imgPath = path.join(process.cwd(), 'data/images');
['u', 'containers'].forEach(sub => {
    const full = path.join(imgPath, sub);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

const app = express();
app.use('/images', express.static(imgPath, { maxAge: '1y', immutable: true }));

// Anti-Crash-Loop: Dynamically load SvelteKit ONLY if it has been built
const buildPath = path.join(process.cwd(), 'build/handler.js');
if (fs.existsSync(buildPath)) {
    import('./build/handler.js').then(({ handler }) => {
        app.use(handler);
    });
} else {
    console.warn("⚠️ SvelteKit build not found! Serving 503 fallback.");
    app.get('*', (req, res) => res.status(503).send('UI compiling in background... Please refresh in a minute.'));
}

const port = process.env.PORT || 3000;

// LAN PWA HTTPS Support
const keyPath = path.join(process.cwd(), 'key.pem');
const certPath = path.join(process.cwd(), 'cert.pem');

const isValidCertFile = (p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes('BEGIN '); }
    catch { return false; }
};

if (isValidCertFile(keyPath) && isValidCertFile(certPath)) {
    const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    https.createServer(options, app).listen(port, '0.0.0.0', () => {
        console.log(`🔒 Custom Server running securely on HTTPS port ${port}`);
    });
} else {
    http.createServer(app).listen(port, '0.0.0.0', () => {
        console.log(`⚠️ Custom Server running on HTTP port ${port} (No SSL certs found)`);
    });
}