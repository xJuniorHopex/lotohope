// Lógica compartida para registrar el Loto de Leidsa (miércoles y sábado) en Firestore.
// Corre en el servidor de Netlify, sin proxies. Usa la misma clave pública y las mismas
// reglas de Firestore que ya usa tu página (no necesita claves secretas).

const PROJECT = 'hope-58505';
const API_KEY = 'AIzaSyATHAwacAzURuh-Rofy3CXevhuWlqNU-JI';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- Fechas (hora de República Dominicana, UTC-4 todo el año) ----------
export function ahoraRD() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: +p.hour * 60 + +p.minute };
}
const diaSemana = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 3 = miércoles, 6 = sábado
function restarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const partes = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };

// ---------- Lectura del resultado desde el texto de una página ----------
export function parseLoto(html, iso) {
  const tx = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // La página debe mencionar la fecha pedida (evita tomar números de otro sorteo).
  const { y, m: mm, d } = partes(iso);
  const fechaTxt = `${d} de ${MESES[mm - 1]}`;
  if (!tx.toLowerCase().includes(fechaTxt) || !tx.includes(String(y))) return null;

  const a = tx.match(/Loto\s*:\s*((?:\d{1,2}\D{1,8}){5}\d{1,2})/i);
  if (!a) return null;
  const n = [...new Set(a[1].match(/\d+/g).map(Number))].sort((x, z) => x - z);
  if (n.length !== 6 || n.some(x => x < 1 || x > 40)) return null;

  let m = null, s = null;
  const sm = tx.match(/S[úu]per\s*M[áa]s\s*:\s*(\d{1,2})/i);
  const lm = tx.match(/Loto\s*M[áa]s\s*:\s*(\d{1,2})(?:\D{1,8}(\d{1,2}))?/i);
  if (lm) {
    m = +lm[1];
    s = sm ? +sm[1] : (lm[2] != null ? +lm[2] : null);
  }
  if (m == null || s == null || m < 1 || m > 12 || s < 1 || s > 15) { m = null; s = null; }
  return { n, m, s };
}

async function bajar(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': UA, 'accept-language': 'es-DO,es;q=0.9' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const txt = await r.text();
    return txt.length > 500 ? txt : null;
  } catch { return null; }
}

// ---------- Fuentes ----------
async function urlsDe(iso) {
  const { y, m, d } = partes(iso);
  const mes = MESES[m - 1];
  const dia = diaSemana(iso) === 3 ? 'miercoles' : 'sabado';
  const out = [];

  // 1) CDN: la página de "tema" de ese día lista el artículo, aunque el link cambie.
  const tema = await bajar(`https://cdn.com.do/temas/resultados-leidsa-${d}-de-${mes}-de-${y}/`);
  if (tema) {
    const re = new RegExp(`https://cdn\\.com\\.do/[a-z0-9\\-/]*-${d}-de-${mes}-de-${y}[a-z0-9\\-]*/`, 'gi');
    for (const u of tema.match(re) || []) if (!u.includes('/temas/') && !out.includes(u)) out.push(u);
  }
  // 2) CDN: formatos de link conocidos
  for (const sec of ['evergreen', 'estilos-de-vida', 'noticiascdn']) {
    out.push(`https://cdn.com.do/${sec}/resultados-leidsa-del-${d}-de-${mes}-de-${y}-numeros-ganadores/`);
    out.push(`https://cdn.com.do/${sec}/resultados-leidsa-numeros-ganadores-del-${d}-de-${mes}-de-${y}/`);
  }
  // 3) Revista Mercado
  const b = `https://revistamercado.do/actualidad/resultados-de-leidsa-del-${dia}-${d}-de-${mes}-de-${y}`;
  out.push(b + '-en-republica-dominicana/', b + '/');
  return [...new Set(out)];
}

// ---------- Firestore (API REST) ----------
async function ultimosSorteos() {
  const r = await fetch(`${DB}:runQuery?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'sorteos' }],
        orderBy: [{ field: { fieldPath: 'd' }, direction: 'DESCENDING' }],
        select: { fields: [{ fieldPath: 'd' }, { fieldPath: 'n' }] },
        limit: 12,
      },
    }),
  });
  if (!r.ok) throw new Error(`Firestore no dejó leer (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const filas = await r.json();
  return filas.filter(f => f.document).map(f => ({
    d: f.document.fields.d?.stringValue,
    n: (f.document.fields.n?.arrayValue?.values || []).map(v => +v.integerValue).join(','),
  }));
}

async function guardar(iso, r) {
  const campos = {
    d: { stringValue: iso },
    n: { arrayValue: { values: r.n.map(x => ({ integerValue: String(x) })) } },
    m: r.m == null ? { nullValue: null } : { integerValue: String(r.m) },
    s: r.s == null ? { nullValue: null } : { integerValue: String(r.s) },
  };
  const res = await fetch(`${DB}/sorteos/auto-${iso}?key=${API_KEY}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: campos }),
  });
  if (!res.ok) throw new Error(`Firestore no dejó guardar (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// ---------- Proceso principal ----------
export async function sincronizar() {
  const { fecha: hoy, minutos } = ahoraRD();
  const guardados = await ultimosSorteos();
  const ultima = guardados.map(g => g.d).filter(Boolean).sort().pop() || '0000-00-00';
  const yaEstan = new Set(guardados.map(g => g.d));
  const recientes = guardados.slice(0, 3).map(g => g.n);

  // Miércoles y sábados de los últimos 10 días que falten, después de las 9:10 PM del propio día.
  const pendientes = [];
  for (let i = 0; i < 10; i++) {
    const k = restarDias(hoy, i);
    const dw = diaSemana(k);
    if (dw !== 3 && dw !== 6) continue;
    if (k <= ultima || yaEstan.has(k)) continue;
    if (i === 0 && minutos < 21 * 60 + 10) continue;
    pendientes.push(k);
  }
  pendientes.sort();

  const log = { hoy, ultimaRegistrada: ultima, pendientes, registrados: [], noEncontrados: [] };
  for (const k of pendientes) {
    let r = null;
    for (const u of await urlsDe(k)) {
      const h = await bajar(u);
      r = h && parseLoto(h, k);
      if (r) { log.registrados.push({ fecha: k, fuente: u, ...r }); break; }
    }
    if (!r) { log.noEncontrados.push(k); continue; }
    if (recientes.includes(r.n.join(','))) {
      // Mismos números que un sorteo reciente: casi seguro es una página con datos viejos.
      log.registrados.pop();
      log.noEncontrados.push(k + ' (números repetidos de un sorteo reciente, no se guardó)');
      continue;
    }
    await guardar(k, r);
    recientes.unshift(r.n.join(','));
  }
  log.mensaje = !pendientes.length
    ? `Al día. Último sorteo registrado: ${ultima}.`
    : log.noEncontrados.length
      ? `Registrados ${log.registrados.length}. Todavía no encuentro: ${log.noEncontrados.join(', ')}.`
      : `Registrados ${log.registrados.length} sorteo(s).`;
  return log;
}
