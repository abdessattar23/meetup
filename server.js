const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.static(__dirname));

// Create HTTP server (no SSL, handled by cloud provider)
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

// Room management
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('join-room', (roomId) => {
        const targetRoom = roomId || Math.random().toString(36).substring(7);
        
        let room = rooms.get(targetRoom);
        if (!room) {
            room = { users: new Set(), videoUrl: null, playbackState: null };
            rooms.set(targetRoom, room);
        }

        if (room.users.size >= 2) {
            socket.emit('room-full');
            return;
        }

        for (const [id, r] of rooms) {
            if (r.users.has(socket.id)) {
                r.users.delete(socket.id);
                socket.leave(id);
                if (r.users.size === 0) {
                    rooms.delete(id);
                }
            }
        }

        socket.join(targetRoom);
        room.users.add(socket.id);

        socket.emit('room-joined', {
            roomId: targetRoom,
            isInitiator: room.users.size === 1,
            videoUrl: room.videoUrl,
            playbackState: room.playbackState
        });

        if (room.users.size > 1) {
            socket.to(targetRoom).emit('partner-joined', {
                isInitiator: false
            });
        }
    });

    socket.on('signal', (data) => {
        socket.to(data.roomId).emit('signal', data);
    });

    socket.on('video-url', (url) => {
        const room = findRoomBySocket(socket);
        if (room) {
            room.videoUrl = url;
            socket.to(Array.from(room.users)[0]).emit('video-url', url);
        }
    });

    let playbackUpdateTimeout;
    socket.on('playback-state', (state) => {
        const room = findRoomBySocket(socket);
        if (room) {
            clearTimeout(playbackUpdateTimeout);
            playbackUpdateTimeout = setTimeout(() => {
                room.playbackState = state;
                socket.to(Array.from(room.users)[0]).emit('playback-state', state);
            }, 100);
        }
    });

    socket.on('reaction', (emoji) => {
        const room = findRoomBySocket(socket);
        if (room) {
            socket.to(Array.from(room.users)[0]).emit('reaction', emoji);
        }
    });

    socket.on('disconnect', () => {
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                socket.to(roomId).emit('partner-left');
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

function findRoomBySocket(socket) {
    for (const [_, room] of rooms) {
        if (room.users.has(socket.id)) {
            return room;
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});
