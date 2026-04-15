const express = require('express');
const path = require('path');

const app = express();

// 정적 파일 폴더가 있으면 사용
app.use(express.static(path.join(__dirname, 'public')));

// 기본 테스트용 라우트
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Node.js 서버 정상 동작' });
});

// public/index.html 이 있으면 그 파일이 열리고,
// 없으면 아래 문구가 보이게 처리
app.get('/', (req, res) => {
  res.send('Node.js 서버 정상 동작');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`server running on ${PORT}`);
});