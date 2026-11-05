const supabase = require('../db/supabase');
const { get, run, all, decodeCredentialsFromNotes } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// -----------------------------------------------------------------------------
// USER DASHBOARD: ALLOCATION WORKSPACE (DRAG & DROP)
// -----------------------------------------------------------------------------

// Get user's available accounts and current dropped allocation batch
const getUserAllocationData = async (req, res) => {
    const userId = req.user.id;

    try {
        // Fetch allocation settings (quota limit, open status, deadline)
        let settings = await get(`SELECT * FROM user_allocation_settings WHERE user_id = ?`, [userId]);
        if (!settings) {
            settings = {
                user_id: userId,
                max_accounts: 10,
                is_open: 1,
                deadline: null,
                is_form_required: 0
            };
        }

        // Fetch user's assigned accounts from Supabase and account_metadata
        const { data: allAccounts, error: accErr } = await supabase
            .from('Users')
            .select('id, profile_no, email, server, status, password, proton_email, alternative_email, notes');

        if (accErr) {
            console.error('Supabase fetch error in getUserAllocationData:', accErr);
        }

        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata WHERE user_id = ?`, [userId]);
        const userMetaMap = new Map();
        metaRows.forEach(m => userMetaMap.set(m.account_id, m));

        const userAccounts = (allAccounts || []).filter(a => userMetaMap.has(a.id));
        const accountIds = userAccounts.map(a => a.id);

        // Fetch latest points for these accounts
        const latestPoints = new Map();
        if (accountIds.length > 0) {
            const { data: points } = await supabase
                .from('Points')
                .select('user_id, points')
                .in('user_id', accountIds)
                .order('id', { ascending: false });

            (points || []).forEach(p => {
                if (!latestPoints.has(p.user_id)) latestPoints.set(p.user_id, p.points);
            });
        }

        // Fetch currently allocated accounts for this user
        const allocRows = await all(
            `SELECT * FROM user_redemption_allocations WHERE user_id = ? ORDER BY id ASC`,
            [userId]
        );
        const allocatedSet = new Set(allocRows.map(r => r.account_id));
        const allocMap = new Map();
        allocRows.forEach(r => allocMap.set(r.account_id, r));

        const isBatchLocked = allocRows.length > 0 && allocRows.some(r => r.is_locked === 1);

        // Format available accounts (not yet dropped in allocation)
        const availableAccounts = [];
        const allocatedAccounts = [];

        userAccounts.forEach(acc => {
            const m = userMetaMap.get(acc.id);
            const pts = latestPoints.get(acc.id) || 0;
            const creds = decodeCredentialsFromNotes(acc.notes);

            const item = {
                id: acc.id,
                profileNo: acc.profile_no || acc.id,
                email: acc.email,
                server: acc.server || 'US-Standard',
                status: acc.status || 'active',
                classification: m ? m.classification : 'new',
                points: pts,
                emailPassword: acc.password || creds.proton_password || '',
                alternativeEmail: acc.alternative_email || acc.proton_email || '',
                alternativePassword: creds.alternative_password || creds.proton_password || ''
            };

            if (allocatedSet.has(acc.id)) {
                const aRow = allocMap.get(acc.id);
                allocatedAccounts.push({
                    ...item,
                    allocationId: aRow.id,
                    allocationStatus: aRow.status,
                    isLocked: aRow.is_locked === 1,
                    submittedAt: aRow.submitted_at
                });
            } else {
                availableAccounts.push(item);
            }
        });

        res.json({
            settings: {
                maxAccounts: settings.max_accounts || 10,
                isOpen: settings.is_open === 1,
                deadline: settings.deadline,
                isFormRequired: settings.is_form_required === 1,
                isLocked: isBatchLocked
            },
            availableAccounts,
            allocatedAccounts,
            allocatedCount: allocatedAccounts.length
        });

    } catch (error) {
        console.error('getUserAllocationData Error:', error);
        res.status(500).json({ error: 'Failed to load allocation data' });
    }
};

// User submits their dropped accounts for admin redemption (locks batch)
const submitUserAllocation = async (req, res) => {
    const userId = req.user.id;
    const { accountIds } = req.body;

    if (!Array.isArray(accountIds)) {
        return res.status(400).json({ error: 'accountIds must be an array of account IDs' });
    }

    try {
        // Fetch user allocation settings
        let settings = await get(`SELECT * FROM user_allocation_settings WHERE user_id = ?`, [userId]);
        const maxLimit = settings ? settings.max_accounts : 10;
        const isOpen = settings ? (settings.is_open === 1) : true;

        if (!isOpen) {
            return res.status(403).json({ error: 'Redemption allocation is currently closed by the administrator.' });
        }

        // Check if currently locked
        const existingLocked = await get(
            `SELECT id FROM user_redemption_allocations WHERE user_id = ? AND is_locked = 1 LIMIT 1`,
            [userId]
        );
        if (existingLocked) {
            return res.status(403).json({ 
                error: 'Your allocation batch has already been submitted and locked. To request edits, please submit an unlock request in the Request Center.' 
            });
        }

        // Validate limit
        if (accountIds.length > maxLimit) {
            return res.status(400).json({ 
                error: `Exceeds allocation limit. You can allocate a maximum of ${maxLimit} accounts (attempted ${accountIds.length}).` 
            });
        }

        // Validate that user owns all accounts
        if (accountIds.length > 0) {
            const placeholders = accountIds.map(() => '?').join(',');
            const ownedRows = await all(
                `SELECT account_id FROM account_metadata WHERE user_id = ? AND account_id IN (${placeholders})`,
                [userId, ...accountIds]
            );
            if (ownedRows.length !== accountIds.length) {
                return res.status(403).json({ error: 'One or more accounts do not belong to your assigned portfolio.' });
            }
        }

        // Clear previous unlocked allocations not in new submission
        if (accountIds.length === 0) {
            await run(`DELETE FROM user_redemption_allocations WHERE user_id = ? AND is_locked = 0`, [userId]);
        } else {
            const placeholders = accountIds.map(() => '?').join(',');
            await run(
                `DELETE FROM user_redemption_allocations WHERE user_id = ? AND account_id NOT IN (${placeholders})`,
                [userId, ...accountIds]
            );
        }

        // Insert or update dropped accounts with locked status
        for (const accId of accountIds) {
            await run(
                `INSERT INTO user_redemption_allocations (user_id, account_id, status, is_locked, submitted_at)
                 VALUES (?, ?, 'submitted', 1, datetime('now'))
                 ON CONFLICT(user_id, account_id) DO UPDATE SET is_locked = 1, status = 'submitted', submitted_at = datetime('now')`,
                [userId, accId]
            );
        }

        // Notify Administrator
        await run(
            `INSERT INTO notifications (recipient_role, category, title, message, reference_id, data)
             VALUES ('admin', 'redemption', 'New Redemption Batch Submitted', ?, ?, ?)`,
            [
                `Operator ${req.user.name} (${req.user.email}) submitted ${accountIds.length} account(s) for redemption.`,
                `alloc_user_${userId}`,
                JSON.stringify({ userId, count: accountIds.length, email: req.user.email })
            ]
        );

        if (io) {
            io.emit('redemption_batch_submitted', {
                userId,
                userName: req.user.name,
                userEmail: req.user.email,
                count: accountIds.length
            });
        }

        res.json({
            success: true,
            message: `Successfully submitted ${accountIds.length} account(s) for administrator redemption. Batch is now locked.`,
            count: accountIds.length,
            isLocked: true
        });

    } catch (error) {
        console.error('submitUserAllocation Error:', error);
        res.status(500).json({ error: 'Failed to submit allocation batch' });
    }
};

// -----------------------------------------------------------------------------
// ADMIN DASHBOARD: REDEEM REQUEST SECTION (USER TABS & ACCOUNTS TABLE)
// -----------------------------------------------------------------------------

// Get admin redeem request view (operators list, selected operator's submitted table)
const getAdminAllocationView = async (req, res) => {
    try {
        // 1. Fetch authorized operators
        const operators = await all(
            `SELECT id, name, email, display_name FROM app_users WHERE role = 'user' AND status = 'approved' ORDER BY id ASC`
        );

        if (!operators || operators.length === 0) {
            return res.json({ operators: [], selectedUserId: null, settings: null, accounts: [] });
        }

        // Get submission counts per operator
        const countRows = await all(
            `SELECT user_id, count(*) as count FROM user_redemption_allocations GROUP BY user_id`
        );
        const countMap = new Map();
        countRows.forEach(c => countMap.set(c.user_id, c.count));

        const enrichedOperators = operators.map(op => ({
            ...op,
            submittedCount: countMap.get(op.id) || 0
        }));

        // Determine active operator tab
        const reqUserId = parseInt(req.query.userId);
        const activeUser = operators.find(o => o.id === reqUserId) || operators[0];
        const activeUserId = activeUser.id;

        // Fetch allocation settings for active operator
        let settings = await get(`SELECT * FROM user_allocation_settings WHERE user_id = ?`, [activeUserId]);
        if (!settings) {
            settings = {
                user_id: activeUserId,
                max_accounts: 10,
                is_open: 1,
                deadline: null,
                is_form_required: 0
            };
        }

        // Fetch allocations for this operator
        const allocRows = await all(
            `SELECT * FROM user_redemption_allocations WHERE user_id = ? ORDER BY id ASC`,
            [activeUserId]
        );

        if (allocRows.length === 0) {
            return res.json({
                operators: enrichedOperators,
                selectedUserId: activeUserId,
                selectedUser: activeUser,
                settings: {
                    maxAccounts: settings.max_accounts || 10,
                    isOpen: settings.is_open === 1,
                    deadline: settings.deadline,
                    isFormRequired: settings.is_form_required === 1,
                    isLocked: false
                },
                accounts: []
            });
        }

        const allocAccountIds = allocRows.map(r => r.account_id);
        const allocMap = new Map();
        allocRows.forEach(r => allocMap.set(r.account_id, r));

        // Fetch accounts from Supabase
        const { data: accountsData } = await supabase
            .from('Users')
            .select('id, profile_no, email, server, status, password, proton_email, alternative_email, notes')
            .in('id', allocAccountIds);

        // Fetch metadata classifications
        const metaRows = await all(
            `SELECT account_id, classification FROM account_metadata WHERE account_id IN (${allocAccountIds.map(() => '?').join(',')})`,
            allocAccountIds
        );
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m.classification));

        // Fetch credentials from SQLite account_credentials
        const credRows = await all(
            `SELECT * FROM account_credentials WHERE account_id IN (${allocAccountIds.map(() => '?').join(',')})`,
            allocAccountIds
        );
        const credMap = new Map();
        credRows.forEach(c => credMap.set(c.account_id, c));

        // Fetch latest points
        const { data: pointsData } = await supabase
            .from('Points')
            .select('user_id, points')
            .in('user_id', allocAccountIds)
            .order('id', { ascending: false });

        const latestPoints = new Map();
        (pointsData || []).forEach(p => {
            if (!latestPoints.has(p.user_id)) latestPoints.set(p.user_id, p.points);
        });

        // Map into the exact 11 columns required by Image 1:
        // 1. profile no.
        // 2. email/outlook
        // 3. email/outlook password
        // 4. Server
        // 5. new/old account
        // 6. Alternative email
        // 7. Alternative email password
        // 8. Current points
        // 9. redeemed / not redeemed
        // 10. success / Banned
        // 11. WhatsApp action
        const accounts = (accountsData || []).map(acc => {
            const alloc = allocMap.get(acc.id) || {};
            const cred = credMap.get(acc.id) || {};
            const noteCreds = decodeCredentialsFromNotes(acc.notes);

            const emailPass = acc.password || cred.email_password || '';
            const altEmail = acc.alternative_email || acc.proton_email || cred.alternative_email || '';
            const altPass = cred.alternative_password || cred.proton_password || noteCreds.alternative_password || noteCreds.proton_password || '';
            const classification = metaMap.get(acc.id) || 'new';
            const pts = latestPoints.get(acc.id) || 0;

            return {
                id: acc.id,
                allocationId: alloc.id,
                profileNo: acc.profile_no || acc.id,
                email: acc.email,
                emailPassword: emailPass,
                server: acc.server || 'US-Standard',
                classification: classification,
                alternativeEmail: altEmail,
                alternativePassword: altPass,
                currentPoints: pts,
                redemptionStatus: alloc.status === 'redeemed' ? 'redeemed' : 'not_redeemed',
                accountStatus: acc.status || 'active',
                isLocked: alloc.is_locked === 1,
                submittedAt: alloc.submitted_at
            };
        });

        const isLocked = allocRows.some(r => r.is_locked === 1);

        res.json({
            operators: enrichedOperators,
            selectedUserId: activeUserId,
            selectedUser: activeUser,
            settings: {
                maxAccounts: settings.max_accounts || 10,
                isOpen: settings.is_open === 1,
                deadline: settings.deadline,
                isFormRequired: settings.is_form_required === 1,
                isLocked
            },
            accounts
        });

    } catch (error) {
        console.error('getAdminAllocationView Error:', error);
        res.status(500).json({ error: 'Failed to load redeem request section' });
    }
};

// Admin toggles single account redemption status (redeemed vs not redeemed)
const toggleRedemptionStatus = async (req, res) => {
    const allocationId = parseInt(req.params.allocationId);

    try {
        const alloc = await get(`SELECT * FROM user_redemption_allocations WHERE id = ?`, [allocationId]);
        if (!alloc) return res.status(404).json({ error: 'Allocation record not found' });

        const newStatus = (alloc.status === 'redeemed') ? 'submitted' : 'redeemed';
        const redeemedAt = (newStatus === 'redeemed') ? new Date().toISOString() : null;
        const redeemedBy = (newStatus === 'redeemed') ? req.user.id : null;

        await run(
            `UPDATE user_redemption_allocations SET status = ?, redeemed_at = ?, redeemed_by = ? WHERE id = ?`,
            [newStatus, redeemedAt, redeemedBy, allocationId]
        );

        res.json({
            success: true,
            message: `Account status updated to ${newStatus === 'redeemed' ? 'Redeemed' : 'Not Redeemed'}`,
            status: newStatus
        });

    } catch (error) {
        console.error('toggleRedemptionStatus Error:', error);
        res.status(500).json({ error: 'Failed to update redemption status' });
    }
};

// Admin sets allocation limits, deadline, and mandatory review form for user
const saveAdminAllocationSettings = async (req, res) => {
    const targetUserId = parseInt(req.params.userId);
    const { maxAccounts, isOpen, deadline, isFormRequired } = req.body;

    try {
        const max = (maxAccounts !== undefined && parseInt(maxAccounts) > 0) ? parseInt(maxAccounts) : 10;
        const openVal = (isOpen !== undefined) ? (isOpen ? 1 : 0) : 1;
        const formVal = (isFormRequired !== undefined) ? (isFormRequired ? 1 : 0) : 0;
        const dlVal = deadline ? String(deadline) : null;

        await run(
            `INSERT INTO user_allocation_settings (user_id, max_accounts, is_open, deadline, is_form_required, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id) DO UPDATE SET 
                max_accounts = excluded.max_accounts,
                is_open = excluded.is_open,
                deadline = excluded.deadline,
                is_form_required = excluded.is_form_required,
                updated_at = datetime('now')`,
            [targetUserId, max, openVal, dlVal, formVal]
        );

        // If admin enforces mandatory review form, update app_users and trigger socket event
        if (formVal === 1) {
            await run(`UPDATE app_users SET review_form_required = 1 WHERE id = ?`, [targetUserId]);
            if (io) {
                const targetSchedule = await get(`SELECT * FROM form_schedules WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1`);
                io.emit('review_form_sent', {
                    userId: targetUserId,
                    scheduleId: targetSchedule ? targetSchedule.id : 1,
                    deadlineDay: 5,
                    questions: targetSchedule ? JSON.parse(targetSchedule.questions) : []
                });
            }
        }

        res.json({
            success: true,
            message: `Redemption allocation quota (${max} accounts) and settings successfully updated.`,
            settings: { maxAccounts: max, isOpen: openVal === 1, deadline: dlVal, isFormRequired: formVal === 1 }
        });

    } catch (error) {
        console.error('saveAdminAllocationSettings Error:', error);
        res.status(500).json({ error: 'Failed to save allocation settings' });
    }
};

// Admin unlocks user allocation batch so operator can drag & drop again
const unlockUserBatch = async (req, res) => {
    const targetUserId = parseInt(req.params.userId);

    try {
        await run(`UPDATE user_redemption_allocations SET is_locked = 0 WHERE user_id = ?`, [targetUserId]);

        if (io) {
            io.emit('allocation_unlocked', { userId: targetUserId });
        }

        res.json({
            success: true,
            message: `Operator allocation batch unlocked. User can now edit and re-drop accounts.`
        });

    } catch (error) {
        console.error('unlockUserBatch Error:', error);
        res.status(500).json({ error: 'Failed to unlock allocation batch' });
    }
};

module.exports = {
    setIo,
    getUserAllocationData,
    submitUserAllocation,
    getAdminAllocationView,
    toggleRedemptionStatus,
    saveAdminAllocationSettings,
    unlockUserBatch
};
