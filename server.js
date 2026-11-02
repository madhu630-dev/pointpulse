require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Database initialization
require('./db/database');

// Import modular routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const accountRoutes = require('./routes/accounts');
const rewardRoutes = require('./routes/rewards');
const requestRoutes = require('./routes/requests');
const formRoutes = require('./routes/forms');
const downloadRoutes = require('./routes/downloads');

// Import controllers for socket.io injection
const adminController = require('./controllers/adminController');
const accountController = require('./controllers/accountController');
const rewardController = require('./controllers/rewardController');
const requestController = require('./controllers/requestController');
const formController = require('./controllers/formController');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io Connection & Room Logic
io.on('connection', (socket) => {
    socket.on('join_room', (room) => {
        if (room) {
            socket.join(room.toString());
        }
    });
});

// Inject IO into controllers
adminController.setIo(io);
accountController.setIo(io);
rewardController.setIo(io);
requestController.setIo(io);
formController.setIo(io);

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/downloads', downloadRoutes);

// Catch-all fallback for single-page application
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: 'Internal server error occurred' });
});

if (require.main === module) {
    server.listen(port, () => {
        console.log(`PointPulse Platform running at http://localhost:${port}`);
    });
}

module.exports = { app, server };
