// sync-loto-core.mjs - CORREGIDO
// Cambios vs version de GPT:
// 1) Mercado: se agrega el slug NUEVO (resultados-de-las-loterias-del-...) + el viejo como respaldo.
// 2) Parser: ya no toma el primer "Loto:" de la pagina. Busca la fila cuya fecha
//    coincida con el sorteo (14-11-26) y solo de ahi extrae los numeros.
// 3) Parser: soporta los 3 formatos reales de hoy:
//    - CDN:    "Loto: 10, 20, 24, 27, 37, 39   Loto Mas: 11, 04"
//    - Mercado nuevo: "Loto - Super Loto Mas | 10 - 20 - 24 - 27 - 37 - 39 - 11 - 04" (8 numeros)
//    - Mercado viejo / otros: "Loto Mas: 11" + "Super Mas: 04"
// 4) Fetch con headers de navegador real (CDN/Cloudflare bloquea el UA por defecto
//    de Node) + devuelve el status HTTP en el error para que veas en los logs
//    de Netlify si fue 403, 404 o error de parseo.
// 5) Validacion de Mas/Super Mas con null explicito (el bug "null < 1 === true" en JS).

const PROJECT_ID = "hope-58505";
const API_KEY = "AIzaSyATHAwacAzURuh-Rofy3CXevhuWlqNU-JI";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function datePartsRD(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santo_Domingo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}
function isoUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function drawDates(lastDate) {
  const p = datePartsRD();
  const today = `${p.year}-${p.month}-${p.day}`;
  const localMinutes = Number(p.hour) * 60 + Number(p.minute);
  const anchor = new Date(`${today}T12:00:00Z`);
  const found = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    const key = isoUTC(d);
    const weekday = d.getUTCDay();
    const isDrawDay = weekday === 3 || weekday === 6;
    const passedCutoff = key < today || (key === today && localMinutes >= 21 * 60 + 10);
    if (isDrawDay && passedCutoff && key > (lastDate || "")) found.push(key);
  }
  return found;
}

// --- URLs ---
function articleUrls(key) {
  const [y, m, d] = key.split("-").map(Number);
  const month = MONTHS[m - 1].toLowerCase();
  const cdnDay = String(d).padStart(2, "0");
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const day = weekday === 3 ? "miercoles" : "sabado";
  const cdn = `https://cdn.com.do/evergreen/resultados-leidsa-numeros-ganadores-del-${cdnDay}-de-${month}-de-${y}/`;
  // Mercado CAMBIO de slug en 2026: primero el nuevo, luego el viejo
  const mercadoNuevo = `https://revistamercado.do/actualidad/resultados-de-las-loterias-del-${d}-de-${month}-de-${y}-en-republica-dominicana/`;
  const mercadoViejo = `https://revistamercado.do/actualidad/resultados-de-leidsa-del-${day}-${d}-de-${month}-de-${y}-en-republica-dominicana/`;
  return [cdn, mercadoNuevo, mercadoViejo, mercadoNuevo.replace(/-en-republica-dominicana\/$/, "/")];
}

// --- Parser ---
function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

function parseNumbers(str) {
  const nums = [...new Set((str.match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
  if (nums.length !== 6 || nums.some(n => n < 1 || n > 40)) return null;
  return nums;
}

// Extrae Mas / Super Mas de un fragmento de texto
function parseExtras(fragment) {
  // Formato Mercado nuevo: 8 numeros seguidos ya separados por el llamador.
  // Aqui solo buscamos los formatos con etiqueta:
  const combined = fragment.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})\s*[,/\-]\s*(\d{1,2})/i);
  if (combined) return { m: Number(combined[1]), s: Number(combined[2]) };
  const mm = fragment.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})/i);
  const sm = fragment.match(/S[úu]per\s*M[áa]s\s*:\s*(\d{1,2})/i);
  // "Super Loto Mas: 11 - 04" tambien cae aqui si viene con guion
  return {
    m: mm ? Number(mm[1]) : null,
    s: sm ? Number(sm[1]) : null,
  };
}

function parseResult(html, dateKey) {
  const text = cleanHtml(html);
  const [y, m, d] = dateKey.split("-").map(Number);
  const shortDate = `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${String(y).slice(2)}`; // 14-11-26

  // 1) Formato MERCADO NUEVO: "Loto - Super Loto Mas | 10 - 20 - 24 - 27 - 37 - 39 - 11 - 04"
  //    Buscamos la fila que contenga esa etiqueta y 8 numeros.
  const mercado8 = text.match(/Loto\s*[–\-–]\s*(?:Super\s+)?Loto\s*M[áa]s[^0-9]{0,10}((?:\d{1,2}\D{1,5}){7}\d{1,2})/i);
  if (mercado8) {
    const all = (mercado8[1].match(/\d+/g) || []).map(Number);
    if (all.length === 8) {
      const n = [...all.slice(0, 6)].sort((a, b) => a - b);
      const m = all[6], s = all[7];
      if (n.length === 6 && m >= 1 && m <= 12 && s >= 1 && s <= 15) return { n, m, s };
    }
  }

  // 2) Formato CDN: "Loto: 10, 20, 24, 27, 37, 39   Loto Mas: 11, 04"
  //    Buscamos TODAS las ocurrencias y nos quedamos con la que esta cerca
  //    de la fecha del sorteo, no con la primera de la pagina.
  const lotoRe = /Loto\s*:\s*((?:\d{1,2}\D{1,8}){5}\d{1,2})/gi;
  let match;
  let fallback = null;
  while ((match = lotoRe.exec(text)) !== null) {
    const nums = parseNumbers(match[1]);
    if (!nums) continue;
    // Ventana de ~120 caracteres alrededor: debe mencionar la fecha del sorteo
    // o estar dentro de la fila "Loto - Loto Mas | 14-11-26"
    const start = Math.max(0, match.index - 200);
    const end = Math.min(text.length, match.index + match[0].length + 200);
    const ctx = text.slice(start, end);
    const hasDate = ctx.includes(shortDate) || ctx.includes(dateKey);
    const extras = parseExtras(ctx);
    let { m, s } = extras;
    // Validacion explicita con null (NO "m < 1" cuando m es null)
    if (m == null || s == null || m < 1 || m > 12 || s < 1 || s > 15) { m = null; s = null; }
    const result = { n: nums, m, s };
    if (hasDate) return result;
    if (!fallback) fallback = result;
  }
  return fallback;
}

async function getLatestDate() {
  const response = await fetch(`${FIRESTORE}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Referer": "https://lotohope.netlify.app/" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "sorteos" }],
        orderBy: [{ field: { fieldPath: "d" }, direction: "DESCENDING" }],
        limit: 1
      }
    })
  });
  if (!response.ok) throw new Error(`Firestore no permitio consultar el historial (${response.status}).`);
  const rows = await response.json();
  return rows.find(x => x.document)?.document?.fields?.d?.stringValue || "";
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "number") return { integerValue: String(value) };
  return { nullValue: null };
}

async function saveDraw(date, result) {
  const id = `auto-${date}`;
  const fields = {
    d: firestoreValue(date),
    n: firestoreValue(result.n),
    m: firestoreValue(result.m),
    s: firestoreValue(result.s)
  };
  const response = await fetch(`${FIRESTORE}/sorteos/${id}?key=${API_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Referer": "https://lotohope.netlify.app/" },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudo guardar en Firestore (${response.status}): ${detail.slice(0, 300)}`);
  }
}

export async function runSync() {
  const last = await getLatestDate();
  const due = drawDates(last);
  if (!due.length) return { added: 0, message: "✅ No hay sorteos pendientes. LotHope esta al dia." };
  let added = 0;
  const notFound = [];
  const debug = [];
  for (const date of due) {
    let result = null;
    for (const url of articleUrls(date)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-DO,es;q=0.9,en;q=0.8",
            "Referer": "https://www.google.com/"
          }
        });
        clearTimeout(timer);
        if (!response.ok) { debug.push(`${date} | ${url} -> HTTP ${response.status}`); continue; }
        const html = await response.text();
        result = parseResult(html, date);
        if (result) break;
        debug.push(`${date} | ${url} -> HTTP 200 pero no se pudo parsear`);
      } catch (e) {
        debug.push(`${date} | ${url} -> ERROR ${e.message}`);
      }
    }
    if (!result) { notFound.push(date); continue; }
    await saveDraw(date, result);
    added++;
  }
  if (notFound.length) {
    return {
      added,
      message: added
        ? `Se guardaron ${added} sorteo(s). Todavia no se encontro el resultado de: ${notFound.join(", ")}.`
        : `Todavia no se encuentra publicado el resultado de: ${notFound.join(", ")}.`,
      debug
    };
  }
  return { added, message: added ? `Se guardaron ${added} sorteo(s) en Firestore.` : "No hay resultados nuevos.", debug };
}
