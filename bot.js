const TelegramBot = require('node-telegram-bot-api');
const pino = require("pino");
const fs = require('fs');
const { Storage } = require("megajs");
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');
const { Boom } = require('@hapi/boom');

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MEGA_EMAIL = process.env.MEGA_EMAIL;
const MEGA_PASS = process.env.MEGA_PASS;

// Bot Version for welcome message
const BOT_VERSION = "Edentech Support Bot v1.0.0";

// Path for storing uploaded file metadata (acting as a simple database)
const UPLOADS_DB_PATH = './data/uploads_db.json';
// Path for temporary file downloads
const TEMP_DOWNLOAD_DIR = './temp_downloads';

// --- Initialize Telegram Bot ---
if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN environment variable is not set. Exiting.");
    process.exit(1);
}
const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Logger for better debugging visibility
const logger = pino({ level: "info" }).child({ level: "info" });

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
ensureModule('pino');
ensureModule('megajs');
ensureModule('uuid');
ensureModule('@hapi/boom');

// Ensure necessary directories exist
if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
}
if (!fs.existsSync(TEMP_DOWNLOAD_DIR)) {
    fs.mkdirSync(TEMP_DOWNLOAD_DIR);
}


// --- Mega.nz Integration for File Uploads ---
let megaStorage = null;

async function initMegaStorage() {
    if (!MEGA_EMAIL || !MEGA_PASS) {
        logger.warn("Mega.nz credentials are not set. File upload/download features will be disabled. Please set MEGA_EMAIL and MEGA_PASS environment variables.");
        return;
    }
    try {
        megaStorage = await new Storage({
            email: MEGA_EMAIL,
            password: MEGA_PASS
        }).ready;
        logger.info('Mega storage initialized successfully.');
    } catch (error) {
        logger.error('Error initializing Mega storage. File upload/download features will be disabled:', error.message);
        megaStorage = null; // Ensure it's null if initialization fails
    }
}
initMegaStorage(); // Initialize Mega on startup

// Function to upload a file to Mega
async function uploadFileToMega(filePath, originalFileName) {
    if (!megaStorage) {
        throw new Error("Mega.nz storage is not initialized or credentials are missing.");
    }

    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found for upload: ${filePath}`);
        }

        const fileSize = fs.statSync(filePath).size;
        const megaFileName = `${uuidv4()}_${originalFileName}`; // Unique name on Mega
        
        logger.info(`Uploading ${originalFileName} (${fileSize} bytes) to Mega as ${megaFileName}...`);

        const uploadResult = await megaStorage.upload({
            name: megaFileName,
            size: fileSize
        }, fs.createReadStream(filePath)).complete;

        const fileNode = megaStorage.files[uploadResult.nodeId];
        const megaUrl = await fileNode.link();
        
        logger.info(`File "${originalFileName}" successfully uploaded to Mega. URL: ${megaUrl}`);
        return { megaFileName, megaUrl };
    } catch (error) {
        logger.error(`Error uploading "${originalFileName}" to Mega:`, error);
        throw error;
    }
}

// Function to remove a local file/directory
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
    logger.info(`Removed local file/dir: ${FilePath}`);
    return true;
}

// --- User Uploads Database (simple JSON file) ---
let userUploadsDB = {}; // { chatId: [{ file_id: string, originalName: string, megaFileName: string, megaUrl: string, uploadDate: string }] }

function loadUploadsDB() {
    if (fs.existsSync(UPLOADS_DB_PATH)) {
        try {
            userUploadsDB = JSON.parse(fs.readFileSync(UPLOADS_DB_PATH, 'utf8'));
            logger.info('User uploads database loaded.');
        } catch (error) {
            logger.error('Error loading user uploads database, starting fresh:', error.message);
            userUploadsDB = {};
        }
    }
}

function saveUploadsDB() {
    fs.writeFileSync(UPLOADS_DB_PATH, JSON.stringify(userUploadsDB, null, 2), 'utf8');
    logger.info('User uploads database saved.');
}

loadUploadsDB(); // Load database on startup

// Global variable to track users expecting a file upload
const expectingFileUpload = new Map(); // Map: chatId -> true/false


// --- Edentech Information Content ---
const EDENTECH_ABOUT = `
*🌟 About Eden Technology (Edentech) 🌟*

Edentech is a cutting-edge technology company dedicated to innovating and building robust software solutions for a connected world. We believe in harnessing the power of technology to create intuitive, efficient, and impactful products that enhance daily life and empower businesses. Our focus is on delivering high-quality, user-centric experiences across various platforms.
`;

const EDENTECH_FOUNDER = `
*👤 The Founder of Eden Technology 👤*

Eden Technology was founded by *Nyasha Munyanyiwa*, a visionary 16-year-old boy from Bulawayo, Zimbabwe. In 2025, with a passion to make the world a better place, Nyasha embarked on this journey. He lives with his mother, father, and sister, and successfully completed his O-levels in 2024, demonstrating his early commitment to education and innovation.
`;

const EDENTECH_ORIGIN = `
*🌱 The Origin Story of Eden Technology 🌱*

Edentech was born in *2025* out of a desire to bridge the gap between complex technological concepts and user-friendly applications. Nyasha Munyanyiwa envisioned a company that could not only develop powerful tools but also make them accessible and enjoyable for everyone. The journey began with a relentless pursuit of solving real-world problems through elegant code and thoughtful design, leading to the creation of foundational projects that would set the stage for Edentech's future.
`;

const EDENTECH_PROJECTS = `
*🚀 Our Flagship Projects 🚀*

Edentech prides itself on a diverse portfolio of innovative projects that demonstrate our commitment to excellence:

1.  *Xbuilder*: Our underlying system and development framework, powering many of our applications.
2.  *edenX APK*: A flagship mobile application designed for seamless user experience.
3.  *X-Player*: An advanced music player application with rich features.
4.  *Xlearners*: A dedicated platform for educational content and e-learning.
5.  *King-MD Session Bot*: (The predecessor to *this* bot!) A testament to our capabilities in bot development.

...and many other cutting-edge solutions across various domains. We are continuously exploring new frontiers in AI, blockchain, and cloud computing to bring even more transformative products to life!
`;

const EDENTECH_PROGRESS = `
*📈 Edentech's Progress & Future 📈*

Edentech is on a relentless path of growth and innovation. We are constantly updating our existing projects, exploring new technologies, and expanding our team to tackle bigger challenges.

*Recent Highlights:*
*   Successful deployment of edenX APK v2.0 with enhanced performance.
*   Integration of AI-driven features into Xlearners for personalized learning.
*   Ongoing research into decentralized applications powered by blockchain.

Stay tuned for more exciting updates and groundbreaking releases from Eden Technology!
`;

const EDENTECH_CONTACT = `
*📞 Contact Eden Technology 📞*

Have questions, feedback, or need support? We'd love to hear from you!

*Email:* techn2533@gmail.com
*Website:* [incredible-bee.static.domains](https://incredible-bee.static.domains/)
*WhatsApp Channel:* [Edentech Official](https://whatsapp.com/channel/0029VafLsm9IN9irghbQ560v)
*Phone Number:* +263716676259
`;

// --- Telegram Bot Commands ---

// Command: /start - Welcome message and menu
telegramBot.onText(/\/start/, (msg) => {
    const welcomeMessage = `
👋 *Welcome to the Eden Technology (Edentech) Support Bot!*

${BOT_VERSION}

I'm here to provide you with information about Edentech, our projects, and assist you with file uploads.

*Here are the commands you can use:*

*📚 Information:*
   /about - Learn what Edentech is.
   /founder - Discover who founded Edentech.
   /origin - Understand our origin story.
   /projects - See our ongoing projects.
   /progress - Get updates on our advancements.
   /contact - Find out how to reach us.

*📤 File Management:*
   /upload - Send me a file to securely upload to Mega.nz.
   /myuploads - View the files you've uploaded.

*❓ Help:*
   /help - Show this command menu again.
`;
    telegramBot.sendMessage(msg.chat.id, welcomeMessage, { parse_mode: 'Markdown' });
});

// Command: /help - Shows the same menu as /start
telegramBot.onText(/\/help/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, `Here are the commands you can use:\n\n` +
        `*📚 Information:*\n` +
        `   /about - Learn what Edentech is.\n` +
        `   /founder - Discover who founded Edentech.\n` +
        `   /origin - Understand our origin story.\n` +
        `   /projects - See our ongoing projects.\n` +
        `   /progress - Get updates on our advancements.\n` +
        `   /contact - Find out how to reach us.\n\n` +
        `*📤 File Management:*\n` +
        `   /upload - Send me a file to securely upload to Mega.nz.\n` +
        `   /myuploads - View the files you've uploaded.\n\n` +
        `*❓ Help:*\n` +
        `   /help - Show this command menu again.`, { parse_mode: 'Markdown' });
});


// Command: /about
telegramBot.onText(/\/about/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_ABOUT, { parse_mode: 'Markdown' });
});

// Command: /founder
telegramBot.onText(/\/founder/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_FOUNDER, { parse_mode: 'Markdown' });
});

// Command: /origin
telegramBot.onText(/\/origin/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_ORIGIN, { parse_mode: 'Markdown' });
});

// Command: /projects
telegramBot.onText(/\/projects/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_PROJECTS, { parse_mode: 'Markdown' });
});

// Command: /progress
telegramBot.onText(/\/progress/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_PROGRESS, { parse_mode: 'Markdown' });
});

// Command: /contact
telegramBot.onText(/\/contact/, (msg) => {
    telegramBot.sendMessage(msg.chat.id, EDENTECH_CONTACT, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// Command: /upload - Prepare for file upload
telegramBot.onText(/\/upload/, async (msg) => {
    const chatId = msg.chat.id;
    if (!megaStorage) {
        await telegramBot.sendMessage(chatId, "⚠️ Mega.nz integration is not active. Please ensure `MEGA_EMAIL` and `MEGA_PASS` are set in environment variables to use file upload features.", { parse_mode: 'Markdown' });
        return;
    }
    await telegramBot.sendMessage(chatId, "Please send me the file you want to upload. It can be a document, photo, video, or any other file type.");
    expectingFileUpload.set(chatId, true); // Mark this user as expecting a file
});

// Handle all incoming messages that are files (document, photo, video, audio, voice)
telegramBot.on('document', handleFileUpload);
telegramBot.on('photo', handleFileUpload);
telegramBot.on('video', handleFileUpload);
telegramBot.on('audio', handleFileUpload);
telegramBot.on('voice', handleFileUpload);

// Generic file upload handler
async function handleFileUpload(msg) {
    const chatId = msg.chat.id;

    if (!expectingFileUpload.has(chatId) || !expectingFileUpload.get(chatId)) {
        // If not explicitly expecting a file, ignore it or inform the user
        // We'll just ignore for now to avoid spam
        return;
    }

    expectingFileUpload.delete(chatId); // No longer expecting a file from this user

    let fileId, fileName;
    let fileType = 'document'; // Default

    if (msg.document) {
        fileId = msg.document.file_id;
        fileName = msg.document.file_name;
    } else if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id; // Get the largest photo
        fileName = `photo_${fileId}.jpg`; // Generate a name for photos
        fileType = 'photo';
    } else if (msg.video) {
        fileId = msg.video.file_id;
        fileName = msg.video.file_name || `video_${fileId}.mp4`;
        fileType = 'video';
    } else if (msg.audio) {
        fileId = msg.audio.file_id;
        fileName = msg.audio.file_name || `audio_${fileId}.mp3`;
        fileType = 'audio';
    } else if (msg.voice) {
        fileId = msg.voice.file_id;
        fileName = `voice_${fileId}.ogg`;
        fileType = 'voice';
    } else {
        await telegramBot.sendMessage(chatId, "I received a file, but I couldn't process its type for upload. Please try a different file.");
        return;
    }

    if (!fileName) {
        fileName = `unknown_file_${fileId}.dat`; // Fallback name
    }

    const localFilePath = `${TEMP_DOWNLOAD_DIR}/${fileId}_${fileName}`;

    try {
        await telegramBot.sendMessage(chatId, `⏳ Received your *${fileType}* file: \`${fileName}\`. Downloading and preparing for upload to Mega.nz...`, { parse_mode: 'Markdown' });

        // Download the file from Telegram servers
        const downloadedPath = await telegramBot.downloadFile(fileId, TEMP_DOWNLOAD_DIR);
        
        // Ensure the downloaded path is what we expect or handle filename differences
        // Telegram sometimes renames files on download. We need the actual path.
        if (!fs.existsSync(downloadedPath)) {
            logger.error(`Downloaded file not found at expected path: ${downloadedPath}`);
            await telegramBot.sendMessage(chatId, "❌ Error downloading file from Telegram. Please try again.");
            return;
        }

        const { megaFileName, megaUrl } = await uploadFileToMega(downloadedPath, fileName);

        // Store metadata
        if (!userUploadsDB[chatId]) {
            userUploadsDB[chatId] = [];
        }
        userUploadsDB[chatId].push({
            file_id: uuidv4(), // Unique ID for our DB entry
            originalName: fileName,
            megaFileName: megaFileName,
            megaUrl: megaUrl,
            uploadDate: new Date().toISOString()
        });
        saveUploadsDB();

        await telegramBot.sendMessage(chatId,
            `✅ Your file *"${fileName}"* has been successfully uploaded to Mega.nz!\n` +
            `You can access it here: [${megaFileName}](${megaUrl})\n\n` +
            `Use /myuploads to see all your uploaded files.`,
            { parse_mode: 'Markdown', disable_web_page_preview: true }
        );

    } catch (error) {
        logger.error(`Error processing file upload for chat ${chatId}:`, error);
        await telegramBot.sendMessage(chatId, `❌ An error occurred during file upload: ${error.message}. Please try again.`);
    } finally {
        // Clean up the locally downloaded file
        if (fs.existsSync(localFilePath)) {
            removeFile(localFilePath);
        } else if (fs.existsSync(downloadedPath)) { // Clean up based on actual downloadedPath
            removeFile(downloadedPath);
        }
    }
}


// Command: /myuploads - List user's uploaded files
telegramBot.onText(/\/myuploads/, async (msg) => {
    const chatId = msg.chat.id;
    const uploads = userUploadsDB[chatId];

    if (!uploads || uploads.length === 0) {
        await telegramBot.sendMessage(chatId, "You haven't uploaded any files yet. Use /upload to start!");
        return;
    }

    let response = "*📂 Your Uploaded Files:*\n\n";
    uploads.forEach((file, index) => {
        const uploadDate = new Date(file.uploadDate).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        response += `${index + 1}. *${file.originalName}*\n`;
        response += `   _Uploaded: ${uploadDate}_\n`;
        response += `   [View on Mega.nz](${file.megaUrl})\n\n`;
    });

    await telegramBot.sendMessage(chatId, response, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// Fallback for unknown commands
telegramBot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        const command = msg.text.split(' ')[0];
        if (!['/start', '/help', '/about', '/founder', '/origin', '/projects', '/progress', '/contact', '/upload', '/myuploads'].includes(command)) {
            telegramBot.sendMessage(msg.chat.id, `Sorry, I don't recognize the command \`${command}\`. Please use /help to see the list of available commands.`, { parse_mode: 'Markdown' });
        }
    }
});

console.log("Edentech Support Bot started. Waiting for commands!");