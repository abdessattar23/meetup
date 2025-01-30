const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.static(__dirname));

// Create HTTP server
const server = http.createServer(app);

// Socket.IO with optimized settings
const io = new Server(server, {
    pingTimeout: 30000,
    pingInterval: 5000,
    transports: ['websocket'],
    perMessageDeflate: false,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Room management with improved data structure
const rooms = new Map();

// Generate a secure room ID
function generateRoomId() {
    // Generate 16 bytes of random data and convert to hex
    return crypto.randomBytes(16).toString('hex').substring(0, 12);
}

// Debug function to log room state
function logRoomState(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        console.log(`Room ${roomId} state:`, {
            userCount: room.users.size,
            users: Array.from(room.users.entries()).map(([id, user]) => ({
                id,
                isInitiator: user.isInitiator
            }))
        });
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', (roomId) => {
        // Generate new room ID if none provided, ensure it's unique
        let targetRoom = roomId;
        if (!targetRoom) {
            do {
                targetRoom = generateRoomId();
            } while (rooms.has(targetRoom));
        }

        console.log(`User ${socket.id} attempting to join room ${targetRoom}`);

        // Get or create room with proper initialization
        let room = rooms.get(targetRoom);
        if (!room) {
            room = {
                users: new Map(),
                videoUrl: null,
                playbackState: null,
                createdAt: Date.now()
            };
            rooms.set(targetRoom, room);
            console.log(`Created new room ${targetRoom}`);
        }

        // Check room capacity
        if (room.users.size >= 2) {
            console.log(`Room ${targetRoom} is full, rejecting user ${socket.id}`);
            socket.emit('room-full');
            return;
        }

        // Leave any existing rooms first
        for (const [id, r] of rooms) {
            if (r.users.has(socket.id)) {
                r.users.delete(socket.id);
                socket.leave(id);
                socket.to(id).emit('partner-left');
                if (r.users.size === 0) {
                    console.log(`Removing empty room ${id}`);
                    rooms.delete(id);
                }
            }
        }

        // Join the room
        socket.join(targetRoom);
        const isFirstUser = room.users.size === 0;
        room.users.set(socket.id, {
            joinedAt: Date.now(),
            isInitiator: !isFirstUser // Second user is initiator
        });

        console.log(`User ${socket.id} joined room ${targetRoom} as ${isFirstUser ? 'first' : 'second'} user`);
        logRoomState(targetRoom);

        // Notify the joining user
        socket.emit('room-joined', {
            roomId: targetRoom,
            isInitiator: !isFirstUser,
            videoUrl: room.videoUrl,
            playbackState: room.playbackState
        });

        // If this is the second user, notify both users
        if (!isFirstUser) {
            const users = Array.from(room.users.entries());
            const [firstUser] = users;
            
            // Notify first user about second user joining
            socket.to(targetRoom).emit('partner-joined', {
                isInitiator: false
            });
        }
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        if (!data || !data.roomId) {
            console.warn('Invalid signal data received');
            return;
        }

        const room = rooms.get(data.roomId);
        if (!room) {
            console.warn(`Room ${data.roomId} not found for signal`);
            return;
        }

        if (!room.users.has(socket.id)) {
            console.warn(`User ${socket.id} not in room ${data.roomId}`);
            return;
        }

        // Find the other user in the room
        const otherUser = Array.from(room.users.keys()).find(id => id !== socket.id);
        if (otherUser) {
            console.log(`Forwarding ${data.type} signal from ${socket.id} to ${otherUser}`);
            socket.to(otherUser).emit('signal', data);
        }
    });

    socket.on('video-url', (url) => {
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.videoUrl = url;
                socket.to(roomId).emit('video-url', url);
                break;
            }
        }
    });

    socket.on('playback-state', (state) => {
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.playbackState = state;
                socket.to(roomId).emit('playback-state', state);
                break;
            }
        }
    });

    socket.on('reaction', (emoji) => {
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                socket.to(roomId).emit('reaction', emoji);
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                socket.to(roomId).emit('partner-left');
                if (room.users.size === 0) {
                    console.log(`Removing empty room ${roomId}`);
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

// Cleanup old rooms periodically
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
        // Remove rooms older than 24 hours with no users
        if (room.users.size === 0 && now - room.createdAt > 24 * 60 * 60 * 1000) {
            console.log(`Removing stale room ${roomId}`);
            rooms.delete(roomId);
        }
    }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});
