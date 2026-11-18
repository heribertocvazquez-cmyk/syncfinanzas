// Ayudas para las mejoras ligeras: sugerencia de categoría, lectura de
// comprobantes, dictado por voz y reglas de auto-categorización. Todo corre
// en el dispositivo, sin servicios de pago.

export type SimpleCategory = { id: number; name: string; kind: string; subcategories: string[]; isActive?: number };
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

export type ReceiptItem = { name: string; amount: number };
// Lectura completa de un comprobante: lo que llena el formulario (comercio,
// fecha, total) más el detalle que solo se muestra para revisar (subtotal,
// RFC, forma de pago, artículos y si la suma de artículos cuadra con el
// total). Nada de este detalle se guarda con el movimiento.
export type ReceiptRead = {
  store: string | null; date: string | null; total: number | null;
  subtotal: number | null; rfc: string | null; payment: string | null;
  items: ReceiptItem[]; itemsSum: number | null; sumsMatch: boolean | null;
  suggestedCategoryLabel: string | null;
};

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

// Importes con decimales dentro de una línea ("46.50", "1,234.56", "201,50").
// Los enteros sin decimales no cuentan: una cantidad, un año o un folio no
// es un importe. Igual que todosLosMontos del previo, pero con el manejo
// de miles del lector actual ("1,234.56" son 1234.56, no 1.23).
function decimalAmounts(line: string): number[] {
  const out: number[] = [];
  const re = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+,\d{2}|\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const raw = m[1]!;
    if (!/\.\d{1,2}$/.test(raw) && !/,\d{2}$/.test(raw)) continue;
    const v = raw.includes(".") ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

// Tabla de categorías sugeridas del lector propio (la del previo): palabras
// de comercios y giros comunes en México → etiqueta sugerida. La etiqueta
// es solo una sugerencia: la app siempre usa las categorías reales del
// hogar y, si la etiqueta no está, ofrece crearla.
const TICKET_CATEGORY_LABELS: { keys: string[]; label: string }[] = [
  { keys: ["oxxo", "7-eleven", "7 eleven", "circulo k", "tienda de conveniencia"], label: "Tienda de conveniencia" },
  { keys: ["gasolina", "pemex", "combustible", "bp ", "shell", "g500", "oxxo gas"], label: "Transporte y gasolina" },
  { keys: ["farmacia", "guadalajara", "del ahorro", "benavides", "similares"], label: "Salud y farmacia" },
  { keys: ["walmart", "soriana", "chedraui", "bodega aurrera", "aurrera", "la comer", "heb", "h-e-b", "super", "mercado", "abarrotes"], label: "Súper y despensa" },
  { keys: ["restaurante", "restaurant", "tacos", "cocina", "cafe", "café", "pizza", "hamburguesa", "sushi", "comida"], label: "Comida fuera de casa" },
  { keys: ["cfe", "telmex", "izzi", "totalplay", "agua", "predial", "luz"], label: "Hogar y servicios" },
  { keys: ["cinepolis", "cinemex", "cine", "teatro", "concierto"], label: "Entretenimiento" },
];

export function suggestTicketCategoryLabel(text: string): string | null {
  const bag = text.toLowerCase();
  for (const c of TICKET_CATEGORY_LABELS) {
    for (const k of c.keys) if (bag.includes(k)) return c.label;
  }
  return null;
}

export type OcrCategoryResult = { id: number } | { label: string } | null;

// Resuelve la categoría de un comprobante leído contra las categorías
// reales del hogar: primero el nombre exacto de la etiqueta sugerida,
// luego las reglas y palabras del comercio y los artículos; si nada
// coincide, devuelve la etiqueta para ofrecer crearla.
export function resolveReceiptCategory(categories: SimpleCategory[], parsed: ReceiptRead, kind: "income" | "expense", rules?: SimpleRule[]): OcrCategoryResult {
  const cats = categories.filter((c) => c.kind === kind && c.isActive === 1);
  if (parsed.suggestedCategoryLabel) {
    const label = parsed.suggestedCategoryLabel;
    const byName = cats.find((c) => normText(c.name) === normText(label));
    if (byName) return { id: byName.id };
  }
  const haystack = [parsed.store, ...parsed.items.map((i) => i.name)].filter(Boolean).join(" ");
  if (haystack.trim()) {
    const id = suggestCategoryId(categories, haystack, rules);
    if (id != null) {
      const cat = cats.find((c) => c.id === id);
      if (cat) return { id: cat.id };
    }
  }
  if (parsed.suggestedCategoryLabel) return { label: parsed.suggestedCategoryLabel };
  return null;
}

// El nombre del comercio solo se usa si se lee limpio. El OCR a veces
// devuelve las primeras líneas hechas fragmentos sueltos ("Edi Br a. A EX
// pe C TE ae.") que no son un nombre usable: antes pasaban el filtro y
// quedaban como concepto del gasto. Se acepta solo si hay palabras
// reales: al menos una palabra de 3+ letras, la mayoría de las letras en
// palabras de 3+ letras y como mucho una letra suelta. Si ninguna línea
// pasa, el comercio queda vacío y la persona escribe el concepto.
export function isCleanStoreName(line: string): boolean {
  const tokens = line
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const letters = tokens.reduce((a, t) => a + t.length, 0);
  const longTokens = tokens.filter((t) => t.length >= 3);
  const longLetters = longTokens.reduce((a, t) => a + t.length, 0);
  const singleLetters = tokens.filter((t) => t.length === 1).length;
  return letters >= 3 && longTokens.length >= 1 && longLetters / letters >= 0.5 && singleLetters <= 1;
}

// Año de dos dígitos: el año más cercano a hoy (ventana de ±50 años).
// Un ticket de hoy que dice "26" es 2026, no 1926; uno que dice "99" es
// 1999. Antes se sumaba 2000 fijo, así que "99" salía 2099.
export function resolveTwoDigitYear(yy: number, refYear: number): number {
  const base = refYear - (refYear % 100);
  let y = base + yy;
  if (y >= refYear + 50) y -= 100;
  if (y < refYear - 50) y += 100;
  return y;
}

// Fecha de calendario real (el 31 de febrero no existe, ni el 29 de
// febrero en un año no bisiesto). El lector antes aceptaba cualquier día
// de 1 a 31.
export function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Estado de una fecha leída de un comprobante frente a hoy. Una fecha de
// otro año, o en el futuro, casi siempre es una lectura mal hecha del año
// (en un ticket térmico el 6 se lee 7 y el 2 se lee 1: "2026" sale
// "2017"), así que no se guarda en silencio: la app pide confirmar la
// fecha de origen del gasto antes de guardar.
export type ReceiptDateStatus = "ok" | "none" | "future" | "other-year" | "invalid";
export function checkReceiptDate(dateIso: string | null, todayIso?: string): { status: ReceiptDateStatus; year: number | null } {
  if (!dateIso) return { status: "none", year: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return { status: "invalid", year: null };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!isValidCalendarDate(y, mo, d)) return { status: "invalid", year: y };
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  if (dateIso > today) return { status: "future", year: y };
  if (y !== Number(today.slice(0, 4))) return { status: "other-year", year: y };
  return { status: "ok", year: y };
}

// La fecha leída que está pendiente de confirmación: la fecha que leyó
// el comprobante y el motivo por el que no se aplicó en silencio.
export type ReceiptDateCheck = { readDate: string; reason: "future" | "other-year" };

export function parseReceiptText(text: string, todayIso?: string): ReceiptRead {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total: number | null = null;
  // La línea de total es la que dice "total" sin ser "subtotal".
  const totalLines = lines.filter((l) => {
    const n = normText(l);
    return n.includes("total") && !n.includes("subtotal") && !n.includes("sub total");
  });
  for (const l of totalLines) {
    const amts = amountsIn(l);
    if (amts.length > 0) total = amts[amts.length - 1]!;
  }
  if (total == null) {
    // Sin línea de total: el importe mayor del último tercio, en líneas con
    // signo de pesos o decimales (una fecha no debe tomarse por importe).
    // Se conserva el respaldo del lector actual, no el del previo (el
    // importe mayor de todo el texto es más débil).
    const tail = lines.slice(Math.floor((lines.length * 2) / 3));
    let best = 0;
    for (const l of tail) {
      if (/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(l)) continue;
      for (const a of amountsIn(l, true)) if (a > best && a < 1000000) best = a;
    }
    total = best > 0 ? best : null;
  }
  // Fecha del comprobante: se juntan TODAS las fechas candidatas del
  // texto, en orden. La fecha del ticket suele ser la primera, pero una
  // fecha vieja (vigencia de una promoción, caducidad) puede ir antes, y
  // el año puede venir mal leído ("2026" sale "2017" en un ticket
  // térmico). Se prefiere la primera fecha verosímil (de este año y no
  // futura); si ninguna lo es, queda la más cercana a hoy para que la
  // app pida confirmar la fecha de origen en vez de guardarla en silencio.
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const todayYear = Number(today.slice(0, 4));
  const candidates: string[] = [];
  const pushCandidate = (d: number, mo: number, y: number) => {
    if (!isValidCalendarDate(y, mo, d)) return;
    candidates.push(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };
  const dateRe = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/;
  const dateReEs = /(\d{1,2})\s*(?:de\s*)?(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[a-z]*\.?\s*(?:de\s*)?(\d{4}|\d{2})/i;
  for (const l of lines) {
    const m = dateRe.exec(l);
    if (m) {
      let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      if (y < 100) y = resolveTwoDigitYear(y, todayYear);
      if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
      pushCandidate(d, mo, y);
    }
    const m2 = dateReEs.exec(l);
    if (m2) {
      const d = Number(m2[1]), mo = MONTHS_ES[m2[2]!.toLowerCase().slice(0, 3)], y0 = Number(m2[3]);
      const y = y0 < 100 ? resolveTwoDigitYear(y0, todayYear) : y0;
      if (mo) pushCandidate(d, Number(mo), y);
    }
  }
  // Se prefiere la primera fecha verosímil (de este año y no futura); si
  // ninguna lo es, queda la más cercana a hoy (un año mal leído de 2017
  // queda a 9 años; una fecha futura por un día mal leído queda a días).
  // En cualquier caso, la app pide confirmar la fecha de origen antes de
  // guardarla, en vez de aplicarla en silencio.
  const dayDiff = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const plausible = candidates.find((c) => checkReceiptDate(c, today).status === "ok");
  const closest = [...candidates].sort((a, b) => Math.abs(dayDiff(a)) - Math.abs(dayDiff(b)) || (dayDiff(a) > 0 ? 1 : 0) - (dayDiff(b) > 0 ? 1 : 0))[0];
  const date = plausible ?? closest ?? null;
  const skip = ["total", "gracias", "ticket", "folio", "fecha", "hora", "caja", "vendedor", "cajero", "cambio", "efectivo", "tarjeta", "subtotal", "iva", "descuento", "articulo", "cantidad", "precio", "importe", "cliente", "domicilio"];
  let store: string | null = null;
  for (const l of lines.slice(0, 6)) {
    const n = normText(l);
    if (l.length < 3 || l.length > 50) continue;
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l)) continue;
    if (skip.some((w) => n.includes(w))) continue;
    if (/\d{4,}/.test(l)) continue;
    if (!isCleanStoreName(l)) continue;
    store = l.replace(/[^\p{L}\p{N} &.'-]/gu, "").trim() || null;
    if (store) break;
  }
  // Subtotal: último importe de la línea que dice "subtotal".
  let subtotal: number | null = null;
  for (const l of lines) {
    const n = normText(l);
    if (!n.includes("subtotal") && !n.includes("sub total")) continue;
    const amts = decimalAmounts(l);
    if (amts.length > 0) subtotal = amts[amts.length - 1]!;
  }
  // RFC del comercio.
  const rfcMatch = text.toUpperCase().match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/);
  const rfc = rfcMatch ? rfcMatch[0] : null;
  // Forma de pago.
  const nt = normText(text);
  const payment = nt.includes("efectivo") ? "Efectivo"
    : /tarjeta|credito|debito|visa|mastercard/.test(nt) ? "Tarjeta"
    : /transferencia|spei/.test(nt) ? "Transferencia" : null;
  // Artículos: líneas con importe al final, que no sean totales, impuestos
  // ni pago. Igual que en el previo.
  const itemSkip = /total|iva|impuesto|cambio|efectivo|tarjeta|recib|saldo|puntos|redondeo|descuento/i;
  const items: ReceiptItem[] = [];
  for (const l of lines) {
    if (itemSkip.test(l)) continue;
    const amts = decimalAmounts(l);
    if (amts.length === 0) continue;
    const name = l
      .replace(/[\s$]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*$/, "")
      .replace(/[\s$]*\d+,\d{2}\s*$/, "")
      .trim();
    if (name.length < 3 || !/[A-Za-zÁÉÍÓÚÑ]/i.test(name)) continue;
    if (/^\d+$/.test(name)) continue;
    items.push({ name: name.replace(/\s{2,}/g, " "), amount: amts[amts.length - 1]! });
    if (items.length >= 40) break;
  }
  const itemsSum = items.length > 0 ? items.reduce((a, i) => a + i.amount, 0) : null;
  const sumsMatch = itemsSum != null && total != null ? Math.abs(itemsSum - total) <= 0.51 : null;
  const suggestedCategoryLabel = suggestTicketCategoryLabel(text);
  return { store, date, total, subtotal, rfc, payment, items, itemsSum, sumsMatch, suggestedCategoryLabel };
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
