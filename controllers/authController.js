const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { get, run, all, ADMIN_EMAIL } = require('../db/database');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Verify Google Token securely
async function verifyGoogleIdToken(token) {
    if (!token) throw new Error('Google authentication token missing');

    // 1. Try google-auth-library verification if client ID is set
    try {
        if (GOOGLE_CLIENT_ID) {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();
            if (payload && (payload.email_verified === true || payload.email_verified === 'true')) {
                return payload;
            }
        }
    } catch (e) {
        // Fall back to direct Google tokeninfo endpoint
    }

    // 2. Direct tokeninfo or userinfo verification with Google OAuth2 API
    try {
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
        if (response.ok) {
            const payload = await response.json();
            if (payload && (payload.email_verified === 'true' || payload.email_verified === true)) {
                return payload;
            }
            throw new Error('Google email is not verified.');
        }
    } catch (e) {
        // If not an ID token, attempt verification as OAuth2 access token
    }

    try {
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (userinfoRes.ok) {
            const profile = await userinfoRes.json();
            if (profile && (profile.email_verified === true || profile.email_verified === 'true')) {
                return profile;
            }
        }
    } catch (e) {
        // External check failed
    }

    // 3. Test tokens strictly restricted to automated testing suite only (NODE_ENV === 'test')
    if (process.env.NODE_ENV === 'test' && token.startsWith('TEST_TOKEN_')) {
        const parts = token.replace('TEST_TOKEN_', '').split(':');
        const email = parts[0];
        const name = parts[1] || 'Test User';
        return {
            sub: `mock_sub_${Buffer.from(email).toString('hex')}`,
            email: email.toLowerCase(),
            email_verified: true,
            name: name,
            picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`
        };
    }

    throw new Error('Failed to verify genuine Google identity. Please authenticate with a verified Google account.');
}

// Return public authentication configuration (Google Client ID)
const getAuthConfig = (req, res) => {
    return res.json({
        googleClientId: GOOGLE_CLIENT_ID || ''
    });
};

// Google Auth Handler
const googleAuth = async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    try {
        const payload = await verifyGoogleIdToken(credential);
        const email = payload.email.toLowerCase();
        const googleId = payload.sub;
        const name = payload.name || 'User';
        const picture = payload.picture || '';

        // Check if user is the sole administrator
        const isAdmin = (email === ADMIN_EMAIL.toLowerCase());

        let user = await get(`SELECT * FROM app_users WHERE email = ?`, [email]);

        if (isAdmin) {
            // Sole Administrator provisioning
            if (!user) {
                const insertRes = await run(
                    `INSERT INTO app_users (google_id, email, name, picture, role, status, terms_accepted, terms_accepted_at, approved_at)
                     VALUES (?, ?, ?, ?, 'admin', 'approved', 1, datetime('now'), datetime('now'))`,
                    [googleId, email, name, picture]
                );
                user = await get(`SELECT * FROM app_users WHERE id = ?`, [insertRes.lastID]);
            } else {
                // Update profile info & enforce admin status
                await run(
                    `UPDATE app_users SET google_id = ?, name = ?, picture = ?, role = 'admin', status = 'approved', updated_at = datetime('now') WHERE id = ?`,
                    [googleId, name, picture, user.id]
                );
                user = await get(`SELECT * FROM app_users WHERE id = ?`, [user.id]);
            }

            // Provision admin permissions
            const adminPerms = [
                'view_accounts', 'add_accounts', 'edit_accounts', 'update_points', 
                'import_excel', 'view_redemption', 'download_reports', 
                'view_old_accounts', 'view_new_accounts', 'submit_requests'
            ];
            for (const p of adminPerms) {
                await run(`INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)`, [user.id, p, user.id]);
            }

            // Log login
            await run(
                `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, result, ip_address)
                 VALUES (?, ?, 'admin', 'Administrator Login via Google OAuth', 'success', ?)`,
                [user.id, user.email, req.ip || '']
            );

            const token = jwt.sign(
                { id: user.id, email: user.email, role: 'admin', status: 'approved' },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    picture: user.picture,
                    role: 'admin',
                    status: 'approved',
                    permissions: adminPerms
                }
            });
        }

        // Regular User Flow
        if (!user) {
            // Needs registration form submission
            return res.json({
                success: true,
                needsRegistration: true,
                googleUser: {
                    googleId,
                    email,
                    name,
                    picture
                }
            });
        }

        // User already exists
        if (user.status === 'suspended') {
            return res.status(403).json({
                error: 'Your account has been suspended by the administrator. Please contact the administrator.',
                status: 'suspended'
            });
        }

        if (user.status === 'rejected') {
            return res.status(403).json({
                error: 'Your registration application was rejected by the administrator.',
                status: 'rejected'
            });
        }

        // Generate session token (even for pending, so they can view pending screen & contact admin)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, status: user.status },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Fetch permissions if approved
        let userPerms = [];
        if (user.status === 'approved') {
            const now = new Date().toISOString();
            const pRows = await all(
                `SELECT permission_key FROM user_permissions WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
                [user.id, now]
            );
            userPerms = pRows.map(p => p.permission_key);

            // Audit log
            await run(
                `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, result, ip_address)
                 VALUES (?, ?, 'user', 'User Login via Google OAuth', 'success', ?)`,
                [user.id, user.email, req.ip || '']
            );
        }

        return res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                role: user.role,
                status: user.status,
                submitted_at: user.created_at,
                permissions: userPerms
            }
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        return res.status(401).json({ error: error.message || 'Google authentication failed' });
    }
};

// Complete Registration Form after Google sign-in
const submitRegistration = async (req, res) => {
    const { 
        credential, 
        displayName, 
        phone, 
        registrationPurpose, 
        accountManagementDescription, 
        termsAccepted 
    } = req.body;

    if (!credential) return res.status(400).json({ error: 'Google credential required' });
    if (!termsAccepted) return res.status(400).json({ error: 'You must acknowledge the terms and privacy policy' });

    try {
        const payload = await verifyGoogleIdToken(credential);
        const email = payload.email.toLowerCase();
        const googleId = payload.sub;
        const name = payload.name || displayName || 'User';
        const picture = payload.picture || '';

        // Prevent admin registration from user form
        if (email === ADMIN_EMAIL.toLowerCase()) {
            return res.status(400).json({ error: 'Administrator must sign in directly' });
        }

        // Check if already registered
        const existing = await get(`SELECT * FROM app_users WHERE email = ?`, [email]);
        if (existing) {
            return res.status(400).json({ error: 'Account already registered. Please sign in.' });
        }

        // Insert pending user
        const now = new Date().toISOString();
        const insertResult = await run(
            `INSERT INTO app_users (
                google_id, email, name, picture, role, status, 
                display_name, phone, registration_purpose, 
                account_management_description, terms_accepted, 
                policy_version, terms_accepted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'user', 'pending', ?, ?, ?, ?, 1, '1.0', ?, ?, ?)`,
            [
                googleId, email, name, picture,
                displayName || name, phone || '', registrationPurpose || '',
                accountManagementDescription || '', now, now, now
            ]
        );

        const newUserId = insertResult.lastID;

        // Record policy acknowledgement
        await run(
            `INSERT INTO policy_acknowledgements (user_id, user_type, policy_version, accepted_at, ip_address)
             VALUES (?, 'user', '1.0', ?, ?)`,
            [newUserId, now, req.ip || '']
        );

        // Notify Administrator
        await run(
            `INSERT INTO notifications (recipient_role, category, title, message, data)
             VALUES ('admin', 'new_registration', 'New User Registration', ?, ?)`,
            [
                `User ${name} (${email}) has registered and is pending approval.`,
                JSON.stringify({ userId: newUserId, email, name })
            ]
        );

        // Audit log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, result, ip_address)
             VALUES (?, ?, 'user', ?, 'User Registration Form Submitted', 'pending_approval', ?)`,
            [newUserId, email, newUserId, req.ip || '']
        );

        const token = jwt.sign(
            { id: newUserId, email, role: 'user', status: 'pending' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.json({
            success: true,
            token,
            status: 'pending',
            user: {
                id: newUserId,
                email,
                name,
                picture,
                role: 'user',
                status: 'pending',
                submitted_at: now
            }
        });

    } catch (error) {
        console.error('Submit Registration Error:', error);
        return res.status(500).json({ error: error.message || 'Error processing registration' });
    }
};

// Current Session Info
const getMe = async (req, res) => {
    try {
        const user = req.user;
        const now = new Date().toISOString();

        // Check if administrator has specifically sent a mandatory review form to this user
        let pendingForm = null;
        if (user.role === 'user' && user.status === 'approved' && user.review_form_required === 1) {
            const activeSchedule = await get(`SELECT * FROM form_schedules WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1`);
            if (activeSchedule) {
                pendingForm = {
                    scheduleId: activeSchedule.id,
                    title: activeSchedule.title,
                    type: activeSchedule.type,
                    deadlineDay: activeSchedule.deadline_day,
                    questions: JSON.parse(activeSchedule.questions || '[]')
                };
            }
        }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                role: user.role,
                status: user.status,
                display_name: user.display_name,
                review_form_required: user.review_form_required ? 1 : 0,
                permissions: user.permissions || [],
                temporary_actions: user.temporary_actions || [],
                created_at: user.created_at
            },
            pendingForm
        });
    } catch (error) {
        console.error('GetMe Error:', error);
        res.status(500).json({ error: 'Error fetching session profile' });
    }
};

// Logout
const logout = async (req, res) => {
    if (req.user) {
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, result)
             VALUES (?, ?, ?, 'User Logout', 'success')`,
            [req.user.id, req.user.email, req.user.role]
        );
    }
    res.json({ success: true, message: 'Logged out successfully' });
};

// Direct Email + Password Login (Admin & Users)
const login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const isAdmin = (cleanEmail === ADMIN_EMAIL.toLowerCase());

    try {
        let user = await get(`SELECT * FROM app_users WHERE lower(email) = ?`, [cleanEmail]);

        if (isAdmin) {
            // Sole Administrator Login
            if (!user) {
                // First-time administrator creation with chosen password
                const hashed = await bcrypt.hash(password, 10);
                const insertRes = await run(
                    `INSERT INTO app_users (google_id, email, name, picture, role, status, password_hash, terms_accepted, terms_accepted_at, approved_at)
                     VALUES (?, ?, 'Sole Administrator', '', 'admin', 'approved', ?, 1, datetime('now'), datetime('now'))`,
                    [`admin_direct_${cleanEmail}`, cleanEmail, hashed]
                );
                user = await get(`SELECT * FROM app_users WHERE id = ?`, [insertRes.lastID]);
            } else {
                // If administrator exists but password_hash is not set yet
                if (!user.password_hash) {
                    const hashed = await bcrypt.hash(password, 10);
                    await run(
                        `UPDATE app_users SET password_hash = ?, role = 'admin', status = 'approved', updated_at = datetime('now') WHERE id = ?`,
                        [hashed, user.id]
                    );
                    user.password_hash = hashed;
                } else {
                    const valid = await bcrypt.compare(password, user.password_hash);
                    if (!valid) {
                        return res.status(401).json({ error: 'Invalid administrator credentials.' });
                    }
                }
            }

            // Provision admin permissions
            const adminPerms = [
                'view_accounts', 'add_accounts', 'edit_accounts', 'update_points', 
                'import_excel', 'view_redemption', 'download_reports', 
                'view_old_accounts', 'view_new_accounts', 'submit_requests'
            ];
            for (const p of adminPerms) {
                await run(`INSERT OR IGNORE INTO user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)`, [user.id, p, user.id]);
            }

            // Audit log
            await run(
                `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, result, ip_address)
                 VALUES (?, ?, 'admin', 'Administrator Login via Email & Password', 'success', ?)`,
                [user.id, user.email, req.ip || '']
            );

            const token = jwt.sign(
                { id: user.id, email: user.email, role: 'admin', status: 'approved' },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name || 'Sole Administrator',
                    picture: user.picture || '',
                    role: 'admin',
                    status: 'approved',
                    permissions: adminPerms
                }
            });
        }

        // Regular User
        if (!user) {
            return res.status(401).json({ 
                error: 'Account not found for this email address. Please switch to the "Create Account" tab above to submit your registration application.' 
            });
        }

        // Check password
        if (!user.password_hash) {
            // User was previously registered via Google OAuth without password
            if (user.status === 'approved') {
                const hashed = await bcrypt.hash(password, 10);
                await run(`UPDATE app_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [hashed, user.id]);
                user.password_hash = hashed;
            } else {
                return res.status(401).json({ 
                    error: 'Password not set for this account. Please sign in with Google or contact the administrator.' 
                });
            }
        } else {
            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid password. Please check your credentials.' });
            }
        }

        // Check account status
        if (user.status === 'suspended') {
            return res.status(403).json({
                error: 'Your account has been suspended by the administrator. Please contact the administrator.',
                status: 'suspended'
            });
        }

        if (user.status === 'rejected') {
            return res.status(403).json({
                error: 'Your registration application was rejected by the administrator.',
                status: 'rejected'
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, status: user.status },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        let userPerms = [];
        if (user.status === 'approved') {
            const now = new Date().toISOString();
            const pRows = await all(
                `SELECT permission_key FROM user_permissions WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
                [user.id, now]
            );
            userPerms = pRows.map(p => p.permission_key);

            await run(
                `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, result, ip_address)
                 VALUES (?, ?, 'user', 'User Login via Email & Password', 'success', ?)`,
                [user.id, user.email, req.ip || '']
            );
        }

        return res.json({
            success: true,
            token,
            status: user.status,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture || '',
                role: user.role,
                status: user.status,
                display_name: user.display_name,
                submitted_at: user.created_at,
                permissions: userPerms
            }
        });

    } catch (error) {
        console.error('Email Login Error:', error);
        return res.status(500).json({ error: 'An error occurred during authentication.' });
    }
};

// Direct User Registration with Email and Password
const register = async (req, res) => {
    const {
        email,
        password,
        name,
        displayName,
        phone,
        registrationPurpose,
        accountManagementDescription,
        termsAccepted
    } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters in length' });
    }

    if (!termsAccepted) {
        return res.status(400).json({ error: 'You must acknowledge the terms and policies' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Prevent registering admin email via user register form
    if (cleanEmail === ADMIN_EMAIL.toLowerCase()) {
        return res.status(400).json({ error: 'Administrator email cannot be registered from this form. Please sign in directly.' });
    }

    try {
        const existing = await get(`SELECT * FROM app_users WHERE lower(email) = ?`, [cleanEmail]);
        if (existing) {
            return res.status(400).json({ error: 'An account with this email address already exists. Please sign in.' });
        }

        const now = new Date().toISOString();
        const userName = name || displayName || cleanEmail.split('@')[0];
        const userDisplayName = displayName || userName;
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=6366f1&color=fff`;

        const hashedPassword = await bcrypt.hash(password, 10);

        const insertResult = await run(
            `INSERT INTO app_users (
                google_id, email, name, picture, role, status, 
                password_hash, display_name, phone, registration_purpose, 
                account_management_description, terms_accepted, 
                policy_version, terms_accepted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'user', 'pending', ?, ?, ?, ?, ?, 1, '1.0', ?, ?, ?)`,
            [
                `direct_${cleanEmail}`,
                cleanEmail,
                userName,
                avatarUrl,
                hashedPassword,
                userDisplayName,
                phone || '',
                registrationPurpose || 'account_operator',
                accountManagementDescription || '',
                now,
                now,
                now
            ]
        );

        const newUserId = insertResult.lastID;

        // Policy acknowledgement
        await run(
            `INSERT INTO policy_acknowledgements (user_id, user_type, policy_version, accepted_at, ip_address)
             VALUES (?, 'user', '1.0', ?, ?)`,
            [newUserId, now, req.ip || '']
        );

        // Notify Administrator
        await run(
            `INSERT INTO notifications (recipient_role, category, title, message, data)
             VALUES ('admin', 'new_registration', 'New User Registration', ?, ?)`,
            [
                `User ${userName} (${cleanEmail}) has registered via direct portal and is pending approval.`,
                JSON.stringify({ userId: newUserId, email: cleanEmail, name: userName })
            ]
        );

        // Audit log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, result, ip_address)
             VALUES (?, ?, 'user', ?, 'Direct User Registration Form Submitted', 'pending_approval', ?)`,
            [newUserId, cleanEmail, newUserId, req.ip || '']
        );

        const token = jwt.sign(
            { id: newUserId, email: cleanEmail, role: 'user', status: 'pending' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.status(201).json({
            success: true,
            token,
            status: 'pending',
            user: {
                id: newUserId,
                email: cleanEmail,
                name: userName,
                picture: avatarUrl,
                role: 'user',
                status: 'pending',
                submitted_at: now
            }
        });

    } catch (error) {
        console.error('Direct Registration Error:', error);
        return res.status(500).json({ error: error.message || 'Error processing registration' });
    }
};

module.exports = {
    login,
    register,
    googleAuth,
    submitRegistration,
    getMe,
    logout,
    getAuthConfig
};
