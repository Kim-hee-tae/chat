const socket = io();

const screenNickname = document.getElementById('screenNickname');
const screenLobby = document.getElementById('screenLobby');
const screenChat = document.getElementById('screenChat');

const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNicknameBtn');
const currentNicknameLabel = document.getElementById('currentNicknameLabel');
const changeNicknameBtn = document.getElementById('changeNicknameBtn');

const createRoomName = document.getElementById('createRoomName');
const createRoomPassword = document.getElementById('createRoomPassword');
const createRoomBtn = document.getElementById('createRoomBtn');
const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
const roomList = document.getElementById('roomList');

const chatRoomTitle = document.getElementById('chatRoomTitle');
const chatRoomMeta = document.getElementById('chatRoomMeta');
const userListText = document.getElementById('userListText');
const chatMessages = document.getElementById('chatMessages');

const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const copyChatBtn = document.getElementById('copyChatBtn');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const fileInput = document.getElementById('fileInput');
const sendFileBtn = document.getElementById('sendFileBtn');

let nickname = localStorage.getItem('chatNickname') || '';
let currentRoom = null;
let currentRoomPassword = '';

function showScreen(screenEl) {
  [screenNickname, screenLobby, screenChat].forEach((el) => {
    el.classList.remove('active');
  });
  screenEl.classList.add('active');
}

function updateNicknameLabel() {
  currentNicknameLabel.textContent = nickname ? `닉네임: ${nickname}` : '닉네임 미설정';
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 전체 채팅 복사용
function buildMessageText(message) {
  const time = formatTime(message.createdAt);

  if (message.type === 'system') {
    return `[${time}] [SYSTEM] ${message.text || ''}`;
  }

  if (message.type === 'file') {
    return `[${time}] ${message.sender}: [파일] ${message.fileName || message.text || ''} ${message.fileUrl || ''}`;
  }

  return `[${time}] ${message.sender}: ${message.text || ''}`;
}

// 개별 메시지 복사용: 내용만 복사
function buildSingleCopyText(message) {
  if (message.type === 'system') {
    return message.text || '';
  }

  if (message.type === 'file') {
    return message.fileName || message.text || '';
  }

  return message.text || '';
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert('복사되었습니다.');
  } catch (error) {
    console.error(error);

    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      alert('복사되었습니다.');
    } catch (copyError) {
      console.error(copyError);
      alert('복사에 실패했습니다.');
    }

    document.body.removeChild(textarea);
  }
}

function renderMessage(message) {
  const wrap = document.createElement('div');
  const isMe = currentRoom && message.sender === nickname;
  const typeClass = message.type === 'system' ? 'system' : isMe ? 'me' : 'other';

  wrap.className = `message ${typeClass}`;

  const senderHtml =
    message.type !== 'system'
      ? `<div class="sender">${escapeHtml(message.sender)}</div>`
      : '';

  let bodyHtml = '';

  if (message.type === 'file') {
    bodyHtml = `
      <div>${escapeHtml(message.text || message.fileName || '파일')}</div>
      <a class="file-link" href="${message.fileUrl}" target="_blank" download>
        파일 다운로드
      </a>
    `;
  } else {
    bodyHtml = `<div>${escapeHtml(message.text || '')}</div>`;
  }

  wrap.innerHTML = `
    ${senderHtml}
    <div class="bubble">
      ${bodyHtml}
      <div class="time">${formatTime(message.createdAt)}</div>
      <button type="button" class="message-copy-btn">복사</button>
    </div>
  `;

  const copyBtn = wrap.querySelector('.message-copy-btn');
  copyBtn.addEventListener('click', () => {
    copyToClipboard(buildSingleCopyText(message));
  });

  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderMessages(messages) {
  chatMessages.innerHTML = '';
  messages.forEach(renderMessage);
}

function renderRoomInfo(room) {
  currentRoom = room;
  chatRoomTitle.textContent = room.name;
  chatRoomMeta.textContent = `참여자 ${room.userCount}명`;
  userListText.textContent = room.users.join(', ') || '-';
}

function renderRoomList(rooms) {
  roomList.innerHTML = '';

  if (!rooms.length) {
    roomList.innerHTML = `<div class="muted">현재 생성된 방이 없습니다.</div>`;
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement('div');
    item.className = 'room-item';

    item.innerHTML = `
      <div class="room-item-top">
        <div class="room-name">${escapeHtml(room.name)}</div>
        <div class="muted">${room.userCount}명</div>
      </div>
      <div class="room-meta">
        비밀번호 방 / 입장 전 비밀번호 입력 필요
      </div>
      <div class="room-password-inline">
        <input type="password" class="input room-password-input" placeholder="비밀번호 입력" />
        <button class="btn primary room-join-btn">입장</button>
      </div>
    `;

    const passwordInput = item.querySelector('.room-password-input');
    const joinBtn = item.querySelector('.room-join-btn');

    joinBtn.addEventListener('click', async () => {
      const password = passwordInput.value.trim();

      if (!nickname) {
        alert('닉네임을 먼저 설정하세요.');
        showScreen(screenNickname);
        return;
      }

      if (!password) {
        alert('방 비밀번호를 입력하세요.');
        passwordInput.focus();
        return;
      }

      try {
        const res = await fetch('/api/rooms/join-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: room.id,
            password,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          alert(data.message || '입장할 수 없습니다.');
          return;
        }

        enterRoom(room.id, password);
      } catch (error) {
        console.error(error);
        alert('방 입장 중 오류가 발생했습니다.');
      }
    });

    roomList.appendChild(item);
  });
}

async function fetchRoomList() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    if (data.ok) {
      renderRoomList(data.rooms);
    }
  } catch (error) {
    console.error(error);
  }
}

function enterRoom(roomId, password) {
  socket.emit(
    'joinRoom',
    {
      roomId,
      password,
      nickname,
    },
    (response) => {
      if (!response?.ok) {
        alert(response?.message || '방 입장 실패');
        return;
      }

      currentRoomPassword = password;
      renderRoomInfo({
        ...response.room,
        messages: [...response.room.messages],
      });
      renderMessages(response.room.messages);
      showScreen(screenChat);
      messageInput.focus();
    }
  );
}

saveNicknameBtn.addEventListener('click', () => {
  const value = nicknameInput.value.trim();

  if (!value) {
    alert('닉네임을 입력하세요.');
    nicknameInput.focus();
    return;
  }

  nickname = value;
  localStorage.setItem('chatNickname', nickname);
  updateNicknameLabel();
  fetchRoomList();
  showScreen(screenLobby);
});

changeNicknameBtn.addEventListener('click', () => {
  nicknameInput.value = nickname;
  showScreen(screenNickname);
  nicknameInput.focus();
});

createRoomBtn.addEventListener('click', async () => {
  const roomName = createRoomName.value.trim();
  const password = createRoomPassword.value.trim();

  if (!nickname) {
    alert('닉네임을 먼저 설정하세요.');
    showScreen(screenNickname);
    return;
  }

  if (!roomName) {
    alert('방 이름을 입력하세요.');
    createRoomName.focus();
    return;
  }

  if (!password) {
    alert('방 비밀번호를 입력하세요.');
    createRoomPassword.focus();
    return;
  }

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, roomName, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '방 생성 실패');
      return;
    }

    createRoomName.value = '';
    createRoomPassword.value = '';

    enterRoom(data.room.id, password);
  } catch (error) {
    console.error(error);
    alert('방 생성 중 오류가 발생했습니다.');
  }
});

refreshRoomsBtn.addEventListener('click', fetchRoomList);

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  socket.emit('sendMessage', { text }, (response) => {
    if (!response?.ok) {
      alert(response?.message || '메시지 전송 실패');
      return;
    }
    messageInput.value = '';
    messageInput.focus();
  });
});

sendFileBtn.addEventListener('click', async () => {
  if (!currentRoom) {
    alert('방에 먼저 입장하세요.');
    return;
  }

  const file = fileInput.files[0];
  if (!file) {
    alert('파일을 선택하세요.');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('roomId', currentRoom.id);
  formData.append('nickname', nickname);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '파일 업로드 실패');
      return;
    }

    fileInput.value = '';
  } catch (error) {
    console.error(error);
    alert('파일 업로드 중 오류가 발생했습니다.');
  }
});

leaveRoomBtn.addEventListener('click', () => {
  socket.emit('leaveRoom', () => {
    currentRoom = null;
    currentRoomPassword = '';
    chatMessages.innerHTML = '';
    fetchRoomList();
    showScreen(screenLobby);
  });
});

copyChatBtn.addEventListener('click', async () => {
  if (!currentRoom || !currentRoom.messages || !currentRoom.messages.length) {
    alert('복사할 채팅 내용이 없습니다.');
    return;
  }

  const text = currentRoom.messages.map(buildMessageText).join('\n');
  await copyToClipboard(text);
});

socket.on('roomList', (rooms) => {
  if (!currentRoom) {
    renderRoomList(rooms);
  } else {
    const stillExists = rooms.some((room) => room.id === currentRoom.id);
    if (!stillExists) {
      alert('방이 종료되었습니다.');
      currentRoom = null;
      currentRoomPassword = '';
      chatMessages.innerHTML = '';
      showScreen(screenLobby);
      renderRoomList(rooms);
    }
  }
});

socket.on('roomInfo', (room) => {
  if (currentRoom && room.id === currentRoom.id) {
    const existingMessages = Array.isArray(currentRoom.messages) ? currentRoom.messages : [];
    currentRoom = {
      ...room,
      messages: existingMessages,
    };
    renderRoomInfo(currentRoom);
  }
});

socket.on('newMessage', (message) => {
  if (!currentRoom) return;

  if (!Array.isArray(currentRoom.messages)) {
    currentRoom.messages = [];
  }

  currentRoom.messages.push(message);
  renderMessage(message);
});

window.addEventListener('load', () => {
  updateNicknameLabel();

  if (nickname) {
    nicknameInput.value = nickname;
    fetchRoomList();
    showScreen(screenLobby);
  } else {
    showScreen(screenNickname);
  }
});