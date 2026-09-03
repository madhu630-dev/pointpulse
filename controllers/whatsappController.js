const supabase = require('../db/supabase');
const baileysService = require('../services/baileysService');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit-table');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
    baileysService.setIo(socketIoInstance);
};

// Connect Baileys message handler
baileysService.setMessageProcessor((rawPhone, messageText) => {
    return processIncomingMessage(rawPhone, messageText);
});

// In-memory store for pending confirmations and active interactive sessions
const pendingConfirmations = new Map();
const userSessions = new Map();

const REDEEM_ITEMS = [
    { id: 1, name: "Amazon ($10)", cost: 10000 },
    { id: 2, name: "Amazon ($5)", cost: 5250 },
    { id: 3, name: "Overwatch (500)", cost: 5000 },
    { id: 4, name: "Overwatch (1000)", cost: 10000 },
    { id: 5, name: "League of Legends", cost: 6500 },
    { id: 6, name: "Roblox (840)", cost: 12000 },
    { id: 7, name: "Roblox (1000)", cost: 15000 },
    { id: 8, name: "Minecraft", cost: 3000 },
    { id: 9, name: "Sea of Thieves", cost: 8500 }
];

// Helper to normalize phone numbers (digits only, strip :0/:1 and @)
const normalizePhoneNumber = (phone) => {
    if (!phone) return '';
    const clean = phone.toString().split('@')[0].split(':')[0];
    return clean.replace(/whatsapp:/gi, '').replace(/\D/g, '');
};

// Helper: Visual ASCII Progress Bar (e.g. "████░░░░░░ 40.0%")
const renderProgressBar = (current, target = 5000) => {
    if (target <= 0) target = 5000;
    const pct = Math.min(100, Math.max(0, (current / target) * 100));
    const filledBlocks = Math.round((pct / 100) * 10);
    const emptyBlocks = 10 - filledBlocks;
    const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
    const remaining = Math.max(0, target - current);
    return {
        bar: `${bar} ${pct.toFixed(1)}%`,
        target,
        remaining,
        pct
    };
};

// Helper: Check permissions
const hasPermission = (permissions, requiredPerm) => {
    if (!permissions) return false;
    if (typeof permissions === 'string') {
        const perms = permissions.toLowerCase().split(',').map(p => p.trim());
        return perms.includes(requiredPerm.toLowerCase()) || perms.includes('admin') || perms.includes('*');
    }
    if (Array.isArray(permissions)) {
        return permissions.some(p => p.toLowerCase() === requiredPerm.toLowerCase() || p.toLowerCase() === 'admin' || p === '*');
    }
    return false;
};

// In-memory cache for authorized users
let authUsersCache = null;
let authCacheTime = 0;
const invalidateAuthCache = () => { authUsersCache = null; };

const getCachedAuthUsers = async () => {
    if (authUsersCache && (Date.now() - authCacheTime < 30000)) {
        return authUsersCache;
    }
    const { data, error } = await supabase
        .from('whatsapp_authorized_users')
        .select('*')
        .eq('is_active', true);
    if (!error && data) {
        authUsersCache = data;
        authCacheTime = Date.now();
    }
    return authUsersCache || [];
};

// ==========================================
// DATA AGGREGATION & REPORTING HELPERS
// ==========================================

// 1. Fetch All Accounts with latest points and redemptions
const fetchAllAdminData = async (adminId) => {
    const { data: users, error: userError } = await supabase
        .from('Users')
        .select('*')
        .eq('admin_id', adminId)
        .order('profile_no', { ascending: true });

    if (userError || !users || users.length === 0) return { users: [], pointsMap: new Map(), redempMap: new Map() };

    const userIds = users.map(u => u.id);

    const [pointsRes, redemptionsRes] = await Promise.all([
        supabase.from('Points').select('user_id, points, id, updated_at').in('user_id', userIds).order('id', { ascending: false }),
        supabase.from('Redemptions').select('user_id, item_name, redeemed_at').in('user_id', userIds).order('redeemed_at', { ascending: false })
    ]);

    const pointsMap = new Map();
    (pointsRes.data || []).forEach(p => {
        if (!pointsMap.has(p.user_id)) {
            pointsMap.set(p.user_id, p.points);
        }
    });

    const redempMap = new Map();
    (redemptionsRes.data || []).forEach(r => {
        if (!redempMap.has(r.user_id)) redempMap.set(r.user_id, []);
        redempMap.get(r.user_id).push(r);
    });

    return { users, pointsMap, redempMap, rawPoints: pointsRes.data || [], rawRedemptions: redemptionsRes.data || [] };
};

// 2. Generate Dashboard Summary (Today's Status)
const getTodayStatusText = async (adminId) => {
    const { users, pointsMap, redempMap, rawPoints, rawRedemptions } = await fetchAllAdminData(adminId);
    if (users.length === 0) return "⚠️ No accounts found in your database.";

    const activeCount = users.filter(u => u.status === 'active').length;
    const bannedCount = users.filter(u => u.status === 'banned').length;

    let totalActivePoints = 0;
    users.forEach(u => {
        if (u.status === 'active') {
            totalActivePoints += (pointsMap.get(u.id) || 0);
        }
    });

    const formatK = (pts) => pts >= 1000 ? `${(pts / 1000).toFixed(1)}K` : `${pts}`;

    // Ready to redeem tiers
    let readyOw500 = 0;
    let readyRobloxAmazon = 0;
    let readyMinecraft = 0;

    users.forEach(u => {
        if (u.status === 'active') {
            const p = pointsMap.get(u.id) || 0;
            if (p >= 5000) readyOw500++;
            if (p >= 10000) readyRobloxAmazon++;
            if (p >= 3000) readyMinecraft++;
        }
    });

    // Today's activity
    const todayStr = new Date().toISOString().split('T')[0];
    const todayUpdates = rawPoints.filter(p => p.updated_at && p.updated_at.startsWith(todayStr)).length;
    const todayRedemps = rawRedemptions.filter(r => r.redeemed_at && r.redeemed_at.startsWith(todayStr)).length;

    return `📊 *POINTPULSE STATUS*\n━━━━━━━━━━━━━━━━━━━━\n🟢 *Active Accounts:* ${activeCount}\n🔴 *Banned Accounts:* ${bannedCount}\n\n⭐ *Total Active Points:* *${formatK(totalActivePoints)}* pts\n\n🎁 *Ready to Redeem:*\n• Overwatch (500): *${readyOw500}* accounts\n• Roblox / Amazon: *${readyRobloxAmazon}* accounts\n• Minecraft (3000): *${readyMinecraft}* accounts\n\n📈 *Today's Updates:* +${todayUpdates} accounts\n🎁 *Today's Redemptions:* ${todayRedemps}\n━━━━━━━━━━━━━━━━━━━━\n_Everything is running smoothly! 🚀_`;
};

// 3. Ready Accounts Summary
const getReadyNowText = async (adminId, filterItem = null) => {
    const { users, pointsMap } = await fetchAllAdminData(adminId);
    const activeUsers = users.filter(u => u.status === 'active');

    if (activeUsers.length === 0) return "⚠️ No active accounts found.";

    const owAccounts = activeUsers.filter(u => (pointsMap.get(u.id) || 0) >= 5000);
    const robloxAccounts = activeUsers.filter(u => (pointsMap.get(u.id) || 0) >= 10000);
    const mcAccounts = activeUsers.filter(u => (pointsMap.get(u.id) || 0) >= 3000);

    if (filterItem) {
        const fi = filterItem.toUpperCase();
        let targetList = [];
        let label = '';
        if (fi.includes('OVERWATCH') || fi.includes('OW')) { targetList = owAccounts; label = 'Overwatch (500) [5,000+ pts]'; }
        else if (fi.includes('ROBLOX') || fi.includes('AMAZON')) { targetList = robloxAccounts; label = 'Roblox / Amazon [10,000+ pts]'; }
        else if (fi.includes('MINECRAFT') || fi.includes('MC')) { targetList = mcAccounts; label = 'Minecraft [3,000+ pts]'; }
        else { targetList = owAccounts; label = 'Overwatch (500)'; }

        if (targetList.length === 0) return `ℹ️ No accounts currently qualify for *${label}*.`;

        const top15 = targetList.slice(0, 15);
        let listText = `🎁 *READY FOR ${label.toUpperCase()}* (${targetList.length} total)\n━━━━━━━━━━━━━━━━━━━━\n`;
        top15.forEach(u => {
            const pts = pointsMap.get(u.id) || 0;
            listText += `• *P${u.profile_no}* (${u.email.split('@')[0]}) — ⭐ *${pts.toLocaleString()} pts*\n`;
        });
        if (targetList.length > 15) listText += `\n_...and ${targetList.length - 15} more accounts_\n`;
        listText += `━━━━━━━━━━━━━━━━━━━━\n👉 Send *P<number>* (e.g. *P${top15[0].profile_no}*) to redeem!`;
        return listText;
    }

    let msg = `🎁 *READY TO REDEEM NOW*\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🔥 *Overwatch (500)*: *${owAccounts.length}* accounts (5,000+ pts)\n`;
    msg += `💎 *Roblox / Amazon*: *${robloxAccounts.length}* accounts (10,000+ pts)\n`;
    msg += `🚀 *Minecraft*: *${mcAccounts.length}* accounts (3,000+ pts)\n`;
    msg += `\n📦 *Total Qualified Accounts:* ${owAccounts.length}\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👉 Reply with *OVERWATCH*, *ROBLOX*, or *MINECRAFT* to view specific accounts list!`;
    return msg;
};

// 4. Account Lists Menu Handler (Active, Banned, Old, New, Ready, Highest Points)
const getAccountListText = async (adminId, typeChoice) => {
    const { users, pointsMap, redempMap } = await fetchAllAdminData(adminId);
    if (users.length === 0) return "⚠️ No accounts found.";

    let filtered = [];
    let title = '';

    if (typeChoice === '1' || typeChoice === 'active') {
        filtered = users.filter(u => u.status === 'active');
        title = '🟢 ACTIVE ACCOUNTS';
    } else if (typeChoice === '2' || typeChoice === 'banned') {
        filtered = users.filter(u => u.status === 'banned');
        title = '🔴 BANNED ACCOUNTS';
    } else if (typeChoice === '3' || typeChoice === 'old') {
        filtered = users.filter(u => (redempMap.get(u.id) || []).length > 0);
        title = '🟦 OLD ACCOUNTS (REDEEMED)';
    } else if (typeChoice === '4' || typeChoice === 'new') {
        filtered = users.filter(u => (redempMap.get(u.id) || []).length === 0);
        title = '🆕 NEW ACCOUNTS (FRESH)';
    } else if (typeChoice === '5' || typeChoice === 'ready') {
        filtered = users.filter(u => u.status === 'active' && (pointsMap.get(u.id) || 0) >= 5000);
        title = '🎁 READY TO REDEEM (5,000+ PTS)';
    } else if (typeChoice === '6' || typeChoice === 'highest') {
        filtered = [...users].sort((a, b) => (pointsMap.get(b.id) || 0) - (pointsMap.get(a.id) || 0));
        title = '⭐ HIGHEST POINTS ACCOUNTS';
    } else {
        return null;
    }

    if (filtered.length === 0) return `ℹ️ No accounts found matching *${title}*.`;

    const top12 = filtered.slice(0, 12);
    let out = `📋 *${title}* (${filtered.length} total)\n━━━━━━━━━━━━━━━━━━━━\n`;
    top12.forEach(u => {
        const pts = pointsMap.get(u.id) || 0;
        const isOld = (redempMap.get(u.id) || []).length > 0;
        out += `• *P${u.profile_no}* | ${u.email.split('@')[0]} | ⭐ *${pts.toLocaleString()}* ${isOld ? '🎁' : '🆕'}\n`;
    });
    if (filtered.length > 12) out += `\n_...and ${filtered.length - 12} more accounts_\n`;
    out += `━━━━━━━━━━━━━━━━━━━━\n👉 Send *P<number>* to open any profile, or *DOWNLOAD* for Excel/PDF.`;
    return out;
};

// 5. Recent Activity Handler
const getRecentActivityText = async (adminId) => {
    const { data: recentPoints } = await supabase
        .from('Points')
        .select('user_id, points, updated_at, Users(profile_no, email)')
        .order('id', { ascending: false })
        .limit(6);

    const { data: recentRedemptions } = await supabase
        .from('Redemptions')
        .select('user_id, item_name, redeemed_at, Users(profile_no, email)')
        .order('redeemed_at', { ascending: false })
        .limit(4);

    let out = `🕘 *RECENT ACTIVITY*\n━━━━━━━━━━━━━━━━━━━━\n⚡ *Recent Points Updates:*\n`;

    if (recentPoints && recentPoints.length > 0) {
        recentPoints.forEach(p => {
            const prof = p.Users?.profile_no ? `P${p.Users.profile_no}` : 'User';
            const emailPart = p.Users?.email ? p.Users.email.split('@')[0] : '';
            const timeStr = p.updated_at ? new Date(p.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            out += `• *${prof}* (${emailPart}) ➜ ⭐ *${p.points.toLocaleString()} pts* _(${timeStr})_\n`;
        });
    } else {
        out += `_No recent points updates_\n`;
    }

    out += `\n🎁 *Recent Redemptions:*\n`;
    if (recentRedemptions && recentRedemptions.length > 0) {
        recentRedemptions.forEach(r => {
            const prof = r.Users?.profile_no ? `P${r.Users.profile_no}` : 'User';
            const timeStr = r.redeemed_at ? new Date(r.redeemed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            out += `• *${prof}* redeemed *${r.item_name}* _(${timeStr})_\n`;
        });
    } else {
        out += `_No recent redemptions_\n`;
    }

    out += `━━━━━━━━━━━━━━━━━━━━\n👉 Reply *START* to open menu.`;
    return out;
};

// 6. Excel Generator Buffer
const generateExcelExportBuffer = async (adminId, type = 'all') => {
    const { users, pointsMap, redempMap } = await fetchAllAdminData(adminId);
    if (users.length === 0) return null;

    const filteredUsers = users.filter(u => {
        const redemps = redempMap.get(u.id) || [];
        const isOld = redemps.length > 0;
        if (type === 'old') return isOld;
        if (type === 'new') return !isOld;
        return true;
    });

    if (filteredUsers.length === 0) return null;

    let rows = [];
    if (type === 'points') {
        rows = filteredUsers.map(u => ({
            'Profile No.': u.profile_no || '',
            'Email': u.email || '',
            'Server': u.server || '',
            'Points': pointsMap.get(u.id) || 0
        }));
    } else {
        rows = filteredUsers.map(u => {
            const redemps = redempMap.get(u.id) || [];
            const isOld = redemps.length > 0;
            const itemStr = isOld ? redemps.map(r => r.item_name).join(', ') : 'None';
            return {
                'Profile No.': u.profile_no || '',
                'Email': u.email || '',
                'Password': u.password || '',
                'Alternative Mail': u.alternative_email || '',
                'Server': u.server || '',
                'Current Present Points': pointsMap.get(u.id) || 0,
                'Redeemed Item': itemStr,
                'Old/New Account': isOld ? 'Old Account' : 'New Account'
            };
        });
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetName = type === 'points' ? 'Points_List' : `${type.charAt(0).toUpperCase() + type.slice(1)}_Accounts`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, count: rows.length };
};

// 7. PDF Generator Buffer
const generatePdfExportBuffer = async (adminId, type = 'all') => {
    return new Promise(async (resolve) => {
        try {
            const { users, pointsMap, redempMap } = await fetchAllAdminData(adminId);
            if (users.length === 0) return resolve(null);

            const filteredUsers = users.filter(u => {
                const redemps = redempMap.get(u.id) || [];
                const isOld = redemps.length > 0;
                if (type === 'old') return isOld;
                if (type === 'new') return !isOld;
                return true;
            });

            if (filteredUsers.length === 0) return resolve(null);

            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const buffers = [];
            doc.on('data', b => buffers.push(b));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                resolve({ buffer: pdfBuffer, count: filteredUsers.length });
            });

            const typeTitle = type === 'old' ? 'Old (Redeemed)' : (type === 'new' ? 'New (Fresh)' : 'All Master');
            const table = {
                title: `PointPulse ${typeTitle} Accounts Report`,
                headers: ["Prof No.", "Email", "Server", "Points", "Type", "Redeemed Item"],
                rows: filteredUsers.map(u => {
                    const redemps = redempMap.get(u.id) || [];
                    const isOld = redemps.length > 0;
                    const itemStr = isOld ? redemps[0].item_name : 'None';
                    return [
                        u.profile_no ? String(u.profile_no) : '-',
                        u.email || '-',
                        u.server || '-',
                        String(pointsMap.get(u.id) || 0),
                        isOld ? 'Old' : 'New',
                        itemStr
                    ];
                })
            };

            await doc.table(table, {
                prepareHeader: () => doc.font("Helvetica-Bold").fontSize(9),
                prepareRow: () => doc.font("Helvetica").fontSize(8)
            });

            doc.end();
        } catch (err) {
            console.error("Generate PDF Buffer Error:", err);
            resolve(null);
        }
    });
};

// ==========================================
// MAIN INCOMING MESSAGE PROCESSOR
// ==========================================
const processIncomingMessage = async (rawPhone, messageText, adminIdOverride = null) => {
    const phone = normalizePhoneNumber(rawPhone);
    const text = (messageText || '').trim();

    if (!phone) return { success: false, reply: "❌ Invalid phone number format." };
    if (!text) return { success: false, reply: "ℹ️ Send *START* to open the main menu." };

    try {
        // 1. Fast Authorization Check
        const authUsers = await getCachedAuthUsers();
        const filteredAuth = adminIdOverride ? authUsers.filter(u => u.admin_id === adminIdOverride) : authUsers;

        const authUser = filteredAuth.find(u => {
            const uPhone = normalizePhoneNumber(u.phone_number);
            return uPhone === phone || phone.endsWith(uPhone) || uPhone.endsWith(phone);
        });

        if (!authUser) {
            // Silently ignore any personal chats or unauthorized contacts
            return { success: false, reply: null };
        }

        const adminId = authUser.admin_id;
        const userName = authUser.name || 'Admin';
        const upperText = text.toUpperCase();

        const hasActiveSession = userSessions.has(phone);
        const hasPendingConfirmation = pendingConfirmations.has(phone);

        // Check command triggers
        const isStartCommand = ['START', 'MENU', 'HI', 'HELLO', 'HELP', '?', 'POINTPULSE', 'COMMANDS', 'BACK', 'CANCEL', '0'].includes(upperText);
        const isProfileCommand = /^[pP](?:rofile\s*|rof\s*)?\d+/i.test(text);
        const isDigitMenu = /^[1-8]$/.test(text.trim());
        const isQuickCommand = ['QUICK', 'RAPID', 'FAST', 'FASTUPDATE', 'BULK'].includes(upperText);
        const isSinglePair = /^(?:P|#)?\d+[\s:]+[+-]?\d+$/i.test(text.trim());
        const isMultiLine = text.includes('\n');
        const isDownloadDirect = ['DOWNLOAD', 'EXPORT', 'D', 'PDF'].includes(upperText) || 
                                 /^(?:DOWNLOAD|EXPORT|D)\s+(?:OLD|NEW|ALL|POINTS)/i.test(text) || 
                                 /^(?:PDF)\s*(?:OLD|NEW|ALL)?/i.test(text);
        const isStatusCommand = ['STATUS', 'STATS', 'TODAY'].includes(upperText);
        const isReadyCommand = upperText === 'READY' || upperText.startsWith('READY ') || ['OVERWATCH', 'ROBLOX', 'MINECRAFT'].includes(upperText);
        const isRecentCommand = ['RECENT', 'UPDATES', 'HISTORY', 'ACTIVITY'].includes(upperText);

        if (!hasActiveSession && !hasPendingConfirmation && !isStartCommand && !isProfileCommand && !isDigitMenu && !isQuickCommand && !isSinglePair && !isMultiLine && !isDownloadDirect && !isStatusCommand && !isReadyCommand && !isRecentCommand) {
            return { success: false, reply: null };
        }

        // ==========================================
        // 2. CONFIRMATION HANDLER (YES / CONFIRM)
        // ==========================================
        if (['YES', 'CONFIRM', 'Y'].includes(upperText)) {
            const pending = pendingConfirmations.get(phone);
            if (!pending) {
                return { success: false, reply: `ℹ️ *No Pending Action*\nSend *START* or a profile number like *P2* to begin.` };
            }

            if (Date.now() > pending.expiresAt) {
                pendingConfirmations.delete(phone);
                return { success: false, reply: `⏰ *Request Expired*\nThe previous action for Profile #${pending.profileNo} expired (5 min limit). Please try again.` };
            }

            // A. Points Confirmation
            if (pending.type === 'POINTS') {
                if (!hasPermission(authUser.permissions, 'points_update')) {
                    pendingConfirmations.delete(phone);
                    return { success: false, reply: `⛔ *Permission Denied*\nYou do not have permission to update points.` };
                }

                const now = new Date().toISOString();
                const dateStr = `WhatsApp_${authUser.name || phone}_${Date.now()}`;

                const { error: insertPointError } = await supabase.from('Points').insert([{
                    user_id: pending.userId,
                    date: dateStr,
                    points: pending.newPoints,
                    updated_at: now
                }]);

                if (insertPointError) {
                    return { success: false, reply: "❌ Database error updating points. Please try again." };
                }

                pendingConfirmations.delete(phone);
                userSessions.delete(phone);

                if (io) {
                    io.to(adminId.toString()).emit('notification', {
                        title: 'Points Updated',
                        message: `📱 ${userName} updated Profile #${pending.profileNo} (${pending.email}) to ${pending.newPoints} pts`,
                        type: 'success'
                    });
                }

                const prog = renderProgressBar(pending.newPoints, 5000);
                const deltaSign = pending.newPoints >= pending.currentPoints ? `+${(pending.newPoints - pending.currentPoints).toLocaleString()}` : `-${(pending.currentPoints - pending.newPoints).toLocaleString()}`;

                return {
                    success: true,
                    reply: `🎉 *POINTS UPDATED!*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Profile:* #${pending.profileNo} — ${pending.email}\n⭐ *Points:* ${pending.currentPoints.toLocaleString()} ➜ *${pending.newPoints.toLocaleString()}*\n⚡ *Change:* ${deltaSign}\n\n📊 *Progress to 5,000 pts:*\n${prog.bar}\n🎯 *Need for Overwatch:* ${prog.remaining.toLocaleString()} more pts\n\n🕘 *Updated:* Just now\n━━━━━━━━━━━━━━━━━━━━\n_Keep going! 🚀_`
                };
            }

            // B. Redemption Confirmation
            if (pending.type === 'REDEEM') {
                const now = new Date().toISOString();
                const { error: redeemError } = await supabase.from('Redemptions').insert([{
                    user_id: pending.userId,
                    item_name: pending.itemName,
                    points_cost: pending.pointsCost,
                    redeemed_at: now,
                    code_status: 'unsold'
                }]);

                if (redeemError) {
                    return { success: false, reply: "❌ Database error saving redemption. Please try again." };
                }

                pendingConfirmations.delete(phone);
                userSessions.delete(phone);

                if (io) {
                    io.to(adminId.toString()).emit('notification', {
                        title: 'Reward Redeemed',
                        message: `🎁 Profile #${pending.profileNo} (${pending.email}) redeemed ${pending.itemName}!`,
                        type: 'success'
                    });
                }

                return {
                    success: true,
                    reply: `🎉 *REDEMPTION RECORDED!*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Profile:* #${pending.profileNo} (${pending.email})\n🎁 *Reward:* *${pending.itemName}*\n⚡ *Points Deducted:* ${pending.pointsCost.toLocaleString()} pts\n📦 *Inventory Status:* Unsold / Waiting Code\n🕒 *Recorded:* Just now\n━━━━━━━━━━━━━━━━━━━━\n_Account is now marked as an *Old Account 🎁*_`
                };
            }
        }

        // ==========================================
        // 3. CANCELLATION / BACK HANDLERS
        // ==========================================
        if (['NO', 'N', 'CANCEL', '0'].includes(upperText)) {
            pendingConfirmations.delete(phone);
            userSessions.delete(phone);
            return { success: true, reply: `❌ *Action Cancelled*\nSession reset. Reply *START* to open the main menu.` };
        }

        if (upperText === 'BACK') {
            userSessions.set(phone, { step: 'MAIN_MENU', adminId, expiresAt: Date.now() + 5 * 60 * 1000 });
            pendingConfirmations.delete(phone);
            return {
                success: true,
                reply: `🚀 *POINTPULSE*\n\nHey *${userName}* 👋\nWhat do you want to do?\n\n1️⃣ 🔎 Find Account\n2️⃣ ⚡ Update Points\n3️⃣ 🎁 Redeem\n4️⃣ 📊 Today's Status\n5️⃣ 📋 Account Lists\n6️⃣ 📥 Downloads\n7️⃣ 🕘 Recent Updates\n8️⃣ ⚙️ Settings\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 8* (or send *P2* directly)`
            };
        }

        // ==========================================
        // 4. FAST DIRECT SHORTCUTS & GLOBAL TRIGGERS
        // ==========================================
        if (isStartCommand) {
            userSessions.set(phone, { step: 'MAIN_MENU', adminId, expiresAt: Date.now() + 5 * 60 * 1000 });
            pendingConfirmations.delete(phone);
            return {
                success: true,
                reply: `🚀 *POINTPULSE*\n\nHey *${userName}* 👋\nWhat do you want to do?\n\n1️⃣ 🔎 Find Account\n2️⃣ ⚡ Update Points\n3️⃣ 🎁 Redeem\n4️⃣ 📊 Today's Status\n5️⃣ 📋 Account Lists\n6️⃣ 📥 Downloads\n7️⃣ 🕘 Recent Updates\n8️⃣ ⚙️ Settings\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 8* (or send *P2* directly)`
            };
        }

        if (isStatusCommand) {
            userSessions.delete(phone);
            pendingConfirmations.delete(phone);
            const statusText = await getTodayStatusText(adminId);
            return { success: true, reply: statusText };
        }

        if (isRecentCommand) {
            userSessions.delete(phone);
            pendingConfirmations.delete(phone);
            const recentText = await getRecentActivityText(adminId);
            return { success: true, reply: recentText };
        }

        if (isReadyCommand) {
            userSessions.delete(phone);
            pendingConfirmations.delete(phone);
            let filterItem = null;
            if (['OVERWATCH', 'ROBLOX', 'MINECRAFT'].includes(upperText)) filterItem = upperText;
            else if (upperText.startsWith('READY ')) filterItem = upperText.replace('READY ', '').trim();
            const readyText = await getReadyNowText(adminId, filterItem);
            return { success: true, reply: readyText };
        }

        // Direct PDF shortcut
        const pdfDirectMatch = text.match(/^(?:PDF)\s*(old|new|all|1|2|3)?$/i);
        if (pdfDirectMatch) {
            userSessions.delete(phone);
            pendingConfirmations.delete(phone);
            const arg = (pdfDirectMatch[1] || 'all').toLowerCase();
            let dlType = 'all';
            let dlLabel = 'All Accounts Master PDF';
            if (arg === '1' || arg === 'old') { dlType = 'old'; dlLabel = 'Old Accounts PDF Report'; }
            else if (arg === '2' || arg === 'new') { dlType = 'new'; dlLabel = 'New Accounts PDF Report'; }

            const result = await generatePdfExportBuffer(adminId, dlType);
            if (!result) return { success: false, reply: `⚠️ No accounts found for PDF export.` };
            return {
                success: true,
                document: {
                    buffer: result.buffer,
                    fileName: `PointPulse_${dlType.charAt(0).toUpperCase() + dlType.slice(1)}_Accounts.pdf`,
                    mimetype: 'application/pdf',
                    caption: `📄 *PointPulse ${dlLabel}*\n📦 Accounts: ${result.count}\n🕒 Generated: ${new Date().toLocaleTimeString()}\n━━━━━━━━━━━━━━━━━━━━`
                }
            };
        }

        // Direct Download shortcut
        const dlDirectMatch = text.match(/^(?:DOWNLOAD|EXPORT|D)\s*(old|new|all|points)?$/i);
        if (dlDirectMatch && dlDirectMatch[1]) {
            userSessions.delete(phone);
            pendingConfirmations.delete(phone);
            const arg = dlDirectMatch[1].toLowerCase();
            let dlType = 'all';
            let dlLabel = 'All Accounts Master';
            if (arg === 'old') { dlType = 'old'; dlLabel = 'Old Accounts (Redeemed)'; }
            else if (arg === 'new') { dlType = 'new'; dlLabel = 'New Accounts (Fresh)'; }
            else if (arg === 'points') { dlType = 'points'; dlLabel = 'Points List Summary'; }

            const result = await generateExcelExportBuffer(adminId, dlType);
            if (!result) return { success: false, reply: `⚠️ No accounts found for export.` };
            return {
                success: true,
                document: {
                    buffer: result.buffer,
                    fileName: `PointPulse_${dlType.charAt(0).toUpperCase() + dlType.slice(1)}_${Date.now()}.xlsx`,
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    caption: `📊 *PointPulse ${dlLabel} Export*\n📦 Records: ${result.count}\n🕒 Generated: ${new Date().toLocaleTimeString()}\n━━━━━━━━━━━━━━━━━━━━`
                }
            };
        }

        if (isQuickCommand) {
            userSessions.set(phone, { step: 'RAPID_UPDATE_PROFILE', adminId, expiresAt: Date.now() + 10 * 60 * 1000 });
            pendingConfirmations.delete(phone);
            return {
                success: true,
                reply: `⚡ *QUICK POINTS UPDATE MODE* ⚡\n━━━━━━━━━━━━━━━━━━━━\nRapidly update accounts one by one without menus.\n\n👉 *Send Profile Number:* (e.g. *1*)\n_(Reply *DONE* or *BACK* anytime to exit)_`
            };
        }

        // ==========================================
        // MULTI-LINE BATCH UPDATE HANDLER (e.g. "1 3440\n2 4000" or "1\n3440\n2\n4000")
        // ==========================================
        if (text.includes('\n') && !userSessions.has(phone)) {
            const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const pairs = [];

            // Case A: Lines with "1 3440" or "1: 3440"
            if (rawLines.every(l => /^(?:P|#)?\d+[\s:]+[+-]?\d+$/i.test(l))) {
                rawLines.forEach(l => {
                    const m = l.match(/^(?:P|#)?(\d+)[\s:]+([+-]?\d+)$/i);
                    if (m) pairs.push({ profileNo: parseInt(m[1], 10), rawPoints: m[2].trim() });
                });
            }
            // Case B: Alternating lines: Line 1 = "1", Line 2 = "3440", Line 3 = "2", Line 4 = "4000"
            else if (rawLines.length >= 2 && rawLines.length % 2 === 0 && rawLines.every((l, idx) => idx % 2 === 0 ? /^(?:P|#)?\d+$/i.test(l) : /^[+-]?\d+$/i.test(l))) {
                for (let i = 0; i < rawLines.length; i += 2) {
                    pairs.push({
                        profileNo: parseInt(rawLines[i].replace(/\D/g, ''), 10),
                        rawPoints: rawLines[i + 1].trim()
                    });
                }
            }

            if (pairs.length > 0) {
                if (!hasPermission(authUser.permissions, 'points_update')) {
                    return { success: false, reply: `⛔ *Permission Denied*\nYou do not have permission to update points.` };
                }

                const { data: allUsers } = await supabase.from('Users').select('id, profile_no, email').eq('admin_id', adminId);
                const userMap = new Map();
                (allUsers || []).forEach(u => userMap.set(u.profile_no, u));

                const updatesToInsert = [];
                const summaryLines = [];
                const now = new Date().toISOString();

                for (const p of pairs) {
                    const u = userMap.get(p.profileNo);
                    if (!u) continue;

                    let finalPts = 0;
                    if (p.rawPoints.startsWith('+') || p.rawPoints.startsWith('-')) {
                        const { data: curPt } = await supabase.from('Points').select('points').eq('user_id', u.id).order('id', { ascending: false }).limit(1);
                        const cur = (curPt && curPt.length > 0) ? curPt[0].points : 0;
                        const delta = parseInt(p.rawPoints, 10);
                        finalPts = Math.max(0, cur + delta);
                    } else {
                        finalPts = parseInt(p.rawPoints, 10);
                    }

                    updatesToInsert.push({
                        user_id: u.id,
                        date: `WhatsAppBatch_${authUser.name || phone}_${Date.now()}`,
                        points: finalPts,
                        updated_at: now
                    });

                    summaryLines.push(`• *P${p.profileNo}* (${u.email.split('@')[0]}) ➜ ⭐ *${finalPts.toLocaleString()} pts*`);
                }

                if (updatesToInsert.length > 0) {
                    await supabase.from('Points').insert(updatesToInsert);
                    if (io) {
                        io.to(adminId.toString()).emit('notification', {
                            title: 'Batch Points Update',
                            message: `📱 ${userName} updated ${updatesToInsert.length} accounts via WhatsApp batch`,
                            type: 'success'
                        });
                    }

                    return {
                        success: true,
                        reply: `🎉 *BATCH UPDATE COMPLETE!*\n━━━━━━━━━━━━━━━━━━━━\n${summaryLines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━\n📦 *Total Accounts Updated:* ${updatesToInsert.length}\n🕒 *Time:* ${new Date().toLocaleTimeString()}`
                    };
                }
            }
        }

        // ==========================================
        // SINGLE-LINE QUICK PAIR (e.g. "1 3440", "P1 3440", "1: 3440")
        // ==========================================
        const singlePairMatch = text.match(/^(?:P|#)?(\d+)[\s:]+([+-]?\d+)$/i);
        if (singlePairMatch && !userSessions.has(phone)) {
            const pNo = parseInt(singlePairMatch[1], 10);
            const valStr = singlePairMatch[2].trim();

            if (!hasPermission(authUser.permissions, 'points_update')) {
                return { success: false, reply: `⛔ *Permission Denied*\nYou do not have permission to update points.` };
            }

            const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).eq('profile_no', pNo).order('id', { ascending: true });
            if (!users || users.length === 0) {
                return { success: false, reply: `❌ *Profile #${pNo} Not Found*.` };
            }

            const targetUser = users[0];
            const { data: curPtRes } = await supabase.from('Points').select('points').eq('user_id', targetUser.id).order('id', { ascending: false }).limit(1);
            const curPoints = (curPtRes && curPtRes.length > 0) ? curPtRes[0].points : 0;

            let newPoints = 0;
            if (valStr.startsWith('+')) newPoints = curPoints + parseInt(valStr.substring(1), 10);
            else if (valStr.startsWith('-')) newPoints = Math.max(0, curPoints - parseInt(valStr.substring(1), 10));
            else newPoints = parseInt(valStr, 10);

            const now = new Date().toISOString();
            await supabase.from('Points').insert([{
                user_id: targetUser.id,
                date: `WhatsAppQuick_${authUser.name || phone}_${Date.now()}`,
                points: newPoints,
                updated_at: now
            }]);

            if (io) {
                io.to(adminId.toString()).emit('notification', {
                    title: 'Quick Points Update',
                    message: `⚡ ${userName} updated Profile #${pNo} to ${newPoints} pts`,
                    type: 'success'
                });
            }

            const prog = renderProgressBar(newPoints, 5000);
            return {
                success: true,
                reply: `✅ *Profile #${pNo} Updated!* (${targetUser.email.split('@')[0]})\n⭐ ${curPoints.toLocaleString()} ➜ *${newPoints.toLocaleString()} pts*\n\n📊 ${prog.bar}\n━━━━━━━━━━━━━━━━━━━━\n_Next: send \`<profile> <points>\` (e.g. *2 4000*) or *START*._`
            };
        }

        // Auto-initialize MAIN_MENU if user enters digit 1-8 directly
        if (!userSessions.has(phone) && isDigitMenu) {
            userSessions.set(phone, { step: 'MAIN_MENU', adminId, expiresAt: Date.now() + 5 * 60 * 1000 });
        }

        // ==========================================
        // 6. INTERACTIVE MULTI-STEP SESSION HANDLER
        // ==========================================
        const currentSession = userSessions.get(phone);

        if (currentSession && Date.now() <= currentSession.expiresAt) {
            const step = currentSession.step;

            // --- RAPID CONSECUTIVE POINTS UPDATE MODE ---
            if (step === 'RAPID_UPDATE_PROFILE') {
                if (['DONE', 'EXIT', 'STOP', 'BACK'].includes(upperText)) {
                    userSessions.delete(phone);
                    return { success: true, reply: `✅ *Exited Quick Update Mode*\nReply *START* to open main menu.` };
                }

                const pNum = parseInt(text.replace(/\D/g, ''), 10);
                if (isNaN(pNum)) return { success: false, reply: "❓ Please send a valid Profile Number (e.g. *1*) or *DONE* to exit:" };

                const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).eq('profile_no', pNum).order('id', { ascending: true });
                if (!users || users.length === 0) {
                    return { success: false, reply: `❌ *Profile #${pNum} Not Found*. Try another profile number:` };
                }

                const user = users[0];
                const { data: curPtRes } = await supabase.from('Points').select('points').eq('user_id', user.id).order('id', { ascending: false }).limit(1);
                const curPoints = (curPtRes && curPtRes.length > 0) ? curPtRes[0].points : 0;

                currentSession.step = 'RAPID_UPDATE_POINTS';
                currentSession.userId = user.id;
                currentSession.profileNo = pNum;
                currentSession.email = user.email;
                currentSession.currentPoints = curPoints;
                userSessions.set(phone, currentSession);

                return {
                    success: true,
                    reply: `👤 *Profile #${pNum}* (${user.email.split('@')[0]})\nCurrent Points: ⭐ *${curPoints.toLocaleString()}*\n\n👉 *Send New Points Amount:* (e.g. *3440* or *+500*)`
                };
            }

            if (step === 'RAPID_UPDATE_POINTS') {
                if (['DONE', 'EXIT', 'STOP', 'BACK'].includes(upperText)) {
                    userSessions.delete(phone);
                    return { success: true, reply: `✅ *Exited Quick Update Mode*\nReply *START* to open main menu.` };
                }

                const valStr = text.trim();
                let newPoints = 0;
                if (valStr.startsWith('+')) newPoints = currentSession.currentPoints + parseInt(valStr.substring(1), 10);
                else if (valStr.startsWith('-')) newPoints = Math.max(0, currentSession.currentPoints - parseInt(valStr.substring(1), 10));
                else newPoints = parseInt(valStr.replace(/,/g, ''), 10);

                if (isNaN(newPoints) || newPoints < 0) {
                    return { success: false, reply: "❌ Invalid points amount. Please enter a number (e.g. *3440* or *+500*):" };
                }

                const updatedProfNo = currentSession.profileNo;
                const now = new Date().toISOString();
                await supabase.from('Points').insert([{
                    user_id: currentSession.userId,
                    date: `WhatsAppRapid_${authUser.name || phone}_${Date.now()}`,
                    points: newPoints,
                    updated_at: now
                }]);

                if (io) {
                    io.to(adminId.toString()).emit('notification', {
                        title: 'Rapid Points Update',
                        message: `⚡ ${userName} updated Profile #${updatedProfNo} to ${newPoints} pts`,
                        type: 'success'
                    });
                }

                // Switch back to RAPID_UPDATE_PROFILE for the next account
                currentSession.step = 'RAPID_UPDATE_PROFILE';
                currentSession.userId = null;
                currentSession.profileNo = null;
                currentSession.expiresAt = Date.now() + 10 * 60 * 1000;
                userSessions.set(phone, currentSession);

                return {
                    success: true,
                    reply: `✅ *Profile #${updatedProfNo} Updated!* ⭐ ➜ *${newPoints.toLocaleString()} pts*\n━━━━━━━━━━━━━━━━━━━━\n👉 *Send NEXT Profile Number* (e.g. *2*) or reply *DONE*:`
                };
            }

            // --- A. MAIN MENU SELECTION (1 - 8) ---
            if (step === 'MAIN_MENU') {
                if (text === '1') {
                    currentSession.step = 'FIND_ACCOUNT_INPUT';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `🔎 *FIND ACCOUNT*\n━━━━━━━━━━━━━━━━━━━━\nEnter Profile Number:\n_Example: 2_` };
                }

                if (text === '2') {
                    currentSession.step = 'UPDATE_POINTS_SELECT_PROFILE';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `⚡ *UPDATE POINTS*\n━━━━━━━━━━━━━━━━━━━━\nEnter Profile Number:\n_Example: 2_` };
                }

                if (text === '3') {
                    currentSession.step = 'REDEEM_SELECT_PROFILE';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `🎁 *REDEMPTION*\n━━━━━━━━━━━━━━━━━━━━\nEnter Profile Number:\n_Example: 2_` };
                }

                if (text === '4') {
                    userSessions.delete(phone);
                    const statusText = await getTodayStatusText(adminId);
                    return { success: true, reply: statusText };
                }

                if (text === '5') {
                    currentSession.step = 'ACCOUNT_LISTS_MENU';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `📋 *ACCOUNT LISTS*\n━━━━━━━━━━━━━━━━━━━━\n1️⃣ 🟢 Active Accounts\n2️⃣ 🔴 Banned Accounts\n3️⃣ 🟦 Old Accounts (Redeemed)\n4️⃣ 🆕 New Accounts (Fresh)\n5️⃣ 🎁 Ready to Redeem (5,000+ pts)\n6️⃣ ⭐ Highest Points\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 6* (or *BACK*)`
                    };
                }

                if (text === '6') {
                    currentSession.step = 'DOWNLOAD_MENU';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `📥 *DOWNLOADS*\n━━━━━━━━━━━━━━━━━━━━\nWhat do you need?\n\n1️⃣ 📋 Detailed Accounts (.xlsx)\n2️⃣ 🟦 Old Accounts (.xlsx)\n3️⃣ 🆕 New Accounts (.xlsx)\n4️⃣ 📊 Points List (.xlsx)\n5️⃣ 📄 PDF Report (.pdf)\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 5* (or *BACK*)`
                    };
                }

                if (text === '7') {
                    userSessions.delete(phone);
                    const recentText = await getRecentActivityText(adminId);
                    return { success: true, reply: recentText };
                }

                if (text === '8') {
                    userSessions.delete(phone);
                    return {
                        success: true,
                        reply: `⚙️ *POINTPULSE SETTINGS*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Authorized User:* ${userName}\n📱 *Phone:* +${phone}\n🔑 *Permissions:* ${authUser.permissions || 'Full Access'}\n🌐 *Organization ID:* #${adminId}\n🟢 *System Status:* Online & Connected\n━━━━━━━━━━━━━━━━━━━━\n_Reply *START* to return to menu._`
                    };
                }
            }

            // --- B. FIND ACCOUNT INPUT ---
            if (step === 'FIND_ACCOUNT_INPUT') {
                const pNum = parseInt(text.replace(/\D/g, ''), 10);
                if (isNaN(pNum)) return { success: false, reply: "❓ Please enter a valid profile number (e.g. *2*)." };

                const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).eq('profile_no', pNum).order('id', { ascending: true });
                if (!users || users.length === 0) return { success: false, reply: `❌ *Profile #${pNum} Not Found*\nNo account with Profile #${pNum} exists under your organization.` };

                const user = users[0];
                const [pointsRes, redempRes] = await Promise.all([
                    supabase.from('Points').select('points').eq('user_id', user.id).order('id', { ascending: false }).limit(1),
                    supabase.from('Redemptions').select('item_name, redeemed_at').eq('user_id', user.id).order('redeemed_at', { ascending: false })
                ]);

                const currentPoints = (pointsRes.data && pointsRes.data.length > 0) ? pointsRes.data[0].points : 0;
                const redemps = redempRes.data || [];
                const isOld = redemps.length > 0;

                currentSession.step = 'PROFILE_CARD_ACTIONS';
                currentSession.userId = user.id;
                currentSession.profileNo = pNum;
                currentSession.email = user.email;
                currentSession.server = user.server;
                currentSession.currentPoints = currentPoints;
                userSessions.set(phone, currentSession);

                let card = `👤 *PROFILE #${pNum}*\n━━━━━━━━━━━━━━━━━━━━\n📧 *Email:*\n${user.email}\n\n🌎 *Server:*\n${user.server || '-'}\n\n⭐ *Points:*\n*${currentPoints.toLocaleString()}*\n\n🟢 *Status:*\n${user.status === 'active' ? 'Active 🟢' : 'Banned 🔴'}\n\n🏷️ *Type:*\n${isOld ? 'Old Account 🎁' : 'New Account 🆕'}\n\n🎁 *Redemption:*\n${isOld ? `${redemps.length} times (${redemps.map(r => r.item_name).join(', ')})` : '0 times'}\n━━━━━━━━━━━━━━━━━━━━\n*What next?*\n1️⃣ ⚡ Update Points\n2️⃣ 🎁 Redeem\n3️⃣ ✏️ Edit Info\n\n👉 Reply *1*, *2*, or *3* (or *BACK*)`;
                return { success: true, reply: card };
            }

            // --- C. PROFILE CARD ACTION SELECTION (1: Update, 2: Redeem, 3: Edit) ---
            if (step === 'PROFILE_CARD_ACTIONS') {
                if (text === '1' || upperText.includes('POINT')) {
                    currentSession.step = 'UPDATE_POINTS_CHOOSE_ACTION';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `⚡ *UPDATE POINTS — Profile #${currentSession.profileNo}*\nCurrent Points: ⭐ *${currentSession.currentPoints.toLocaleString()}*\n\nHow do you want to update?\n1️⃣ ➕ Add Points\n2️⃣ ➖ Deduct Points\n3️⃣ 🎯 Set Exact Points\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1*, *2*, or *3* (or *BACK*)`
                    };
                }

                if (text === '2' || upperText.includes('REDEEM')) {
                    currentSession.step = 'REDEEM_CHOOSE_ITEM';
                    userSessions.set(phone, currentSession);
                    let menu = `🎁 *REWARDS FOR PROFILE #${currentSession.profileNo}*\nCurrent Points: ⭐ *${currentSession.currentPoints.toLocaleString()}*\n━━━━━━━━━━━━━━━━━━━━\n`;
                    REDEEM_ITEMS.forEach(it => {
                        const canAfford = currentSession.currentPoints >= it.cost;
                        menu += `${it.id}️⃣ ${it.name} — ${it.cost.toLocaleString()} pts ${canAfford ? '✅' : '🔒'}\n`;
                    });
                    menu += `━━━━━━━━━━━━━━━━━━━━\n👉 Reply with item number *1 - 9* (or *BACK*)`;
                    return { success: true, reply: menu };
                }

                if (text === '3' || upperText.includes('EDIT')) {
                    currentSession.step = 'EDIT_INFO';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `✏️ *Edit Info for Profile #${currentSession.profileNo} (${currentSession.email}):*\n━━━━━━━━━━━━━━━━━━━━\nReply with what you want to change:\n• *SERVER <server_name>*\n• *STATUS <active|banned>*\n• *PASS <new_password>*\n• *ALT <alt_email>*\n• *NOTE <notes>*\n\n👉 Send field update (or *BACK*)`
                    };
                }

                if (text === '4') {
                    userSessions.delete(phone);
                    const statusText = await getTodayStatusText(adminId);
                    return { success: true, reply: statusText };
                }

                if (text === '5') {
                    currentSession.step = 'ACCOUNT_LISTS_MENU';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `📋 *ACCOUNT LISTS*\n━━━━━━━━━━━━━━━━━━━━\n1️⃣ 🟢 Active Accounts\n2️⃣ 🔴 Banned Accounts\n3️⃣ 🟦 Old Accounts (Redeemed)\n4️⃣ 🆕 New Accounts (Fresh)\n5️⃣ 🎁 Ready to Redeem (5,000+ pts)\n6️⃣ ⭐ Highest Points\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 6* (or *BACK*)`
                    };
                }

                if (text === '6') {
                    currentSession.step = 'DOWNLOAD_MENU';
                    userSessions.set(phone, currentSession);
                    return {
                        success: true,
                        reply: `📥 *DOWNLOADS*\n━━━━━━━━━━━━━━━━━━━━\nWhat do you need?\n\n1️⃣ 📋 Detailed Accounts (.xlsx)\n2️⃣ 🟦 Old Accounts (.xlsx)\n3️⃣ 🆕 New Accounts (.xlsx)\n4️⃣ 📊 Points List (.xlsx)\n5️⃣ 📄 PDF Report (.pdf)\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1 - 5* (or *BACK*)`
                    };
                }

                if (text === '7') {
                    userSessions.delete(phone);
                    const recentText = await getRecentActivityText(adminId);
                    return { success: true, reply: recentText };
                }

                if (text === '8') {
                    userSessions.delete(phone);
                    return {
                        success: true,
                        reply: `⚙️ *POINTPULSE SETTINGS*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Authorized User:* ${userName}\n📱 *Phone:* +${phone}\n🔑 *Permissions:* ${authUser.permissions || 'Full Access'}\n🌐 *Organization ID:* #${adminId}\n🟢 *System Status:* Online & Connected\n━━━━━━━━━━━━━━━━━━━━\n_Reply *START* to return to menu._`
                    };
                }

                return {
                    success: false,
                    reply: `❓ Reply with *1* (Update Points), *2* (Redeem), *3* (Edit Info), or *BACK* for Main Menu.`
                };
            }

            // --- D. UPDATE POINTS: SELECT PROFILE ---
            if (step === 'UPDATE_POINTS_SELECT_PROFILE') {
                const pNum = parseInt(text.replace(/\D/g, ''), 10);
                if (isNaN(pNum)) return { success: false, reply: "❓ Please enter a valid profile number (e.g. *2*)." };

                const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).eq('profile_no', pNum).order('id', { ascending: true });
                if (!users || users.length === 0) return { success: false, reply: `❌ *Profile #${pNum} Not Found*.` };

                const user = users[0];
                const { data: pointsRes } = await supabase.from('Points').select('points').eq('user_id', user.id).order('id', { ascending: false }).limit(1);
                const currentPoints = (pointsRes && pointsRes.length > 0) ? pointsRes[0].points : 0;

                currentSession.step = 'UPDATE_POINTS_CHOOSE_ACTION';
                currentSession.userId = user.id;
                currentSession.profileNo = pNum;
                currentSession.email = user.email;
                currentSession.currentPoints = currentPoints;
                userSessions.set(phone, currentSession);

                return {
                    success: true,
                    reply: `Profile #${pNum}\nCurrent Points: ⭐ *${currentPoints.toLocaleString()}*\n\nHow do you want to update?\n1️⃣ ➕ Add Points\n2️⃣ ➖ Deduct Points\n3️⃣ 🎯 Set Exact Points\n\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply with *1*, *2*, or *3*`
                };
            }

            // --- E. UPDATE POINTS: CHOOSE ACTION (1: Add, 2: Deduct, 3: Set) ---
            if (step === 'UPDATE_POINTS_CHOOSE_ACTION') {
                if (text === '1' || upperText.includes('ADD') || text.startsWith('+')) {
                    currentSession.step = 'UPDATE_POINTS_INPUT_AMOUNT';
                    currentSession.actionType = 'ADD';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `➕ *ADD POINTS*\n\nHow many points to add to Profile #${currentSession.profileNo}?\n_Example: 500_` };
                }

                if (text === '2' || upperText.includes('DEDUCT') || text.startsWith('-')) {
                    currentSession.step = 'UPDATE_POINTS_INPUT_AMOUNT';
                    currentSession.actionType = 'DEDUCT';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `➖ *DEDUCT POINTS*\n\nHow many points to deduct from Profile #${currentSession.profileNo}?\n_Example: 200_` };
                }

                if (text === '3' || upperText.includes('SET')) {
                    currentSession.step = 'UPDATE_POINTS_INPUT_AMOUNT';
                    currentSession.actionType = 'SET';
                    userSessions.set(phone, currentSession);
                    return { success: true, reply: `🎯 *SET EXACT POINTS*\n\nWhat is the new total points balance for Profile #${currentSession.profileNo}?\n_Example: 5000_` };
                }
            }

            // --- F. UPDATE POINTS: INPUT AMOUNT ---
            if (step === 'UPDATE_POINTS_INPUT_AMOUNT') {
                const amount = parseInt(text.replace(/,/g, '').trim(), 10);
                if (isNaN(amount) || amount < 0) return { success: false, reply: "❌ Invalid amount. Please enter a positive number (e.g. *500*)." };

                let newPoints = currentSession.currentPoints;
                let changeStr = '';

                if (currentSession.actionType === 'ADD') {
                    newPoints = currentSession.currentPoints + amount;
                    changeStr = `+${amount.toLocaleString()}`;
                } else if (currentSession.actionType === 'DEDUCT') {
                    newPoints = Math.max(0, currentSession.currentPoints - amount);
                    changeStr = `-${amount.toLocaleString()}`;
                } else {
                    newPoints = amount;
                    const diff = newPoints - currentSession.currentPoints;
                    changeStr = diff >= 0 ? `+${diff.toLocaleString()}` : `${diff.toLocaleString()}`;
                }

                pendingConfirmations.set(phone, {
                    type: 'POINTS',
                    adminId,
                    userId: currentSession.userId,
                    profileNo: currentSession.profileNo,
                    email: currentSession.email,
                    currentPoints: currentSession.currentPoints,
                    newPoints,
                    expiresAt: Date.now() + 5 * 60 * 1000
                });

                return {
                    success: true,
                    reply: `⚠️ *CONFIRM POINTS UPDATE*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Profile:* #${currentSession.profileNo}\n⭐ ${currentSession.currentPoints.toLocaleString()} ➜ *${newPoints.toLocaleString()}*\n⚡ *Change:* ${changeStr}\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply *YES* to confirm\n👉 Reply *NO* to cancel`
                };
            }

            // --- G. REDEEM: SELECT PROFILE ---
            if (step === 'REDEEM_SELECT_PROFILE') {
                const pNum = parseInt(text.replace(/\D/g, ''), 10);
                if (isNaN(pNum)) return { success: false, reply: "❓ Please enter a valid profile number (e.g. *2*)." };

                const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).eq('profile_no', pNum).order('id', { ascending: true });
                if (!users || users.length === 0) return { success: false, reply: `❌ *Profile #${pNum} Not Found*.` };

                const user = users[0];
                const { data: pointsRes } = await supabase.from('Points').select('points').eq('user_id', user.id).order('id', { ascending: false }).limit(1);
                const currentPoints = (pointsRes && pointsRes.length > 0) ? pointsRes[0].points : 0;

                currentSession.step = 'REDEEM_CHOOSE_ITEM';
                currentSession.userId = user.id;
                currentSession.profileNo = pNum;
                currentSession.email = user.email;
                currentSession.currentPoints = currentPoints;
                userSessions.set(phone, currentSession);

                let menu = `👤 *Profile #${pNum}*\n⭐ *Points:* ${currentPoints.toLocaleString()}\n\n*Available Rewards:*\n━━━━━━━━━━━━━━━━━━━━\n`;
                REDEEM_ITEMS.forEach(it => {
                    const canAfford = currentPoints >= it.cost;
                    menu += `${it.id}️⃣ ${it.name} (${it.cost.toLocaleString()} pts) ${canAfford ? '✅' : '🔒'}\n`;
                });
                menu += `━━━━━━━━━━━━━━━━━━━━\n👉 Choose reward: Reply *1 - 9* (or *BACK*)`;
                return { success: true, reply: menu };
            }

            // --- H. REDEEM: CHOOSE ITEM ---
            if (step === 'REDEEM_CHOOSE_ITEM') {
                const itemNum = parseInt(text, 10);
                let selectedItem = null;
                if (!isNaN(itemNum) && itemNum >= 1 && itemNum <= REDEEM_ITEMS.length) {
                    selectedItem = REDEEM_ITEMS[itemNum - 1];
                } else {
                    selectedItem = REDEEM_ITEMS.find(it => it.name.toLowerCase().includes(text.toLowerCase()));
                }

                if (!selectedItem) {
                    return { success: false, reply: `❓ Please reply with a valid number from *1 - 9*, or *BACK*.` };
                }

                const remaining = currentSession.currentPoints - selectedItem.cost;

                pendingConfirmations.set(phone, {
                    type: 'REDEEM',
                    adminId,
                    userId: currentSession.userId,
                    profileNo: currentSession.profileNo,
                    email: currentSession.email,
                    itemName: selectedItem.name,
                    pointsCost: selectedItem.cost,
                    expiresAt: Date.now() + 5 * 60 * 1000
                });

                return {
                    success: true,
                    reply: `🎁 *${selectedItem.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Profile:* #${currentSession.profileNo}\n⭐ *Points:* ${currentSession.currentPoints.toLocaleString()}\n⚡ *Required:* ${selectedItem.cost.toLocaleString()} pts\n💰 *Remaining:* ${remaining.toLocaleString()} pts\n━━━━━━━━━━━━━━━━━━━━\n*Confirm redemption?*\n👉 Reply *YES* to confirm\n👉 Reply *NO* to cancel`
                };
            }

            // --- I. ACCOUNT LISTS MENU ---
            if (step === 'ACCOUNT_LISTS_MENU') {
                const listText = await getAccountListText(adminId, text.toLowerCase());
                if (listText) {
                    userSessions.delete(phone);
                    return { success: true, reply: listText };
                }
            }

            // --- J. DOWNLOADS MENU ---
            if (step === 'DOWNLOAD_MENU') {
                let dlType = 'all';
                let isPdf = false;
                let dlLabel = '';

                if (text === '1') { dlType = 'all'; dlLabel = 'Detailed Accounts Master'; }
                else if (text === '2') { dlType = 'old'; dlLabel = 'Old Accounts (Redeemed)'; }
                else if (text === '3') { dlType = 'new'; dlLabel = 'New Accounts (Fresh)'; }
                else if (text === '4') { dlType = 'points'; dlLabel = 'Points List Summary'; }
                else if (text === '5') { dlType = 'all'; isPdf = true; dlLabel = 'Master Accounts PDF Report'; }
                else {
                    return { success: false, reply: `❓ Reply with *1 - 5* (or *CANCEL*).` };
                }

                userSessions.delete(phone);

                if (isPdf) {
                    const result = await generatePdfExportBuffer(adminId, dlType);
                    if (!result) return { success: false, reply: `⚠️ No accounts found for PDF export.` };
                    return {
                        success: true,
                        document: {
                            buffer: result.buffer,
                            fileName: `PointPulse_All_Accounts.pdf`,
                            mimetype: 'application/pdf',
                            caption: `📄 *PointPulse ${dlLabel}*\n📦 Accounts: ${result.count}\n🕒 Generated: ${new Date().toLocaleTimeString()}\n━━━━━━━━━━━━━━━━━━━━`
                        }
                    };
                } else {
                    const result = await generateExcelExportBuffer(adminId, dlType);
                    if (!result) return { success: false, reply: `⚠️ No accounts found for Excel export.` };
                    return {
                        success: true,
                        document: {
                            buffer: result.buffer,
                            fileName: `PointPulse_${dlType.charAt(0).toUpperCase() + dlType.slice(1)}_${Date.now()}.xlsx`,
                            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            caption: `📊 *PointPulse ${dlLabel} Export*\n📦 Records: ${result.count}\n🕒 Generated: ${new Date().toLocaleTimeString()}\n━━━━━━━━━━━━━━━━━━━━`
                        }
                    };
                }
            }

            // --- K. EDIT INFO ---
            if (step === 'EDIT_INFO') {
                const parts = text.split(/\s+/);
                const fieldKey = parts[0].toUpperCase();
                const fieldVal = parts.slice(1).join(' ').trim();

                if (!fieldVal) return { success: false, reply: "❌ Please provide a value. Example: *SERVER US-CA#655*" };

                const updates = {};
                let fieldLabel = '';

                if (fieldKey === 'SERVER') { updates.server = fieldVal; fieldLabel = 'Server'; }
                else if (fieldKey === 'STATUS') {
                    const st = fieldVal.toLowerCase();
                    if (!['active', 'banned'].includes(st)) return { success: false, reply: "❌ Status must be *active* or *banned*." };
                    updates.status = st; fieldLabel = 'Status';
                } else if (fieldKey === 'PASS' || fieldKey === 'PASSWORD') { updates.password = fieldVal; fieldLabel = 'Password'; }
                else if (fieldKey === 'ALT' || fieldKey === 'ALTERNATIVE') { updates.alternative_email = fieldVal; fieldLabel = 'Alternative Email'; }
                else if (fieldKey === 'NOTE' || fieldKey === 'NOTES') { updates.notes = fieldVal; fieldLabel = 'Notes'; }
                else { return { success: false, reply: "❓ Use *SERVER*, *STATUS*, *PASS*, *ALT*, or *NOTE*." }; }

                await supabase.from('Users').update(updates).eq('id', currentSession.userId).eq('admin_id', adminId);
                userSessions.delete(phone);

                return {
                    success: true,
                    reply: `✅ *Profile #${currentSession.profileNo} Updated!*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Account:* ${currentSession.email}\n✏️ *${fieldLabel}:* ${fieldVal}\n🕒 *Time:* ${new Date().toLocaleTimeString()}\n━━━━━━━━━━━━━━━━━━━━`
                };
            }
        }

        // ==========================================
        // 7. DIRECT PROFILE COMMANDS (P2, P2 +500, P2 -200, P2 5000)
        // ==========================================
        const profileCmdRegex = /^[pP](?:rofile\s*|rof\s*)?(\d+)(?:\s+(.+))?\s*$/i;
        const match = text.match(profileCmdRegex);

        if (match) {
            const profileNo = parseInt(match[1], 10);
            const actionArg = match[2] ? match[2].trim() : null;

            const { data: users, error: userError } = await supabase
                .from('Users')
                .select('*')
                .eq('admin_id', adminId)
                .eq('profile_no', profileNo)
                .order('id', { ascending: true });

            if (userError || !users || users.length === 0) {
                return {
                    success: false,
                    reply: `❌ *Profile #${profileNo} Not Found*\nNo account with Profile #${profileNo} exists under your PointPulse organization.`
                };
            }

            const user = users[0];

            const [pointsRes, redemptionsRes] = await Promise.all([
                supabase.from('Points').select('points').eq('user_id', user.id).order('id', { ascending: false }).limit(1),
                supabase.from('Redemptions').select('item_name, redeemed_at').eq('user_id', user.id).order('redeemed_at', { ascending: false })
            ]);

            const currentPoints = (pointsRes.data && pointsRes.data.length > 0) ? pointsRes.data[0].points : 0;
            const redemps = redemptionsRes.data || [];
            const isOld = redemps.length > 0;

            // Direct Profile View (e.g. "P2")
            if (!actionArg) {
                userSessions.set(phone, {
                    step: 'PROFILE_CARD_ACTIONS',
                    adminId,
                    userId: user.id,
                    profileNo,
                    email: user.email,
                    server: user.server,
                    currentPoints,
                    expiresAt: Date.now() + 5 * 60 * 1000
                });

                return {
                    success: true,
                    reply: `👤 *PROFILE #${profileNo}*\n━━━━━━━━━━━━━━━━━━━━\n📧 *Email:*\n${user.email}\n\n🌎 *Server:*\n${user.server || '-'}\n\n⭐ *Points:*\n*${currentPoints.toLocaleString()}*\n\n🟢 *Status:*\n${user.status === 'active' ? 'Active 🟢' : 'Banned 🔴'}\n\n🏷️ *Type:*\n${isOld ? 'Old Account 🎁' : 'New Account 🆕'}\n\n🎁 *Redemption:*\n${isOld ? `${redemps.length} times (${redemps.map(r => r.item_name).join(', ')})` : '0 times'}\n━━━━━━━━━━━━━━━━━━━━\n*What next?*\n1️⃣ ⚡ Update Points\n2️⃣ 🎁 Redeem\n3️⃣ ✏️ Edit Info\n\n👉 Reply *1*, *2*, or *3* (or *BACK*)`
                };
            }

            // Direct Fast Point Update (e.g. "P2 +500", "P2 -200", "P2 5000")
            if (!hasPermission(authUser.permissions, 'points_update')) {
                return { success: false, reply: `⛔ *Permission Denied*\nYou do not have permission to update points.` };
            }

            let newPoints = currentPoints;
            let changeStr = '';

            if (actionArg.startsWith('+')) {
                const addVal = parseInt(actionArg.substring(1), 10);
                if (isNaN(addVal) || addVal <= 0) return { success: false, reply: "❌ Invalid amount. Example: *P2 +500*" };
                newPoints = currentPoints + addVal;
                changeStr = `+${addVal.toLocaleString()}`;
            } else if (actionArg.startsWith('-')) {
                const subVal = parseInt(actionArg.substring(1), 10);
                if (isNaN(subVal) || subVal <= 0) return { success: false, reply: "❌ Invalid amount. Example: *P2 -200*" };
                newPoints = Math.max(0, currentPoints - subVal);
                changeStr = `-${subVal.toLocaleString()}`;
            } else {
                const setVal = parseInt(actionArg, 10);
                if (isNaN(setVal) || setVal < 0) return { success: false, reply: "❌ Invalid points value. Example: *P2 5000*" };
                newPoints = setVal;
                const diff = newPoints - currentPoints;
                changeStr = diff >= 0 ? `+${diff.toLocaleString()}` : `${diff.toLocaleString()}`;
            }

            pendingConfirmations.set(phone, {
                type: 'POINTS',
                adminId,
                userId: user.id,
                profileNo,
                email: user.email,
                currentPoints,
                newPoints,
                expiresAt: Date.now() + 5 * 60 * 1000
            });

            return {
                success: true,
                reply: `⚠️ *CONFIRM POINTS UPDATE*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Profile:* #${profileNo}\n⭐ ${currentPoints.toLocaleString()} ➜ *${newPoints.toLocaleString()}*\n⚡ *Change:* ${changeStr}\n━━━━━━━━━━━━━━━━━━━━\n👉 Reply *YES* to confirm\n👉 Reply *NO* to cancel`
            };
        }

        return { success: false, reply: null };

    } catch (err) {
        console.error("Process WhatsApp Message Error:", err);
        return { success: false, reply: "⚠️ An error occurred while processing your request." };
    }
};

// Webhook Handlers
const verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'pointpulse_secret_token_2026')) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
};

const handleWebhook = async (req, res) => {
    try {
        const body = req.body;
        if (body.object && body.entry) {
            for (const entry of body.entry) {
                for (const change of entry.changes || []) {
                    if (change.value?.messages) {
                        for (const msg of change.value.messages) {
                            if (msg.type === 'text') {
                                await processIncomingMessage(msg.from, msg.text.body);
                            }
                        }
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    } catch (e) {
        return res.status(500).json({ error: 'Webhook error' });
    }
};

const getAuthorizedUsers = async (req, res) => {
    try {
        const adminId = req.user.admin_id;
        const { data, error } = await supabase.from('whatsapp_authorized_users').select('*').eq('admin_id', adminId).order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching authorized users' });
    }
};

const addAuthorizedUser = async (req, res) => {
    try {
        const adminId = req.user.admin_id;
        const { phone_number, name, role, permissions } = req.body;
        if (!phone_number) return res.status(400).json({ error: 'Phone number is required' });

        const normalized = normalizePhoneNumber(phone_number);
        const { data, error } = await supabase.from('whatsapp_authorized_users').insert([{
            admin_id: adminId,
            phone_number: normalized,
            name: name || null,
            role: role || 'manager',
            permissions: permissions || 'view,points_update'
        }]).select().single();

        if (error) throw error;
        invalidateAuthCache();
        res.status(201).json({ success: true, user: data });
    } catch (e) {
        res.status(500).json({ error: 'Error adding authorized user' });
    }
};

const deleteAuthorizedUser = async (req, res) => {
    try {
        const adminId = req.user.admin_id;
        const id = req.params.id;
        const { error } = await supabase.from('whatsapp_authorized_users').delete().eq('id', id).eq('admin_id', adminId);
        if (error) throw error;
        invalidateAuthCache();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Error deleting user' });
    }
};

const simulateIncomingMessage = async (req, res) => {
    try {
        const adminId = req.user.admin_id;
        const { phone_number, message } = req.body;
        if (!phone_number || !message) return res.status(400).json({ error: 'Phone number and message are required' });

        const result = await processIncomingMessage(phone_number, message, adminId);
        res.json({
            success: true,
            reply: result.reply || (result.document ? `📄 [Document Sent: ${result.document.fileName}]` : 'No reply generated')
        });
    } catch (e) {
        res.status(500).json({ error: 'Error processing simulated message' });
    }
};

const updateAuthorizedUser = async (req, res) => {
    try {
        const adminId = req.user.admin_id;
        const id = req.params.id;
        const { name, role, permissions, is_active } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (role !== undefined) updates.role = role;
        if (permissions !== undefined) updates.permissions = permissions;
        if (is_active !== undefined) updates.is_active = is_active;

        const { data, error } = await supabase.from('whatsapp_authorized_users').update(updates).eq('id', id).eq('admin_id', adminId).select().single();
        if (error) throw error;
        invalidateAuthCache();
        res.json({ success: true, user: data });
    } catch (e) {
        res.status(500).json({ error: 'Error updating authorized user' });
    }
};

const getBaileysStatus = (req, res) => {
    res.json(baileysService.getStatus());
};

const startBaileys = async (req, res) => {
    try {
        const status = await baileysService.startWhatsApp();
        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ error: 'Error starting WhatsApp client' });
    }
};

const disconnectBaileys = async (req, res) => {
    try {
        const status = await baileysService.disconnectWhatsApp();
        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ error: 'Error disconnecting WhatsApp client' });
    }
};

module.exports = {
    setIo,
    verifyWebhook,
    handleWebhook,
    processIncomingMessage,
    getAuthorizedUsers,
    addAuthorizedUser,
    createAuthorizedUser: addAuthorizedUser,
    updateAuthorizedUser,
    deleteAuthorizedUser,
    simulateIncomingMessage,
    testMessage: simulateIncomingMessage,
    getBaileysStatus,
    startBaileys,
    disconnectBaileys
};
