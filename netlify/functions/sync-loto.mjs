import { runSync } from "../lib/sync-loto-core.mjs";

export default async function handler(req) {
  // Solo permitir POST (el boton usa POST) y GET para probar en el navegador
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Metodo no permitido." }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
  try {
    const result = await runSync();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("LotHope sync error:", error);
    return new Response(JSON.stringify({ error: error.message || "Error interno al sincronizar." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
}
