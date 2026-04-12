const { DateTime } = require('luxon');

class IntentDetector {
  constructor() {
    this.patterns = {
      compra: /comprar|quiero|reservar|me das|disponible|precio|valor|pago|nequi|davivienda|bancolombia/i,
      cantidad: /(\d+)\s*(numero|número|numeros|números|boletas|chances)/i,
      especifico: /(el|la|los)\s+(\d{1,2})/i,
      informacion: /como funciona|que incluye|premio|sorteo|loteria|cuando|hora/i,
      dudas: /seguro|confiable|garantia|estafa/i,
      negativa: /no gracias|no quiero|para que|caro|gratis/i,
      mencion: /bot|sistema|automatizado/i,
      urgencia: /ya|ahora|inmediato|rapido|urgente/i,
      // ✅ Saludo genérico — indica contacto nuevo / inicio de conversación
      saludo: /^(hola|hi|hey|buenas|buenos|buen|ola|saludos|test|probando|holi|holaa|holiii|que hay|quiubo)[\s!.?]*$/i
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

    // ✅ Detectar saludo explícito
    const esSaludo = this.patterns.saludo.test(lower.trim());

    let intencion = 'BAJA';
    if (scores.alta >= scores.media && scores.alta > scores.baja) intencion = 'ALTA';
    else if (scores.media > scores.baja) intencion = 'MEDIA';

    const esGrupo = context.isGroup;
    const loMencionan = this.patterns.mencion.test(lower) || context.mentioned;

    return {
      intencion,
      scores,
      entities,
      esGrupo,
      loMencionan,
      esSaludo,
      requiereRespuesta: esGrupo ? loMencionan : true,
      accionRecomendada: this.determinarAccion(intencion, esGrupo, context.tipoUsuario, esSaludo)
    };
  }

  determinarAccion(intencion, esGrupo, tipoUsuario, esSaludo = false) {
    // Ignorar usuarios fríos en grupos (nunca interrumpir grupos)
    if (tipoUsuario === 'FRIO' && esGrupo) return 'IGNORAR';

    // ✅ BUG #7 FIX: saludos simples y usuarios nuevos en privado → bienvenida
    // Antes: 'FRIO' + 'BAJA' + privado → 'NO_INSISTIR' (enviaba mensaje de despedida a alguien que solo dijo "hola")
    if (esSaludo || (tipoUsuario === 'FRIO' && intencion === 'BAJA' && !esGrupo)) {
      return 'BIENVENIDA';
    }

    if (intencion === 'ALTA' && tipoUsuario !== 'FRIO') {
      if (esGrupo) return 'CIERRE_GRUPO';
      return 'CIERRE_PRIVADO';
    }

    if (intencion === 'ALTA' && tipoUsuario === 'FRIO') {
      // Frío con alta intención en privado → persuadir primero
      return esGrupo ? 'IGNORAR' : 'PERSUASION_PRIVADO';
    }

    if (intencion === 'MEDIA') {
      return esGrupo ? 'INFORMACION_GRUPO' : 'PERSUASION_PRIVADO';
    }

    return 'NO_INSISTIR';
  }
}

module.exports = IntentDetector;
