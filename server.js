const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * rooms 구조
 * {
 *   [roomId]: {
 *     id: string,
 *     name: string,
 *     password: string,
 *     createdAt: number,
 *     users: Map<socketId, { nickname: string }>,
 *     messages: Array<message>,
 *     files: string[] // 업로드된 실제 파일 경로 목록
 *   }
 * }
 */
const rooms = {};

/**
 * socketId -> { roomId, nickname }
 */
const socketState = new Map();

function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function generateRoomId() {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLobbyRoomList() {
  return Object.values(rooms)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((room) => ({
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      createdAt: room.createdAt,
      hasPassword: !!room.password,
    }));
}

function broadcastLobby() {
  io.emit('roomList', getLobbyRoomList());
}

function getRoomPublicInfo(room) {
  return {
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    users: Array.from(room.users.values()).map((u) => u.nickname),
    messages: room.messages,
  };
}

async function deleteFolderRecursive(targetPath) {
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.error('폴더 삭제 실패:', error);
  }
}

async function deleteRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const roomUploadDir = path.join(UPLOADS_DIR, roomId);
  await deleteFolderRecursive(roomUploadDir);

  delete rooms[roomId];
  broadcastLobby();
}

function canJoinRoom(roomId, password) {
  const room = rooms[roomId];
  if (!room) {
    return { ok: false, message: '존재하지 않는 방입니다.' };
  }

  if (room.password !== password) {
    return { ok: false, message: '비밀번호가 올바르지 않습니다.' };
  }

  return { ok: true, room };
}

function ensureRoomDir(roomId) {
  const dir = path.join(UPLOADS_DIR, roomId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomId = sanitizeText(req.body.roomId);
    const room = rooms[roomId];

    if (!room) {
      return cb(new Error('존재하지 않는 방입니다.'));
    }

    const roomDir = ensureRoomDir(roomId);
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname || 'file';
    const safeName = originalName.replace(/[^\w.\-가-힣]/g, '_');
    const finalName = `${Date.now()}_${safeName}`;
    cb(null, finalName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

app.get('/api/rooms', (req, res) => {
  res.json({
    ok: true,
    rooms: getLobbyRoomList(),
  });
});

app.post('/api/rooms', (req, res) => {
  const nickname = sanitizeText(req.body.nickname);
  const roomName = sanitizeText(req.body.roomName);
  const password = sanitizeText(req.body.password);

  if (!nickname) {
    return res.status(400).json({ ok: false, message: '닉네임을 입력하세요.' });
  }

  if (!roomName) {
    return res.status(400).json({ ok: false, message: '방 이름을 입력하세요.' });
  }

  if (!password) {
    return res.status(400).json({ ok: false, message: '방 비밀번호를 입력하세요.' });
  }

  const roomId = generateRoomId();

  rooms[roomId] = {
    id: roomId,
    name: roomName,
    password,
    createdAt: Date.now(),
    users: new Map(),
    messages: [
      {
        id: `msg_${Date.now()}`,
        type: 'system',
        sender: 'SYSTEM',
        text: `"${roomName}" 방이 생성되었습니다.`,
        createdAt: Date.now(),
      },
    ],
    files: [],
  };

  broadcastLobby();

  return res.json({
    ok: true,
    room: {
      id: roomId,
      name: roomName,
      hasPassword: true,
    },
  });
});

app.post('/api/rooms/join-check', (req, res) => {
  const roomId = sanitizeText(req.body.roomId);
  const password = sanitizeText(req.body.password);

  const result = canJoinRoom(roomId, password);

  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.json({
    ok: true,
    room: {
      id: result.room.id,
      name: result.room.name,
    },
  });
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        ok: false,
        message: error.message || '파일 업로드에 실패했습니다.',
      });
    }

    const roomId = sanitizeText(req.body.roomId);
    const nickname = sanitizeText(req.body.nickname);
    const room = rooms[roomId];

    if (!room) {
      return res.status(400).json({ ok: false, message: '존재하지 않는 방입니다.' });
    }

    const isUserInRoom = Array.from(room.users.values()).some(
      (user) => user.nickname === nickname
    );

    if (!isUserInRoom) {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      return res.status(403).json({ ok: false, message: '방에 입장한 사용자만 업로드할 수 있습니다.' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, message: '파일이 없습니다.' });
    }

    const fileUrl = `/uploads/${roomId}/${req.file.filename}`;

    room.files.push(req.file.path);

    const fileMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'file',
      sender: nickname,
      text: req.file.originalname,
      fileName: req.file.originalname,
      fileUrl,
      fileSize: req.file.size,
      createdAt: Date.now(),
    };

    room.messages.push(fileMessage);
    io.to(roomId).emit('newMessage', fileMessage);

    return res.json({
      ok: true,
      message: fileMessage,
    });
  });
});

io.on('connection', (socket) => {
  socket.emit('roomList', getLobbyRoomList());

  socket.on('joinRoom', ({ roomId, password, nickname }, callback) => {
    const cleanRoomId = sanitizeText(roomId);
    const cleanPassword = sanitizeText(password);
    const cleanNickname = sanitizeText(nickname);

    if (!cleanNickname) {
      return callback?.({ ok: false, message: '닉네임이 필요합니다.' });
    }

    const result = canJoinRoom(cleanRoomId, cleanPassword);
    if (!result.ok) {
      return callback?.(result);
    }

    const room = result.room;

    socket.join(cleanRoomId);
    room.users.set(socket.id, { nickname: cleanNickname });
    socketState.set(socket.id, { roomId: cleanRoomId, nickname: cleanNickname });

    const enterMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'system',
      sender: 'SYSTEM',
      text: `${cleanNickname} 님이 입장했습니다.`,
      createdAt: Date.now(),
    };

    room.messages.push(enterMessage);

    io.to(cleanRoomId).emit('roomInfo', getRoomPublicInfo(room));
    io.to(cleanRoomId).emit('newMessage', enterMessage);
    broadcastLobby();

    return callback?.({
      ok: true,
      room: getRoomPublicInfo(room),
    });
  });

  socket.on('sendMessage', ({ text }, callback) => {
    const state = socketState.get(socket.id);
    if (!state) {
      return callback?.({ ok: false, message: '방에 입장해 주세요.' });
    }

    const room = rooms[state.roomId];
    if (!room) {
      return callback?.({ ok: false, message: '방이 존재하지 않습니다.' });
    }

    const cleanText = sanitizeText(text);
    if (!cleanText) {
      return callback?.({ ok: false, message: '메시지를 입력하세요.' });
    }

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'text',
      sender: state.nickname,
      text: cleanText,
      createdAt: Date.now(),
    };

    room.messages.push(message);
    io.to(state.roomId).emit('newMessage', message);

    return callback?.({ ok: true });
  });

  socket.on('leaveRoom', async (callback) => {
    await handleLeave(socket);
    return callback?.({ ok: true });
  });

  socket.on('disconnect', async () => {
    await handleLeave(socket);
  });
});

async function handleLeave(socket) {
  const state = socketState.get(socket.id);
  if (!state) return;

  const room = rooms[state.roomId];
  socketState.delete(socket.id);

  if (!room) return;

  room.users.delete(socket.id);
  socket.leave(state.roomId);

  const leaveMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'system',
    sender: 'SYSTEM',
    text: `${state.nickname} 님이 퇴장했습니다.`,
    createdAt: Date.now(),
  };

  if (room.users.size > 0) {
    room.messages.push(leaveMessage);
    io.to(state.roomId).emit('newMessage', leaveMessage);
    io.to(state.roomId).emit('roomInfo', getRoomPublicInfo(room));
  } else {
    await deleteRoom(state.roomId);
    return;
  }

  broadcastLobby();
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`server running on ${PORT}`);
});