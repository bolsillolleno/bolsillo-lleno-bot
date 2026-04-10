const { DateTime } = require('luxon');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Responses — Bol$illo Lleno x5
//  Claude genera respuestas naturales en tiempo real
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

class Responses {
  constructor(firebase) {
    this.firebase = firebase;
    // Historial de conversación por JID (últimos 10 mensajes)
    this.historiales = new Map();
  }

  // ─────────────────────────────────────────────
  //  Construir system prompt con contexto completo
  // ─────────────────────────────────────────────
  buildSystemPrompt(sorteo, perfil, isGroup) {
    const precio = parseInt(sorteo.precioNumero).toLocaleString('es-CO');
    const premio = parseInt(sorteo.premioMayor).toLocaleString('es-CO');
    const cierre = DateTime.fromISO(sorteo.date)
      .setZone('America/Bogota')
      .toFormat("dd 'de' MMMM 'a las' hh:mm a", { locale: 'es' });

    return `Eres el bot de ventas de *Bol$illo Lleno x5*, una rifa colombiana administrada por Camilo Andres Martinez Cordoba. Tu objetivo es vender números del sorteo activo de forma natural, cálida y persuasiva — como lo haría Camilo mismo por WhatsApp.

═══ INFORMACIÓN DEL SORTEO ACTIVO ═══
- Nombre: ${sorteo.name}
- Premio mayor: $${premio} COP
- Precio por número: $${precio} COP
- Cierra: ${cierre}
- Números del 00 al 99 (2 dígitos)
- Con un número tienes 5 formas de ganar: premio mayor, seco 1, seco 2, seco 3, e invertidas

═══ DATOS DE PAGO ═══
- Nequi: 3502429433
- Bre-B: @NEQUICAM8170
- Titular: Camilo Andres Martinez Cordoba
- El cliente manda el comprobante por privado y Camilo confirma

═══ PERFIL DEL CLIENTE ═══
- Tipo: ${perfil.tipo} (CLIENTE = ya ha comprado antes | INTERESADO = ha preguntado | FRIO = nuevo)
- Nombre: ${perfil.data?.nombre || 'desconocido'}

═══ CONTEXTO ═══
- Canal: ${isGroup ? 'Grupo de WhatsApp (372 miembros)' : 'Chat privado'}
- En grupo: respuestas cortas y con gancho, invitar al privado para cerrar
- En privado: puedes extenderte más, cerrar la venta directo

═══ REGLAS DE RESPUESTA ═══
1. Habla en español colombiano natural y cálido, como Camilo
2. Usa emojis con moderación (máximo 3-4 por mensaje)
3. Mensajes cortos en grupo (máx 5 líneas), más completos en privado
4. Si el cliente quiere comprar y dice cuántos números quiere, confirma la reserva con entusiasmo y da los datos de pago
5. Si tiene dudas de confianza, menciona los años de trayectoria y pagos garantizados
6. Si dice que está caro, ofrece el combo 3+1 o empezar con 1 solo número
7. Si dice que no quiere, despídete amablemente y deja la puerta abierta
8. NUNCA inventes números asignados — cuando el sistema confirme la asignación, esos números ya vienen en el contexto
9. Si no hay sorteo activo, dilo honestamente y di que avisas cuando abra uno
10. No uses asteriscos para negrita dentro de comillas de diálogo — solo para énfasis real`;
  }

  // ─────────────────────────────────────────────
  //  Llamada principal a Claude
  // ─────────────────────────────────────────────
  async generate({ jid, mensaje, sorteo, perfil, isGroup, accion, datosExtra = {} }) {
    // Construir historial del chat
    const historial = this.historiales.get(jid) || [];

    // Mensaje del usuario enriquecido con contexto de acción
    let userContent = mensaje;
    if (accion === 'CIERRE_PRIVADO' || accion === 'CIERRE_GRUPO') {
      const { numeros, total, cantidad } = datosExtra;
      userContent = `[SISTEMA: El cliente quiere comprar ${cantidad} número(s). El sistema YA asignó los números: ${numeros?.join(', ')}. Total a pagar: $${total?.toLocaleString('es-CO')}. Confirma la reserva con entusiasmo, muestra los números asignados y da los datos de pago.]`;
    }
    if (accion === 'NO_SORTEO') {
      userContent = `[SISTEMA: No hay sorteo activo. El cliente preguntó: "${mensaje}". Informa amablemente.]`;
    }

    const messages = [
      ...historial,
      { role: 'user', content: userContent }
    ];

    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          system: this.buildSystemPrompt(sorteo, perfil, isGroup),
          messages
        })
      });

      const data = await res.json();

      if (data.error) {
        console.error('❌ Claude API error:', data.error);
        return this.fallback(accion, sorteo, perfil, datosExtra);
      }

      const respuesta = data.content?.[0]?.text || this.fallback(accion, sorteo, perfil, datosExtra);

      // Guardar historial (máx 10 turnos = 20 mensajes)
      historial.push(
        { role: 'user',      content: mensaje },
        { role: 'assistant', content: respuesta }
      );
      if (historial.length > 20) historial.splice(0, 2);
      this.historiales.set(jid, historial);

      return respuesta;

    } catch (err) {
      console.error('❌ Error llamando Claude:', err);
      return this.fallback(accion, sorteo, perfil, datosExtra);
    }
  }

  // ─────────────────────────────────────────────
  //  Fallback si Claude falla (plantillas básicas)
  // ─────────────────────────────────────────────
  fallback(accion, sorteo, perfil, datosExtra = {}) {
    const precio = parseInt(sorteo?.precioNumero || 0).toLocaleString('es-CO');
    const premio = parseInt(sorteo?.premioMayor  || 0).toLocaleString('es-CO');
    const nombre = perfil?.data?.nombre?.split(' ')[0] || 'amigo';

    switch (accion) {
      case 'CIERRE_PRIVADO':
      case 'CIERRE_GRUPO': {
        const { numeros = [], total = 0 } = datosExtra;
        return `✅ *¡Reserva lista ${nombre}!*\n\n🔢 Tus números: *${numeros.join(', ')}*\n💰 Total: *$${total.toLocaleString('es-CO')}*\n\n💚 Nequi: 3502429433\n👤 Camilo Andres Martinez Cordoba\n\nMándame el comprobante y confirmo 🙏`;
      }
      case 'PERSUASION_PRIVADO':
        return `🍀 *${nombre}*, con $${precio} tienes 5 formas de ganar *$${premio}*.\n\n¿Te animas con uno? 💪`;
      case 'INFORMACION_GRUPO':
        return `🍀 *Bol$illo Lleno x5* — Premio *$${premio}*\n💰 $${precio} por número · 5 formas de ganar\nEscríbeme al privado para reservar 👇`;
      case 'NO_SORTEO':
        return `⏰ Ahorita no tenemos sorteo abierto. Te aviso en cuanto abramos el próximo 🍀`;
      default:
        return `👋 Hola *${nombre}*! Somos *Bol$illo Lleno x5*.\nPremio: *$${premio}* · Precio: $${precio}/número\n¿Te interesa? 🍀`;
    }
  }

  // ─────────────────────────────────────────────
  //  Limpiar historial de un JID (logout, etc.)
  // ─────────────────────────────────────────────
  clearHistorial(jid) {
    this.historiales.delete(jid);
  }
}

module.exports = Responses;
