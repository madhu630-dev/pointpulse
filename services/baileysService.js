const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

let sock = null;
let currentQR = null;
let qrDataUrl = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let connectedUser = null;
let io = null;
let messageProcessor = null;

const authDir = path.join(__dirname, '../auth_info_baileys');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

const setMessageProcessor = (processor) => {
    messageProcessor = processor;
};

const getStatus = () => {
    return {
        status: connectionStatus,
        qr: qrDataUrl,
        user: connectedUser
    };
};

const startWhatsApp = async () => {
    if (sock && connectionStatus === 'connected') {
        return getStatus();
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();

        connectionStatus = 'connecting';
        if (io) io.emit('wa_status', { status: 'connecting' });

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['PointPulse', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQR = qr;
                try {
                    qrDataUrl = await QRCode.toDataURL(qr);
                    if (io) {
                        io.emit('wa_qr', { qr: qrDataUrl });
                    }
                } catch (e) {
                    console.error("QR Code generate error:", e);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                connectionStatus = 'disconnected';
                currentQR = null;
                qrDataUrl = null;
                connectedUser = null;

                if (io) {
                    io.emit('wa_status', { status: 'disconnected' });
                }

                if (shouldReconnect) {
                    console.log("Reconnecting WhatsApp...");
                    setTimeout(startWhatsApp, 3000);
                } else {
                    console.log("WhatsApp Logged out. Clearing session...");
                    try {
                        fs.rmSync(authDir, { recursive: true, force: true });
                    } catch (e) {}
                }
            } else if (connection === 'open') {
                connectionStatus = 'connected';
                currentQR = null;
                qrDataUrl = null;
                connectedUser = sock.user?.id ? sock.user.id.split(':')[0] : 'Connected';
                
                console.log(`WhatsApp connected as: ${connectedUser}`);
                if (io) {
                    io.emit('wa_status', { status: 'connected', user: connectedUser });
                }
            }
        });

const sentBotMessageIds = new Set();

        const groupSubjectCache = new Map();

        // Listen for incoming WhatsApp messages
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;

            for (const msg of m.messages) {
                if (msg.key.remoteJid === 'status@broadcast') continue;

                // Ignore messages sent by our own bot instance
                if (msg.key?.id && sentBotMessageIds.has(msg.key.id)) {
                    sentBotMessageIds.delete(msg.key.id);
                    continue;
                }

                const jid = msg.key.remoteJid;
                if (!jid) continue;

                // Ignore channels (@newsletter), broadcasts, and status
                if (jid.endsWith('@newsletter') || jid.includes('@broadcast') || jid.includes('broadcast')) {
                    continue;
                }

                // STRICT LOCK: Only process messages inside the dedicated group (@g.us)
                // Completely IGNORE all 1-on-1 personal/private chats
                if (!jid.endsWith('@g.us')) {
                    continue;
                }

                // Strictly only allow the dedicated bot group (named "Chat" or "PointPulse")
                let groupSubject = groupSubjectCache.get(jid);
                if (!groupSubject) {
                    try {
                        const meta = await sock.groupMetadata(jid);
                        groupSubject = meta?.subject || '';
                        groupSubjectCache.set(jid, groupSubject);
                    } catch (e) {
                        groupSubject = '';
                    }
                }

                const normalizedSubject = (groupSubject || '').toLowerCase().trim();
                const isAllowedGroup = normalizedSubject === 'chat' || 
                                       normalizedSubject.includes('pointpulse') || 
                                       normalizedSubject.includes('point pulse');

                if (!isAllowedGroup) {
                    // Strictly ignore all other WhatsApp groups
                    continue;
                }

                let messageObj = msg.message;
                if (messageObj?.ephemeralMessage) messageObj = messageObj.ephemeralMessage.message;
                if (messageObj?.viewOnceMessage) messageObj = messageObj.viewOnceMessage.message;

                const text = (messageObj?.conversation || 
                             messageObj?.extendedTextMessage?.text || 
                             messageObj?.buttonsResponseMessage?.selectedButtonId || 
                             messageObj?.listResponseMessage?.singleSelectReply?.selectedRowId || '').trim();

                if (!text) continue;

                // Extract sender phone number (strip :0 / :1 device tags)
                let rawPhone = msg.key.fromMe && selfPhone 
                    ? selfPhone 
                    : (msg.key.participant || jid).split('@')[0].split(':')[0];

                // If sent from the connected account itself:
                if (msg.key.fromMe) {
                    // Ignore bot's own output messages to prevent loops
                    const isBotReply = /^[🤖✅⚠️⛔ℹ️📋🎁✏️⚡❓❌⏰📥📄📊🚀🎉🔎⚙️👤🔥💎➕➖🎯]/u.test(text);
                    if (isBotReply) continue;
                }

                if (messageProcessor) {
                    const response = await messageProcessor(rawPhone, text);
                    if (response) {
                        if (response.document) {
                            console.log(`[PointPulse Bot] Sending document ${response.document.fileName} to +${rawPhone}`);
                            const sent = await sock.sendMessage(jid, {
                                document: response.document.buffer,
                                fileName: response.document.fileName,
                                mimetype: response.document.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                caption: response.document.caption || response.reply || ''
                            });
                            if (sent?.key?.id) {
                                sentBotMessageIds.add(sent.key.id);
                            }
                        } else if (response.reply) {
                            console.log(`[PointPulse Bot] Command executed for +${rawPhone}: ${text}`);
                            const sent = await sock.sendMessage(jid, { text: response.reply });
                            if (sent?.key?.id) {
                                sentBotMessageIds.add(sent.key.id);
                            }
                        }
                    }
                }
            }
        });

        return getStatus();
    } catch (error) {
        console.error("Start WhatsApp Error:", error);
        connectionStatus = 'disconnected';
        return getStatus();
    }
};

const disconnectWhatsApp = async () => {
    try {
        if (sock) {
            await sock.logout();
            sock = null;
        }
        connectionStatus = 'disconnected';
        currentQR = null;
        qrDataUrl = null;
        connectedUser = null;
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
        } catch (e) {}
        if (io) io.emit('wa_status', { status: 'disconnected' });
        return { success: true };
    } catch (e) {
        console.error("Disconnect Error:", e);
        return { success: false, error: e.message };
    }
};

module.exports = {
    setIo,
    setMessageProcessor,
    startWhatsApp,
    disconnectWhatsApp,
    getStatus
};
