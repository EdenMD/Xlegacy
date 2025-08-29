const TelegramBot = require('node-telegram-bot-api');
const makeWASocket = require('@whiskeysockets/baileys').default; // Using @whiskeysockets/baileys
const {
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion // NEW: For fetching latest version
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const { Storage } = require("megajs");
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');
const { Boom } = require('@hapi/boom');

// --- Configuration ---
// Telegram Bot Token (from environment variables)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Mega.nz credentials (from environment variables)
const MEGA_EMAIL = process.env.MEGA_EMAIL;
const MEGA_PASS = process.env.MEGA_PASS;

// Bot Version for welcome message
const BOT_VERSION = "King-MD Session Bot v1.2.0 (WhiskeyBaileys)"; // ⭐ UPDATED: Bot Version

// --- Initialize Telegram Bot ---
if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN environment variable is not set. Exiting.");
    process.exit(1);
}
const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Increased logging level to 'info' for better debugging visibility
const logger = pino({ level: "info" }).child({ level: "info" });

// Ensure EventEmitter defaultMaxListeners is increased
require('events').EventEmitter.defaultMaxListeners = 500;

// ⭐ NEW: Verify Telegram Bot Token immediately on startup
(async () => {
    try {
        const botInfo = await telegramBot.getMe();
        console.log(`Telegram bot "${botInfo.username}" started and connected.`);
    } catch (e) {
        console.error(`ERROR: Failed to connect to Telegram API. Is TELEGRAM_BOT_TOKEN correct and valid? Details:`, e.message);
        process.exit(1);
    }
})();


// Function to ensure a module is installed
function ensureModule(moduleName) {
    try {
        require.resolve(moduleName);
    } catch (e) {
        console.log(`Module "${moduleName}" not found. Installing...`);
        try {
            execSync(`npm install ${moduleName}`, { stdio: 'inherit' });
            console.log(`Module "${moduleName}" installed successfully.`);
        } catch (installError) {
            console.error(`Failed to install module "${moduleName}":`, installError.message);
            process.exit(1); // Exit if critical module can't be installed
        }
    }
}

// Ensure all required modules are installed
ensureModule('node-telegram-bot-api');
ensureModule('@whiskeysockets/baileys'); // Ensure "@whiskeysockets/baileys" is checked
ensureModule('pino');
ensureModule('megajs');
ensureModule('uuid');
ensureModule('@hapi/boom');

// Function to generate a unique ID
function kingid() {
    return uuidv4();
}

// Function to generate a random Mega ID (for filename)
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

// Function to upload credentials to Mega
async function uploadCredsToMega(credsPath) {
    if (!MEGA_EMAIL || !MEGA_PASS) {
        throw new Error("Mega.nz credentials are not set. Skipping upload. Please set MEGA_EMAIL and MEGA_PASS environment variables.");
    }

    try {
        const storage = await new Storage({
            email: MEGA_EMAIL,
            password: MEGA_PASS
        }).ready;
        logger.info('Mega storage initialized.');

        if (!fs.existsSync(credsPath)) {
            throw new Error(`File not found: ${credsPath}`);
        }

        const fileSize = fs.statSync(credsPath).size;
        const uploadResult = await storage.upload({
            name: `${randomMegaId()}.json`,
            size: fileSize
        }, fs.createReadStream(credsPath)).complete;

        logger.info('Session successfully uploaded to Mega.');
        const fileNode = storage.files[uploadResult.nodeId];
        const megaUrl = await fileNode.link();
        logger.info(`Session Url: ${megaUrl}`);
        return megaUrl;
    } catch (error) {
        logger.error('Error uploading to Mega:', error);
        throw error;
    }
}

// Function to remove a file/directory
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
    logger.info(`Removed: ${FilePath}`);
    return true;
}

// Global variable to store active pairing processes by chat ID
// Will store { sock: BaileysInstance, sessionPath: string, isCancelling: boolean, method: 'code'|'qr', lastPairingInfoSent: { type: 'qr' | 'code' | 'session_id', value: string, timestamp: Date } | null }
const activePairings = new Map();

// ⭐ UPDATED: startPairing now uses @whiskeysockets/baileys logic
async function startPairing(chatId, num, method = 'code', isReconnect = false) {
    if (activePairings.has(chatId) && !isReconnect) {
        await telegramBot.sendMessage(chatId, "🚫 A pairing process is already active for this chat. Please wait for it to complete or use /cancel to stop it.", { parse_mode: 'Markdown' });
        return;
    }

    const id = uuidv4(); // Generate unique ID for this session
    let sessionPath = `./temp_sessions/${id}`; // Use a dedicated temp folder

    if (!fs.existsSync('./temp_sessions')) {
        fs.mkdirSync('./temp_sessions');
    }

    // ⭐ CRITICAL CHANGE: ONLY REMOVE SESSION PATH IF IT'S A NEW (NON-RECONNECT) ATTEMPT
    if (!isReconnect) {
        removeFile(sessionPath);
    } else {
        const existingEntry = activePairings.get(chatId);
        if (existingEntry && existingEntry.sessionPath) {
            sessionPath = existingEntry.sessionPath; // Use the existing session path
            logger.info(`Reconnecting using existing session path: ${sessionPath} for chat ${chatId}`);
        } else {
            logger.error(`Logic error: isReconnect true but no existing sessionPath found for chat ${chatId}. Treating as new.`);
            removeFile(sessionPath); // Ensure clean slate if we're forced to make a new path unexpectedly
        }
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion(); // NEW: Fetch latest Baileys version

    let sock; // Renamed from King to sock for @whiskeysockets/baileys
    let currentPairingInMainScope; // Declared here to be available throughout the try block

    try {
        sock = makeWASocket({ // Updated from King_Tech to makeWASocket
            version, // Using fetched version
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false, // Don't print QR to terminal, we'll send to Telegram
            logger: logger,
            // ⭐ UPDATED BROWSER AGENT
            browser: ['Ubuntu', 'Chrome', '121.0.6167.85'], 
            connectTimeoutMs: 60000 // 60s timeout for initial connection
        });

        // Store or update the active pairing details
        if (!isReconnect) {
            activePairings.set(chatId, { sock: sock, sessionPath: sessionPath, isCancelling: false, method: method, lastPairingInfoSent: null });
        } else {
            const existingEntry = activePairings.get(chatId);
            if (existingEntry) {
                existingEntry.sock = sock;
                activePairings.set(chatId, existingEntry);
            } else {
                logger.error(`Logic error: isReconnect true but no active pairing found for chat ${chatId}. Treating as new.`);
                activePairings.set(chatId, { sock: sock, sessionPath: sessionPath, isCancelling: false, method: method, lastPairingInfoSent: null });
            }
        }

        currentPairingInMainScope = activePairings.get(chatId);
        if (!currentPairingInMainScope) {
            throw new Error("Internal error: Could not retrieve active pairing info after initialization.");
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (s) => {
            let connection = null;
            let lastDisconnect = null;
            let qr = null;

            if (s && typeof s === 'object') {
                connection = s.connection;
                lastDisconnect = s.lastDisconnect;
                qr = s.qr;
            } else {
                logger.error(`Connection update received invalid payload (not an object): ${JSON.stringify(s)} for chat ${chatId}`);
                if (sock && sock.ws && sock.ws.readyState !== sock.ws.CLOSED && sock.ws.readyState !== sock.ws.CLOSING) {
                    try { await sock.ws.close(); } catch (e) { logger.error(`Error closing sock ws during invalid update for chat ${chatId}: ${e.message}`); }
                }
                return;
            }

            const currentPairing = activePairings.get(chatId);
            if (!currentPairing || currentPairing.isCancelling) {
                logger.info(`Connection update ignored for chat ${chatId} due to cancellation or no active pairing.`);
                if (sock && sock.ws && sock.ws.readyState !== sock.ws.CLOSED && sock.ws.readyState !== sock.ws.CLOSING) {
                    try { await sock.ws.close(); } catch (e) { logger.error(`Error closing sock ws during ignored update for chat ${chatId}: ${e.message}`); }
                }
                return;
            }

            if (connection === "connecting") {
                await telegramBot.sendMessage(chatId, "🔄 WhatsApp connection status: *Connecting...* Please wait.", { parse_mode: 'Markdown' });
            } else if (connection === "open") {
                await telegramBot.sendMessage(chatId, "✅ WhatsApp connection status: *Connected!* Your device is now linked.", { parse_mode: 'Markdown' });
                logger.info(`WhatsApp connection opened successfully for chat ${chatId}.`);

                if (sock.authState.creds.registered && !currentPairing.lastPairingInfoSent) {
                    await delay(5000); 

                    const filePath = `${sessionPath}/creds.json`; 

                    if (!fs.existsSync(filePath)) {
                        logger.error(`File not found: ${filePath} for chat ${chatId}`);
                        await telegramBot.sendMessage(chatId, "❌ Error: Session credentials file (creds.json) not found after connection open. This might indicate an issue. Please try `/code <number>` or `/qr` again.", { parse_mode: 'Markdown' });
                        await sock.logout(); 
                        removeFile(sessionPath);
                        activePairings.delete(chatId);
                        return;
                    }

                    try {
                        const megaUrl = await uploadCredsToMega(filePath);
                        const sid = megaUrl.includes("https://mega.nz/file/")
                            ? 'King~' + megaUrl.split("https://mega.nz/file/")[1]
                            : 'Error: Invalid Mega URL after upload';

                        logger.info(`Generated Session ID for chat ${chatId}: ${sid}`);

                        const KING_TEXT = `
*✅ SESSION ID GENERATED SUCCESSFULLY! ✅*
______________________________
╔════◇
║ 『 𝐘𝐎𝐔'𝐕𝐄 𝐂𝐇𝐎𝐒𝐄𝐍 𝐊𝐈𝐍𝐆 𝐌𝐃 』
╚══════════════╝
╔═════◇
║ 『••• 𝗩𝗶𝘀𝗶𝘁 𝗙𝗼𝗿 𝗛𝐞𝐥𝐩 •••』
║❒ 𝐓𝐮𝐭𝐨𝐫𝐢𝐚𝐥: _[Your King-MD YouTube/Tutorial Link Here]_
║❒ 𝐎𝐰𝐧𝐞𝐫: _[Your Owner Contact Link Here]_
║❒ 𝐑𝐞𝐩𝐨: _[Your King-MD Repo Link Here]_
║❒ 𝐖𝐚𝐂𝐡𝐚𝐧𝐧𝐞𝐥: _[Your King-MD WhatsApp Channel Here]_
║ 💜💜💜
╚══════════════╝
 𝗞𝗜𝗡𝗚-𝗠𝗗 𝗩𝗘𝗥𝗦𝗜𝗢. 5.0.0
______________________________

🎉 Use your Session ID above to Deploy your King-MD Bot!`;

                        await telegramBot.sendMessage(chatId, `Your new Session ID is:\n\`\`\`\n${sid}\n\`\`\`\n${KING_TEXT}`, { parse_mode: 'Markdown' });

                        logger.info(`Session ID sent to Telegram for chat ${chatId}.`);
                        currentPairing.lastPairingInfoSent = { type: 'session_id', value: sid, timestamp: new Date() }; 
                    } catch (uploadError) {
                        logger.error(`Failed to upload session to Mega.nz for chat ${chatId}:`, uploadError.message);
                        await telegramBot.sendMessage(chatId, `❌ Failed to upload session to Mega.nz. Error: ${uploadError.message}. Please try again.`, { parse_mode: 'Markdown' });
                    } finally {
                        await delay(100);
                        await sock.logout(); 
                        removeFile(sessionPath);
                        if (activePairings.has(chatId)) {
                            activePairings.delete(chatId); 
                        }
                    }
                } else if (!sock.authState.creds.registered && currentPairing.lastPairingInfoSent) {
                    const now = new Date();
                    const lastSentTime = currentPairing.lastPairingInfoSent.timestamp;
                    const timeSinceLastSent = (now.getTime() - lastSentTime.getTime()) / 1000; 

                    if (timeSinceLastSent > 30) { 
                        await telegramBot.sendMessage(chatId, "🔄 Reconnected! Your previous QR/code might have expired. Please wait, I'm trying to get new pairing information.", { parse_mode: 'Markdown' });
                        currentPairing.lastPairingInfoSent = null; 
                    } else {
                         await telegramBot.sendMessage(chatId, "🔄 Reconnected! Please continue with the previously sent pairing information.", { parse_mode: 'Markdown' });
                    }
                }
                
                if (sock.authState.creds.registered && currentPairing.lastPairingInfoSent && currentPairing.lastPairingInfoSent.type === 'session_id') {
                    logger.info(`Chat ${chatId}: Reconnected but session ID already delivered. Cleaning up.`);
                    await sock.logout();
                    removeFile(sessionPath);
                    activePairings.delete(chatId);
                }
                return;
            } else if (connection === "close") {
                let messageToUser = "❌ WhatsApp connection status: *Closed*.\n";

                const boomError = new Boom(lastDisconnect?.error);
                const statusCode = boomError?.output?.statusCode;
                const reasonText = lastDisconnect?.error?.reason || 'No specific reason provided';
                const isErrorEmpty = Object.keys(lastDisconnect?.error || {}).length === 0;

                const isPermanentDisconnect = statusCode === DisconnectReason.loggedOut || (statusCode === DisconnectReason.badSession && !isErrorEmpty) || statusCode === 401;

                if (currentPairing.isCancelling) {
                    logger.info(`Connection for chat ${chatId} closed due to explicit cancellation.`);
                    await telegramBot.sendMessage(chatId, "✅ The pairing process has been cancelled.", { parse_mode: 'Markdown' });
                    removeFile(sessionPath);
                    activePairings.delete(chatId);
                    return;
                }
                else if (isPermanentDisconnect) {
                    messageToUser += `Reason: _Permanent session issue - Logged Out (Status ${statusCode}). This means your WhatsApp session on the phone was either closed, or you linked another device. Please try pairing again with \`${currentPairing.method === 'qr' ? '/qr' : '/code <number>'}\` for a fresh session._\n`;
                    await telegramBot.sendMessage(chatId, messageToUser, { parse_mode: 'Markdown' });
                    logger.warn(`Permanent disconnect for chat ${chatId}. Full disconnect object:`, lastDisconnect);
                    removeFile(sessionPath);
                    activePairings.delete(chatId);
                    return; 
                }
                else { 
                    messageToUser += `Reason: _Temporary connection issue with WhatsApp (Status ${statusCode || 'Unknown'} - ${reasonText}). Attempting to reconnect automatically..._\n`;
                    await telegramBot.sendMessage(chatId, messageToUser, { parse_mode: 'Markdown' });
                    logger.warn(`Transient disconnect for chat ${chatId}. Full disconnect object:`, lastDisconnect);
                }
                return; 
            }

            if (qr && currentPairing.method === 'qr' && !sock.authState.creds.registered) {
                const now = new Date();
                const timeSinceLastSent = currentPairing.lastPairingInfoSent ? (now.getTime() - currentPairing.lastPairingInfoSent.timestamp.getTime()) / 1000 : Infinity;

                if (!currentPairing.lastPairingInfoSent || (currentPairing.lastPairingInfoSent.type === 'qr' && currentPairing.lastPairingInfoSent.value !== qr) || timeSinceLastSent > 30) {
                    await telegramBot.sendMessage(chatId, "📸 Please scan this QR code with your WhatsApp app:", { parse_mode: 'Markdown' });
                    await telegramBot.sendPhoto(chatId, Buffer.from(qr.split(',')[1], 'base64'), { 
                        caption: "WhatsApp QR Code (expires in 60 seconds)",
                        filename: 'whatsapp_qr.png', 
                        contentType: 'image/png'     
                    });
                    await telegramBot.sendMessage(chatId, "_If this QR code expires or you're having trouble scanning, a new one will be sent if the connection permits._", { parse_mode: 'Markdown' });
                    currentPairing.lastPairingInfoSent = { type: 'qr', value: qr, timestamp: new Date() };
                }
            }
        });

        if (!sock.authState.creds.registered) {
            if (currentPairingInMainScope.method === 'code') {
                if (num && num.trim() !== '') {
                    await telegramBot.sendMessage(chatId, `🚀 Requesting pairing code for number: *${num}*...`, { parse_mode: 'Markdown' });
                    await delay(1500);
                    const cleanNum = num.replace(/[^0-9]/g, '');
                    const code = await sock.requestPairingCode(cleanNum); // ⭐ Using sock.requestPairingCode
                    if (code) {
                        await telegramBot.sendMessage(chatId,
                            `✅ Your 8-digit Pairing Code is:\n\`\`\`${code}\`\`\`\n\n` +
                            `*Follow these steps on your main WhatsApp mobile app:*\n` +
                            `1. Open *WhatsApp* on your main phone.\n` +
                            `2. Go to *Settings* (or three dots menu on Android) -> *Linked Devices*.\n` +
                            `3. Tap on *Link a Device*.\n` +
                            `4. If prompted, select *Link with phone number*.\n` +
                            `5. Enter the \`${code}\` (8-digit) code shown above into your WhatsApp app.\n\n` +
                            `_Please complete this within 60 seconds as the code may expire._`,
                            { parse_mode: 'Markdown' });
                        currentPairingInMainScope.lastPairingInfoSent = { type: 'code', value: code, timestamp: new Date() }; 
                    } else {
                        await telegramBot.sendMessage(chatId, "❌ Failed to get a pairing code. This might be due to a temporary WhatsApp server issue, network problem, or an invalid number format. Please ensure your number is correct (e.g., 254712345678) and try again with `/code <number>`.", { parse_mode: 'Markdown' });
                        await sock.logout(); 
                        removeFile(sessionPath);
                        activePairings.delete(chatId);
                    }
                } else {
                    await telegramBot.sendMessage(chatId, "❌ Error: A WhatsApp number is required to request a pairing code. Please use: `/code <Your WhatsApp Number>` (e.g., /code 254712345678)", { parse_mode: 'Markdown' });
                    await sock.logout(); 
                    removeFile(sessionPath);
                    if (activePairings.has(chatId)) {
                        activePairings.delete(chatId);
                    }
                }
            } else if (currentPairingInMainScope.method === 'qr') { 
                 await telegramBot.sendMessage(chatId, "🔄 Generating QR code... Please wait a moment for it to appear.", { parse_mode: 'Markdown' });
            }
        }

    } catch (err) {
        logger.error(`An error occurred during pairing process for chat ${chatId}:`, err);
        await telegramBot.sendMessage(chatId, `❌ An unexpected error occurred during the pairing process: ${err.message}. Please try again with \`${method === 'qr' ? '/qr' : '/code <number>'}\`.`, { parse_mode: 'Markdown' });
        removeFile(sessionPath);
        if (activePairings.has(chatId)) {
            activePairings.delete(chatId);
        }
    }
}

// Helper to handle the /code command (specific to pairing code)
async function handleCodeCommand(msg, match) {
    const chatId = msg.chat.id;
    const whatsappNumber = match && match[1] ? match[1].trim() : '';

    if (!whatsappNumber || whatsappNumber === '') {
        await telegramBot.sendMessage(chatId, "🚫 The `/code` command requires your WhatsApp number (with country code). Example: `/code 254712345678`", { parse_mode: 'Markdown' });
        return;
    }

    await telegramBot.sendMessage(chatId, `✨ Initiating WhatsApp pairing for *${whatsappNumber}* using the pairing code method. Please stand by...`, { parse_mode: 'Markdown' });
    startPairing(chatId, whatsappNumber, 'code', false); 
}

// ⭐ NEW: Helper to handle the /qr command
async function handleQrCommand(msg) {
    const chatId = msg.chat.id;
    await telegramBot.sendMessage(chatId, `✨ Initiating WhatsApp pairing using the QR code method. Please stand by...`, { parse_mode: 'Markdown' });
    startPairing(chatId, null, 'qr', false); 
}


// Command for /start - Provides comprehensive help, updated for both methods
telegramBot.onText(/\/start/, (msg) => {
    const helpMessage = `
👋 *Hello there! I'm your King-MD Session ID Generator bot!*

${BOT_VERSION}

I can help you get a *King-MD Session ID* to deploy your WhatsApp bot seamlessly. You can choose between the secure 8-digit pairing code method or scanning a QR code.

*Here's how to get your session ID:*

*1. Using Pairing Code (Recommended):*
   Send me your WhatsApp number (with country code) using this command:
   \`\`\`/code <Your WhatsApp Number>\`\`\`
   _Example: \`/code 254712345678\`_
   I will then provide you with an 8-digit code to enter into your WhatsApp app.

*2. Using QR Code (Alternative):*
   Use this command to receive a QR code:
   \`\`\`/qr\`\`\`
   I will send you a QR code that you can scan with your WhatsApp mobile app.

*Need to stop an ongoing pairing?*
   \`\`\`/cancel\`\`\`
   This will immediately stop any active pairing process for your current chat and clean up temporary files.

*⚠️ Important Notes:*
   - Ensure your WhatsApp number is correct and includes the country code (e.g., 2547...).
   - You need to complete the pairing steps within 60 seconds as the code/QR expires quickly.
   - For me to function, these environment variables *must* be set:
     - \`TELEGRAM_BOT_TOKEN\` (your bot's token)
     - \`MEGA_EMAIL\` (for uploading session credentials securely)
     - \`MEGA_PASS\` (for uploading session credentials securely)

Choose your preferred method above to begin your journey with King-MD! Let's get started! 🚀
`;
    telegramBot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
});


// Command for /code <number>
telegramBot.onText(/\/code (.+)/, async (msg, match) => {
    await handleCodeCommand(msg, match);
});

// ⭐ NEW: Command for /qr
telegramBot.onText(/\/qr/, async (msg) => {
    await handleQrCommand(msg);
});

// Command for /cancel (remains mostly the same, ensuring robust cleanup)
telegramBot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const activePairing = activePairings.get(chatId);

    if (activePairing) {
        await telegramBot.sendMessage(chatId, "⏳ Attempting to cancel the ongoing pairing process...", { parse_mode: 'Markdown' });
        activePairing.isCancelling = true;

        try {
            // Renamed activePairing.King to activePairing.sock
            if (activePairing.sock && activePairing.sock.ws && activePairing.sock.ws.readyState === activePairing.sock.ws.OPEN) {
                await activePairing.sock.logout();
            } else if (activePairing.sock && activePairing.sock.ws && activePairing.sock.ws.readyState !== activePairing.sock.ws.CLOSED) {
                 await activePairing.sock.ws.close();
            }
            await delay(100);
        } catch (error) {
            logger.warn(`Error during sock instance logout/close for chat ${chatId}:`, error.message);
        } finally {
            if (activePairing.sessionPath) {
                removeFile(activePairing.sessionPath);
            }
            activePairings.delete(chatId);
            await telegramBot.sendMessage(chatId, "✅ The pairing process has been successfully cancelled and temporary files cleaned up.", { parse_mode: 'Markdown' });
        }
    } else {
        await telegramBot.sendMessage(chatId, "ℹ️ No active pairing process found for this chat.", { parse_mode: 'Markdown' });
    }
});

console.log("Telegram bot started. Waiting for commands!");