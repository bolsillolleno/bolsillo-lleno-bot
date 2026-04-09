// ✅ Ruta corregida — firebase.js está en la raíz del proyecto
const admin = require('./firebase');
const { DateTime } = require('luxon');

// Nodo en Realtime DB donde se guarda la sesión de WhatsApp
const SESSION_REF = 'wa_session';

class FirebaseService {
  constructor() {
    this.db        = admin.database();
    this.firestore = admin.firestore();
  }

  // ════════════════════════════════════════════
  //  SESIÓN BAILEYS (nueva)
  // ════════════════════════════════════════════

  /** Devuelve { filename__DOT__json: base64, ... } o null si no existe */
  async getSession() {
    const snap = await this.db.ref(SESSION_REF).once('value');
    return snap.val() || null;
  }

  /** Guarda el objeto de sesión { filename__DOT__json: base64, ... } */
  async saveSession(payload) {
    await this.db.ref(SESSION_REF).set(payload);
  }

  /** Borra la sesión completa (logout) */
  async deleteSession() {
    await this.db.ref(SESSION_REF).remove();
  }

  // ════════════════════════════════════════════
  //  SORTEOS
  // ════════════════════════════════════════════

  async getSorteosActivos() {
    const snapshot = await this.db.ref('sorteos').once('value');
    const data     = snapshot.val() || {};
    const ahora    = DateTime.now().toISO();

    return Object.entries(data)
      .filter(([_, s]) => s.date > ahora)
      .map(([id, s]) => ({ id, ...s }));
  }

  async getNumerosSorteo(sorteoId) {
    const [occupiedSnap, pendingSnap] = await Promise.all([
      this.db.ref(`occupied/${sorteoId}`).once('value'),
      this.db.ref(`pending/${sorteoId}`).once('value')
    ]);

    const occupied  = occupiedSnap.val() || {};
    const pending   = pendingSnap.val() || {};

    return {
      occupied,
      pending,
      disponibles: 100 - Object.keys(occupied).length - Object.keys(pending).length
    };
  }

  async reservarNumero(sorteoId, numero, clienteData) {
    await this.db.ref(`pending/${sorteoId}/${numero}`).set({
      ...clienteData,
      timestamp: DateTime.now().toISO(),
      source: 'whatsapp_bot'
    });
  }

  async confirmarPago(sorteoId, numero) {
    const pendingRef  = this.db.ref(`pending/${sorteoId}/${numero}`);
    const occupiedRef = this.db.ref(`occupied/${sorteoId}/${numero}`);

    const data = (await pendingRef.once('value')).val();
    if (!data) throw new Error('Número no está en pending');

    await occupiedRef.set({ ...data, paidAt: DateTime.now().toISO() });
    await pendingRef.remove();
  }

  // ════════════════════════════════════════════
  //  CLIENTES
  // ════════════════════════════════════════════

  async getClientesDB() {
    const snap = await this.db.ref('clientesDB').once('value');
    return Object.entries(snap.val() || {}).map(([k, v]) => ({ _key: k, ...v }));
  }

  // ════════════════════════════════════════════
  //  LOGS ANTI-BAN
  // ════════════════════════════════════════════

  async logMessage(tipo, telefono, contenido, exito) {
    await this.firestore.collection('logs_whatsapp').add({
      tipo,
      telefono,
      contenido: contenido.substring(0, 100),
      exito,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

module.exports = FirebaseService;
