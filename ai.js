/**
 * ════════════════════════════════════════════
 *  ai.js — Servicio Claude para Bol$illo Lleno
 *  Genera respuestas dinámicas y naturales con IA
 *  Requiere: ANTHROPIC_API_KEY en variables Railway
 * ════════════════════════════════════════════
 */

const Anthropic = require('@anthropic-ai/sdk');

// ── Validar variable de entorno ──
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY no definida — el bot usará respuestas de respaldo');
}

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Personalidades disponibles ──
const PERSONALIDADES = {
  amigo: 'Eres un amigo cercano y cálido. Generas confianza antes de vender. Usas emojis con moderación.',
  emocion: 'Eres entusiasta y emocionante. Activas la dopamina del cliente. Celebras cada decisión.',
  urgente: 'Transmites urgencia y escasez constante (FOMO). Cada mensaje tiene una razón para actuar YA.',
  pro: 'Eres profesional, preciso y ejecutivo. Hablas con datos y confianza. Sin rodeos.'
};

class AIService {

  constructor() {
    this.personalidad = 'amigo'; // puede cambiarse desde el panel
  }

  setPersonalidad(tipo) {
    if (PERSONALIDADES[tipo]) this.personalidad = tipo;
  }

  /**
   * Genera una respuesta para un mensaje de usuario.
   * Si la API falla, retorna null y logic.js usa el fallback de plantillas.
   */
  async generarRespuesta({ texto, perfil, sorteo, historial = [], isGroup, analisis }) {
    if (!client) return null;

    const system = this._buildSystem(sorteo, perfil);
    const messages = this._buildMessages(historial, texto);

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system,
        messages
      });

      const respuesta = response.content[0]?.text?.trim();
      if (!respuesta) return null;

      console.log(`[IA] Respuesta generada para ${perfil.data?.nombre || 'usuario'}`);
      return respuesta;

    } catch (err) {
      console.error('[IA] Error Anthropic API:', err.message);
      return null; // fallback a plantillas
    }
  }

  /**
   * Sugiere una respuesta rápida para el operador humano en el panel.
   * (Botón "🤖 IA suggest" en el chat del panel)
   */
  async sugerirAlOperador({ ultimoMensaje, nombre, sorteo, historial = [] }) {
    if (!client) return null;

    const system = `Eres el asistente de Bol$illo Lleno x5 (sorteos Colombia).
Sugiere UNA respuesta corta y natural al operador humano (máx 3 líneas) para responder al cliente.
Responde SOLO con el mensaje listo para enviar, sin comillas ni explicación.
Personalidad: ${PERSONALIDADES[this.personalidad]}
Sorteo activo: ${sorteo ? `${sorteo.name} · Premio: $${parseInt(sorteo.premioMayor || 0).toLocaleString()} · $${parseInt(sorteo.precioNumero || 2000).toLocaleString()}/número` : '—'}
Datos de pago: Nequi 3502429433 · Bre-B @NEQUICAM8170 · Titular: Camilo Andres Martinez Cordoba`;

    const messages = [
      ...historial.slice(-4).map(m => ({
        role: m.de === 'admin' || m.de === 'bot' ? 'assistant' : 'user',
        content: m.texto || ''
      })),
      { role: 'user', content: 'Mensaje del cliente: ' + ultimoMensaje }
    ].filter(m => m.content);

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system,
        messages: messages.length ? messages : [{ role: 'user', content: ultimoMensaje }]
      });
      return response.content[0]?.text?.trim() || null;
    } catch (err) {
      console.error('[IA] Error sugerencia operador:', err.message);
      return null;
    }
  }

  /**
   * Genera un mensaje de campaña masiva con IA.
   * (Botón "🤖 Generar con IA" en la sección Envíos del panel)
   */
  async generarMensajeCampana({ segmento, sorteo, personalidad }) {
    if (!client) return null;

    const pers = personalidad || this.personalidad;
    const contextoSegmento = {
      todos:       'clientes generales de la base de datos',
      pendientes:  'clientes con números reservados que AÚN NO han pagado',
      frecuentes:  'clientes VIP que han comprado múltiples veces',
      nuevos:      'personas que nunca han jugado con nosotros'
    }[segmento] || 'clientes';

    const system = `Eres el redactor de marketing de Bol$illo Lleno x5 (sorteos Colombia).
Crea UN mensaje de WhatsApp para: ${contextoSegmento}.
Personalidad: ${PERSONALIDADES[pers]}
Formato WhatsApp: usa *negrita*, emojis y saltos de línea.
Máx 5 líneas. Finaliza con un llamado a la acción claro.
Responde SOLO con el mensaje, sin explicaciones ni comillas.`;

    const prompt = sorteo
      ? `Sorteo: ${sorteo.name} · Premio: $${parseInt(sorteo.premioMayor || 0).toLocaleString()} · Precio: $${parseInt(sorteo.precioNumero || 2000).toLocaleString()}/número · Nequi: 3502429433`
      : 'Crea un mensaje general de reactivación de clientes.';

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: prompt }]
      });
      return response.content[0]?.text?.trim() || null;
    } catch (err) {
      console.error('[IA] Error campaña:', err.message);
      return null;
    }
  }

  // ── Privados ───────────────────────────────

  _buildSystem(sorteo, perfil) {
    const pers = PERSONALIDADES[this.personalidad];
    const tipo = perfil?.tipo || 'FRIO';
    const nombre = perfil?.data?.nombre || 'amigo';

    const contextoUsuario = {
      CLIENTE:    `Es un cliente frecuente conocido. Trátalo con familiaridad.`,
      INTERESADO: `Ha interactuado antes pero no ha comprado. Persuádelo suavemente.`,
      FRIO:       `Es nuevo. Genera confianza primero, luego vende.`
    }[tipo] || '';

    return `Eres el asistente de ventas de *Bol$illo Lleno x5*, sorteos colombianos.
Personalidad: ${pers}
Cliente: ${nombre} · Tipo: ${tipo}. ${contextoUsuario}

INFORMACIÓN DEL NEGOCIO:
• Sorteo: ${sorteo ? sorteo.name : 'próximamente'}
• Premio Mayor: ${sorteo ? '$' + parseInt(sorteo.premioMayor || 0).toLocaleString() : '—'}
• Precio por número: ${sorteo ? '$' + parseInt(sorteo.precioNumero || 2000).toLocaleString() : '—'}
• Cierre: ${sorteo ? new Date(sorteo.date).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
• Cómo funciona: el cliente elige un número del 00 al 99 y tiene 5 maneras de ganar (último 2 dígitos del premio mayor, más 4 chances adicionales)
• Pago: Nequi 3502429433 · Bre-B @NEQUICAM8170 · Titular: Camilo Andres Martinez Cordoba
• Confianza: más de 2 años pagando premios, +500 clientes felices

REGLAS IMPORTANTES:
• Responde en español, máx 5 líneas
• Usa formato WhatsApp (*negrita*, emojis moderados)
• Si preguntan el precio, siempre mencionarlo
• Si muestran interés en comprar, dar los datos de pago
• NO inventar premios ni números disponibles
• Si no sabes algo, di "Escríbeme y te ayudo 🙏"`;
  }

  _buildMessages(historial, textoActual) {
    // Incluir los últimos 6 mensajes del historial para contexto
    const msgs = historial.slice(-6).map(m => ({
      role: m.tipo === 'outgoing' ? 'assistant' : 'user',
      content: m.mensaje || ''
    })).filter(m => m.content);

    msgs.push({ role: 'user', content: textoActual });
    return msgs;
  }
}

module.exports = new AIService();
