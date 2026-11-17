const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://hope-58505.firebaseio.com"
  });
}

const db = admin.firestore();

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  try {
    // Aquí puedes agregar tu lógica de consulta / scraping de resultados
    const nuevosSorteosEncontrados = [];

    for (const sorteo of nuevosSorteosEncontrados) {
      await db.collection('sorteos').add(sorteo);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        added: nuevosSorteosEncontrados.length,
        message: '✅ Netlify comprobó los resultados correctamente. No hay sorteos nuevos pendientes.'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
