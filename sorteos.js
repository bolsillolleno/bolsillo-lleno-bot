const { DateTime } = require('luxon');

class SorteosService {
  constructor(firebase) {
    this.firebase = firebase;
  }

  // ✅ FIX #12 — sorteoData se recibe como parámetro, no se consulta de nuevo
  // ✅ FIX #8  — usa transacciones Firebase para evitar race conditions
  async asignarNumeros(sorteoId, cantidad, clienteData, sorteoData) {
    const { occupied, pending } = await this.firebase.getNumerosSorteo(sorteoId);
    const tomados = new Set([...Object.keys(occupied), ...Object.keys(pending)]);
    
    // Disponibles en este momento
    const disponibles = [];
    for (let i = 0; i < 100; i++) {
      const num = i.toString().padStart(2, '0');
      if (!tomados.has(num)) disponibles.push(num);
    }

    if (disponibles.length < cantidad) {
      throw new Error(`Solo quedan ${disponibles.length} números disponibles`);
    }

    // Seleccionar candidatos (evitar consecutivos en grupos para prueba social)
    const candidatos = this._seleccionarCandidatos(disponibles, cantidad, clienteData.source);

    // ✅ FIX #8 — reservar con transacción atómica para evitar duplicados
    const reservas = [];
    for (const num of candidatos) {
      const exitoso = await this._reservarConTransaccion(sorteoId, num, {
        ...clienteData,
        reservadoEn: DateTime.now().toISO()
      });

      if (exitoso) {
        reservas.push(num);
      } else {
        // El número fue tomado por otro en paralelo — buscar siguiente disponible
        console.warn(`[SORTEOS] Race condition detectada en ${num}, buscando alternativa`);
        const alternativa = await this._buscarAlternativa(sorteoId, tomados, reservas);
        if (alternativa) {
          reservas.push(alternativa);
        } else {
          throw new Error('Sin números disponibles durante la asignación');
        }
      }

      if (reservas.length >= cantidad) break;
    }

    // ✅ FIX #12 — usar sorteoData pasado como parámetro (evita consulta extra)
    const precio = parseInt(sorteoData?.precioNumero || 2000);

    return {
      numeros: reservas,
      total: reservas.length * precio,
      expiraEn: DateTime.now().plus({ hours: 2 }).toISO()
    };
  }

  // ✅ FIX #8 — transacción Firebase: garantiza atomicidad
  async _reservarConTransaccion(sorteoId, num, clienteData) {
    const ref = this.firebase.db.ref(`pending/${sorteoId}/${num}`);
    
    const result = await ref.transaction(current => {
      // Si ya existe, abortar (retornar undefined cancela la transacción)
      if (current !== null) return undefined;
      // Si está libre, reservar
      return clienteData;
    });

    return result.committed; // true = reservado OK, false = ya estaba tomado
  }

  // Buscar un número alternativo si hubo race condition
  async _buscarAlternativa(sorteoId, tomadosOriginal, yaReservados) {
    const { occupied, pending } = await this.firebase.getNumerosSorteo(sorteoId);
    const ahora = new Set([
      ...Object.keys(occupied),
      ...Object.keys(pending),
      ...yaReservados
    ]);
    for (let i = 0; i < 100; i++) {
      const num = i.toString().padStart(2, '0');
      if (!ahora.has(num)) return num;
    }
    return null;
  }

  _seleccionarCandidatos(disponibles, cantidad, source) {
    const usados = new Set();
    const seleccionados = [];

    for (let i = 0; i < cantidad; i++) {
      let candidatos = disponibles.filter(n => !usados.has(n));

      if (i > 0 && source === 'grupo_whatsapp') {
        const ultimo = parseInt(seleccionados[i - 1]);
        const espaciados = candidatos.filter(n => Math.abs(parseInt(n) - ultimo) > 5);
        if (espaciados.length > 0) candidatos = espaciados;
      }

      const elegido = candidatos[Math.floor(Math.random() * candidatos.length)];
      if (!elegido) break;
      seleccionados.push(elegido);
      usados.add(elegido);
    }

    return seleccionados;
  }

  async confirmarPago(sorteoId, numero, comprobanteUrl = null) {
    await this.firebase.confirmarPago(sorteoId, numero);
    return { success: true, numero };
  }
}

module.exports = SorteosService;
