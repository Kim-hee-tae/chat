require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. 기본 설정 및 미들웨어
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.static('public')); // HTML 파일들을 public 폴더에서 찾음

const sessionMiddleware = session({
    secret: [process.env.SESSION_SECRET_CURRENT, process.env.SESSION_SECRET_PREVIOUS],
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 365
    }
});
app.use(sessionMiddleware);
io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

// post-main 게시판 상단 라우터 등록
const postRoutes = require('./routes/post_routes');
app.use('/post-api', postRoutes);

// 게시판 페이지 경로
app.get('/post-main', (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public/post_main.html'));
});


// server.js 상단 라우터 등록 부분에 추가
const postRouter = require('./routes/postRoutes');
app.use('/posts', postRouter);

// 페이지 이동 경로 추가
app.get('/post-list', checkLogin, (req, res) => res.sendFile(path.join(__dirname, 'public/post_list.html')));
app.get('/post-write', checkLogin, (req, res) => res.sendFile(path.join(__dirname, 'public/post_write.html')));


// 2. 라우터 연결
const authRouter = require('./routes/authRoutes');
app.use('/auth', authRouter); // 모든 인증 주소 앞에 /auth가 붙습니다.

// 3. 페이지 이동 및 미들웨어
function checkLogin(req, res, next) {
    if (req.session.isLoggedIn) next();
    else res.send('<script>alert("로그인이 필요합니다."); location.href="/";</script>');
}

app.get('/', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/board');
    res.sendFile(path.join(__dirname, 'public/login.html'));
});
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/board', checkLogin, (req, res) => res.sendFile(path.join(__dirname, 'public/board.html')));
app.get('/chat/:roomId', checkLogin, (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));

// 파일 업로드 설정
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'uploads/'),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
    })
});
app.post('/upload', upload.single('file'), (req, res) => {
    res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// 4. 실시간 소켓 로직 (추후 이 부분도 분리 가능)
let rooms = [];
let roomCounter = 1;

io.on('connection', (socket) => {
    const session = socket.request.session;
    socket.emit('updateRooms', rooms, session.username);

    socket.on('createRoom', (roomPwd) => {
        const newRoom = { id: roomCounter++, name: `${roomCounter-1}번방`, owner: session.username, password: roomPwd };
        rooms.push(newRoom);
        io.emit('updateRooms', rooms, "");
    });

    socket.on('checkRoomPassword', (data) => {
        const room = rooms.find(r => r.id == data.roomId);
        if (room && room.password === data.password) socket.emit('passwordMatch', { roomId: data.roomId });
        else socket.emit('alert', '비밀번호가 틀렸습니다.');
    });

    socket.on('deleteRoom', (roomId) => {
        const index = rooms.findIndex(r => r.id == roomId);
        if (index !== -1 && rooms[index].owner === session.username) {
            io.to(roomId).emit('roomDeleted');
            rooms.splice(index, 1);
            io.emit('updateRooms', rooms, "");
        }
    });

    socket.on('joinRoom', (roomId) => {
        if (rooms.find(r => r.id == roomId)) socket.join(roomId);
        else socket.emit('goBackToBoard');
    });

    socket.on('sendMessage', (data) => {
        if (rooms.find(r => r.id == data.roomId)) io.to(data.roomId).emit('receiveMessage', { user: session.nickname, ...data });
    });
});


server.listen(3003, () => console.log('Server running on http://0.0.0.0:3003'));
