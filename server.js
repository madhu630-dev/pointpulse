const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const rewardRoutes = require('./routes/rewards');
const whatsappRoutes = require('./routes/whatsapp');

const accountController = require('./controllers/accountController');
const rewardController = require('./controllers/rewardController');
const whatsappController = require('./controllers/whatsappController');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io Connection Logic
io.on('connection', (socket) => {
    // Clients will emit 'join' with their admin_id so we can send isolated notifications
    socket.on('join', (adminId) => {
        if (adminId) {
            socket.join(adminId.toString());
            console.log(`Socket joined admin room: ${adminId}`);
        }
    });
});

// Inject IO into controllers
accountController.setIo(io);
rewardController.setIo(io);
whatsappController.setIo(io);

// Use modular routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/accounts', rewardRoutes); // Mapped to the same prefix for /:id/redeem
app.use('/api/whatsapp', whatsappRoutes);

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
