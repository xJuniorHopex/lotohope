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
function articleUrls(key) {
  const [y,m,d] = key.split("-").map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay() === 3 ? "miercoles" : "sabado";
  const slug = `https://revistamercado.do/actualidad/resultados-de-leidsa-del-${day}-${d}-de-${MONTHS[m-1].toLowerCase()}-de-${y}-en-republica-dominicana/`;
  return [slug, slug.replace(/-en-republica-dominicana\/$/, "/")];
}
function parseResult(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  const match = text.match(/Loto\s*:\s*((?:\d{1,2}\D{1,8}){5}\d{1,2})/i);
  if (!match) return null;
  const nums = [...new Set((match[1].match(/\d+/g) || []).map(Number))].sort((a,b)=>a-b);
  if (nums.length !== 6 || nums.some(n => n < 1 || n > 40)) return null;
  const mm = text.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})/i);
  const sm = text.match(/S[úu]per\s*M[áa]s\s*:\s*(\d{1,2})/i);
  let m = mm ? Number(mm[1]) : null;
  let s = sm ? Number(sm[1]) : null;
  if (m < 1 || m > 12 || s < 1 || s > 15 || ((m == null) !== (s == null))) { m=null; s=null; }
  return { n: nums, m, s };
}
async function getLatestDate() {
  const response = await fetch(`${FIRESTORE}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Referer": "https://lotohope.netlify.app/"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "sorteos" }],
        orderBy: [{ field: { fieldPath: "d" }, direction: "DESCENDING" }],
        limit: 1
      }
    })
  });
  if (!response.ok) throw new Error(`Firestore no permitió consultar el historial (${response.status}).`);
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
    headers: {
      "Content-Type": "application/json",
      "Referer": "https://lotohope.netlify.app/"
    },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudo guardar en Firestore (${response.status}): ${detail.slice(0,300)}`);
  }
}
export async function runSync() {
  const last = await getLatestDate();
  const due = drawDates(last);
  if (!due.length) return { added: 0, message: "✅ No hay sorteos pendientes. LotHope está al día." };
  let added = 0;
  const notFound = [];
  for (const date of due) {
    let result = null;
    for (const url of articleUrls(date)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; LotHope/2.1)" }
        });
        clearTimeout(timer);
        if (response.ok) result = parseResult(await response.text());
        if (result) break;
      } catch (_) {}
    }
    if (!result) { notFound.push(date); continue; }
    await saveDraw(date, result);
    added++;
  }
  if (notFound.length) {
    return {
      added,
      message: added
        ? `Se guardaron ${added} sorteo(s). Todavía no se encontró el resultado de: ${notFound.join(", ")}.`
        : `Todavía no se encuentra publicado el resultado de: ${notFound.join(", ")}.`
    };
  }
  return { added, message: added ? `Se guardaron ${added} sorteo(s) en Firestore.` : "No hay resultados nuevos." };
}
