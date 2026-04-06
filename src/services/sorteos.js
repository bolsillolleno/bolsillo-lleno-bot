const { DateTime } = require('luxon');

class SorteosService {
  constructor(firebase) {
    this.firebase = firebase;
  }

  async asignarNumeros(sorteoId, cantidad, clienteData) {
    const { occupied, pending } = await this.firebase.getNumerosSorteo(sorteoId);
    const tomados = new Set([...Object.keys(occupied), ...Object.keys(pending)]);
    
    // Generar números preferidos o aleatorios
    const disponibles = [];
    for (let i = 0; i < 100; i++) {
      const num = i.toString().padStart(2, '0');
      if (!tomados.has(num)) disponibles.push(num);
    }

    if (disponibles.length < cantidad) {
      throw new Error(`Solo quedan ${disponibles.length} números disponibles`);
    }

    // Seleccionar números (preferencia por no consecutivos para grupos)
    const seleccionados = [];
    const usados = new Set();
    
    for (let i = 0; i < cantidad; i++) {
      // Estrategia: evitar consecutivos si es para grupo (prueba social)
      let candidatos = disponibles.filter(n => !usados.has(n));
      
      if (i > 0 && clienteData.source === 'grupo_whatsapp') {
        // Evitar consecutivos en grupos para que se vean más "repartidos"
        const ultimo = parseInt(seleccionados[i-1]);
        candidatos = candidatos.filter(n => {
          const num = parseInt(n);
          return Math.abs(num - ultimo) > 5;
        });
      }
      
      const elegido = candidatos[Math.floor(Math.random() * candidatos.length)];
      seleccionados.push(elegido);
      usados.add(elegido);
    }

    // Guardar en pending
    const reservas = [];
    for (const num of seleccionados) {
      await this.firebase.reservarNumero(sorteoId, num, {
        ...clienteData,
        reservadoEn: DateTime.now().toISO()
      });
      reservas.push(num);
    }

    // Obtener precio del sorteo
    const sorteos = await this.firebase.getSorteosActivos();
    const sorteo = sorteos.find(s => s.id === sorteoId);
    const precio = parseInt(sorteo?.precioNumero || 2000);
    
    return {
      numeros: reservas,
      total: cantidad * precio,
      expiraEn: DateTime.now().plus({ hours: 2 }).toISO()
    };
  }

  async confirmarPago(sorteoId, numero, comprobanteUrl = null) {
    await this.firebase.confirmarPago(sorteoId, numero);
    return { success: true, numero };
  }
}

module.exports = SorteosService;
