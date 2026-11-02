const fs = require('fs');
const xlsx = require('xlsx');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit-table');
const supabase = require('../db/supabase');
const { run, get, all } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// Get accounts with role-based isolation & granular permissions
const getAccounts = async (req, res) => {
    const user = req.user;
    const requestedUserId = req.query.userId;

    try {
        // Query accounts from Supabase
        const { data: accounts, error: accError } = await supabase
            .from('Users')
            .select('id, profile_no, email, server, proton_email, status, notes, is_pinned, alternative_email, admin_id')
            .order('profile_no', { ascending: true });

        if (accError) throw accError;
        if (!accounts || accounts.length === 0) return res.json([]);

        // Fetch account metadata (user_id assignments & classifications)
        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        const adminUserRow = await get(`SELECT id FROM app_users WHERE role = 'admin' LIMIT 1`);
        const defaultAdminId = adminUserRow ? adminUserRow.id : 1;

        const accountIds = accounts.map(a => a.id);

        // Fetch Points & Redemptions
        const { data: points } = await supabase
            .from('Points')
            .select('*')
            .in('user_id', accountIds)
            .order('id', { ascending: true });

        const { data: redemptions } = await supabase
            .from('Redemptions')
            .select('*')
            .in('user_id', accountIds)
            .order('redeemed_at', { ascending: false });

        const redemptionsByAccount = {};
        if (redemptions) {
            redemptions.forEach(r => {
                if (!redemptionsByAccount[r.user_id]) redemptionsByAccount[r.user_id] = [];
                redemptionsByAccount[r.user_id].push(r);
            });
        }

        const latestPointsByAccount = {};
        const pointsHistoryByAccount = {};

        if (points) {
            points.forEach(p => {
                latestPointsByAccount[p.user_id] = p;

                if (!pointsHistoryByAccount[p.user_id]) {
                    pointsHistoryByAccount[p.user_id] = { prev: null, history: [] };
                }

                const prev = pointsHistoryByAccount[p.user_id].prev;
                if (prev !== null) {
                    const diff = p.points - prev;
                    pointsHistoryByAccount[p.user_id].history.push({
                        diff,
                        prev_points: prev,
                        new_points: p.points,
                        date: p.date,
                        updated_at: p.updated_at
                    });
                }
                pointsHistoryByAccount[p.user_id].prev = p.points;
            });
        }

        // Enrich accounts
        const enriched = accounts.map(acc => {
            const lp = latestPointsByAccount[acc.id];
            const history = pointsHistoryByAccount[acc.id] ? pointsHistoryByAccount[acc.id].history.slice(-10) : [];
            const accRedemptions = redemptionsByAccount[acc.id] || [];

            const meta = metaMap.get(acc.id);
            // Strictly assign unmapped legacy accounts to the Administrator, NEVER to non-admin users
            const assignedUserId = meta ? meta.user_id : defaultAdminId;
            let classification = meta ? meta.classification : null;
            if (!classification) {
                classification = accRedemptions.length > 0 ? 'old' : 'new';
            }

            return {
                id: acc.id,
                profile_no: acc.profile_no,
                email: acc.email,
                server: acc.server,
                proton_email: acc.proton_email,
                status: acc.status || 'active',
                classification: classification,
                current_points: lp ? lp.points : 0,
                last_updated: lp ? lp.updated_at : null,
                notes: acc.notes || '',
                is_pinned: acc.is_pinned || false,
                alternative_email: acc.alternative_email || '',
                user_id: assignedUserId,
                total_redemptions: accRedemptions.length,
                redemptions: accRedemptions,
                points_history: history
            };
        });

        // Strict isolation boundary
        let filtered = enriched;
        if (user.role === 'admin') {
            if (requestedUserId) {
                filtered = enriched.filter(a => a.user_id == requestedUserId);
            }
        } else {
            filtered = enriched.filter(a => a.user_id == user.id);
        }

        res.json(filtered);

    } catch (error) {
        console.error('Fetch Accounts Error:', error);
        res.status(500).json({ error: 'Error fetching accounts' });
    }
};

// Create Account (Admin or user with add_accounts permission)
const createAccount = async (req, res) => {
    const user = req.user;
    const { profile_no, email, server, proton_email, status, notes, alternative_email, initial_points, classification } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        let assignedUserId = user.id;
        if (user.role === 'admin' && req.body.user_id) {
            assignedUserId = req.body.user_id;
        }

        // Determine profile number
        let finalProfileNo = profile_no ? parseInt(profile_no) : null;
        if (!finalProfileNo) {
            const { data: maxRow } = await supabase
                .from('Users')
                .select('profile_no')
                .order('profile_no', { ascending: false })
                .limit(1);
            finalProfileNo = (maxRow && maxRow[0] && maxRow[0].profile_no) ? maxRow[0].profile_no + 1 : 1;
        }

        const now = new Date().toISOString();
        
        // Insert with columns supported by Supabase Users table
        const insertPayload = {
            admin_id: 1,
            email,
            server: server || '',
            proton_email: proton_email || '',
            profile_no: finalProfileNo,
            status: status || 'active',
            notes: notes || '',
            alternative_email: alternative_email || ''
        };

        const { data: newAcc, error: insertError } = await supabase
            .from('Users')
            .insert([insertPayload])
            .select()
            .single();

        if (insertError) throw insertError;

        // Store metadata (user_id and classification)
        const finalClass = classification || 'new';
        await run(
            `INSERT OR REPLACE INTO account_metadata (account_id, user_id, classification, updated_at)
             VALUES (?, ?, ?, datetime('now'))`,
            [newAcc.id, assignedUserId, finalClass]
        );

        // Insert initial points if provided
        if (initial_points !== undefined && initial_points !== null) {
            await supabase.from('Points').insert([{
                user_id: newAcc.id,
                points: parseInt(initial_points) || 0,
                date: 'Initial Setup',
                updated_at: now
            }]);

            // Audit log
            await run(
                `INSERT INTO points_audit_log (account_id, user_id, previous_points, new_points, difference, updated_by, updated_by_name, source)
                 VALUES (?, ?, 0, ?, ?, ?, ?, 'web_creation')`,
                [newAcc.id, assignedUserId, parseInt(initial_points), parseInt(initial_points), user.id, user.name]
            );
        }

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, record_id, result)
             VALUES (?, ?, ?, ?, 'Created Account Profile', ?, ?, 'success')`,
            [user.id, user.email, user.role, assignedUserId, JSON.stringify({ email, profile_no: finalProfileNo }), String(newAcc.id)]
        );

        res.json({
            success: true,
            account: {
                ...newAcc,
                user_id: assignedUserId,
                classification: finalClass
            }
        });
    } catch (error) {
        console.error('Create Account Error:', error);
        res.status(500).json({ error: 'Error creating account' });
    }
};

// Update Account Details (Admin or user with edit_accounts permission)
const updateAccount = async (req, res) => {
    const accountId = req.params.id;
    const user = req.user;
    const { profile_no, email, server, status, notes, is_pinned, proton_email, alternative_email, classification } = req.body;

    try {
        const { data: existing, error: findErr } = await supabase
            .from('Users')
            .select('*')
            .eq('id', accountId)
            .single();

        if (findErr || !existing) return res.status(404).json({ error: 'Account not found' });

        // Check ownership from account_metadata
        const meta = await get(`SELECT user_id, classification FROM account_metadata WHERE account_id = ?`, [accountId]);
        const adminUserRow = await get(`SELECT id FROM app_users WHERE role = 'admin' LIMIT 1`);
        const ownerId = meta ? meta.user_id : (adminUserRow ? adminUserRow.id : 1);

        if (user.role !== 'admin' && ownerId !== user.id) {
            return res.status(403).json({ error: 'Access denied. You do not own this account.' });
        }

        const updates = {};
        if (profile_no !== undefined) updates.profile_no = profile_no;
        if (email) updates.email = email;
        if (server !== undefined) updates.server = server;
        if (status) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (is_pinned !== undefined) updates.is_pinned = is_pinned;
        if (proton_email !== undefined) updates.proton_email = proton_email;
        if (alternative_email !== undefined) updates.alternative_email = alternative_email;

        if (Object.keys(updates).length > 0) {
            await supabase.from('Users').update(updates).eq('id', accountId);
        }

        // Only admin can reclassify directly
        if (classification && user.role === 'admin') {
            await run(
                `INSERT INTO account_metadata (account_id, user_id, classification, updated_at)
                 VALUES (?, ?, ?, datetime('now'))
                 ON CONFLICT(account_id) DO UPDATE SET classification = excluded.classification, updated_at = datetime('now')`,
                [accountId, ownerId, classification]
            );
        }

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, previous_value, new_value, record_id, result)
             VALUES (?, ?, ?, 'Updated Account Details', ?, ?, ?, 'success')`,
            [user.id, user.email, user.role, JSON.stringify(existing), JSON.stringify(updates), String(accountId)]
        );

        res.json({ success: true, message: 'Account updated successfully' });
    } catch (error) {
        console.error('Update Account Error:', error);
        res.status(500).json({ error: 'Error updating account' });
    }
};

// Update Points for an Account (Restricted by update_points permission or temp window)
const updatePoints = async (req, res) => {
    const accountId = req.params.id;
    const user = req.user;
    const { points, reason } = req.body;

    if (points === undefined || points === null) {
        return res.status(400).json({ error: 'Points value required' });
    }

    try {
        const { data: account, error: accErr } = await supabase
            .from('Users')
            .select('id, admin_id, email, profile_no')
            .eq('id', accountId)
            .single();

        if (accErr || !account) return res.status(404).json({ error: 'Account not found' });

        const meta = await get(`SELECT user_id FROM account_metadata WHERE account_id = ?`, [accountId]);
        const adminUserRow = await get(`SELECT id FROM app_users WHERE role = 'admin' LIMIT 1`);
        const ownerId = meta ? meta.user_id : (adminUserRow ? adminUserRow.id : 1);

        if (user.role !== 'admin' && ownerId !== user.id) {
            return res.status(403).json({ error: 'Access denied. You do not own this account.' });
        }

        const { data: lastPointRow } = await supabase
            .from('Points')
            .select('points')
            .eq('user_id', accountId)
            .order('id', { ascending: false })
            .limit(1);

        const prevPoints = (lastPointRow && lastPointRow.length > 0) ? lastPointRow[0].points : 0;
        const newPointsVal = parseInt(points);
        const diff = newPointsVal - prevPoints;
        const now = new Date().toISOString();

        await supabase.from('Points').insert([{
            user_id: accountId,
            points: newPointsVal,
            date: reason || 'Manual Point Update',
            updated_at: now
        }]);

        await run(
            `INSERT INTO points_audit_log (account_id, user_id, previous_points, new_points, difference, updated_by, updated_by_name, source, auth_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'web_direct', ?)`,
            [accountId, ownerId, prevPoints, newPointsVal, diff, user.id, user.name, reason || 'Web Update']
        );

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, previous_value, new_value, record_id, result)
             VALUES (?, ?, ?, ?, 'Updated Account Points', ?, ?, ?, 'success')`,
            [user.id, user.email, user.role, ownerId, JSON.stringify({ points: prevPoints }), JSON.stringify({ points: newPointsVal, diff }), String(accountId)]
        );

        res.json({
            success: true,
            accountId,
            previousPoints: prevPoints,
            newPoints: newPointsVal,
            difference: diff
        });

    } catch (error) {
        console.error('Update Points Error:', error);
        res.status(500).json({ error: 'Error updating points' });
    }
};

// Excel Upload (Admin or user with import_excel permission)
const uploadExcel = async (req, res) => {
    const user = req.user;
    const isFresh = req.body.freshUpload === 'true';

    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (data.length === 0) return res.status(400).json({ error: 'Empty file' });

        const keys = Object.keys(data[0]);
        const emailCol = keys.find(k => k.toLowerCase().includes('email') && !k.toLowerCase().includes('proton') && !k.toLowerCase().includes('alt'));
        const protonCol = keys.find(k => k.toLowerCase().includes('proton'));
        const serverCol = keys.find(k => k.toLowerCase().includes('server'));
        const profileCol = keys.find(k => k.toLowerCase().includes('profile'));
        const statusCol = keys.find(k => k.toLowerCase().includes('status') || k.toLowerCase().includes('ban'));
        const altEmailCol = keys.find(k => k.toLowerCase().includes('alt') && k.toLowerCase().includes('email'));
        const pointsCols = keys.filter(k => k.toLowerCase().startsWith('points_') || (!isNaN(Date.parse(k)) && k.includes('-')));

        const targetUserId = (user.role === 'admin' && req.body.targetUserId) ? parseInt(req.body.targetUserId) : user.id;

        if (isFresh) {
            const userMetaRows = await all(`SELECT account_id FROM account_metadata WHERE user_id = ?`, [targetUserId]);
            if (userMetaRows && userMetaRows.length > 0) {
                const accIds = userMetaRows.map(u => u.account_id);
                await supabase.from('Redemptions').delete().in('user_id', accIds);
                await supabase.from('Points').delete().in('user_id', accIds);
                await supabase.from('Users').delete().in('id', accIds);
                await run(`DELETE FROM account_metadata WHERE user_id = ?`, [targetUserId]);
            }
        }

        const { data: maxProfileNoRow } = await supabase
            .from('Users')
            .select('profile_no')
            .order('profile_no', { ascending: false })
            .limit(1);

        let currentMaxProfileNo = (maxProfileNoRow && maxProfileNoRow.length > 0 && maxProfileNoRow[0].profile_no) ? maxProfileNoRow[0].profile_no : 0;
        let syncedCount = 0;

        for (const row of data) {
            const email = row[emailCol];
            if (!email) continue;

            const server = serverCol ? (row[serverCol] || '') : '';
            const protonEmail = protonCol ? (row[protonCol] || '') : '';
            const altEmail = altEmailCol ? (row[altEmailCol] || '') : '';
            let profileNo = profileCol ? row[profileCol] : null;
            if (profileNo) profileNo = parseInt(profileNo.toString().replace(/\D/g, '')) || null;

            let status = 'active';
            if (statusCol && row[statusCol] && row[statusCol].toString().toLowerCase().includes('ban')) {
                status = 'banned';
            }

            const { data: existingAccount } = await supabase
                .from('Users')
                .select('id, profile_no')
                .eq('email', email)
                .single();

            let accountId;
            if (existingAccount) {
                accountId = existingAccount.id;
                profileNo = profileNo || existingAccount.profile_no;
                await supabase.from('Users').update({
                    server, proton_email: protonEmail, profile_no: profileNo, status, alternative_email: altEmail
                }).eq('id', accountId);
            } else {
                if (!profileNo) {
                    currentMaxProfileNo++;
                    profileNo = currentMaxProfileNo;
                } else if (profileNo > currentMaxProfileNo) {
                    currentMaxProfileNo = profileNo;
                }

                const { data: newAcc, error: insertError } = await supabase.from('Users').insert([{
                    admin_id: 1, email, server, proton_email: protonEmail, profile_no: profileNo, status, alternative_email: altEmail
                }]).select('id').single();

                if (insertError) continue;
                accountId = newAcc.id;
            }

            // Assign metadata
            await run(
                `INSERT OR REPLACE INTO account_metadata (account_id, user_id, classification, updated_at)
                 VALUES (?, ?, 'new', datetime('now'))`,
                [accountId, targetUserId]
            );

            syncedCount++;

            // Process Points Columns
            for (const pCol of pointsCols) {
                const ptVal = parseInt(row[pCol]);
                if (!isNaN(ptVal)) {
                    await supabase.from('Points').upsert({
                        user_id: accountId,
                        date: pCol,
                        points: ptVal,
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }

        try { fs.unlinkSync(req.file.path); } catch (e) {}

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, result)
             VALUES (?, ?, ?, ?, 'Imported Excel Account Data', ?, 'success')`,
            [user.id, user.email, user.role, targetUserId, JSON.stringify({ syncedCount, filename: req.file.originalname })]
        );

        res.json({ success: true, count: syncedCount });
    } catch (error) {
        console.error('Upload Excel Error:', error);
        res.status(500).json({ error: 'Error processing Excel upload' });
    }
};

// Export CSV (Strictly NO passwords)
const exportCsv = async (req, res) => {
    const user = req.user;
    try {
        const { data: accounts } = await supabase.from('Users').select('id, profile_no, email, server, status').order('profile_no', { ascending: true });
        if (!accounts || accounts.length === 0) return res.status(404).send('No records found');

        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        let filtered = accounts;
        if (user.role !== 'admin') {
            filtered = accounts.filter(a => {
                const m = metaMap.get(a.id);
                return m && m.user_id == user.id;
            });
        }

        const accountIds = filtered.map(a => a.id);
        const { data: points } = await supabase.from('Points').select('user_id, points').in('user_id', accountIds).order('id', { ascending: false });

        const latestPoints = new Map();
        (points || []).forEach(p => {
            if (!latestPoints.has(p.user_id)) latestPoints.set(p.user_id, p.points);
        });

        const rows = filtered.map(a => {
            const m = metaMap.get(a.id);
            return {
                'Profile No': a.profile_no || '',
                'Email': a.email,
                'Server': a.server || '',
                'Status': a.status,
                'Classification': (m ? m.classification : 'new').toUpperCase(),
                'Current Points': latestPoints.get(a.id) || 0
            };
        });

        const parser = new Parser();
        const csv = parser.parse(rows);

        res.header('Content-Type', 'text/csv');
        res.attachment(`PointPulse_Accounts_${new Date().toISOString().slice(0, 10)}.csv`);
        res.send(csv);

    } catch (error) {
        console.error('Export CSV Error:', error);
        res.status(500).json({ error: 'Error generating CSV export' });
    }
};

module.exports = {
    setIo,
    getAccounts,
    createAccount,
    updateAccount,
    updatePoints,
    uploadExcel,
    exportCsv
};
