const { get, run, all, ADMIN_EMAIL, supabase } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// Main Admin Dashboard Overview & KPI Metrics
const getDashboardOverview = async (req, res) => {
    try {
        const totalUsers = await get(`SELECT count(*) as c FROM app_users WHERE role = 'user'`);
        const approvedUsers = await get(`SELECT count(*) as c FROM app_users WHERE role = 'user' AND status = 'approved'`);
        const pendingUsers = await get(`SELECT count(*) as c FROM app_users WHERE role = 'user' AND status = 'pending'`);
        const rejectedUsers = await get(`SELECT count(*) as c FROM app_users WHERE role = 'user' AND status = 'rejected'`);
        const suspendedUsers = await get(`SELECT count(*) as c FROM app_users WHERE role = 'user' AND status = 'suspended'`);

        // Query managed accounts from Supabase Users & metadata
        const { data: accounts } = await supabase.from('Users').select('id, status');
        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        let totalActiveAccounts = 0;
        let totalBannedAccounts = 0;
        let totalOldAccounts = 0;
        let totalNewAccounts = 0;

        if (accounts) {
            accounts.forEach(a => {
                if (a.status === 'active') totalActiveAccounts++;
                else totalBannedAccounts++;

                const meta = metaMap.get(a.id);
                if (meta && meta.classification === 'old') totalOldAccounts++;
                else totalNewAccounts++;
            });
        }

        // Query Points & Redemptions count
        const { count: totalPointsRecords } = await supabase.from('Points').select('*', { count: 'exact', head: true });
        const { count: totalRedemptions } = await supabase.from('Redemptions').select('*', { count: 'exact', head: true });

        // Pending user requests by category
        const pendingRequests = await all(
            `SELECT category, count(*) as count FROM user_requests WHERE status = 'Pending' GROUP BY category`
        );
        const pendingMap = {};
        pendingRequests.forEach(r => pendingMap[r.category] = r.count);

        // Pending form submissions
        const pendingForms = await get(`SELECT count(*) as c FROM form_submissions WHERE status = 'submitted'`);

        // Recent Audit Logs
        const recentLogs = await all(
            `SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10`
        );

        res.json({
            users: {
                total: totalUsers ? totalUsers.c : 0,
                approved: approvedUsers ? approvedUsers.c : 0,
                pending: pendingUsers ? pendingUsers.c : 0,
                rejected: rejectedUsers ? rejectedUsers.c : 0,
                suspended: suspendedUsers ? suspendedUsers.c : 0
            },
            accounts: {
                total: accounts ? accounts.length : 0,
                active: totalActiveAccounts,
                banned: totalBannedAccounts,
                old: totalOldAccounts,
                new: totalNewAccounts
            },
            points: {
                totalRecords: totalPointsRecords || 0
            },
            redemptions: {
                total: totalRedemptions || 0
            },
            pendingActions: {
                pointsPermission: pendingMap['points_update'] || 0,
                accountCorrection: pendingMap['account_correction'] || 0,
                classificationChange: pendingMap['classification_change'] || 0,
                downloadPermission: pendingMap['download_permission'] || 0,
                redemption: pendingMap['redemption'] || 0,
                contactAdmin: pendingMap['contact_admin'] || 0,
                forms: pendingForms ? pendingForms.c : 0
            },
            recentLogs
        });

    } catch (error) {
        console.error('Admin Overview Error:', error);
        res.status(500).json({ error: 'Error generating admin overview' });
    }
};

// List all registered users with metrics and filters
const listUsers = async (req, res) => {
    try {
        const { search, status, sort } = req.query;

        let query = `SELECT * FROM app_users WHERE role = 'user'`;
        const params = [];

        if (status && status !== 'all') {
            query += ` AND status = ?`;
            params.push(status);
        }

        if (search) {
            query += ` AND (name LIKE ? OR email LIKE ? OR display_name LIKE ?)`;
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        if (sort === 'oldest') {
            query += ` ORDER BY id ASC`;
        } else {
            query += ` ORDER BY id DESC`;
        }

        const users = await all(query, params);

        // Fetch accounts and points metadata from Supabase & account_metadata
        const { data: allAccounts } = await supabase.from('Users').select('id, status, profile_no');
        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));
        const { data: allPoints } = await supabase.from('Points').select('user_id, points').order('id', { ascending: false });

        // Map latest points per account
        const latestPoints = new Map();
        if (allPoints) {
            allPoints.forEach(p => {
                if (!latestPoints.has(p.user_id)) latestPoints.set(p.user_id, p.points);
            });
        }

        // Aggregate per platform user
        const enrichedUsers = users.map(u => {
            const userAccounts = (allAccounts || []).filter(a => {
                const m = metaMap.get(a.id);
                return m ? m.user_id === u.id : (u.id === 1);
            });
            const activeCount = userAccounts.filter(a => a.status === 'active').length;
            const bannedCount = userAccounts.filter(a => a.status === 'banned').length;
            let totalPts = 0;
            userAccounts.forEach(a => {
                totalPts += (latestPoints.get(a.id) || 0);
            });

            return {
                id: u.id,
                email: u.email,
                name: u.name,
                picture: u.picture,
                displayName: u.display_name,
                status: u.status,
                phone: u.phone,
                registrationPurpose: u.registration_purpose,
                accountManagementDescription: u.account_management_description,
                createdAt: u.created_at,
                approvedAt: u.approved_at,
                accountsCount: userAccounts.length,
                activeAccountsCount: activeCount,
                bannedAccountsCount: bannedCount,
                totalPoints: totalPts
            };
        });

        res.json(enrichedUsers);
    } catch (error) {
        console.error('List Users Error:', error);
        res.status(500).json({ error: 'Error fetching users list' });
    }
};

// Update User Approval Status (Approve, Reject, Suspend, Reactivate)
const updateUserStatus = async (req, res) => {
    const userId = req.params.id;
    const { action, note } = req.body; // 'approve', 'reject', 'suspend', 'reactivate'

    const validActions = ['approve', 'reject', 'suspend', 'reactivate'];
    if (!validActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid user action' });
    }

    try {
        const user = await get(`SELECT * FROM app_users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') return res.status(400).json({ error: 'Cannot modify administrator status' });

        let newStatus = user.status;
        let actionDesc = '';
        const now = new Date().toISOString();

        if (action === 'approve') {
            newStatus = 'approved';
            actionDesc = 'User Registration Approved';
            await run(
                `UPDATE app_users SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
                [now, req.user.id, now, userId]
            );

            // Grant default read-only permissions
            const defaultPerms = ['view_accounts', 'view_old_accounts', 'view_new_accounts', 'submit_requests', 'view_redemption'];
            for (const p of defaultPerms) {
                await run(`INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)`, [userId, p, req.user.id]);
            }
        } else if (action === 'reject') {
            newStatus = 'rejected';
            actionDesc = 'User Registration Rejected';
            await run(`UPDATE app_users SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, userId]);
        } else if (action === 'suspend') {
            newStatus = 'suspended';
            actionDesc = 'User Account Suspended';
            await run(`UPDATE app_users SET status = 'suspended', updated_at = ? WHERE id = ?`, [now, userId]);
        } else if (action === 'reactivate') {
            newStatus = 'approved';
            actionDesc = 'User Account Reactivated';
            await run(`UPDATE app_users SET status = 'approved', updated_at = ? WHERE id = ?`, [now, userId]);
        }

        // Notify User
        await run(
            `INSERT INTO notifications (recipient_role, recipient_id, category, title, message)
             VALUES ('user', ?, 'account_status', ?, ?)`,
            [
                userId,
                `Account ${actionDesc}`,
                note || `Your PointPulse account access has been ${newStatus} by the administrator.`
            ]
        );

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, previous_value, new_value, result, record_id)
             VALUES (?, ?, 'admin', ?, ?, ?, ?, 'success', ?)`,
            [
                req.user.id, req.user.email, userId, actionDesc,
                JSON.stringify({ status: user.status }),
                JSON.stringify({ status: newStatus, note }),
                String(userId)
            ]
        );

        if (io) {
            io.emit('user_status_changed', { userId, status: newStatus });
        }

        res.json({ success: true, message: actionDesc, status: newStatus });

    } catch (error) {
        console.error('Update User Status Error:', error);
        res.status(500).json({ error: 'Error updating user status' });
    }
};

// Permanently delete user
const deleteUser = async (req, res) => {
    const userId = req.params.id;
    try {
        const user = await get(`SELECT * FROM app_users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete administrator' });

        // Unlink or reassign any accounts belonging to this user back to Admin
        await supabase.from('Users').update({ user_id: req.user.id }).eq('user_id', userId);

        await run(`DELETE FROM user_permissions WHERE user_id = ?`, [userId]);
        await run(`DELETE FROM user_reward_visibility WHERE user_id = ?`, [userId]);
        await run(`DELETE FROM user_requests WHERE user_id = ?`, [userId]);
        await run(`DELETE FROM notifications WHERE recipient_id = ?`, [userId]);
        await run(`DELETE FROM app_users WHERE id = ?`, [userId]);

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, previous_value, result)
             VALUES (?, ?, 'admin', ?, 'User Account Permanently Removed', ?, 'success')`,
            [req.user.id, req.user.email, userId, JSON.stringify(user)]
        );

        res.json({ success: true, message: 'User permanently removed' });
    } catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ error: 'Error removing user' });
    }
};

// Dedicated User Details (12 Tabs Data)
const getUserDetails = async (req, res) => {
    const userId = req.params.id;
    try {
        const user = await get(`SELECT * FROM app_users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Accounts belonging to this user
        const { data: allUserAccounts } = await supabase
            .from('Users')
            .select('id, profile_no, email, server, proton_email, status, notes, alternative_email')
            .order('profile_no', { ascending: true });

        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        const accounts = (allUserAccounts || []).filter(a => {
            const m = metaMap.get(a.id);
            return m ? m.user_id == userId : (userId == 1);
        }).map(a => {
            const m = metaMap.get(a.id);
            return {
                ...a,
                user_id: userId,
                classification: m ? m.classification : 'new'
            };
        });

        const accountIds = (accounts || []).map(a => a.id);

        // Points
        let points = [];
        if (accountIds.length > 0) {
            const { data: ptData } = await supabase
                .from('Points')
                .select('*')
                .in('user_id', accountIds)
                .order('id', { ascending: false });
            points = ptData || [];
        }

        // Redemptions
        let redemptions = [];
        if (accountIds.length > 0) {
            const { data: redData } = await supabase
                .from('Redemptions')
                .select('*')
                .in('user_id', accountIds)
                .order('redeemed_at', { ascending: false });
            redemptions = redData || [];
        }

        // User Requests
        const requests = await all(
            `SELECT * FROM user_requests WHERE user_id = ? ORDER BY id DESC`,
            [userId]
        );

        // Form Submissions
        const formSubmissions = await all(
            `SELECT * FROM form_submissions WHERE user_id = ? ORDER BY id DESC`,
            [userId]
        );

        // Activity Logs
        const activityLogs = await all(
            `SELECT * FROM audit_logs WHERE target_user_id = ? OR actor_id = ? ORDER BY id DESC LIMIT 50`,
            [userId, userId]
        );

        // Permissions
        const permissions = await all(
            `SELECT * FROM user_permissions WHERE user_id = ?`,
            [userId]
        );

        // Temporary Access Windows
        const tempWindows = await all(
            `SELECT * FROM temporary_access_windows WHERE user_id = ? ORDER BY id DESC`,
            [userId]
        );

        // Reward Visibility Settings
        const rewardVisibility = await get(
            `SELECT * FROM user_reward_visibility WHERE user_id = ?`,
            [userId]
        );

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                displayName: user.display_name,
                phone: user.phone,
                role: user.role,
                status: user.status,
                registrationPurpose: user.registration_purpose,
                accountManagementDescription: user.account_management_description,
                createdAt: user.created_at,
                approvedAt: user.approved_at
            },
            accounts: accounts || [],
            points,
            redemptions,
            requests,
            formSubmissions,
            activityLogs,
            permissions,
            tempWindows,
            rewardVisibility: rewardVisibility ? {
                mode: rewardVisibility.mode,
                selectedRewardIds: JSON.parse(rewardVisibility.selected_reward_ids || '[]')
            } : { mode: 'all', selectedRewardIds: [] }
        });

    } catch (error) {
        console.error('Get User Details Error:', error);
        res.status(500).json({ error: 'Error fetching user details' });
    }
};

// Update User Permissions
const updateUserPermissions = async (req, res) => {
    const userId = req.params.id;
    const { permissions, expiresAt } = req.body; // array of permission keys

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'Permissions must be an array' });
    }

    try {
        const user = await get(`SELECT * FROM app_users WHERE id = ?`, [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Remove old permissions
        await run(`DELETE FROM user_permissions WHERE user_id = ?`, [userId]);

        // Insert new permissions
        const now = new Date().toISOString();
        for (const p of permissions) {
            await run(
                `INSERT INTO user_permissions (user_id, permission_key, granted_at, expires_at, granted_by)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, p, now, expiresAt || null, req.user.id]
            );
        }

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Updated User Permissions', ?, 'success')`,
            [req.user.id, req.user.email, userId, JSON.stringify({ permissions, expiresAt })]
        );

        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Update Permissions Error:', error);
        res.status(500).json({ error: 'Error updating permissions' });
    }
};

// Create Temporary Access Window for Points Update
const createTemporaryAccessWindow = async (req, res) => {
    const userId = req.params.id;
    const { startTime, endTime, permittedActions } = req.body;

    if (!startTime || !endTime) {
        return res.status(400).json({ error: 'Start time and end time required' });
    }

    try {
        const actions = Array.isArray(permittedActions) ? permittedActions : ['update_points'];
        const resInsert = await run(
            `INSERT INTO temporary_access_windows (user_id, start_time, end_time, permitted_actions, is_active, created_by)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [userId, startTime, endTime, JSON.stringify(actions), req.user.id]
        );

        // Also ensure user has temporary 'update_points' permission
        await run(
            `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted_at, expires_at, granted_by)
             VALUES (?, 'update_points', datetime('now'), ?, ?)`,
            [userId, endTime, req.user.id]
        );

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Granted Temporary Access Window', ?, 'success')`,
            [req.user.id, req.user.email, userId, JSON.stringify({ startTime, endTime, actions })]
        );

        res.json({ success: true, windowId: resInsert.lastID });
    } catch (error) {
        console.error('Create Temp Window Error:', error);
        res.status(500).json({ error: 'Error setting temporary access window' });
    }
};

// Old / New Accounts Drag & Drop Classification
const reclassifyAccounts = async (req, res) => {
    const { accountIds, targetClassification, reason } = req.body; // 'old' or 'new'
    if (!Array.isArray(accountIds) || !['old', 'new'].includes(targetClassification)) {
        return res.status(400).json({ error: 'Invalid reclassification parameters' });
    }

    try {
        for (const accId of accountIds) {
            // Update in account_metadata
            const meta = await get(`SELECT classification FROM account_metadata WHERE account_id = ?`, [accId]);
            const prevClass = meta ? meta.classification : 'new';

            await run(
                `INSERT INTO account_metadata (account_id, classification, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(account_id) DO UPDATE SET classification = excluded.classification, updated_at = datetime('now')`,
                [accId, targetClassification]
            );

            // Record classification history
            await run(
                `INSERT INTO account_classification_history (account_id, previous_classification, new_classification, changed_by, reason)
                 VALUES (?, ?, ?, ?, ?)`,
                [accId, prevClass, targetClassification, req.user.id, reason || 'Admin Drag-and-Drop Reclassification']
            );
        }

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, new_value, result)
             VALUES (?, ?, 'admin', 'Account Reclassification', ?, 'success')`,
            [req.user.id, req.user.email, JSON.stringify({ accountIds, targetClassification, reason })]
        );

        res.json({ success: true, count: accountIds.length, targetClassification });
    } catch (error) {
        console.error('Reclassify Accounts Error:', error);
        res.status(500).json({ error: 'Error updating classifications' });
    }
};

// Manage Reward Catalogue Items (Add / Edit / Delete)
const getRewardCatalog = async (req, res) => {
    try {
        const rewards = await all(`SELECT * FROM rewards_catalog ORDER BY sort_order ASC, id ASC`);
        res.json(rewards);
    } catch (error) {
        console.error('Get Reward Catalog Error:', error);
        res.status(500).json({ error: 'Error fetching reward catalog' });
    }
};

const saveRewardItem = async (req, res) => {
    const { id, name, pointsRequired, userDisplay, isPublished, sortOrder } = req.body;
    if (!name || !pointsRequired) {
        return res.status(400).json({ error: 'Name and pointsRequired required' });
    }

    try {
        const display = userDisplay || `${name} – ${pointsRequired} pts`;
        const pub = (isPublished === false || isPublished === 0) ? 0 : 1;
        const sort = sortOrder || 0;

        if (id) {
            await run(
                `UPDATE rewards_catalog 
                 SET name = ?, points_required = ?, user_display = ?, is_published = ?, sort_order = ?, updated_at = datetime('now')
                 WHERE id = ?`,
                [name, pointsRequired, display, pub, sort, id]
            );
        } else {
            await run(
                `INSERT INTO rewards_catalog (name, points_required, user_display, is_published, sort_order)
                 VALUES (?, ?, ?, ?, ?)`,
                [name, pointsRequired, display, pub, sort]
            );
        }

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, new_value, result)
             VALUES (?, ?, 'admin', 'Saved Reward Catalog Item', ?, 'success')`,
            [req.user.id, req.user.email, JSON.stringify(req.body)]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Save Reward Item Error:', error);
        res.status(500).json({ error: 'Error saving reward item' });
    }
};

// Configure User Reward Visibility (Option A: all, Option B: selected)
const setUserRewardVisibility = async (req, res) => {
    const userId = req.params.id;
    const { mode, selectedRewardIds } = req.body; // mode: 'all' | 'selected'

    if (!['all', 'selected'].includes(mode)) {
        return res.status(400).json({ error: 'Mode must be all or selected' });
    }

    try {
        const ids = Array.isArray(selectedRewardIds) ? selectedRewardIds : [];
        await run(
            `INSERT INTO user_reward_visibility (user_id, mode, selected_reward_ids, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, selected_reward_ids = excluded.selected_reward_ids, updated_at = datetime('now')`,
            [userId, mode, JSON.stringify(ids)]
        );

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Configured User Reward Visibility', ?, 'success')`,
            [req.user.id, req.user.email, userId, JSON.stringify({ mode, ids })]
        );

        res.json({ success: true, mode, selectedRewardIds: ids });
    } catch (error) {
        console.error('Set Reward Visibility Error:', error);
        res.status(500).json({ error: 'Error configuring user reward visibility' });
    }
};

// Reward Eligibility & Account Matching
const getRewardEligibility = async (req, res) => {
    const { rewardId, userId } = req.query;
    try {
        const reward = await get(`SELECT * FROM rewards_catalog WHERE id = ?`, [rewardId]);
        if (!reward) return res.status(404).json({ error: 'Reward item not found' });

        // Accounts query
        const { data: allAccounts } = await supabase.from('Users').select('id, profile_no, email, server, status');
        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        let accounts = (allAccounts || []).map(a => {
            const m = metaMap.get(a.id);
            return {
                ...a,
                user_id: m ? m.user_id : 1,
                classification: m ? m.classification : 'new'
            };
        });

        if (userId) {
            accounts = accounts.filter(a => a.user_id == userId);
        }

        if (!accounts || accounts.length === 0) {
            return res.json({ reward, eligible: [], approaching: [] });
        }

        const accountIds = accounts.map(a => a.id);
        const { data: points } = await supabase.from('Points').select('user_id, points').in('user_id', accountIds).order('id', { ascending: false });

        const latestPoints = new Map();
        (points || []).forEach(p => {
            if (!latestPoints.has(p.user_id)) latestPoints.set(p.user_id, p.points);
        });

        const threshold = reward.points_required;
        const eligible = [];
        const approaching = [];

        accounts.forEach(a => {
            const pts = latestPoints.get(a.id) || 0;
            const diff = pts - threshold;

            const item = {
                id: a.id,
                profileNo: a.profile_no,
                email: a.email,
                server: a.server,
                status: a.status,
                classification: a.classification,
                userId: a.user_id,
                currentPoints: pts,
                pointsAbove: diff >= 0 ? diff : 0,
                remainingPoints: diff < 0 ? Math.abs(diff) : 0
            };

            if (pts >= threshold) {
                eligible.push(item);
            } else if (pts >= threshold - 1500) { // Within 1500 points
                approaching.push(item);
            }
        });

        res.json({
            reward,
            threshold,
            eligibleCount: eligible.length,
            approachingCount: approaching.length,
            eligible,
            approaching
        });

    } catch (error) {
        console.error('Reward Eligibility Error:', error);
        res.status(500).json({ error: 'Error calculating reward eligibility' });
    }
};

// Notification Center
const getNotifications = async (req, res) => {
    try {
        const notifications = await all(
            `SELECT * FROM notifications WHERE recipient_role = 'admin' ORDER BY id DESC LIMIT 100`
        );
        res.json(notifications);
    } catch (error) {
        console.error('Get Notifications Error:', error);
        res.status(500).json({ error: 'Error fetching notifications' });
    }
};

const markNotificationRead = async (req, res) => {
    const id = req.params.id;
    try {
        await run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error updating notification' });
    }
};

// Audit Logs
const getAuditLogs = async (req, res) => {
    try {
        const { search, limit = 100 } = req.query;
        let query = `SELECT * FROM audit_logs`;
        const params = [];

        if (search) {
            query += ` WHERE action LIKE ? OR actor_email LIKE ? OR record_id LIKE ?`;
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        query += ` ORDER BY id DESC LIMIT ?`;
        params.push(Number(limit));

        const logs = await all(query, params);
        res.json(logs);
    } catch (error) {
        console.error('Audit Logs Error:', error);
        res.status(500).json({ error: 'Error fetching audit logs' });
    }
};

// Explicitly assign accounts to a specific platform user
const assignAccountsToUser = async (req, res) => {
    const targetUserId = parseInt(req.params.id);
    const { accountIds } = req.body;

    if (!Array.isArray(accountIds)) {
        return res.status(400).json({ error: 'accountIds must be an array of account IDs' });
    }

    try {
        const targetUser = await get(`SELECT * FROM app_users WHERE id = ?`, [targetUserId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        for (const accId of accountIds) {
            await run(
                `INSERT INTO account_metadata (account_id, user_id, updated_at)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(account_id) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
                [accId, targetUserId]
            );
        }

        // Audit log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Assign Accounts to User', ?, 'success')`,
            [req.user.id, req.user.email, targetUserId, JSON.stringify({ count: accountIds.length, accountIds })]
        );

        res.json({
            success: true,
            message: `Successfully assigned ${accountIds.length} account(s) to ${targetUser.name}`,
            targetUserId,
            assignedCount: accountIds.length
        });
    } catch (error) {
        console.error('Assign Accounts Error:', error);
        res.status(500).json({ error: 'Failed to assign accounts' });
    }
};

// Bulk assign ALL accounts to a specific platform user
const assignAllAccountsToUser = async (req, res) => {
    const targetUserId = parseInt(req.params.id || req.body.userId);
    try {
        const targetUser = await get(`SELECT * FROM app_users WHERE id = ?`, [targetUserId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        // Update all existing records in account_metadata
        await run(`UPDATE account_metadata SET user_id = ?, updated_at = datetime('now')`, [targetUserId]);

        // Also fetch all Supabase accounts and ensure they are all in account_metadata for targetUserId
        let count = 0;
        try {
            const { data: accounts } = await supabase.from('Users').select('id');
            if (accounts && accounts.length > 0) {
                count = accounts.length;
                for (const acc of accounts) {
                    await run(
                        `INSERT INTO account_metadata (account_id, user_id, updated_at)
                         VALUES (?, ?, datetime('now'))
                         ON CONFLICT(account_id) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
                        [acc.id, targetUserId]
                    );
                }
            }
        } catch (e) {
            console.error('Supabase query error during assign all:', e);
        }

        // Audit log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Assigned ALL platform accounts to user', ?, 'success')`,
            [req.user.id, req.user.email, targetUserId, JSON.stringify({ count, targetUserEmail: targetUser.email })]
        );

        res.json({
            success: true,
            message: `All platform accounts successfully moved to ${targetUser.name} (${targetUser.email})`,
            targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
            count
        });
    } catch (error) {
        console.error('Assign All Accounts Error:', error);
        res.status(500).json({ error: 'Failed to assign all accounts' });
    }
};

// Get global and user-specific editing periods
const getEditingPeriodConfig = async (req, res) => {
    try {
        const queryUserId = req.query.userId ? parseInt(req.query.userId) : null;
        if (queryUserId) {
            let userConfig = await get(`SELECT * FROM user_editing_periods WHERE user_id = ?`, [queryUserId]);
            if (!userConfig) {
                userConfig = await get(`SELECT * FROM user_editing_periods WHERE user_id = 0 OR user_id IS NULL`);
            }
            if (userConfig) {
                return res.json({
                    ...userConfig,
                    enabled: Boolean(userConfig.is_enabled),
                    duration_value: userConfig.duration,
                    duration_unit: userConfig.unit,
                    apply_to_add: Boolean(userConfig.allow_add),
                    apply_to_edit: Boolean(userConfig.allow_edit)
                });
            }
        }

        const globalConfig = await get(`SELECT * FROM user_editing_periods WHERE user_id = 0 OR user_id IS NULL`);
        const userConfigs = await all(
            `SELECT p.*, u.name as user_name, u.email as user_email, u.approved_at, u.created_at
             FROM user_editing_periods p
             JOIN app_users u ON p.user_id = u.id
             WHERE p.user_id > 0`
        );

        res.json({
            global: globalConfig || { is_enabled: 1, duration: 7, unit: 'days', start_event: 'user_approval', allow_add: 1, allow_edit: 1 },
            users: userConfigs || [],
            ...(globalConfig ? {
                enabled: Boolean(globalConfig.is_enabled),
                duration_value: globalConfig.duration,
                duration_unit: globalConfig.unit,
                apply_to_add: Boolean(globalConfig.allow_add),
                apply_to_edit: Boolean(globalConfig.allow_edit)
            } : {})
        });
    } catch (error) {
        console.error('Editing config error:', error);
        res.status(500).json({ error: 'Failed to fetch editing configurations' });
    }
};

// Configure global or user-specific editing period
const saveEditingPeriodConfig = async (req, res) => {
    const userId = req.body.userId;
    const isEnabled = (req.body.enabled !== undefined) ? req.body.enabled : (req.body.isEnabled !== undefined ? req.body.isEnabled : true);
    const duration = (req.body.durationValue !== undefined) ? req.body.durationValue : (req.body.duration || 7);
    const unit = req.body.durationUnit || req.body.unit || 'days';
    const startEvent = req.body.startEvent || 'user_approval';
    const allowAdd = (req.body.applyToAdd !== undefined) ? req.body.applyToAdd : (req.body.allowAdd !== undefined ? req.body.allowAdd : true);
    const allowEdit = (req.body.applyToEdit !== undefined) ? req.body.applyToEdit : (req.body.allowEdit !== undefined ? req.body.allowEdit : true);
    const customExpiresAt = req.body.customExpiresAt || null;
    const targetUserId = (userId !== undefined && userId !== null && userId !== '') ? parseInt(userId) : 0;

    try {
        await run(
            `INSERT INTO user_editing_periods (user_id, is_enabled, duration, unit, start_event, allow_add, allow_edit, custom_expires_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id) DO UPDATE SET
                is_enabled = excluded.is_enabled,
                duration = excluded.duration,
                unit = excluded.unit,
                start_event = excluded.start_event,
                allow_add = excluded.allow_add,
                allow_edit = excluded.allow_edit,
                custom_expires_at = excluded.custom_expires_at,
                updated_at = datetime('now')`,
            [
                targetUserId,
                isEnabled ? 1 : 0,
                parseInt(duration) || 7,
                unit || 'days',
                startEvent,
                allowAdd ? 1 : 0,
                allowEdit ? 1 : 0,
                customExpiresAt || null
            ]
        );

        // Audit log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, 'admin', ?, 'Configured Editing Period', ?, 'success')`,
            [req.user.id, req.user.email, targetUserId, JSON.stringify(req.body)]
        );

        res.json({ success: true, message: 'Editing period settings saved successfully' });
    } catch (error) {
        console.error('Save editing config error:', error);
        res.status(500).json({ error: 'Failed to save editing period configuration' });
    }
};

// Review Account Correction Request (Approve or Reject)
const reviewAccountCorrectionRequest = async (req, res) => {
    const { requestId, action, adminNotes, applyChanges, tempWindowHours } = req.body; // action: 'approve' | 'reject'

    try {
        const reqRow = await get(`SELECT * FROM user_requests WHERE request_id = ?`, [requestId]);
        if (!reqRow) return res.status(404).json({ error: 'Request not found' });

        const now = new Date().toISOString();
        const newStatus = action === 'approve' ? 'Approved' : 'Rejected';

        await run(
            `UPDATE user_requests SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
            [newStatus, adminNotes || '', req.user.id, now, now, reqRow.id]
        );

        let details = {};
        try { details = JSON.parse(reqRow.details || '{}'); } catch (e) {}

        // If approved and applyChanges is true, apply directly to Supabase Users
        if (action === 'approve' && applyChanges && reqRow.account_id && details.newInformation) {
            try {
                const parsedUpdates = typeof details.newInformation === 'object' ? details.newInformation : JSON.parse(details.newInformation);
                await supabase.from('Users').update(parsedUpdates).eq('id', reqRow.account_id);
            } catch (e) {
                console.warn('Auto-apply correction warning:', e.message);
            }
        }

        // If approved and tempWindowHours provided, grant temporary window for editing
        if (action === 'approve' && tempWindowHours) {
            const start = new Date().toISOString();
            const end = new Date(Date.now() + parseInt(tempWindowHours) * 3600 * 1000).toISOString();
            await run(
                `INSERT INTO temporary_access_windows (user_id, start_time, end_time, permitted_actions, is_active, created_by)
                 VALUES (?, ?, ?, '["edit_accounts"]', 1, ?)`,
                [reqRow.user_id, start, end, req.user.id]
            );
        }

        // Log in account activity
        if (reqRow.account_id) {
            await run(
                `INSERT INTO account_activity_logs (account_id, actor_id, actor_name, actor_role, action_type, description, new_data)
                 VALUES (?, ?, ?, 'admin', 'correction_approved', ?, ?)`,
                [
                    reqRow.account_id,
                    req.user.id,
                    req.user.name,
                    `Correction request ${action === 'approve' ? 'Approved' : 'Rejected'} by administrator. ${adminNotes || ''}`,
                    JSON.stringify({ action, adminNotes })
                ]
            );
        }

        // Notify User
        await run(
            `INSERT INTO notifications (recipient_role, recipient_id, category, title, message, reference_id)
             VALUES ('user', ?, 'request_reply', ?, ?, ?)`,
            [
                reqRow.user_id,
                `Correction Request ${newStatus}`,
                `Your correction request for ${reqRow.subject} has been ${newStatus.toLowerCase()}. ${adminNotes || ''}`,
                requestId
            ]
        );

        res.json({ success: true, message: `Request ${newStatus} successfully` });
    } catch (error) {
        console.error('Review correction error:', error);
        res.status(500).json({ error: 'Failed to review request' });
    }
};

module.exports = {
    setIo,
    getDashboardOverview,
    listUsers,
    updateUserStatus,
    deleteUser,
    getUserDetails,
    updateUserPermissions,
    createTemporaryAccessWindow,
    reclassifyAccounts,
    getRewardCatalog,
    saveRewardItem,
    setUserRewardVisibility,
    getRewardEligibility,
    getNotifications,
    markNotificationRead,
    getAuditLogs,
    assignAccountsToUser,
    assignAllAccountsToUser,
    getEditingPeriodConfig,
    saveEditingPeriodConfig,
    reviewAccountCorrectionRequest
};
