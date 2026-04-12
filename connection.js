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

const MessageListener = require('./listener'); // ✅ BUG #2 FIX: importar aquí

const SESSION_DIR = path.join(process.cwd(), 'auth_info');

class WhatsAppConnection {
  constructor(io, state, firebase) {
    this.io = io;
    this.state = state;
    this.firebase = firebase;
    this.sock = null;
    this.retryCount = 0;
    this.listener = null;
  }

  async connect() {
    try {
      // ✅ BUG #1 FIX: NO borrar la sesión aquí.
      // Antes: borraba la carpeta en CADA connect() → al reconectar perdía las credenciales → QR infinito
      // Ahora: solo se borra si el usuario hace logout explícito (método disconnect())

      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      this.state.connection = 'connecting';
      this.io.emit('connection-status', 'connecting');

      this.sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        auth: authState,
        browser: ['BolsilloBot', 'Chrome', '1.0'],
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
          console.log('🔴 Sesión cerrada (logout)');
          // Solo al hacer logout borramos la sesión guardada
          if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('🧹 Credenciales eliminadas por logout');
          }
          this.state.connection = 'disconnected';
          this.io.emit('connection-status', 'disconnected');
        } else {
          // Reconexión normal: NO borrar sesión, solo reconectar
          this.handleReconnect();
        }

      } else if (connection === 'open') {
        console.log('✅ WhatsApp Conectado');

        this.state.connection = 'connected';
        this.state.qrCode = null;
        this.retryCount = 0;

        this.io.emit('connection-status', 'connected');

        // ✅ BUG #2 FIX: Inicializar el listener de mensajes al conectar
        // Antes: nunca se instanciaba → el bot nunca respondía mensajes
        if (!this.listener) {
          this.listener = new MessageListener(this.sock, this.state, this.firebase, this.io);
          console.log('👂 MessageListener activado');
        }
      }
    });
  }

  // ✅ BUG #3 FIX: Método sendMessage que faltaba — server.js lo llama pero no existía
  async sendMessage(jid, message) {
    if (!this.sock) throw new Error('Socket no inicializado');
    await this.sock.sendMessage(jid, { text: message });
  }

  // ✅ BUG #3 FIX: reconnectFresh — server.js lo llama desde socket 'reconnect-wa' pero no existía
  async reconnectFresh() {
    console.log('🔄 Reconexión forzada desde panel');
    // Borrar sesión solo en reconexión manual explícita
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    this.listener = null;
    await this.connect();
  }

  // ✅ BUG #3 FIX: disconnect — server.js lo llama desde socket 'disconnect-wa' pero no existía
  async disconnect() {
    console.log('🔌 Desconexión manual');
    try {
      await this.sock?.logout();
    } catch (_) {}
    this.listener = null;
    this.state.connection = 'disconnected';
    this.io.emit('connection-status', 'disconnected');
  }

  handleReconnect() {
    this.retryCount++;
    const delay = Math.min(1000 * 2 ** this.retryCount, 30000);
    console.log(`🔄 Reconectando en ${delay / 1000}s... (intento ${this.retryCount})`);
    this.listener = null; // Limpiar listener para recrearlo al conectar
    setTimeout(() => this.connect(), delay);
  }
}

module.exports = WhatsAppConnection;
