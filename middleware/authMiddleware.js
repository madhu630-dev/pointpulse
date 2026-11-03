const jwt = require('jsonwebtoken');
const { get, all, ADMIN_EMAIL, getUserEditingPeriodStatus } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'pointpulse_jwt_secret_2026_enterprise_secure_token';

// Verify and attach authenticated user to request
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });

        jwt.verify(token, JWT_SECRET, async (err, decoded) => {
            if (err) return res.status(403).json({ error: 'Session expired or invalid. Please sign in again.' });

            // Fetch live user from database to ensure up-to-the-minute status & permissions
            const user = await get(`SELECT * FROM app_users WHERE id = ?`, [decoded.id]);
            if (!user) {
                return res.status(403).json({ error: 'Account not found or access revoked.' });
            }

            if (user.status === 'suspended') {
                return res.status(403).json({ error: 'Your account has been suspended by the administrator.', status: 'suspended' });
            }

            if (user.status === 'rejected') {
                return res.status(403).json({ error: 'Your registration application was rejected.', status: 'rejected' });
            }

            // Fetch live permissions
            const now = new Date().toISOString();
            const perms = await all(
                `SELECT permission_key FROM user_permissions 
                 WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
                [user.id, now]
            );
            user.permissions = perms.map(p => p.permission_key);

            // Fetch active temporary access windows
            const activeWindows = await all(
                `SELECT permitted_actions FROM temporary_access_windows 
                 WHERE user_id = ? AND is_active = 1 AND start_time <= ? AND end_time >= ?`,
                [user.id, now, now]
            );
            user.temporary_actions = [];
            activeWindows.forEach(w => {
                try {
                    const acts = JSON.parse(w.permitted_actions || '[]');
                    user.temporary_actions.push(...acts);
                } catch (e) {}
            });

            req.user = user;
            next();
        });
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        return res.status(500).json({ error: 'Authentication service error' });
    }
};

// Require single administrator role
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin' || req.user.email !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Administrator access required. Access denied.' });
    }
    next();
};

// Require approved status (blocks pending registrations from accessing dashboard APIs)
const requireApproved = (req, res, next) => {
    if (!req.user || req.user.status !== 'approved') {
        return res.status(403).json({ 
            error: 'Your account is pending administrator approval.',
            status: req.user ? req.user.status : 'unauthenticated'
        });
    }
    next();
};

// Require specific granular permission (Admins automatically pass; Free editing window honored for account management)
const requirePermission = (permissionKey) => {
    return async (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        
        // Administrator has all permissions
        if (req.user.role === 'admin' && req.user.email === ADMIN_EMAIL) {
            return next();
        }

        // Must be approved
        if (req.user.status !== 'approved') {
            return res.status(403).json({ error: 'Account pending approval' });
        }

        // Check assigned permissions or temporary access window
        let hasPerm = (req.user.permissions && req.user.permissions.includes(permissionKey)) ||
                      (req.user.temporary_actions && req.user.temporary_actions.includes(permissionKey));

        // Check administrator-configured free editing period for add/edit/import
        if (!hasPerm && (permissionKey === 'add_accounts' || permissionKey === 'edit_accounts' || permissionKey === 'import_excel')) {
            try {
                const editStatus = await getUserEditingPeriodStatus(req.user.id);
                if ((permissionKey === 'add_accounts' || permissionKey === 'import_excel') && editStatus.canAdd) {
                    hasPerm = true;
                } else if (permissionKey === 'edit_accounts' && editStatus.canEdit) {
                    hasPerm = true;
                }
            } catch (e) {}
        }

        if (!hasPerm) {
            return res.status(403).json({ 
                error: `Permission '${permissionKey}' required. Your free editing window may have expired. Please submit an access request to the administrator.`,
                code: 'PERMISSION_DENIED',
                permission: permissionKey
            });
        }

        next();
    };
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireApproved,
    requirePermission,
    JWT_SECRET
};
