class SegmentacionService {
  constructor(firebase) {
    this.firebase = firebase;
    this.clientesCache = new Map();
  }

  async clasificarUsuario(jid, pushName, messageText) {
    const phone = jid.split('@')[0];
    
    // 1. Buscar en clientesDB
    const clientes = await this.firebase.getClientesDB();
    const clienteDB = clientes.find(c => c.telefono.includes(phone.slice(-8)));
    
    if (clienteDB) {
      return {
        tipo: 'CLIENTE',
        data: clienteDB,
        confianza: 1.0,
        etiquetas: this.extraerEtiquetas(pushName, clienteDB.nombre)
      };
    }

    // 2. Detectar VIP por nombre
    if (pushName && /vip|cliente|frecuente|socio/i.test(pushName)) {
      return { tipo: 'CLIENTE', data: { nombre: pushName }, etiquetas: ['VIP_DETECTADO'] };
    }

    // 3. Ver historial de interacciones (simulado con Firebase)
    const historial = await this.getHistorialInteracciones(phone);
    if (historial > 0) {
      return { tipo: 'INTERESADO', nivel: historial > 3 ? 'caliente' : 'tibio' };
    }

    // 4. Frío (no contactar en grupos, sí en privado si inicia)
    return { tipo: 'FRIO' };
  }

  extraerEtiquetas(pushName, dbName) {
    const tags = [];
    if (/camilo|andres|martinez/i.test(pushName)) tags.push('STAFF');
    if (/distribuidor|vendedor/i.test(pushName)) tags.push('DISTRIBUIDOR');
    return tags;
  }

  async getHistorialInteracciones(phone) {
    // Implementar contador en Firebase
    return 0; // Placeholder
  }
}

module.exports = SegmentacionService;
