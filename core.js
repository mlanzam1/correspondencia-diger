const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
globalThis.ORT_PROXY_URL = ORT_WASM + "ort.bundle.min.mjs";
let paddlePromise = null;

function getPaddle(cb) {
  if (location.protocol === "file:") throw new Error("PaddleOCR no funciona abriendo el archivo con doble clic. Ábrelo desde Netlify o desde http://localhost (python -m http.server).");
  if (!window.PaddleOCR) throw new Error("el motor PaddleOCR no se cargó. Recarga la página con Ctrl+F5.");
  if (!paddlePromise) {
    if (cb) cb.setStatus("Descargando el modelo PaddleOCR (unos 30 MB, solo la primera vez)…");
    paddlePromise = window.PaddleOCR.create({
      lang: "es",
      ocrVersion: "PP-OCRv6",
      ortOptions: { backend: "wasm", wasmPaths: ORT_WASM, proxy: true }
    }).catch(e => { paddlePromise = null; throw e; });
  }
  return paddlePromise;
}

const papeles = new WeakMap();

function colorPapel(canvas) {
  if (papeles.has(canvas)) return papeles.get(canvas);
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const rs = [], gs = [], bs = [];
  const paso = Math.max(1, Math.floor(Math.sqrt(W * H / 6000)));
  for (let y = 0; y < H; y += paso) for (let x = 0; x < W; x += paso) {
    const k = (y * W + x) * 4;
    if (Math.max(d[k], d[k + 1], d[k + 2]) > 180) { rs.push(d[k]); gs.push(d[k + 1]); bs.push(d[k + 2]); }
  }
  const med = a => { a.sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 255; };
  const p = [med(rs), med(gs), med(bs)];
  papeles.set(canvas, p);
  return p;
}

function tono(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (!c) return -1;
  let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function marcasItem(canvas, it) {
  const palabras = it.text.split(/\s+/);
  const no = palabras.map(() => false);
  try {
    if (it.y0 < 0.07 * canvas.height || it.y1 > 0.93 * canvas.height) return no;
    const [pr, pg, pb] = colorPapel(canvas);
    const h = Math.max(4, it.y1 - it.y0);
    const x0 = Math.max(0, Math.floor(it.x0)), x1 = Math.min(canvas.width, Math.ceil(it.x1));
    const y0 = Math.max(0, Math.floor(it.y0)), y1 = Math.min(canvas.height, Math.ceil(it.y1 + 0.45 * h));
    const W = x1 - x0, H = y1 - y0;
    if (W < 4 || H < 4) return no;
    const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, W, H).data;
    const relleno = new Uint8Array(W), raya = new Float32Array(W).fill(-1), nClaros = new Uint16Array(W), nColor = new Uint16Array(W);
    let tinta = 0, tintaColor = 0, oscuros = 0, celdas = 0;
    for (let x = 0; x < W; x++) {
      let claros = 0, color = 0, sy = 0, ny = 0, ymax = -1;
      for (let y = 0; y < H; y++) {
        const k = (y * W + x) * 4, r = d[k], g = d[k + 1], b = d[k + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const dr = r - pr, dg = g - pg, db = b - pb;
        const croma = Math.max(dr, dg, db) - Math.min(dr, dg, db);
        const yy = y + y0;
        if (yy >= it.y1 - 0.25 * h && mx - mn >= 60 && mx > 60) { sy += y; ny++; ymax = y; }
        if (yy <= it.y1) {
          celdas++;
          if (mx < 120) oscuros++;
          if (mx > 150) {
            claros++;
            if (mx > 190 && croma >= 14) { const t = tono(r, g, b); if (t < 15 || t > 48) color++; }
          }
          if (mx < 200) { tinta++; if (mx - mn >= 60) tintaColor++; }
        }
      }
      nClaros[x] = claros; nColor[x] = color;
      if (ny && ny <= 0.25 * h && ymax < H - 0.1 * h) raya[x] = sy / ny;
    }
    const v = Math.max(1, Math.round(0.3 * h));
    let sc = 0, sk = 0;
    for (let x = 0; x < Math.min(W, v); x++) { sc += nClaros[x]; sk += nColor[x]; }
    for (let x = 0; x < W; x++) {
      if (x + v < W) { sc += nClaros[x + v]; sk += nColor[x + v]; }
      if (x - v - 1 >= 0) { sc -= nClaros[x - v - 1]; sk -= nColor[x - v - 1]; }
      if (sc >= 6 && sk / sc > 0.35) relleno[x] = 1;
    }
    const textoDeColor = tinta > 0 && tintaColor / tinta > 0.4;
    if (oscuros / Math.max(1, celdas) < 0.03) { nColor.fill(0); relleno.fill(0); }
    const tramos = (marca, valido) => {
      const out = [];
      let ini = -1, hueco = 0;
      for (let x = 0; x <= W; x++) {
        if (x < W && marca(x)) { if (ini < 0) ini = x; hueco = 0; }
        else if (ini >= 0 && (++hueco > 0.35 * h || x === W)) { const fin = x - hueco + 1; if (fin - ini >= 1.5 * h && valido(ini, fin)) out.push([ini, fin]); ini = -1; hueco = 0; }
      }
      return out;
    };
    const recta = (a, b) => {
      const ys = []; for (let x = a; x < b; x++) if (raya[x] >= 0) ys.push(raya[x]);
      if (ys.length < 0.7 * (b - a)) return false;
      const m = ys.reduce((p, q) => p + q, 0) / ys.length;
      return Math.sqrt(ys.reduce((p, q) => p + (q - m) ** 2, 0) / ys.length) < 0.1 * h;
    };
    const cubre = new Uint8Array(W);
    const marcas = tramos(x => relleno[x], () => true);
    if (!textoDeColor) marcas.push(...tramos(x => raya[x] >= 0, recta));
    marcas.forEach(([a, b]) => { for (let x = a; x < b; x++) cubre[x] = 1; });
    const total = it.text.length;
    let pos = 0;
    const marc = palabras.map(p => {
      const i = it.text.indexOf(p, pos); pos = i + p.length;
      const a = Math.floor(W * i / total), b = Math.max(a + 1, Math.ceil(W * pos / total));
      let n = 0, sc2 = 0, sk2 = 0;
      for (let x = a; x < b; x++) { n += cubre[x]; sc2 += nClaros[x]; sk2 += nColor[x]; }
      return n / (b - a) > 0.5 || (sc2 >= 10 && sk2 / sc2 > 0.28);
    });
    for (let i = 1; i < marc.length - 1; i++) if (!marc[i] && marc[i - 1] && marc[i + 1]) marc[i] = true;
    return marc;
  } catch { return no; }
}

function textoMarcado(estructura) {
  const trozos = [];
  let actual = [];
  estructura.forEach(p => p.parrafos.forEach(par => par.filas.forEach(f => f.forEach(w => {
    if (w.m) actual.push(w.t);
    else if (actual.length) { trozos.push(actual); actual = []; }
  }))));
  if (actual.length) trozos.push(actual);
  const utiles = trozos.filter(t => t.length >= 2);
  if (!utiles.length || utiles.reduce((a, t) => a + t.length, 0) < 4) return "";
  const txt = utiles.map(t => t.join(" ").replace(/^[,;:.\s]+|[,;:\s]+$/g, "")).join(" … ");
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

async function leerConPaddle(canvas, cb) {
  const ocr = await getPaddle(cb);
  if (cb) { cb.setStatus("Leyendo con PaddleOCR…"); cb.progress(0.3); }
  const [res] = await ocr.predict(canvas, { textDetLimitSideLen: 1600, textDetLimitType: "max" });
  if (cb) cb.progress(1);
  const items = (res.items || []).filter(it => it.text && it.text.trim()).map(it => {
    const xs = it.poly.map(p => p[0]), ys = it.poly.map(p => p[1]);
    return { text: it.text.trim(), score: it.score, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  items.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const filas = [];
  for (const it of items) {
    const cy = (it.y0 + it.y1) / 2, h = it.y1 - it.y0;
    const f = filas.find(r => Math.abs(r.cy - cy) < 0.5 * Math.min(h, r.h));
    if (f) { f.items.push(it); f.y0 = Math.min(f.y0, it.y0); f.y1 = Math.max(f.y1, it.y1); }
    else filas.push({ cy, h, y0: it.y0, y1: it.y1, items: [it] });
  }
  filas.sort((a, b) => a.y0 - b.y0);
  const lines = filas.map(f => {
    f.items.sort((a, b) => a.x0 - b.x0);
    const words = f.items.flatMap(it => { const m = marcasItem(canvas, it); return it.text.split(/\s+/).map((t, i) => ({ text: t, confidence: it.score * 100, marcado: !!m[i] })); });
    return { bbox: { x0: f.items[0].x0, x1: Math.max(...f.items.map(i => i.x1)), y0: f.y0, y1: f.y1 }, words };
  });
  const conf = items.length ? items.reduce((a, i) => a + i.score, 0) / items.length * 100 : 0;
  return {
    text: lines.map(l => l.words.map(w => w.text).join(" ")).join("\n"),
    confidence: conf,
    blocks: [{ paragraphs: [{ lines }] }]
  };
}

async function pdfAImagenes(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 2.5 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(c);
  }
  return out;
}

function imagenACanvas(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      res(c);
    };
    img.onerror = () => rej(new Error("imagen no válida"));
    img.src = URL.createObjectURL(file);
  });
}

function limpiarParrafos(blocks, W) {
  const lineas = [];
  for (const b of blocks) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const words = (l.words || []).filter(w => w.confidence >= 45 || /^[("“¿¡]?[A-Za-zÁÉÍÓÚÑáéíóúñü]{3,}[.,:;)”"]?$/.test(w.text) || /^\(?\d[\d.,\/-]*\)?[.,;:]?$/.test(w.text));
    if (!words.length) continue;
    const plano = words.map(w => w.text).join("");
    const utiles = (plano.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü0-9]/g) || []).length;
    const conf = words.reduce((a, w) => a + w.confidence, 0) / words.length;
    if (plano.length < 3 || utiles / plano.length < 0.7 || conf < 55) continue;
    if (words.length <= 2 && conf < 75) continue;
    lineas.push({ x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1, words: words.map(w => ({ t: w.text, c: w.confidence, m: !!w.marcado })) });
  }
  if (!lineas.length) return [];
  lineas.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const alturas = lineas.map(l => l.y1 - l.y0).sort((a, b) => a - b);
  const h = alturas[Math.floor(alturas.length / 2)];
  const maxAncho = Math.max(...lineas.map(l => l.x1 - l.x0));
  const lado = l => l.x0 > 0.5 * W ? "right" : (Math.abs((l.x0 + l.x1) / 2 - W / 2) < 0.06 * W && (l.x1 - l.x0) < 0.75 * W ? "center" : "left");
  const grupos = [];
  let g = null;
  for (const l of lineas) {
    const prev = g && g.lineas[g.lineas.length - 1];
    const nuevo = !g || (l.y0 - prev.y1) > 0.8 * h || (lado(l) === "right") !== (lado(prev) === "right");
    if (nuevo) { g = { lineas: [] }; grupos.push(g); }
    g.lineas.push(l);
  }
  return grupos.map(gr => {
    const filas = [[]];
    gr.lineas.forEach((l, i) => {
      const fila = filas[filas.length - 1];
      const ws = l.words.map(w => ({ ...w }));
      const ult = fila[fila.length - 1];
      if (ult && /[a-záéíóúñ]-$/i.test(ult.t) && ws.length) {
        const sig = ws.shift();
        ult.t = ult.t.slice(0, -1) + sig.t;
        ult.c = Math.min(ult.c, sig.c);
      }
      fila.push(...ws);
      const corta = (l.x1 - l.x0) < 0.75 * maxAncho;
      if (corta && i < gr.lineas.length - 1) filas.push([]);
    });
    const completas = gr.lineas.filter(l => (l.x1 - l.x0) >= 0.75 * maxAncho).length;
    let alinear = lado(gr.lineas[0]);
    if (alinear === "left" && completas >= 1 && gr.lineas.length > 1) alinear = "justify";
    if (gr.lineas.every(l => lado(l) === "right")) alinear = "right";
    return { alinear, filas: filas.filter(f => f.length) };
  });
}

const MESES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

const INSTITUCIONES = [
  [/salud\.gob\.hn|\bSESAL\b|secretar[ií]a de (estado en el despacho de )?salud/i, "Secretaría de Salud (SESAL)"],
  [/diger\.gob\.hn|\bDIGER\b.*gesti[oó]n por resultados|direcci[oó]n de gesti[oó]n por resultados/i, "Dirección de Gestión por Resultados (DIGER)"],
  [/sefin\.gob\.hn|\bSEFIN\b|secretar[ií]a de (estado en el despacho de )?finanzas/i, "Secretaría de Finanzas (SEFIN)"],
  [/se\.gob\.hn|\bSEDUC\b|secretar[ií]a de (estado en el despacho de )?educaci[oó]n/i, "Secretaría de Educación (SEDUC)"],
  [/sedesol\.gob\.hn|\bSEDESOL\b|secretar[ií]a de desarrollo social/i, "Secretaría de Desarrollo Social (SEDESOL)"],
  [/ine\.gob\.hn|instituto nacional de estad[ií]stica/i, "Instituto Nacional de Estadística (INE)"],
  [/presidencia\.gob\.hn|secretar[ií]a privada|casa presidencial/i, "Presidencia de la República"],
  [/\bSIT\b|secretar[ií]a de infraestructura/i, "Secretaría de Infraestructura y Transporte (SIT)"],
  [/\bSAG\b|secretar[ií]a de agricultura/i, "Secretaría de Agricultura y Ganadería (SAG)"],
  [/\bSEGOB\b|secretar[ií]a de gobernaci[oó]n/i, "Secretaría de Gobernación (SEGOB)"],
  [/\bSRECI\b|secretar[ií]a de relaciones exteriores/i, "Secretaría de Relaciones Exteriores (SRECI)"],
  [/\bSDE\b|secretar[ií]a de desarrollo econ[oó]mico/i, "Secretaría de Desarrollo Económico (SDE)"],
  [/\bSERNA\b|\bMiAmbiente\b|secretar[ií]a de recursos naturales/i, "Secretaría de Recursos Naturales y Ambiente (MiAmbiente)"],
  [/\bSEDENA\b|secretar[ií]a de defensa/i, "Secretaría de Defensa Nacional (SEDENA)"],
  [/\bSEDS\b|secretar[ií]a de seguridad/i, "Secretaría de Seguridad (SEDS)"],
  [/\bSTSS\b|secretar[ií]a de trabajo/i, "Secretaría de Trabajo y Seguridad Social (STSS)"],
  [/\bTSC\b|tribunal superior de cuentas/i, "Tribunal Superior de Cuentas (TSC)"],
  [/\bUNAH\b|universidad nacional aut[oó]noma/i, "Universidad Nacional Autónoma de Honduras (UNAH)"]
];

const ACCIONES = [
  [/\b(solicit[oa]mos|solicito|solicita|solicitamos)\b/i, "Solicitud de"],
  [/\b(invit[oa]mos|invito|invita|tiene el agrado de invitar(?:les|le)?(?: a participar)?)\b/i, "Invitación a"],
  [/\b(remit[oa]mos|remito|remite|adjunt[oa]mos|adjunto|traslad[oa]mos|traslado)\b/i, "Remisión de"],
  [/\b(convoc[oa]mos|convoco|convoca)\b/i, "Convocatoria a"],
  [/\b(inform[oa]mos|informo|informa|hacemos de su conocimiento|hago de su conocimiento|comunic[oa]mos|comunico)\b/i, "Información sobre"],
  [/\b(notific[oa]mos|notifico|notifica)\b/i, "Notificación de"],
  [/\b(requer[ií]mos|requiero|requiere)\b/i, "Requerimiento de"],
  [/\b(present[oa]mos|presento)\b/i, "Presentación de"]
];

const CARGOS = /(secretari[oa]|subsecretari[oa]|sub secretari[oa]|viceministr[oa]|ministr[oa]|director[a]?|gerente|jefe|jefa|coordinador[a]?|presidente|presidenta|comisionad[oa]|rector[a]?|alcalde|alcaldesa|asesor[a]?|administrador[a]?|encargad[oa])/i;
const TITULOS = /^(dr|dra|lic|licda|ing|inga|abog|abg|msc|m\.sc|mba|arq|prof|profa|pmd|cpa|sr|sra)\.?\s+\S+/i;
const CORTESIA = /^(me es (muy )?grato|es grato|tengo el (honor|agrado) de|por este medio|por medio de la presente|reciba un cordial saludo|reciban un cordial saludo|aprovecho|hago propicia|sin otro particular|agradeciendo|agradezco de antemano|atentamente|cordialmente|respetuosamente)/i;

function oraciones(texto) {
  return texto.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“])/).map(t => t.trim()).filter(Boolean);
}

function quitarCortesia(o) {
  let t = o.replace(/^(me es (muy )?grato|es grato|tengo el (honor|agrado) de)\s+(dirigirme|saludarle|saludarlo|saludarla)[^,]*?(\s+y\s+|,\s*)/i, "");
  t = t.replace(/^(por este medio|por medio de la presente)[,\s]*/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function recortar(t, max) {
  const p = t.split(/\s+/);
  return p.length <= max ? t : p.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

function aFechaCorta(f) {
  if (!f) return null;
  const m = f.match(new RegExp("(\\d{1,2})\\s+de\\s+(" + MESES + ")(?:\\s+de)?[,\\s]+(\\d{4})", "i"));
  if (!m) return f;
  const lista = MESES.split("|").filter(x => x !== "setiembre");
  let mes = lista.indexOf(m[2].toLowerCase()) + 1;
  if (m[2].toLowerCase() === "setiembre") mes = 9;
  return String(m[1]).padStart(2, "0") + "/" + String(mes).padStart(2, "0") + "/" + m[3];
}

function oracionCase(t) {
  if (t !== t.toUpperCase()) return t;
  const s = t.toLowerCase().replace(/\b(diger|upeg|sesal|ti|poa|pei|ine|sefin)\b/g, x => x.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nombrePropio(t) {
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s(.])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
}

function detectarCampos(estructura, crudo) {
  const parrafos = estructura.flatMap(p => p.parrafos.map(x => ({ alinear: x.alinear, lineas: x.filas.map(f => f.map(w => w.t).join(" ")) })));
  const planos = parrafos.map(p => p.lineas.join(" "));
  const texto = planos.join("\n");
  const todo = texto + "\n" + (crudo || "");
  const num = texto.match(/\b(\d{1,5}-[A-Z]{2,10}(?:-[A-Z]{1,10})*-\d{4}|[A-Z]{1,8}(?:-[A-Z]{1,10})*-\d{1,5}-\d{4})\b/);
  const fecha = texto.match(new RegExp("\\b(\\d{1,2})\\s+de\\s+(" + MESES + ")(?:\\s+de)?[,\\s]+(\\d{4})\\b", "i"));
  const tipo = texto.match(/\b(circular|oficio|memorando|memor[aá]ndum|invitaci[oó]n|resoluci[oó]n|constancia|nota)\b/i);
  const anioActual = new Date().getFullYear();
  const anio = fecha ? Number(fecha[3]) : null;

  const lineas = parrafos.flatMap(p => p.lineas);
  let remitente = "", cargo = "";
  const iDe = lineas.findIndex(l => /^DE\s*:/i.test(l));
  if (iDe >= 0) {
    const resto = lineas[iDe].replace(/^DE\s*:\s*/i, "").trim();
    const cand = [resto, lineas[iDe + 1] || "", lineas[iDe + 2] || ""].filter(Boolean);
    remitente = cand[0] || "";
    cargo = (cand.slice(1).find(l => CARGOS.test(l)) || "").replace(/\s*\(.*\)\s*$/, "");
  }
  if (!remitente) {
    const iFin = lineas.findIndex(l => /^(atentamente|cordialmente|respetuosamente|saludos cordiales)[,.]?$/i.test(l.trim()));
    if (iFin >= 0) {
      const firma = [];
      for (let k = iFin + 1; k < lineas.length && firma.length < 4; k++) {
        if (/^(c\.?\s*c\.?|cc)\s*[:.]/i.test(lineas[k]) || /^(adjunto|anexo)/i.test(lineas[k])) break;
        firma.push(lineas[k].trim());
      }
      const nombre = firma.find(l => TITULOS.test(l) || (l === l.toUpperCase() && l.split(" ").length >= 2 && !CARGOS.test(l)));
      if (nombre) remitente = nombre;
      cargo = firma.find(l => l !== nombre && CARGOS.test(l)) || "";
    }
  }
  remitente = nombrePropio(remitente.replace(/\s+/g, " ").trim());
  cargo = oracionCase(cargo.replace(/\s+/g, " ").trim());

  const inst = INSTITUCIONES.find(([re]) => re.test(todo));
  const institucion = inst ? inst[1] : "";

  let asunto = "";
  const mAs = texto.match(/ASUNTO\s*:\s*([\s\S]+?)(?=\n?\b(FECHA|PARA|DE|REF|REFERENCIA)\s*:|\n(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])|$)/i);
  if (mAs) asunto = oracionCase(mAs[1].replace(/\s+/g, " ").trim()).replace(/[.,;]$/, "");

  const iSaludo = parrafos.findIndex(p => /^(estimad[oa]s?|señor[ae]?s?|distinguid[oa]s?|respetable|apreciad[oa]s?|honorable)\b.*:\s*$/i.test(p.lineas.join(" ").trim()));
  const iCampos = parrafos.reduce((a, p, k) => /^(ASUNTO|FECHA|PARA|DE)\s*:?/i.test(p.lineas[0] || "") ? k : a, -1);
  const iCierre = parrafos.findIndex((p, k) => k > Math.max(iSaludo, iCampos) && /^(atentamente|cordialmente|respetuosamente|saludos cordiales)/i.test(p.lineas[0] || ""));
  const desde = Math.max(iSaludo, iCampos) + 1;
  const hasta = iCierre >= 0 ? iCierre : parrafos.length;
  const cuerpo = parrafos.slice(desde, hasta)
    .filter(p => {
      const ws = p.lineas.join(" ").split(" ").length;
      const corto = p.lineas.length > 1 && ws / p.lineas.length < 7;
      return !corto && (p.alinear === "justify" || ws >= 12);
    })
    .map(p => p.lineas.join(" "))
    .filter(t => !/^(ASUNTO|PARA|DE|FECHA)\s*:/i.test(t));
  const ors = cuerpo.flatMap(oraciones).filter(o => o.split(" ").length >= 6 && !/^(agradeciendo|agradezco|sin otro particular|atentamente|reciba|aprovecho)/i.test(o));

  let accion = null, iAccion = -1;
  for (let k = 0; k < ors.length && !accion; k++) {
    for (const [re, sust] of ACCIONES) {
      const m = ors[k].match(re);
      if (m) { accion = { sust, resto: ors[k].slice(m.index + m[0].length) }; iAccion = k; break; }
    }
  }
  if (!asunto && accion) {
    let obj = accion.resto.replace(/^\s*(a usted(es)?|muy respetuosamente|respetuosamente|a su (digno )?cargo|amablemente)\s*/i, "").trim();
    obj = obj.split(/,|;|\.\s|\.$|\s(considerando|para que|con el fin|con el objeto|a fin de|en virtud|ya que|debido)\b/i)[0].trim();
    obj = obj.replace(/^(los|las|el|la|a|que)\s+/i, m => /^(a|que)\s/i.test(m) ? "" : m.toLowerCase());
    if (obj) asunto = recortar(accion.sust + " " + obj, 16).replace(/\s+de\s+de\s+/, " de ").replace(/[.:]$/, "");
  }

  const frec = {};
  const vacias = new Set("de la el los las y a en para por con que del al se su sus un una lo como es son o u e este esta estos estas le les ha han ser".split(" "));
  ors.forEach(o => o.toLowerCase().match(/[a-záéíóúñü0-9]+/g)?.forEach(w => { if (!vacias.has(w) && w.length > 3) frec[w] = (frec[w] || 0) + 1; }));
  const puntaje = ors.map((o, k) => {
    const ws = o.toLowerCase().match(/[a-záéíóúñü0-9]+/g) || [];
    let p = ws.reduce((a, w) => a + (frec[w] || 0), 0) / Math.max(8, ws.length);
    if (k === iAccion) p += 10;
    if (/\b\d{1,2}\s+de\s+[a-z]+|\b20\d\d\b|\d+:\d\d/i.test(o)) p += 0.6;
    if (CORTESIA.test(o)) p -= 2;
    return { k, p };
  }).sort((a, b) => b.p - a.p).slice(0, 2).sort((a, b) => a.k - b.k);
  const enfocar = (o, k) => {
    if (k !== iAccion) return o;
    const m = [...o.matchAll(/\b(por lo que|por tal (motivo|raz[oó]n)|por lo anterior|en (ese|tal) sentido|raz[oó]n por la cual)\s+/gi)].pop();
    if (!m) return o;
    const t = o.slice(m.index + m[0].length);
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const resumen = puntaje.map(({ k }) => recortar(quitarCortesia(enfocar(ors[k], k)), 45)).join(" ");

  return {
    tipo: tipo ? tipo[1].charAt(0).toUpperCase() + tipo[1].slice(1).toLowerCase() : null,
    numero: num ? num[1] : null,
    fecha: fecha ? fecha[0].replace(/\s+/g, " ") : null,
    fechaCorta: aFechaCorta(fecha ? fecha[0] : null),
    fechaDudosa: anio !== null && Math.abs(anio - anioActual) > 1,
    remitente, cargo, institucion, asunto, resumen
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}

const GROQ = "https://api.groq.com/openai/v1";
const VISION_PREFERIDOS = ["qwen/qwen3.8-27b", "meta-models/muse-spark-open", "meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"];
let modelosCache = null;

const INSTRUCCION = `Eres un asistente que transcribe documentos oficiales escaneados del Gobierno de Honduras.
Recibes la imagen de una página. Devuelve SOLO un objeto JSON, sin texto adicional, con esta forma:
{"campos":{"tipo":"","numero":"","fecha":"","remitente":"","cargo_remitente":"","institucion":"","asunto":"","resumen":""},
 "parrafos":[{"alinear":"left|right|center|justify","texto":"","negrita":false}]}
Reglas:
- Transcribe el texto tal como está escrito, palabra por palabra. No corrijas la redacción, no resumas los párrafos y no inventes contenido.
- Si algo es ilegible, escribe [ilegible] en su lugar.
- No incluyas el membrete, logos, sellos, firmas, notas a mano ni el pie de página institucional (direcciones, redes sociales, sitios web).
- Conserva el orden de los párrafos y su alineación. Usa \\n para los saltos de línea dentro de bloques como el destinatario, la firma y las copias.
- Marca negrita=true solo en los párrafos que en el original están en negrita.
- "tipo" es una palabra: Oficio, Circular, Memorando, Invitación, Nota u otra.
- "fecha" en formato DD/MM/AAAA. "asunto" en una línea corta. "resumen" de 2 a 4 oraciones sobre lo que pide o informa el documento.
- Si un campo no aparece en esta página, déjalo vacío.`;

async function errorGroq(r) {
  let msg = r.status + "";
  try { const e = await r.json(); msg += " · " + (e.error && e.error.message ? e.error.message : ""); } catch {}
  return new Error(msg);
}

async function modelosGroq(llave) {
  if (modelosCache && modelosCache.llave === llave) return modelosCache.ids;
  const r = await fetch(GROQ + "/models", { headers: { "Authorization": "Bearer " + llave } });
  if (!r.ok) throw await errorGroq(r);
  const ids = ((await r.json()).data || []).filter(m => m.active !== false).map(m => m.id);
  modelosCache = { llave, ids };
  return ids;
}

async function modeloVision(llave) {
  const ids = await modelosGroq(llave);
  const elegido = VISION_PREFERIDOS.find(m => ids.includes(m)) || ids.find(m => /vision|scout|maverick|qwen3\.[0-9]+-[0-9]+b|-vl/i.test(m));
  if (!elegido) throw new Error("tu cuenta de Groq no tiene ningún modelo que lea imágenes. Modelos disponibles: " + ids.join(", "));
  return elegido;
}

function imagenParaIA(canvas) {
  const max = 1800;
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function extraerJSON(txt) {
  const limpio = String(txt || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = limpio.indexOf("{"), b = limpio.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("la IA no devolvió el formato esperado");
  return JSON.parse(limpio.slice(a, b + 1));
}

async function leerPaginaConIA(llave, modelo, canvas) {
  const cuerpo = (conFormato) => JSON.stringify({
    model: modelo,
    temperature: 0.1,
    ...(conFormato ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: INSTRUCCION },
      { role: "user", content: [
        { type: "text", text: "Transcribe esta página y devuelve el JSON." },
        { type: "image_url", image_url: { url: imagenParaIA(canvas) } }
      ] }
    ]
  });
  const pedir = c => fetch(GROQ + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + llave }, body: cuerpo(c) });
  let r = await pedir(true);
  if (r.status === 400) r = await pedir(false);
  if (!r.ok) throw await errorGroq(r);
  const data = await r.json();
  return extraerJSON(data.choices[0].message.content);
}

async function leerConIA(llave, paginas, aviso) {
  const modelo = await modeloVision(llave);
  const campos = {};
  const parrafos = [];
  for (let i = 0; i < paginas.length; i++) {
    aviso(`Leyendo con IA (${modelo}) · página ${i + 1} de ${paginas.length}…`);
    const out = await leerPaginaConIA(llave, modelo, paginas[i]);
    Object.entries(out.campos || {}).forEach(([k, v]) => { if (v && !campos[k]) campos[k] = v; });
    (out.parrafos || []).forEach((p, k) => parrafos.push({ ...p, saltoPagina: i > 0 && k === 0 }));
  }
  if (!parrafos.length) throw new Error("la IA no devolvió texto");
  return { modelo, campos, parrafos };
}

