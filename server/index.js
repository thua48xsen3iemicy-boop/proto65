'use strict';
// Сервер «Протокола 65»: раздаёт игру из public/ и синхронизирует участников с ведущей через Socket.IO.

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./game');
const { Store } = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const MAX_PIN_FAILS = 5;

if (!/^\d{4,12}$/.test(ADMIN_PIN)) {
  console.error('Задайте PIN ведущей: переменная окружения ADMIN_PIN, от 4 до 12 цифр.');
  process.exit(1);
}

const store = new Store(DATA_DIR).load();
const app = express();
app.disable('x-powered-by');
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

const server = http.createServer(app);
const io = new Server(server, { serveClient: true });

// ---------- состояние для клиентов ----------

function sessionInfo(s) {
  return s && { id: s.id, title: s.title, createdAt: s.createdAt, endedAt: s.endedAt, finalAt: s.finalAt };
}

function playerState(pid) {
  const s = store.active();
  const p = s && pid ? s.participants[pid] : null;
  return { now: Date.now(), session: sessionInfo(s), me: p ? game.publicParticipant(p) : null };
}

function isOnline(pid) {
  return (io.sockets.adapter.rooms.get('p:' + pid)?.size || 0) > 0;
}

function sessionDetails(s, withOnline) {
  return {
    ...sessionInfo(s),
    participants: Object.values(s.participants)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(p => ({ ...game.publicParticipant(p), online: withOnline ? isOnline(p.id) : undefined })),
  };
}

function pushPlayer(pid) {
  io.to('p:' + pid).emit('state', playerState(pid));
}

function pushAllPlayers() {
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data.role === 'player') socket.emit('state', playerState(socket.data.pid));
  }
}

let adminTimer = null;
function pushAdmins() {
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    adminTimer = null;
    const s = store.active();
    io.to('admins').emit('admin:state', { now: Date.now(), session: s ? sessionDetails(s, true) : null });
  }, 100);
}

function changed(s, pids) {
  store.save(s);
  for (const pid of pids) pushPlayer(pid);
  pushAdmins();
}

function pinMatches(pin) {
  const a = crypto.createHash('sha256').update(String(pin)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- события ----------

io.on('connection', socket => {
  const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
  const me = () => {
    const s = store.active();
    const p = s && socket.data.pid ? s.participants[socket.data.pid] : null;
    return p ? { s, p } : null;
  };
  const bind = pid => {
    if (socket.data.pid) socket.leave('p:' + socket.data.pid);
    socket.data.pid = pid;
    socket.join('p:' + pid);
  };

  // Участник: представиться при каждом подключении (в том числе после обновления страницы).
  socket.on('hello', (msg, ack) => {
    socket.data.role = 'player';
    const s = store.active();
    const pid = msg && typeof msg.participantId === 'string' ? msg.participantId : null;
    if (s && pid && s.participants[pid]) { bind(pid); pushAdmins(); }
    reply(ack, playerState(socket.data.pid));
  });

  socket.on('join', (msg, ack) => {
    const s = store.active();
    if (!s) return reply(ack, { error: 'Сеанс ещё не начат' });
    const existing = me();
    if (existing) return reply(ack, { state: playerState(existing.p.id) });
    try {
      const p = game.join(s, msg && msg.hero, Date.now());
      bind(p.id);
      changed(s, []);
      reply(ack, { state: playerState(p.id) });
    } catch (e) {
      reply(ack, { error: e.message });
    }
  });

  socket.on('ready', (msg, ack) => {
    const m = me();
    if (m && game.ready(m.p, msg && msg.stage)) changed(m.s, [m.p.id]);
    reply(ack, playerState(socket.data.pid));
  });

  socket.on('penalty', msg => {
    const m = me();
    if (m && game.penalty(m.p, msg && msg.stage, Number(msg && msg.seconds))) changed(m.s, []);
  });

  socket.on('finish', (msg, ack) => {
    const m = me();
    if (m && game.finish(m.p, msg && msg.stage, Date.now())) changed(m.s, [m.p.id]);
    reply(ack, playerState(socket.data.pid));
  });

  // Ведущая: вход по PIN, дальше — команды.
  socket.on('admin:auth', (msg, ack) => {
    if (socket.data.pinFails >= MAX_PIN_FAILS) return reply(ack, { error: 'Слишком много попыток. Обновите страницу.' });
    if (!msg || !pinMatches(msg.pin)) {
      socket.data.pinFails = (socket.data.pinFails || 0) + 1;
      return setTimeout(() => reply(ack, { error: 'Неверный PIN' }), 700);
    }
    socket.data.role = 'admin';
    socket.join('admins');
    reply(ack, { ok: true });
    pushAdmins();
  });

  const admin = (event, handler) => socket.on(event, (msg, ack) => {
    if (socket.data.role !== 'admin') return reply(ack, { error: 'Нужен PIN' });
    try { reply(ack, handler(msg || {}) || { ok: true }); }
    catch (e) { reply(ack, { error: e.message }); }
  });
  const activeSession = () => {
    const s = store.active();
    if (!s) throw new Error('Нет активного сеанса');
    return s;
  };

  admin('admin:createSession', msg => {
    if (store.active()) throw new Error('Сначала завершите текущий сеанс');
    store.add(game.createSession(msg.title, Date.now()));
    pushAllPlayers();
    pushAdmins();
  });

  admin('admin:endSession', () => {
    const s = activeSession();
    s.endedAt = Date.now();
    store.saveNow(s);
    pushAllPlayers();
    pushAdmins();
  });

  admin('admin:startStage', msg => {
    const s = activeSession();
    const started = game.startStage(s, msg.stage, Date.now());
    changed(s, started.map(p => p.id));
    return { ok: true, started: started.length };
  });

  admin('admin:stopStage', msg => {
    const s = activeSession();
    const stopped = game.stopStage(s, msg.stage, Date.now());
    changed(s, stopped.map(p => p.id));
    return { ok: true, stopped: stopped.length };
  });

  admin('admin:final', () => {
    const s = activeSession();
    s.finalAt = Date.now();
    store.save(s);
    pushAllPlayers();
    pushAdmins();
  });

  admin('admin:removeParticipant', msg => {
    const s = activeSession();
    if (!s.participants[msg.id]) throw new Error('Участник не найден');
    delete s.participants[msg.id];
    changed(s, [msg.id]);
  });

  admin('admin:sessions', () => ({
    sessions: store.list().map(s => ({ ...sessionInfo(s), count: Object.keys(s.participants).length })),
  }));

  admin('admin:session', msg => {
    const s = store.get(msg.id);
    if (!s) throw new Error('Сеанс не найден');
    return { session: sessionDetails(s, false) };
  });

  socket.on('disconnect', () => { if (socket.data.pid) pushAdmins(); });
});

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Протокол 65: http://${HOST}:${PORT}  (панель ведущей: /admin)  данные: ${DATA_DIR}`);
});
