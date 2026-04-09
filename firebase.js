const admin = require('firebase-admin');

// ── Validar variables de entorno antes de arrancar ──
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ FATAL: La variable FIREBASE_SERVICE_ACCOUNT no está definida en Railway.');
  console.error('   Ve a Railway → tu servicio → Variables y agrégala.');
  process.exit(1);
}

if (!process.env.FIREBASE_DB_URL) {
  console.error('❌ FATAL: La variable FIREBASE_DB_URL no está definida en Railway.');
  console.error('   Ejemplo: https://tu-proyecto-default-rtdb.firebaseio.com');
  process.exit(1);
}

let serviceAccount;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  serviceAccount = JSON.parse(raw);

  // Railway a veces escapa los saltos de línea de la private_key como \\n
  // Esto los convierte de vuelta en \n reales para que Firebase los acepte
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (err) {
  console.error('❌ FATAL: FIREBASE_SERVICE_ACCOUNT no es un JSON válido.');
  console.error('   Asegurate de pegar el contenido completo del archivo serviceAccountKey.json');
  process.exit(1);
}

// Evitar inicializar dos veces si algún módulo requiere este archivo más de una vez
if (!admin.apps.length) {
  admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
  });
}

module.exports = admin;
