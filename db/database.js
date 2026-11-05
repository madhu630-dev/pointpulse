const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const supabase = require('./supabase');

const dbPath = path.resolve(__dirname, '../database.sqlite');
const ADMIN_EMAIL = '001.workme@gmail.com';

let sqlite = null;
let driverType = null;

// Initialize SQLite driver: prefer high-performance native node:sqlite (Node 22.5+ / 24+), with sqlite3 fallback
try {
    const { DatabaseSync } = require('node:sqlite');
    sqlite = new DatabaseSync(dbPath);
    driverType = 'node:sqlite';
    console.log('[PointPulse DB] Initialized native node:sqlite driver.');
} catch (e) {
    try {
        const sqlite3 = require('sqlite3').verbose();
        sqlite = new sqlite3.Database(dbPath);
        driverType = 'sqlite3';
        console.log('[PointPulse DB] Initialized sqlite3 driver.');
    } catch (err2) {
        console.error('[PointPulse DB] No SQLite driver available:', err2.message);
    }
}

const sanitizeParams = (params) => {
    if (!params) return [];
    const arr = Array.isArray(params) ? params : [params];
    return arr.map(v => (v === undefined ? null : v));
};

// Promisified SQLite helper functions
const run = (sql, params = []) => {
    if (driverType === 'node:sqlite') {
        return new Promise((resolve, reject) => {
            try {
                const cleanParams = sanitizeParams(params);
                const stmt = sqlite.prepare(sql.trim());
                const info = cleanParams.length > 0 ? stmt.run(...cleanParams) : stmt.run();
                resolve({ lastID: Number(info.lastInsertRowid), changes: info.changes });
            } catch (err) {
                reject(err);
            }
        });
    }

    return new Promise((resolve, reject) => {
        if (!sqlite) return reject(new Error('SQLite database not initialized'));
        sqlite.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

const get = (sql, params = []) => {
    if (driverType === 'node:sqlite') {
        return new Promise((resolve, reject) => {
            try {
                const cleanParams = sanitizeParams(params);
                const stmt = sqlite.prepare(sql.trim());
                const row = cleanParams.length > 0 ? stmt.get(...cleanParams) : stmt.get();
                resolve(row ? { ...row } : undefined);
            } catch (err) {
                reject(err);
            }
        });
    }

    return new Promise((resolve, reject) => {
        if (!sqlite) return reject(new Error('SQLite database not initialized'));
        sqlite.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const all = (sql, params = []) => {
    if (driverType === 'node:sqlite') {
        return new Promise((resolve, reject) => {
            try {
                const cleanParams = sanitizeParams(params);
                const stmt = sqlite.prepare(sql.trim());
                const rows = cleanParams.length > 0 ? stmt.all(...cleanParams) : stmt.all();
                resolve((rows || []).map(r => ({ ...r })));
            } catch (err) {
                reject(err);
            }
        });
    }

    return new Promise((resolve, reject) => {
        if (!sqlite) return reject(new Error('SQLite database not initialized'));
        sqlite.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
};

// Initialize SQLite Schema to guarantee full functionality
async function initSchema() {
    await run(`
        CREATE TABLE IF NOT EXISTS app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            picture TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'pending',
            display_name TEXT,
            phone TEXT,
            registration_purpose TEXT,
            account_management_description TEXT,
            terms_accepted INTEGER DEFAULT 0,
            policy_version TEXT DEFAULT '1.0',
            terms_accepted_at TEXT,
            approved_at TEXT,
            approved_by INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Ensure password_hash column exists for direct email/password authentication
    try {
        await run(`ALTER TABLE app_users ADD COLUMN password_hash TEXT`);
    } catch (e) {}

    // Ensure review_form_required column exists (0 = normal dashboard, 1 = admin sent form, dashboard blocked until submit)
    try {
        await run(`ALTER TABLE app_users ADD COLUMN review_form_required INTEGER DEFAULT 0`);
    } catch (e) {}

    await run(`
        CREATE TABLE IF NOT EXISTS rewards_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            points_required INTEGER NOT NULL,
            user_display TEXT NOT NULL,
            is_published INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS user_reward_visibility (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            mode TEXT NOT NULL DEFAULT 'all',
            selected_reward_ids TEXT DEFAULT '[]',
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            permission_key TEXT NOT NULL,
            granted_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            granted_by INTEGER,
            UNIQUE(user_id, permission_key)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS temporary_access_windows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            permitted_actions TEXT DEFAULT '["update_points"]',
            is_active INTEGER DEFAULT 1,
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS user_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            account_id INTEGER,
            details TEXT DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'Pending',
            admin_response TEXT,
            reviewed_by INTEGER,
            reviewed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_role TEXT NOT NULL DEFAULT 'admin',
            recipient_id INTEGER,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            data TEXT DEFAULT '{}',
            reference_id TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Ensure reference_id column exists if table was already created
    try {
        await run(`ALTER TABLE notifications ADD COLUMN reference_id TEXT`);
    } catch (e) {}

    // Account Metadata Mapping Table for User Assignment & Classification
    await run(`
        CREATE TABLE IF NOT EXISTS account_metadata (
            account_id INTEGER PRIMARY KEY,
            user_id INTEGER DEFAULT 1,
            classification TEXT DEFAULT 'new',
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Dedicated Account Credentials Table (Zero-Encryption Plaintext for Operator/Admin Visibility)
    await run(`
        CREATE TABLE IF NOT EXISTS account_credentials (
            account_id INTEGER PRIMARY KEY,
            email_password TEXT,
            proton_password TEXT,
            alternative_password TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS form_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            type TEXT NOT NULL,
            is_enabled INTEGER DEFAULT 1,
            deadline_day INTEGER NOT NULL DEFAULT 5,
            questions TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS form_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            form_type TEXT NOT NULL,
            schedule_id INTEGER,
            answers TEXT NOT NULL,
            submitted_at TEXT DEFAULT (datetime('now')),
            status TEXT NOT NULL DEFAULT 'submitted',
            reviewed_by INTEGER,
            reviewed_at TEXT,
            admin_notes TEXT
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS download_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            report_type TEXT NOT NULL,
            filters TEXT DEFAULT '{}',
            token TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            expires_at TEXT,
            approved_by INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            actor_email TEXT,
            actor_role TEXT,
            target_user_id INTEGER,
            action TEXT NOT NULL,
            previous_value TEXT,
            new_value TEXT,
            result TEXT NOT NULL DEFAULT 'success',
            record_id TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS points_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            user_id INTEGER,
            previous_points INTEGER,
            new_points INTEGER NOT NULL,
            difference INTEGER NOT NULL,
            updated_by INTEGER,
            updated_by_name TEXT,
            source TEXT DEFAULT 'web',
            auth_ref TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS account_classification_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            previous_classification TEXT,
            new_classification TEXT NOT NULL,
            changed_by INTEGER,
            reason TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS policy_acknowledgements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_type TEXT NOT NULL DEFAULT 'user',
            policy_version TEXT NOT NULL DEFAULT '1.0',
            accepted_at TEXT DEFAULT (datetime('now')),
            ip_address TEXT
        )
    `);

    // Dedicated Account Activity Log Table (Administrative modifications only; NO points or redemptions)
    await run(`
        CREATE TABLE IF NOT EXISTS account_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            actor_id INTEGER NOT NULL,
            actor_name TEXT,
            actor_role TEXT,
            action_type TEXT NOT NULL,
            description TEXT NOT NULL,
            previous_data TEXT,
            new_data TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Admin-Controlled Free Editing Period System
    await run(`
        CREATE TABLE IF NOT EXISTS user_editing_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            is_enabled INTEGER DEFAULT 1,
            duration INTEGER DEFAULT 7,
            unit TEXT DEFAULT 'days',
            start_event TEXT DEFAULT 'approval',
            allow_add INTEGER DEFAULT 1,
            allow_edit INTEGER DEFAULT 1,
            custom_expires_at TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Seed default global editing period if not present (Strictly Read-Only by default)
    const globalPeriod = await get(`SELECT * FROM user_editing_periods WHERE user_id IS NULL OR user_id = 0`);
    if (!globalPeriod) {
        await run(`
            INSERT INTO user_editing_periods (user_id, is_enabled, duration, unit, start_event, allow_add, allow_edit)
            VALUES (0, 0, 0, 'hours', 'approval', 0, 0)
        `);
    } else {
        await run(`UPDATE user_editing_periods SET is_enabled = 0, allow_add = 0, allow_edit = 0 WHERE user_id = 0 OR user_id IS NULL`);
    }

    // Ensure classification and user_id exist on local Users table if present
    try {
        await run(`ALTER TABLE Users ADD COLUMN classification TEXT DEFAULT 'new'`);
    } catch (e) {}
    try {
        await run(`ALTER TABLE Users ADD COLUMN user_id INTEGER DEFAULT 1`);
    } catch (e) {}

    // Seed default rewards if empty
    const rewardCount = await get(`SELECT count(*) as cnt FROM rewards_catalog`);
    if (!rewardCount || rewardCount.cnt === 0) {
        const initialRewards = [
            ['Amazon $5', 6500, 'AZ ($5) – 6500 pts', 1, 1],
            ['Amazon $10', 13000, 'AZ ($10) – 13000 pts', 1, 2],
            ['Overwatch 500 Coins', 5000, 'OW (500 C) – 5000 pts', 1, 3],
            ['Overwatch 1000 Coins', 10000, 'OW (1000 C) – 10000 pts', 1, 4],
            ['League of Legends 575 RP', 6500, 'LOL (575 RP) – 6500 pts', 1, 5],
            ['Minecraft 330 Minecoins', 2000, 'MC (330 MC) – 2000 pts', 1, 6],
            ['Roblox 840 Robux', 13000, '840 RBX – 13000 pts', 1, 7],
            ['Roblox 1050 Robux', 16750, '1050 RBX – 16750 pts', 1, 8],
            ['Sea of Thieves 150 Coins', 1700, 'SOT (150 C) – 1700 pts', 1, 9],
            ['Sea of Thieves 550 Coins', 5100, 'SOT (550 C) – 5100 pts', 1, 10],
            ['Sea of Thieves 1000 Coins', 8500, 'SOT (1000 C) – 8500 pts', 1, 11]
        ];

        for (const r of initialRewards) {
            await run(
                `INSERT INTO rewards_catalog (name, points_required, user_display, is_published, sort_order) VALUES (?, ?, ?, ?, ?)`,
                r
            );
        }
    }

    // Seed default monthly review questions
    const scheduleCount = await get(`SELECT count(*) as cnt FROM form_schedules`);
    if (!scheduleCount || scheduleCount.cnt === 0) {
        const defaultQuestions = [
            { id: 1, text: 'Have you reviewed your registered account information?', type: 'yes_no', required: true },
            { id: 2, text: 'Are all your account records accurate?', type: 'yes_no', required: true },
            { id: 3, text: 'Have any account statuses changed?', type: 'yes_no', details_placeholder: 'If yes, which accounts?', required: true },
            { id: 4, text: 'Are the recorded points up to date?', type: 'yes_no', required: true },
            { id: 5, text: 'Are there any accounts that require correction?', type: 'yes_no', details_placeholder: 'Specify account emails or profiles', required: true },
            { id: 6, text: 'Are there any new accounts to register?', type: 'yes_no', details_placeholder: 'Specify details', required: true },
            { id: 7, text: 'Do you need any account classification changes?', type: 'yes_no', details_placeholder: 'Old to New or New to Old requests', required: true },
            { id: 8, text: 'Are there any pending redemption-related updates?', type: 'yes_no', required: true },
            { id: 9, text: 'Do you have any issues requiring administrator attention?', type: 'yes_no', details_placeholder: 'Describe the issue', required: true },
            { id: 10, text: 'Additional comments or suggestions.', type: 'text', required: false }
        ];

        await run(
            `INSERT INTO form_schedules (title, type, is_enabled, deadline_day, questions) VALUES (?, ?, ?, ?, ?)`,
            ['Monthly Account & Rewards Review', 'beginning_of_month', 1, 5, JSON.stringify(defaultQuestions)]
        );
    }

    // Ensure single administrator identity exists in app_users
    let adminUser = await get(`SELECT * FROM app_users WHERE role = 'admin'`);
    if (!adminUser) {
        const res = await run(
            `INSERT INTO app_users (google_id, email, name, role, status, terms_accepted, terms_accepted_at, approved_at)
             VALUES (?, ?, ?, 'admin', 'approved', 1, datetime('now'), datetime('now'))`,
            ['google_admin_001_workme', ADMIN_EMAIL, 'PointPulse Administrator']
        );
        adminUser = await get(`SELECT * FROM app_users WHERE id = ?`, [res.lastID]);
    } else if (adminUser.email !== ADMIN_EMAIL) {
        // Enforce transfer to 001.workme@gmail.com
        await run(`UPDATE app_users SET email = ?, name = 'PointPulse Administrator' WHERE id = ?`, [ADMIN_EMAIL, adminUser.id]);
        adminUser.email = ADMIN_EMAIL;
    }

    // Provision admin permissions
    const adminPerms = [
        'view_accounts', 'add_accounts', 'edit_accounts', 'update_points', 
        'import_excel', 'view_redemption', 'download_reports', 
        'view_old_accounts', 'view_new_accounts', 'submit_requests'
    ];
    for (const p of adminPerms) {
        await run(
            `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)`,
            [adminUser.id, p, adminUser.id]
        );
    }

    console.log(`[PointPulse DB] Single Administrator verified: ${adminUser.email} (ID: ${adminUser.id})`);

    // 1. Restore any previously registered operators from persistent remote storage
    await restoreUsersFromRemote();

    // 2. Ensure all active operator users exist, are approved, and have valid password hashes
    const defaultOperatorHash = await bcrypt.hash('madhu123', 10);
    const seedOperators = [
        { email: 'patantajuddin882@gmail.com', name: 'Tajuddin Patan (Operator)', displayName: 'Tajuddin Patan' },
        { email: 'pulapallimahesh31@gmail.com', name: 'Mahesh Pulapalli (Operator)', displayName: 'Mahesh Pulapalli' },
        { email: 'madhugaddam092@gmail.com', name: 'Madhu Gaddam (Operator)', displayName: 'Madhu Gaddam' },
        { email: 'madhu999@gmail.com', name: 'Madhu 999 (Operator)', displayName: 'Madhu 999' },
        { email: 'laptopmew1@gmail.com', name: 'Madhu (Operator)', displayName: 'Madhu G' },
        { email: 'madhu99@gmail.com', name: 'Madhu 99 (Operator)', displayName: 'Madhu 99' }
    ];

    const operatorPerms = [
        'view_accounts', 'view_old_accounts', 'view_new_accounts', 'submit_requests', 'view_redemption'
    ];
    const writePerms = [
        'update_points', 'edit_accounts', 'add_accounts', 'import_excel'
    ];

    let primaryOperatorUser = null;

    for (const op of seedOperators) {
        let opUser = await get(`SELECT * FROM app_users WHERE lower(email) = ?`, [op.email.toLowerCase()]);
        if (!opUser) {
            const res = await run(
                `INSERT INTO app_users (google_id, email, name, display_name, role, status, password_hash, terms_accepted, terms_accepted_at, approved_at)
                 VALUES (?, ?, ?, ?, 'user', 'approved', ?, 1, datetime('now'), datetime('now'))`,
                [`operator_${op.email}`, op.email.toLowerCase(), op.name, op.displayName, defaultOperatorHash]
            );
            opUser = await get(`SELECT * FROM app_users WHERE id = ?`, [res.lastID]);
        } else {
            if (opUser.status !== 'approved') {
                await run(`UPDATE app_users SET status = 'approved', approved_at = datetime('now') WHERE id = ?`, [opUser.id]);
                opUser.status = 'approved';
            }
            if (!opUser.password_hash) {
                await run(`UPDATE app_users SET password_hash = ? WHERE id = ?`, [defaultOperatorHash, opUser.id]);
            }
        }

        if (op.email.toLowerCase() === 'laptopmew1@gmail.com') {
            primaryOperatorUser = opUser;
        }

        // Grant base read permissions
        for (const p of operatorPerms) {
            await run(
                `INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)`,
                [opUser.id, p, adminUser.id]
            );
        }

        // For Mahesh Pulapalli and Tajuddin Patan: guarantee active write & Excel upload window
        if (op.email.toLowerCase() === 'pulapallimahesh31@gmail.com' || op.email.toLowerCase() === 'patantajuddin882@gmail.com') {
            const futureExp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
            for (const wp of writePerms) {
                await run(
                    `INSERT INTO user_permissions (user_id, permission_key, granted_by, expires_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(user_id, permission_key) DO UPDATE SET expires_at = excluded.expires_at`,
                    [opUser.id, wp, adminUser.id, futureExp]
                );
            }
            await run(
                `INSERT INTO temporary_access_windows (user_id, start_time, end_time, permitted_actions, is_active, created_by)
                 VALUES (?, datetime('now'), datetime('now', '+30 days'), '["update_points", "import_excel", "edit_accounts", "add_accounts"]', 1, ?)`,
                [opUser.id, adminUser.id]
            );
        } else {
            // Clean up expired temporary write permissions by default for other users
            await run(
                `DELETE FROM user_permissions 
                 WHERE user_id = ? AND permission_key IN ('update_points', 'edit_accounts', 'add_accounts', 'import_excel') 
                 AND (expires_at IS NULL OR expires_at <= datetime('now'))`,
                [opUser.id]
            );
        }
    }

    // Strictly prune any non-allowed users so ONLY the approved operators and sole admin exist
    if (process.env.NODE_ENV !== 'test') {
        const allowedList = [
            ADMIN_EMAIL.toLowerCase(),
            ...seedOperators.map(o => o.email.toLowerCase())
        ];
        const placeholders = allowedList.map(() => '?').join(', ');
        await run(`DELETE FROM app_users WHERE lower(email) NOT IN (${placeholders})`, allowedList);
    }

    const operatorUser = primaryOperatorUser || await get(`SELECT * FROM app_users WHERE lower(email) = 'laptopmew1@gmail.com'`);

    // Fetch all accounts from Supabase and ensure they are populated into account_metadata mapped to respective operators
    try {
        const { data: accounts } = await supabase.from('Users').select('id, password, notes, admin_id');
        if (accounts && accounts.length > 0) {
            const userMahesh = await get(`SELECT id FROM app_users WHERE lower(email) = 'pulapallimahesh31@gmail.com'`);
            const userTajuddin = await get(`SELECT id FROM app_users WHERE lower(email) = 'patantajuddin882@gmail.com'`);
            const user99 = await get(`SELECT id FROM app_users WHERE lower(email) = 'madhu99@gmail.com'`);
            const user999 = await get(`SELECT id FROM app_users WHERE lower(email) = 'madhu999@gmail.com'`);
            const defaultOperatorId = operatorUser ? operatorUser.id : 1;

            for (const acc of accounts) {
                let targetUserId = defaultOperatorId;
                
                // Accounts 433-480 were entered/updated on Nov 3 by Mahesh Pulapalli
                if (acc.id >= 433 && userMahesh) {
                    targetUserId = userMahesh.id;
                } else if (acc.admin_id === 1 && user99) {
                    targetUserId = user99.id;
                } else if (acc.admin_id === 2 && user999) {
                    targetUserId = user999.id;
                }

                await run(
                    `INSERT INTO account_metadata (account_id, user_id, updated_at)
                     VALUES (?, ?, datetime('now'))
                     ON CONFLICT(account_id) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
                    [acc.id, targetUserId]
                );

                const creds = decodeCredentialsFromNotes(acc.notes);
                const emailPass = acc.password || '';
                if (emailPass || creds.proton_password || creds.alternative_password) {
                    await run(
                        `INSERT INTO account_credentials (account_id, email_password, proton_password, alternative_password, updated_at)
                         VALUES (?, ?, ?, ?, datetime('now'))
                         ON CONFLICT(account_id) DO UPDATE SET 
                            email_password = CASE WHEN excluded.email_password != '' THEN excluded.email_password ELSE account_credentials.email_password END,
                            proton_password = CASE WHEN excluded.proton_password != '' THEN excluded.proton_password ELSE account_credentials.proton_password END,
                            alternative_password = CASE WHEN excluded.alternative_password != '' THEN excluded.alternative_password ELSE account_credentials.alternative_password END,
                            updated_at = datetime('now')`,
                        [acc.id, emailPass, creds.proton_password, creds.alternative_password]
                    );
                }
            }
            console.log(`[PointPulse DB] Accounts successfully synced and assigned to respective operators (Mahesh Pulapalli, Tajuddin Patan, madhu99, madhu999, laptopmew1).`);
        }
    } catch (e) {
        console.warn('[PointPulse DB] Remote account sync warning during init:', e.message);
    }

    // Sync all operators to remote Supabase storage for durability
    await syncUsersToRemote();
}

// Sync all non-admin app_users to remote Supabase storage for durability across ephemeral Render restarts
async function syncUsersToRemote() {
    try {
        const users = await all(`SELECT * FROM app_users WHERE role = 'user'`);
        if (!users || users.length === 0) return;

        const syncPayload = JSON.stringify(users);
        const marker = '__pointpulse_user_sync__:';

        const { data: existing } = await supabase
            .from('rewards')
            .select('id')
            .like('reward_name', marker + '%')
            .limit(1);

        if (existing && existing.length > 0) {
            await supabase
                .from('rewards')
                .update({ reward_name: marker + syncPayload })
                .eq('id', existing[0].id);
        } else {
            await supabase
                .from('rewards')
                .insert([{ reward_name: marker + syncPayload }]);
        }
        console.log(`[PointPulse DB] Synced ${users.length} operators to remote storage.`);
    } catch (e) {
        console.warn('[PointPulse DB] Remote user sync warning:', e.message);
    }
}

// Restore app_users from remote Supabase storage
async function restoreUsersFromRemote() {
    try {
        const marker = '__pointpulse_user_sync__:';
        const { data } = await supabase
            .from('rewards')
            .select('reward_name')
            .like('reward_name', marker + '%')
            .order('created_at', { ascending: false })
            .limit(1);

        if (data && data.length > 0 && data[0].reward_name) {
            const rawJson = data[0].reward_name.substring(marker.length);
            const remoteUsers = JSON.parse(rawJson);
            if (Array.isArray(remoteUsers)) {
                for (const u of remoteUsers) {
                    if (!u.email) continue;
                    const existing = await get(`SELECT id FROM app_users WHERE lower(email) = ?`, [u.email.toLowerCase()]);
                    if (!existing) {
                        await run(
                            `INSERT INTO app_users (google_id, email, name, picture, role, status, password_hash, display_name, phone, registration_purpose, account_management_description, terms_accepted, terms_accepted_at, approved_at, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                u.google_id || `direct_${u.email.toLowerCase()}`,
                                u.email.toLowerCase(),
                                u.name || u.email.split('@')[0],
                                u.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || u.email)}&background=6366f1&color=fff`,
                                u.role || 'user',
                                u.status || 'approved',
                                u.password_hash || null,
                                u.display_name || u.name,
                                u.phone || null,
                                u.registration_purpose || null,
                                u.account_management_description || null,
                                u.terms_accepted || 1,
                                u.terms_accepted_at || new Date().toISOString(),
                                u.approved_at || new Date().toISOString(),
                                u.created_at || new Date().toISOString(),
                                u.updated_at || new Date().toISOString()
                            ]
                        );
                    }
                }
                console.log(`[PointPulse DB] Restored ${remoteUsers.length} operators from remote storage.`);
            }
        }
    } catch (e) {
        console.warn('[PointPulse DB] Remote user restore warning:', e.message);
    }
}

// Check and establish initial schema
initSchema().catch(err => console.error('[PointPulse DB Init Error]', err));

// Calculate user editing status & remaining duration
async function getUserEditingPeriodStatus(userId) {
    const user = await get(`SELECT id, role, status, approved_at, created_at FROM app_users WHERE id = ?`, [userId]);
    if (!user) return { canAdd: false, canEdit: false, canUpdatePoints: false, isFreePeriodActive: false, message: 'User not found' };

    if (user.role === 'admin') {
        return { 
            canAdd: true, 
            canEdit: true, 
            canUpdatePoints: true, 
            isFreePeriodActive: true, 
            isUnlimited: true, 
            remainingFormatted: 'Unlimited (Administrator)',
            statusText: 'Administrator (Unlimited Access)'
        };
    }

    // Fetch live user permissions (granted via quick toggles or admin panel)
    const nowIso = new Date().toISOString();
    const activePerms = await all(
        `SELECT permission_key FROM user_permissions 
         WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
        [userId, nowIso]
    );
    const permKeys = (activePerms || []).map(p => p.permission_key);
    const hasPermPoints = permKeys.includes('update_points') || permKeys.includes('all');
    const hasPermEdit = permKeys.includes('edit_accounts') || permKeys.includes('all');
    const hasPermAdd = permKeys.includes('add_accounts') || permKeys.includes('all');
    const hasPermImport = permKeys.includes('import_excel') || permKeys.includes('all');

    // 1. Check if user has an active temporary access window
    const activeWindow = await get(
        `SELECT * FROM temporary_access_windows 
         WHERE user_id = ? AND is_active = 1 AND start_time <= ? AND end_time >= ? 
         ORDER BY id DESC LIMIT 1`,
        [userId, nowIso, nowIso]
    );

    if (activeWindow) {
        let actions = [];
        try {
            actions = JSON.parse(activeWindow.permitted_actions || '[]');
        } catch (e) {
            actions = ['update_points'];
        }
        const winEnd = new Date(activeWindow.end_time);
        const winRemainingMs = Math.max(0, winEnd.getTime() - Date.now());
        const winRemainingHours = Math.floor(winRemainingMs / (3600 * 1000));
        const winRemainingMins = Math.floor((winRemainingMs % (3600 * 1000)) / (60 * 1000));
        const winFormatted = winRemainingHours > 0 
            ? `${winRemainingHours}h ${winRemainingMins}m remaining` 
            : `${winRemainingMins}m remaining`;

        const canUpdatePts = actions.includes('update_points') || actions.includes('all') || hasPermPoints;
        const canEditAcc = actions.includes('edit_accounts') || actions.includes('all') || hasPermEdit;
        const canAddAcc = actions.includes('add_accounts') || actions.includes('import_excel') || actions.includes('all') || hasPermAdd;
        const canImportXls = actions.includes('import_excel') || actions.includes('add_accounts') || actions.includes('all') || hasPermImport;

        return {
            canAdd: canAddAcc,
            canAddAccounts: canAddAcc,
            canEdit: canEditAcc,
            canEditAccounts: canEditAcc,
            canUpdatePoints: canUpdatePts,
            canImportExcel: canImportXls,
            isFreePeriodActive: true,
            isWithinWindow: true,
            isTemporaryWindow: true,
            expiresAt: winEnd.toISOString(),
            remainingMs: winRemainingMs,
            remainingFormatted: winFormatted,
            statusText: `Temporary Window Active (${winFormatted})`,
            permittedActions: actions,
            badgeClass: 'badge-active'
        };
    }

    // 2. Check if user has active permissions granted directly
    if (hasPermPoints || hasPermEdit || hasPermAdd || hasPermImport) {
        return {
            canAdd: hasPermAdd || hasPermImport,
            canAddAccounts: hasPermAdd || hasPermImport,
            canEdit: hasPermEdit,
            canEditAccounts: hasPermEdit,
            canUpdatePoints: hasPermPoints,
            canImportExcel: hasPermImport || hasPermAdd,
            isFreePeriodActive: true,
            isWithinWindow: true,
            isTemporaryWindow: false,
            remainingFormatted: 'Admin Permissions Enabled',
            statusText: 'Write Access Enabled',
            badgeClass: 'badge-active'
        };
    }

    // 3. Check user-specific period first, fallback to global default (user_id = 0)
    let period = await get(`SELECT * FROM user_editing_periods WHERE user_id = ?`, [userId]);
    if (!period) {
        period = await get(`SELECT * FROM user_editing_periods WHERE user_id = 0 OR user_id IS NULL`);
    }

    if (!period || !period.is_enabled) {
        return {
            canAdd: false,
            canAddAccounts: false,
            canEdit: false,
            canEditAccounts: false,
            canUpdatePoints: false,
            canImportExcel: false,
            isFreePeriodActive: false,
            isWithinWindow: false,
            isReadOnly: true,
            remainingFormatted: 'Read-Only (Locked)',
            statusText: 'Read-Only Mode (Request Access)',
            message: 'Your account is in Read-Only mode. Please submit an access request to the administrator.',
            badgeClass: 'badge-pending'
        };
    }

    let expiresAt = null;
    if (period.custom_expires_at) {
        expiresAt = new Date(period.custom_expires_at);
    } else {
        const startRefStr = (period.start_event === 'registration' || !user.approved_at) ? user.created_at : user.approved_at;
        const startRef = new Date(startRefStr || user.created_at || Date.now());
        const multiplier = (period.unit === 'hours') ? (3600 * 1000) : (24 * 3600 * 1000);
        expiresAt = new Date(startRef.getTime() + (period.duration * multiplier));
    }

    const now = new Date();
    const remainingMs = expiresAt.getTime() - now.getTime();
    const isActive = remainingMs > 0;

    let remainingFormatted = 'Expired';
    if (isActive) {
        const remainingDays = Math.floor(remainingMs / (24 * 3600 * 1000));
        const remainingHours = Math.floor((remainingMs % (24 * 3600 * 1000)) / (3600 * 1000));
        if (remainingDays > 0) {
            remainingFormatted = `${remainingDays}d ${remainingHours}h remaining`;
        } else {
            const remainingMins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
            remainingFormatted = `${remainingHours}h ${remainingMins}m remaining`;
        }
    }

    return {
        canAdd: isActive && Boolean(period.allow_add),
        canAddAccounts: isActive && Boolean(period.allow_add),
        canEdit: isActive && Boolean(period.allow_edit),
        canEditAccounts: isActive && Boolean(period.allow_edit),
        canUpdatePoints: isActive && Boolean(period.allow_edit),
        canImportExcel: isActive && Boolean(period.allow_add),
        isFreePeriodActive: isActive,
        isWithinWindow: isActive,
        isReadOnly: !isActive,
        expiresAt: expiresAt.toISOString(),
        remainingMs: Math.max(0, remainingMs),
        remainingFormatted: isActive ? remainingFormatted : 'Read-Only (Locked)',
        statusText: isActive ? `Editing Active (${remainingFormatted})` : 'Read-Only Mode (Request Access)',
        duration: period.duration,
        unit: period.unit,
        startEvent: period.start_event,
        badgeClass: isActive ? 'badge-active' : 'badge-pending'
    };
}

// Credentials encoding & decoding helpers for persistence across remote notes & SQLite
function decodeCredentialsFromNotes(rawNotes) {
    if (!rawNotes) return { notes: '', proton_password: '', alternative_password: '' };
    const markerRegex = /<!--pointpulse_cred:(.*?)-->/s;
    const match = rawNotes.match(markerRegex);
    let proton_password = '';
    let alternative_password = '';
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            proton_password = parsed.proton_pw || '';
            alternative_password = parsed.alt_pw || '';
        } catch (e) {}
    }
    const cleanNotes = rawNotes.replace(markerRegex, '').trim();
    return { notes: cleanNotes, proton_password, alternative_password };
}

function encodeCredentialsToNotes(cleanNotes, protonPassword, altPassword) {
    const baseNotes = (cleanNotes || '').replace(/<!--pointpulse_cred:.*?-->/gs, '').trim();
    if (!protonPassword && !altPassword) {
        return baseNotes;
    }
    const payload = JSON.stringify({
        proton_pw: protonPassword || '',
        alt_pw: altPassword || ''
    });
    return `${baseNotes}\n<!--pointpulse_cred:${payload}-->`.trim();
}

module.exports = {
    ADMIN_EMAIL,
    sqlite,
    run,
    get,
    all,
    supabase,
    getUserEditingPeriodStatus,
    decodeCredentialsFromNotes,
    encodeCredentialsToNotes,
    syncUsersToRemote,
    restoreUsersFromRemote
};
