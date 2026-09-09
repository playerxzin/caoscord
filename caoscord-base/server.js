const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-esta-chave-em-producao-caoscord';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

function blankData() {
  return { users: [], servers: [], channels: [], messages: [], dms: [], dmMessages: [] };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return blankData();
    return { ...blankData(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    console.error('Falha ao ler data.json:', e);
    return blankData();
  }
}

let db = loadData();
let saveTimer;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error('Falha ao salvar data.json:', e);
    }
  }, 80);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function sign(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) throw new Error('Usuário não encontrado');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
}

function ensureDefaultServer(userId) {
  let server = db.servers.find(s => s.slug === 'caos-cord');
  if (!server) {
    server = {
      id: id(), slug: 'caos-cord', name: 'Caos Cord', icon: 'C', ownerId: userId,
      members: [userId], createdAt: now()
    };
    db.servers.push(server);
    db.channels.push(
      { id: id(), serverId: server.id, name: 'geral', type: 'text', position: 0 },
      { id: id(), serverId: server.id, name: 'memes', type: 'text', position: 1 },
      { id: id(), serverId: server.id, name: 'Geral', type: 'voice', position: 2 }
    );
  } else if (!server.members.includes(userId)) {
    server.members.push(userId);
  }
  saveData();
  return server;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'caoscord', time: now() }));

app.post('/api/auth/register', async (req, res) => {
  let { username, password, displayName } = req.body || {};
  username = String(username || '').trim().toLowerCase();
  displayName = String(displayName || username).trim();
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
    return res.status(400).json({ error: 'Usuário: 3 a 24 caracteres (letras, números, _ ou .).' });
  }
  if (String(password || '').length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (db.users.some(u => u.username === username)) return res.status(409).json({ error: 'Esse usuário já existe.' });
  const user = {
    id: id(), username, displayName: displayName.slice(0, 32),
    passwordHash: await bcrypt.hash(String(password), 10),
    bio: '', avatar: '', banner: '', verified: db.users.length === 0,
    createdAt: now(), usernameChangedAt: now(), status: 'online'
  };
  db.users.push(user);
  ensureDefaultServer(user.id);
  saveData();
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const user = db.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.passwordHash))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  ensureDefaultServer(user.id);
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

app.patch('/api/me', auth, (req, res) => {
  const { displayName, bio, avatar, banner, username } = req.body || {};
  if (displayName !== undefined) req.user.displayName = String(displayName).trim().slice(0, 32) || req.user.displayName;
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 190);
  if (avatar !== undefined) req.user.avatar = String(avatar).slice(0, 1200);
  if (banner !== undefined) req.user.banner = String(banner).slice(0, 1200);
  if (username && username !== req.user.username) {
    const last = new Date(req.user.usernameChangedAt || 0).getTime();
    if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) {
      return res.status(429).json({ error: 'O nome de usuário só pode ser alterado uma vez a cada 7 dias.' });
    }
    const next = String(username).trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(next)) return res.status(400).json({ error: 'Nome de usuário inválido.' });
    if (db.users.some(u => u.username === next && u.id !== req.user.id)) return res.status(409).json({ error: 'Nome de usuário já em uso.' });
    req.user.username = next;
    req.user.usernameChangedAt = now();
  }
  saveData();
  io.emit('user:updated', publicUser(req.user));
  res.json(publicUser(req.user));
});

app.get('/api/bootstrap', auth, (req, res) => {
  ensureDefaultServer(req.user.id);
  const servers = db.servers.filter(s => s.members.includes(req.user.id));
  const serverIds = new Set(servers.map(s => s.id));
  const channels = db.channels.filter(c => serverIds.has(c.serverId));
  const dms = db.dms.filter(d => d.members.includes(req.user.id)).map(d => ({
    ...d, users: d.members.map(uid => publicUser(db.users.find(u => u.id === uid))).filter(Boolean)
  }));
  res.json({
    me: publicUser(req.user),
    users: db.users.map(publicUser),
    servers,
    channels,
    dms
  });
});

app.post('/api/servers', auth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 48);
  if (!name) return res.status(400).json({ error: 'Informe o nome do servidor.' });
  const s = { id: id(), name, slug: '', icon: name[0]?.toUpperCase() || 'C', ownerId: req.user.id, members: [req.user.id], createdAt: now() };
  db.servers.push(s);
  db.channels.push(
    { id: id(), serverId: s.id, name: 'geral', type: 'text', position: 0 },
    { id: id(), serverId: s.id, name: 'Geral', type: 'voice', position: 1 }
  );
  saveData();
  res.json(s);
});

app.post('/api/servers/:serverId/channels', auth, (req, res) => {
  const s = db.servers.find(x => x.id === req.params.serverId && x.members.includes(req.user.id));
  if (!s) return res.status(404).json({ error: 'Servidor não encontrado.' });
  if (s.ownerId !== req.user.id) return res.status(403).json({ error: 'Somente o dono pode criar canais nesta versão.' });
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const type = req.body?.type === 'voice' ? 'voice' : 'text';
  if (!name) return res.status(400).json({ error: 'Informe o nome do canal.' });
  const c = { id: id(), serverId: s.id, name, type, position: db.channels.filter(x => x.serverId === s.id).length };
  db.channels.push(c); saveData(); res.json(c);
});

app.get('/api/channels/:channelId/messages', auth, (req, res) => {
  const c = db.channels.find(x => x.id === req.params.channelId);
  const s = c && db.servers.find(x => x.id === c.serverId && x.members.includes(req.user.id));
  if (!c || !s) return res.status(404).json({ error: 'Canal não encontrado.' });
  const messages = db.messages.filter(m => m.channelId === c.id).slice(-150).map(m => ({ ...m, author: publicUser(db.users.find(u => u.id === m.authorId)) }));
  res.json(messages);
});

app.post('/api/dms', auth, (req, res) => {
  const targetId = String(req.body?.userId || '');
  if (!db.users.some(u => u.id === targetId) || targetId === req.user.id) return res.status(400).json({ error: 'Usuário inválido.' });
  let dm = db.dms.find(d => d.members.length === 2 && d.members.includes(req.user.id) && d.members.includes(targetId));
  if (!dm) { dm = { id: id(), members: [req.user.id, targetId], createdAt: now() }; db.dms.push(dm); saveData(); }
  res.json({ ...dm, users: dm.members.map(uid => publicUser(db.users.find(u => u.id === uid))) });
});

app.get('/api/dms/:dmId/messages', auth, (req, res) => {
  const dm = db.dms.find(d => d.id === req.params.dmId && d.members.includes(req.user.id));
  if (!dm) return res.status(404).json({ error: 'Conversa não encontrada.' });
  res.json(db.dmMessages.filter(m => m.dmId === dm.id).slice(-150).map(m => ({ ...m, author: publicUser(db.users.find(u => u.id === m.authorId)) })));
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const voiceRooms = new Map();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) throw new Error('user');
    socket.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', socket => {
  const uid = socket.user.id;
  const messageRate = { hits: [], blockedUntil: 0 };
  function checkMessageRate() {
    const t = Date.now();
    if (messageRate.blockedUntil > t) return { limited: true, retryAfterMs: messageRate.blockedUntil - t };
    messageRate.hits = messageRate.hits.filter(ts => t - ts < 5000);
    if (messageRate.hits.length >= 5) {
      messageRate.blockedUntil = t + 5000;
      messageRate.hits = [];
      const data = { retryAfterMs: 5000 };
      socket.emit('rate:limited', data);
      return { limited: true, ...data };
    }
    messageRate.hits.push(t);
    return { limited: false };
  }
  socket.join(`user:${uid}`);
  socket.broadcast.emit('presence', { userId: uid, status: 'online' });

  socket.on('join:channel', channelId => {
    const c = db.channels.find(x => x.id === channelId);
    const s = c && db.servers.find(x => x.id === c.serverId && x.members.includes(uid));
    if (c && s) socket.join(`channel:${channelId}`);
  });

  socket.on('chat:send', ({ channelId, content }, ack = () => {}) => {
    const rate = checkMessageRate();
    if (rate.limited) return ack({ ok: false, rateLimited: true, retryAfterMs: rate.retryAfterMs });
    const c = db.channels.find(x => x.id === channelId && x.type === 'text');
    const s = c && db.servers.find(x => x.id === c.serverId && x.members.includes(uid));
    content = String(content || '').trim().slice(0, 4000);
    if (!c || !s || !content) return ack({ ok: false });
    const m = { id: id(), channelId, authorId: uid, content, createdAt: now(), editedAt: null };
    db.messages.push(m); saveData();
    io.to(`channel:${channelId}`).emit('chat:new', { ...m, author: publicUser(socket.user) });
    ack({ ok: true, id: m.id });
  });

  socket.on('chat:edit', ({ messageId, content }) => {
    const m = db.messages.find(x => x.id === messageId && x.authorId === uid);
    if (!m) return;
    m.content = String(content || '').trim().slice(0, 4000); m.editedAt = now(); saveData();
    io.to(`channel:${m.channelId}`).emit('chat:edited', m);
  });

  socket.on('chat:delete', ({ messageId }) => {
    const i = db.messages.findIndex(x => x.id === messageId && x.authorId === uid);
    if (i < 0) return;
    const [m] = db.messages.splice(i, 1); saveData();
    io.to(`channel:${m.channelId}`).emit('chat:deleted', { id: m.id });
  });

  socket.on('join:dm', dmId => {
    const dm = db.dms.find(d => d.id === dmId && d.members.includes(uid));
    if (dm) socket.join(`dm:${dmId}`);
  });

  socket.on('dm:send', ({ dmId, content }, ack = () => {}) => {
    const rate = checkMessageRate();
    if (rate.limited) return ack({ ok: false, rateLimited: true, retryAfterMs: rate.retryAfterMs });
    const dm = db.dms.find(d => d.id === dmId && d.members.includes(uid));
    content = String(content || '').trim().slice(0, 4000);
    if (!dm || !content) return ack({ ok: false });
    const m = { id: id(), dmId, authorId: uid, content, createdAt: now(), editedAt: null };
    db.dmMessages.push(m); saveData();
    const payload = { ...m, author: publicUser(socket.user) };
    io.to(`dm:${dmId}`).emit('dm:new', payload);
    dm.members.forEach(memberId => io.to(`user:${memberId}`).emit('dm:notify', payload));
    ack({ ok: true });
  });

  socket.on('voice:join', ({ channelId }) => {
    const c = db.channels.find(x => x.id === channelId && x.type === 'voice');
    const s = c && db.servers.find(x => x.id === c.serverId && x.members.includes(uid));
    if (!c || !s) return;
    const room = `voice:${channelId}`;
    socket.join(room);
    if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());
    const members = voiceRooms.get(channelId);
    const existing = [...members.values()];
    members.set(uid, { userId: uid, socketId: socket.id, user: publicUser(socket.user) });
    socket.data.voiceChannelId = channelId;
    socket.emit('voice:existing', existing);
    socket.to(room).emit('voice:joined', { userId: uid, socketId: socket.id, user: publicUser(socket.user) });
    io.to(room).emit('voice:members', [...members.values()]);
  });

  function leaveVoice() {
    const channelId = socket.data.voiceChannelId;
    if (!channelId || !voiceRooms.has(channelId)) return;
    const room = `voice:${channelId}`;
    const members = voiceRooms.get(channelId);
    members.delete(uid);
    socket.leave(room);
    socket.to(room).emit('voice:left', { userId: uid, socketId: socket.id });
    io.to(room).emit('voice:members', [...members.values()]);
    if (!members.size) voiceRooms.delete(channelId);
    socket.data.voiceChannelId = null;
  }

  socket.on('voice:leave', leaveVoice);
  socket.on('rtc:offer', ({ targetSocketId, sdp }) => io.to(targetSocketId).emit('rtc:offer', { fromSocketId: socket.id, fromUser: publicUser(socket.user), sdp }));
  socket.on('rtc:answer', ({ targetSocketId, sdp }) => io.to(targetSocketId).emit('rtc:answer', { fromSocketId: socket.id, sdp }));
  socket.on('rtc:ice', ({ targetSocketId, candidate }) => io.to(targetSocketId).emit('rtc:ice', { fromSocketId: socket.id, candidate }));

  socket.on('disconnect', () => {
    leaveVoice();
    socket.broadcast.emit('presence', { userId: uid, status: 'offline' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Caos Cord rodando em http://localhost:${PORT}`);
});
