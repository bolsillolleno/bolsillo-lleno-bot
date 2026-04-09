const admin = require('../config/firebase');
const { DateTime } = require('luxon');

class FirebaseService {
  constructor() {
    this.db = admin.database();
    this.firestore = admin.firestore(); // Para logs persistentes
  }

  // Leer sorteos activos
  async getSorteosActivos() {
    const snapshot = await this.db.ref('sorteos').once('value');
    const data = snapshot.val() || {};
    const ahora = DateTime.now().toISO();
    
    return Object.entries(data)
      .filter(([_, s]) => s.date > ahora)
      .map(([id, s]) => ({ id, ...s }));
  }

  // Leer estado de números de un sorteo
  async getNumerosSorteo(sorteoId) {
    const [occupiedSnap, pendingSnap] = await Promise.all([
      this.db.ref(`occupied/${sorteoId}`).once('value'),
      this.db.ref(`pending/${sorteoId}`).once('value')
    ]);
    
    return {
      occupied: occupiedSnap.val() || {},
      pending: pendingSnap.val() || {},
      disponibles: 100 - Object.keys(occupiedSnap.val() || {}).length - Object.keys(pendingSnap.val() || {}).length
    };
  }

  // Asignar número a pending
  async reservarNumero(sorteoId, numero, clienteData) {
    const ref = this.db.ref(`pending/${sorteoId}/${numero}`);
    await ref.set({
      ...clienteData,
      timestamp: DateTime.now().toISO(),
      source: 'whatsapp_bot'
    });
  }

  // Confirmar pago (mover a occupied)
  async confirmarPago(sorteoId, numero) {
    const pendingRef = this.db.ref(`pending/${sorteoId}/${numero}`);
    const occupiedRef = this.db.ref(`occupied/${sorteoId}/${numero}`);
    
    const data = (await pendingRef.once('value')).val();
    if (!data) throw new Error('Número no está en pending');
    
    await occupiedRef.set({
      ...data,
      paidAt: DateTime.now().toISO()
    });
    await pendingRef.remove();
  }

  // Base de clientes
  async getClientesDB() {
    const snap = await this.db.ref('clientesDB').once('value');
    return Object.entries(snap.val() || {}).map(([k, v]) => ({ _key: k, ...v }));
  }

  // Logs anti-ban
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
