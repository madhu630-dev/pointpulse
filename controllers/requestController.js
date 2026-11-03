const { run, get, all } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// User: Submit a new request
const submitRequest = async (req, res) => {
    const user = req.user;
    const { category, subject, message, account_id, details } = req.body;

    const validCategories = [
        'points_update', 
        'account_correction', 
        'classification_change', 
        'download_permission', 
        'redemption', 
        'contact_admin'
    ];

    if (!category || !validCategories.includes(category)) {
        return res.status(400).json({ error: 'Valid request category required' });
    }
    if (!subject || !message) {
        return res.status(400).json({ error: 'Subject and message are required' });
    }

    try {
        const countRes = await get(`SELECT count(*) as c FROM user_requests`);
        const nextNum = (countRes ? countRes.c : 0) + 1001;
        const requestId = `REQ-${nextNum}`;

        const insertRes = await run(
            `INSERT INTO user_requests (request_id, user_id, category, subject, message, account_id, details, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
            [
                requestId,
                user.id,
                category,
                subject,
                message,
                account_id || null,
                JSON.stringify(details || {})
            ]
        );

        // Notify Admin
        await run(
            `INSERT INTO notifications (recipient_role, category, title, message, reference_id)
             VALUES ('admin', ?, ?, ?, ?)`,
            [
                category,
                `New Request: ${subject}`,
                `Submitted by ${user.name} (${user.email}) [${requestId}]`,
                requestId
            ]
        );

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, record_id, result)
             VALUES (?, ?, 'user', ?, 'Submitted Request', ?, ?, 'success')`,
            [user.id, user.email, user.id, JSON.stringify({ category, subject, requestId }), requestId]
        );

        if (io) {
            io.emit('new_admin_request', {
                requestId,
                user: { name: user.name, email: user.email },
                category,
                subject
            });
        }

        res.json({ success: true, requestId, message: 'Request submitted successfully to the administrator.' });

    } catch (error) {
        console.error('Submit Request Error:', error);
        res.status(500).json({ error: 'Error submitting request' });
    }
};

// User: List own requests
const getUserRequests = async (req, res) => {
    const user = req.user;
    try {
        const requests = await all(
            `SELECT * FROM user_requests WHERE user_id = ? ORDER BY id DESC`,
            [user.id]
        );
        res.json(requests);
    } catch (error) {
        console.error('Get User Requests Error:', error);
        res.status(500).json({ error: 'Error fetching requests' });
    }
};

// Admin: List all requests
const getAllRequests = async (req, res) => {
    try {
        const { status, category } = req.query;
        let query = `
            SELECT r.*, u.name as user_name, u.email as user_email, u.picture as user_picture
            FROM user_requests r
            JOIN app_users u ON r.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            query += ` AND r.status = ?`;
            params.push(status);
        }
        if (category && category !== 'all') {
            query += ` AND r.category = ?`;
            params.push(category);
        }

        query += ` ORDER BY r.id DESC`;
        const requests = await all(query, params);
        res.json(requests);
    } catch (error) {
        console.error('Get All Requests Error:', error);
        res.status(500).json({ error: 'Error fetching requests' });
    }
};

// Admin: Update request status & respond
const updateRequestStatus = async (req, res) => {
    const requestId = req.params.id; // numeric ID or REQ-xxx
    const { status, adminResponse } = req.body;

    const validStatuses = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Completed'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const reqRow = await get(`SELECT * FROM user_requests WHERE id = ? OR request_id = ?`, [requestId, requestId]);
        if (!reqRow) return res.status(404).json({ error: 'Request not found' });

        const now = new Date().toISOString();
        await run(
            `UPDATE user_requests 
             SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
             WHERE id = ?`,
            [status, adminResponse || '', req.user.id, now, now, reqRow.id]
        );

        // If approved with an automatic access window granted
        let windowGrantedText = '';
        if (status === 'Approved' && req.body.grantWindowMinutes) {
            const mins = parseInt(req.body.grantWindowMinutes) || 120;
            const winNow = new Date();
            const winEnd = new Date(winNow.getTime() + (mins * 60 * 1000));

            // Determine permitted actions: honor body, or grant full operational write window
            let acts = Array.isArray(req.body.permittedActions) && req.body.permittedActions.length > 0 
                ? req.body.permittedActions 
                : null;

            if (!acts) {
                // If pure points update without any mention of accounts/excel, grant points update; otherwise grant all operations
                const isOnlyPoints = reqRow.category === 'points_update' && 
                    !/excel|import|add|account/i.test(reqRow.subject || '') && 
                    !/excel|import|add|account/i.test(reqRow.message || '');
                acts = isOnlyPoints 
                    ? ['update_points'] 
                    : ['update_points', 'edit_accounts', 'add_accounts', 'import_excel'];
            }

            const winStartIso = winNow.toISOString();
            const winEndIso = winEnd.toISOString();

            await run(
                `INSERT INTO temporary_access_windows (user_id, start_time, end_time, permitted_actions, is_active, created_by)
                 VALUES (?, ?, ?, ?, 1, ?)`,
                [reqRow.user_id, winStartIso, winEndIso, JSON.stringify(acts), req.user.id]
            );

            for (const a of acts) {
                await run(
                    `INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted_at, expires_at, granted_by)
                     VALUES (?, ?, datetime('now'), ?, ?)`,
                    [reqRow.user_id, a, winEndIso, req.user.id]
                );
            }

            await run(
                `INSERT INTO user_editing_periods (user_id, is_enabled, duration, unit, start_event, allow_add, allow_edit, custom_expires_at, updated_at)
                 VALUES (?, 1, ?, 'minutes', 'window', ?, 1, ?, datetime('now'))
                 ON CONFLICT(user_id) DO UPDATE SET
                    is_enabled = 1,
                    allow_add = excluded.allow_add,
                    allow_edit = excluded.allow_edit,
                    custom_expires_at = excluded.custom_expires_at,
                    updated_at = datetime('now')`,
                [
                    reqRow.user_id,
                    mins,
                    (acts.includes('add_accounts') || acts.includes('import_excel')) ? 1 : 0,
                    winEndIso
                ]
            );

            windowGrantedText = ` Access window granted for ${Math.round(mins / 60)}h until ${winEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
        }

        // Notify User
        await run(
            `INSERT INTO notifications (recipient_role, recipient_id, category, title, message, reference_id)
             VALUES ('user', ?, 'request_update', ?, ?, ?)`,
            [
                reqRow.user_id,
                `Request ${reqRow.request_id} Updated: ${status}`,
                (adminResponse || `Your request '${reqRow.subject}' status has been updated to ${status}.`) + windowGrantedText,
                reqRow.request_id
            ]
        );

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, previous_value, new_value, record_id, result)
             VALUES (?, ?, 'admin', ?, 'Updated User Request Status', ?, ?, ?, 'success')`,
            [
                req.user.id, req.user.email, reqRow.user_id,
                JSON.stringify({ status: reqRow.status }),
                JSON.stringify({ status, adminResponse }),
                reqRow.request_id
            ]
        );

        res.json({ success: true, message: `Request updated to ${status}` });

    } catch (error) {
        console.error('Update Request Error:', error);
        res.status(500).json({ error: 'Error updating request status' });
    }
};

module.exports = {
    setIo,
    submitRequest,
    getUserRequests,
    getAllRequests,
    updateRequestStatus
};

