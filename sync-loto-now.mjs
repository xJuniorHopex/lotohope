// Función MANUAL: la usa el botón "Buscar resultado ahora" de la página.
// También puedes abrirla en el navegador: https://lotohope.netlify.app/.netlify/functions/sync-loto-now
import { sincronizar } from './lib/loto.mjs';

export default async () => {
  try {
    const log = await sincronizar();
    return new Response(JSON.stringify(log, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 500, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
