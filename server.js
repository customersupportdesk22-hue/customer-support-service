const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- CONFIG ----------
const AGENT_USER = 'Customer Support';
const AGENT_PASS = 'Support7264';        // <-- CHANGE AFTER DEPLOY
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const AGENT_ROOM = 'agent-room';
// ----------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 } // 12h
}));
app.use(express.static('public'));

// ---------- AUTH ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.agent) return next();
  return res.redirect('/login.html');
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AGENT_USER && password === AGENT_PASS) {
    req.session.agent = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ agent: !!(req.session && req.session.agent) });
});

// Protect the agent console
app.get('/agent', requireAuth, (req, res) => {
  res.sendFile(__dirname + '/public/agent.html');
});

// ---------- CHAT ----------
const rooms = {};  // roomId -> { roomId, customerId, name, topic, agentId, joinedAt, messages: [] }

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // Customer starts a private chat
  socket.on('customer:join', ({ name, topic }) => {
    const roomId = 'room-' + socket.id;
    rooms[roomId] = {
      roomId,
      customerId: socket.id,
      name: (name || 'Guest').slice(0, 60),
      topic: topic || 'General',
      agentId: null,
      joinedAt: Date.now(),
      messages: []
    };
    socket.join(roomId);
    socket.emit('chat:ready', { roomId });
    io.to(AGENT_ROOM).emit('customer:new', rooms[roomId]);
    console.log('new customer:', roomId, name, topic);
  });

  // Agent joins the agent-room to receive updates
  socket.on('agent:register', () => {
    socket.join(AGENT_ROOM);
    socket.emit('customer:list', Object.values(rooms));
  });

  // Agent opens a specific customer's room
  socket.on('agent:join', ({ roomId }) => {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].agentId = socket.id;
    // send prior messages to the agent
    socket.emit('chat:history', { messages: rooms[roomId].messages });
    io.to(roomId).emit('agent:joined', { name: AGENT_USER });
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });

  // Private message — only delivered inside this room
  socket.on('chat:message', ({ roomId, text, from }) => {
    if (!rooms[roomId]) return;
    const msg = { text: String(text).slice(0, 2000), from, ts: Date.now() };
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit('chat:message', msg);
  });

  // Structured airline request (delay / refund / baggage / complaint)
  socket.on('chat:request', ({ roomId, type, payload }) => {
    if (!rooms[roomId]) return;
    const msg = {
      text: `[${type.toUpperCase()}] ${JSON.stringify(payload)}`,
      from: 'customer',
      ts: Date.now(),
      structured: { type, payload }
    };
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit('chat:message', msg);
    io.to(AGENT_ROOM).emit('customer:update', rooms[roomId]);
  });

  // End chat
  socket.on('chat:end', ({ roomId }) => {
    if (!rooms[roomId]) return;
    io.to(roomId).emit('chat:ended');
    delete rooms[roomId];
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });

  socket.on('disconnect', () => {
    for (const id in rooms) {
      if (rooms[id].customerId === socket.id) {
        delete rooms[id];
        io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Customer Support Service running on port ${PORT}`));