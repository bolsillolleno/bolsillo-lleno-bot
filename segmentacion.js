class SegmentacionService {
  constructor(firebase) {
    this.firebase = firebase;
    this.clientesCache = new Map();
    this._clientesDB = null;
    this._clientesDBTs = 0;
  }

  // ✅ Cache de clientesDB (TTL 60s) para no hacer query por cada mensaje
  async _getClientesDB() {
    const now = Date.now();
    if (this._clientesDB && (now - this._clientesDBTs) < 60000) {
      return this._clientesDB;
    }
    this._clientesDB = await this.firebase.getClientesDB();
    this._clientesDBTs = now;
    return this._clientesDB;
  }

  async clasificarUsuario(jid, pushName, messageText) {
    const phone = jid.split('@')[0];
    
    // 1. Buscar en clientesDB
    const clientes = await this._getClientesDB();
    const clienteDB = clientes.find(c =>
      c.telefono && c.telefono.replace(/\D/g, '').includes(phone.slice(-8))
    );
    
    if (clienteDB) {
      // Registrar interacción para clientes conocidos
      await this.registrarInteraccion(phone);
      return {
        tipo: 'CLIENTE',
        data: clienteDB,
        confianza: 1.0,
        etiquetas: this.extraerEtiquetas(pushName, clienteDB.nombre)
      };
    }

    // 2. Detectar VIP por nombre
    if (pushName && /vip|cliente|frecuente|socio/i.test(pushName)) {
      await this.registrarInteraccion(phone);
      return { tipo: 'CLIENTE', data: { nombre: pushName }, etiquetas: ['VIP_DETECTADO'] };
    }

    // ✅ FIX #7 — historial real desde Firebase (antes siempre retornaba 0)
    const historial = await this.getHistorialInteracciones(phone);
    
    if (historial > 0) {
      await this.registrarInteraccion(phone);
      return {
        tipo: 'INTERESADO',
        nivel: historial > 3 ? 'caliente' : 'tibio',
        data: { nombre: pushName }
      };
    }

    // 4. Frío — primer contacto, registrar
    await this.registrarInteraccion(phone);
    return { tipo: 'FRIO', data: { nombre: pushName } };
  }

  extraerEtiquetas(pushName, dbName) {
    const tags = [];
    if (/camilo|andres|martinez/i.test(pushName || '')) tags.push('STAFF');
    if (/distribuidor|vendedor/i.test(pushName || '')) tags.push('DISTRIBUIDOR');
    return tags;
  }

  // ✅ FIX #7 — implementación real con Firebase
  async getHistorialInteracciones(phone) {
    try {
      const snap = await this.firebase.db
        .ref(`interacciones/${phone}/count`)
        .once('value');
      return snap.val() || 0;
    } catch (err) {
      console.error('[SEGMENTACION] Error leyendo historial:', err);
      return 0;
    }
  }

  // ✅ NUEVO — registrar cada interacción en Firebase
  async registrarInteraccion(phone) {
    try {
      const ref = this.firebase.db.ref(`interacciones/${phone}`);
      const snap = await ref.once('value');
      const data = snap.val() || { count: 0 };
      await ref.update({
        count: (data.count || 0) + 1,
        lastSeen: Date.now()
      });
    } catch (err) {
      console.error('[SEGMENTACION] Error registrando interacción:', err);
    }
  }
}

module.exports = SegmentacionService;
