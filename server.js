const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const QRCode  = require('qrcode');

const WhatsAppConnection = require('./connection');
const FirebaseService    = require('./firebaseServices');

// ✅ IMPORTANTE: usar el puerto de Railway
const PORT = process.env.PORT || 8080;

const app    = express();
const server = http.createServer(app);

// ── Socket.io ──
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ── Estado global ──
const state = {
  connection: 'disconnected',
  qrCode: null,
  qrImage: null, // ✅ NUEVO
  stats: { received: 0, sent: 0, errors: 0 }
};

// ── Servicios ──
const firebase    = new FirebaseService();
const waConnection = new WhatsAppConnection(io, state, firebase);

// ── RUTA PRINCIPAL ──
app.get('/', (req, res) => {
  res.json({
    status:     'ok',
    service:    'Bol$illo Lleno — WA Bot',
    connection: state.connection,
    uptime:     Math.floor(process.uptime()) + 's'
  });
});

// ── NUEVA RUTA PARA VER EL QR ──
app.get('/qr', async (req, res) => {
  try {
    if (!state.qrCode) {
      return res.send(`
        <h2>⏳ Esperando QR...</h2>
        <p>Recarga en unos segundos</p>
      `);
    }

    const qrImage = await QRCode.toDataURL(state.qrCode);

    res.send(`
      <html>
        <head>
          <title>QR WhatsApp</title>
        </head>
        <body style="text-align:center;font-family:sans-serif;">
          <h2>📲 Escanea el QR</h2>
          <img src="${qrImage}" />
          <p>Abre WhatsApp > Dispositivos vinculados</p>
        </body>
      </html>
    `);
  } catch (err) {
    res.send('Error generando QR');
  }
});

// ── HEALTH ──
app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    connection: state.connection,
    uptime:     process.uptime(),
    stats:      state.stats
  });
});

// ── SOCKET ──
io.on('connection', (socket) => {
  console.log('🖥️ Panel conectado:', socket.id);

  socket.emit('connection-status', state.connection);

  if (state.qrCode && state.connection === 'qr') {
    QRCode.toDataURL(state.qrCode, { scale: 8 }, (err, url) => {
      if (!err) socket.emit('qr-code', url);
    });
  }

  socket.on('reconnect-wa', () => {
    console.log('🔄 Reconexión manual');
    waConnection.connect();
  });

  socket.on('disconnect-wa', () => {
    console.log('🔌 Desconexión manual');
    waConnection.disconnect();
  });

  socket.on('disconnect', () => {
    console.log('🖥️ Panel desconectado:', socket.id);
  });
});

// ── ARRANQUE ──
server.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  console.log(`📡 Socket.io listo`);
  waConnection.connect();
});