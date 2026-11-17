// Mike: respuestas preparadas + respuestas dinámicas con datos
// reales + revisión de movimientos + aprendizaje en el dispositivo +
// asistente de ahorro conversacional + avisos proactivos.
// Sin servicios externos, sin claves, sin costo, sin SQL nuevo.
//
// Lo que aprende Mike y dónde se guarda (todo en el navegador):
// - localStorage "sf-help-learn": preguntas más frecuentes (por texto de
//   pregunta), meses en que cada categoría se pasó de presupuesto y
//   conceptos recurrentes (cuántas veces, último importe, última fecha).
//   Sirve para ordenar las preguntas sugeridas por frecuencia, personalizar
//   el saludo proactivo y avisar de categorías que se pasan una y otra vez.
// - sessionStorage "sf-help-greeted": "1" cuando el saludo proactivo ya se
//   mostró en esta sesión (un aviso suave por sesión, que se puede
//   descartar, nunca un popup que bloquee).
// Nada de esto sale del dispositivo ni se guarda en la base de datos.
import type { Tab } from "../App";
import type { api } from "../api";

export type HelpOption = { label: string; send: string };
export type HelpMsg = { from: "user" | "bot"; text: string; go?: Tab; goLabel?: string; options?: HelpOption[] };
export type HelpFaq = { keys: string[]; q: string; a: string; go?: Tab; goLabel?: string };
// Los datos del hogar ya cargados por la app (getOverview). Los movimientos
// de esa lista ya vienen filtrados por el servidor: cada usuario ve solo los
// movimientos Compartidos y los suyos propios, nunca los Privados de otros
// integrantes. Por eso las respuestas dinámicas y la revisión usan solo
// ov.movements y nunca consultan nada más.
export type OverviewData = Awaited<ReturnType<typeof api.getOverview>>;

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
function fmtMonth(ym: string | null): string { if (!ym) return ""; const [y = 2026, m = 1] = ym.split("-").map(Number); return new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" }); }
function fmtDate(iso: string): string { const [y = 2026, m = 1, d = 1] = iso.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); }
function prevMonths(ym: string, n: number): string[] {
  const [y = 2026, m = 1] = ym.split("-").map(Number);
  const out: string[] = [];
  for (let k = 1; k <= n; k++) { const d = new Date(y, (m || 1) - 1 - k, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}

// ---- Respuestas preparadas (24, sin cambios) ----
export const HELP_FAQS: HelpFaq[] = [
  { keys: ["gast", "registr"], q: "¿Cómo registro un gasto?", a: "En Movimientos, escriba el importe, elija el tipo de gasto y pulse Registrar. En modo Personal también puede usar Gasto del día en Personal. Elija de dónde se descuenta: Efectivo o una de sus cuentas.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["gasto del dia", "gast"], q: "¿Cómo registro el gasto del día?", a: "En Personal, en Gasto del día, escriba el importe, elija el tipo de gasto y de dónde se descuenta, y pulse Registrar.", go: "personal", goLabel: "Ir a Personal" },
  { keys: ["gasto", "limite", "umbral", "supera", "excede"], q: "¿Qué pasa si un gasto supera el límite?", a: "Si un gasto supera el límite permitido del hogar, aparece un aviso en la campanita. Revise el límite en Hogar y el presupuesto de la categoría en Presupuestos.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["ingres", "registr"], q: "¿Cómo registro un ingreso?", a: "En Movimientos, elija Ingreso, escriba el importe y pulse Registrar.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["cuenta", "agreg", "banc", "efectivo"], q: "¿Cómo agrego una cuenta?", a: "En Cuentas, pulse Nueva cuenta, escriba el nombre, el tipo y el saldo inicial.", go: "cuentas", goLabel: "Ir a Cuentas" },
  { keys: ["arqueo", "auditor", "conteo", "recuento", "cierre de caja"], q: "¿Cómo hago un arqueo de cuentas?", a: "En Cuentas, pulse Arqueo de cuentas y anote lo que contó en físico por cada cuenta y en efectivo. El renglón de efectivo compara el restante del sueldo (sueldo del mes menos lo gastado) con lo contado en físico. La app muestra al lado lo que dice la app y la diferencia: en rojo si falta dinero, en verde si sobra, y Sin diferencia cuando coincide. El arqueo no cambia los saldos, solo guarda el recuento para revisarlo después.", go: "cuentas", goLabel: "Ir a Cuentas" },
  { keys: ["tanda"], q: "¿Cómo creo una tanda?", a: "En Tandas, escriba el nombre, el monto y el número de participantes, elija la regla si alguien no paga, el tesorero y el día de reunión, y pulse Crear tanda. Después invite por correo a los participantes. En cada ronda verá la ficha, el pase de lista y los saldos separados.", go: "tandas", goLabel: "Ir a Tandas" },
  { keys: ["invit", "persona", "unir", "alguien", "invito a mi pareja"], q: "¿Cómo invito a alguien?", a: "En Perfiles, escriba el correo de la persona y pulse Invitar. Recibirá un enlace directo para entrar a su hogar.", go: "perfiles", goLabel: "Ir a Perfiles" },
  { keys: ["espacio", "hogar", "inici", "empez"], q: "¿Cómo creo mi espacio?", a: "Para crear su espacio, elija Personal o Familiar, escriba el nombre de su hogar y sus datos, y pulse Crear hogar.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["instal", "celular", "pantalla", "descarg"], q: "¿Cómo instalo la app en mi celular?", a: "En iPhone, abra la app en Safari, pulse Compartir y seleccione Agregar a pantalla de inicio. En Android, abra el menú ⋮ de Chrome, seleccione «Instalar y crear acceso directo» y confirme con «Instalar».", go: "guia", goLabel: "Ir a Guía de uso" },
  { keys: ["actualiz", "nueva versión", "versión"], q: "¿Cómo actualizo la app?", a: "Si hay una versión nueva, aparece un aviso con el botón Actualizar. También puede revisar en Hogar → Buscar actualizaciones. Su cuenta y sus datos no cambian.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["reinici", "reset", "borrar mis datos", "borrar todo", "borrar los datos", "borrar la cuenta", "borrar mi cuenta", "eliminar mis datos", "eliminar todo", "eliminar la cuenta", "empezar de nuevo"], q: "¿Cómo reinicio todo?", a: "En Hogar, al final, pulse el texto discreto Reiniciar la aplicación y responda las 3 preguntas de control una por una (la segunda muestra el número real de tandas y personas). Después escriba REINICIAR. Se borra todo (movimientos, cuentas, presupuestos, tandas y el hogar) y la app vuelve al inicio para elegir de nuevo Personal o Familiar.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["sueldo", "salario", "mi sueldo", "mi salario"], q: "¿Cómo registro mi sueldo?", a: "En Personal, escriba su sueldo mensual y pulse Guardar sueldo.", go: "personal", goLabel: "Ir a Personal" },
  { keys: ["presupuest", "limite"], q: "¿Cómo creo un presupuesto?", a: "En Presupuestos, elija la categoría, escriba el límite del mes y pulse Guardar. Los gastos de esa categoría en el mes se descuentan solos del presupuesto, sin hacer nada más.", go: "presupuestos", goLabel: "Ir a Presupuestos" },
  { keys: ["pagar presupuesto", "pago desde inicio", "aportar desde inicio"], q: "¿Cómo pago un presupuesto desde Inicio?", a: "En Inicio, pulse la tarjeta del presupuesto, escriba el importe, elija de dónde se descuenta (Efectivo o una cuenta) y pulse Guardar pago. El gasto se asigna a esa categoría y se resta de la cuenta elegida. Lo mismo con las metas y el patrimonio.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["comprobante", "foto", "ticket", "escanear", "leer el comprobante"], q: "¿Cómo leo un comprobante?", a: "En Movimientos, en Más opciones, suba la foto del comprobante y pulse Leer el comprobante: la app lee el total en su dispositivo, sin costo, y llena el importe, el concepto y la categoría. Revise antes de guardar.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["revers", "revier", "revierto", "revertir", "deshacer", "corregir", "eliminar", "borrar un", "gast"], q: "¿Cómo reverso un movimiento?", a: "En Movimientos, pulse Reversar junto al movimiento. El registro queda, pero ya no cuenta en los totales.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["categor", "subcategor", "tipo de gasto", "una categoria"], q: "¿Cómo agrego una categoría?", a: "En Categorías puede ver, agregar y quitar categorías y subcategorías.", go: "categorias", goLabel: "Ir a Categorías" },
  { keys: ["perfil", "pareja", "familiar", "a mi pareja"], q: "¿Cómo agrego a mi pareja?", a: "En Perfiles puede ver a las personas del hogar y agregar a su pareja o familiares.", go: "perfiles", goLabel: "Ir a Perfiles" },
  { keys: ["saldo", "disponible", "cuanto me queda", "restante", "queda"], q: "¿Cuánto me queda?", a: "Su saldo disponible está en Inicio, en la tarjeta de arriba.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["grafic", "ingresos vs gastos"], q: "¿Dónde veo las gráficas?", a: "Las gráficas están en Inicio y aparecen cuando hay movimientos. La dona de gasto por categoría lleva el símbolo de cada rubro dentro de su color: al tocar un segmento queda marcado, aparece su monto y porcentaje debajo, y se abre la ventana con sus gastos registrados.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["modo oscuro", "modo claro", "oscuro", "claro", "noche", "tema oscuro", "tema claro"], q: "¿Cómo cambio a modo oscuro o claro?", a: "Abra el menú, entre a Configuración y pulse «Vista»; ahí elija Claro u Oscuro. Su elección se guarda para la próxima vez.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["modo", "cambi", "personal"], q: "¿Cómo cambio el modo?", a: "El modo se elige al crear el espacio y se cambia en Hogar.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["contrase", "clave", "correo", "mi cuenta"], q: "¿Cómo es mi cuenta?", a: "Su cuenta se crea con su correo y una contraseña de al menos 12 caracteres." },
  { keys: ["fondo", "apart"], q: "¿Cómo creo un fondo?", a: "En Fondos, cree un apartado con su meta y agregue dinero desde sus cuentas.", go: "fondos", goLabel: "Ir a Fondos" },
  { keys: ["meta", "ahorr"], q: "¿Cómo creo una meta?", a: "En Metas, escriba su meta, el monto y la fecha, y registre su ahorro.", go: "metas", goLabel: "Ir a Metas" },
  { keys: ["plan de ahorro", "plan", "coche"], q: "¿Cómo armo un plan de ahorro para una meta?", a: "En Metas, pulse Armar plan de ahorro en su meta. La app calcula cuánto debe aportar al mes según su sueldo, sus compromisos y su gasto, y le dice si le alcanza. Si no le alcanza, le muestra de qué categoría puede recortar o alargar el plazo. Al aceptar, el dinero se aparta en un fondo de la meta y recibe avisos de cada aportación.", go: "metas", goLabel: "Ir a Metas" },
  { keys: ["ajuste", "recorte", "me pase del presupuesto", "me pase de presupuesto", "me excedi", "me pase"], q: "¿Cómo funciona el ajuste de gastos?", a: "Si una categoría se pasa de su presupuesto, la app propone recortar de otras categorías con margen para que su aportación a la meta casi no cambie. Primero le avisa con la campanita, con cuánto se pasó, de dónde se recorta y qué se mantiene igual. Nada se mueve sin que usted lo acepte en Metas; ahí puede cambiar de dónde se recorta.", go: "metas", goLabel: "Ir a Metas" },
  { keys: ["sobrante", "sobr", "gasto menos", "gasto menos de lo planeado"], q: "¿Qué pasa con el sobrante de una categoría?", a: "Si un mes gastó menos de lo planeado en una categoría, la app le propone mover ese sobrante al fondo de su meta para llegar antes. También le avisa antes con la campanita y nada se mueve sin que usted lo acepte en Metas.", go: "metas", goLabel: "Ir a Metas" },
  { keys: ["acuerdo", "vot", "aprobaci", "aprueb", "gasto mayor", "gast"], q: "¿Cómo se aprueba un gasto mayor?", a: "En Acuerdos se votan los gastos mayores al umbral de su hogar.", go: "acuerdos", goLabel: "Ir a Acuerdos" },
  { keys: ["patrimonio", "activo", "pasivo", "neto", "mi patrimonio"], q: "¿Cómo registro mi patrimonio?", a: "En Patrimonio registre sus activos y pasivos para ver su patrimonio neto.", go: "patrimonio", goLabel: "Ir a Patrimonio" },
  { keys: ["demo", "demostraci", "ejemplo", "probar"], q: "¿Cómo pruebo con datos de ejemplo?", a: "En la Guía de uso, pulse «Cargar demo». Solo funciona sin movimientos." },
  { keys: ["aportaci", "reparto", "compartido"], q: "¿Dónde veo las aportaciones?", a: "Las aportaciones se calculan solas desde Movimientos y se ven en Aportaciones.", go: "aportaciones", goLabel: "Ir a Aportaciones" },
];

export function normHelp(s: string): string { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

// Busca por palabras clave, no por la frase exacta: la pregunta se normaliza
// (minúsculas, sin acentos) y se divide en palabras. Una clave de una sola
// palabra vale 1 punto si alguna palabra de la pregunta empieza con ella
// (así "reinici" casa con "reiniciar", pero "inici" no casa con "reiniciar").
// Una clave de varias palabras vale 2 puntos si la frase aparece tal cual
// (así "borrar mis datos" gana a "borrar un"). Gana la respuesta con más
// puntos; en empate gana la primera de la lista.
export function findHelpAnswer(input: string, faqs: HelpFaq[] = HELP_FAQS): HelpFaq | null {
  const n = normHelp(input);
  if (!n) return null;
  const words = n.split(" ");
  let best: HelpFaq | null = null; let bestScore = 0;
  for (const f of faqs) {
    let score = 0;
    for (const k of f.keys) {
      const nk = normHelp(k);
      if (nk.includes(" ")) { if (n.includes(nk)) score += 2; }
      else if (words.some(w => w.startsWith(nk))) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore > 0 ? best : null;
}

// Preguntas predictivas: mientras el usuario escribe, muestra las preguntas
// que coinciden con lo que lleva escrito (por claves y por las palabras de
// la propia pregunta), ordenadas por coincidencia. Las preguntas que más se
// han hecho (según el aprendizaje guardado en el dispositivo) suben hasta
// 3 puntos más, así las sugerencias se ordenan por uso con el tiempo.
export function predictHelp(input: string, faqs: HelpFaq[] = HELP_FAQS, max = 5, frequent?: Record<string, number>): HelpFaq[] {
  const n = normHelp(input);
  if (n.length < 2) return [];
  const words = n.split(" ");
  const scored = faqs.map(f => {
    let score = 0;
    for (const k of f.keys) {
      const nk = normHelp(k);
      if (nk.includes(" ")) { if (n.includes(nk)) score += 2; }
      else if (words.some(w => w.startsWith(nk) || nk.startsWith(w))) score += 1;
    }
    const qn = normHelp(f.q);
    for (const w of words) if (w.length >= 3 && qn.split(" ").some(qw => qw.startsWith(w))) score += 1;
    if (frequent) score += Math.min(frequent[normHelp(f.q)] ?? 0, 3);
    return { f, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(s => s.f);
}

// Sugerencias al abrir el chat: con la caja vacía no hay nada que predecir
// (predictHelp devuelve []), así que se muestran primero las preguntas
// dinámicas con cifras reales y luego las dudas de uso más comunes. Así el
// chat nunca abre solo con la caja de texto vacía.
export function defaultHelpSuggestions(faqs: HelpFaq[] = HELP_FAQS, dynamic: HelpFaq[] = [], max = 5): HelpFaq[] {
  const seen = new Set<string>();
  const out: HelpFaq[] = [];
  for (const f of [...dynamic, ...faqs]) {
    if (seen.has(f.q)) continue;
    seen.add(f.q);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

// ---- Cálculos con datos reales (solo movimientos visibles) ----
// Un movimiento reversado y su reversión no cuentan: se excluyen igual que
// en los totales de la app.
function visibleExpenses(ov: OverviewData) {
  return ov.movements.filter(m => (m.type === "expense" || m.type === "debt_payment") && !m.isReversed && m.reversalOfId == null);
}
function catName(ov: OverviewData, id: number | null): string {
  return ov.categories.find(c => c.id === id)?.name ?? "Sin categoría";
}
function spentByCategory(ov: OverviewData, month: string): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const m of visibleExpenses(ov)) {
    if (!m.date.startsWith(month)) continue;
    out.set(m.categoryId, (out.get(m.categoryId) ?? 0) + m.amount);
  }
  return out;
}

export type OverBudgetCat = { id: number | null; name: string; budget: number; spent: number; over: number };
export function overBudgetCats(ov: OverviewData, month: string): OverBudgetCat[] {
  const spent = spentByCategory(ov, month);
  return ov.budgets.filter(b => b.month === month && b.amount > 0).map(b => {
    const s = spent.get(b.categoryId) ?? 0;
    return { id: b.categoryId, name: catName(ov, b.categoryId), budget: b.amount, spent: Math.round(s * 100) / 100, over: Math.round((s - b.amount) * 100) / 100 };
  }).filter(x => x.over > 0).sort((a, b) => b.over - a.over);
}

export type AboveAvgCat = { id: number | null; name: string; spent: number; avg: number };
export function aboveAvgCats(ov: OverviewData, month: string): AboveAvgCat[] {
  const spent = spentByCategory(ov, month);
  const prev = prevMonths(month, 3);
  const out: AboveAvgCat[] = [];
  for (const [id, s] of spent.entries()) {
    if (s <= 0) continue;
    let total3 = 0;
    for (const pm of prev) total3 += spentByCategory(ov, pm).get(id) ?? 0;
    const avg = total3 / 3;
    if (avg > 0 && s > avg * 1.15 && s - avg >= 100) out.push({ id, name: catName(ov, id), spent: Math.round(s * 100) / 100, avg: Math.round(avg * 100) / 100 });
  }
  return out.sort((a, b) => (b.spent - b.avg) - (a.spent - a.avg));
}

export type GoalLine = { id: number; name: string; saved: number; target: number; pct: number; monthlyAmount: number | null; monthsLeft: number | null; projectedDate: string | null; status: "al corriente" | "atrasada" | "en riesgo" | "sin plan" };
export function goalLines(ov: OverviewData): GoalLine[] {
  return ov.goals.map(g => {
    const plan = ov.goalPlans.find(p => p.goalId === g.id);
    if (!plan) return { id: g.id, name: g.name, saved: g.savedAmount, target: g.targetAmount, pct: g.pct, monthlyAmount: null, monthsLeft: null, projectedDate: null, status: "sin plan" as const };
    const status = plan.atRisk ? "en riesgo" as const : plan.onTrack ? "al corriente" as const : "atrasada" as const;
    return { id: g.id, name: g.name, saved: g.savedAmount, target: g.targetAmount, pct: g.pct, monthlyAmount: plan.monthlyAmount, monthsLeft: plan.monthsLeft, projectedDate: plan.projectedDate, status };
  });
}

// Respuestas dinámicas con cifras reales del mes que muestra el tablero.
// Se recalculan cada vez que cambian los datos; si no hay hogar, no hay
// respuestas dinámicas y Mike sigue solo con las preparadas.
export function dynamicHelpFaqs(ov: OverviewData): HelpFaq[] {
  if (!ov.household) return [];
  const month = ov.summary.currentMonth;
  const monthLabel = fmtMonth(month);
  const over = overBudgetCats(ov, month);
  const above = aboveAvgCats(ov, month).filter(a => !over.some(o => o.id === a.id));
  const goals = goalLines(ov);
  const faqs: HelpFaq[] = [];

  let a1: string;
  if (over.length === 0 && above.length === 0) a1 = `En ${monthLabel} no se pasó de ningún presupuesto ni de su promedio de los últimos 3 meses. Su gasto está dentro de lo planeado.`;
  else {
    const parts: string[] = [];
    for (const o of over.slice(0, 3)) parts.push(`${o.name}: gastó ${money(o.spent)} de ${money(o.budget)} de presupuesto, se pasó ${money(o.over)}`);
    for (const a of above.slice(0, Math.max(0, 3 - parts.length))) parts.push(`${a.name}: gastó ${money(a.spent)}, su promedio de los últimos 3 meses es ${money(a.avg)}`);
    a1 = `En ${monthLabel} se pasó en: ${parts.join(". ")}.`;
  }
  faqs.push({ keys: ["en que gasto de mas", "gasto de mas", "donde gasto de mas", "me pase de mi presupuesto", "gasto mas que", "gasto"], q: "¿En qué gasto de más?", a: a1, go: "presupuestos", goLabel: "Ir a Presupuestos" });

  const aboveAll = aboveAvgCats(ov, month);
  const excess = new Map<number | null, { name: string; excess: number }>();
  for (const o of over) excess.set(o.id, { name: o.name, excess: o.over });
  for (const a of aboveAll) { const cur = excess.get(a.id); const e = Math.round((a.spent - a.avg) * 100) / 100; if (!cur || e > cur.excess) excess.set(a.id, { name: a.name, excess: e }); }
  const top = Array.from(excess.values()).sort((a, b) => b.excess - a.excess).slice(0, 3);
  let a2: string;
  if (top.length === 0) a2 = "Este mes no hay excesos que recortar: su gasto está dentro de sus presupuestos y de su promedio.";
  else if (top.length === 1) a2 = `Si recorta ${money(top[0]!.excess)} en ${top[0]!.name}, ahorraría ${money(top[0]!.excess)} al mes.`;
  else { const total = top.reduce((s, t) => s + t.excess, 0); a2 = `Si recorta ${top.map(t => `${money(t.excess)} en ${t.name}`).join(", ")}, ahorraría ${money(total)} al mes. Empiece por ${top[0]!.name}, que es el mayor exceso.`; }
  faqs.push({ keys: ["donde puedo ahorrar", "puedo ahorrar", "como puedo ahorrar", "como ahorrar", "donde ahorrar", "ahorrar"], q: "¿Dónde puedo ahorrar?", a: a2, go: "presupuestos", goLabel: "Ir a Presupuestos" });

  // El asistente de ahorro conversacional: «cómo ahorrar más» no contesta
  // de una vez, abre el asistente que pregunta el motivo, el monto y el
  // plazo (ver wizardStep). Su respuesta preparada es solo un respaldo, el
  // chat intercepta la pregunta antes de contestarla.
  faqs.push({ keys: ["como ahorro mas", "quiero ahorrar", "ahorrar mas", "ayudame a ahorrar", "quiero ahorrar mas"], q: "¿Cómo ahorro más?", a: "Le ayudo a armar su plan paso a paso. ¿Para qué quiere ahorrar?", go: "metas", goLabel: "Ir a Metas" });

  let a3: string;
  if (goals.length === 0) a3 = "Aún no tiene metas de ahorro. Cree una en Metas y arme su plan de ahorro.";
  else {
    const lines = goals.slice(0, 3).map(g => {
      if (g.status === "sin plan") return `${g.name}: lleva ${money(g.saved)} de ${money(g.target)} (${g.pct}%), sin plan de ahorro`;
      const when = g.projectedDate ? ` y terminaría en ${fmtMonth(g.projectedDate)}` : "";
      return `${g.name}: lleva ${money(g.saved)} de ${money(g.target)} (${g.pct}%), ${g.status}, aporte ${money(g.monthlyAmount ?? 0)} al mes, le faltan ${g.monthsLeft ?? 0} meses${when}`;
    });
    a3 = lines.join(". ") + "." + (goals.length > 3 ? ` Y ${goals.length - 3} más en Metas.` : "");
  }
  faqs.push({ keys: ["como va mi meta", "como van mis metas", "mi meta", "mis metas", "avance de mi meta", "progreso de mi meta"], q: "¿Cómo va mi meta?", a: a3, go: "metas", goLabel: "Ir a Metas" });

  const personal = ov.household.mode === "personal";
  let a4: string;
  if (personal) {
    const rem = ov.personal.remaining;
    a4 = rem >= 0
      ? `Este mes le quedan ${money(rem)}. Su sueldo es ${money(ov.personal.salary)} y ha gastado ${money(ov.personal.monthSpent)}.`
      : `Este mes ya se pasó ${money(Math.abs(rem))} de su sueldo. Su sueldo es ${money(ov.personal.salary)} y ha gastado ${money(ov.personal.monthSpent)}.`;
  } else {
    const avail = ov.summary.availableFree;
    a4 = avail >= 0
      ? `En ${monthLabel} entraron ${money(ov.summary.monthIncome)} y salieron ${money(ov.summary.monthExpense)}. Le quedan ${money(avail)} disponibles.`
      : `En ${monthLabel} ya no queda disponible: entraron ${money(ov.summary.monthIncome)} y salieron ${money(ov.summary.monthExpense)}.`;
  }
  faqs.push({ keys: ["cuanto me queda este mes", "cuanto queda este mes", "me queda este mes", "cuanto me queda", "queda este mes"], q: "¿Cuánto me queda este mes?", a: a4, go: "inicio", goLabel: "Ir a Inicio" });

  const overLine = over.length > 0 ? `Se pasó en ${over.slice(0, 2).map(o => `${o.name} (${money(o.over)})`).join(" y ")}.` : "No se pasó de ningún presupuesto.";
  const goalLine = goals.length === 0 ? "Aún no tiene metas." : goals.slice(0, 2).map(g => `${g.name} va al ${g.pct}%`).join(". ") + ".";
  const a5 = `En ${monthLabel}: entraron ${money(ov.summary.monthIncome)} y gastó ${money(ov.summary.monthExpense)}. ${overLine} ${goalLine}`;
  faqs.push({ keys: ["resumen del mes", "como va mi mes", "resumen", "como voy este mes", "que tal va mi mes"], q: "¿Me das un resumen del mes?", a: a5, go: "inicio", goLabel: "Ir a Inicio" });
  return faqs;
}

// Tip corto de dinero con datos reales, para mostrarlo al abrir el chat:
// el mayor exceso del mes, una meta en riesgo o el avance de una meta.
// Siempre es una sola frase corta, en tono formal de usted.
export function moneyTip(ov: OverviewData): string | null {
  if (!ov.household) return null;
  const month = ov.summary.currentMonth;
  const monthLabel = fmtMonth(month);
  const over = overBudgetCats(ov, month);
  if (over.length > 0) {
    const o = over[0]!;
    return `Tip: en ${monthLabel} se pasó ${money(o.over)} en ${o.name}. Si lo recorta, ahorraría eso al mes.`;
  }
  const above = aboveAvgCats(ov, month);
  if (above.length > 0) {
    const a = above[0]!;
    return `Tip: en ${monthLabel} gastó ${money(a.spent)} en ${a.name}, más que su promedio de ${money(a.avg)}.`;
  }
  const risky = goalLines(ov).find(g => g.status === "en riesgo" || g.status === "atrasada");
  if (risky) return `Tip: su meta «${risky.name}» va al ${risky.pct}% y está ${risky.status}.`;
  const goals = goalLines(ov);
  if (goals.length > 0) {
    const g = goals[0]!;
    if (g.monthlyAmount != null && g.monthsLeft != null) return `Tip: su meta «${g.name}» va al ${g.pct}%. Aportando ${money(g.monthlyAmount)} al mes, llega en ${g.monthsLeft} meses.`;
    return `Tip: su meta «${g.name}» va al ${g.pct}%.`;
  }
  return "Tip: su gasto está dentro de lo planeado. Apartar un poco cada mes es la mejor forma de llegar a su meta.";
}

// ---- Revisión en vivo al capturar un movimiento ----
// Avisos que no bloquean: el usuario siempre puede guardar. Se revisa el
// importe contra el presupuesto restante de la categoría en el mes de la
// fecha del movimiento, un posible duplicado (mismo concepto, mismo importe
// y mismo día) y un monto muy por arriba del promedio usual de la categoría
// (más de 1.5 veces el promedio de los últimos 3 meses y al menos $100 más).
// Para ingresos no aplica el presupuesto ni el promedio; el duplicado sí.
export type MovementDraft = { type: "income" | "expense" | "transfer" | "debt_payment"; amount: number; categoryId: number | null; concept: string; date: string; excludeId?: number | null };
export function reviewMovement(ov: OverviewData, d: MovementDraft): string[] {
  const out: string[] = [];
  if (!ov.household || d.type === "transfer" || !(d.amount > 0)) return out;
  const month = d.date.slice(0, 7);
  const cat = d.categoryId != null ? ov.categories.find(c => c.id === d.categoryId) : undefined;
  const isExpense = d.type === "expense" || d.type === "debt_payment";
  if (isExpense && cat) {
    const b = ov.budgets.find(x => x.month === month && x.categoryId === cat.id);
    if (b && b.amount > 0) {
      const spent = spentByCategory(ov, month).get(cat.id) ?? 0;
      const remaining = Math.round((b.amount - spent) * 100) / 100;
      if (d.amount > remaining) out.push(`Este gasto supera el presupuesto restante de ${cat.name} por ${money(d.amount - remaining)}.`);
      else out.push(`De ${cat.name} le quedan ${money(remaining)} de presupuesto; con este gasto quedarían ${money(remaining - d.amount)}.`);
    }
  }
  const nc = normHelp(d.concept);
  if (nc) {
    const dup = ov.movements.find(m => m.type === d.type && !m.isReversed && m.reversalOfId == null && m.id !== (d.excludeId ?? null) && m.date === d.date && Math.abs(m.amount - d.amount) < 0.01 && normHelp(m.concept) === nc);
    if (dup) out.push(`Ya registró un movimiento igual el ${fmtDate(d.date)} (${dup.concept}, ${money(dup.amount)}). Revise si es un duplicado.`);
    const same = ov.movements.filter(m => m.type === d.type && !m.isReversed && m.reversalOfId == null && m.id !== (d.excludeId ?? null) && Math.abs(m.amount - d.amount) < 0.01 && normHelp(m.concept) === nc);
    if (same.length >= 3) out.push(`Usted registra «${same[0]!.concept}» por ${money(d.amount)} con frecuencia.`);
  }
  if (isExpense && cat) {
    const prev = prevMonths(month, 3);
    let total3 = 0;
    for (const pm of prev) total3 += spentByCategory(ov, pm).get(cat.id) ?? 0;
    const avg = total3 / 3;
    if (avg > 0 && d.amount > avg * 1.5 && d.amount - avg >= 100) out.push(`Este monto está muy por arriba de su gasto usual en ${cat.name} (promedio ${money(avg)} al mes).`);
  }
  return out;
}

// ---- Aprendizaje en el dispositivo (sin IA externa, sin costo) ----
export const HELP_LEARN_KEY = "sf-help-learn";
export const HELP_GREETED_KEY = "sf-help-greeted";
export type HelpLearning = { v: 1; questions: Record<string, number>; overBudget: Record<string, string[]>; concepts: Record<string, { count: number; amount: number; last: string }> };
export function loadHelpLearning(): HelpLearning {
  try {
    const raw = localStorage.getItem(HELP_LEARN_KEY);
    if (!raw) return { v: 1, questions: {}, overBudget: {}, concepts: {} };
    const v = JSON.parse(raw) as Partial<HelpLearning>;
    return { v: 1, questions: v.questions ?? {}, overBudget: v.overBudget ?? {}, concepts: v.concepts ?? {} };
  } catch { return { v: 1, questions: {}, overBudget: {}, concepts: {} }; }
}
function saveHelpLearning(l: HelpLearning): void {
  try { localStorage.setItem(HELP_LEARN_KEY, JSON.stringify(l)); } catch { /* sin almacenamiento, Mike sigue con las respuestas preparadas */ }
}
export function recordHelpQuestion(q: string): void {
  const l = loadHelpLearning();
  l.questions[q] = (l.questions[q] ?? 0) + 1;
  saveHelpLearning(l);
}
// Guarda, del mes en curso, las categorías que se pasaron de presupuesto
// (sin repetir el mes) y los conceptos recurrentes de los movimientos
// visibles (al menos 2 veces, hasta 50). Se llama cuando cambian los datos.
export function recordHelpLearning(ov: OverviewData): void {
  if (!ov.household) return;
  const l = loadHelpLearning();
  const month = ov.summary.currentMonth;
  for (const o of overBudgetCats(ov, month)) {
    const months = l.overBudget[o.name] ?? [];
    if (!months.includes(month)) months.push(month);
    l.overBudget[o.name] = months.slice(-6);
  }
  const counts = new Map<string, { count: number; amount: number; last: string }>();
  for (const m of visibleExpenses(ov)) {
    const nc = normHelp(m.concept);
    if (!nc) continue;
    const cur = counts.get(nc) ?? { count: 0, amount: m.amount, last: m.date };
    cur.count += 1;
    if (m.date >= cur.last) { cur.last = m.date; cur.amount = m.amount; }
    counts.set(nc, cur);
  }
  const concepts: HelpLearning["concepts"] = {};
  for (const [nc, c] of Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 50)) {
    if (c.count >= 2) concepts[nc] = { count: c.count, amount: c.amount, last: c.last };
  }
  l.concepts = concepts;
  saveHelpLearning(l);
}
export function repeatOverBudgetCats(l: HelpLearning): { name: string; months: number }[] {
  return Object.entries(l.overBudget).map(([name, months]) => ({ name, months: months.length })).filter(x => x.months >= 2).sort((a, b) => b.months - a.months);
}
export function frequentQuestions(l: HelpLearning): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [q, n] of Object.entries(l.questions)) out[normHelp(q)] = n;
  return out;
}
export function topHelpQuestion(l: HelpLearning): string | null {
  let best: string | null = null; let bestN = 0;
  for (const [q, n] of Object.entries(l.questions)) if (n > bestN) { bestN = n; best = q; }
  return bestN >= 2 ? best : null;
}
// Línea personal del saludo proactivo: primero una categoría que se pasa de
// presupuesto mes tras mes; si no hay, la pregunta que más se ha hecho.
export function buildGreeting(ov: OverviewData, l: HelpLearning): { text: string; personal: string | null } | null {
  if (!ov.household) return null;
  const text = "Hola, soy Mike. ¿Le digo en qué gasta de más o le doy un tip para su dinero?";
  const repeat = repeatOverBudgetCats(l);
  if (repeat.length > 0) return { text, personal: `${repeat[0]!.name} se ha pasado de presupuesto ${repeat[0]!.months} meses. ¿Quiere revisarlo?` };
  const top = topHelpQuestion(l);
  if (top) return { text, personal: `Usted suele preguntar por «${top}».` };
  return { text, personal: null };
}

// ---- Asistente de ahorro conversacional (el «mago») ----
// Conversación de varios turnos dentro del chat: cuando el usuario pregunta
// cómo ahorrar más o que quiere ahorrar, Mike no contesta de una
// vez: pregunta el motivo (ofrece sus metas como opciones rápidas o una
// meta nueva), luego el monto y el plazo, y después piensa con sus datos
// reales y le da los parámetros: aporte mensual, recortes sugeridos por
// categoría y plazo. La cuenta es la misma del plan de ahorro del servidor
// (ingreso, compromisos fijos y gasto promedio de los últimos 3 meses): el
// chat llama a la acción analyzeGoalPlan que ya existe, sin SQL nuevo.
// El estado del asistente vive en la memoria del chat (no se guarda en la
// base); si el usuario escribe Cancelar, se cierra sin más.
export type WizardStep = "motive" | "amount" | "deadline";
export type WizardState = { step: WizardStep; goalId: number | null; goalName: string; targetAmount: number | null; savedAmount: number; months: number | null };
const WIZARD_CANCEL: HelpOption = { label: "Cancelar", send: "Cancelar" };

export function matchSavingsWizard(input: string): boolean {
  const n = normHelp(input);
  if (!n) return false;
  return n.includes("quiero ahorrar") || n.includes("ayudame a ahorrar") || n.includes("ayuda a ahorrar") || n.includes("ahorrar mas") || n.includes("ahorro mas");
}

// Pregunta inicial del asistente: el motivo, con sus metas como opciones.
export function wizardMotive(ov: OverviewData): { text: string; options: HelpOption[] } {
  const goals = ov.goals.slice(0, 4);
  const options: HelpOption[] = goals.map(g => ({ label: g.name, send: g.name }));
  options.push({ label: "Una meta nueva", send: "Una meta nueva" });
  options.push(WIZARD_CANCEL);
  return { text: "Claro, le ayudo a ahorrar. ¿Para qué quiere ahorrar?", options };
}

export function wizardParseAmount(input: string): number | null {
  const n = normHelp(input);
  if (!n) return null;
  const m = input.replace(/[$\s]/g, "").match(/(\d[\d.,]*)/);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(/,/g, "")) * (n.includes("mil") ? 1000 : 1);
  if (!(v > 0) || v > 100000000) return null;
  return Math.round(v);
}

export function wizardParseMonths(input: string): number | null {
  const n = normHelp(input);
  const m = n.match(/(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1]!, 10);
  return v >= 1 && v <= 60 ? v : null;
}

export type PlanAnalysis = { monthlyAmount: number; months: number; surplus: number; income: number; fixedCommitments: number; avgMonthlyExpense: number; feasible: boolean; cutSuggestions: { name: string; suggestedCut: number }[]; extendedMonths: number; extendedMonthly: number; remaining: number };
export type WizardThink = { name: string; targetAmount: number; savedAmount: number; months: number; goalId: number | null };
export type WizardStepResult = { text: string; options?: HelpOption[]; next: WizardState | null; think?: WizardThink };

export function wizardStep(ov: OverviewData, w: WizardState, input: string): WizardStepResult {
  const q = input.trim();
  const n = normHelp(q);
  if (n === "cancelar" || n.startsWith("cancelar ")) return { text: "De acuerdo, lo dejamos por ahora. ¿En qué más le ayudo?", next: null };
  if (w.step === "motive") {
    const matched = ov.goals.find(g => {
      const gn = normHelp(g.name);
      if (gn.length < 3 || n.length < 3) return n === gn;
      return n === gn || n.includes(gn) || gn.includes(n);
    });
    if (matched) {
      const remaining = Math.round((matched.targetAmount - matched.savedAmount) * 100) / 100;
      if (remaining <= 0) return { text: `Su meta «${matched.name}» ya está cubierta: lleva ${money(matched.savedAmount)} de ${money(matched.targetAmount)}.`, next: null };
      return {
        text: `Su meta «${matched.name}» lleva ${money(matched.savedAmount)} de ${money(matched.targetAmount)}. ¿Para cuándo quiere tener el resto?`,
        options: [{ label: "3 meses", send: "3 meses" }, { label: "6 meses", send: "6 meses" }, { label: "12 meses", send: "12 meses" }, WIZARD_CANCEL],
        next: { step: "deadline", goalId: matched.id, goalName: matched.name, targetAmount: matched.targetAmount, savedAmount: matched.savedAmount, months: null },
      };
    }
    if (n.includes("meta nueva") || n.includes("nueva meta")) {
      return { text: "¿Cuánto quiere ahorrar?", options: [WIZARD_CANCEL], next: { step: "amount", goalId: null, goalName: "", targetAmount: null, savedAmount: 0, months: null } };
    }
    return { text: `«${q}» es una buena meta. ¿Cuánto quiere ahorrar para eso?`, options: [WIZARD_CANCEL], next: { step: "amount", goalId: null, goalName: q, targetAmount: null, savedAmount: 0, months: null } };
  }
  if (w.step === "amount") {
    const amount = wizardParseAmount(q);
    if (amount == null) return { text: "No entendí el monto. Escríbalo en pesos, por ejemplo 20000.", options: [WIZARD_CANCEL], next: w };
    const name = w.goalName || "Su meta";
    return {
      text: `Para ahorrar ${money(amount)} para «${name}», ¿en cuántos meses quiere lograrlo?`,
      options: [{ label: "3 meses", send: "3 meses" }, { label: "6 meses", send: "6 meses" }, { label: "12 meses", send: "12 meses" }, WIZARD_CANCEL],
      next: { step: "deadline", goalId: null, goalName: name, targetAmount: amount, savedAmount: 0, months: null },
    };
  }
  const months = wizardParseMonths(q);
  if (months == null) return { text: "¿En cuántos meses? Por ejemplo 6.", options: [{ label: "3 meses", send: "3 meses" }, { label: "6 meses", send: "6 meses" }, { label: "12 meses", send: "12 meses" }, WIZARD_CANCEL], next: w };
  return {
    text: "Déjeme calcularlo con sus datos…",
    next: null,
    think: { name: w.goalName, targetAmount: w.targetAmount ?? 0, savedAmount: w.savedAmount, months, goalId: w.goalId },
  };
}

// Parámetros del plan, con la misma cuenta del plan de ahorro del servidor.
export function wizardResultText(r: PlanAnalysis, goalName: string): string {
  if (r.remaining <= 0) return `Su meta «${goalName}» ya está cubierta.`;
  const parts = [`Para «${goalName}» necesita ahorrar ${money(r.monthlyAmount)} al mes durante ${r.months} meses.`];
  parts.push(`Su sobrante es de ${money(r.surplus)} al mes: entran ${money(r.income)}, sus compromisos son ${money(r.fixedCommitments)} y gasta en promedio ${money(r.avgMonthlyExpense)} al mes.`);
  if (r.feasible) parts.push("Con su sobrante le alcanza sin recortar nada.");
  else {
    parts.push(`Le faltan ${money(r.monthlyAmount - r.surplus)} al mes.`);
    if (r.cutSuggestions.length > 0) parts.push(`Si recorta ${r.cutSuggestions.map(c => `${money(c.suggestedCut)} en ${c.name}`).join(", ")}, lo cubre.`);
    if (r.extendedMonths > 0) parts.push(`O puede alargar el plazo a ${r.extendedMonths} meses con ${money(r.extendedMonthly)} al mes.`);
  }
  return parts.join(" ");
}

// ---- Avisos proactivos de Mike (siempre activo) ----
// El botón flotante «?» ya está visible en toda la app; además Mike
// interviene solo, con tarjetas suaves junto al botón (nunca un popup que
// bloquee, con × para descartar). Cada aviso se muestra una sola vez por
// sesión (sessionStorage "sf-help-nudges"): al abrir Movimientos o Gasto
// del día pregunta qué quiere registrar o subir; si un presupuesto está
// cerca de su límite o ya se pasó, avisa; si un plan de ahorro está en
// riesgo, sugiere revisarlo. El saludo de entrada sigue teniendo prioridad.
export type HelpNudgeAction = { label: string; ask?: string; go?: Tab };
export type HelpNudge = { id: string; text: string; actions: HelpNudgeAction[] };
export const HELP_NUDGES_KEY = "sf-help-nudges";
export function loadNudgeShown(): string[] {
  try {
    const raw = sessionStorage.getItem(HELP_NUDGES_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
export function markNudgeShown(id: string): void {
  try {
    const ids = loadNudgeShown();
    if (!ids.includes(id)) { ids.push(id); sessionStorage.setItem(HELP_NUDGES_KEY, JSON.stringify(ids)); }
  } catch { /* sin almacenamiento, el aviso puede repetirse */ }
}
export function pickHelpNudge(ov: OverviewData, tab: Tab, shown: string[]): HelpNudge | null {
  if (!ov.household) return null;
  const month = ov.summary.currentMonth;
  if (tab === "movimientos" && !shown.includes("register-movimientos")) {
    return { id: "register-movimientos", text: "¿Qué quiere registrar? Un gasto, un ingreso o un comprobante.", actions: [
      { label: "Un gasto", ask: "¿Cómo registro un gasto?" },
      { label: "Un ingreso", ask: "¿Cómo registro un ingreso?" },
      { label: "Un comprobante", ask: "¿Cómo leo un comprobante?" },
    ] };
  }
  if (tab === "personal" && !shown.includes("register-personal")) {
    return { id: "register-personal", text: "¿Qué quiere registrar? Un gasto, un ingreso o un comprobante.", actions: [
      { label: "Un gasto", ask: "¿Cómo registro el gasto del día?" },
      { label: "Un comprobante", ask: "¿Cómo leo un comprobante?" },
    ] };
  }
  const over = ov.budgets.filter(b => b.month === month && b.amount > 0 && b.pct >= 90).sort((a, b) => b.pct - a.pct)[0];
  if (over) {
    const id = `budget-${month}-${over.categoryId}`;
    if (!shown.includes(id)) {
      const name = catName(ov, over.categoryId);
      const text = over.pct >= 100
        ? `El presupuesto de ${name} ya se pasó: gastó ${money(over.spent)} de ${money(over.amount)}.`
        : `El presupuesto de ${name} está al ${over.pct}%: gastó ${money(over.spent)} de ${money(over.amount)}.`;
      return { id, text, actions: [{ label: "Ir a Presupuestos", go: "presupuestos" }] };
    }
  }
  const risky = goalLines(ov).find(g => g.status === "en riesgo" || g.status === "atrasada");
  if (risky) {
    const id = `goal-risk-${risky.id}`;
    if (!shown.includes(id)) {
      return { id, text: `Su plan de ahorro de «${risky.name}» está ${risky.status}. ¿Quiere revisarlo?`, actions: [{ label: "Ir a Metas", go: "metas" }] };
    }
  }
  return null;
}
