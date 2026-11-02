const supabase = require('../db/supabase');
const { get, run, all } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// Get published reward catalogue for current user (filtered by administrator visibility setting)
const getUserRewards = async (req, res) => {
    const user = req.user;
    try {
        // Admin gets the complete catalogue
        if (user.role === 'admin') {
            const allRewards = await all(`SELECT * FROM rewards_catalog ORDER BY sort_order ASC, id ASC`);
            return res.json(allRewards);
        }

        // Check user visibility setting (Option A: all, Option B: selected)
        const visibility = await get(`SELECT * FROM user_reward_visibility WHERE user_id = ?`, [user.id]);
        
        let rewardsQuery = `SELECT * FROM rewards_catalog WHERE is_published = 1`;
        let params = [];

        if (visibility && visibility.mode === 'selected') {
            const selectedIds = JSON.parse(visibility.selected_reward_ids || '[]');
            if (selectedIds.length === 0) {
                return res.json([]);
            }
            const placeholders = selectedIds.map(() => '?').join(',');
            rewardsQuery += ` AND id IN (${placeholders})`;
            params = selectedIds;
        }

        rewardsQuery += ` ORDER BY sort_order ASC, id ASC`;
        const publishedRewards = await all(rewardsQuery, params);
        res.json(publishedRewards);

    } catch (error) {
        console.error('Get User Rewards Error:', error);
        res.status(500).json({ error: 'Error fetching reward catalogue' });
    }
};

// Get user accounts matching reward threshold & approaching eligibility
const getAccountMatchesForReward = async (req, res) => {
    const rewardId = req.params.rewardId;
    const user = req.user;

    try {
        const reward = await get(`SELECT * FROM rewards_catalog WHERE id = ?`, [rewardId]);
        if (!reward) return res.status(404).json({ error: 'Reward item not found' });

        // Query accounts from Supabase & metadata
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

        if (user.role !== 'admin') {
            accounts = accounts.filter(a => a.user_id == user.id);
        } else if (req.query.userId) {
            accounts = accounts.filter(a => a.user_id == req.query.userId);
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
                currentPoints: pts,
                pointsAbove: diff >= 0 ? diff : 0,
                remainingPoints: diff < 0 ? Math.abs(diff) : 0
            };

            if (pts >= threshold) {
                eligible.push(item);
            } else if (pts >= threshold - 1500) {
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
        console.error('Match Reward Accounts Error:', error);
        res.status(500).json({ error: 'Error calculating reward matches' });
    }
};

// Redeem Item (Admin or approved user request)
const redeemItem = async (req, res) => {
    const user = req.user;
    const accountId = req.params.accountId;
    const { item_name, points_cost, redeemed_at, redeemed_code, code_status } = req.body;

    if (!item_name || !points_cost) {
        return res.status(400).json({ error: 'Missing redemption item details' });
    }

    try {
        const { data: account, error: accErr } = await supabase
            .from('Users')
            .select('id, user_id, email, profile_no')
            .eq('id', accountId)
            .single();

        if (accErr || !account) return res.status(404).json({ error: 'Account not found' });

        if (user.role !== 'admin' && account.user_id !== user.id) {
            return res.status(403).json({ error: 'Access denied. You do not own this account.' });
        }

        const now = redeemed_at || new Date().toISOString();

        // Insert into Supabase Redemptions
        const { data: newRedemp, error: redempErr } = await supabase
            .from('Redemptions')
            .insert([{
                user_id: accountId,
                item_name,
                points_cost: parseInt(points_cost),
                redeemed_at: now,
                redeemed_code: redeemed_code || null,
                code_status: code_status || 'unsold'
            }])
            .select()
            .single();

        if (redempErr) throw redempErr;

        // Auto reclassify account to 'old' if it was 'new'
        await supabase.from('Users').update({ classification: 'old' }).eq('id', accountId);

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, new_value, record_id, result)
             VALUES (?, ?, ?, ?, 'Redeemed Reward Item', ?, ?, 'success')`,
            [user.id, user.email, user.role, account.user_id, JSON.stringify({ item_name, points_cost }), String(accountId)]
        );

        if (io) {
            io.emit('notification', {
                title: 'Reward Redeemed',
                message: `🎁 ${account.email} redeemed ${item_name} (${points_cost} pts)!`,
                type: 'success'
            });
        }

        res.json({ success: true, redemption: newRedemp });

    } catch (error) {
        console.error('Redeem Error:', error);
        res.status(500).json({ error: 'Error processing redemption' });
    }
};

// Get redemption history (Separated by user)
const getRedemptions = async (req, res) => {
    const user = req.user;
    try {
        const { data: allAccounts } = await supabase.from('Users').select('id, email, profile_no');
        const metaRows = await all(`SELECT account_id, user_id, classification FROM account_metadata`);
        const metaMap = new Map();
        metaRows.forEach(m => metaMap.set(m.account_id, m));

        let accounts = (allAccounts || []).map(a => {
            const m = metaMap.get(a.id);
            return {
                ...a,
                user_id: m ? m.user_id : 1
            };
        });

        if (user.role !== 'admin') {
            accounts = accounts.filter(a => a.user_id == user.id);
        } else if (req.query.userId) {
            accounts = accounts.filter(a => a.user_id == req.query.userId);
        }
        if (!accounts || accounts.length === 0) return res.json([]);

        const accountIds = accounts.map(a => a.id);
        const { data: redemptions, error: redErr } = await supabase
            .from('Redemptions')
            .select('*')
            .in('user_id', accountIds)
            .order('redeemed_at', { ascending: false });

        if (redErr) throw redErr;

        const results = (redemptions || []).map(r => {
            const acc = accounts.find(a => a.id === r.user_id);
            return {
                ...r,
                email: acc ? acc.email : 'Unknown',
                profile_no: acc ? acc.profile_no : null,
                user_id: acc ? acc.user_id : null
            };
        });

        res.json(results);
    } catch (error) {
        console.error('Get Redemptions Error:', error);
        res.status(500).json({ error: 'Error fetching redemption history' });
    }
};

module.exports = {
    setIo,
    getUserRewards,
    getAccountMatchesForReward,
    redeemItem,
    getRedemptions
};
