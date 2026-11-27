pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const ESTADOS = ["En revisión", "Asignado", "Archivado"];
const ESTADO_ANTERIOR = { "Recibido": "En revisión", "Con observaciones": "En revisión", "Aprobado": "Asignado" };
const estadoDe = d => ESTADO_ANTERIOR[d.estado] || (ESTADOS.includes(d.estado) ? d.estado : "En revisión");
const TIPOS_DOC = ["Oficio", "Circular", "Memorando", "Invitación", "Resolución", "Nota", "Otro"];
const TIPOS_ARCH = { original: "Original escaneado", transcripcion: "Transcripción (Word)", revisado: "Revisado / con observaciones", firmado: "Firmado / aprobado", otro: "Otro" };
const CORTO_ARCH = { original: "Original", transcripcion: "Word", revisado: "Revisado", firmado: "Firmado", otro: "Otro" };
const QR_PREFIJO = "DIGER-CORR";
const AJ_KEY = "corr.ajustes";
const TEXTO_PREFERIDOS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.1-8b-instant"];

const $ = (s, r = document) => r.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  });
  kids.flat(Infinity).forEach(k => { if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k))); });
  return el;
}

function leerAjustes() {
  try { return JSON.parse(localStorage.getItem(AJ_KEY) || "{}"); } catch { return {}; }
}
function guardarAjustes(p) {
  const a = { ...leerAjustes(), ...p };
  try { localStorage.setItem(AJ_KEY, JSON.stringify(a)); } catch {}
  return a;
}
function confSupabase() {
  const a = leerAjustes();
  if (a.modo === "local") return null;
  const C = window.CONFIG || {};
  const url = (a.supabaseUrl || C.supabaseUrl || "").trim();
  const key = (a.supabaseAnonKey || C.supabaseAnonKey || "").trim();
  return url && key ? { url, key } : null;
}
function llaveGroq() { return (leerAjustes().groqKey || "").trim(); }

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}
function nombreSeguro(n) { return String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80); }
function rutaArchivo(docId, tipo, nombre) { return `${docId}/${tipo}-${Date.now()}-${nombreSeguro(nombre)}`; }
function isoDeCorta(f) {
  const m = String(f || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function fFecha(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function fFechaHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function kb(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
function claseEstado(e) { return "estado e-" + String(ESTADO_ANTERIOR[e] || e || "En revisión").split(" ")[0]; }

let toastT = null;
let avisoT;
const AVISO_ICONOS = {
  ok: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 11v6M12 7h.01"/></svg>'
};

function aviso(titulo, detalle, tipo = "ok") {
  const a = $("#aviso");
  const ico = h("div", { class: "aviso-ico" });
  ico.innerHTML = AVISO_ICONOS[tipo] || AVISO_ICONOS.ok;
  const cerrar = () => { a.classList.remove("ver"); clearTimeout(avisoT); };
  a.className = "aviso-flot " + tipo;
  a.replaceChildren(ico,
    h("div", { class: "aviso-txt" }, h("b", { text: titulo }), detalle ? h("span", { text: detalle }) : ""),
    h("button", { type: "button", class: "aviso-x", title: "Cerrar", text: "×", onclick: cerrar }),
    h("i", { class: "aviso-barra" }));
  void a.offsetWidth;
  a.classList.add("ver");
  clearTimeout(avisoT);
  avisoT = setTimeout(cerrar, tipo === "error" ? 7000 : 4000);
}

function toast(msg) {
  if (/^No se pudo/.test(msg)) { aviso("No se pudo completar", msg.replace(/^No se pudo /, "No se pudo "), "error"); return; }
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.style.display = "none"; }, 3500);
}

function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const LocalDB = {
  nombre: "local",
  _db: null,
  abrir() {
    if (!this._db) this._db = new Promise((res, rej) => {
      const r = indexedDB.open("correspondencia-diger", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("documentos", { keyPath: "id" });
        d.createObjectStore("archivos", { keyPath: "id" }).createIndex("doc", "documento_id");
        d.createObjectStore("blobs");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  fin(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  async tienda(n, modo = "readonly") { return (await this.abrir()).transaction(n, modo).objectStore(n); },
  async sesion() { return { local: true }; },
  async listDocs() {
    const docs = await this.req((await this.tienda("documentos")).getAll());
    const archs = await this.req((await this.tienda("archivos")).getAll());
    const por = {};
    archs.forEach(a => { (por[a.documento_id] = por[a.documento_id] || []).push({ tipo: a.tipo }); });
    return docs.map(d => ({ ...d, archivos: por[d.id] || [] })).sort((a, b) => b.n - a.n);
  },
  async getDoc(id) { return (await this.req((await this.tienda("documentos")).get(id))) || null; },
  async insertDoc(data) {
    const docs = await this.req((await this.tienda("documentos")).getAll());
    const n = docs.reduce((m, d) => Math.max(m, d.n || 0), 0) + 1;
    const ahora = new Date().toISOString();
    const doc = { estado: "En revisión", confidencial: false, ...data, id: uuid(), n, fecha_recepcion: data.fecha_recepcion || null, creado: ahora, actualizado: ahora };
    await this.req((await this.tienda("documentos", "readwrite")).put(doc));
    return doc;
  },
  async importarDocs(nuevos, renumerar) {
    const t = (await this.abrir()).transaction("documentos", "readwrite");
    const st = t.objectStore("documentos");
    const actuales = await this.req(st.getAll());
    const ahora = new Date().toISOString();
    const docs = nuevos.map((d, i) => ({ estado: "En revisión", confidencial: false, ...d, id: uuid(), creado: ahora, actualizado: ahora, _o: i }));
    if (renumerar) {
      let previa = "";
      const todos = docs.map(d => { previa = d.fecha_recepcion || previa; return { d, g: 0, o: d._o, f: d.fecha_recepcion || previa || "9999" }; })
        .concat(actuales.map(d => ({ d, g: 1, o: d.n || 0, f: d.fecha_recepcion || "9999" })));
      todos.sort((a, b) => a.f < b.f ? -1 : a.f > b.f ? 1 : a.g - b.g || a.o - b.o);
      todos.forEach((x, i) => { x.d.n = i + 1; });
      actuales.forEach(d => st.put(d));
    } else {
      let n = actuales.reduce((m, d) => Math.max(m, d.n || 0), 0);
      docs.forEach(d => { d.n = ++n; });
    }
    docs.forEach(d => { delete d._o; st.put(d); });
    await this.fin(t);
    return docs.length;
  },
  async updateDoc(id, patch) {
    const doc = await this.getDoc(id);
    if (!doc) throw new Error("no existe el documento");
    const nuevo = { ...doc, ...patch, actualizado: new Date().toISOString() };
    await this.req((await this.tienda("documentos", "readwrite")).put(nuevo));
    return nuevo;
  },
  async deleteDoc(id) {
    const archs = await this.listFiles(id);
    const t = (await this.abrir()).transaction(["documentos", "archivos", "blobs"], "readwrite");
    t.objectStore("documentos").delete(id);
    archs.forEach(a => { t.objectStore("archivos").delete(a.id); t.objectStore("blobs").delete(a.ruta); });
    await this.fin(t);
  },
  async listFiles(id) {
    const r = await this.req((await this.tienda("archivos")).index("doc").getAll(id));
    return r.sort((a, b) => a.creado.localeCompare(b.creado));
  },
  async uploadFile(docId, tipo, blob, nombre) {
    const ruta = rutaArchivo(docId, tipo, nombre);
    const reg = { id: uuid(), documento_id: docId, tipo, nombre, ruta, mime: blob.type || "", tamano: blob.size, creado: new Date().toISOString() };
    const t = (await this.abrir()).transaction(["archivos", "blobs"], "readwrite");
    t.objectStore("blobs").put(blob, ruta);
    t.objectStore("archivos").put(reg);
    await this.fin(t);
    return reg;
  },
  async fileBlob(a) { return await this.req((await this.tienda("blobs")).get(a.ruta)); },
  async deleteFile(a) {
    const t = (await this.abrir()).transaction(["archivos", "blobs"], "readwrite");
    t.objectStore("archivos").delete(a.id);
    t.objectStore("blobs").delete(a.ruta);
    await this.fin(t);
  }
};

function crearSupaDB(url, key) {
  const sb = window.supabase.createClient(url, key);
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    nombre: "supabase",
    sb,
    async sesion() { const { data } = await sb.auth.getSession(); return data.session; },
    async entrar(correo, clave) { ok(await sb.auth.signInWithPassword({ email: correo, password: clave })); },
    async salir() { await sb.auth.signOut(); },
    async listDocs() { return ok(await sb.from("documentos").select("*, archivos(tipo)").order("n", { ascending: false }).limit(5000)); },
    async getDoc(id) { return ok(await sb.from("documentos").select("*").eq("id", id).maybeSingle()); },
    async insertDoc(d) { return ok(await sb.from("documentos").insert(d).select().single()); },
    async updateDoc(id, p) { return ok(await sb.from("documentos").update(p).eq("id", id).select().single()); },
    async deleteDoc(id) {
      const archs = await this.listFiles(id);
      if (archs.length) ok(await sb.storage.from("expedientes").remove(archs.map(a => a.ruta)));
      ok(await sb.from("documentos").delete().eq("id", id));
    },
    async listFiles(id) { return ok(await sb.from("archivos").select("*").eq("documento_id", id).order("creado")); },
    async uploadFile(docId, tipo, blob, nombre) {
      const ruta = rutaArchivo(docId, tipo, nombre);
      ok(await sb.storage.from("expedientes").upload(ruta, blob, { contentType: blob.type || "application/octet-stream", upsert: false }));
      return ok(await sb.from("archivos").insert({ documento_id: docId, tipo, nombre, ruta, mime: blob.type || "", tamano: blob.size }).select().single());
    },
    async fileBlob(a) { return ok(await sb.storage.from("expedientes").download(a.ruta)); },
    async deleteFile(a) {
      ok(await sb.storage.from("expedientes").remove([a.ruta]));
      ok(await sb.from("archivos").delete().eq("id", a.id));
    }
  };
}

const Handles = {
  _db: null,
  abrir() {
    if (!this._db) this._db = new Promise((res, rej) => {
      const r = indexedDB.open("correspondencia-carpetas", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("h");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async get(k) {
    try {
      const d = await this.abrir();
      return await new Promise((res, rej) => { const q = d.transaction("h").objectStore("h").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
    } catch { return null; }
  },
  async set(k, v) {
    const d = await this.abrir();
    await new Promise((res, rej) => { const t = d.transaction("h", "readwrite"); if (v === null) t.objectStore("h").delete(k); else t.objectStore("h").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
};

const MESES_CARPETA = ["01-Enero", "02-Febrero", "03-Marzo", "04-Abril", "05-Mayo", "06-Junio", "07-Julio", "08-Agosto", "09-Septiembre", "10-Octubre", "11-Noviembre", "12-Diciembre"];
const PREFIJO_ARCH = { original: "Original", transcripcion: "Transcripcion", revisado: "Revisado", firmado: "Firmado", otro: "Otro" };
const CARPETA_ENTRADA = "Entrada";
const CARPETA_SISTEMA = "_sistema";

function nombreCarpeta(t) {
  return String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);
}

function crearCarpetaDB(raiz) {
  const dir = async (partes, crear = true) => { let d = raiz; for (const p of partes) d = await d.getDirectoryHandle(p, { create: crear }); return d; };
  const leerJSON = async (d, nombre, def) => { try { return JSON.parse(await (await (await d.getFileHandle(nombre)).getFile()).text()); } catch { return def; } };
  const escribir = async (d, nombre, datos) => { const w = await (await d.getFileHandle(nombre, { create: true })).createWritable(); await w.write(datos); await w.close(); };
  const escribirJSON = (d, n, o) => escribir(d, n, new Blob([JSON.stringify(o, null, 2)], { type: "application/json" }));
  const existe = async (d, n) => { try { await d.getFileHandle(n); return true; } catch { return false; } };
  const resumen = doc => { const r = { ...doc }; delete r.texto; return r; };
  let cache = null;
  let excelT = null;
  async function cargar() {
    const docs = new Map();
    for await (const [anio, ha] of raiz.entries()) {
      if (ha.kind !== "directory" || !/^\d{4}$/.test(anio)) continue;
      for await (const [mes, hm] of ha.entries()) {
        if (hm.kind !== "directory") continue;
        (await leerJSON(hm, "indice.json", [])).forEach(e => docs.set(e.id, e));
      }
    }
    cache = docs;
    return docs;
  }
  const asegurar = async () => cache || cargar();
  async function guardarIndice(carpeta) {
    const lista = [...cache.values()].filter(e => e.carpeta[0] === carpeta[0] && e.carpeta[1] === carpeta[1]).sort((a, b) => a.n - b.n);
    await escribirJSON(await dir(carpeta.slice(0, 2)), "indice.json", lista);
  }
  function programarExcel() {
    clearTimeout(excelT);
    excelT = setTimeout(async () => {
      try {
        const libro = libroMatriz([...cache.values()].sort((a, b) => a.n - b.n));
        await escribir(raiz, "Matriz de correspondencia.xlsx", new Blob([XLSX.write(libro, { bookType: "xlsx", type: "array" })]));
      } catch (e) { console.warn("No se pudo actualizar el Excel", e); }
    }, 1500);
  }
  return {
    nombre: "carpeta",
    raiz,
    async sesion() { return { local: true }; },
    async entrada() { return dir([CARPETA_ENTRADA]); },
    async preparar() { await dir([CARPETA_ENTRADA]); await dir([CARPETA_SISTEMA]); },
    async listDocs() { await cargar(); return [...cache.values()].sort((a, b) => b.n - a.n); },
    async getDoc(id) {
      await asegurar();
      const e = cache.get(id);
      if (!e) return null;
      const exp = await leerJSON(await dir(e.carpeta), "expediente.json", null);
      return { ...e, ...(exp ? exp.doc : {}), carpeta: e.carpeta };
    },
    async insertDoc(data) {
      await cargar();
      const sis = await dir([CARPETA_SISTEMA]);
      const cont = await leerJSON(sis, "contador.json", { ultimo: 0 });
      const n = Math.max(cont.ultimo || 0, [...cache.values()].reduce((m, e) => Math.max(m, e.n || 0), 0)) + 1;
      await escribirJSON(sis, "contador.json", { ultimo: n });
      const ahora = new Date().toISOString();
      const fr = data.fecha_recepcion || hoyISO();
      const carpeta = [fr.slice(0, 4), MESES_CARPETA[Number(fr.slice(5, 7)) - 1] || "Sin-mes", `N${String(n).padStart(5, "0")} - ${nombreCarpeta(data.numero_documento) || "sin numero"}`];
      const doc = { estado: "En revisión", confidencial: false, ...data, id: uuid(), n, fecha_recepcion: fr, creado: ahora, actualizado: ahora };
      await escribirJSON(await dir(carpeta), "expediente.json", { doc, archivos: [] });
      cache.set(doc.id, { ...resumen(doc), carpeta, archivos: [] });
      await guardarIndice(carpeta);
      programarExcel();
      return { ...doc, carpeta };
    },
    async updateDoc(id, patch) {
      await asegurar();
      const e = cache.get(id);
      if (!e) throw new Error("no existe el documento");
      const d = await dir(e.carpeta);
      const exp = await leerJSON(d, "expediente.json", { doc: {}, archivos: [] });
      const doc = { ...exp.doc, ...patch, id, n: e.n, actualizado: new Date().toISOString() };
      await escribirJSON(d, "expediente.json", { ...exp, doc });
      cache.set(id, { ...resumen(doc), carpeta: e.carpeta, archivos: e.archivos || [] });
      await guardarIndice(e.carpeta);
      programarExcel();
      return { ...doc, carpeta: e.carpeta };
    },
    async deleteDoc(id) {
      await asegurar();
      const e = cache.get(id);
      if (!e) return;
      await (await dir(e.carpeta.slice(0, 2))).removeEntry(e.carpeta[2], { recursive: true });
      cache.delete(id);
      await guardarIndice(e.carpeta);
      programarExcel();
    },
    async listFiles(id) {
      await asegurar();
      const e = cache.get(id);
      if (!e) return [];
      return (await leerJSON(await dir(e.carpeta), "expediente.json", { archivos: [] })).archivos || [];
    },
    async uploadFile(docId, tipo, blob, nombre) {
      await asegurar();
      const e = cache.get(docId);
      const d = await dir(e.carpeta);
      const exp = await leerJSON(d, "expediente.json", { doc: {}, archivos: [] });
      const base = `${PREFIJO_ARCH[tipo] || "Otro"} - ${nombreCarpeta(nombre) || "archivo"}`;
      let archivo = base, i = 2;
      while (await existe(d, archivo)) archivo = base.replace(/(\.[^.]+)?$/, m => ` (${i++})${m}`);
      await escribir(d, archivo, blob);
      const reg = { id: uuid(), documento_id: docId, tipo, nombre, archivo, ruta: [...e.carpeta, archivo].join("/"), mime: blob.type || "", tamano: blob.size, creado: new Date().toISOString() };
      exp.archivos = [...(exp.archivos || []), reg];
      await escribirJSON(d, "expediente.json", exp);
      e.archivos = [...(e.archivos || []), { tipo }];
      await guardarIndice(e.carpeta);
      return reg;
    },
    async fileBlob(a) {
      await asegurar();
      const e = cache.get(a.documento_id);
      return await (await (await dir(e.carpeta)).getFileHandle(a.archivo)).getFile();
    },
    async deleteFile(a) {
      await asegurar();
      const e = cache.get(a.documento_id);
      const d = await dir(e.carpeta);
      await d.removeEntry(a.archivo);
      const exp = await leerJSON(d, "expediente.json", { doc: {}, archivos: [] });
      exp.archivos = (exp.archivos || []).filter(x => x.id !== a.id);
      await escribirJSON(d, "expediente.json", exp);
      e.archivos = exp.archivos.map(x => ({ tipo: x.tipo }));
      await guardarIndice(e.carpeta);
    }
  };
}

let DB = LocalDB;
let carpetaPendiente = null;
const soportaCarpetas = typeof window.showDirectoryPicker === "function";

async function iniciarDB() {
  const C = window.CONFIG || {};
  const c = C.supabase ? confSupabase() : null;
  carpetaPendiente = null;
  if (c && window.supabase) DB = crearSupaDB(c.url, c.key);
  else {
    DB = LocalDB;
    const hnd = C.carpeta && soportaCarpetas ? await Handles.get("raiz") : null;
    if (hnd) {
      let p = "prompt";
      try { p = await hnd.queryPermission({ mode: "readwrite" }); } catch {}
      if (p === "granted") DB = crearCarpetaDB(hnd);
      else carpetaPendiente = hnd;
    }
  }
  const m = $("#modo");
  m.textContent = DB.nombre === "supabase" ? "Conectado a Supabase" : DB.nombre === "carpeta" ? "Carpeta: " + DB.raiz.name : carpetaPendiente ? "Carpeta sin permiso" : "Guardado en esta PC";
  m.className = "modo" + (DB.nombre === "local" ? " local" : "");
  if (DB.nombre === "supabase") DB.sb.auth.onAuthStateChange(() => pintarUsuario());
  if (DB.nombre === "carpeta") { try { await DB.preparar(); } catch {} }
  if (DB.nombre === "local") await protegerDatos(false);
  iniciarVigilancia();
  pintarUsuario();
}

async function elegirCarpeta() {
  if (!soportaCarpetas) { toast("Este navegador no permite usar carpetas. Usa Microsoft Edge o Google Chrome."); return; }
  let hnd;
  try { hnd = await window.showDirectoryPicker({ id: "correspondencia", mode: "readwrite" }); } catch { return; }
  await Handles.set("raiz", hnd);
  await iniciarDB();
  toast(`Carpeta conectada: ${hnd.name}`);
  router();
}

async function reconectarCarpeta() {
  if (!carpetaPendiente) return elegirCarpeta();
  try {
    if ((await carpetaPendiente.requestPermission({ mode: "readwrite" })) === "granted") { await iniciarDB(); toast("Carpeta reconectada"); router(); }
  } catch (e) { toast("No se pudo reconectar: " + e.message); }
}

async function olvidarCarpeta() {
  await Handles.set("raiz", null);
  await iniciarDB();
  toast("Ahora los datos se guardan solo en este navegador");
  router();
}

let vigilancia = null;
const entradaVista = new Set();

function iniciarVigilancia() {
  clearInterval(vigilancia);
  if (DB.nombre !== "carpeta") return;
  vigilancia = setInterval(revisarEntrada, 10000);
  revisarEntrada();
}

async function revisarEntrada() {
  if (DB.nombre !== "carpeta") return;
  try {
    const d = await DB.entrada();
    const nuevos = [];
    for await (const [nombre, hnd] of d.entries()) {
      if (hnd.kind !== "file" || !/\.(pdf|png|jpe?g)$/i.test(nombre) || entradaVista.has(nombre)) continue;
      entradaVista.add(nombre);
      nuevos.push([nombre, await hnd.getFile()]);
    }
    if (!nuevos.length) return;
    nuevos.forEach(([nombre, f]) => agregarArchivos([f], nombre));
    toast(`${nuevos.length} archivo${nuevos.length === 1 ? "" : "s"} nuevo${nuevos.length === 1 ? "" : "s"} en la carpeta Entrada`);
    pintarPendientes();
  } catch (e) { console.warn("No se pudo revisar la carpeta Entrada", e); }
}

async function quitarDeEntrada(card) {
  card.dataset.listo = "1";
  card.dataset.fin = Date.now();
  const nombre = card.dataset.entrada;
  if (nombre && DB.nombre === "carpeta") {
    try { await (await DB.entrada()).removeEntry(nombre); } catch (e) { console.warn(e); }
    delete card.dataset.entrada;
  }
  pintarPendientes();
}

function pintarPendientes() {
  mostrarActual();
  const n = [...document.querySelectorAll("#cola .doc")].filter(c => !c.dataset.listo).length;
  const a = document.querySelector('#nav a[data-v="transcribir"]');
  let b = a.querySelector(".insignia");
  if (!b) { b = h("span", { class: "insignia" }); a.append(b); }
  b.textContent = n;
  b.hidden = !n;
}

async function pintarUsuario() {
  const u = $("#usuario"), s = $("#salir"), nom = $("#nombre-usuario"), av = $("#avatar");
  if (DB.nombre !== "supabase") {
    u.textContent = DB.nombre === "carpeta" ? "Guardando en: " + DB.raiz.name : "Datos en este navegador"; nom.textContent = "Despacho Ministerial"; av.textContent = "DM"; s.hidden = true; return;
  }
  const ses = await DB.sesion();
  const user = ses && ses.user;
  const meta = (user && user.user_metadata) || {};
  const nombre = meta.nombre || meta.full_name || (user ? user.email.split("@")[0].replace(/[._-]+/g, " ") : "Despacho Ministerial");
  nom.textContent = nombre;
  u.textContent = user ? user.email : "";
  av.textContent = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "DM";
  s.hidden = !ses;
}

function saludo() {
  const hr = new Date().getHours();
  return hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches";
}

const TITULOS_VISTA = {
  login: ["Iniciar sesión", "Sistema de correspondencia · Despacho Ministerial"],
  matriz: ["Matriz de correspondencia", null],
  transcribir: ["Transcribir oficios", "Lectura con PaddleOCR en esta computadora"],
  expediente: ["Expediente", "Datos, archivos y comparación del oficio"],
  ajustes: ["Ajustes", "Datos guardados y respaldos"],
  manual: ["Registro manual", "Ingresa un oficio a la matriz sin subir ningún archivo"]
};

function mostrar(v) {
  const [t, sub] = TITULOS_VISTA[v] || TITULOS_VISTA.matriz;
  $("#titulo").textContent = t;
  const nom = $("#nombre-usuario").textContent;
  $("#subtitulo").textContent = sub || `${saludo()}${nom && nom !== "Despacho Ministerial" ? ", " + nom.split(" ")[0].replace(/^./, c => c.toUpperCase()) : ""} · Despacho Ministerial`;
  $("#accion-nuevo").hidden = !(v === "matriz" || v === "expediente");
  document.querySelector(".lateral").style.visibility = v === "login" ? "hidden" : "visible";
  document.querySelectorAll(".vista").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.v === v || (v === "expediente" && a.dataset.v === "matriz")));
}

async function router() {
  if (DB.nombre === "supabase") {
    const ses = await DB.sesion();
    if (!ses) { mostrar("login"); return; }
  }
  const partes = (location.hash || "#/matriz").replace(/^#\/?/, "").split("/");
  const v = partes[0] || "matriz";
  if (v === "transcribir") mostrar("transcribir");
  else if (v === "ajustes") { mostrar("ajustes"); pintarAjustes(); }
  else if (v === "manual") { mostrar("manual"); $("#v-manual .manual-hecho")?.remove(); await prepararManual(); }
  else if (v === "expediente" && partes[1]) { mostrar("expediente"); await pintarExpediente(partes[1]); }
  else { mostrar("matriz"); await pintarMatriz(); }
}

const MAN = { els: null };

async function prepararManual() {
  if (!MAN.els) {
    const els = {};
    const campo = (cont, k, t, el, full, req) => {
      els[k] = el;
      cont.append(h("label", { class: full ? "full" : "" }, h("span", {}, t, req ? h("b", { class: "req", text: " *" }) : ""), el));
    };
    const ob = $("#m-oblig"), op = $("#m-opc");
    campo(ob, "fecha_recepcion", "Fecha de recepción", h("input", { type: "date" }), false, true);
    campo(ob, "numero_documento", "Número de documento", h("input", { type: "text", placeholder: "Ej. DM-SEDESOL-1042-2026" }), false, true);
    campo(ob, "remitente", "Remitente (institución)", h("input", { type: "text", list: "m-remitentes", placeholder: "Ej. Secretaría de Desarrollo Social" }), true, true);
    campo(ob, "procedencia", "Procedencia (de quién viene)", h("input", { type: "text", list: "m-procedencias", placeholder: "Ej. Despacho de la Ministra, Lic. Ana Pérez" }), true);
    campo(ob, "asunto", "Asunto", h("textarea", { rows: 3, placeholder: "De qué trata el oficio" }), true, true);
    ob.append(h("datalist", { id: "m-remitentes" }), h("datalist", { id: "m-procedencias" }));
    campo(op, "estado", "Estado", h("select", {}, ...ESTADOS.map(e => h("option", { value: e, text: e }))));
    campo(op, "plantilla", "Plantilla del Word (si lo generas)", h("select", {}, ...Object.entries(PLANTILLAS).map(([k, t]) => h("option", { value: k, text: t }))));
    campo(op, "respuesta_seguimiento", "Respuesta o seguimiento", h("input", { type: "text" }), true);
    campo(op, "fecha_respuesta", "Fecha de respuesta", h("input", { type: "date" }));
    els.tipoArch = h("select", {}, ...Object.entries(TIPOS_ARCH).map(([k, t]) => h("option", { value: k, text: t })));
    els.archivo = h("input", { type: "file", accept: "application/pdf,image/*,.doc,.docx" });
    const nomArch = h("span", { class: "m-arch-nom", text: "Ningún archivo elegido" });
    els.archivo.addEventListener("change", () => { nomArch.textContent = els.archivo.files[0] ? els.archivo.files[0].name : "Ningún archivo elegido"; });
    MAN.nomArch = nomArch;
    op.append(h("div", { class: "m-arch" }, h("span", { class: "m-arch-t", text: "Adjuntar archivo (opcional)" }),
      h("div", { class: "m-arch-fila" }, h("button", { type: "button", text: "Elegir archivo…", onclick: () => els.archivo.click() }), nomArch, els.archivo)),
      h("label", {}, "Tipo de archivo", els.tipoArch));
    campo(op, "texto", "Contenido del documento (opcional)", h("textarea", { class: "texto", placeholder: "Si quieres, escribe o pega aquí el texto del oficio. Se usa para buscar y para generar el Word." }), true);
    Object.values(els).forEach(el => el.addEventListener("input", () => el.classList.remove("falta")));
    MAN.els = els;
    $("#m-limpiar").addEventListener("click", () => limpiarManual(true));
    $("#f-manual").addEventListener("submit", ev => { ev.preventDefault(); guardarManual(); });
    limpiarManual(false);
  }
  try {
    const docs = M.docs.length ? M.docs : await DB.listDocs();
    $("#m-procedencias").replaceChildren(...[...new Set(docs.map(d => d.procedencia).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")).map(r => h("option", { value: r })));
    $("#m-remitentes").replaceChildren(...[...new Set(docs.map(remDe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")).map(r => h("option", { value: r })));
  } catch {}
}

function limpiarManual(foco) {
  const e = MAN.els;
  ["numero_documento", "remitente", "procedencia", "asunto", "respuesta_seguimiento", "fecha_respuesta", "texto", "fecha_recepcion"].forEach(k => { e[k].value = ""; e[k].classList.remove("falta"); });
  e.estado.value = "En revisión"; e.plantilla.value = "oficio"; e.tipoArch.value = "original"; e.archivo.value = ""; if (MAN.nomArch) MAN.nomArch.textContent = "Ningún archivo elegido";
  $("#m-status").textContent = "";
  if (foco) e.fecha_recepcion.focus();
}

async function guardarManual() {
  const e = MAN.els, st = $("#m-status");
  const faltan = ["fecha_recepcion", "numero_documento", "remitente", "asunto"].filter(k => !e[k].value.trim());
  faltan.forEach(k => e[k].classList.add("falta"));
  if (faltan.length) {
    e[faltan[0]].focus();
    st.textContent = "Completa los campos marcados en rojo."; st.className = "status bad";
    aviso("Faltan datos", "Llena los campos obligatorios marcados en rojo.", "error");
    return;
  }
  const b = $("#m-guardar"); b.disabled = true;
  st.textContent = "Guardando…"; st.className = "status";
  try {
    const val = k => e[k].value.trim() || null;
    const doc = await DB.insertDoc({
      fecha_recepcion: val("fecha_recepcion"), numero_documento: val("numero_documento"),
      remitente: val("remitente"), institucion: val("remitente"), procedencia: val("procedencia"), asunto: val("asunto"), resumen: val("asunto"),
      estado: e.estado.value, plantilla: e.plantilla.value,
      respuesta_seguimiento: val("respuesta_seguimiento"), fecha_respuesta: val("fecha_respuesta"),
      texto: val("texto"), origen_datos: "manual", confidencial: false
    });
    const f = e.archivo.files[0];
    if (f) await DB.uploadFile(doc.id, e.tipoArch.value, f, f.name);
    M.docs = [];
    limpiarManual(false);
    $("#m-status").textContent = "";
    const hecho = h("div", { class: "manual-hecho" }, h("b", { text: `Guardado como N° ${doc.n}${f ? " con su archivo" : ""}.` }),
      h("a", { href: "#/expediente/" + doc.id }, h("button", { type: "button", text: "Abrir expediente" })),
      h("a", { href: "#/matriz" }, h("button", { type: "button", text: "Ver en la matriz" })));
    $("#v-manual .manual-hecho")?.remove();
    $("#v-manual").prepend(hecho);
    aviso("Documento guardado", `Quedó registrado como N° ${doc.n} en la matriz. Puedes registrar otro.`);
    e.fecha_recepcion.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    hecho.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch (err) {
    st.textContent = "No se pudo guardar: " + err.message; st.className = "status bad";
    aviso("No se pudo completar", "No se pudo guardar: " + err.message, "error");
  }
  b.disabled = false;
}

const M = { docs: [], orden: { k: "n", dir: -1 }, sel: new Set() };
const remDe = d => d.institucion || d.remitente || "";
const asuntoDe = d => d.asunto || d.resumen || "";
const COLS = [
  { k: "sel", t: "", cls: "sel" },
  { k: "n", t: "N°", cls: "n" },
  { k: "fecha_recepcion", t: "Recepción", cls: "fecha", f: d => fFecha(d.fecha_recepcion) },
  { k: "numero_documento", t: "Número de documento", cls: "num" },
  { k: "remitente", t: "Remitente (institución)", cls: "rem", f: remDe },
  { k: "procedencia", t: "Procedencia", cls: "rem" },
  { k: "asunto", t: "Asunto", cls: "asunto", f: asuntoDe },
  { k: "estado", t: "Estado" },
  { k: "respuesta_seguimiento", t: "Respuesta o seguimiento", cls: "resp" },
  { k: "fecha_respuesta", t: "Fecha de respuesta", cls: "fecha", f: d => fFecha(d.fecha_respuesta) },
  { k: "archivos", t: "Archivos" },
  { k: "borrar", t: "", cls: "acc" }
];

function isoDeCelda(v) {
  if (v === null || v === undefined || v === "") return null;
  const iso = (y, m, d) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  if (v instanceof Date) { if (isNaN(v)) return null; const d = new Date(v.getTime() + 12 * 3600e3); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  if (typeof v === "number") { const p = XLSX.SSF.parse_date_code(v); return p ? iso(p.y, p.m, p.d) : null; }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function textoCelda(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return fFecha(isoDeCelda(v));
  return String(v).replace(/\s+/g, " ").trim();
}

function estadoDesdeRespuesta(r) {
  const t = norm(r);
  if (!t || /en revision|en despacho|pendiente|para firma/.test(t)) return "En revisión";
  if (/archiv|atendid|respondid|contestad|finalizad|conclui/.test(t)) return "Archivado";
  return "Asignado";
}

function leerMatrizVieja(libro) {
  const claves = { n: null, fecha_recepcion: null, numero_documento: null, remitente: null, procedencia: null, asunto: null, respuesta_seguimiento: null, fecha_respuesta: null, estado: null };
  for (const nombre of libro.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: null });
    const iCab = filas.findIndex(f => { const t = f.map(norm).join("|"); return /remitente|institucion/.test(t) && /asunto|resumen/.test(t); });
    if (iCab < 0) continue;
    const cab = filas[iCab].map(norm);
    const col = { ...claves };
    cab.forEach((c, i) => {
      if (!c) return;
      if (/^n\s*[°ºo.]?$/.test(c) || c === "no" || c === "n°") { if (col.n === null) col.n = i; }
      else if (c.includes("fecha") && c.includes("respuesta")) { if (col.fecha_respuesta === null) col.fecha_respuesta = i; }
      else if (c.includes("fecha")) { if (col.fecha_recepcion === null && !/cambio|firma|sello/.test(c)) col.fecha_recepcion = i; }
      else if (c.includes("numero")) { if (col.numero_documento === null) col.numero_documento = i; }
      else if (/procedencia|de quien|origen/.test(c)) { if (col.procedencia === null) col.procedencia = i; }
      else if (/remitente|institucion/.test(c)) { if (col.remitente === null) col.remitente = i; }
      else if (c.includes("asunto") || (c.includes("resumen") && col.asunto === null)) { if (col.asunto === null || c.includes("asunto")) col.asunto = i; }
      else if (c.includes("respuesta") || c.includes("seguimiento")) { if (col.respuesta_seguimiento === null) col.respuesta_seguimiento = i; }
      else if (c.includes("estado")) { if (col.estado === null) col.estado = i; }
    });
    const usadas = new Set(Object.values(col).filter(v => v !== null));
    const filasDoc = [], avisos = [];
    filas.slice(iCab + 1).forEach((f, k) => {
      const fila = iCab + 2 + k;
      const g = c => col[c] === null ? null : f[col[c]];
      const datos = { numero: textoCelda(g("numero_documento")), rem: textoCelda(g("remitente")), asunto: textoCelda(g("asunto")) };
      if (!datos.numero && !datos.rem && !datos.asunto) return;
      const fr = isoDeCelda(g("fecha_recepcion"));
      if (!fr) avisos.push(`Fila ${fila}: sin fecha válida${g("fecha_recepcion") ? ` (“${textoCelda(g("fecha_recepcion"))}”)` : ""}`);
      let resp = textoCelda(g("respuesta_seguimiento"));
      const extras = f.map((v, i) => usadas.has(i) ? "" : textoCelda(v)).filter(Boolean);
      if (extras.length) resp = [resp, ...extras].filter(Boolean).join(" · ");
      const frr = isoDeCelda(g("fecha_respuesta"));
      const estOrig = textoCelda(g("estado"));
      const estado = ESTADOS.find(e => norm(e) === norm(estOrig)) || ESTADO_ANTERIOR[estOrig] || estadoDesdeRespuesta(textoCelda(g("respuesta_seguimiento")));
      filasDoc.push({
        fila,
        doc: {
          fecha_recepcion: fr, numero_documento: datos.numero || null,
          remitente: datos.rem || null, institucion: datos.rem || null, procedencia: textoCelda(g("procedencia")) || null,
          asunto: datos.asunto || null, resumen: datos.asunto || null,
          respuesta_seguimiento: resp || null, fecha_respuesta: frr,
          estado, plantilla: "oficio", origen_datos: "matriz anterior"
        }
      });
    });
    return { hoja: nombre, col, filas: filasDoc, avisos };
  }
  throw new Error("no encontré una hoja con las columnas REMITENTE y ASUNTO");
}

const claveDoc = d => [norm(d.numero_documento).replace(/\s+/g, ""), d.fecha_recepcion || "", norm(asuntoDe(d)).slice(0, 60)].join("|");

async function importarMatriz(file) {
  let res;
  try {
    const libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    res = leerMatrizVieja(libro);
  } catch (e) { aviso("No se pudo completar", "No se pudo leer el Excel: " + e.message, "error"); return; }
  const actuales = await DB.listDocs();
  const existentes = new Set(actuales.map(claveDoc));
  const vistos = new Set();
  const nuevos = [], repetidos = [];
  res.filas.forEach(x => {
    const k = claveDoc(x.doc);
    if (existentes.has(k) || vistos.has(k)) repetidos.push(x); else { vistos.add(k); nuevos.push(x); }
  });
  const cuenta = e => nuevos.filter(x => x.doc.estado === e).length;
  const fechas = nuevos.map(x => x.doc.fecha_recepcion).filter(Boolean).sort();
  const dlg = $("#dlg-importar");
  const renum = h("input", { type: "checkbox", checked: true });
  const bImp = h("button", { class: "primary", type: "button", text: nuevos.length ? `Importar ${nuevos.length} documentos` : "Nada que importar", disabled: !nuevos.length });
  const tabla = h("div", { class: "imp-tabla" }, h("table", {},
    h("thead", {}, h("tr", {}, ...["Fila", "Recepción", "Número", "Remitente", "Asunto", "Respuesta o seguimiento", "Estado"].map(t => h("th", { text: t })))),
    h("tbody", {}, ...nuevos.slice(0, 50).map(x => h("tr", {},
      h("td", { text: x.fila }), h("td", { text: fFecha(x.doc.fecha_recepcion) || "—" }), h("td", { text: x.doc.numero_documento || "" }),
      h("td", { text: x.doc.remitente || "" }), h("td", { text: x.doc.asunto || "" }), h("td", { text: x.doc.respuesta_seguimiento || "" }),
      h("td", {}, h("span", { class: claseEstado(x.doc.estado), text: x.doc.estado })))))));
  dlg.replaceChildren(h("div", { class: "imp" },
    h("h2", { text: "Importar matriz anterior" }),
    h("p", { class: "nota", text: `Archivo “${file.name}”, hoja “${res.hoja}”.` }),
    h("div", { class: "imp-kpis" },
      h("div", {}, h("b", { text: nuevos.length }), h("span", { text: "documentos nuevos" })),
      h("div", {}, h("b", { text: repetidos.length }), h("span", { text: "ya estaban (se omiten)" })),
      h("div", {}, h("b", { text: fechas.length ? `${fFecha(fechas[0])} – ${fFecha(fechas[fechas.length - 1])}` : "—" }), h("span", { text: "rango de fechas" }))),
    h("p", { class: "imp-est" }, "Estado asignado según la columna de respuesta: ",
      ...ESTADOS.map(e => h("span", { class: claseEstado(e), text: `${e}: ${cuenta(e)}` }))),
    res.avisos.length ? h("details", { class: "imp-avisos" }, h("summary", { text: `${res.avisos.length} fila${res.avisos.length === 1 ? "" : "s"} sin fecha válida (se importan sin fecha de recepción)` }), h("ul", {}, ...res.avisos.map(a => h("li", { text: a })))) : "",
    h("label", { class: "chk" }, renum, "Ordenar todos los N° por fecha de recepción (los documentos de la matriz anterior quedan primero y los registrados en el sistema se renumeran después)"),
    nuevos.length ? h("p", { class: "nota", text: nuevos.length > 50 ? `Vista previa de los primeros 50 de ${nuevos.length}:` : "Vista previa:" }) : "",
    nuevos.length ? tabla : "",
    h("div", { class: "acciones" },
      h("button", { type: "button", text: "Descargar respaldo antes", onclick: ev => descargarRespaldo(ev.target) }),
      h("span", { class: "sp" }),
      h("button", { type: "button", text: "Cancelar", autofocus: true, onclick: () => dlg.close() }), bImp)));
  bImp.onclick = async () => {
    bImp.disabled = true; bImp.textContent = "Importando…";
    try {
      let n;
      if (DB.importarDocs) n = await DB.importarDocs(nuevos.map(x => x.doc), renum.checked);
      else { n = 0; for (const x of nuevos) { await DB.insertDoc(x.doc); n++; } }
      dlg.close();
      aviso("Matriz importada", `Se agregaron ${n} documentos de la matriz anterior${repetidos.length ? ` y se omitieron ${repetidos.length} repetidos` : ""}.`);
      location.hash = "#/matriz"; await pintarMatriz();
    } catch (e) {
      bImp.disabled = false; bImp.textContent = `Importar ${nuevos.length} documentos`;
      aviso("No se pudo completar", "No se pudo importar: " + e.message, "error");
    }
  };
  dlg.showModal();
}

async function borrarDocs(ids) {
  let ok = 0;
  for (const id of ids) {
    try { await DB.deleteDoc(id); ok++; M.sel.delete(id); } catch (e) { toast("No se pudo eliminar: " + e.message); }
  }
  if (ok) aviso(ok === 1 ? "Documento eliminado" : `${ok} documentos eliminados`, "Se quitaron de la matriz con todos sus archivos.");
  await pintarMatriz();
}

function pintarSeleccion() {
  const b = $("#borrar-sel");
  const n = M.sel.size;
  b.hidden = !n;
  if (b.textContent !== "Sí, eliminar") b.textContent = `Eliminar (${n})`;
}

let datosProtegidos = false;

async function protegerDatos(pedir) {
  try {
    if (!navigator.storage) return false;
    datosProtegidos = await navigator.storage.persisted();
    if (!datosProtegidos && navigator.storage.persist) datosProtegidos = await navigator.storage.persist();
    if (pedir && datosProtegidos) aviso("Datos protegidos", "El navegador no los borrará por su cuenta.");
    else if (pedir) toast("El navegador no aceptó protegerlos todavía. Instala el sistema como aplicación (menú ⋯ › Aplicaciones › Instalar este sitio como aplicación), ábrelo desde ahí y vuelve a pulsar “Proteger datos”.");
  } catch {}
  return datosProtegidos;
}

async function espacioUsado() {
  try { const e = await navigator.storage.estimate(); return { usado: e.usage || 0, total: e.quota || 0 }; } catch { return null; }
}

function diasDesdeRespaldo() {
  const u = leerAjustes().ultimoRespaldo;
  return u ? Math.floor((Date.now() - new Date(u).getTime()) / 864e5) : null;
}

async function descargarRespaldo(boton) {
  if (boton) boton.disabled = true;
  try {
    toast("Preparando el respaldo…");
    const docs = await LocalDB.req((await LocalDB.tienda("documentos")).getAll());
    const archs = await LocalDB.req((await LocalDB.tienda("archivos")).getAll());
    const zip = new JSZip();
    zip.file("datos.json", JSON.stringify({ sistema: "correspondencia-diger", version: 1, fecha: new Date().toISOString(), documentos: docs, archivos: archs }));
    for (const a of archs) { const b = await LocalDB.fileBlob(a); if (b) zip.file("archivos/" + a.ruta, b); }
    zip.file("Matriz de correspondencia.xlsx", XLSX.write(libroMatriz(docs.slice().sort((a, b) => a.n - b.n)), { bookType: "xlsx", type: "array" }));
    descargar(await zip.generateAsync({ type: "blob" }), `Respaldo correspondencia ${hoyISO()}.zip`);
    guardarAjustes({ ultimoRespaldo: new Date().toISOString() });
    aviso("Respaldo descargado", `${docs.length} documentos y ${archs.length} archivos. Guárdalo en OneDrive.`);
  } catch (e) { toast("No se pudo crear el respaldo: " + e.message); }
  if (boton) boton.disabled = false;
  if (location.hash.startsWith("#/ajustes")) pintarAjustes();
}

async function restaurarRespaldo(file) {
  try {
    const zip = await JSZip.loadAsync(file);
    const f = zip.file("datos.json");
    if (!f) throw new Error("el archivo no es un respaldo del sistema");
    const datos = JSON.parse(await f.async("string"));
    if (datos.sistema !== "correspondencia-diger") throw new Error("el archivo no es un respaldo del sistema");
    const blobs = [];
    for (const a of datos.archivos || []) {
      const z = zip.file("archivos/" + a.ruta);
      if (z) blobs.push([a.ruta, new Blob([await z.async("arraybuffer")], { type: a.mime || "" })]);
    }
    const t = (await LocalDB.abrir()).transaction(["documentos", "archivos", "blobs"], "readwrite");
    (datos.documentos || []).forEach(d => t.objectStore("documentos").put(d));
    (datos.archivos || []).forEach(a => t.objectStore("archivos").put(a));
    blobs.forEach(([ruta, b]) => t.objectStore("blobs").put(b, ruta));
    await LocalDB.fin(t);
    aviso("Respaldo restaurado", `${(datos.documentos || []).length} documentos y ${blobs.length} archivos recuperados.`);
    location.hash = "#/matriz";
    router();
  } catch (e) { toast("No se pudo restaurar: " + e.message); }
}

function avisoAlmacen() {
  if (DB.nombre !== "local") return "";
  if (!(window.CONFIG || {}).carpeta) {
    const dias = diasDesdeRespaldo();
    if (!M.docs.length) return h("div", { class: "aviso bienvenida" },
      h("div", {}, h("b", { text: "La matriz está vacía en esta dirección." }), h("span", { text: " ¿Ya usabas el sistema en otra dirección o en otra computadora? Elige el respaldo (.zip) que descargaste allá y se cargan todos los documentos con sus archivos." })),
      h("button", { class: "primary", text: "Restaurar respaldo…", onclick: () => $("#a-restaurar-arch").click() }));
    if (!datosProtegidos) return h("div", { class: "aviso info" }, h("b", { text: "Los datos se guardan en esta PC. " }), "Se conservan al cerrar el navegador, pero se pierden si se borran los datos de navegación. Protégelos y haz respaldos en OneDrive. ", h("button", { class: "primary", text: "Proteger datos", onclick: async () => { await protegerDatos(true); router(); } }), " ", h("button", { text: "Descargar respaldo", onclick: ev => descargarRespaldo(ev.target) }));
    if (M.docs.length && (dias === null || dias >= 7)) return h("div", { class: "aviso info" }, h("b", { text: dias === null ? "Todavía no hay respaldo. " : `Último respaldo hace ${dias} días. ` }), "Descarga un respaldo y guárdalo en OneDrive. ", h("button", { class: "primary", text: "Descargar respaldo", onclick: ev => descargarRespaldo(ev.target) }));
    return "";
  }
  if (carpetaPendiente) return h("div", { class: "aviso info" }, h("b", { text: "Falta permiso para la carpeta. " }), `El navegador pide confirmar el acceso a “${carpetaPendiente.name}” cada vez que se abre el sistema. `, h("button", { class: "primary", text: "Reconectar carpeta", onclick: reconectarCarpeta }));
  if (!soportaCarpetas) return h("div", { class: "aviso info" }, h("b", { text: "Solo este navegador. " }), "Para guardar en una carpeta de OneDrive, abre el sistema en Microsoft Edge o Google Chrome.");
  return h("div", { class: "aviso info" }, h("b", { text: "Elige la carpeta de trabajo. " }), "Los expedientes, los Word y la matriz en Excel se guardarán ahí, por ejemplo en una carpeta de OneDrive. Mientras tanto, los datos quedan solo en este navegador. ", h("button", { class: "primary", text: "Elegir carpeta", onclick: elegirCarpeta }));
}

async function pintarMatriz() {
  const body = $("#m-body");
  body.replaceChildren(h("tr", {}, h("td", { colspan: COLS.length, class: "vacio", text: "Cargando…" })));
  try {
    M.docs = await DB.listDocs();
    $("#aviso-local").replaceChildren(avisoAlmacen());
  } catch (e) {
    body.replaceChildren(h("tr", {}, h("td", { colspan: COLS.length, class: "vacio", text: "No se pudo cargar la matriz: " + e.message })));
    return;
  }
  prepararFiltros();
  pintarKpis();
  pintarTabla();
}

const ICONOS = {
  pulso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  ojo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/></svg>'
};

const ICONO_BORRAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

function icono(n, clase) {
  const s = document.createElement("span");
  s.className = clase || "";
  s.innerHTML = ICONOS[n];
  s.style.display = "inline-flex";
  return s;
}

function pintarKpis() {
  const hoy = hoyISO();
  const c = e => M.docs.filter(d => estadoDe(d) === e).length;
  const recibidosHoy = M.docs.filter(d => String(d.fecha_recepcion || "").slice(0, 10) === hoy).length;
  const datos = [
    ["Registrados", M.docs.length, `${recibidosHoy} recibido${recibidosHoy === 1 ? "" : "s"} hoy`, "pulso", "i-blanco", true],
    ["En revisión", c("En revisión"), "Pendientes de asignar", "ojo", "i-warn"],
    ["Asignados", c("Asignado"), "En manos del responsable", "pulso", "i-celeste"],
    ["Archivados", c("Archivado"), "Proceso terminado", "check", "i-good"]
  ];
  const filtroE = { "En revisión": "En revisión", "Asignados": "Asignado", "Archivados": "Archivado" };
  const actual = FC.estado ? FC.estado.el.value : "";
  $("#kpis").replaceChildren(...datos.map(([t, v, sub, ic, cl, dest]) => h("div", { class: "panel kpi" + (dest ? " destacada" : "") + (filtroE[t] && actual === filtroE[t] ? " elegida" : ""), title: dest ? "Ver todos" : "Filtrar por " + t.toLowerCase(),
    onclick: () => { if (!FC.estado) return; FC.estado.el.value = dest || actual === filtroE[t] ? "" : filtroE[t]; pintarKpis(); alFiltrar(); } },
    h("div", { class: "kpi-top" }, h("span", { text: t }), icono(ic, cl)), h("b", { text: v }), h("small", { text: sub }))));
}

const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const unicos = k => [...new Set(M.docs.map(d => d[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));

const FILTROS = [
  { k: "estado", t: "Estado", tipo: "sel", ops: () => ESTADOS, barra: true, prueba: (d, v) => estadoDe(d) === v },
  { k: "remitente", t: "Remitente (institución)", tipo: "sel", ops: () => [...new Set(M.docs.map(remDe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), barra: true, prueba: (d, v) => remDe(d) === v },
  { k: "procedencia", t: "Procedencia", tipo: "sel", ops: () => unicos("procedencia") },
  { k: "plantilla", t: "Plantilla del Word", tipo: "sel", ops: () => Object.entries(PLANTILLAS) },
  { k: "archivo", t: "Archivos", tipo: "sel", ops: () => [["original", "Con original escaneado"], ["transcripcion", "Con Word"], ["revisado", "Con revisado"], ["firmado", "Con firmado"], ["-transcripcion", "Sin Word"], ["-revisado", "Sin revisado"], ["-firmado", "Sin firmar"]],
    prueba: (d, v) => { const tiene = (d.archivos || []).some(a => a.tipo === v.replace("-", "")); return v.startsWith("-") ? !tiene : tiene; } },
  { k: "con_respuesta", t: "Respuesta o seguimiento", tipo: "sel", ops: () => [["si", "Con respuesta"], ["no", "Sin respuesta"]],
    prueba: (d, v) => !!String(d.respuesta_seguimiento || "").trim() === (v === "si") },
  { k: "numero_documento", t: "Número de documento", tipo: "txt" },
  { k: "asunto", t: "Asunto contiene", tipo: "txt", prueba: (d, v) => norm(asuntoDe(d)).includes(norm(v)) },
  { k: "respuesta_seguimiento", t: "Respuesta contiene", tipo: "txt" },
  { k: "n", t: "N°", tipo: "num" },
  { k: "fecha_recepcion", t: "Fecha de recepción", tipo: "rango" },
  { k: "fecha_respuesta", t: "Fecha de respuesta", tipo: "rango" },
  { k: "texto", t: "Texto transcrito contiene", tipo: "txt" }
];

const FC = {};

function opcionesSel(f) {
  return f.ops().map(o => Array.isArray(o) ? o : [o, o]);
}

function crearFiltros() {
  const panel = $("#f-panel"), barra = $("#f-barra");
  FILTROS.forEach(f => {
    let ctl;
    if (f.tipo === "sel") ctl = { el: h("select", { onchange: alFiltrar }) };
    else if (f.tipo === "txt") ctl = { el: h("input", { type: "search", placeholder: "Escribe para filtrar", oninput: alFiltrar }) };
    else {
      const t = f.tipo === "num" ? "number" : "date";
      const a = h("input", { type: t, min: t === "number" ? "1" : null, oninput: () => { if (f.k === "fecha_recepcion") $("#f-periodo").value = a.value || b.value ? "custom" : ""; alFiltrar(); } });
      const b = h("input", { type: t, min: t === "number" ? "1" : null, oninput: () => { if (f.k === "fecha_recepcion") $("#f-periodo").value = a.value || b.value ? "custom" : ""; alFiltrar(); } });
      ctl = { a, b, el: h("div", { class: "rango" }, h("span", { text: "de" }), a, h("span", { text: "a" }), b) };
    }
    FC[f.k] = ctl;
    if (f.barra) { ctl.el.title = f.t; barra.append(ctl.el); }
    else panel.append(h("label", { class: ctl.a ? "ancho" : "" }, f.t, ctl.el));
  });
}

function prepararFiltros() {
  if (!FC.estado) crearFiltros();
  FILTROS.filter(f => f.tipo === "sel").forEach(f => {
    const el = FC[f.k].el, v = el.value;
    const ops = opcionesSel(f);
    if (v && !ops.some(o => o[0] === v)) ops.push([v, v]);
    el.replaceChildren(h("option", { value: "", text: f.barra ? (f.k === "estado" ? "Todos los estados" : "Todos los remitentes") : "Todos" }), ...ops.map(([val, txt]) => h("option", { value: val, text: txt })));
    el.value = v;
  });
}

function valorFiltro(f) {
  const c = FC[f.k];
  if (!c) return null;
  if (c.a) return c.a.value || c.b.value ? [c.a.value, c.b.value] : null;
  return c.el.value.trim() || null;
}

function textoFiltro(f, v) {
  if (Array.isArray(v)) {
    const fmt = x => f.tipo === "num" ? x : fFecha(x);
    return `${f.t}: ${v[0] && v[1] ? fmt(v[0]) + " a " + fmt(v[1]) : v[0] ? "desde " + fmt(v[0]) : "hasta " + fmt(v[1])}`;
  }
  if (f.tipo === "sel") { const o = opcionesSel(f).find(x => x[0] === v); return `${f.t}: ${o ? o[1] : v}`; }
  return `${f.t}: “${v}”`;
}

function limpiarFiltro(f) {
  const c = FC[f.k];
  if (c.a) { c.a.value = ""; c.b.value = ""; } else c.el.value = "";
  if (f.k === "fecha_recepcion") $("#f-periodo").value = "";
}

function aplicarPeriodo() {
  const p = $("#f-periodo").value, c = FC.fecha_recepcion;
  if (p === "custom") { $("#f-panel-wrap").hidden = false; c.a.focus(); return; }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth();
  const rangos = {
    hoy: [iso(hoy), iso(hoy)],
    ayer: (() => { const a = new Date(y, m, hoy.getDate() - 1); return [iso(a), iso(a)]; })(),
    semana: [iso(new Date(y, m, hoy.getDate() - ((hoy.getDay() + 6) % 7))), iso(hoy)],
    d30: [iso(new Date(y, m, hoy.getDate() - 29)), iso(hoy)],
    mes: [iso(new Date(y, m, 1)), iso(hoy)],
    mespasado: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    anio: [iso(new Date(y, 0, 1)), iso(hoy)]
  };
  const r = rangos[p] || ["", ""];
  c.a.value = r[0]; c.b.value = r[1];
  alFiltrar();
}

function alFiltrar() {
  pintarTabla();
  pintarChips();
}

function pintarChips() {
  const activos = FILTROS.map(f => [f, valorFiltro(f)]).filter(([, v]) => v);
  const q = $("#buscar").value.trim();
  const masActivos = activos.filter(([f]) => !f.barra).length;
  $("#f-mas").textContent = masActivos ? `Más filtros (${masActivos})` : "Más filtros";
  $("#f-mas").classList.toggle("activo", !!masActivos);
  $("#f-limpiar").hidden = !activos.length && !q;
  const chips = activos.map(([f, v]) => h("span", { class: "fchip" }, textoFiltro(f, v), h("button", { type: "button", title: "Quitar filtro", text: "×", onclick: () => { limpiarFiltro(f); alFiltrar(); } })));
  if (q) chips.unshift(h("span", { class: "fchip" }, `Búsqueda: “${q}”`, h("button", { type: "button", title: "Quitar búsqueda", text: "×", onclick: () => { $("#buscar").value = ""; alFiltrar(); } })));
  $("#f-chips").replaceChildren(...chips);
  $("#f-chips").hidden = !chips.length;
}

function limpiarFiltros() {
  FILTROS.forEach(limpiarFiltro);
  $("#buscar").value = "";
  alFiltrar();
}

function docsFiltrados() {
  const q = norm($("#buscar").value);
  const activos = FILTROS.map(f => [f, valorFiltro(f)]).filter(([, v]) => v);
  const { k, dir } = M.orden;
  return M.docs.filter(d => {
    if (q && !norm([d.n, d.numero_documento, remDe(d), d.procedencia, asuntoDe(d), d.respuesta_seguimiento, estadoDe(d), fFecha(d.fecha_recepcion), fFecha(d.fecha_respuesta)].join(" ")).includes(q)) return false;
    return activos.every(([f, v]) => {
      if (f.prueba) return f.prueba(d, v);
      if (f.tipo === "sel") return String(d[f.k] ?? "") === v;
      if (f.tipo === "txt") return norm(d[f.k]).includes(norm(v));
      if (f.tipo === "num") { const n = Number(d.n); return (!v[0] || n >= Number(v[0])) && (!v[1] || n <= Number(v[1])); }
      const x = String(d[f.k] || "").slice(0, 10);
      if (!x) return false;
      return (!v[0] || x >= v[0]) && (!v[1] || x <= v[1]);
    });
  })
    .sort((a, b) => {
      const val = d => k === "archivos" ? (d.archivos || []).length : k === "remitente" ? remDe(d) : k === "asunto" ? asuntoDe(d) : d[k];
      const va = val(a), vb = val(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === "") return 1;
      if (vb === null || vb === undefined || vb === "") return -1;
      return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "es")) * dir;
    });
}

function pintarTabla() {
  const lista = docsFiltrados();
  $("#f-cuenta").textContent = lista.length === M.docs.length ? `${M.docs.length} documento${M.docs.length === 1 ? "" : "s"}` : `Mostrando ${lista.length} de ${M.docs.length}`;
  [...M.sel].forEach(id => { if (!M.docs.some(d => d.id === id)) M.sel.delete(id); });
  $("#m-head").replaceChildren(...COLS.map(c => {
    if (c.k === "sel") {
      const todos = lista.length > 0 && lista.every(d => M.sel.has(d.id));
      return h("th", { class: "sel" }, h("input", { type: "checkbox", title: "Seleccionar todos los que se ven", checked: todos, onchange: ev => { lista.forEach(d => ev.target.checked ? M.sel.add(d.id) : M.sel.delete(d.id)); pintarTabla(); } }));
    }
    if (c.k === "borrar") return h("th", { class: "acc" });
    return h("th", {
      onclick: () => { M.orden = { k: c.k, dir: M.orden.k === c.k ? -M.orden.dir : 1 }; pintarTabla(); }
    }, c.t, M.orden.k === c.k ? h("span", { class: "fl", text: M.orden.dir > 0 ? "▲" : "▼" }) : "");
  }));
  pintarSeleccion();
  const docs = lista;
  const body = $("#m-body");
  if (!docs.length) {
    body.replaceChildren(h("tr", {}, h("td", { colspan: COLS.length, class: "vacio" }, M.docs.length ? "No hay documentos con esos filtros." : "Todavía no hay documentos. Empieza en ", M.docs.length ? "" : h("a", { href: "#/transcribir", text: "Transcribir" }), M.docs.length ? "" : ".")));
    return;
  }
  body.replaceChildren(...docs.map(d => h("tr", { onclick: () => { location.hash = "#/expediente/" + d.id; } }, ...COLS.map(c => {
    if (c.k === "sel") return h("td", { class: "sel", onclick: ev => ev.stopPropagation() }, h("input", { type: "checkbox", checked: M.sel.has(d.id), onchange: ev => { ev.target.checked ? M.sel.add(d.id) : M.sel.delete(d.id); pintarTabla(); } }));
    if (c.k === "borrar") {
      const b = h("button", { type: "button", class: "borrar", title: `Eliminar el N° ${d.n}`, onclick: ev => ev.stopPropagation() });
      b.innerHTML = ICONO_BORRAR;
      let armado = 0;
      b.addEventListener("click", () => {
        if (Date.now() < armado) { armado = 0; b.disabled = true; borrarDocs([d.id]); return; }
        armado = Date.now() + 6000;
        b.classList.add("peligro"); b.textContent = "¿Eliminar?";
        toast(`Se eliminará el N° ${d.n} con todos sus archivos. Pulsa otra vez para confirmar.`);
        setTimeout(() => { if (armado && Date.now() >= armado - 50) { armado = 0; b.classList.remove("peligro"); b.innerHTML = ICONO_BORRAR; } }, 6000);
      });
      return h("td", { class: "acc", onclick: ev => ev.stopPropagation() }, b);
    }
    if (c.k === "estado") {
      const sel = h("select", { onclick: ev => ev.stopPropagation(), onchange: async ev => {
        try { await DB.updateDoc(d.id, { estado: ev.target.value }); d.estado = ev.target.value; pintarKpis(); aviso("Estado actualizado", `El N° ${d.n} ahora está “${d.estado}”.`); }
        catch (e) { toast("No se pudo cambiar el estado: " + e.message); ev.target.value = estadoDe(d); }
      } }, ...ESTADOS.map(e => h("option", { value: e, text: e })));
      sel.value = estadoDe(d);
      return h("td", {}, sel);
    }
    if (c.k === "archivos") {
      const cuenta = {};
      (d.archivos || []).forEach(a => { cuenta[a.tipo] = (cuenta[a.tipo] || 0) + 1; });
      return h("td", {}, h("div", { class: "archs" }, ...Object.entries(cuenta).map(([t, n]) => h("span", { class: "ach", text: CORTO_ARCH[t] + (n > 1 ? " ×" + n : "") }))));
    }
    const val = c.f ? c.f(d) : (d[c.k] ?? "");
    return h("td", { class: c.cls || "" }, String(val), c.sec && c.sec(d) ? h("span", { class: "sec", text: c.sec(d) }) : "");
  }))));
}

function libroMatriz(docs) {
  const C = window.CONFIG || {};
  const enc = ["N°", "FECHA DE RECEPCIÓN", "NÚMERO DE DOCUMENTO", "REMITENTE", "PROCEDENCIA", "ASUNTO", "ESTADO", "RESPUESTA O SEGUIMIENTO", "FECHA DE RESPUESTA"];
  const filas = docs.map(d => [d.n, fFecha(d.fecha_recepcion), d.numero_documento || "", remDe(d), d.procedencia || "", asuntoDe(d), estadoDe(d), d.respuesta_seguimiento || "", fFecha(d.fecha_respuesta)]);
  const aoa = [[C.institucion || "DIRECCIÓN DE GESTIÓN POR RESULTADOS"], [C.area || "DESPACHO MINISTERIAL"], [C.titulo || "GESTIÓN DE CORRESPONDENCIA"], enc, ...filas];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: enc.length - 1 } }));
  ws["!cols"] = [6, 14, 24, 40, 32, 70, 16, 40, 14].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
  return wb;
}

function exportarExcel() {
  XLSX.writeFile(libroMatriz(docsFiltrados().slice().sort((a, b) => a.n - b.n)), `Matriz de correspondencia ${hoyISO()}.xlsx`);
}

const CAMPOS = [
  { k: "numero_documento", t: "Número de documento", cls: "num" },
  { k: "fecha_recepcion", t: "Fecha de recepción", tipo: "date" },
  { k: "remitente", t: "Remitente (institución)", full: true },
  { k: "procedencia", t: "Procedencia (de quién viene)", full: true },
  { k: "asunto", t: "Asunto", tipo: "area", full: true },
  { k: "estado", t: "Estado", tipo: "estado" },
  { k: "plantilla", t: "Plantilla del Word (si lo generas)", tipo: "plantilla" },
  { k: "respuesta_seguimiento", t: "Respuesta o seguimiento", full: true },
  { k: "fecha_respuesta", t: "Fecha de respuesta", tipo: "date" }
];

function construirForm(cont, datos, conTexto) {
  const els = {};
  CAMPOS.forEach(c => {
    let el;
    if (c.tipo === "tipo") el = h("select", {}, h("option", { value: "", text: "—" }), ...TIPOS_DOC.map(t => h("option", { value: t, text: t })));
    else if (c.tipo === "estado") el = h("select", {}, ...ESTADOS.map(e => h("option", { value: e, text: e })));
    else if (c.tipo === "plantilla") el = h("select", {}, ...Object.entries(PLANTILLAS).map(([k, t]) => h("option", { value: k, text: t })));
    else if (c.tipo === "area") el = h("textarea", { rows: 3 });
    else el = h("input", { type: c.tipo === "date" ? "date" : "text" });
    els[c.k] = el;
    if (c.k === "fecha_recepcion") el.addEventListener("input", () => el.classList.remove("falta"));
    cont.append(h("label", { class: c.full ? "full" : "" }, c.t, el));
  });
  els.confidencial = h("input", { type: "checkbox" });
  cont.append(h("label", { class: "chk full solo-ia" }, els.confidencial, "Confidencial: no enviar a Groq"));
  if (conTexto) {
    els.texto = h("textarea", { class: "texto" });
    cont.append(h("label", { class: "full" }, "Texto transcrito (editable)", els.texto));
  }
  const d0 = datos || {};
  llenarForm(els, { ...d0, remitente: remDe(d0) || null, asunto: asuntoDe(d0) || null });
  return els;
}

function llenarForm(els, d) {
  Object.entries(els).forEach(([k, el]) => {
    if (!(k in d)) return;
    if (k === "confidencial") el.checked = !!d[k];
    else if (k === "tipo" && d[k] && !TIPOS_DOC.includes(d[k])) { el.append(h("option", { value: d[k], text: d[k] })); el.value = d[k]; }
    else el.value = d[k] ?? "";
  });
  if (els.estado) els.estado.value = ESTADO_ANTERIOR[els.estado.value] || els.estado.value || "En revisión";
  if (els.plantilla && !els.plantilla.value) els.plantilla.value = "oficio";
}

function leerForm(els) {
  const o = {};
  Object.entries(els).forEach(([k, el]) => {
    if (k === "confidencial") o[k] = el.checked;
    else { const v = el.value.trim(); o[k] = v === "" ? null : v; }
  });
  if (!o.estado) o.estado = "En revisión";
  if ("remitente" in o) o.institucion = o.remitente;
  if ("asunto" in o) o.resumen = o.asunto;
  if ("plantilla" in o && !o.plantilla) o.plantilla = "oficio";
  return o;
}

function rellenarVacios(els, datos) {
  Object.entries(datos).forEach(([k, v]) => {
    if (!v || !els[k]) return;
    if (!els[k].value) llenarForm(els, { [k]: v });
  });
}

function tipoNormal(t) {
  if (!t) return null;
  const x = TIPOS_DOC.find(y => y.toLowerCase() === String(t).toLowerCase().replace("memorándum", "memorando"));
  return x || t;
}

function qrPNG(texto) {
  const q = qrcode(0, "M");
  q.addData(texto);
  q.make();
  const n = q.getModuleCount(), cel = 8, margen = 4 * cel;
  const c = document.createElement("canvas");
  c.width = c.height = n * cel + margen * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(margen + k * cel, margen + r * cel, cel, cel);
  const bin = atob(c.toDataURL("image/png").split(",")[1]);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function leerQRCanvas(src, x, y, w, hgt, escala) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * escala));
  c.height = Math.max(1, Math.round(hgt * escala));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, x, y, w, hgt, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const r = jsQR(img.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
  return r && r.data ? r.data : null;
}

function buscarQR(paginas) {
  for (const p of paginas.slice(0, 3)) {
    const W = p.width, H = p.height;
    const intentos = [
      [W * 0.55, 0, W * 0.45, H * 0.3, 1],
      [0, 0, W, H * 0.35, Math.min(1, 1600 / W)],
      [0, 0, W, H, Math.min(1, 1400 / Math.max(W, H))],
      [W * 0.55, H * 0.7, W * 0.45, H * 0.3, 1]
    ];
    for (const [x, y, w, hh, e] of intentos) {
      const t = leerQRCanvas(p, x, y, w, hh, e);
      if (t && t.startsWith(QR_PREFIJO + "|")) {
        const [, id, n] = t.split("|");
        return { id, n };
      }
    }
  }
  return null;
}

const MARCA_PAG = n => `===== Página ${n} =====`;

function parrafosDesdeEstructura(estructura) {
  return estructura.flatMap((p, i) => p.parrafos.map((par, j) => ({ alinear: par.alinear, texto: par.filas.map(f => f.map(w => w.t).join(" ")).join("\n"), negrita: false, salto: i > 0 && j === 0 })));
}

function textoDesdeEstructura(estructura) {
  return estructura.map((p, i) => (i ? MARCA_PAG(i + 1) + "\n\n" : "") + p.parrafos.map(par => par.filas.map(f => f.map(w => w.t).join(" ")).join("\n")).join("\n\n")).join("\n\n");
}

function parrafosDesdeTexto(texto) {
  const out = [];
  let salto = false, i = 0;
  String(texto || "").split(/\n\s*\n/).map(t => t.trim()).filter(Boolean).forEach(t => {
    if (/^=+ Página \d+ =+$/.test(t)) { if (out.length) salto = true; return; }
    const pal = t.split(/\s+/).length, lineas = t.split("\n").length;
    let alinear = "left";
    if (pal >= 25 && lineas <= 2) alinear = "justify";
    else if (i < 4 && pal <= 8 && /^(oficio|circular|memorando|memor[aá]ndum|ref)\b|\b\d{1,2} de [a-z]+,? (de )?\d{4}$/i.test(t)) alinear = "right";
    out.push({ alinear, texto: t, negrita: false, salto });
    salto = false; i++;
  });
  return out;
}

const PLANTILLAS = { oficio: "Oficio (8.5 × 13)", carta: "Carta (8.5 × 11)", legal: "Legal (8.5 × 14)" };
const plantillaCache = {};

async function bytesPlantilla(p) {
  const clave = PLANTILLAS[p] ? p : "oficio";
  if (!plantillaCache[clave]) {
    const r = await fetch(`plantillas/${clave}.docx`);
    if (!r.ok) throw new Error(`no se encontró la plantilla ${clave}.docx`);
    plantillaCache[clave] = await r.arrayBuffer();
  }
  return plantillaCache[clave];
}

function xmlEsc(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function runXml(t, negrita) {
  return `<w:r><w:rPr>${negrita ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
}

function parrafoXml(alinear, lineas, negrita, after, extra, salto) {
  const jc = { left: "left", right: "right", center: "center", justify: "both" }[alinear] || "left";
  const cuerpo = lineas.map((t, i) => (i ? "<w:r><w:br/></w:r>" : "") + runXml(t, negrita)).join("");
  return `<w:p><w:pPr>${salto ? "<w:pageBreakBefore/>" : ""}<w:spacing w:after="${after}" w:line="276" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>${extra || ""}${cuerpo}</w:p>`;
}

function qrAnclaXml(rid) {
  const t = 685800;
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>6705600</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>380000</wp:posOffset></wp:positionV><wp:extent cx="${t}" cy="${t}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="9001" name="QR expediente"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="qr-expediente.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${t}" cy="${t}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

async function crearWord(doc, parrafos) {
  const zip = await JSZip.loadAsync(await bytesPlantilla(doc.plantilla));
  const rutaDoc = "word/document.xml", rutaRels = "word/_rels/document.xml.rels", rutaTipos = "[Content_Types].xml";
  let xml = await zip.file(rutaDoc).async("string");
  let rels = await zip.file(rutaRels).async("string");
  let tipos = await zip.file(rutaTipos).async("string");
  const rid = "rIdQrExpediente";
  const conQR = !!(window.CONFIG || {}).qr;
  if (conQR) zip.file("word/media/qr-expediente.png", qrPNG(`${QR_PREFIJO}|${doc.id}|${doc.n}`));
  if (conQR && !rels.includes(rid)) rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr-expediente.png"/></Relationships>`);
  if (conQR && !/Extension="png"/i.test(tipos)) tipos = tipos.replace("<Types ", "<Types ").replace(/(<Types[^>]*>)/, `$1<Default Extension="png" ContentType="image/png"/>`);
  if (!xml.includes('xmlns:wp="')) xml = xml.replace("<w:document ", '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ');
  if (!xml.includes('xmlns:r="')) xml = xml.replace("<w:document ", '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  const lista = parrafos && parrafos.length ? parrafos : [{ alinear: "left", texto: "Sin texto transcrito." }];
  const partes = [];
  lista.forEach((par, k) => {
    const lineas = String(par.texto || "").split("\n");
    const extra = k === 0 && conQR ? qrAnclaXml(rid) : "";
    if (par.alinear === "justify" && lineas.length > 1) {
      lineas.forEach((t, i) => partes.push(parrafoXml("justify", [t], par.negrita, i === lineas.length - 1 ? 160 : 0, i === 0 ? extra : "", i === 0 && par.salto)));
    } else partes.push(parrafoXml(par.alinear, lineas, par.negrita, 160, extra, par.salto));
  });
  const ini = xml.indexOf("<w:body>") + "<w:body>".length;
  const sect = xml.lastIndexOf("<w:sectPr");
  xml = xml.slice(0, ini) + partes.join("") + xml.slice(sect);
  zip.file(rutaDoc, xml);
  zip.file(rutaRels, rels);
  zip.file(rutaTipos, tipos);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function nombreWord(doc) {
  return `N${doc.n}${doc.numero_documento ? " - " + doc.numero_documento : ""} (transcripcion).docx`;
}

const INSTR_RESUMEN = `Eres un asistente del Despacho Ministerial de la Dirección de Gestión por Resultados (DIGER) de Honduras.
Recibes el texto de un documento oficial leído por OCR (puede tener errores menores).
Devuelve SOLO un objeto JSON, sin texto adicional: {"tipo":"","asunto":"","resumen":"","remitente":"","cargo":"","institucion":""}
Reglas:
- "asunto": una línea corta que empiece con un sustantivo (Solicitud de…, Invitación a…, Remisión de…).
- "resumen": 2 o 3 oraciones claras sobre qué pide o informa el documento y para cuándo, sin frases de cortesía.
- "tipo": Oficio, Circular, Memorando, Invitación, Resolución o Nota.
- Usa solo información del texto. Si algo no aparece, déjalo vacío. No inventes nombres ni fechas.`;

async function modeloTexto(llave) {
  const ids = await modelosGroq(llave);
  const m = TEXTO_PREFERIDOS.find(x => ids.includes(x)) || ids.find(x => !/whisper|guard|orpheus|tts|prompt|muse/i.test(x));
  if (!m) throw new Error("tu cuenta de Groq no tiene modelos de texto disponibles");
  return m;
}

async function resumenGroq(llave, texto) {
  const modelo = await modeloTexto(llave);
  const cuerpo = c => JSON.stringify({
    model: modelo,
    temperature: 0.2,
    ...(c ? { response_format: { type: "json_object" } } : {}),
    messages: [{ role: "system", content: INSTR_RESUMEN }, { role: "user", content: String(texto).slice(0, 12000) }]
  });
  const pedir = c => fetch(GROQ + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + llave }, body: cuerpo(c) });
  let r = await pedir(true);
  if (r.status === 400) r = await pedir(false);
  if (!r.ok) throw await errorGroq(r);
  const data = await r.json();
  return { ...extraerJSON(data.choices[0].message.content), modelo };
}

function confirmarDoble(boton, etiqueta, aviso, accion) {
  let hasta = 0;
  boton.addEventListener("click", async () => {
    if (Date.now() > hasta) {
      hasta = Date.now() + 8000;
      const original = boton.textContent;
      boton.textContent = etiqueta;
      boton.classList.add("peligro");
      aviso();
      setTimeout(() => { if (Date.now() > hasta - 50 && boton.textContent === etiqueta) { boton.textContent = original; boton.classList.remove("peligro"); } }, 8100);
      boton.dataset.original = original;
      return;
    }
    hasta = 0;
    boton.textContent = boton.dataset.original || boton.textContent;
    boton.classList.remove("peligro");
    await accion();
  });
}

let colaT = Promise.resolve();
let seqT = 0;
const HIST_KEY = "correspondencia-historial";

function leerHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function anotarHist(card, datos) {
  try {
    const lista = leerHist();
    const id = card.dataset.hist || (card.dataset.hist = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const i = lista.findIndex(x => x.id === id);
    const reg = { ...(i >= 0 ? lista[i] : { id, subido: new Date().toISOString() }), ...datos, cambio: new Date().toISOString() };
    if (i >= 0) lista[i] = reg; else lista.unshift(reg);
    localStorage.setItem(HIST_KEY, JSON.stringify(lista.slice(0, 500)));
  } catch {}
}

function mostrarActual() {
  const cards = [...document.querySelectorAll("#cola .doc")];
  const pend = cards.filter(c => !c.dataset.listo).sort((a, b) => Number(a.dataset.seq) - Number(b.dataset.seq));
  const hechos = cards.filter(c => c.dataset.listo).sort((a, b) => Number(b.dataset.fin || 0) - Number(a.dataset.fin || 0));
  const actual = pend[0] || hechos[0] || null;
  cards.forEach(c => { if (c !== actual && c.dataset.listo) c.remove(); else c.hidden = c !== actual; });
  const esp = $("#espera");
  const resto = pend.filter(c => c !== actual);
  esp.hidden = !resto.length;
  esp.textContent = resto.length ? `${resto.length} archivo${resto.length === 1 ? "" : "s"} más en espera: ${resto.map(c => $(".name", c).firstChild.textContent).join(", ")}` : "";
}

function agregarArchivos(files, desdeEntrada) {
  [...files].forEach(f => {
    const card = tarjeta(f);
    if (desdeEntrada) { card.dataset.entrada = desdeEntrada; $(".name", card).append(h("span", { class: "chip", text: "desde Entrada", style: "margin-left:8px" })); }
    colaT = colaT.then(() => procesar(f, card)).catch(e => console.error(e));
  });
  pintarPendientes();
}

function tarjeta(file, seq) {
  const quitar = h("button", { type: "button", class: "quitar", title: "Quitar de la lista (no borra nada guardado)", text: "×" });
  const el = h("section", { class: "panel doc" },
    h("div", { class: "head" }, h("div", { class: "name", text: file.name }), h("div", { class: "chips" }), quitar),
    h("div", { class: "bar" }, h("i")),
    h("div", { class: "status", text: "En espera…" }),
    h("div", { class: "zona" }));
  quitar.onclick = () => {
    if (!el.dataset.listo && el.querySelector(".form") && !quitar.classList.contains("peligro")) {
      quitar.classList.add("peligro"); quitar.textContent = "Quitar sin guardar";
      estadoT(el, "Este documento no se ha guardado. Pulsa otra vez para quitarlo de la lista.", "warn");
      setTimeout(() => { quitar.classList.remove("peligro"); quitar.textContent = "×"; }, 6000);
      return;
    }
    if (!el.dataset.listo) anotarHist(el, { estado: "Descartado sin guardar" });
    el.dataset.listo = "1"; el.dataset.quitado = "1";
    el.remove(); pintarPendientes();
  };
  el.dataset.seq = seq ?? ++seqT;
  $("#cola").prepend(el);
  anotarHist(el, { archivo: file.name, estado: "Pendiente" });
  return el;
}

function estadoT(card, texto, clase) {
  const s = $(".status", card);
  s.textContent = texto;
  s.className = "status" + (clase ? " " + clase : "");
}

async function procesar(file, card) {
  const bar = $(".bar i", card);
  const t0 = performance.now();
  let paginas;
  try {
    estadoT(card, "Preparando el archivo…");
    paginas = file.type === "application/pdf" ? await pdfAImagenes(file) : [await imagenACanvas(file)];
  } catch (e) {
    estadoT(card, "No se pudo abrir el archivo: " + e.message, "bad");
    return;
  }
  const qr = (window.CONFIG || {}).qr ? buscarQR(paginas) : null;
  if (qr) {
    let doc = null;
    try { doc = await DB.getDoc(qr.id); } catch {}
    if (doc) { bar.style.width = "100%"; return tarjetaRevision(card, file, paginas, doc); }
  }
  await transcribir(card, file, paginas, t0, qr ? "El código QR pertenece a un documento que no está en esta base; se trata como oficio nuevo." : null);
}

function previsualizar(card, paginas) {
  const imgs = paginas.map((c, i) => h("img", { src: c.toDataURL("image/jpeg", 0.7), alt: `Página ${i + 1}`, dataset: { pag: i + 1 } }));
  const caja = h("div", { class: "preview" }, ...imgs);
  if (paginas.length < 2) return caja;
  const lbl = h("span", { class: "pag-n", text: `Página 1 de ${paginas.length}` });
  const ir = n => imgs[Math.max(0, Math.min(paginas.length - 1, n))].scrollIntoView({ block: "start", behavior: "smooth" });
  const actual = () => { const top = caja.scrollTop + 20; let k = 0; imgs.forEach((im, i) => { if (im.offsetTop - caja.offsetTop <= top) k = i; }); return k; };
  caja.addEventListener("scroll", () => { lbl.textContent = `Página ${actual() + 1} de ${paginas.length}`; });
  const nav = h("div", { class: "pag-nav" },
    h("button", { type: "button", title: "Página anterior", text: "‹", onclick: () => ir(actual() - 1) }), lbl,
    h("button", { type: "button", title: "Página siguiente", text: "›", onclick: () => ir(actual() + 1) }),
    h("span", { class: "sp" }), ...paginas.map((c, i) => h("button", { type: "button", class: "pag-mini", text: i + 1, onclick: () => ir(i) })));
  return h("div", { class: "preview-wrap" }, nav, caja);
}

async function separarPaginas(card, file, paginas, estructura, textos, conf) {
  const base = file.name.replace(/\.[^.]+$/, "");
  const nuevas = [];
  for (let i = 0; i < paginas.length; i++) {
    const blob = await new Promise(r => paginas[i].toBlob(r, "image/jpeg", 0.85));
    nuevas.push(new File([blob], `${base} - página ${i + 1}.jpg`, { type: "image/jpeg" }));
  }
  const entrada = card.dataset.entrada;
  const ancla = card.nextSibling;
  anotarHist(card, { estado: `Separado en ${paginas.length} documentos` });
  card.remove();
  nuevas.forEach((f, i) => {
    const c = tarjeta(f, Number(card.dataset.seq) + (i + 1) / 1000);
    if (entrada) c.dataset.entrada = entrada;
    $("#cola").insertBefore(c, ancla);
    $(".bar i", c).style.width = "100%";
    mostrarLectura(c, f, [paginas[i]], estructura[i] ? [estructura[i]] : [], textos[i] ? [textos[i]] : [], conf[i] !== undefined ? [conf[i]] : [], performance.now(), `Página ${i + 1} de ${paginas.length} del archivo ${file.name}, separada como documento propio.`);
  });
  pintarPendientes();
}

function tarjetaRevision(card, file, paginas, doc) {
  estadoT(card, `Código QR detectado: es una versión impresa del N° ${doc.n}${doc.numero_documento ? " (" + doc.numero_documento + ")" : ""}.`, "good");
  $(".chips", card).replaceChildren(h("span", { class: "chip good", text: "Versión revisada" }));
  const tipo = h("select", {}, h("option", { value: "revisado", text: "Revisado / con observaciones" }), h("option", { value: "firmado", text: "Firmado / aprobado" }));
  const estado = h("select", {}, ...ESTADOS.map(e => h("option", { value: e, text: e })));
  estado.value = "En revisión";
  tipo.addEventListener("change", () => { estado.value = tipo.value === "firmado" ? "Archivado" : "En revisión"; });
  const adjuntar = h("button", { class: "primary", text: `Adjuntar al expediente N° ${doc.n}` });
  const nuevo = h("button", { text: "No, es un oficio nuevo" });
  const banda = h("div", { class: "banda" }, h("b", { text: "Guardar como:" }), tipo, "Estado del oficio:", estado, adjuntar,
    h("a", { href: "#/expediente/" + doc.id }, h("button", { type: "button", text: "Ver expediente" })), nuevo);
  $(".zona", card).replaceChildren(banda, h("div", { class: "cuerpo" }, previsualizar(card, paginas), h("div", { class: "form" }, h("div", { class: "origen", text: "Asunto del documento original" }), h("div", { class: "full", text: doc.asunto || "—" }))));
  adjuntar.onclick = async () => {
    adjuntar.disabled = true;
    try {
      await DB.uploadFile(doc.id, tipo.value, file, file.name);
      await DB.updateDoc(doc.id, { estado: estado.value });
      await quitarDeEntrada(card);
      estadoT(card, `Adjuntado al expediente N° ${doc.n} como “${TIPOS_ARCH[tipo.value]}” y estado cambiado a ${estado.value}.`, "good");
      aviso("Archivo adjuntado", `Se agregó al expediente N° ${doc.n} como “${TIPOS_ARCH[tipo.value]}”.`);
      banda.replaceChildren(h("b", { text: "Listo." }), h("a", { href: "#/expediente/" + doc.id }, h("button", { class: "primary", type: "button", text: `Abrir expediente N° ${doc.n}` })));
    } catch (e) {
      adjuntar.disabled = false;
      estadoT(card, "No se pudo adjuntar: " + e.message, "bad");
    }
  };
  nuevo.onclick = () => { $(".zona", card).replaceChildren(); colaT = colaT.then(() => transcribir(card, file, paginas, performance.now(), null)); };
}

async function transcribir(card, file, paginas, t0, nota) {
  const bar = $(".bar i", card);
  const textos = [], conf = [], estructura = [];
  try {
    for (let i = 0; i < paginas.length; i++) {
      const base = i / paginas.length;
      const cb = {
        progress: p => { bar.style.width = ((base + p / paginas.length) * 100).toFixed(1) + "%"; estadoT(card, `Leyendo página ${i + 1} de ${paginas.length} con PaddleOCR…`); },
        setStatus: s => estadoT(card, s)
      };
      const data = await leerConPaddle(paginas[i], cb);
      textos.push(data.text.trim());
      conf.push(data.confidence);
      estructura.push({ ancho: paginas[i].width, parrafos: limpiarParrafos(data.blocks || [], paginas[i].width) });
    }
  } catch (e) {
    estadoT(card, "No se pudo leer con PaddleOCR: " + e.message + ". Puedes usar “Leer con Groq (imagen)”.", "warn");
  }
  bar.style.width = "100%";
  mostrarLectura(card, file, paginas, estructura, textos, conf, t0, nota);
}

function mostrarLectura(card, file, paginas, estructura, textos, conf, t0, nota) {
  const limpio = textoDesdeEstructura(estructura);
  const c = camposPorPaginas(estructura, textos);
  const marcado = textoMarcado(estructura);
  const datos = {
    tipo: tipoNormal(c.tipo), numero_documento: c.numero, fecha_recepcion: null, plantilla: "oficio",
    remitente: c.institucion || c.remitente || null,
    asunto: marcado || c.asunto || c.resumen || null, estado: "En revisión",
    confidencial: $("#conf-def").checked, texto: limpio
  };
  const st = { file, paginas, estructura, limpio, origen: "reglas", parrafosIA: null, fechaDocumento: isoDeCorta(c.fechaCorta) };
  const seg = ((performance.now() - t0) / 1000).toFixed(1);
  const cm = conf.length ? Math.round(conf.reduce((a, b) => a + b, 0) / conf.length) : 0;
  $(".chips", card).replaceChildren(
    h("span", { class: "chip", text: `${paginas.length} pág.` }),
    h("span", { class: "chip", text: `${seg} s` }),
    conf.length ? h("span", { class: "chip " + (cm >= 85 ? "good" : "warn"), text: `Confianza ${cm}%` }) : "",
    c.fechaDudosa ? h("span", { class: "chip warn", text: "Revisar el año" }) : "",
    marcado ? h("span", { class: "chip good", text: "Asunto tomado de lo subrayado", title: marcado }) : "");
  const form = h("div", { class: "form" }, h("div", { class: "origen", text: "Detectado automáticamente · revísalo antes de guardar" }));
  const els = construirForm(form, datos, true);
  const origen = $(".origen", form);
  const bImg = h("button", { class: "groq solo-ia", text: "Leer con Groq (imagen)" });
  const bTxt = h("button", { class: "groq solo-ia", text: "Resumen con Groq (texto)" });
  const bGuardar = h("button", { class: "primary", text: "Guardar" });
  const bGuardarW = h("button", { text: "Guardar y generar Word" });
  const bSeparar = paginas.length > 1 ? h("button", { type: "button", text: `Separar en ${paginas.length} documentos`, title: "Úsalo si el escáner juntó varios oficios distintos en este PDF" }) : "";
  if (bSeparar) confirmarDoble(bSeparar, `Sí, cada página es un oficio distinto`, () => estadoT(card, `Se crearán ${paginas.length} documentos, uno por página. Vuelve a pulsar para confirmar.`, "warn"), () => separarPaginas(card, file, paginas, estructura, textos, conf));
  const acciones = h("div", { class: "acciones" }, bImg, bTxt, bSeparar, h("span", { class: "sp" }), bGuardarW, bGuardar);
  $(".zona", card).replaceChildren(h("div", { class: "cuerpo" }, previsualizar(card, paginas), form), acciones);
  estadoT(card, nota || (estructura.length ? (paginas.length > 1 ? `Listo. Se leyeron ${paginas.length} páginas como un solo documento; los datos se tomaron de la primera. Si son oficios distintos, usa “Separar en ${paginas.length} documentos”.` : "Listo. Revisa los campos y guarda.") : "Sin texto de PaddleOCR."), nota ? "warn" : "");
  const syncConf = () => { const c2 = els.confidencial.checked; bImg.disabled = c2; bTxt.disabled = c2; bImg.title = bTxt.title = c2 ? "Documento confidencial: no se envía a Groq" : ""; };
  els.confidencial.addEventListener("change", syncConf);
  syncConf();
  const sinLlave = () => { if (llaveGroq()) return false; estadoT(card, "Configura la llave de Groq en Ajustes para usar esta opción.", "warn"); return true; };
  confirmarDoble(bImg, "Sí, enviar imagen a Groq", () => estadoT(card, "Se enviará la imagen del documento a Groq. Vuelve a pulsar para confirmar.", "warn"), async () => {
    if (sinLlave()) return;
    bImg.disabled = true;
    try {
      const out = await leerConIA(llaveGroq(), paginas, t => estadoT(card, t));
      const cc = out.campos || {};
      llenarForm(els, {
        numero_documento: cc.numero || els.numero_documento.value,
        remitente: cc.institucion || cc.remitente || els.remitente.value,
        asunto: cc.asunto || cc.resumen || els.asunto.value,
        texto: out.parrafos.map(p => p.texto).join("\n\n")
      });
      st.parrafosIA = out.parrafos;
      st.fechaDocumento = isoDeCorta(cc.fecha) || st.fechaDocumento;
      st.origen = "groq-imagen";
      origen.textContent = `Leído con Groq (${out.modelo}) · revísalo antes de guardar`;
      $(".chips", card).append(h("span", { class: "chip violet", text: "Groq imagen" }));
      estadoT(card, "Leído con Groq. Revisa el texto y los campos.", "good");
    } catch (e) { estadoT(card, "Groq no pudo leer la imagen: " + e.message, "bad"); }
    syncConf();
  });
  bTxt.onclick = async () => {
    if (sinLlave()) return;
    const texto = els.texto.value.trim();
    if (!texto) { estadoT(card, "No hay texto para resumir.", "warn"); return; }
    bTxt.disabled = true;
    estadoT(card, "Pidiendo asunto y resumen a Groq…");
    try {
      const r = await resumenGroq(llaveGroq(), texto);
      llenarForm(els, { asunto: r.asunto || r.resumen || els.asunto.value });
      rellenarVacios(els, { remitente: r.institucion || r.remitente });
      st.origen = st.origen === "groq-imagen" ? st.origen : "reglas+groq";
      origen.textContent = `Campos por reglas · asunto y resumen con Groq (${r.modelo}) · revísalo`;
      $(".chips", card).append(h("span", { class: "chip violet", text: "Groq resumen" }));
      estadoT(card, "Asunto y resumen redactados con Groq.", "good");
    } catch (e) { estadoT(card, "Groq no respondió: " + e.message, "bad"); }
    syncConf();
  };
  const parrafosFinal = () => {
    const t = els.texto.value;
    if (st.parrafosIA && t === st.parrafosIA.map(p => p.texto).join("\n\n")) return st.parrafosIA;
    if (t === st.limpio && st.estructura.length) return parrafosDesdeEstructura(st.estructura);
    return parrafosDesdeTexto(t);
  };
  const generarWord = async (doc, boton) => {
    if (boton) boton.disabled = true;
    try {
      estadoT(card, `Generando el Word (${PLANTILLAS[doc.plantilla] || "Oficio"}) del N° ${doc.n}…`);
      const w = await crearWord(doc, parrafosFinal());
      await DB.uploadFile(doc.id, "transcripcion", new File([w], nombreWord(doc), { type: w.type }), nombreWord(doc));
      descargar(w, nombreWord(doc));
      estadoT(card, `N° ${doc.n}: Word generado con la plantilla ${PLANTILLAS[doc.plantilla] || "Oficio"} y guardado en el expediente.`, "good");
      aviso("Word generado", `Plantilla ${PLANTILLAS[doc.plantilla] || "Oficio"} · N° ${doc.n}. Se descargó y quedó en el expediente.`);
      if (boton) boton.replaceWith(h("button", { text: "Descargar Word", onclick: () => descargar(w, nombreWord(doc)) }));
    } catch (e) {
      if (boton) boton.disabled = false;
      estadoT(card, "Se guardó el documento, pero no se pudo generar el Word: " + e.message, "bad");
    }
  };
  const guardar = async conWord => {
    if (!els.fecha_recepcion.value) {
      els.fecha_recepcion.classList.add("falta");
      els.fecha_recepcion.focus();
      estadoT(card, "Escribe la fecha de recepción antes de guardar.", "warn");
      return;
    }
    bGuardar.disabled = true; bGuardarW.disabled = true;
    estadoT(card, "Guardando…");
    try {
      const datosF = leerForm(els);
      datosF.origen_datos = st.origen;
      datosF.fecha_documento = st.fechaDocumento || null;
      const doc = await DB.insertDoc(datosF);
      estadoT(card, `Subiendo el original del N° ${doc.n}…`);
      await DB.uploadFile(doc.id, "original", file, file.name);
      await quitarDeEntrada(card);
      Object.values(els).forEach(e => { e.disabled = true; });
      if (bSeparar) bSeparar.remove();
      const bWord = h("button", { text: "Generar Word (opcional)" });
      bWord.onclick = () => generarWord(doc, bWord);
      acciones.replaceChildren(h("b", { text: `Guardado como N° ${doc.n}.` }), h("span", { class: "sp" }), bWord,
        h("a", { href: "#/expediente/" + doc.id }, h("button", { class: "primary", type: "button", text: "Abrir expediente" })));
      estadoT(card, `Guardado como N° ${doc.n} en la matriz.`, "good");
      anotarHist(card, { estado: "Guardado", n: doc.n, doc: doc.id });
      aviso("Documento guardado", `Quedó registrado como N° ${doc.n} en la matriz.` + (document.querySelector("#cola .doc:not([data-listo])") ? " Sigue el próximo archivo." : ""));
      $(".chips", card).append(h("span", { class: "chip good", text: `N° ${doc.n}` }));
      if (conWord) await generarWord(doc, bWord);
    } catch (e) {
      bGuardar.disabled = false; bGuardarW.disabled = false;
      estadoT(card, "No se pudo guardar: " + e.message, "bad");
    }
  };
  bGuardar.onclick = () => guardar(false);
  bGuardarW.onclick = () => guardar(true);
}

function camposPorPaginas(estructura, textos) {
  if (!estructura.length) return {};
  const primera = detectarCampos([estructura[0]], textos[0] || "");
  if (estructura.length === 1) return primera;
  const todas = detectarCampos(estructura, textos.join("\n"));
  const out = { ...todas };
  Object.entries(primera).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") out[k] = v; });
  return out;
}

const blobCache = new Map();
async function blobDe(a) {
  if (!blobCache.has(a.id)) blobCache.set(a.id, await DB.fileBlob(a));
  return blobCache.get(a.id);
}

async function pintarPane(cont, fuente, doc, archivos) {
  cont.replaceChildren(h("div", { class: "vacio", text: "Cargando…" }));
  try {
    if (fuente === "texto") { cont.replaceChildren(h("pre", { text: doc.texto || "Sin texto transcrito." })); return; }
    const a = archivos.find(x => x.id === fuente);
    if (!a) { cont.replaceChildren(h("div", { class: "vacio", text: "Elige un archivo." })); return; }
    const blob = await blobDe(a);
    const mime = a.mime || blob.type || "";
    if (/pdf/.test(mime) || /\.pdf$/i.test(a.nombre)) {
      const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
      const hojas = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale: 1.4 });
        const c = h("canvas", { width: Math.round(vp.width), height: Math.round(vp.height) });
        await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        hojas.push(c);
      }
      cont.replaceChildren(...hojas);
    } else if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.nombre)) {
      cont.replaceChildren(h("img", { src: URL.createObjectURL(blob), alt: a.nombre }));
    } else {
      cont.replaceChildren(h("div", { class: "aviso info" }, `El archivo “${a.nombre}” no tiene vista previa aquí. `, h("button", { text: "Descargar", onclick: () => descargar(blob, a.nombre) })), h("pre", { text: doc.texto || "" }));
    }
  } catch (e) {
    cont.replaceChildren(h("div", { class: "vacio", text: "No se pudo mostrar: " + e.message }));
  }
}

async function pintarExpediente(id) {
  const v = $("#v-expediente");
  v.replaceChildren(h("div", { class: "vacio", text: "Cargando expediente…" }));
  let doc, archivos;
  try {
    doc = await DB.getDoc(id);
    if (!doc) { v.replaceChildren(h("div", { class: "vacio" }, "No se encontró el documento. ", h("a", { href: "#/matriz", text: "Volver a la matriz" }))); return; }
    archivos = await DB.listFiles(id);
  } catch (e) { v.replaceChildren(h("div", { class: "vacio", text: "Error: " + e.message })); return; }

  const form = h("div", { class: "form" });
  const els = construirForm(form, doc, true);
  const status = h("div", { class: "status", text: `Registrado: ${fFechaHora(doc.creado || doc.fecha_recepcion)} · Última actualización: ${fFechaHora(doc.actualizado)}${doc.carpeta ? " · Carpeta: " + doc.carpeta.join(" › ") : ""}` });
  const bGuardar = h("button", { class: "primary", text: "Guardar cambios" });
  const bResumen = h("button", { class: "groq solo-ia", text: "Resumen con Groq" });
  const syncConf = () => { bResumen.disabled = els.confidencial.checked; };
  els.confidencial.addEventListener("change", syncConf);
  syncConf();
  bGuardar.onclick = async () => {
    bGuardar.disabled = true;
    try { doc = await DB.updateDoc(id, leerForm(els)); status.textContent = "Cambios guardados · " + fFechaHora(doc.actualizado); status.className = "status good"; aviso("Cambios guardados", `El N° ${doc.n} se actualizó correctamente.`); }
    catch (e) { status.textContent = "No se pudo guardar: " + e.message; status.className = "status bad"; }
    bGuardar.disabled = false;
  };
  bResumen.onclick = async () => {
    if (!llaveGroq()) { status.textContent = "Configura la llave de Groq en Ajustes."; status.className = "status warn"; return; }
    bResumen.disabled = true;
    status.textContent = "Pidiendo asunto y resumen a Groq…"; status.className = "status";
    try {
      const r = await resumenGroq(llaveGroq(), els.texto.value);
      llenarForm(els, { asunto: r.asunto || r.resumen || els.asunto.value });
      rellenarVacios(els, { remitente: r.institucion || r.remitente });
      status.textContent = `Asunto y resumen sugeridos por Groq (${r.modelo}). Pulsa “Guardar cambios” para conservarlos.`; status.className = "status good";
    } catch (e) { status.textContent = "Groq no respondió: " + e.message; status.className = "status bad"; }
    syncConf();
  };

  const lista = h("div", { class: "lista-arch" });
  const paneA = h("div", { class: "pcont" }), paneB = h("div", { class: "pcont" });
  const selA = h("select"), selB = h("select");
  const panes = h("div", { class: "panes" });
  const comparar = h("button", { text: "Comparar lado a lado" });
  const opciones = () => [h("option", { value: "texto", text: "Texto transcrito" }), ...archivos.map(a => h("option", { value: a.id, text: `${TIPOS_ARCH[a.tipo]} · ${fFechaHora(a.creado)}` }))];
  const reponerSel = () => {
    const a = selA.value, b = selB.value;
    selA.replaceChildren(...opciones()); selB.replaceChildren(...opciones());
    const prim = archivos.find(x => x.tipo === "original");
    const ult = [...archivos].reverse().find(x => x.tipo === "firmado" || x.tipo === "revisado");
    selA.value = a && [...selA.options].some(o => o.value === a) ? a : (prim ? prim.id : "texto");
    selB.value = b && [...selB.options].some(o => o.value === b) ? b : (ult ? ult.id : "texto");
  };
  const pintarLista = () => {
    lista.replaceChildren(...(archivos.length ? archivos.map(a => h("div", { class: "arch" },
      h("div", { class: "meta" }, h("b", { text: a.nombre }), h("span", { text: `${TIPOS_ARCH[a.tipo]} · ${fFechaHora(a.creado)}${a.tamano ? " · " + kb(a.tamano) : ""}` })),
      h("button", { text: "Ver", onclick: () => { selA.value = a.id; pintarPane(paneA, a.id, doc, archivos); } }),
      h("button", { text: "Descargar", onclick: async () => descargar(await blobDe(a), a.nombre) }),
      (() => {
        const b = h("button", { class: "peligro", text: "Eliminar" });
        confirmarDoble(b, "¿Seguro?", () => toast(`Se eliminará el archivo “${a.nombre}”. Pulsa otra vez para confirmar.`), async () => {
          try {
            await DB.deleteFile(a);
            blobCache.delete(a.id);
            archivos.splice(archivos.indexOf(a), 1);
            pintarLista(); reponerSel();
            if (selA.value === a.id || !archivos.length) pintarPane(paneA, selA.value, doc, archivos);
            aviso("Archivo eliminado", `Se quitó “${a.nombre}” del expediente.`);
          } catch (e) { toast("No se pudo eliminar: " + e.message); }
        });
        return b;
      })())) : [h("div", { class: "vacio", text: "Sin archivos." })]));
  };
  selA.onchange = () => pintarPane(paneA, selA.value, doc, archivos);
  selB.onchange = () => pintarPane(paneB, selB.value, doc, archivos);
  let dos = false;
  const pintarPanes = () => {
    panes.className = "panes" + (dos ? " dos" : "");
    panes.replaceChildren(h("div", { class: "pane" }, h("div", { class: "pbar" }, dos ? "A" : "Ver", selA), paneA), dos ? h("div", { class: "pane" }, h("div", { class: "pbar" }, "B", selB), paneB) : "");
    comparar.textContent = dos ? "Ver uno solo" : "Comparar lado a lado";
  };
  comparar.onclick = () => { dos = !dos; pintarPanes(); if (dos) pintarPane(paneB, selB.value, doc, archivos); };

  const tipoSubir = h("select", {}, ...Object.entries(TIPOS_ARCH).map(([k, t]) => h("option", { value: k, text: t })));
  tipoSubir.value = "firmado";
  const inSubir = h("input", { type: "file", accept: "application/pdf,image/*,.docx,.doc,.xlsx" });
  const bSubir = h("button", { text: "Subir archivo…", onclick: () => inSubir.click() });
  inSubir.onchange = async () => {
    const f = inSubir.files[0];
    if (!f) return;
    bSubir.disabled = true;
    try {
      const reg = await DB.uploadFile(id, tipoSubir.value, f, f.name);
      archivos.push(reg);
      if (tipoSubir.value === "firmado" || tipoSubir.value === "revisado") {
        const nuevo = tipoSubir.value === "firmado" ? "Archivado" : "En revisión";
        doc = await DB.updateDoc(id, { estado: nuevo });
        els.estado.value = nuevo;
      }
      pintarLista(); reponerSel();
      aviso("Archivo agregado", `Se guardó en el expediente N° ${doc.n}.`);
    } catch (e) { toast("No se pudo subir: " + e.message); }
    bSubir.disabled = false;
    inSubir.value = "";
  };

  const bWord = h("button", { text: archivos.some(a => a.tipo === "transcripcion") ? "Generar Word de nuevo" : "Generar Word (opcional)" });
  bWord.onclick = async () => {
    bWord.disabled = true;
    try {
      const actual = { ...doc, ...leerForm(els) };
      const w = await crearWord(actual, parrafosDesdeTexto(els.texto.value));
      const reg = await DB.uploadFile(id, "transcripcion", new File([w], nombreWord(actual), { type: w.type }), nombreWord(actual));
      archivos.push(reg); pintarLista(); reponerSel();
      bWord.textContent = "Generar Word de nuevo";
      descargar(w, nombreWord(actual));
      aviso("Word generado", "Se descargó y quedó guardado en el expediente.");
    } catch (e) { toast("No se pudo generar: " + e.message); }
    bWord.disabled = false;
  };
  const bBorrar = h("button", { class: "peligro", text: "Eliminar" });
  confirmarDoble(bBorrar, "Sí, eliminar todo", () => toast("Se eliminará el documento y todos sus archivos. Vuelve a pulsar para confirmar."), async () => {
    try { await DB.deleteDoc(id); aviso("Documento eliminado", `El N° ${doc.n} se quitó con todos sus archivos.`); location.hash = "#/matriz"; }
    catch (e) { toast("No se pudo eliminar: " + e.message); }
  });

  v.replaceChildren(
    h("div", { class: "exp-head" },
      h("a", { href: "#/matriz" }, h("button", { type: "button", text: "← Matriz" })),
      h("h1", { text: `N° ${doc.n} · ${doc.numero_documento || "sin número"}` }),
      h("span", { class: claseEstado(doc.estado), text: estadoDe(doc) }),
      h("span", { class: "sp" }), bWord, bBorrar),
    h("div", { class: "exp" },
      h("div", {},
        h("div", { class: "panel" }, status, form, h("div", { class: "acciones" }, bResumen, h("span", { class: "sp" }), bGuardar)),
        h("div", { class: "panel", style: "margin-top:16px" }, h("div", { class: "visor-barra" }, h("b", { text: `Archivos del expediente (${archivos.length})` })), lista,
          h("div", { class: "subir" }, "Tipo:", tipoSubir, bSubir, inSubir))),
      h("div", { class: "panel" }, h("div", { class: "visor-barra" }, h("b", { text: "Visor" }), h("span", { class: "sp" }), comparar), panes)));
  pintarLista(); reponerSel(); pintarPanes();
  pintarPane(paneA, selA.value, doc, archivos);
}

function pintarHist() {
  const lista = leerHist();
  const f = iso => { const d = new Date(iso); return `${fFecha(iso.slice(0, 10))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  $("#a-hist").replaceChildren(lista.length ? h("table", { class: "hist" },
    h("thead", {}, h("tr", {}, h("th", { text: "Subido" }), h("th", { text: "Archivo" }), h("th", { text: "Resultado" }))),
    h("tbody", {}, ...lista.map(x => h("tr", {},
      h("td", { text: f(x.subido) }),
      h("td", { text: x.archivo || "" }),
      h("td", {}, x.doc ? h("a", { href: "#/expediente/" + x.doc, text: `Guardado como N° ${x.n}` }) : (x.estado || ""))))))
    : h("p", { class: "nota", text: "Todavía no se ha subido ningún archivo." }));
}

async function pintarAlmacen() {
  const e = await espacioUsado();
  const dias = diasDesdeRespaldo();
  await protegerDatos(false);
  $("#a-alm-estado").textContent = [
    datosProtegidos ? "Datos protegidos: el navegador no los borrará por su cuenta." : "Datos sin proteger: pulsa “Proteger datos”.",
    e ? `Espacio usado: ${kb(e.usado)} de ${kb(e.total)} disponibles.` : "",
    dias === null ? "Todavía no hay respaldo." : `Último respaldo: hace ${dias} día${dias === 1 ? "" : "s"}.`
  ].filter(Boolean).join(" ");
}

function pintarAjustes() {
  const a = leerAjustes(), C = window.CONFIG || {};
  pintarAlmacen();
  const ec = $("#a-carpeta-estado");
  ec.textContent = DB.nombre === "carpeta" ? `Conectada: ${DB.raiz.name}. El escáner debe guardar los archivos en ${DB.raiz.name}\${CARPETA_ENTRADA}.` : carpetaPendiente ? `“${carpetaPendiente.name}” necesita permiso otra vez.` : soportaCarpetas ? "Sin carpeta: los datos quedan solo en este navegador." : "Este navegador no permite usar carpetas. Usa Edge o Chrome.";
  $("#a-reconectar").hidden = !carpetaPendiente;
  $("#a-olvidar").hidden = !(DB.nombre === "carpeta" || carpetaPendiente);
  $("#a-url").value = a.supabaseUrl || C.supabaseUrl || "";
  $("#a-anon").value = a.supabaseAnonKey || C.supabaseAnonKey || "";
  $("#a-groq").value = a.groqKey || "";
  $("#a-sb-estado").textContent = DB.nombre === "supabase" ? "Conectado a Supabase." : "Usando modo local.";
}

function enlazar() {
  const drop = $("#drop"), inp = $("#archivos");
  ["dragenter", "dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", ev => agregarArchivos(ev.dataTransfer.files));
  inp.addEventListener("change", () => { agregarArchivos(inp.files); inp.value = ""; });
  $("#buscar").addEventListener("input", alFiltrar);
  $("#f-periodo").addEventListener("change", aplicarPeriodo);
  $("#f-mas").addEventListener("click", () => { const w = $("#f-panel-wrap"); w.hidden = !w.hidden; });
  $("#f-limpiar").addEventListener("click", limpiarFiltros);
  confirmarDoble($("#borrar-sel"), "Sí, eliminar", () => toast(`Se eliminarán ${M.sel.size} documentos con todos sus archivos. Pulsa otra vez para confirmar.`), () => borrarDocs([...M.sel]));
  $("#a-hist-ver").addEventListener("click", () => { const w = $("#a-hist"); w.hidden = !w.hidden; if (!w.hidden) pintarHist(); $("#a-hist-ver").textContent = w.hidden ? "Ver historial" : "Ocultar historial"; });
  $("#exportar").addEventListener("click", exportarExcel);
  const inImp = $("#importar-arch");
  $("#importar").addEventListener("click", () => inImp.click());
  $("#a-importar").addEventListener("click", () => inImp.click());
  inImp.addEventListener("change", () => { if (inImp.files[0]) importarMatriz(inImp.files[0]); inImp.value = ""; });
  $("#f-login").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("#l-err").textContent = "";
    try { await DB.entrar($("#l-correo").value.trim(), $("#l-clave").value); await pintarUsuario(); if (!location.hash || location.hash === "#/login") location.hash = "#/matriz"; await router(); }
    catch (e) { $("#l-err").textContent = "No se pudo entrar: " + e.message; }
  });
  $("#salir").addEventListener("click", async () => { await DB.salir(); await pintarUsuario(); router(); });
  $("#a-guardar-sb").addEventListener("click", async () => {
    guardarAjustes({ supabaseUrl: $("#a-url").value.trim(), supabaseAnonKey: $("#a-anon").value.trim(), modo: "supabase" });
    await iniciarDB();
    $("#a-sb-estado").textContent = DB.nombre === "supabase" ? "Guardado. Inicia sesión con tu usuario de Supabase." : "Faltan la URL o la clave.";
    router();
  });
  $("#a-local").addEventListener("click", async () => { guardarAjustes({ modo: "local" }); await iniciarDB(); pintarAjustes(); toast("Supabase desactivado"); });
  $("#a-guardar-groq").addEventListener("click", () => { guardarAjustes({ groqKey: $("#a-groq").value.trim() }); modelosCache = null; $("#a-groq-estado").textContent = "Llave guardada en este navegador."; });
  $("#a-probar-groq").addEventListener("click", async () => {
    const k = $("#a-groq").value.trim();
    const e = $("#a-groq-estado");
    if (!k) { e.textContent = "Pega primero la llave."; return; }
    e.textContent = "Probando…";
    try {
      modelosCache = null;
      const ids = await modelosGroq(k);
      let vis = "ninguno";
      try { vis = await modeloVision(k); } catch {}
      e.textContent = `Conexión correcta. ${ids.length} modelos disponibles. Texto: ${await modeloTexto(k)} · Imagen: ${vis}.`;
    } catch (err) { e.textContent = "No se pudo conectar: " + err.message; }
  });
  $("#a-elegir").addEventListener("click", elegirCarpeta);
  $("#a-proteger").addEventListener("click", async () => { await protegerDatos(true); pintarAlmacen(); });
  $("#a-respaldo").addEventListener("click", ev => descargarRespaldo(ev.target));
  const inR = $("#a-restaurar-arch");
  $("#a-restaurar").addEventListener("click", () => inR.click());
  inR.addEventListener("change", () => { if (inR.files[0]) restaurarRespaldo(inR.files[0]); inR.value = ""; });
  $("#a-reconectar").addEventListener("click", reconectarCarpeta);
  $("#a-olvidar").addEventListener("click", olvidarCarpeta);
  window.addEventListener("hashchange", router);
}

function aplicarOpciones() {
  const C = window.CONFIG || {};
  document.body.classList.toggle("sin-ia", !C.ia);
  document.body.classList.toggle("sin-supabase", !C.supabase);
  document.body.classList.toggle("sin-carpeta", !C.carpeta);
  document.body.classList.toggle("sin-qr", !C.qr);
}

aplicarOpciones();
enlazar();
iniciarDB().then(router);
