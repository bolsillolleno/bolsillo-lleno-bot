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

  async connect() {
    try {
      // 🧹 LIMPIAR SESIÓN PARA FORZAR QR
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        console.log('🧹 Sesión eliminada para generar QR limpio');
      }

      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      this.state.connection = 'connecting';
      this.io.emit('connection-status', 'connecting');

      this.sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: authState,
        browser: ['Bol$illoBot', 'Chrome', '1.0']
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

  handleReconnect() {
    this.retryCount++;

    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);

    console.log(`🔄 Reconectando en ${delay / 1000}s...`);

    setTimeout(() => this.connect(), delay);
  }
}

module.exports = WhatsAppConnection;