import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATA_FILE = resolve(process.cwd(), "data/resultados.json");

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function datePartsRD(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter(p => p.type !== "literal").map(p => [p.type, p.value])
  );
}

function isoUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
    const passedCutoff =
      key < today || (key === today && localMinutes >= 21 * 60 + 10);

    if (isDrawDay && passedCutoff && key > (lastDate || "")) {
      found.push(key);
    }
  }

  return found;
}

function articleUrls(key) {
  const [y, m, d] = key.split("-").map(Number);
  const month = MONTHS[m - 1].toLowerCase();
  const cdnDay = String(d).padStart(2, "0");

  const cdn = `https://cdn.com.do/evergreen/resultados-leidsa-numeros-ganadores-del-${cdnDay}-de-${month}-de-${y}/?amp=1`;

  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const day = weekday === 3 ? "miercoles" : "sabado";

  const mercado = `https://revistamercado.do/actualidad/resultados-de-leidsa-del-${day}-${d}-de-${month}-de-${y}-en-republica-dominicana/`;

  return [
    "https://www.leidsa.com/",
    "https://www.conectate.com.do/loterias/",
    "https://www.conectate.com.do/loterias/leidsa/loto-mas/",
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

  const nums = [...new Set((match[1].match(/\d+/g) || []).map(Number))]
    .sort((a, b) => a - b);

  if (nums.length !== 6 || nums.some(n => n < 1 || n > 40)) {
    return null;
  }

  const combined = text.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})\s*[,/\-]\s*(\d{1,2})/i);
  const mm = text.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})/i);
  const sm = text.match(/S[úu]per\s*M[áa]s\s*:\s*(\d{1,2})/i);

  let m = combined ? Number(combined[1]) : (mm ? Number(mm[1]) : null);
  let s = combined ? Number(combined[2]) : (sm ? Number(sm[1]) : null);

  if (
    (m !== null && (m < 1 || m > 12)) ||
    (s !== null && (s < 1 || s > 15)) ||
    ((m === null) !== (s === null))
  ) {
    m = null;
    s = null;
  }

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

  return {
    n: [...main].sort((a, b) => a - b),
    m: more,
    s: superMore
  };
}

function parseOfficialLeidsa(html, date) {
  const text = plainText(html);
  const [year, month, day] = date.split("-").map(Number);

  const monthShort = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
  ][month - 1];

  const datePattern = new RegExp(
    "Resultados\\s+del\\s+" + day + "\\s+" + monthShort + "\\s+" + year,
    "i"
  );

  const match = datePattern.exec(text);
  if (!match) return null;

  const before = text.slice(Math.max(0, match.index - 350), match.index);
  const values = before.match(/\b\d{1,2}\b/g) || [];

  return validEight(values.slice(-8));
}

function parseConectate(html, date) {
  const text = plainText(html);
  const [year, month, day] = date.split("-").map(Number);
  const monthName = MONTHS[month - 1].toLowerCase();

  const dateVariants = [
    new RegExp(
      "(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)?\\s*" +
      day + "\\s+de\\s+" + monthName + "(?:\\s+de\\s+" + year + ")?",
      "i"
    ),
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

  const afterLabel = section.slice(
    label.index + label[0].length,
    label.index + label[0].length + 180
  );

  const values = afterLabel.match(/\b\d{1,2}\b/g) || [];
  return validEight(values.slice(0, 8));
}

async function readHistory() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("data/resultados.json no contiene un array.");
    return data;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("No existe data/resultados.json. Se cancela para proteger el historial.");
    throw error;
  }
}

async function writeHistory(history) {
  history.sort((a, b) => a.d.localeCompare(b.d) || String(a.id).localeCompare(String(b.id)));
  await writeFile(DATA_FILE, JSON.stringify(history, null, 2) + "\n", "utf8");
}

function getLatestDate(history) {
  return history.reduce((latest, row) => row.d > latest ? row.d : latest, "");
}

function saveDraw(history, date, result) {
  const duplicate = history.some(row => row.d === date && row.n.join(",") === result.n.join(","));
  if (duplicate) return false;
  history.push({
    id: `auto-${date}`,
    d: date,
    n: result.n,
    m: result.m,
    s: result.s
  });
  return true;
}

export async function runSync() {
  const history = await readHistory();
  const last = getLatestDate(history);
  const due = drawDates(last);

  if (!due.length) {
    return {
      added: 0,
      message: "No hay sorteos pendientes. LotoHope está al día."
    };
  }

  let added = 0;
  const notFound = [];

  for (const date of due) {
    let result = null;

    for (const url of articleUrls(date)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 Chrome/120.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "es-DO,es;q=0.9,en;q=0.8"
            }
          });

          if (!response.ok) continue;

          const html = await response.text();

          if (url.includes("leidsa.com")) {
            result = parseOfficialLeidsa(html, date);
          } else if (url.includes("conectate.com.do")) {
            result = parseConectate(html, date);
          } else {
            result = parseResult(html);
          }
        } finally {
          clearTimeout(timer);
        }

        if (result) break;
      } catch (error) {
        console.log(`Fuente no disponible: ${url} - ${error.message}`);
      }
    }

    if (!result) {
      notFound.push(date);
      continue;
    }

    if (saveDraw(history, date, result)) {
      added++;
      console.log(`Resultado agregado: ${date}`, result);
    }
  }

  if (added) await writeHistory(history);

  if (notFound.length) {
    return {
      added,
      message: added
        ? `Se agregaron ${added} sorteo(s) al JSON. Pendientes: ${notFound.join(", ")}.`
        : `Todavía no se encuentra publicado el resultado de: ${notFound.join(", ")}.`
    };
  }

  return {
    added,
    message: added
      ? `Se agregaron ${added} sorteo(s) a data/resultados.json.`
      : "No hay resultados nuevos."
  };
}

runSync()
  .then(result => {
    console.log(JSON.stringify(result));
  })
  .catch(error => {
    console.error("ERROR EN LOTOHOPE:", error);
    process.exitCode = 1;
  });
