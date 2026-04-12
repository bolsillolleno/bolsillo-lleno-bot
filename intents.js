class IntentDetector {
  constructor() {
    this.patterns = {
      compra:      /comprar|quiero|reservar|me das|disponible|precio|valor|pago|nequi|davivienda|bancolombia/i,
      cantidad:    /(\d+)\s*(numero|número|numeros|números|boletas|chances)/i,
      especifico:  /(el|la|los)\s+(\d{1,2})/i,
      // ✅ FIX #6: agregados hola|buenas|info para que saludos básicos sean MEDIA
      informacion: /como funciona|que incluye|premio|sorteo|loteria|cuando|hora|hola|buenas|info/i,
      dudas:       /seguro|confiable|garantia|estafa/i,
      negativa:    /no gracias|no quiero|para que|caro|gratis/i,
      mencion:     /bot|sistema|automatizado/i,
      urgencia:    /ya|ahora|inmediato|rapido|urgente/i
    };
  }

  analyze(text, context = {}) {
    const lower  = text.toLowerCase();
    const scores = { alta: 0, media: 0, baja: 0 };
    const entities = {};

    const cantMatch = lower.match(this.patterns.cantidad);
    if (cantMatch) { entities.cantidad = parseInt(cantMatch[1]); scores.alta += 2; }

    const numMatch = lower.match(this.patterns.especifico);
    if (numMatch) { entities.numeroPreferido = parseInt(numMatch[2]); scores.alta += 1; }

    if (this.patterns.compra.test(lower))      scores.alta  += 3;
    if (this.patterns.urgencia.test(lower))    scores.alta  += 2;
    if (this.patterns.dudas.test(lower))       scores.media += 2;
    if (this.patterns.informacion.test(lower)) scores.media += 1;
    if (this.patterns.negativa.test(lower))    scores.baja  += 3;

    let intencion = 'BAJA';
    if (scores.alta >= scores.media && scores.alta > scores.baja) intencion = 'ALTA';
    else if (scores.media > scores.baja) intencion = 'MEDIA';

    // ✅ FIX #6: mensaje sin ningún patrón (ej: "ok", "gracias", emojis)
    // → tratarlo como MEDIA para al menos responder con bienvenida en privado
    if (scores.alta === 0 && scores.media === 0 && scores.baja === 0) intencion = 'MEDIA';

    const esGrupo    = context.isGroup;
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
    // En grupos: solo responder a conocidos
    if (esGrupo && tipoUsuario === 'FRIO') return 'IGNORAR';

    if (intencion === 'ALTA') {
      // ✅ FIX #5: antes condición era `tipoUsuario !== 'FRIO'`
      // → usuarios FRIO/NUEVO en privado con "Como pago?" o "Quiero 2 numeros"
      //   recibían NO_INSISTIR. Ahora en privado SIEMPRE se atiende intención ALTA.
      if (esGrupo) return 'CIERRE_GRUPO';
      return 'CIERRE_PRIVADO';
    }

    if (intencion === 'MEDIA') {
      if (esGrupo) return 'INFORMACION_GRUPO';
      return 'PERSUASION_PRIVADO';
    }

    // BAJA en privado → despedida amable (siempre responder algo)
    if (!esGrupo) return 'NO_INSISTIR';

    return 'IGNORAR';
  }
}

module.exports = IntentDetector;
