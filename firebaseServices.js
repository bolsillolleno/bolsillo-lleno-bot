// ✅ Ruta corregida — firebase.js está en la raíz del proyecto
const admin = require('./firebase');
const { DateTime } = require('luxon');

const SESSION_REF = 'wa_session';

class FirebaseService {
  constructor() {
    this.db        = admin.database();
    this.firestore = admin.firestore();
  }

  // ════════════════════════════════════════════
  //  SESIÓN BAILEYS
  // ════════════════════════════════════════════

  async getSession() {
    const snap = await this.db.ref(SESSION_REF).once('value');
    return snap.val() || null;
  }

  async saveSession(payload) {
    await this.db.ref(SESSION_REF).set(payload);
  }

  async deleteSession() {
    await this.db.ref(SESSION_REF).remove();
  }

  // ════════════════════════════════════════════
  //  SORTEOS
  // ════════════════════════════════════════════

  async getSorteosActivos() {
    const snapshot = await this.db.ref('sorteos').once('value');
    const data     = snapshot.val() || {};
    const ahora    = DateTime.now();

    return Object.entries(data)
      .filter(([_, s]) => {
        // ✅ FIX #11 — comparar objetos DateTime, no strings ISO
        // Maneja zonas horarias y offsets correctamente
        try {
          return DateTime.fromISO(s.date) > ahora;
        } catch {
          return false; // fecha inválida → excluir
        }
      })
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => {
        // Ordenar por fecha ascendente (el más próximo primero)
        return DateTime.fromISO(a.date) - DateTime.fromISO(b.date);
      });
  }

  async getNumerosSorteo(sorteoId) {
    const [occupiedSnap, pendingSnap] = await Promise.all([
      this.db.ref(`occupied/${sorteoId}`).once('value'),
      this.db.ref(`pending/${sorteoId}`).once('value')
    ]);

    const occupied = occupiedSnap.val() || {};
    const pending  = pendingSnap.val() || {};

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
  //  INTERACCIONES (para segmentación)
  // ════════════════════════════════════════════

  async getInteracciones(phone) {
    const snap = await this.db.ref(`interacciones/${phone}`).once('value');
    return snap.val() || { count: 0 };
  }

  // ════════════════════════════════════════════
  //  LOGS ANTI-BAN
  // ════════════════════════════════════════════

  async logMessage(tipo, telefono, contenido, exito) {
    try {
      await this.firestore.collection('logs_whatsapp').add({
        tipo,
        telefono,
        contenido: (contenido || '').substring(0, 100),
        exito,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      // No crashear el bot si falla el log
      console.error('[FIREBASE] Error al logear mensaje:', err.message);
    }
  }
}

module.exports = FirebaseService;
