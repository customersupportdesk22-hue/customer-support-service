const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- CONFIG ----------
const AGENT_USER = 'Customer Support';
const AGENT_PASS = 'Support7264';        // <-- CHANGE THIS NOW
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const AGENT_ROOM = 'agent-room';
const WA_NUMBER = '254743993329';
const DB_FILE = path.join(__dirname, 'chats.json');
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
// ----------------------------

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
}));
app.use(express.static('public'));

// ---------- PERSISTENCE ----------
let savedChats = {};
try {
  if (fs.existsSync(DB_FILE)) {
    savedChats = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  }
} catch (e) { savedChats = {}; }

function persistChats() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(savedChats, null, 2));
  } catch (e) { console.error('persist error', e); }
}
setInterval(persistChats, 15000);

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

app.get('/agent', requireAuth, (req, res) => {
  res.sendFile(__dirname + '/public/agent.html');
});

// ---------- CHAT STATE ----------
const rooms = {};

// ---------- REAL ACTIVITY LOG ----------
const recentEvents = [];
const MAX_EVENTS = 20;

function logEvent(type, message) {
  const evt = { type, message, ts: Date.now() };
  recentEvents.push(evt);
  if (recentEvents.length > MAX_EVENTS) recentEvents.shift();
  io.emit('activity:new', evt);
}

app.get('/api/activity', (req, res) => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  res.json({ events: recentEvents.filter(e => e.ts >= cutoff) });
});

// ---------- WHATSAPP ----------
const waHits = new Map();
const WA_LIMIT = 3;
const WA_WINDOW = 60 * 1000;

app.post('/api/whatsapp', (req, res) => {
  const { roomId, name, topic } = req.body || {};
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  const now = Date.now();
  const h = waHits.get(ip);
  if (h && now < h.resetAt) {
    if (h.count >= WA_LIMIT) return res.status(429).json({ ok: false, error: 'Too many requests' });
    h.count++;
  } else {
    waHits.set(ip, { count: 1, resetAt: now + WA_WINDOW });
  }

  if (!roomId || !rooms[roomId]) return res.status(400).json({ ok: false, error: 'Invalid chat' });

  const ref = String(roomId).replace('room-', '').slice(0, 8).toUpperCase();
  const safeName = String(name || rooms[roomId].name || 'Guest').slice(0, 60);
  const safeTopic = String(topic || rooms[roomId].topic || 'General').slice(0, 60);

  const text = `Hi Customer Support Service, I'm ${safeName}. Chat ref: #${ref}. Topic: ${safeTopic}. Continuing our conversation here.`;
  const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

  res.json({ ok: true, url });
});

// ---------- AI SUGGESTION (Groq) ----------
const aiHits = new Map();
const AI_LIMIT = 20;
const AI_WINDOW = 60 * 1000;

app.post('/api/ai-suggest', requireAuth, async (req, res) => {
  // rate limit
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const h = aiHits.get(ip);
  if (h && now < h.resetAt) {
    if (h.count >= AI_LIMIT) return res.status(429).json({ ok: false, error: 'Too many AI requests' });
    h.count++;
  } else {
    aiHits.set(ip, { count: 1, resetAt: now + AI_WINDOW });
  }

  if (!GROQ_API_KEY) return res.status(500).json({ ok: false, error: 'AI not configured' });

  const { roomId } = req.body || {};
  if (!roomId || !rooms[roomId]) return res.status(400).json({ ok: false, error: 'Invalid chat' });

  const chat = rooms[roomId];
  // Build a compact history (last 10 messages)
  const history = (chat.messages || []).slice(-10).map(m => {
    const who = m.from === 'customer' ? 'Customer' : 'Agent';
    const text = m.structured
      ? `[${m.structured.type}] ${JSON.stringify(m.structured.payload)}`
      : m.text;
    return who + ': ' + text;
  }).join('\n');

  const systemPrompt = `You are an assistant for a professional airline customer support service.
You draft SHORT, polite, and helpful suggested replies for the human agent.
Rules:
- Never promise refunds, compensation amounts, or timelines.
- Never claim to be an airline. The company is an independent support service.
- Ask for specific details when needed (booking reference, flight number, bag tag).
- Keep the reply under 55 words.
- Use a warm, professional tone.
- Output ONLY the suggested reply text. No quotes, no preamble, no labels.`;

  const userPrompt = `Chat topic: ${chat.topic || 'General'}\n\nRecent conversation:\n${history}\n\nDraft a suggested reply for the agent to send next.`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 200
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('Groq error:', r.status, errText);
      return res.status(502).json({ ok: false, error: 'AI service error' });
    }

    const data = await r.json();
    const suggestion = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();

    if (!suggestion) return res.status(502).json({ ok: false, error: 'Empty AI reply' });

    res.json({ ok: true, suggestion });
  } catch (e) {
    console.error('AI error:', e);
    res.status(500).json({ ok: false, error: 'AI request failed' });
  }
});

// ---------- SOCKET.IO ----------
io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('customer:join', ({ name, topic }) => {
    const roomId = 'room-' + crypto.randomBytes(6).toString('hex');
    rooms[roomId] = {
      roomId,
      customerId: socket.id,
      name: (name || 'Guest').slice(0, 60),
      topic: topic || 'General',
      agentId: null,
      joinedAt: Date.now(),
      messages: [],
      waInvited: false
    };
    savedChats[roomId] = rooms[roomId];
    persistChats();
    socket.join(roomId);
    socket.emit('chat:ready', { roomId });
    io.to(AGENT_ROOM).emit('customer:new', rooms[roomId]);
    logEvent('join', '💬 A customer just started a chat');
    console.log('new customer:', roomId, name, topic);
  });

  socket.on('customer:reconnect', ({ roomId }) => {
    const chat = rooms[roomId] || savedChats[roomId];
    if (!chat) { socket.emit('chat:notfound'); return; }
    rooms[roomId] = chat;
    rooms[roomId].customerId = socket.id;
    socket.join(roomId);
    socket.emit('chat:restored', {
      roomId,
      messages: chat.messages || [],
      name: chat.name,
      topic: chat.topic,
      waInvited: chat.waInvited || false
    });
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });

  socket.on('agent:register', () => {
    socket.join(AGENT_ROOM);
    socket.emit('customer:list', Object.values(rooms));
  });

  socket.on('agent:join', ({ roomId }) => {
    if (!rooms[roomId]) return;
    socket.join(roomId);
    rooms[roomId].agentId = socket.id;
    socket.emit('chat:history', { messages: rooms[roomId].messages });
    io.to(roomId).emit('agent:joined', { name: AGENT_USER });
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });

  socket.on('chat:message', ({ roomId, text, from }) => {
    if (!rooms[roomId]) return;
    const msg = { roomId, text: String(text).slice(0, 2000), from, ts: Date.now() };
    rooms[roomId].messages.push(msg);
    savedChats[roomId] = rooms[roomId];
    persistChats();
    io.to(roomId).emit('chat:message', msg);

    if (from === 'customer' && /\bwhatsapp\b|\bwa\b/i.test(text)) {
      rooms[roomId].waInvited = true;
      io.to(roomId).emit('wa:show');
      io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
    }
  });

  socket.on('chat:request', ({ roomId, type, payload }) => {
    if (!rooms[roomId]) return;
    const msg = {
      roomId,
      text: `[${type.toUpperCase()}] ${JSON.stringify(payload)}`,
      from: 'customer',
      ts: Date.now(),
      structured: { type, payload }
    };
    rooms[roomId].messages.push(msg);
    savedChats[roomId] = rooms[roomId];
    persistChats();
    io.to(roomId).emit('chat:message', msg);
    io.to(AGENT_ROOM).emit('customer:update', rooms[roomId]);

    const eventMap = {
      'Refund request':              ['refund',    '💰 A refund request was submitted'],
      'Flight delay / cancellation': ['delay',     '✈️ A flight delay case was opened'],
      'Baggage issue':               ['baggage',   '🧳 A baggage issue was reported'],
      'Complaint':                   ['complaint', '📢 A complaint was filed'],
      'Change or cancel flight':     ['change',    '🔄 A flight change was requested'],
      'Flight status':               ['status',    '🛫 A flight status enquiry was made']
    };
    const evt = eventMap[type];
    if (evt) logEvent(evt[0], evt[1]);
  });

  socket.on('typing', ({ roomId, from }) => {
    if (!rooms[roomId]) return;
    socket.to(roomId).emit('typing', { from });
  });
  socket.on('typing:stop', ({ roomId, from }) => {
    if (!rooms[roomId]) return;
    socket.to(roomId).emit('typing:stop', { from });
  });

  socket.on('wa:invite', ({ roomId }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].waInvited = true;
    savedChats[roomId] = rooms[roomId];
    persistChats();
    io.to(roomId).emit('wa:show');
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });

  socket.on('chat:end', ({ roomId }) => {
    if (!rooms[roomId]) return;
    io.to(roomId).emit('chat:ended');
    delete rooms[roomId];
    delete savedChats[roomId];
    persistChats();
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
    logEvent('resolved', '✅ A customer chat was resolved');
  });

  socket.on('disconnect', () => {
    for (const id in rooms) {
      if (rooms[id].customerId === socket.id) {
        rooms[id].customerId = null;
        rooms[id].agentId = null;
        savedChats[id] = rooms[id];
      }
    }
    persistChats();
    io.to(AGENT_ROOM).emit('customer:list', Object.values(rooms));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Customer Support Service running on port ${PORT}`));