const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Room management
const rooms = new Map(); // roomCode -> { participants: Set<socketId>, createdAt: Date }

function generateRoomCode() {
  // Generate a 6-character alphanumeric code (uppercase)
  return nanoid(6).toUpperCase().replace(/[_-]/g, 'X');
}

function getRoomInfo(roomCode) {
  return rooms.get(roomCode);
}

function cleanupEmptyRooms() {
  for (const [code, room] of rooms.entries()) {
    if (room.participants.size === 0) {
      rooms.delete(code);
    }
  }
}

// Socket.IO signaling
io.on('connection', (socket) => {
  console.log(`[Connect] ${socket.id}`);
  let currentRoom = null;

  // Create a new room
  socket.on('create-room', (callback) => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      participants: new Set([socket.id]),
      createdAt: new Date()
    });
    currentRoom = roomCode;
    socket.join(roomCode);
    console.log(`[Room Created] ${roomCode} by ${socket.id}`);
    callback({ success: true, roomCode });
  });

  // Join an existing room
  socket.on('join-room', (roomCode, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = getRoomInfo(code);

    if (!room) {
      callback({ success: false, error: 'Room not found. Check the code and try again.' });
      return;
    }

    if (room.participants.size >= 2) {
      callback({ success: false, error: 'Room is full. Only 2 people can join a room.' });
      return;
    }

    if (room.participants.has(socket.id)) {
      callback({ success: false, error: 'You are already in this room.' });
      return;
    }

    room.participants.add(socket.id);
    currentRoom = code;
    socket.join(code);

    // Notify the other participant
    socket.to(code).emit('user-joined', { userId: socket.id });

    console.log(`[Room Joined] ${code} by ${socket.id} (${room.participants.size}/2)`);
    callback({ success: true, roomCode: code });
  });

  // WebRTC Signaling: Offer
  socket.on('offer', ({ offer, to }) => {
    socket.to(to).emit('offer', { offer, from: socket.id });
  });

  // WebRTC Signaling: Answer
  socket.on('answer', ({ answer, to }) => {
    socket.to(to).emit('answer', { answer, from: socket.id });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  // Broadcast offer to room (used when we don't know the specific peer ID yet)
  socket.on('offer-to-room', ({ offer }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('offer', { offer, from: socket.id });
    }
  });

  // Broadcast answer to room
  socket.on('answer-to-room', ({ answer }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('answer', { answer, from: socket.id });
    }
  });

  // Broadcast ICE candidate to room
  socket.on('ice-candidate-to-room', ({ candidate }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('ice-candidate', { candidate, from: socket.id });
    }
  });

  // Screen sharing status
  socket.on('screen-share-started', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('peer-screen-share-started', { userId: socket.id });
    }
  });

  socket.on('screen-share-stopped', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('peer-screen-share-stopped', { userId: socket.id });
    }
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('chat-message', {
        message,
        from: socket.id,
        timestamp: Date.now()
      });
    }
  });

  // Typing indicator
  socket.on('typing', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('peer-typing');
    }
  });

  socket.on('stop-typing', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('peer-stop-typing');
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Disconnect] ${socket.id}`);
    if (currentRoom) {
      const room = getRoomInfo(currentRoom);
      if (room) {
        room.participants.delete(socket.id);
        socket.to(currentRoom).emit('user-left', { userId: socket.id });

        if (room.participants.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[Room Deleted] ${currentRoom} (empty)`);
        }
      }
    }
    cleanupEmptyRooms();
  });

  // Leave room explicitly
  socket.on('leave-room', () => {
    if (currentRoom) {
      const room = getRoomInfo(currentRoom);
      if (room) {
        room.participants.delete(socket.id);
        socket.to(currentRoom).emit('user-left', { userId: socket.id });
        socket.leave(currentRoom);

        if (room.participants.size === 0) {
          rooms.delete(currentRoom);
        }
      }
      currentRoom = null;
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎬 WatchTogether Server running on http://localhost:${PORT}\n`);
});
