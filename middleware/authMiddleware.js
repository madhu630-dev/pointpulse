const jwt = require('jsonwebtoken');
const JWT_SECRET = 'supersecret_pointpulse_key_for_demo';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user; // Contains admin_id, email, role
        next();
    });
};

const requireAdmin = (req, res, next) => {
    // Default to admin if role is missing (for backward compatibility with old JWT tokens)
    const role = req.user.role || 'admin';
    if (role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

module.exports = {
    authenticateToken,
    requireAdmin,
    JWT_SECRET
};
