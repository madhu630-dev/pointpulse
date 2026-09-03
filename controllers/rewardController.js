const supabase = require('../db/supabase');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

const redeemItem = async (req, res) => {
    const userId = req.params.id;
    const adminId = req.user.admin_id;
    const { item_name, points_cost, redeemed_at, redeemed_code, code_status } = req.body;

    if (!item_name || !points_cost || !redeemed_at) {
        return res.status(400).json({ error: 'Missing redemption details' });
    }

    try {
        // Verify user belongs to admin
        const { data: user, error: userError } = await supabase
            .from('Users')
            .select('id, email')
            .eq('id', userId)
            .eq('admin_id', adminId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const now = new Date().toISOString();
        
        // Insert Redemption
        const { error: redemptionError } = await supabase
            .from('Redemptions')
            .insert([{ 
                user_id: userId, 
                item_name, 
                points_cost, 
                redeemed_at,
                redeemed_code: redeemed_code || null, 
                code_status: code_status || 'unsold' 
            }]);
            
        if (redemptionError) throw redemptionError;
        

        
        // Socket.io notification
        if (io) {
            io.to(adminId.toString()).emit('notification', {
                title: 'Reward Redeemed',
                message: `🎁 ${user.email} successfully redeemed ${item_name}!`,
                type: 'success'
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Redeem Error:", error);
        res.status(500).json({ error: 'Error saving redemption' });
    }
};

const getInventory = async (req, res) => {
    const adminId = req.user.admin_id;
    try {
        const { data: users, error: userError } = await supabase
            .from('Users')
            .select('id, email, profile_no')
            .eq('admin_id', adminId);

        if (userError) throw userError;
        if (!users || users.length === 0) return res.json([]);

        const userIds = users.map(u => u.id);
        const { data: redemptions, error: redempError } = await supabase
            .from('Redemptions')
            .select('*')
            .in('user_id', userIds)
            .order('redeemed_at', { ascending: false });

        if (redempError) throw redempError;

        const result = redemptions.map(r => {
            const user = users.find(u => u.id === r.user_id);
            return {
                ...r,
                email: user ? user.email : 'Unknown',
                profile_no: user ? user.profile_no : null
            };
        });

        res.json(result);
    } catch (error) {
        console.error("Get Inventory Error:", error);
        res.status(500).json({ error: 'Error fetching inventory' });
    }
};

const updateRedemption = async (req, res) => {
    const redemptionId = req.params.id;
    const adminId = req.user.admin_id;
    const { redeemed_code, code_status } = req.body;

    try {
        // Verify ownership indirectly by fetching the redemption and checking user's admin_id
        const { data: redemption } = await supabase
            .from('Redemptions')
            .select('user_id')
            .eq('id', redemptionId)
            .single();

        if (!redemption) return res.status(404).json({ error: 'Redemption not found' });

        const { data: user } = await supabase
            .from('Users')
            .select('id')
            .eq('id', redemption.user_id)
            .eq('admin_id', adminId)
            .single();

        if (!user) return res.status(403).json({ error: 'Unauthorized' });

        const updates = {};
        if (redeemed_code !== undefined) updates.redeemed_code = redeemed_code;
        if (code_status !== undefined) updates.code_status = code_status;

        const { error: updateError } = await supabase
            .from('Redemptions')
            .update(updates)
            .eq('id', redemptionId);

        if (updateError) throw updateError;

        res.json({ success: true });
    } catch (error) {
        console.error("Update Redemption Error:", error);
        res.status(500).json({ error: 'Error updating redemption' });
    }
};

const deleteRedemption = async (req, res) => {
    const redemptionId = req.params.id;
    const adminId = req.user.admin_id;

    try {
        const { data: redemption } = await supabase
            .from('Redemptions')
            .select('user_id, points_cost, item_name')
            .eq('id', redemptionId)
            .single();

        if (!redemption) return res.status(404).json({ error: 'Redemption not found' });

        const { data: user } = await supabase
            .from('Users')
            .select('id, email')
            .eq('id', redemption.user_id)
            .eq('admin_id', adminId)
            .single();

        if (!user) return res.status(403).json({ error: 'Unauthorized' });

        const { error: deleteError } = await supabase
            .from('Redemptions')
            .delete()
            .eq('id', redemptionId);

        if (deleteError) throw deleteError;



        if (io) {
            io.to(adminId.toString()).emit('notification', {
                title: 'Redemption Deleted',
                message: `Deleted redemption ${redemption.item_name} for ${user.email}`,
                type: 'info'
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Delete Redemption Error:", error);
        res.status(500).json({ error: 'Error deleting redemption' });
    }
};

module.exports = {
    setIo,
    redeemItem,
    getInventory,
    updateRedemption,
    deleteRedemption
};
