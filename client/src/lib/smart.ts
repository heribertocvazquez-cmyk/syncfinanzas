// Ayudas para las mejoras ligeras: sugerencia de categoría, lectura de
// comprobantes, dictado por voz y reglas de auto-categorización. Todo corre
// en el dispositivo, sin servicios de pago.

export type SimpleCategory = { id: number; name: string; kind: string; subcategories: string[] };
export type SimpleRule = { id: number; keyword: string; categoryId: number };

export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palabras de comercios y servicios comunes en México → nombre de categoría.
// Se usa solo como sugerencia; la persona siempre puede corregirla.
const STORE_KEYWORDS: [string, string][] = [
  ["walmart", "Alimentación"], ["soriana", "Alimentación"], ["chedraui", "Alimentación"], ["heb", "Alimentación"], ["aurrera", "Alimentación"], ["super", "Alimentación"], ["supermercado", "Alimentación"], ["mercado", "Alimentación"], ["oxxo", "Alimentación"], ["seven", "Alimentación"], ["abarrotes", "Alimentación"], ["carniceria", "Alimentación"], ["panaderia", "Alimentación"], ["tortilleria", "Alimentación"], ["restaurante", "Alimentación"], ["comida", "Alimentación"], ["cafe", "Alimentación"], ["starbucks", "Alimentación"], ["taqueria", "Alimentación"], ["tienda", "Alimentación"],
  ["gasolin", "Transporte"], ["pemex", "Transporte"], ["shell", "Transporte"], ["g500", "Transporte"], ["uber", "Transporte"], ["didi", "Transporte"], ["taxi", "Transporte"], ["metro", "Transporte"], ["autobus", "Transporte"], ["estacionamiento", "Transporte"], ["peaje", "Transporte"], ["caseta", "Transporte"],
  ["farmacia", "Salud"], ["similares", "Salud"], ["benavides", "Salud"], ["san pablo", "Salud"], ["doctor", "Salud"], ["dentista", "Salud"], ["hospital", "Salud"], ["laboratorio", "Salud"], ["clinica", "Salud"],
  ["netflix", "Entretenimiento"], ["spotify", "Entretenimiento"], ["cine", "Entretenimiento"], ["cinemex", "Entretenimiento"], ["cinepolis", "Entretenimiento"], ["disney", "Entretenimiento"], ["prime video", "Entretenimiento"], ["teatro", "Entretenimiento"], ["concierto", "Entretenimiento"],
  ["cfe", "Servicios"], ["telmex", "Servicios"], ["izzi", "Servicios"], ["totalplay", "Servicios"], ["internet", "Servicios"], ["telefono", "Servicios"], ["celular", "Servicios"], ["telcel", "Servicios"], ["movistar", "Servicios"], ["att", "Servicios"], ["agua", "Servicios"],
  ["ropa", "Vestido"], ["zapatos", "Vestido"], ["liverpool", "Vestido"], ["palacio", "Vestido"], ["sears", "Vestido"], ["zara", "Vestido"], ["calzado", "Vestido"],
  ["colegiatura", "Educación"], ["escuela", "Educación"], ["universidad", "Educación"], ["curso", "Educación"], ["libro", "Educación"], ["colegio", "Educación"],
  ["renta", "Vivienda"], ["hipoteca", "Vivienda"], ["predial", "Vivienda"], ["mantenimiento", "Vivienda"],
  ["salon", "Cuidado personal"], ["barberia", "Cuidado personal"], ["estetica", "Cuidado personal"], ["peluqueria", "Cuidado personal"], ["cosmetico", "Cuidado personal"],
  ["mueble", "Hogar"], ["ferreteria", "Hogar"], ["home depot", "Hogar"], ["decoracion", "Hogar"],
];

// Devuelve la categoría sugerida para un texto (concepto, tienda o línea del
// comprobante). Primero las reglas del hogar, luego subcategorías y nombres
// de categoría, y por último las palabras de comercios comunes.
export function suggestCategoryId(categories: SimpleCategory[], text: string, rules?: SimpleRule[]): number | null {
  const t = normText(text);
  if (!t) return null;
  if (rules) {
    for (const r of rules) {
      const kw = normText(r.keyword);
      if (kw && t.includes(kw)) {
        const cat = categories.find((c) => c.id === r.categoryId);
        if (cat) return cat.id;
      }
    }
  }
  for (const c of categories) {
    for (const sb of c.subcategories) {
      const s = normText(sb);
      if (s.length >= 3 && t.includes(s)) return c.id;
    }
    const name = normText(c.name);
    if (name.length >= 3 && t.includes(name)) return c.id;
  }
  for (const [kw, name] of STORE_KEYWORDS) {
    if (t.includes(kw)) {
      const cat = categories.find((c) => normText(c.name) === normText(name));
      if (cat) return cat.id;
    }
  }
  return null;
}

// Primera regla cuya palabra aparezca dentro del concepto, o null.
export function matchRule(rules: SimpleRule[], concept: string): SimpleRule | null {
  const t = normText(concept);
  if (!t) return null;
  for (const r of rules) {
    const kw = normText(r.keyword);
    if (kw && t.includes(kw)) return r;
  }
  return null;
}

// ---- Lectura de comprobantes (texto de OCR) ----

export type ReceiptRead = { store: string | null; date: string | null; total: number | null };

const MONTHS_ES: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };

// Importes dentro de una línea: "1,234.56", "$450.00" o "450".
function amountsIn(line: string, moneyOnly = false): number[] {
  if (moneyOnly && !/[$]|\d+\.\d{2}/.test(line)) return [];
  const out: number[] = [];
  const re = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const v = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function parseReceiptText(text: string): ReceiptRead {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total: number | null = null;
  const totalLines = lines.filter((l) => normText(l).includes("total"));
  for (const l of totalLines) {
    const amts = amountsIn(l);
    if (amts.length > 0) total = amts[amts.length - 1]!;
  }
  if (total == null) {
    // Sin línea de total: el importe mayor del último tercio, en líneas con
    // signo de pesos o decimales (una fecha no debe tomarse por importe).
    const tail = lines.slice(Math.floor((lines.length * 2) / 3));
    let best = 0;
    for (const l of tail) {
      if (/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}/.test(l)) continue;
      for (const a of amountsIn(l, true)) if (a > best && a < 1000000) best = a;
    }
    total = best > 0 ? best : null;
  }
  let date: string | null = null;
  const dateRe = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/;
  const dateReEs = /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+(\d{4})/i;
  for (const l of lines) {
    const m = dateRe.exec(l);
    if (m) {
      const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) { date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; break; }
    }
    const m2 = dateReEs.exec(l);
    if (m2) {
      const d = Number(m2[1]), mo = MONTHS_ES[m2[2]!.toLowerCase().slice(0, 3)], y = Number(m2[3]);
      if (mo) { date = `${y}-${mo}-${String(d).padStart(2, "0")}`; break; }
    }
  }
  const skip = ["total", "gracias", "ticket", "folio", "fecha", "hora", "caja", "vendedor", "cajero", "cambio", "efectivo", "tarjeta", "subtotal", "iva", "descuento", "articulo", "cantidad", "precio", "importe", "cliente", "domicilio"];
  let store: string | null = null;
  for (const l of lines.slice(0, 6)) {
    const n = normText(l);
    if (l.length < 3 || l.length > 50) continue;
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l)) continue;
    if (skip.some((w) => n.includes(w))) continue;
    if (/\d{4,}/.test(l)) continue;
    store = l.replace(/[^\p{L}\p{N} &.'-]/gu, "").trim() || null;
    if (store) break;
  }
  return { store, date, total };
}

// ---- Dictado por voz (texto del reconocimiento de voz) ----

const NUM_WORDS: Record<string, number> = {
  cero: 0, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

function parseNumberWords(tokens: string[], start: number): { value: number; consumed: number } | null {
  let i = start, total = 0, current = 0, consumed = 0, saw = false;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === "y") { i++; continue; }
    if (t === "mil") {
      current = current === 0 ? 1 : current;
      total += current * 1000;
      current = 0;
      saw = true;
      consumed = i - start + 1;
      i++;
      continue;
    }
    const v = NUM_WORDS[t];
    if (v === undefined) break;
    saw = true;
    current += v;
    consumed = i - start + 1;
    i++;
  }
  if (!saw) return null;
  return { value: total + current, consumed };
}

const FILLER = new Set(["gaste", "gasto", "pague", "pago", "compre", "compra", "registra", "registre", "anota", "anote", "de", "del", "en", "el", "la", "los", "las", "un", "una", "unos", "unas", "por", "para", "con", "pesos", "peso", "mxn", "mi", "mis", "su", "al", "a", "que", "fue", "hoy", "ayer"]);

export function parseVoiceText(raw: string, categories: SimpleCategory[], rules?: SimpleRule[]): { amount: number | null; concept: string; categoryId: number | null; heard: string } {
  const heard = raw.trim();
  const tokens = normText(heard).split(" ").filter(Boolean);
  let amount: number | null = null;
  const amountIdx = new Set<number>();
  // 1) Dígitos: "320", "1,250.50".
  const dm = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(heard);
  if (dm) {
    const v = Number(dm[1]!.replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0 && v < 1000000) amount = v;
  }
  // 2) Cantidad en palabras: "trescientos veinte", "mil doscientos".
  if (amount == null) {
    for (let i = 0; i < tokens.length; i++) {
      const p = parseNumberWords(tokens, i);
      if (p && p.value > 0) {
        amount = p.value;
        for (let j = i; j < i + p.consumed; j++) amountIdx.add(j);
        break;
      }
    }
  }
  const concept = tokens
    .filter((t, i) => !amountIdx.has(i) && !FILLER.has(t) && !/^\d+$/.test(t))
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
  const categoryId = concept ? suggestCategoryId(categories, concept, rules) : null;
  return { amount, concept, categoryId, heard };
}
