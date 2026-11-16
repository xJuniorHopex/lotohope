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
  const month = MONTHS[m-1].toLowerCase();
  const cdnDay = String(d).padStart(2, "0");
  const cdn = `https://cdn.com.do/evergreen/resultados-leidsa-numeros-ganadores-del-${cdnDay}-de-${month}-de-${y}/?amp=1`;
  const weekday = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const day = weekday === 3 ? "miercoles" : "sabado";
  const mercado = `https://revistamercado.do/actualidad/resultados-de-leidsa-del-${day}-${d}-de-${month}-de-${y}-en-republica-dominicana/`;
  return [
    "https://www.leidsa.com/",
    "https://www.conectate.com.do/loterias/",
    "https://www.conectate.com.do/loterias/leidsa/loto-mas/",
    `https://www.conectateloteria.com/sorteo-leidsa-loto-loto-mas.html?fecha=${key}`,
    cdn,
    mercado,
    mercado.replace(/-en-republica-dominicana\/$/, "/")
  ];
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
  // CDN publica ambos adicionales juntos: "Loto Más: 11, 04".
  // Otras fuentes los separan como "Loto Más: 11" y "Súper Más: 04".
  const combined = text.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})\s*[,/\-]\s*(\d{1,2})/i);
  const mm = text.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})/i);
  const sm = text.match(/S[úu]per\s*M[áa]s\s*:\s*(\d{1,2})/i);
  let m = combined ? Number(combined[1]) : (mm ? Number(mm[1]) : null);
  let s = combined ? Number(combined[2]) : (sm ? Number(sm[1]) : null);
  if (m < 1 || m > 12 || s < 1 || s > 15 || ((m == null) !== (s == null))) { m=null; s=null; }
  return { n: nums, m, s };
}

function plainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ");
}

function validEight(values) {
  const nums = values.map(Number);
  if (nums.length !== 8) return null;
  const main = nums.slice(0, 6);
  const more = nums[6];
  const superMore = nums[7];
  if (main.some(n => !Number.isInteger(n) || n < 1 || n > 40)) return null;
  if (!Number.isInteger(more) || more < 1 || more > 12) return null;
  if (!Number.isInteger(superMore) || superMore < 1 || superMore > 15) return null;
  return { n: [...main].sort((a,b)=>a-b), m: more, s: superMore };
}

function parseOfficialLeidsa(html, date) {
  const text = plainText(html);
  const [year, month, day] = date.split("-").map(Number);
  const monthShort = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][month - 1];
  const datePattern = new RegExp("Resultados\\s+del\\s+" + day + "\\s+" + monthShort + "\\s+" + year, "i");
  const match = datePattern.exec(text);
  if (!match) return null; // Nunca usar un resultado de otra fecha.
  const before = text.slice(Math.max(0, match.index - 350), match.index);
  const values = before.match(/\b\d{1,2}\b/g) || [];
  return validEight(values.slice(-8));
}

function parseConectateHistory(html, date) {
  const text = plainText(html);
  const [year, month, day] = date.split("-").map(Number);
  const dateLabel = `${day} de ${MONTHS[month - 1].toLowerCase()} de ${year}`;
  const labelIndex = text.toLowerCase().indexOf(dateLabel.toLowerCase());
  if (labelIndex < 0) return null;
  const section = text.slice(labelIndex, labelIndex + 260);
  const row = section.match(/Loto\s*[-–—]\s*Loto\s*Más\s+((?:\d{1,2}\s+){7}\d{1,2})\s+\d{1,2}\/\d{1,2}/i);
  if (row) return validEight(row[1].trim().split(/\s+/));
  // En la vista filtrada por fecha, el encabezado muestra la fecha y luego los ocho números.
  const afterDate = section.replace(dateLabel, " ");
  const values = afterDate.match(/\b\d{1,2}\b/g) || [];
  return validEight(values.slice(0, 8));
}

function parseConectate(html, date) {
  const text = plainText(html);
  const [year, month, day] = date.split("-").map(Number);
  const monthName = MONTHS[month - 1].toLowerCase();
  const dateVariants = [
    new RegExp("(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)?\\s*" + day + "\\s+de\\s+" + monthName + "(?:\\s+de\\s+" + year + ")?", "i"),
    new RegExp(day + "\\s*[/.-]\\s*" + month + "\\s*[/.-]\\s*" + year, "i")
  ];
  let dateMatch = null;
  for (const pattern of dateVariants) {
    dateMatch = pattern.exec(text);
    if (dateMatch) break;
  }
  if (!dateMatch) return null;
  const section = text.slice(dateMatch.index, dateMatch.index + 2200);
  const label = /Loto\s*[-–—]\s*Loto\s*Más/i.exec(section);
  if (!label) return null;
  const afterLabel = section.slice(label.index + label[0].length, label.index + label[0].length + 180);
  const values = afterLabel.match(/\b\d{1,2}\b/g) || [];
  return validEight(values.slice(0, 8));
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
        const timer = setTimeout(() => controller.abort(), 12000);
        let response;
        try {
          response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "es-DO,es;q=0.9,en;q=0.8"
            }
          });
          if (!response.ok) continue;
          const html = await response.text();
          if (url.includes("leidsa.com")) result = parseOfficialLeidsa(html, date);
          else if (url.includes("conectateloteria.com")) result = parseConectateHistory(html, date);
          else if (url.includes("conectate.com.do")) result = parseConectate(html, date);
          else result = parseResult(html);
        } finally {
          clearTimeout(timer);
        }
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

