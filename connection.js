global.crypto = require('crypto');

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const P = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(process.cwd(), 'auth_info');

class WhatsAppConnection {
  constructor(io, state, firebase) {
    this.io = io;
    this.state = state;
    this.firebase = firebase;
    this.sock = null;
    this.retryCount = 0;
  }

  // ✅ FIX #4 — forceNew=false por defecto: NO borra sesión en reconexiones normales
  async connect(forceNew = false) {
    try {
      if (forceNew && fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        console.log('🧹 Sesión eliminada — generando QR limpio');
      }

      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      this.state.connection = 'connecting';
      this.io.emit('connection-status', 'connecting');

      this.sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        auth: authState,
        browser: ['Bol$illoBot', 'Chrome', '1.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: true
      });

      this.setupListeners(saveCreds);

    } catch (err) {
      console.error('❌ Error conexión:', err);
      this.handleReconnect();
    }
  }

  setupListeners(saveCreds) {
    this.sock.ev.on('creds.update', async () => {
      await saveCreds();
    });

    this.sock.ev.on('connection.update', (update) => {
      console.log('🧠 UPDATE:', update);

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📲 QR generado');
        this.state.qrCode = qr;
        this.state.connection = 'qr';
        this.io.emit('connection-status', 'qr');

        QRCode.toDataURL(qr, (err, url) => {
          if (!err) this.io.emit('qr-code', url);
        });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log('🔴 Sesión cerrada');
          this.state.connection = 'disconnected';
          this.io.emit('connection-status', 'disconnected');
        } else {
          this.handleReconnect();
        }

      } else if (connection === 'open') {
        console.log('✅ WhatsApp Conectado');
        this.state.connection = 'connected';
        this.state.qrCode = null;
        this.retryCount = 0;
        this.io.emit('connection-status', 'connected');
      }
    });
  }

  // ✅ FIX #3 — sendMessage expuesto para que server.js pueda usarlo
  async sendMessage(jid, text) {
    if (!this.sock) throw new Error('WhatsApp no conectado');
    return await this.sock.sendMessage(jid, { text });
  }

  // ✅ FIX #3 — reconnectFresh para panel: sí borra sesión y pide QR nuevo
  reconnectFresh() {
    this.retryCount = 0;
    this.connect(true); // forceNew = true → borra sesión
  }

  // ✅ FIX #3 — disconnect limpio
  disconnect() {
    if (this.sock) {
      try { this.sock.end(); } catch (_) {}
      this.sock = null;
    }
    this.state.connection = 'disconnected';
    this.state.qrCode = null;
    this.io.emit('connection-status', 'disconnected');
    console.log('🔌 WhatsApp desconectado manualmente');
  }

  handleReconnect() {
    this.retryCount++;
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    console.log(`🔄 Reconectando en ${delay / 1000}s...`);
    setTimeout(() => this.connect(), delay); // forceNew=false → preserva sesión
  }
}

module.exports = WhatsAppConnection;
