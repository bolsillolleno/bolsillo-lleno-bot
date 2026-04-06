const { DateTime } = require('luxon');

class Responses {
  constructor(firebase) {
    this.firebase = firebase;
  }

  bienvenida({ sorteo, perfil }) {
    const esCliente = perfil.tipo === 'CLIENTE';
    const saludo = esCliente ? '¡Qué alegría verte de nuevo!' : '¡Bienvenido!';
    
    return `👋 *${saludo} ${perfil.data?.nombre?.split(' ')[0] || 'amigo'}!*

🍀 *Bol$illo Lleno x5* — Donde un número te da *5 oportunidades de ganar*

🏆 *Sorteo activo:* ${sorteo.name}
💰 Premio Mayor: *$${parseInt(sorteo.premioMayor).toLocaleString()}*
⏰ Cierra: *${DateTime.fromISO(sorteo.date).toFormat('dd/MM HH:mm')}*

*¿Cómo funciona?* Es sencillo:
• Compras tu número del 00 al 99
• Ganas con las *últimas 2 cifras* del premio mayor
• Y tienes *4 chances más* (seco 1, 2, 3, invertidas)

💚 *Precio:* $${parseInt(sorteo.precioNumero).toLocaleString()} por número

*Responde:*
*1* → Ver números disponibles
*2* → Comprar ahora
*3* → Ver promociones

¡Que Dios te bendiga en este juego! 🙏✨`;
  }

  cierreGrupo({ nombre, cantidad, numeros, sorteo, total }) {
    const numsStr = numeros.map(n => `*${n}*`).join(', ');
    
    return `🎉 *¡RESERVA CONFIRMADA!* 🎉

👤 ${nombre} acaba de asegurar ${cantidad} número${cantidad > 1 ? 's' : ''}:
🔢 ${numsStr}

💰 Total a pagar: *$${total.toLocaleString()}*

⏰ Tienes *2 horas* para pagar o se liberan.

💚 *Nequi:* 3502429433
🔑 *Bre-B:* @NEQUICAM8170
👤 *Titular:* Camilo Andres Martinez Cordoba

Mándame el comprobante por *privado* y te confirmo 🙏

¡Felicidades! Que te toque ese premio 🍀✨`;
  }

  cierrePrivado({ nombre, cantidad, numeros, sorteo, total }) {
    const numsStr = numeros.map(n => `*${n}*`).join(', ');
    
    return `🎊 *¡LISTO ${nombre.toUpperCase()}!* 🎊

Tus números están *RESERVADOS*:
🔢 ${numsStr}

💰 Valor: *$${total.toLocaleString()}*
⏰ Paga en máximo *2 horas*

*Métodos de pago:*
💚 *Nequi:* 3502429433
🔑 *Bre-B:* @NEQUICAM8170
👤 *Titular:* Camilo Andres Martinez Cordoba

*Importante:* Mándame el *pantallazo del pago* por aquí y te confirmo al toque ✅

Recuerda: con estos números tienes *5 maneras de ganar* 🤑

🙏 *Dios te bendiga y mucha suerte* 🍀`;
  }

  persuasion({ sorteo, perfil, entities }) {
    const dudas = [
      "💚 *100% confiable* — Llevamos más de 2 años pagando premios todos los días",
      "🏆 *Premios garantizados* — Basados en la lotería oficial Sinuano",
      "⚡ *Pago inmediato* — En menos de 1 hora después del sorteo",
      "👥 *+500 clientes felices* — Únete a la familia Bol$illo Lleno"
    ];

    return `🤔 *Entiendo que quieres pensarlo, ${perfil.data?.nombre?.split(' ')[0] || 'amigo'}*

Déjame contarte por qué *más de 500 personas* juegan con nosotros:

${dudas.slice(0, 3).join('\n\n')}

🎁 *PROMO ESPECIAL:* Si compras *3 números*, te regalo *1 más*

¿Te animas con uno solo para probar? Solo *$${parseInt(sorteo.precioNumero).toLocaleString()}* 🍀

Responde *2* para comprar o *1* para ver disponibles`;
  }

  verNumeros(sorteo) {
    return `🔢 *NÚMEROS DISPONIBLES — ${sorteo.name}*

Te los muestro en el panel web (más fácil):
🔗 https://bolsillolleno.github.io/SorteosBolsilloLleno/

O dime: *"Quiero el [número]"* y te digo si está libre 👇

Ejemplo: *"Quiero el 23"*

💡 *Consejo:* Los números del 00 al 20 se agregan rápido 🔥`;
  }

  menuCompra(sorteo) {
    return `💰 *COMPRAR NÚMEROS*

¿Cuántos quieres?

*1 número* → $${parseInt(sorteo.precioNumero).toLocaleString()}
*3 números* → $${(parseInt(sorteo.precioNumero) * 3).toLocaleString()} (te regalo 1 más 🎁)
*5 números* → $${(parseInt(sorteo.precioNumero) * 5).toLocaleString()} (te regalo 2 más 🎁🎁)

Dime: *"Quiero [cantidad] números"* o el número específico que deseas 👇`;
  }

  promociones(sorteo) {
    return `🎁 *PROMOCIONES ACTIVAS*

1️⃣ *Combo 3+1* — Compra 3, lleva 4
2️⃣ *Combo 5+2* — Compra 5, lleva 7  
3️⃣ *Cliente frecuente* — 10% descuento en tu 5ta compra

🏆 *Además:* Si traes un amigo y compra, *tú ganas un número gratis*

¿Cuál te interesa? Responde *1*, *2* o *3* 👇`;
  }

  infoGrupo({ sorteo, perfil }) {
    return `🍀 *Bol$illo Lleno x5* — Sorteos Bendecidos

🏆 *Próximo sorteo:* ${sorteo.name}
💰 Premio: *$${parseInt(sorteo.premioMayor).toLocaleString()}*
⏰ Cierra: *${DateTime.fromISO(sorteo.date).toFormat('dd/MM HH:mm')}*

*¿Por qué jugar aquí?*
✅ 5 maneras de ganar con 1 número
✅ Pagos inmediatos por Nequi
✅ Más de 2 años de confianza
✅ +500 ganadores felices

💚 *Nequi:* 3502429433
👤 *Camilo Andres Martinez Cordoba*

*Escríbeme al privado* para reservar tu número 🙏✨`;
  }

  reactivacionGrupo({ sorteo }) {
    const urgencias = [
      "🔥 *Solo quedan 15 números disponibles*",
      "⏰ *Cierra en 2 horas* y aún hay premios por ganar",
      "💰 *Última hora:* 3 personas están por pagar sus números"
    ];
    
    return `👋 *¿Alguien más quiere suerte hoy?*

${urgencias[Math.floor(Math.random() * urgencias.length)]}

🏆 *${sorteo.name}*
💰 *$${parseInt(sorteo.premioMayor).toLocaleString()}* en premios

*¿Todavía estás a tiempo?* Escribe *"Quiero"* y te reservo el mejor disponible 🍀

💚 Nequi: 3502429433`;
  }

  despedidaAmable() {
    return `🙏 *Perfecto, no hay problema*

Si en algún momento quieres probar suerte, aquí estaré.

*Dios te bendiga* y que tengas un excelente día 🍀✨

— *Bol$illo Lleno x5*`;
  }
}

module.exports = Responses;
