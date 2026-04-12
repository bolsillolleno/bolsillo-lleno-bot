class SegmentacionService {
  constructor(firebase) {
    this.firebase = firebase;
    this.clientesCache = new Map();
    // ✅ FIX #7: cache en memoria para contar interacciones reales de la sesión
    this.interaccionesCache = new Map();
  }

  async clasificarUsuario(jid, pushName, messageText) {
    const phone     = jid.split('@')[0];
    const esPrivado = !jid.endsWith('@g.us');

    // 1. Buscar en clientesDB de Firebase
    try {
      const clientes  = await this.firebase.getClientesDB();
      const clienteDB = clientes.find(c => c.telefono && c.telefono.includes(phone.slice(-8)));
      if (clienteDB) {
        return {
          tipo:      'CLIENTE',
          data:      clienteDB,
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

    // 3. ✅ FIX #7: usar cache en memoria en vez del placeholder que retornaba 0
    // Antes: getHistorialInteracciones() siempre devolvía 0 → todos clasificaban FRIO
    // → combinado con bug en intents.js, NADIE recibía respuesta en privado.
    const historial = this.interaccionesCache.get(phone) || 0;
    this.interaccionesCache.set(phone, historial + 1);

    if (historial > 0) {
      return {
        tipo:          'INTERESADO',
        data:          { nombre: pushName },
        nivel:         historial > 3 ? 'caliente' : 'tibio',
        interacciones: historial
      };
    }

    // 4. ✅ FIX #8: primera vez en privado → NUEVO, no FRIO
    // Si alguien escribe al privado por primera vez, está interesado por definición.
    // FRIO solo aplica en grupos para desconocidos.
    if (esPrivado) {
      return { tipo: 'NUEVO', data: { nombre: pushName } };
    }

    return { tipo: 'FRIO' };
  }

  extraerEtiquetas(pushName, dbName) {
    const tags = [];
    if (/camilo|andres|martinez/i.test(pushName)) tags.push('STAFF');
    if (/distribuidor|vendedor/i.test(pushName))  tags.push('DISTRIBUIDOR');
    return tags;
  }
}

module.exports = SegmentacionService;
