class SegmentacionService {
  constructor(firebase) {
    this.firebase = firebase;
    this.clientesCache = new Map();
    // ✅ BUG #5 CORREGIDO: Cache en memoria para interacciones de la sesión actual
    this.interaccionesCache = new Map();
  }

  async clasificarUsuario(jid, pushName, messageText) {
    const phone = jid.split('@')[0];
    
    // 1. Buscar en clientesDB de Firebase
    try {
      const clientes = await this.firebase.getClientesDB();
      const clienteDB = clientes.find(c => c.telefono && c.telefono.includes(phone.slice(-8)));
      
      if (clienteDB) {
        return {
          tipo: 'CLIENTE',
          data: clienteDB,
          confianza: 1.0,
          etiquetas: this.extraerEtiquetas(pushName, clienteDB.nombre || '')
        };
      }
    } catch (err) {
      console.warn('[SEGMENTACION] No se pudo consultar clientesDB:', err.message);
    }

    // 2. Detectar VIP por nombre
    if (pushName && /vip|cliente|frecuente|socio/i.test(pushName)) {
      return { tipo: 'CLIENTE', data: { nombre: pushName }, etiquetas: ['VIP_DETECTADO'] };
    }

    // 3. ✅ BUG #5 CORREGIDO: Usar cache en memoria para contar interacciones
    // Antes: getHistorialInteracciones() siempre retornaba 0 → todos FRIO
    const historial = this.getHistorialLocal(phone);
    
    // Registrar esta interacción
    this.registrarInteraccionLocal(phone);

    if (historial > 0) {
      return { 
        tipo: 'INTERESADO', 
        data: { nombre: pushName },
        nivel: historial > 3 ? 'caliente' : 'tibio',
        interacciones: historial
      };
    }

    // 4. Primera vez que escribe → NUEVO (no FRIO para privados)
    // En privado, si alguien escribe por primera vez, claramente está interesado
    const esPrivado = !jid.endsWith('@g.us');
    if (esPrivado) {
      return { tipo: 'NUEVO', data: { nombre: pushName } };
    }

    return { tipo: 'FRIO' };
  }

  getHistorialLocal(phone) {
    return this.interaccionesCache.get(phone) || 0;
  }

  registrarInteraccionLocal(phone) {
    const actual = this.interaccionesCache.get(phone) || 0;
    this.interaccionesCache.set(phone, actual + 1);
  }

  extraerEtiquetas(pushName, dbName) {
    const tags = [];
    if (/camilo|andres|martinez/i.test(pushName)) tags.push('STAFF');
    if (/distribuidor|vendedor/i.test(pushName)) tags.push('DISTRIBUIDOR');
    return tags;
  }
}

module.exports = SegmentacionService;
