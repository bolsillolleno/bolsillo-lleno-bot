const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const P       = require('pino');
const QRCode  = require('qrcode');
const fs      = require('fs');
const path    = require('path');

// ── Carpeta local temporal para la sesión ──
const SESSION_DIR = path.join(process.cwd(), 'auth_info');

// ════════════════════════════════════════════
//  Firebase ↔ Sesión local
// ════════════════════════════════════════════

/**
 * Descarga la sesión desde Firebase Realtime DB y la escribe en disco.
 * Los puntos en nombres de archivo se escapan con __DOT__ en Firebase.
 */
async function downloadSession(firebase) {
  try {
    const data = await firebase.getSession(); // devuelve { filename: base64 } o null
    if (!data) {
      console.log('📂 Sin sesión previa en Firebase — se generará QR');
      return;
    }
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    for (const [key, encoded] of Object.entries(data)) {
      const filename = key.replace(/__DOT__/g, '.');
      fs.writeFileSync(path.join(SESSION_DIR, filename), Buffer.from(encoded, 'base64'));
    }
    console.log(`✅ Sesión restaurada desde Firebase (${Object.keys(data).length} archivos)`);
  } catch (err) {
    console.error('⚠️  Error descargando sesión:', err.message);
  }
}

/**
 * Lee los archivos de sesión locales y los sube a Firebase.
 */
async function uploadSession(firebase) {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;

    const files   = fs.readdirSync(SESSION_DIR);
    const payload = {};

    for (const filename of files) {
      const key     = filename.replace(/\./g, '__DOT__'); // Firebase no admite puntos en claves
      const content = fs.readFileSync(path.join(SESSION_DIR, filename));
      payload[key]  = content.toString('base64');
    }

    await firebase.saveSession(payload);
    console.log('☁️  Sesión guardada en Firebase');
  } catch (err) {
    console.error('⚠️  Error subiendo sesión:', err.message);
  }
}

// ════════════════════════════════════════════
//  Clase principal
// ════════════════════════════════════════════

class WhatsAppConnection {
  constructor(io, state, firebase) {
    this.io         = io;
    this.state      = state;
    this.firebase   = firebase;
    this.sock       = null;
    this.retryCount = 0;
  }

async connect() {
  try {

    // 🧹 BORRAR sesión SIEMPRE (para forzar QR)
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
      browser: ['Bol$illoBot', 'Chrome', '1.0'],
      generateHighQualityLinkPreview: true
    });

    this.setupListeners(saveCreds);

  } catch (err) {
    console.error('❌ Error conexión:', err);
    this.handleReconnect();
  }
}

  async sendMessage(jid, text, options = {}) {
    if (!this.sock || this.state.connection !== 'connected') {
      throw new Error('WhatsApp no conectado');
    }
    // ✅ Ruta corregida: delay.js está en la raíz
    const { humanDelay } = require('./delay');
    await humanDelay(1000, 3000);

    return await this.sock.sendMessage(jid, { text, ...options });
  }

  async disconnect() {
    await this.sock?.logout();
    await this.clearSession();
    this.state.connection = 'disconnected';
    this.io.emit('connection-status', 'disconnected');
  }

  async clearSession() {
    try {
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
      await this.firebase.deleteSession();
    } catch (err) {
      console.error('⚠️  Error limpiando sesión:', err.message);
    }
  }
}

module.exports = WhatsAppConnection;
