const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const WhatsAppConnection = require('./src/whatsapp/connection');
const FirebaseService = require('./src/services/firebaseService');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado global compartido con frontend
const globalState = {
  connection: 'disconnected', // connected, connecting, qr
  qrCode: null,
  botActive: true,
  stats: {
    sent: 0,
    received: 0,
    sales: 0
  },
  chats: new Map(), // jid -> chat data
  queue: []
};

// Instanciar servicios
const firebase = new FirebaseService();
const waConnection = new WhatsAppConnection(io, globalState, firebase);

// Rutas API
app.get('/api/status', (req, res) => {
  res.json({
    connection: globalState.connection,
    botActive: globalState.botActive,
    stats: globalState.stats
  });
});

app.post('/api/bot/toggle', (req, res) => {
  globalState.botActive = !globalState.botActive;
  io.emit('bot-status', globalState.botActive);
  res.json({ active: globalState.botActive });
});

app.post('/api/send', async (req, res) => {
  const { jid, message } = req.body;
  try {
    await waConnection.sendMessage(jid, message);
    globalState.stats.sent++;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io para tiempo real con el panel
io.on('connection', (socket) => {
  console.log('Panel conectado:', socket.id);
  
  // Enviar estado actual
  socket.emit('connection-status', globalState.connection);
  socket.emit('bot-status', globalState.botActive);
  socket.emit('chats-update', Array.from(globalState.chats.values()));

  // Comandos desde el panel
  socket.on('disconnect-bot', () => waConnection.disconnect());
  socket.on('reconnect-bot', () => waConnection.connect());
  socket.on('toggle-bot', (state) => {
    globalState.botActive = state;
    io.emit('bot-status', state);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  waConnection.connect();
});
