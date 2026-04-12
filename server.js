const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const QRCode  = require('qrcode');

const WhatsAppConnection = require('./connection');
const FirebaseService    = require('./firebaseServices');

const PORT = process.env.PORT || 8080;

const app    = express();
const server = http.createServer(app);

app.use(express.json());

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const state = {
  connection: 'disconnected',
  qrCode:     null,
  botActive:  true,
  chats:      new Map(),
  stats: {
    received: 0,
    sent:     0,
    errors:   0,
    sales:    0
  }
};

const firebase     = new FirebaseService();
const waConnection = new WhatsAppConnection(io, state, firebase);

// ════════════════════════════════════
//  RUTAS HTTP
// ════════════════════════════════════

app.get('/', (req, res) => {
  res.json({
    status:     'ok',
    service:    'Bol$illo Lleno — WA Bot',
    connection: state.connection,
    botActive:  state.botActive,
    uptime:     Math.floor(process.uptime()) + 's'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    connection: state.connection,
    botActive:  state.botActive,
    uptime:     process.uptime(),
    stats:      state.stats
  });
});

app.get('/status', (req, res) => {
  res.json({ status: state.connection, botActive: state.botActive, stats: state.stats });
});

// ✅ NUEVO: Endpoint para obtener grupos donde el bot es admin
// Soluciona "Sin grupos admin detectados" en la pantalla Outreach
app.get('/groups', async (req, res) => {
  if (state.connection !== 'connected') {
    return res.status(503).json({ ok: false, error: 'WhatsApp no conectado', groups: [] });
  }
  try {
    const groups = await fetchAdminGroups();
    res.json({ ok: true, groups });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, groups: [] });
  }
});

// ✅ NUEVO: Endpoint para obtener clientes de Firebase (soluciona "Clientes DB: 0")
app.get('/clients', async (req, res) => {
  try {
    const clientes = await firebase.getClientesDB();
    res.json({ ok: true, clients: clientes, total: clientes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, clients: [] });
  }
});

app.get('/qr', async (req, res) => {
  try {
    if (!state.qrCode) {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0d1117;color:#fff">
          <h2>${state.connection === 'connected' ? '✅ WhatsApp ya está conectado' : '⏳ Esperando QR...'}</h2>
          <p style="color:#aaa">Recarga en unos segundos</p>
          <script>setTimeout(()=>location.reload(),5000)</script>
        </body></html>`);
    }
    const qrImage = await QRCode.toDataURL(state.qrCode, { scale: 8 });
    res.send(`
      <html>
        <head><title>QR — Bol$illo Lleno</title></head>
        <body style="text-align:center;font-family:sans-serif;background:#0d1117;color:#fff;padding:40px">
          <h2>📲 Escanea el QR</h2>
          <img src="${qrImage}" style="border-radius:16px;padding:12px;background:#fff"/>
          <p style="color:#aaa">WhatsApp Business → Dispositivos vinculados → Vincular dispositivo</p>
          <script>setTimeout(()=>location.reload(),30000)</script>
        </body>
      </html>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message)
    return res.status(400).json({ ok: false, error: 'Faltan campos: to y message' });
  if (state.connection !== 'connected')
    return res.status(503).json({ ok: false, error: 'WhatsApp no conectado' });
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
  console.log(`🤖 Bot ${state.botActive ? 'ACTIVADO ✅' : 'DESACTIVADO 🔴'}`);
  res.json({ ok: true, botActive: state.botActive });
});

// ════════════════════════════════════
//  HELPERS INTERNOS
// ════════════════════════════════════

// ✅ NUEVO: función interna que obtiene grupos donde el bot es admin
async function fetchAdminGroups() {
  if (!waConnection.sock) return [];
  
  // groupFetchAllParticipating devuelve { [id]: { id, subject, desc, owner, participants, ... } }
  const allGroups = await waConnection.sock.groupFetchAllParticipating();
  const botJid = waConnection.sock.user?.id;

  const adminGroups = Object.values(allGroups).filter(group => {
    // Verificar si el bot es admin en ese grupo
    const me = group.participants?.find(p => p.id === botJid);
    return me && (me.admin === 'admin' || me.admin === 'superadmin');
  });

  return adminGroups.map(g => ({
    id: g.id,
    name: g.subject || 'Grupo sin nombre',
    participants: g.participants?.length || 0,
    desc: g.desc || '',
    creation: g.creation
  }));
}

// ════════════════════════════════════
//  SOCKET.IO
// ════════════════════════════════════
io.on('connection', (socket) => {
  console.log('🖥️ Panel conectado:', socket.id);

  socket.emit('connection-status', state.connection);
  socket.emit('bot-status', state.botActive);
  socket.emit('stats-update', state.stats);

  if (state.qrCode && state.connection === 'qr') {
    QRCode.toDataURL(state.qrCode, { scale: 8 }, (err, url) => {
      if (!err) socket.emit('qr-code', url);
    });
  }

  // ✅ NUEVO: El panel pide los grupos admin vía socket
  socket.on('get-admin-groups', async () => {
    if (state.connection !== 'connected') {
      socket.emit('admin-groups', []);
      return;
    }
    try {
      const groups = await fetchAdminGroups();
      console.log(`📋 Grupos admin enviados al panel: ${groups.length}`);
      socket.emit('admin-groups', groups);
    } catch (err) {
      console.error('Error fetching groups:', err);
      socket.emit('admin-groups', []);
    }
  });

  // ✅ NUEVO: El panel pide clientes Firebase vía socket
  socket.on('get-clients', async () => {
    try {
      const clientes = await firebase.getClientesDB();
      socket.emit('clients-update', clientes);
      console.log(`👥 Clientes Firebase enviados al panel: ${clientes.length}`);
    } catch (err) {
      console.error('Error fetching clients:', err);
      socket.emit('clients-update', []);
    }
  });

  socket.on('send-message', async ({ to, message }) => {
    if (state.connection !== 'connected') {
      socket.emit('message-error', 'WhatsApp no conectado');
      return;
    }
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
    console.log(`🤖 Bot ${state.botActive ? 'ACTIVADO ✅' : 'DESACTIVADO 🔴'} via panel`);
  });

  socket.on('reconnect-wa', () => {
    console.log('🔄 Reconexión manual');
    waConnection.reconnectFresh();
  });

  socket.on('disconnect-wa', () => {
    console.log('🔌 Desconexión manual');
    waConnection.disconnect();
  });

  socket.on('disconnect', () => {
    console.log('🖥️ Panel desconectado:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`🤖 Bot activo por defecto: ${state.botActive}`);
  waConnection.connect();
});
