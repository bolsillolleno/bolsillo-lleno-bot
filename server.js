const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const QRCode  = require('qrcode');

const WhatsAppConnection = require('./connection');
const FirebaseService    = require('./firebaseServices');
const ai                 = require('./ai'); // IA para endpoints del panel

const PORT = process.env.PORT || 8080;
const app    = express();
const server = http.createServer(app);
app.use(express.json());

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const state = {
  connection:      'disconnected',
  qrCode:          null,
  botActive:       true,
  botPersonalidad: 'amigo',
  chats:           new Map(),
  stats:           { received: 0, sent: 0, errors: 0, sales: 0 }
};

const firebase     = new FirebaseService();
const waConnection = new WhatsAppConnection(io, state, firebase);

// ── RUTAS HTTP ──────────────────────────────

app.get('/', (req, res) => res.json({
  status: 'ok', service: 'Bol$illo Lleno — WA Bot',
  connection: state.connection, botActive: state.botActive,
  ia: !!process.env.ANTHROPIC_API_KEY,
  uptime: Math.floor(process.uptime()) + 's'
}));

app.get('/health', (req, res) => res.json({
  status: 'ok', connection: state.connection,
  botActive: state.botActive, uptime: process.uptime(), stats: state.stats
}));

app.get('/status', (req, res) => res.json({
  status: state.connection, botActive: state.botActive, stats: state.stats
}));

app.get('/qr', async (req, res) => {
  try {
    if (!state.qrCode) {
      return res.send(`<html><body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
        <h2>${state.connection === 'connected' ? '✅ Conectado' : '⏳ Esperando QR...'}</h2>
        <script>setTimeout(()=>location.reload(),5000)</script></body></html>`);
    }
    const qrImage = await QRCode.toDataURL(state.qrCode, { scale: 8 });
    res.send(`<html><body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
      <h2>📲 Escanea el QR</h2>
      <img src="${qrImage}" style="border-radius:16px;padding:12px;background:#fff"/>
      <p style="color:#aaa">WhatsApp Business → Dispositivos vinculados → Vincular dispositivo</p>
      <script>setTimeout(()=>location.reload(),30000)</script></body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ ok: false, error: 'Faltan: to y message' });
  if (state.connection !== 'connected') return res.status(503).json({ ok: false, error: 'WhatsApp no conectado' });
  try {
    const jid = to.includes('@') ? to : to.replace(/\D/g, '') + '@s.whatsapp.net';
    await waConnection.sendMessage(jid, message);
    state.stats.sent++;
    res.json({ ok: true, to: jid });
  } catch (err) {
    state.stats.errors++;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/bot/toggle', (req, res) => {
  state.botActive = !state.botActive;
  io.emit('bot-status', state.botActive);
  res.json({ ok: true, botActive: state.botActive });
});

// ✅ NUEVO — IA: sugerencia para operador del panel
app.post('/ai/suggest', async (req, res) => {
  const { ultimoMensaje, nombre, sorteo, historial } = req.body;
  if (!ultimoMensaje) return res.status(400).json({ ok: false, error: 'Falta ultimoMensaje' });
  const sugerencia = await ai.sugerirAlOperador({ ultimoMensaje, nombre, sorteo, historial });
  if (!sugerencia) return res.status(503).json({ ok: false, error: 'IA no disponible — agrega ANTHROPIC_API_KEY en Railway' });
  res.json({ ok: true, sugerencia });
});

// ✅ NUEVO — IA: generar mensaje de campaña
app.post('/ai/campana', async (req, res) => {
  const { segmento, sorteo, personalidad } = req.body;
  const mensaje = await ai.generarMensajeCampana({ segmento, sorteo, personalidad });
  if (!mensaje) return res.status(503).json({ ok: false, error: 'IA no disponible' });
  res.json({ ok: true, mensaje });
});

// ✅ NUEVO — Cambiar personalidad del bot
app.post('/bot/personalidad', (req, res) => {
  const { personalidad } = req.body;
  const validas = ['amigo', 'emocion', 'urgente', 'pro'];
  if (!validas.includes(personalidad)) return res.status(400).json({ ok: false, error: 'Inválida' });
  state.botPersonalidad = personalidad;
  ai.setPersonalidad(personalidad);
  io.emit('personalidad-update', personalidad);
  res.json({ ok: true, personalidad });
});

// ── SOCKET.IO ───────────────────────────────

io.on('connection', (socket) => {
  console.log('🖥️ Panel conectado:', socket.id);
  socket.emit('connection-status', state.connection);
  socket.emit('bot-status', state.botActive);
  socket.emit('stats-update', state.stats);
  socket.emit('personalidad-update', state.botPersonalidad);

  if (state.qrCode && state.connection === 'qr') {
    QRCode.toDataURL(state.qrCode, { scale: 8 }, (err, url) => {
      if (!err) socket.emit('qr-code', url);
    });
  }

  socket.on('send-message', async ({ to, message }) => {
    if (state.connection !== 'connected') return socket.emit('message-error', 'WhatsApp no conectado');
    try {
      const jid = to.includes('@') ? to : to.replace(/\D/g, '') + '@s.whatsapp.net';
      await waConnection.sendMessage(jid, message);
      state.stats.sent++;
      socket.emit('message-sent', { to: jid });
    } catch (err) {
      state.stats.errors++;
      socket.emit('message-error', err.message);
    }
  });

  socket.on('bot-toggle', () => {
    state.botActive = !state.botActive;
    io.emit('bot-status', state.botActive);
  });

  socket.on('set-personalidad', (personalidad) => {
    const validas = ['amigo', 'emocion', 'urgente', 'pro'];
    if (!validas.includes(personalidad)) return;
    state.botPersonalidad = personalidad;
    ai.setPersonalidad(personalidad);
    io.emit('personalidad-update', personalidad);
    console.log('🎭 Personalidad → ' + personalidad);
  });

  socket.on('reconnect-wa', () => waConnection.reconnectFresh());
  socket.on('disconnect-wa', () => waConnection.disconnect());
  socket.on('disconnect', () => console.log('🖥️ Panel desconectado:', socket.id));
});

server.listen(PORT, () => {
  console.log('🚀 Puerto ' + PORT);
  console.log('🧠 IA Claude: ' + (process.env.ANTHROPIC_API_KEY ? '✅ activa' : '⚠️  sin API key'));
  waConnection.connect(); // FIX #4 — preserva sesión
});
