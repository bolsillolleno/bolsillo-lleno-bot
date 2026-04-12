// Ya incluye el manejo de NUEVO en determinarAccion — ver archivo generado
// Este archivo reemplaza intents.js con soporte para tipo NUEVO desde segmentacion
const { DateTime } = require('luxon');

class IntentDetector {
  constructor() {
    this.patterns = {
      compra: /comprar|quiero|reservar|me das|disponible|precio|valor|pago|nequi|davivienda|bancolombia/i,
      cantidad: /(\d+)\s*(numero|número|numeros|números|boletas|chances)/i,
      especifico: /(el|la|los)\s+(\d{1,2})/i,
      informacion: /como funciona|que incluye|premio|sorteo|loteria|cuando|hora|hola|buenas|info/i,
      dudas: /seguro|confiable|garantia|estafa/i,
      negativa: /no gracias|no quiero|para que|caro|gratis/i,
      mencion: /bot|sistema|automatizado/i,
      urgencia: /ya|ahora|inmediato|rapido|urgente/i
    };
  }

  analyze(text, context = {}) {
    const lower = text.toLowerCase();
    const scores = { alta: 0, media: 0, baja: 0 };
    const entities = {};

    const cantMatch = lower.match(this.patterns.cantidad);
    if (cantMatch) {
      entities.cantidad = parseInt(cantMatch[1]);
      scores.alta += 2;
    }

    const numMatch = lower.match(this.patterns.especifico);
    if (numMatch) {
      entities.numeroPreferido = parseInt(numMatch[2]);
      scores.alta += 1;
    }

    if (this.patterns.compra.test(lower)) scores.alta += 3;
    if (this.patterns.urgencia.test(lower)) scores.alta += 2;
    if (this.patterns.dudas.test(lower)) scores.media += 2;
    if (this.patterns.informacion.test(lower)) scores.media += 1;
    if (this.patterns.negativa.test(lower)) scores.baja += 3;

    let intencion = 'BAJA';
    if (scores.alta >= scores.media && scores.alta > scores.baja) intencion = 'ALTA';
    else if (scores.media > scores.baja) intencion = 'MEDIA';

    // Sin ningún score (ej: "Hola") → tratar como MEDIA
    if (scores.alta === 0 && scores.media === 0 && scores.baja === 0) {
      intencion = 'MEDIA';
    }

    const esGrupo = context.isGroup;
    const loMencionan = this.patterns.mencion.test(lower) || context.mentioned;

    return {
      intencion,
      scores,
      entities,
      esGrupo,
      loMencionan,
      requiereRespuesta: esGrupo ? loMencionan : true,
      accionRecomendada: this.determinarAccion(intencion, esGrupo, context.tipoUsuario)
    };
  }

  determinarAccion(intencion, esGrupo, tipoUsuario) {
    // Grupos: solo responder a usuarios conocidos o que mencionan el bot
    if (esGrupo && tipoUsuario === 'FRIO') return 'IGNORAR';

    if (intencion === 'ALTA') {
      // ✅ CORREGIDO: en privado siempre cerrar, sin importar si es FRIO/NUEVO
      if (esGrupo) return 'CIERRE_GRUPO';
      return 'CIERRE_PRIVADO';
    }

    if (intencion === 'MEDIA') {
      if (esGrupo) return 'INFORMACION_GRUPO';
      return 'PERSUASION_PRIVADO';
    }

    // BAJA en privado → al menos una despedida amable
    if (!esGrupo) return 'NO_INSISTIR';

    return 'IGNORAR';
  }
}

module.exports = IntentDetector;
