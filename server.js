const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const WhatsAppConnection = require('./src/whatsapp/connection');
const FirebaseService = require('./src/services/firebaseServices');

const PORT = process.env.PORT || 3030;

const app = express();
const server = http.createServer(app);

// ── Socket.io con CORS abierto (GitHub Pages) ──
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
  stats: { received: 0, sent: 0, errors: 0 }
};

// ── Servicios ──
const firebase = new FirebaseService();
const waConnection = new WhatsAppConnection(io, state, firebase);

// ── Rutas HTTP ──
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Bol$illo Lleno — WA Bot',
    connection: state.connection,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connection: state.connection,
    uptime: process.uptime(),
    stats: state.stats
  });
});

// ── Socket.io ──
io.on('connection', (socket) => {
  console.log('🖥️  Panel conectado:', socket.id);

  // Enviar estado actual al nuevo cliente
  socket.emit('connection-status', state.connection);

  // Re-emitir QR si ya está esperando escaneo
  if (state.qrCode && state.connection === 'qr') {
    QRCode.toDataURL(state.qrCode, { scale: 8 }, (err, url) => {
      if (!err) socket.emit('qr-code', url);
    });
  }

  // Panel pide reconectar WhatsApp
  socket.on('reconnect-wa', () => {
    console.log('🔄 Reconexión manual solicitada');
    waConnection.connect();
  });

  // Panel pide desconectar WhatsApp
  socket.on('disconnect-wa', () => {
    console.log('🔌 Desconexión manual solicitada');
    waConnection.disconnect();
  });

  socket.on('disconnect', () => {
    console.log('🖥️  Panel desconectado:', socket.id);
  });
});

// ── Arranque ──
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Socket.io listo`);
  waConnection.connect();
});
