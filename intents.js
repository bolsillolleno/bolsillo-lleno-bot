const { DateTime } = require('luxon');

class IntentDetector {
  constructor() {
    this.patterns = {
      // ALTA intención
      compra: /comprar|quiero|reservar|me das|disponible|precio|valor|pago|nequi|davivienda|bancolombia/i,
      cantidad: /(\d+)\s*(numero|número|numeros|números|boletas|chances)/i,
      especifico: /(el|la|los)\s+(\d{1,2})/i,
      
      // MEDIA intención
      informacion: /como funciona|que incluye|premio|sorteo|loteria|cuando|hora/i,
      dudas: /seguro|confiable|garantia|estafa/i,
      
      // Baja/Rechazo
      negativa: /no gracias|no quiero|para que|caro|gratis/i,
      
      // Contexto grupo
      mencion: /bot|sistema|automatizado/i,
      
      // Cierre
      urgencia: /ya|ahora|inmediato|rapido|urgente/i
    };
  }

  analyze(text, context = {}) {
    const lower = text.toLowerCase();
    const scores = { alta: 0, media: 0, baja: 0 };
    const entities = {};

    // Detectar cantidad
    const cantMatch = lower.match(this.patterns.cantidad);
    if (cantMatch) {
      entities.cantidad = parseInt(cantMatch[1]);
      scores.alta += 2;
    }

    // Detectar número específico
    const numMatch = lower.match(this.patterns.especifico);
    if (numMatch) {
      entities.numeroPreferido = parseInt(numMatch[2]);
      scores.alta += 1;
    }

    // Intenciones de compra
    if (this.patterns.compra.test(lower)) scores.alta += 3;
    if (this.patterns.urgencia.test(lower)) scores.alta += 2;
    
    // Dudas
    if (this.patterns.dudas.test(lower)) scores.media += 2;
    if (this.patterns.informacion.test(lower)) scores.media += 1;
    
    // Negativa
    if (this.patterns.negativa.test(lower)) scores.baja += 3;

    // Determinar categoría dominante
    let intencion = 'BAJA';
    if (scores.alta >= scores.media && scores.alta > scores.baja) intencion = 'ALTA';
    else if (scores.media > scores.baja) intencion = 'MEDIA';

    // Contexto grupo vs privado
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
    // Reglas de decisión Fase 15
    if (tipoUsuario === 'FRIO' && esGrupo) return 'IGNORAR';
    
    if (intencion === 'ALTA' && tipoUsuario !== 'FRIO') {
      if (esGrupo) return 'CIERRE_GRUPO';
      return 'CIERRE_PRIVADO';
    }
    
    if (intencion === 'MEDIA') {
      return esGrupo ? 'INFORMACION_GRUPO' : 'PERSUASION_PRIVADO';
    }
    
    return 'NO_INSISTIR';
  }
}

module.exports = IntentDetector;
