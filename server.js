const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Store room data
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  let currentRoom = null;

  // Create or join room
  socket.on("join-room", (roomId) => {
    console.log(`User ${socket.id} attempting to join room ${roomId}`);

    // Generate new room ID if none provided
    if (!roomId) {
      roomId = uuidv4();
    }

    // If user is already in this room, ignore
    if (currentRoom === roomId) {
      console.log(`User ${socket.id} is already in room ${roomId}`);
      return;
    }

    // Leave current room if in one
    if (currentRoom) {
      const oldRoom = rooms.get(currentRoom);
      if (oldRoom) {
        console.log(`User ${socket.id} leaving room ${currentRoom}`);
        oldRoom.users.delete(socket.id);
        socket.leave(currentRoom);
        socket.to(currentRoom).emit("partner-left");

        if (oldRoom.users.size === 0) {
          console.log(`Removing empty room ${currentRoom}`);
          rooms.delete(currentRoom);
        }
      }
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      console.log(`Creating new room ${roomId}`);
      rooms.set(roomId, {
        users: new Map(),
        videoUrl: null,
        playbackState: {
          isPlaying: false,
          currentTime: 0,
        },
      });
    }

    const room = rooms.get(roomId);

    // Check if room is full (max 2 users)
    if (room.users.size >= 2) {
      console.log(`Room ${roomId} is full`);
      socket.emit("room-full");
      return;
    }

    // Join room
    currentRoom = roomId;
    socket.join(roomId);

    // Add user to room
    const isFirstUser = room.users.size === 0;
    room.users.set(socket.id, {
      joinTime: Date.now(),
      isInitiator: !isFirstUser, // Second user is initiator
    });

    console.log(`User ${socket.id} joined room ${roomId}`);
    console.log(`Room ${roomId} now has ${room.users.size} users`);

    // Send room state to new user
    socket.emit("room-joined", {
      roomId,
      videoUrl: room.videoUrl,
      playbackState: room.playbackState,
      isInitiator: room.users.get(socket.id).isInitiator,
    });

    // If this is the second user, notify both users
    if (room.users.size === 2) {
      const users = Array.from(room.users.entries());
      const [firstUser, secondUser] = users;

      // Notify first user about second user joining
      socket.to(firstUser[0]).emit("partner-joined", {
        isInitiator: firstUser[1].isInitiator,
      });

      // Notify second user (current user)
      socket.emit("partner-joined", {
        isInitiator: secondUser[1].isInitiator,
      });
    }
  });

  // Handle WebRTC signaling
  socket.on("signal", (data) => {
    if (!currentRoom) {
      console.log("No current room for signal");
      return;
    }

    const room = rooms.get(currentRoom);
    if (!room) {
      console.log("Room not found for signal");
      return;
    }

    console.log(`Signal received from ${socket.id}:`, data.type);

    // Find the other user in the room
    const otherUser = Array.from(room.users.keys()).find(
      (id) => id !== socket.id
    );
    if (otherUser) {
      console.log(`Forwarding ${data.type} signal to ${otherUser}`);
      socket.to(otherUser).emit("signal", data);
    } else {
      console.log("No other users in room to forward signal to");
    }
  });

  // Handle video sync events
  socket.on("video-url", (url) => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.videoUrl = url;
        socket.to(currentRoom).emit("video-url", url);
      }
    }
  });

  socket.on("playback-state", (state) => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.playbackState = state;
        socket.to(currentRoom).emit("playback-state", state);
      }
    }
  });

  socket.on("reaction", (emoji) => {
    if (currentRoom) {
      socket.to(currentRoom).emit("reaction", emoji);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User ${socket.id} disconnected`);
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(socket.id);
        socket.to(currentRoom).emit("partner-left");

        if (room.users.size === 0) {
          console.log(`Removing empty room ${currentRoom}`);
          rooms.delete(currentRoom);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
