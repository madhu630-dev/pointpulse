const fs = require('fs');
const xlsx = require('xlsx');
const supabase = require('../db/supabase');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit-table');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

const uploadExcel = async (req, res) => {
    const adminId = req.user.admin_id;
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
        const passwordCol = keys.find(k => k.toLowerCase().includes('password'));
        const altEmailCol = keys.find(k => k.toLowerCase().includes('alt') && k.toLowerCase().includes('email'));
        const pointsCols = keys.filter(k => k.toLowerCase().startsWith('points_') || (!isNaN(Date.parse(k)) && k.includes('-')));

        if (isFresh) {
            const { data: users } = await supabase.from('Users').select('id').eq('admin_id', adminId);
            if (users && users.length > 0) {
                const userIds = users.map(u => u.id);
                await supabase.from('Redemptions').delete().in('user_id', userIds);
                await supabase.from('Points').delete().in('user_id', userIds);
                await supabase.from('Users').delete().eq('admin_id', adminId);
            }
        }

        const { data: maxProfileNoRow } = await supabase
            .from('Users')
            .select('profile_no')
            .eq('admin_id', adminId)
            .order('profile_no', { ascending: false })
            .limit(1);
            
        let currentMaxProfileNo = (maxProfileNoRow && maxProfileNoRow.length > 0 && maxProfileNoRow[0].profile_no) ? maxProfileNoRow[0].profile_no : 0;

        for (const row of data) {
            const email = row[emailCol];
            if (!email) continue;
            
            const server = serverCol ? row[serverCol] : '';
            const protonEmail = protonCol ? row[protonCol] : '';
            const password = passwordCol ? row[passwordCol] : '';
            const altEmail = altEmailCol ? row[altEmailCol] : '';
            let profileNo = profileCol ? row[profileCol] : null;
            if (profileNo) profileNo = parseInt(profileNo.toString().replace(/\D/g, '')) || null;
            
            let status = 'active';
            if (statusCol && row[statusCol] && row[statusCol].toString().toLowerCase().includes('ban')) {
                status = 'banned';
            }

            const { data: existingUser } = await supabase
                .from('Users')
                .select('id, profile_no')
                .eq('email', email)
                .eq('admin_id', adminId)
                .single();

            let userId;

            if (existingUser) {
                userId = existingUser.id;
                profileNo = profileNo || existingUser.profile_no;
                
                await supabase.from('Users').update({ 
                    server, proton_email: protonEmail, profile_no: profileNo, status, password, alternative_email: altEmail
                }).eq('id', userId);
            } else {
                if (!profileNo) {
                    currentMaxProfileNo++;
                    profileNo = currentMaxProfileNo;
                } else {
                    if (profileNo > currentMaxProfileNo) currentMaxProfileNo = profileNo;
                }

                const { data: newUser, error: insertError } = await supabase.from('Users').insert([{
                    admin_id: adminId, email, server, proton_email: protonEmail, profile_no: profileNo, status, password, alternative_email: altEmail
                }]).select('id').single();

                if (insertError) continue;
                userId = newUser.id;
            }

            for (const pCol of pointsCols) {
                let dateStr = pCol;
                if (pCol.toLowerCase().startsWith('points_')) {
                    dateStr = pCol.substring(7);
                }
                const pointsVal = row[pCol] || 0;
                const now = new Date().toISOString();

                await supabase.from('Points').upsert({
                    user_id: userId, date: dateStr, points: pointsVal, updated_at: now
                }, { onConflict: 'user_id,date' });
            }
        }

        fs.unlinkSync(req.file.path);
        res.json({ message: 'File processed successfully' });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: 'Error processing file' });
    }
};

const getAccounts = async (req, res) => {
    const adminId = req.user.admin_id;
    try {
        const { data: users, error: userError } = await supabase
            .from('Users')
            .select('*')
            .eq('admin_id', adminId)
            .order('is_pinned', { ascending: false }) // Pinned items first
            .order('profile_no', { ascending: true })
            .order('id', { ascending: true });

        if (userError) throw userError;
        
        if (!users || users.length === 0) {
            return res.json([]);
        }

        const userIds = users.map(u => u.id);

        const { data: redemptions, error: redempError } = await supabase
            .from('Redemptions')
            .select('*')
            .in('user_id', userIds)
            .order('redeemed_at', { ascending: false });

        if (redempError) throw redempError;

        const redemptionsByUser = {};
        if (redemptions) {
            redemptions.forEach(r => {
                if (!redemptionsByUser[r.user_id]) redemptionsByUser[r.user_id] = [];
                redemptionsByUser[r.user_id].push(r);
            });
        }

        const { data: points, error: pointsError } = await supabase
            .from('Points')
            .select('*')
            .in('user_id', userIds)
            .order('updated_at', { ascending: true });
            
        if (pointsError) throw pointsError;

        const latestPointsByUser = {};
        const pointsHistoryByUser = {};

        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }

                if (!pointsHistoryByUser[p.user_id]) {
                    pointsHistoryByUser[p.user_id] = { prev: null, positiveUpdates: [] };
                }
                
                const prev = pointsHistoryByUser[p.user_id].prev;
                if (prev !== null) {
                    const diff = p.points - prev;
                    if (diff > 0) {
                        pointsHistoryByUser[p.user_id].positiveUpdates.push({
                            diff: diff,
                            prev_points: prev,
                            new_points: p.points,
                            updated_at: p.updated_at
                        });
                    }
                }
                pointsHistoryByUser[p.user_id].prev = p.points;
            });
        }

        const formattedAccounts = users.map(acc => {
            const lp = latestPointsByUser[acc.id];
            const history = pointsHistoryByUser[acc.id] ? pointsHistoryByUser[acc.id].positiveUpdates.slice(-10) : [];
            return {
                ...acc,
                current_points: lp ? lp.points : 0,
                last_updated: lp ? lp.updated_at : null,
                redemptions: redemptionsByUser[acc.id] || [],
                points_history: history
            };
        });

        res.json(formattedAccounts);
    } catch (error) {
        console.error("Fetch Accounts Error:", error);
        res.status(500).json({ error: 'Error fetching accounts' });
    }
};

const updateAccount = async (req, res) => {
    const userId = req.params.id;
    const adminId = req.user.admin_id;
    const { profile_no, email, server, status, points, notes, is_pinned, proton_email, password, alternative_email } = req.body;

    try {
        const { data: user, error: userError } = await supabase
            .from('Users')
            .select('id, email')
            .eq('id', userId)
            .eq('admin_id', adminId)
            .single();

        if (userError || !user) return res.status(404).json({ error: 'Account not found' });

        if (profile_no !== undefined || email || server || status || notes !== undefined || is_pinned !== undefined || proton_email !== undefined || password !== undefined || alternative_email !== undefined) {
            const updates = {};
            if (profile_no !== undefined) updates.profile_no = profile_no;
            if (email) updates.email = email;
            if (server !== undefined) updates.server = server;
            if (status) updates.status = status;
            if (notes !== undefined) updates.notes = notes;
            if (is_pinned !== undefined) updates.is_pinned = is_pinned;
            if (proton_email !== undefined) updates.proton_email = proton_email;
            if (password !== undefined) updates.password = password;
            if (alternative_email !== undefined) updates.alternative_email = alternative_email;
            
            if (Object.keys(updates).length > 0) {
                await supabase.from('Users').update(updates).eq('id', userId);
                
                if (status === 'banned' && io) {
                    io.to(adminId.toString()).emit('notification', {
                        title: 'Account Banned',
                        message: `🚫 ${email || user.email} was marked as banned.`,
                        type: 'danger'
                    });
                }
            }
        }

        if (points !== undefined) {
            const now = new Date().toISOString();
            const dateStr = `ManualUpdate_${Date.now()}`;
            
            await supabase.from('Points').insert([{
                user_id: userId, date: dateStr, points: points, updated_at: now
            }]);
            
            if (points >= 10000 && io) {
                io.to(adminId.toString()).emit('notification', {
                    title: 'Threshold Reached!',
                    message: `🎉 ${email || user.email} reached 10K points!`,
                    type: 'success'
                });
            } else if (points >= 5000 && io) {
                io.to(adminId.toString()).emit('notification', {
                    title: 'Ready to Redeem',
                    message: `🎁 ${email || user.email} reached 5K points!`,
                    type: 'info'
                });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Update Account Error:", error);
        res.status(500).json({ error: 'Error updating account' });
    }
};

const exportCsv = async (req, res) => {
    // We will reuse getAccounts logic internally, or just ask the client to fetch and we parse it
    // But since it's a dedicated endpoint, we do a raw DB pull.
    const adminId = req.user.admin_id;
    try {
        const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).order('profile_no', { ascending: true });
        if (!users) return res.status(404).send("No data");

        const { data: points } = await supabase.from('Points').select('*').in('user_id', users.map(u => u.id));
        const latestPointsByUser = {};
        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }
            });
        }

        const exportData = users.map(acc => ({
            Profile_No: acc.profile_no,
            Email: acc.email,
            Server: acc.server,
            Status: acc.status,
            Points: latestPointsByUser[acc.id] ? latestPointsByUser[acc.id].points : 0,
            Notes: acc.notes || ''
        }));

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(exportData);
        
        res.header('Content-Type', 'text/csv');
        res.attachment('accounts_export.csv');
        return res.send(csv);
    } catch (error) {
        res.status(500).json({ error: 'Error exporting CSV' });
    }
};

const exportPdf = async (req, res) => {
    const adminId = req.user.admin_id;
    try {
        const { data: users } = await supabase.from('Users').select('*').eq('admin_id', adminId).order('profile_no', { ascending: true });
        if (!users) return res.status(404).send("No data");

        const { data: points } = await supabase.from('Points').select('*').in('user_id', users.map(u => u.id));
        const latestPointsByUser = {};
        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }
            });
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-disposition', 'attachment; filename=accounts_report.pdf');
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        const table = {
            title: "PointPulse Account Report",
            headers: ["Prof No.", "Email", "Server", "Points", "Status"],
            rows: users.map(acc => {
                const pts = latestPointsByUser[acc.id] ? latestPointsByUser[acc.id].points : 0;
                return [
                    acc.profile_no ? String(acc.profile_no) : '-',
                    acc.email || '-',
                    acc.server || '-',
                    String(pts),
                    acc.status || '-'
                ];
            })
        };

        await doc.table(table, { 
            prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
            prepareRow: () => doc.font("Helvetica").fontSize(10)
        });
        
        doc.end();
    } catch (error) {
        res.status(500).json({ error: 'Error exporting PDF' });
    }
};

const exportAccountPdf = async (req, res) => {
    const userId = req.params.id;
    const adminId = req.user.admin_id;

    try {
        const { data: user } = await supabase.from('Users').select('*').eq('id', userId).eq('admin_id', adminId).single();
        if (!user) return res.status(404).json({ error: 'Account not found' });

        const { data: redemptions } = await supabase.from('Redemptions').select('*').eq('user_id', userId).order('redeemed_at', { ascending: false });

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-disposition', `attachment; filename=account_report_${user.profile_no || user.id}.pdf`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        doc.fontSize(22).fillColor('#2c3e50').text('Account Analysis Report', { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(16).fillColor('#34495e').text('Account Details');
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#bdc3c7').stroke();
        doc.moveDown(1);

        doc.fontSize(12).fillColor('#2c3e50');
        doc.text(`Profile No.: ${user.profile_no || '-'}`);
        doc.text(`Email: ${user.email || '-'}`);
        doc.text(`Server: ${user.server || '-'}`);
        doc.text(`Proton Mail: ${user.proton_email || '-'}`);
        doc.text(`Password: ${user.password || '-'}`);
        doc.text(`Alternative Mail: ${user.alternative_email || '-'}`);
        doc.moveDown(2);

        doc.fontSize(16).fillColor('#34495e').text('Redemption History');
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#bdc3c7').stroke();
        doc.moveDown(1);

        if (!redemptions || redemptions.length === 0) {
            doc.fontSize(12).fillColor('#7f8c8d').text('No redemptions found for this account.');
        } else {
            redemptions.forEach((r, idx) => {
                doc.fontSize(12).fillColor('#2c3e50').text(`${idx + 1}. Item: ${r.item_name}`);
                doc.fontSize(10).fillColor('#7f8c8d');
                doc.text(`   Date: ${r.redeemed_at.split('T')[0]}`);
                doc.text(`   Code: ${r.redeemed_code || '-'}`);
                doc.text(`   Status: ${r.code_status || 'unsold'}`);
                doc.moveDown(0.5);
            });
        }

        doc.end();
    } catch (error) {
        console.error("Export Account PDF Error:", error);
        res.status(500).json({ error: 'Error generating PDF' });
    }
};

const exportFilteredPdf = async (req, res) => {
    const adminId = req.user.admin_id;
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'No user IDs provided' });
    }

    try {
        const { data: users } = await supabase
            .from('Users')
            .select('*')
            .eq('admin_id', adminId)
            .in('id', userIds)
            .order('profile_no', { ascending: true });
            
        if (!users || users.length === 0) return res.status(404).send("No data");

        const { data: points } = await supabase.from('Points').select('*').in('user_id', users.map(u => u.id));
        const latestPointsByUser = {};
        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }
            });
        }

        const { data: redemptions } = await supabase.from('Redemptions').select('*').in('user_id', users.map(u => u.id));
        const redemptionsByUser = {};
        if (redemptions) {
            redemptions.forEach(r => {
                if (!redemptionsByUser[r.user_id]) redemptionsByUser[r.user_id] = [];
                redemptionsByUser[r.user_id].push(r);
            });
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-disposition', 'attachment; filename=filtered_accounts_report.pdf');
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        const table = {
            title: "Filtered Accounts Report",
            headers: ["Prof No.", "Email", "Server", "Points", "Redemptions"],
            rows: users.map(acc => {
                const pts = latestPointsByUser[acc.id] ? latestPointsByUser[acc.id].points : 0;
                let redempStr = '-';
                if (redemptionsByUser[acc.id] && redemptionsByUser[acc.id].length > 0) {
                    redempStr = redemptionsByUser[acc.id].map(r => {
                        const d = r.redeemed_at.includes('T') ? new Date(r.redeemed_at).toLocaleDateString() : r.redeemed_at;
                        return `${r.item_name} (${d})`;
                    }).join(', ');
                }
                return [
                    acc.profile_no ? String(acc.profile_no) : '-',
                    acc.email || '-',
                    acc.server || '-',
                    String(pts),
                    redempStr
                ];
            })
        };

        await doc.table(table, {
            prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
            prepareRow: () => doc.font("Helvetica").fontSize(10)
        });
        
        doc.end();
    } catch (error) {
        console.error("Export Filtered PDF Error:", error);
        res.status(500).json({ error: 'Error generating PDF' });
    }
};

const createAccount = async (req, res) => {
    const adminId = req.user.admin_id;
    const { profile_no, email, server, proton_email, password, alternative_email, initial_points, notes, status } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        let finalProfileNo = profile_no;
        
        // Auto-assign profile_no if not provided
        if (!finalProfileNo) {
            const { data: maxProfileNoRow } = await supabase
                .from('Users')
                .select('profile_no')
                .eq('admin_id', adminId)
                .order('profile_no', { ascending: false })
                .limit(1);
            
            finalProfileNo = (maxProfileNoRow && maxProfileNoRow.length > 0 && maxProfileNoRow[0].profile_no) 
                ? maxProfileNoRow[0].profile_no + 1 
                : 1;
        }

        // Check if email already exists
        const { data: existingUser } = await supabase
            .from('Users')
            .select('id')
            .eq('email', email)
            .eq('admin_id', adminId)
            .single();

        if (existingUser) {
            return res.status(400).json({ error: 'An account with this email already exists' });
        }

        // Insert new user
        const { data: newUser, error: insertError } = await supabase
            .from('Users')
            .insert([{
                admin_id: adminId, 
                email, 
                server: server || null, 
                proton_email: proton_email || null, 
                profile_no: finalProfileNo, 
                status: status || 'active', 
                password: password || null,
                alternative_email: alternative_email || null,
                notes: notes || null
            }])
            .select('id')
            .single();

        if (insertError) throw insertError;

        // Insert initial points if provided and > 0
        if (initial_points && initial_points > 0) {
            const now = new Date().toISOString();
            const dateStr = `InitialPoints_${Date.now()}`;
            
            await supabase.from('Points').insert([{
                user_id: newUser.id, date: dateStr, points: initial_points, updated_at: now
            }]);
        }

        res.status(201).json({ success: true, message: 'Account created successfully', id: newUser.id });
    } catch (error) {
        console.error("Create Account Error:", error);
        res.status(500).json({ error: 'Error creating account' });
    }
};

const exportDetailed = async (req, res) => {
    const adminId = req.user.admin_id;
    const { accountType = 'old', statusFilter = 'all', format = 'xlsx' } = req.body;

    try {
        let query = supabase.from('Users').select('*').eq('admin_id', adminId).order('profile_no', { ascending: true });
        if (statusFilter && statusFilter !== 'all') {
            query = query.eq('status', statusFilter);
        }
        const { data: users, error: userErr } = await query;
        if (userErr || !users || users.length === 0) return res.status(404).json({ error: "No accounts found" });

        const userIds = users.map(u => u.id);
        const { data: points } = await supabase.from('Points').select('*').in('user_id', userIds);
        const latestPointsByUser = {};
        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }
            });
        }

        const { data: redemptions } = await supabase.from('Redemptions').select('*').in('user_id', userIds).order('redeemed_at', { ascending: false });
        const redemptionsByUser = {};
        if (redemptions) {
            redemptions.forEach(r => {
                if (!redemptionsByUser[r.user_id]) redemptionsByUser[r.user_id] = [];
                redemptionsByUser[r.user_id].push(r);
            });
        }

        // Filter by Old / New / All
        const filteredUsers = users.filter(acc => {
            const hasRedemptions = redemptionsByUser[acc.id] && redemptionsByUser[acc.id].length > 0;
            if (accountType === 'old') return hasRedemptions;
            if (accountType === 'new') return !hasRedemptions;
            return true; // 'all'
        });

        if (filteredUsers.length === 0) {
            return res.status(404).json({ error: `No ${accountType === 'all' ? '' : accountType + ' '}accounts found` });
        }

        // Columns: Profile No., Email, Password, Alternative Mail, Server, Current Present Points, Redeemed Item, Old/New Account
        const exportData = filteredUsers.map(acc => {
            const userRedemps = redemptionsByUser[acc.id] || [];
            const isOld = userRedemps.length > 0;
            const redeemedItemsStr = isOld 
                ? userRedemps.map(r => r.item_name).join(', ') 
                : 'None';
            const pts = latestPointsByUser[acc.id] ? latestPointsByUser[acc.id].points : 0;

            return {
                'Profile No.': acc.profile_no !== null ? acc.profile_no : '',
                'Email': acc.email || '',
                'Password': acc.password || '',
                'Alternative Mail': acc.alternative_email || '',
                'Server': acc.server || '',
                'Current Present Points': pts,
                'Redeemed Item': redeemedItemsStr,
                'Old/New Account': isOld ? 'Old Account' : 'New Account'
            };
        });

        if (format === 'xlsx') {
            const wb = xlsx.utils.book_new();
            const ws = xlsx.utils.json_to_sheet(exportData);
            xlsx.utils.book_append_sheet(wb, ws, "Detailed_Accounts");
            const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', `attachment; filename="PointPulse_Detailed_${accountType}_Accounts.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buf);
        } else {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(exportData);
            res.header('Content-Type', 'text/csv; charset=utf-8');
            res.attachment(`PointPulse_Detailed_${accountType}_Accounts.csv`);
            return res.send(csv);
        }
    } catch (error) {
        console.error("Export Detailed Error:", error);
        res.status(500).json({ error: 'Error exporting detailed accounts' });
    }
};

const exportPointsList = async (req, res) => {
    const adminId = req.user.admin_id;
    const { accountType = 'old', statusFilter = 'all', format = 'xlsx' } = req.body;

    try {
        let query = supabase.from('Users').select('*').eq('admin_id', adminId).order('profile_no', { ascending: true });
        if (statusFilter && statusFilter !== 'all') {
            query = query.eq('status', statusFilter);
        }
        const { data: users, error: userErr } = await query;
        if (userErr || !users || users.length === 0) return res.status(404).json({ error: "No accounts found" });

        const userIds = users.map(u => u.id);
        const { data: points } = await supabase.from('Points').select('*').in('user_id', userIds);
        const latestPointsByUser = {};
        if (points) {
            points.forEach(p => {
                if (!latestPointsByUser[p.user_id] || p.id > latestPointsByUser[p.user_id].id) {
                    latestPointsByUser[p.user_id] = p;
                }
            });
        }

        const { data: redemptions } = await supabase.from('Redemptions').select('user_id').in('user_id', userIds);
        const userRedemptionSet = new Set(redemptions ? redemptions.map(r => r.user_id) : []);

        const filteredUsers = users.filter(acc => {
            const hasRedemptions = userRedemptionSet.has(acc.id);
            if (accountType === 'old') return hasRedemptions;
            if (accountType === 'new') return !hasRedemptions;
            return true; // 'all'
        });

        if (filteredUsers.length === 0) {
            return res.status(404).json({ error: `No ${accountType === 'all' ? '' : accountType + ' '}accounts found` });
        }

        // Columns ONLY: Profile No., Email, Server, Points
        const exportData = filteredUsers.map(acc => {
            const pts = latestPointsByUser[acc.id] ? latestPointsByUser[acc.id].points : 0;
            return {
                'Profile No.': acc.profile_no !== null ? acc.profile_no : '',
                'Email': acc.email || '',
                'Server': acc.server || '',
                'Points': pts
            };
        });

        if (format === 'xlsx') {
            const wb = xlsx.utils.book_new();
            const ws = xlsx.utils.json_to_sheet(exportData);
            xlsx.utils.book_append_sheet(wb, ws, "Points_List");
            const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', `attachment; filename="PointPulse_Points_List_${accountType}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buf);
        } else {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(exportData);
            res.header('Content-Type', 'text/csv; charset=utf-8');
            res.attachment(`PointPulse_Points_List_${accountType}.csv`);
            return res.send(csv);
        }
    } catch (error) {
        console.error("Export Points List Error:", error);
        res.status(500).json({ error: 'Error exporting points list' });
    }
};

module.exports = {
    setIo,
    uploadExcel,
    getAccounts,
    updateAccount,
    exportCsv,
    exportPdf,
    exportAccountPdf,
    exportFilteredPdf,
    exportDetailed,
    exportPointsList,
    createAccount
};
