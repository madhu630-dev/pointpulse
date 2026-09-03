const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../db/supabase');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const register = async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const userRole = role === 'viewer' ? 'viewer' : 'admin';

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const { data, error } = await supabase
            .from('AdminUsers')
            .insert([{ email, password: hashedPassword, role: userRole }]);

        if (error) {
            if (error.code === '23505') { // Postgres unique constraint error code
                return res.status(400).json({ error: 'Email already exists' });
            }
            throw error;
        }

        res.json({ message: 'Registration successful' });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: 'Error registering user' });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    try {
        const { data: admin, error } = await supabase
            .from('AdminUsers')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ admin_id: admin.id, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, email: admin.email, role: admin.role });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: 'Error logging in' });
    }
};

module.exports = {
    register,
    login
};
