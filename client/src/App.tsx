import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./components/SafeArea";
import { readInviteToken, type InvitePreview } from "./components/AuthGate";
import { fileToBase64 } from "./lib/file";
import { checkReceiptDate, matchRule, normText, parseReceiptText, parseVoiceText, resolveReceiptCategory, suggestCategoryId } from "./lib/smart";
import type { ReceiptDateCheck } from "./lib/smart";
import type { ReceiptRead } from "./lib/smart";
import { readReceiptText, ocrStatusText, OcrError, warmUpOcr } from "./lib/ocr";
import { downloadTextFile, parseCsv, toCsv } from "./lib/csv";
import { pinCheck, pinIsSet, pinLock, pinMarkUnlocked, pinRemove, pinSet, pinUnlocked } from "./lib/pin";
import { canSeeMovementRow, fmtMonthShort, groupMovementsByAccount, groupSplitMovements, isSplitGroup, monthMovements, movementTitle, requiredAccountNotice, requiredGoalAccountNotice, requiredGoalReturnAccountNotice, requiredInitialAccountNotice, sortMovementsByDate, type IncExpDetailView } from "./lib/movementsList";
import { readStoredProfile, resolveActiveProfile, writeStoredProfile } from "./lib/activeProfile";
import { clearStoredHousehold, readStoredHousehold, writeStoredHousehold } from "./lib/activeHousehold";
import { HouseholdSwitcher } from "./components/HouseholdSwitcher";
import { categoryCounts, guideCounts, invitationCounts, sumBudgets, sumCashCounts, sumContributions, sumGoals, sumMonthMovements } from "./lib/cardSummaries";
import { exceededCategoryName, findTandaForNotification, visibleNotifications } from "./lib/notifications";
import { MovementsFilter } from "./components/MovementsFilter";
import { DEFAULT_MOVEMENTS_FILTER, filterMovements, type MovementsFilterValue } from "./lib/movementsFilter";
import { buildBalanceBreakdown } from "./lib/balanceBreakdown";
import { pickTipGoal, planCumulativeContributed, planMonthShortfall, planPriorSurplus, pickPinnedGoal, pickPinnedFund, fundPct, fundNeedPerMonth, fundPlan, totalMonthShortfall, readFundFrequency, writeFundFrequency, type FundFrequency } from "./lib/goalMonth";
import { accountSummaryRows, type AccountSummary } from "./lib/accountSummary";
import { MoneyLocationModal } from "./components/MoneyLocationModal";
import { IncExpDetailModal } from "./components/IncExpDetailModal";
import { PlanFinancieroWizard } from "./components/PlanFinancieroWizard";
import { HomeMovementsCard } from "./components/HomeMovementsCard";
import { CollapsibleCard } from "./components/CollapsibleCard";
import { LegalDocumentsView } from "./components/LegalDocs";
import { AboutSection } from "./components/AboutSection";
import { money, money2, fmtDate, todayISO, getHouseholdCurrency, setHouseholdCurrency } from "./lib/format";
import { accountRateNotice, accountRateNoticePending, CURRENCIES, currencyName, findStoredRate, fxLabel, moneyIn, movementRateNotice, previewEquivalent, suggestCurrency, type ExchangeRateInfo, type HouseholdCurrency } from "./lib/currency";
import { CurrencyPicker } from "./components/CurrencyPicker";
import { Label, inputCls, btnPrimary, btnGold, btnGhost, btnDanger, Empty } from "./lib/uiShared";
import { OcrDetail } from "./components/OcrDetail";
import { LoadingSplash } from "./components/LoadingSplash";
import { TandasModule } from "./components/TandasModule";
import type { TandaFormValues, TandaKind } from "./components/TandaForm";
import { HomeTandasCard } from "./components/HomeTandasCard";
import { GenericHouseholdInvite } from "./components/GenericHouseholdInvite";
import { HouseholdCode } from "./components/HouseholdCode";
import { JoinHouseholdByCode } from "./components/JoinHouseholdByCode";
import { JoinRequestRow } from "./components/JoinRequestRow";
import { UpdateBellNotice } from "./components/UpdateBellNotice";
import { InstallCard, InstallStepsDialog, shouldAutoShowInstallGuide } from "./components/InstallCard";
import { FeedbackReviewList } from "./components/FeedbackReview";
import type { FeedbackState } from "./lib/feedback";
import type { TandaDetailDeps, TandaInviteSend as InviteSend, TandaProofReview } from "./components/TandaDetail";
import { DrawerMenu, type DrawerMenuSection } from "./components/DrawerMenu";
import { QuickBar, QUICK_BAR_BOTTOM_PX, QUICK_BAR_HEIGHT_PX } from "./components/QuickBar";
import { DRAWER_GROUPS, orderDrawerTabs } from "./lib/drawerOrder";
import { logUsageEvent, usageActionLabel, usageModuleLabel } from "./lib/usageLog";
import { readQuickShortcuts, toggleQuickShortcut, writeQuickShortcuts, type QuickShortcutId } from "./lib/quickBar";
import { applicableBudget, HELP_FAQS, dynamicHelpFaqs, findHelpAnswer, frequentQuestions, loadHelpLearning, loadNudgeShown, markNudgeShown, matchSavingsWizard, pickHelpNudge, pickOpeningMessage, predictHelp, recordHelpLearning, recordHelpQuestion, reviewMovement, wizardMotive, wizardResultText, wizardStep, type HelpFaq, type HelpMsg, type HelpNudge, type OverviewData, type WizardState } from "./lib/helpDynamic";
import { applyMovementChange, type MovementChange, type SavedMovement } from "./lib/optimisticOverview";
import { api, fetchSession, signOut } from "./api";
import { PdfViewer } from "./components/PdfViewer";
import guiaResumenPdf from "./assets/guia-resumen-registro.pdf";
import guiaPlanificacionPdf from "./assets/guia-planificacion.pdf";
import guiaDecisionesPdf from "./assets/guia-decisiones-patrimonio.pdf";
import guiaTandasPdf from "./assets/guia-tandas.pdf";
import guiaConfiguracionPdf from "./assets/guia-configuracion-ayuda.pdf";
import { APP_VERSION } from "./version";
import { APP_UPDATE_EVENT, APP_UPDATE_GONE_EVENT, UPDATE_APPLY_TIMEOUT_MS, applyAppUpdate, checkForAppUpdate, isUpdateAvailable } from "./serviceWorkerUpdate";
import { clearDeferredInstallPrompt, consumeDeferredInstallPrompt } from "./installPrompt";

export type Tab = "inicio"|"personal"|"tandas"|"movimientos"|"cuentas"|"categorias"|"presupuestos"|"fondos"|"aportaciones"|"metas"|"acuerdos"|"patrimonio"|"perfiles"|"hogar"|"seguridad"|"guia"|"desarrollador"|"legales"|"recurrentes";
const TABS: {id:Tab;label:string}[] = [
  {id:"inicio",label:"Inicio"},{id:"personal",label:"Personal"},{id:"movimientos",label:"Movimientos"},{id:"recurrentes",label:"Gastos recurrentes"},{id:"cuentas",label:"Cuentas"},{id:"presupuestos",label:"Presupuestos"},
  {id:"fondos",label:"Fondos"},{id:"aportaciones",label:"Aportaciones"},{id:"metas",label:"Metas"},{id:"acuerdos",label:"Acuerdos"},{id:"tandas",label:"Tandas"},
  {id:"patrimonio",label:"Patrimonio"},{id:"categorias",label:"Categorías"},{id:"perfiles",label:"Perfiles"},{id:"hogar",label:"Hogar"},{id:"seguridad",label:"Seguridad"},{id:"guia",label:"Guía de uso"},{id:"desarrollador",label:"Desarrollador"},{id:"legales",label:"Documentos legales"},
];
// Los módulos se agrupan por función: varios se desprenden de otros (Aportaciones se calcula
// desde Movimientos; Fondos son apartados dentro de Cuentas; Presupuestos vigilan Categorías).
const MODULE_GROUPS: {title:string; tabs:Tab[]}[] = [
  {title:"Resumen y registro diario", tabs:["inicio","personal","movimientos","recurrentes","cuentas"]},
  {title:"Planificación", tabs:["presupuestos","fondos","aportaciones","metas"]},
  {title:"Decisiones y patrimonio", tabs:["acuerdos","patrimonio"]},
  {title:"Tandas", tabs:["tandas"]},
  {title:"Configuración y ayuda", tabs:["categorias","perfiles","hogar","seguridad","guia","legales"]},
];
// Guía en PDF de cada segmento: se abre dentro de la aplicación, en la pestaña Guía de uso.
const GUIDE_PDF_BY_GROUP: Record<string,string> = {
  "Resumen y registro diario": guiaResumenPdf,
  "Planificación": guiaPlanificacionPdf,
  "Decisiones y patrimonio": guiaDecisionesPdf,
  "Tandas": guiaTandasPdf,
  "Configuración y ayuda": guiaConfiguracionPdf,
};
function fmtMonth(ym:string|null){ if(!ym) return ""; const [y=2026,m=1]=ym.split("-").map(Number); return new Date(y,(m||1)-1,1).toLocaleDateString("es-MX",{month:"long",year:"numeric"}); }
function monthNow(){ return todayISO().slice(0,7); }
const TYPE_LABEL: Record<string,string> = { income:"Ingreso", expense:"Gasto", transfer:"Transferencia", debt_payment:"Pago de deuda", bank:"Bancaria", cash:"Efectivo", credit:"Tarjeta de crédito", investment:"Inversión", loan:"Préstamo" };
// Iconos de línea (SVG, sin emojis) por categoría, con fondo transparente:
// solo se ven en las gráficas y sus leyendas, con el trazo sobre el fondo de la app.
// Convierte cualquier foto (incluida WebP) a JPEG reducido para la lectura automática del comprobante.
async function imageFileToJpeg(file:File): Promise<{dataBase64:string;mimeType:string;preview:string}>{
  const url=URL.createObjectURL(file);
  const img=new Image();
  await new Promise<void>((res,rej)=>{ img.onload=()=>res(); img.onerror=()=>rej(new Error("No se pudo leer la imagen seleccionada.")); img.src=url; });
  const max=1600; const scale=Math.min(1, max/Math.max(img.width||1, img.height||1));
  const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round((img.width||1)*scale)); canvas.height=Math.max(1,Math.round((img.height||1)*scale));
  const cx=canvas.getContext("2d"); if(!cx) throw new Error("No fue posible procesar la imagen en este dispositivo.");
  cx.drawImage(img,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL("image/jpeg",0.85);
  return { dataBase64: dataUrl.split(",")[1]||"", mimeType:"image/jpeg", preview:url };
}

// Gama propia de la dona de Inicio (propuesta Unslop): sin verde ni rojo,
// que ya son los colores del flujo de dinero. Los seis primeros son los de
// la propuesta; el resto son valores ya usados en el proyecto.
const DONUT_PALETTE_INICIO=["#00C2B5","#A34A6B","#2E86AB","#D97A3D","#7C5CBF","#C9A227","#4A9B8E","#5B7FA6","#8A6D3B","#3E7CB1"];
// Las gráficas (Recharts, el trozo mayor del JS) se cargan bajo demanda:
// el paquete inicial no las trae; se descargan al abrir Inicio o Personal,
// las únicas vistas que las usan («Ver gráficas» solo navega a Inicio).
// El marcador ocupa el mismo alto que la gráfica para que la tarjeta no
// cambie de tamaño mientras se descarga el trozo.
const CategoryChart = lazy(()=>import("./components/Charts").then((m)=>({default:m.CategoryChart})));
const MonthlyChart = lazy(()=>import("./components/Charts").then((m)=>({default:m.MonthlyChart})));
const DonutFallback = <div className="mt-2" aria-hidden="true"><div className="mx-auto w-[220px] h-[220px] md:w-60 md:h-60" /><div className="mt-2 h-[30px]" /></div>;
const BarsFallback = <div className="mt-2 h-[170px]" aria-hidden="true" />;
function Help({children}:{children:React.ReactNode}){ return <p className="text-[13px] leading-snug text-[var(--dim)] bg-[var(--surface2)] rounded-xl px-3 py-2">{children}</p>; }
function focusField(id:string){ const el=document.getElementById(id); el?.scrollIntoView({behavior:"smooth",block:"center"}); (el as HTMLElement|null)?.focus(); }

// ---- Instalación en el celular (aplicación instalable, pensada primero para el teléfono) ----
// El manifiesto (generado al cargar en main.tsx, con las rutas reales de los iconos) y las
// metaetiquetas de index.html declaran la aplicación como instalable: icono propio, pantalla
// completa y sin barra del navegador.
// En Android/Chrome el navegador ofrece el evento beforeinstallprompt y el botón lo dispara;
// el evento se captura temprano en installPrompt.ts (main.tsx lo registra antes de que
// React monte), porque Chrome lo dispara una sola vez por carga y puede llegar antes que
// el oyente de App; si el navegador no lo ofrece (por ejemplo, porque el aviso se
// descartó antes), el botón muestra los pasos manuales exactos.
// en iPhone la instalación se realiza desde el menú Compartir de Safari (Apple no ofrece
// instalación con un solo toque), por lo que se muestran los pasos exactos.
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}
// ---- Mike (respuestas preparadas + respuestas dinámicas con datos reales) ----
// Botón flotante con una estrella dorada, sin nombre visible, en toda la
// app mientras el chat está cerrado, en modo Personal y Familiar. La
// estrella es estática y se arrastra: el usuario la toca y la mueve con el
// dedo (o el ratón) a cualquier punto de la pantalla y queda ahí; la
// posición se guarda en el dispositivo (localStorage "sf-help-fab-pos").
// Un toque abre el chat; arrastrar no lo abre. Nada aparece solo: no hay
// burbuja de saludo ni avisos que salgan en automático. Cuando Mike tiene
// algo pendiente (qué quiere registrar, presupuesto cerca de su límite,
// plan de ahorro en riesgo), la estrella lleva un foco encima, sin
// animación, y nada más. Al tocarlo abre una ventanita de chat que
// responde dudas de uso con una base de respuestas preparadas por palabras
// clave (sin claves ni servicios de pago) y preguntas dinámicas calculadas
// en el dispositivo con los datos del hogar (en qué se gasta de más, dónde
// ahorrar, cómo va la meta, cuánto queda). Al abrir, el chat abre con un
// solo mensaje que cambia cada vez: ofrece ayuda o da un tip o una solución
// con datos reales, sin repetir el anterior; al cerrar, la conversación se
// borra para que al abrir de nuevo no se repita ni se apile el mismo. Cada
// respuesta es corta, en tono formal de usted, y trae un botón que lleva
// directo al lugar cuando la vista ya tiene navegación (onGo). La lógica
// vive en ./lib/helpDynamic. Sin `open`/`onOpenChange` se maneja solo (así
// lo usa el asistente de creación de espacio). Con `open`/`onOpenChange`
// lo controla la app. Con `hidden` (menú abierto) el botón se oculta,
// porque el cajón ya tiene su entrada a Mike.
// Además Mike es un asistente de ahorro conversacional: si el usuario
// pregunta cómo ahorrar más, no contesta de una vez, pregunta el motivo (con
// sus metas como opciones), el monto y el plazo, y piensa con sus datos
// reales para darle los parámetros (aporte mensual, recortes por categoría,
// plazo) con un botón para armar el plan en Metas.
// Posición de la estrella de Mike. Se guarda en el dispositivo
// (localStorage "sf-help-fab-pos") como coordenadas en píxeles desde la
// esquina superior izquierda de la ventana; null = posición por defecto
// (abajo a la derecha, POR ENCIMA de la barra del menú rápido).
// Siempre se limita a la ventana visible, para que la estrella nunca
// quede fuera de la pantalla ni bajo la barra del sistema ni bajo la
// barra del menú rápido: su borde inferior queda por encima del borde
// superior de la barra, con un margen de 8 px (FAB_ABOVE_BAR_GAP_PX).
// Si la posición guardada la dejaría debajo de la barra (por ejemplo,
// guardada antes de que existiera la barra), al cargar se sube sola
// por encima: loadFabPos aplica el mismo límite.
const FAB_POS_KEY = "sf-help-fab-pos";
const FAB_SIZE = 48;
const FAB_ABOVE_BAR_GAP_PX = 8;
// Reserva inferior de la estrella: margen inferior de la barra +
// alto de la barra + margen entre la barra y la estrella.
const FAB_BOTTOM_RESERVE_PX = QUICK_BAR_BOTTOM_PX + QUICK_BAR_HEIGHT_PX + FAB_ABOVE_BAR_GAP_PX; // 72
// Área segura inferior del dispositivo (la muesca o barra del sistema):
// se lee del navegador con una sonda (env() solo existe en CSS) y se
// suma a la reserva; sin área segura vale 0. Se guarda en caché y se
// vuelve a medir al girar o cambiar el tamaño de la ventana.
let cachedSafeAreaBottom: number | null = null;
function safeAreaBottomPx(): number {
  if (cachedSafeAreaBottom !== null) return cachedSafeAreaBottom;
  let v = 0;
  try {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;bottom:0;padding-bottom:env(safe-area-inset-bottom, 0px);visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const n = parseFloat(window.getComputedStyle(probe).paddingBottom || "");
    document.body.removeChild(probe);
    if (isFinite(n) && n > 0) v = n;
  } catch { v = 0; }
  cachedSafeAreaBottom = v;
  return v;
}
function clampFabPos(x: number, y: number): { x: number; y: number } {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 844;
  return { x: Math.max(8, Math.min(x, vw - FAB_SIZE - 8)), y: Math.max(8, Math.min(y, vh - FAB_SIZE - FAB_BOTTOM_RESERVE_PX - safeAreaBottomPx())) };
}
function loadFabPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof v.x !== "number" || typeof v.y !== "number" || !isFinite(v.x) || !isFinite(v.y)) return null;
    return clampFabPos(v.x, v.y);
  } catch { return null; }
}
export function HelpAssistant({ onGo, open: controlledOpen, onOpenChange, dynamicFaqs, overview, nudge, hidden }: { onGo?: (tab: Tab) => void; open?: boolean; onOpenChange?: (v: boolean) => void; dynamicFaqs?: HelpFaq[]; overview?: OverviewData | null; nudge?: HelpNudge | null; hidden?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const tipAddedRef = useRef(false);
  // Al cerrar, la conversación se borra (mensajes, asistente de ahorro y
  // caja de texto): así, al abrir de nuevo, Mike dice un mensaje distinto
  // y nunca se repite ni se apila el mismo. Antes los mensajes se quedaban
  // y cada apertura agregaba el mismo tip, por eso salía 3 veces seguidas.
  const setOpen = (v: boolean) => { if (!v) { tipAddedRef.current = false; setMsgs([]); setWizard(null); setInput(""); } if (onOpenChange) onOpenChange(v); else setInternalOpen(v); };
  const [input, setInput] = useState("");
  // El chat abre con un solo mensaje de apertura (ver el efecto de abajo),
  // sin preguntas listadas: solo la caja de texto y, mientras el usuario
  // escribe, las predicciones.
  const [msgs, setMsgs] = useState<HelpMsg[]>([]);
  // Al abrir el chat, Mike dice UN mensaje que cambia cada vez: ofrece ayuda
  // o da un tip o una solución con datos reales (ver pickOpeningMessage en
  // ./lib/helpDynamic, que nunca repite el mensaje anterior). Se agrega
  // como único mensaje de apertura: aunque el efecto volviera a correr, no
  // se apila otro encima.
  useEffect(() => {
    if (!open || !overview || tipAddedRef.current) return;
    const msg = pickOpeningMessage(overview);
    if (!msg) return;
    tipAddedRef.current = true;
    setMsgs([{ from: "bot", text: msg }]);
  }, [open, overview]);
  const [freq, setFreq] = useState<Record<string, number>>(() => frequentQuestions(loadHelpLearning()));
  // Asistente de ahorro conversacional: recuerda el motivo, el monto y el
  // plazo en la memoria del chat y piensa con los datos reales.
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const allFaqs = useMemo(() => [...HELP_FAQS, ...(dynamicFaqs ?? [])], [dynamicFaqs]);
  // Preguntas predictivas: solo aparecen mientras el usuario escribe
  // (predictHelp devuelve [] con menos de 2 caracteres). Al abrir el chat
  // no se lista nada: ni las dinámicas ni las de uso. Al escribir "gasto",
  // "ahorr" o "meta" salen las que coinciden, incluidas las dinámicas con
  // cifras reales y la entrada al asistente de ahorro ("¿Cómo ahorro más?").
  const suggestions = useMemo(()=> wizard ? [] : predictHelp(input, allFaqs, 5, freq), [input, allFaqs, freq, wizard]);
  const ask = (text: string) => {
    const q = text.trim(); if (!q) return;
    setInput("");
    // Asistente de ahorro activo: la respuesta avanza la conversación.
    if (wizard && overview?.household) {
      const res = wizardStep(overview, wizard, q);
      setMsgs(m => [...m, { from: "user", text: q }, { from: "bot", text: res.text, options: res.options }]);
      if (res.think) {
        setWizard(null);
        const think = res.think;
        void api.analyzeGoalPlan({ householdId: overview.household.id, goalId: think.goalId ?? undefined, name: think.name, targetAmount: think.targetAmount, savedAmount: think.savedAmount, months: think.months }).then(
          r => setMsgs(m => [...m, { from: "bot", text: wizardResultText(r, think.name), go: onGo ? "metas" : undefined, goLabel: "Armar el plan en Metas" }]),
          () => setMsgs(m => [...m, { from: "bot", text: "No pude calcularlo ahora. Puede armar el plan en Metas, en Armar plan de ahorro.", go: onGo ? "metas" : undefined, goLabel: "Ir a Metas" }]),
        );
      } else {
        setWizard(res.next);
      }
      recordHelpQuestion(q);
      setFreq(frequentQuestions(loadHelpLearning()));
      return;
    }
    // Nuevo asistente de ahorro: «cómo ahorrar más», «quiero ahorrar»…
    if (overview?.household && matchSavingsWizard(q)) {
      const start = wizardMotive(overview);
      setMsgs(m => [...m, { from: "user", text: q }, { from: "bot", text: start.text, options: start.options }]);
      setWizard({ step: "motive", goalId: null, goalName: "", targetAmount: null, savedAmount: 0, months: null });
      recordHelpQuestion(q);
      setFreq(frequentQuestions(loadHelpLearning()));
      return;
    }
    const found = findHelpAnswer(q, allFaqs);
    const reply: HelpMsg = found
      ? { from: "bot", text: found.a, go: found.go, goLabel: found.goLabel }
      : { from: "bot", text: "No encontré la respuesta a eso. Pruebe con otras palabras o revise la Guía de uso.", go: onGo ? "guia" : undefined, goLabel: "Ir a Guía de uso" };
    setMsgs(m => [...m, { from: "user", text: q }, reply]);
    recordHelpQuestion(q);
    setFreq(frequentQuestions(loadHelpLearning()));
  };
  // La estrella se arrastra con el dedo (o el ratón): al soltar queda donde
  // el usuario la dejó y la posición se guarda en el dispositivo. Un toque
  // (menos de 8 px de movimiento) abre el chat; arrastrar no lo abre. La
  // estrella es estática: no rebota ni pulsa. El foco encima es solo un
  // aviso estático de que Mike tiene una idea, una pregunta o un aviso.
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => loadFabPos());
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const fabDrag = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const fabClickGuard = useRef(false);
  const onFabPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = fabRef.current?.getBoundingClientRect();
    const orig = fabPos ?? (r ? { x: r.left, y: r.top } : { x: 0, y: 0 });
    fabDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: orig.x, origY: orig.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura, el arrastre sigue con los eventos del botón */ }
  };
  const onFabPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) d.moved = true;
    if (!d.moved) return;
    setFabPos(clampFabPos(d.origX + dx, d.origY + dy));
  };
  const onFabPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDrag.current;
    fabDrag.current = null;
    if (!d) return;
    if (d.moved) {
      fabClickGuard.current = true;
      const p = clampFabPos(d.origX + (e.clientX - d.startX), d.origY + (e.clientY - d.startY));
      setFabPos(p);
      try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento, la posición no se guarda */ }
    }
  };
  const onFabPointerCancel = () => { fabDrag.current = null; };
  const onFabClick = () => {
    if (fabClickGuard.current) { fabClickGuard.current = false; return; }
    setOpen(true);
  };
  // Si la ventana cambia de tamaño (giro del celular), la posición guardada
  // se limita de nuevo a la ventana visible (el área segura puede cambiar
  // al girar, por eso se vuelve a medir).
  useEffect(() => {
    const onResize = () => { cachedSafeAreaBottom = null; setFabPos(cur => (cur ? clampFabPos(cur.x, cur.y) : cur)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // La estrella no lleva nombre ni burbuja: nada aparece solo. El foco
  // encima solo indica que Mike tiene algo pendiente (`nudge`); al tocar
  // la estrella se abre el chat, donde está el mensaje de apertura.
  const hasIdea = Boolean(nudge);
  return (
    <>
      {!open && !hidden && (
        <div className="fixed z-50 w-12 h-12" style={fabPos ? { left: fabPos.x, top: fabPos.y } : { right: 16, bottom: `calc(${FAB_BOTTOM_RESERVE_PX}px + env(safe-area-inset-bottom, 0px))` }}>
          <button ref={fabRef} type="button" data-help-fab aria-label={hasIdea ? "Abrir a Mike: tengo una idea para usted" : "Abrir a Mike"} onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerUp} onPointerCancel={onFabPointerCancel} onClick={onFabClick} className="help-fab-static relative w-12 h-12 rounded-full bg-[var(--fab)] text-[var(--fab-text)] shadow-xl flex items-center justify-center shrink-0">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6 pointer-events-none" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
            {hasIdea && (
              <span data-help-badge="idea" aria-hidden="true" className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--fab-text)] text-[var(--fab)] border-2 border-[var(--surface)] shadow flex items-center justify-center pointer-events-none">
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
              </span>
            )}
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Mike" onClick={()=>setOpen(false)}>
          <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-[var(--border)]">
              <div><h2 className="font-display font-bold text-lg">Mike</h2><p className="text-xs text-[var(--dim)]">Su ayudante para su dinero.</p></div>
              <button type="button" aria-label="Cerrar a Mike" onClick={()=>setOpen(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {msgs.map((m,i)=>(
                <div key={i} className={`flex ${m.from==="user"?"justify-end":"justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from==="user"?"bg-[var(--accent)] text-[var(--accent-text)]":"bg-[var(--surface2)]"}`}>
                    <p>{m.text}</p>
                    {m.from==="bot" && m.go && onGo && <button type="button" className={btnGhost+" mt-2"} onClick={()=>{ setOpen(false); onGo(m.go!); }}>{m.goLabel || "Ir"}</button>}
                    {m.from==="bot" && m.options && i===msgs.length-1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.options.map(o=><button key={o.label} type="button" className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[13px] font-semibold" onClick={()=>ask(o.send)}>{o.label}</button>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {suggestions.length > 0 && (
              <div className="px-3 pb-2">
                <p className="text-[11px] font-bold tracking-widest text-[var(--dim)] mb-1.5">PREGUNTAS RELACIONADAS</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map(s=><button key={s.q} type="button" className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-semibold" onClick={()=>ask(s.q)}>{s.q}</button>)}
                </div>
              </div>
            )}
            <form className="flex gap-2 p-3 border-t border-[var(--border)]" onSubmit={(e:FormEvent)=>{ e.preventDefault(); ask(input); }}>
              <input aria-label="Escriba su duda para Mike" className={inputCls+" flex-1 min-w-0"} placeholder="Escriba su duda…" value={input} onChange={e=>setInput(e.target.value)} />
              <button type="submit" className={btnPrimary} disabled={!input.trim()}>Enviar</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Opiniones de testers (segunda etapa + canal de dudas y mejoras) ----
// El formulario vive en client/src/components/TesterFeedbackForm.tsx
// (main.tsx lo muestra en ?feedback=1; dentro de la app se abre en modo
// integrado desde el menú «Enviar comentarios»). Se importa aquí para el
// modal y se reexporta para no tocar main.tsx.
import { TesterFeedbackForm } from "./components/TesterFeedbackForm";
export { TesterFeedbackForm };

export function App(){
  const qc=useQueryClient();
  const [tab,setTab]=useState<Tab>("inicio"); const [menuOpen,setMenuOpen]=useState(false); const [guidePdf,setGuidePdf]=useState<{title:string;src:string}|null>(null);
  // Atajos del menú rápido (estrellas del cajón, 2026-11-24): la lista
  // vive en el dispositivo (localStorage «sf-menu-rapido»); sin nada
  // guardado trae Nuevo, Metas y Presupuestos.
  const [quickShortcuts,setQuickShortcuts]=useState<QuickShortcutId[]>(()=>readQuickShortcuts());
  // Menú abierto: se bloquea el desplazamiento de la app de atrás; solo el menú se desplaza.
  useEffect(()=>{
    if(!menuOpen) return;
    const prevBody=document.body.style.overflow;
    const prevHtml=document.documentElement.style.overflow;
    document.body.style.overflow="hidden";
    document.documentElement.style.overflow="hidden";
    return ()=>{ document.body.style.overflow=prevBody; document.documentElement.style.overflow=prevHtml; };
  },[menuOpen]);
  // Grupos del menú plegables: al abrir el cajón solo queda abierto el grupo
  // del módulo actual (Configuración si está en Guía de uso), para que el
  // menú se vea corto. Un grupo abierto por toque del usuario queda como lo
  // dejó hasta reabrir.
  const [openDrawerGroups, setOpenDrawerGroups] = useState<Record<string, boolean>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [vistaOpen, setVistaOpen] = useState(false);
  useEffect(()=>{ if(menuOpen){ setOpenDrawerGroups({}); setConfigOpen(tab==="guia" || tab==="seguridad" || tab==="legales"); setVistaOpen(false); } },[menuOpen]);
  // Instalación en el celular: se captura el evento del navegador y se detecta si ya está instalada.
  const [installPrompt,setInstallPrompt]=useState<BeforeInstallPromptEvent|null>(null); const [appInstalled,setAppInstalled]=useState<boolean>(()=>detectStandalone()); const [installDismissed,setInstallDismissed]=useState<boolean>(()=>{ try{ return localStorage.getItem("sf-install-dismissed")==="1"; }catch{ return false; } });
  const [installStepsOpen,setInstallStepsOpen]=useState(() => shouldAutoShowInstallGuide(detectStandalone()));
  const [chartsSeen,setChartsSeen]=useState<boolean>(()=>{ try{ return localStorage.getItem("sf-guide-charts-seen")==="1"; }catch{ return false; } });
  useEffect(()=>{
    // El evento puede haber llegado antes de montar (se capturó temprano en
    // installPrompt.ts); se toma al montar para no perderlo.
    const early = consumeDeferredInstallPrompt();
    if (early) setInstallPrompt(early);
    const onPrompt=(e:Event)=>{ e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled=()=>{ setAppInstalled(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt",onPrompt);
    window.addEventListener("appinstalled",onInstalled);
    return ()=>{ window.removeEventListener("beforeinstallprompt",onPrompt); window.removeEventListener("appinstalled",onInstalled); };
  },[]);
  const doInstall=async()=>{ if(!installPrompt) return; try{ await installPrompt.prompt(); const choice=await installPrompt.userChoice; if(choice.outcome==="accepted") setAppInstalled(true); else setInstallStepsOpen(true); }catch{ /* el navegador no ofreció la instalación; quedan los pasos manuales */ setInstallStepsOpen(true); } clearDeferredInstallPrompt(); setInstallPrompt(null); };
  const handleInstallClick=()=>{ if(installPrompt){ void doInstall(); } else { setInstallStepsOpen(true); } };
  const dismissInstall=()=>{ setInstallDismissed(true); try{ localStorage.setItem("sf-install-dismissed","1"); }catch{} };
  // Aviso de actualización: cuando el service worker nuevo queda en espera,
  // la campanilla muestra el aviso con el botón Actualizar (es la única
  // vía para actualizar). Al actualizar solo cambia el código; la sesión
  // y los datos no se tocan.
  const [darkMode,setDarkMode]=useState(()=>{ try{ return document.documentElement.classList.contains("dark"); }catch{ return false; } });
  // Cambia el tema y guarda la elección ("sf-theme"); sin elección guardada
  // la app arranca en modo oscuro (main.tsx). Se usa desde Configuración.
  // También actualiza el theme-color de la barra de estado, para que en
  // claro la banda superior no quede negra (ver main.tsx).
  const setThemeMode=(next:boolean)=>{ setDarkMode(next); try{ localStorage.setItem("sf-theme", next?"dark":"light"); }catch{} try{ document.documentElement.classList.toggle("dark", next); }catch{} try{ document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next?"#151515":"#EEE3CC"); }catch{} };
  const [updateAvailable,setUpdateAvailable]=useState(false); const [updateApplying,setUpdateApplying]=useState(false); const [updateFailed,setUpdateFailed]=useState(false); const [updateChecking,setUpdateChecking]=useState(false); const [updateCheckMsg,setUpdateCheckMsg]=useState<string|null>(null);
  // Tiempo límite para que la recarga llegue tras pulsar Actualizar:
  // si no llega, el botón vuelve a servir con «Reintentar».
  const updateApplyTimerRef=useRef<number|null>(null);
  useEffect(()=>()=>{ if(updateApplyTimerRef.current) window.clearTimeout(updateApplyTimerRef.current); },[]);
  // Aplica la actualización del botón de la campanilla. Si ya no hay
  // versión en espera, el aviso se oculta y se dice que ya está al día
  // (antes el botón se quedaba en «Actualizando…» para siempre).
  const handleApplyUpdate=async()=>{
    setUpdateFailed(false);
    setUpdateApplying(true);
    const result=await applyAppUpdate();
    if(result==="no-update"){
      setUpdateApplying(false);
      setUpdateAvailable(false);
      setUpdateCheckMsg("Ya tiene la versión más reciente.");
      return;
    }
    if(updateApplyTimerRef.current) window.clearTimeout(updateApplyTimerRef.current);
    updateApplyTimerRef.current=window.setTimeout(()=>{
      setUpdateApplying(false);
      setUpdateFailed(true);
    }, UPDATE_APPLY_TIMEOUT_MS);
  };
  useEffect(()=>{
    const onUpdate=()=>setUpdateAvailable(true);
    // La actualización en espera ya no existe: el aviso se oculta y,
    // si el botón estaba en «Actualizando…», vuelve a servir.
    const onUpdateGone=()=>{ setUpdateAvailable(false); setUpdateApplying(false); setUpdateFailed(false); };
    window.addEventListener(APP_UPDATE_EVENT,onUpdate);
    window.addEventListener(APP_UPDATE_GONE_EVENT,onUpdateGone);
    // Aviso "pegajoso": si el worker nuevo ya quedó en espera antes de
    // que este oyente se montara, el aviso no se pierde hasta la siguiente
    // revisión. También se revisa al abrir la app, por si hay una versión
    // nueva esperando desde antes.
    if(isUpdateAvailable()) setUpdateAvailable(true);
    void checkForAppUpdate();
    return ()=>{ window.removeEventListener(APP_UPDATE_EVENT,onUpdate); window.removeEventListener(APP_UPDATE_GONE_EVENT,onUpdateGone); };
  },[]);
  // Correo de la sesión actual: solo el dueño de la app (Heriberto) ve el
  // registro de usuarios de la app y el módulo Desarrollador; el servidor
  // vuelve a verificarlo en cada consulta.
  const [myEmail,setMyEmail]=useState("");
  useEffect(()=>{ let alive=true; void fetchSession().then((u)=>{ if(alive) setMyEmail((u?.email||"").trim().toLowerCase()); }).catch(()=>{}); return ()=>{ alive=false; }; },[]);
  const isAppOwner = myEmail === "heribertocvazquez@gmail.com";
  // Secciones plegables de Hogar y del módulo Desarrollador: nacen plegadas
  // para que Hogar no ocupe toda la pantalla al entrar.
  const [activityOpen,setActivityOpen]=useState(false);
  const [quickGuideOpen,setQuickGuideOpen]=useState(false);
  const [updatesOpen,setUpdatesOpen]=useState(false);
  const [devFeedbackOpen,setDevFeedbackOpen]=useState(false);
  const [devUsersOpen,setDevUsersOpen]=useState(false);
  const [devUsageOpen,setDevUsageOpen]=useState(false);
  const [usageDetailUser,setUsageDetailUser]=useState<string|null>(null);
  const checkUpdatesManually=async()=>{
    setUpdateChecking(true); setUpdateCheckMsg(null);
    const r=await checkForAppUpdate();
    setUpdateChecking(false);
    if(r==="update"){ setUpdateAvailable(true); setUpdateCheckMsg("Hay una nueva versión. Pulse Actualizar en la campanilla."); }
    else if(r==="latest"){ setUpdateCheckMsg("Ya tiene la versión más reciente."); }
    else { setUpdateCheckMsg("No se pudo revisar la actualización."); }
  };
  const [currentProfileId,setCurrentProfileId]=useState<number|null>(()=>readStoredProfile().id);
  // Al elegir un perfil se guarda también con qué cuenta se eligió, para
  // que una elección hecha con otra cuenta no se herede al entrar.
  const pickProfile=(id:number|null)=>{ setCurrentProfileId(id); writeStoredProfile(id, myEmail); };
  // Hogar activo (selector «Cambiar de hogar»): la elección guardada del
  // dispositivo, atada a la cuenta con la marca «sf-household-user» (mismo
  // patrón que el perfil). Sin elección, el despachador toma la membresía
  // más antigua. Al cambiar, todo se recarga para ese hogar (la consulta
  // del panorama lleva el hogar en su clave).
  const [activeHouseholdId,setActiveHouseholdId]=useState<number|null>(()=>readStoredHousehold().id);
  const pickHousehold=(id:number)=>{ setMenuOpen(false); if(id===activeHouseholdId) return; setActiveHouseholdId(id); writeStoredHousehold(id, myEmail); setTab("inicio"); };
  // Cuando la sesión ya cargó, una elección guardada con otra cuenta no
  // se hereda: se borra y se vuelve al hogar más antiguo de esta cuenta.
  useEffect(()=>{
    if(!myEmail) return;
    const stored=readStoredHousehold();
    if(stored.id!=null && stored.user && stored.user!==myEmail){ clearStoredHousehold(); setActiveHouseholdId(null); }
  },[myEmail]);
  // Mes que muestra el tablero: null = mes en curso; el selector de mes y
  // año de la tarjeta Movimientos fija otro mes y el servidor recalcula
  // las cifras del mes sobre él.
  const [viewMonth,setViewMonth]=useState<string|null>(null);
  const q=useQuery({queryKey:["overview",viewMonth,activeHouseholdId],queryFn:async()=>{
    const baseArgs = viewMonth?{month:viewMonth}:{};
    if(activeHouseholdId==null) return api.getOverview(baseArgs);
    try { return await api.getOverview({...baseArgs, householdId: activeHouseholdId}); }
    catch(e){
      // La elección guardada ya no es membresía de esta cuenta (cambio de
      // cuenta en el dispositivo, o se salió del hogar): se borra y se
      // vuelve al hogar más antiguo, sin pantalla de error.
      if(e instanceof Error && e.message.includes("No pertenece a este hogar.")){
        clearStoredHousehold(); setActiveHouseholdId(null);
        return api.getOverview(baseArgs);
      }
      throw e;
    }
  }});
  const inv=()=>{ qc.invalidateQueries({queryKey:["overview"]}); qc.invalidateQueries({queryKey:["notifications"]}); qc.invalidateQueries({queryKey:["myTandas"]}); qc.invalidateQueries({queryKey:["movements"]}); };
  // Tandas invitadas: tandas de otros hogares en las que el usuario
  // participa por correo sin ser miembro de ese hogar. El servidor solo
  // devuelve ESA tanda (sin nada más del hogar del invitador); se muestran
  // en el propio espacio Personal («Mis tandas»).
  const myTandasQuery=useQuery({queryKey:["myTandas"],queryFn:()=>api.listMyTandas({}),enabled:!!myEmail});
  const guestTandas=myTandasQuery.data?.tandas ?? [];
  const data=q.data;
  const allTandas=data?[...data.tandas,...guestTandas.filter(g=>!data.tandas.some(t=>t.id===g.id))]:guestTandas;
  // El hogar que recibe una acción de tanda es el hogar DE LA TANDA (no
  // el activo): para una tanda invitada, el activo es el Personal y el
  // servidor rechazaría el hogar equivocado.
  const tandaHouseholdId=(tandaId:number)=>allTandas.find(t=>t.id===tandaId)?.householdId ?? data!.household!.id;
  // Opiniones de testers (segunda etapa): se consultan solo si hay hogar y
  // la sesión es del dueño de la app; el servidor vuelve a verificar el correo.
  // Perfil activo: la elección guardada del dispositivo solo se respeta si
  // es el perfil propio de la cuenta o se eligió con esta cuenta; si no,
  // el perfil activo es el propio (myProfileId del servidor). Así, tras
  // aceptar una invitación, la invitada no queda viendo como administradora.
  const meEarly = data ? resolveActiveProfile(data.profiles, currentProfileId, data.myProfileId ?? null, myEmail, readStoredProfile().user) : null;
  const fbQuery=useQuery({queryKey:["testerFeedback"],queryFn:()=>api.listTesterFeedback({householdId:data!.household!.id}),enabled:!!data?.household && isAppOwner});
  // Canal de dudas y mejoras: formulario integrado desde el menú y cola de
  // evaluación en Desarrollador. Solo el dueño evalúa; el servidor lo
  // vuelve a verificar en cada guardado.
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [feedbackShowMessages,setFeedbackShowMessages]=useState(false);
  // Error del último guardado de evaluación que falló ({id, message}):
  // solo esa fila muestra el aviso y su botón sigue habilitado para
  // reintentar. Se limpia al guardar bien o al intentar de nuevo.
  const [fbSaveError,setFbSaveError]=useState<{id:number;message:string}|null>(null);
  const setFbStatus=useMutation({mutationFn:async(v:{id:number;householdId:number;estado:FeedbackState;respuesta:string|null})=>await api.setFeedbackStatus(v),onSuccess:()=>{ setFbSaveError(null); qc.invalidateQueries({queryKey:["testerFeedback"]}); qc.invalidateQueries({queryKey:["notifications"]}); },onError:(_e,v)=>{ setFbSaveError({id:v.id,message:"No se pudo guardar la evaluación. Inténtelo de nuevo."}); }});
  // Registro de usuarios de la app: total y lista de quienes han entrado.
  // Solo lo ve el dueño de la app; el servidor vuelve a verificar el correo.
  const appUsersQuery=useQuery({queryKey:["appUsers"],queryFn:()=>api.listAppUsers({householdId:data!.household!.id}),enabled:!!data?.household && isAppOwner});
  // Analítica de uso de la prueba: qué módulos y botones usan los testers.
  // Solo la ve el dueño de la app; el servidor vuelve a verificar el correo.
  // Si falta correr supabase/add-usage-events.sql, tableMissing:true.
  const usageQuery=useQuery({queryKey:["usageAnalytics"],queryFn:()=>api.listUsage({householdId:data!.household!.id}),enabled:!!data?.household && isAppOwner});
  // Primera vista de la sesión: la analítica también cuenta el módulo en
  // el que se abre la app (goTab solo registra los cambios de módulo).
  // Va aquí, junto a los demás hooks: después de un retorno temprano
  // React contaría distinto número de hooks entre renders.
  const initialUsageLoggedRef=useRef(false);
  useEffect(()=>{ if(data?.household && !initialUsageLoggedRef.current){ initialUsageLoggedRef.current=true; logUsageEvent(data.household.id, tab, "ver_modulo"); } },[data?.household?.id]);
  // Arqueos de efectivo: historial de recuentos guardados. Solo los
  // consulta el administrador del hogar; el servidor vuelve a verificar
  // el rol. Si la tabla aún no existe, la lista sale vacía.
  const ccQuery=useQuery({queryKey:["cashCounts"],queryFn:()=>api.listCashCounts({householdId:data!.household!.id}),enabled:!!data?.household && (!meEarly || meEarly.role==="admin")});
  // Avisos dentro de la app (campanita + insignia del icono): cada usuario
  // ve solo sus propios avisos. Si la tabla aún no existe, la lista sale
  // vacía y nada se rompe.
  const notifQuery=useQuery({queryKey:["notifications"],queryFn:()=>api.listNotifications({householdId:data!.household!.id}),enabled:!!data?.household});
  // Aceptación de los documentos legales (la puerta ya la pidió al entrar;
  // aquí solo se muestra la fecha de aceptación en Documentos legales).
  const legalQuery=useQuery({queryKey:["legalAcceptance"],queryFn:()=>api.getLegalAcceptance({})});
  const unreadCount=notifQuery.data?.unreadCount??0;
  // Avisos que se pintan en la campanilla: las opiniones de testers ya
  // revisadas no se listan, ni los avisos «Nuevo participante en la
  // tanda» ya leídos (ver lib/notifications.ts); los demás avisos
  // leídos siguen visibles como historial.
  const visibleNotifs=visibleNotifications(notifQuery.data?.notifications ?? []);
  // La campanilla también avisa de una versión nueva en espera: cuenta como
  // un aviso sin leer más.
  const bellCount = unreadCount + (updateAvailable ? 1 : 0);
  const bellLabel = updateAvailable
    ? (unreadCount>0 ? `Notificaciones: ${unreadCount} sin leer y una nueva versión disponible` : "Notificaciones: hay una nueva versión disponible")
    : (unreadCount>0 ? `Notificaciones: ${unreadCount} sin leer` : "Notificaciones");
  const [notifOpen,setNotifOpen]=useState(false);
  // Al abrir la campanilla se revisa si hay versión nueva: así el panel
  // siempre muestra el estado real, sin depender de que el aviso llegara.
  const toggleNotif=()=>{ if(!notifOpen) void checkForAppUpdate(); setNotifOpen((o)=>!o); };
  const markNotifRead=useMutation({mutationFn:async(id:number)=>await api.markNotificationRead({id}),onSuccess:()=>qc.invalidateQueries({queryKey:["notifications"]})});
  const markAllNotifRead=useMutation({mutationFn:async()=>await api.markAllNotificationsRead({householdId:data!.household!.id}),onSuccess:()=>qc.invalidateQueries({queryKey:["notifications"]})});
  // Avisos de opiniones de testers: al abrir la cola en Desarrollador, los
  // avisos «Nueva opinión de tester» se marcan como leídos en el servidor
  // y ya no aparecen en la campanilla. Solo ese tipo; los demás avisos no
  // se tocan.
  const markOpinionNotifRead=useMutation({mutationFn:async()=>await api.markOpinionNotificationsRead({householdId:data!.household!.id}),onSuccess:()=>qc.invalidateQueries({queryKey:["notifications"]})});
  // Avisos de nuevo participante en una tanda: al abrir el detalle de
  // la tanda, sus avisos se marcan como leídos en el servidor y ya no
  // aparecen en la campanilla. Solo ese tipo y esa tanda; los demás
  // avisos no se tocan.
  const markTandaPartNotifRead=useMutation({mutationFn:async(v:{householdId:number;tandaId:number})=>await api.markTandaParticipantNotificationsRead(v),onSuccess:()=>qc.invalidateQueries({queryKey:["notifications"]})});
  // Al tocar un aviso de tanda (recordatorio, nuevo participante, pago)
  // se abre el DETALLE de esa tanda —no solo la lista— resolviendo el id
  // por el nombre que nombra el cuerpo del aviso (la tabla de avisos no
  // guarda tandaId). Sin tanda conocida, cae a la pestaña del aviso.
  // Importante: el detalle de un invitado solo de tanda se abre desde
  // listMyTandas (su Personal); nunca se pide el overview del hogar del
  // invitador, que el servidor rechaza («No pertenece a este hogar.»).
  // Aviso «presupuesto_sugerido»: el botón dentro del aviso prellena el
  // formulario de Presupuestos con la categoría que nombra el cuerpo del
  // aviso, el mes del aviso y el límite sugerido (n.amount), y lo abre.
  // Nada se crea solo: el usuario revisa el monto y guarda. La categoría
  // se resuelve por el nombre que nombra el cuerpo (la tabla de avisos no
  // guarda categoría), mismo patrón que findTandaForNotification.
  const budgetSuggestionTarget=(n:{type:string;body:string;amount?:number|null;createdAt:string})=>{
    if(n.type!=="presupuesto_sugerido") return null;
    const cat=data?.categories.find((c)=>c.kind==="expense" && (n.body||"").startsWith(`${c.name} lleva`)) ?? null;
    return { cat, month:String(n.createdAt).slice(0,7), amount:n.amount ?? null };
  };
  // Presupuesto al que apunta un aviso «presupuesto_excedido»: la
  // categoría se resuelve por el nombre que nombra el cuerpo (la tabla de
  // avisos no guarda categoría), el presupuesto por categoría y mes del
  // aviso. Sin presupuesto vigente o ya sin excedente, null: el aviso no
  // lleva botón de consejo.
  const exceededBudgetTarget=(n:{type:string;body:string;createdAt:string})=>{
    const name=exceededCategoryName(n);
    if(!name || !data) return null;
    const cat=data.categories.find((c)=>c.name.trim().toLowerCase()===name.trim().toLowerCase()) ?? null;
    if(!cat) return null;
    const month=String(n.createdAt).slice(0,7);
    const b=data.budgets.find((x)=>x.categoryId===cat.id && x.month===month && x.subcategory==null) ?? data.budgets.find((x)=>x.categoryId===cat.id && x.month===month) ?? null;
    return b && b.remaining<0 ? b : null;
  };
  const openBudgetForm=(categoryId:number,month:string,amount:number|null)=>{
    setBudCat(String(categoryId)); setBudMonth(month); setBudAmount(amount!=null?String(amount):""); setBudSub(""); setBudIncludePrior(false); setBudStartDate(todayISO()); setBudPendingSql(false); setBudStartDatePendingSql(false); setBudEditId(null);
    goTab("presupuestos"); window.setTimeout(()=>focusField("bud-amount"),60);
  };
  // Editar un presupuesto: el mismo formulario, prellenado. La categoría,
  // la subcategoría y el mes quedan fijos (son la identidad del
  // presupuesto: uno por categoría+mes+subcategoría); se corrigen el
  // monto, la visibilidad, los gastos previos y la fecha de inicio. El
  // servidor ya acepta id en saveBudget y actualiza en lugar de crear.
  const openBudgetEdit=(b:OverviewData["budgets"][number])=>{
    setBudCat(String(b.categoryId)); setBudMonth(b.month); setBudAmount(String(b.amount)); setBudSub(b.subcategory ?? ""); setBudVis(b.visibility==="private"?"private":"shared"); setBudIncludePrior(b.includePriorExpenses); setBudStartDate(b.startDate ?? todayISO()); setBudEditId(b.id); setBudPendingSql(false); setBudStartDatePendingSql(false); setDeleteBudgetPreviewId(null); setBudBackfillOpen(false);
    goTab("presupuestos"); window.setTimeout(()=>focusField("bud-amount"),60);
  };
  const handleBudgetSuggestion=(n:{id:number;type:string;body:string;amount?:number|null;createdAt:string})=>{
    const t=budgetSuggestionTarget(n);
    // El aviso NO se marca leído aquí: solo se resuelve al crear el
    // presupuesto (el servidor lo marca al guardar) o al guardar la
    // posposición. Si se cancela el formulario, el aviso sigue ahí.
    setNotifOpen(false);
    if(t?.cat) openBudgetForm(t.cat.id,t.month,t.amount); else goTab("presupuestos");
  };
  // Posposición del aviso de sugerencia («No por ahora»): «Avísame de
  // nuevo cuando el total del mes llegue a $X». La centena siguiente
  // arriba del total actual es la propuesta (total $3,200 → $3,300; si
  // cae exacto en centena, +$100). El presupuesto nunca se crea solo.
  const nextHundredAbove=(total:number)=> (Math.floor(total/100)+1)*100;
  const ymAddStr=(ym:string,k:number)=>{ const [y=2026,m=1]=ym.split("-").map(Number); const d=new Date(Date.UTC(y,m-1+k,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`; };
  const monthTotalOf=(categoryId:number,month:string)=> data?.categoryMonthlyTotals?.find((t)=>t.categoryId===categoryId && t.month===month)?.total ?? null;
  const avg3Of=(categoryId:number,month:string)=>{ const totals=[ymAddStr(month,-1),ymAddStr(month,-2),ymAddStr(month,-3)].map((ym)=>monthTotalOf(categoryId,ym) ?? 0); const withData=totals.filter((t)=>t>0); return { avg: withData.length>0 ? withData.reduce((s,t)=>s+t,0)/withData.length : 0, monthsWithData: withData.length }; };
  // Total del mes que nombra el aviso: del overview si está, si no del
  // cuerpo («{categoría} lleva $X este mes»), si no del sugerido.
  const suggestionMonthTotal=(n:{body:string;amount?:number|null},categoryId:number,month:string)=>{ const t=monthTotalOf(categoryId,month); if(t!=null) return t; const m=(n.body||"").match(/lleva \$([\d,]+)/); const mm=m?.[1]; if(mm) return Number(mm.replace(/,/g,""))||0; return n.amount ?? 0; };
  const [snoozeNotifId,setSnoozeNotifId]=useState<number|null>(null);
  const [snoozeAmt,setSnoozeAmt]=useState("");
  const [snoozePendingSql,setSnoozePendingSql]=useState(false);
  const [snoozeRowOpen,setSnoozeRowOpen]=useState<Record<number,boolean>>({});
  const [snoozeRowAmt,setSnoozeRowAmt]=useState<Record<number,string>>({});
  const snoozeMut=useMutation({mutationFn:async(v:{categoryId:number;month:string;nextThreshold:number})=>await api.snoozeBudgetSuggestion({householdId:data!.household!.id,...v}),onSuccess:(r)=>{ if(!r.saved){ setSnoozePendingSql(true); return; } qc.invalidateQueries({queryKey:["notifications"]}); qc.invalidateQueries({queryKey:["budgetSnoozes"]}); setSnoozeNotifId(null); }});
  const snoozesQuery=useQuery({queryKey:["budgetSnoozes",data?.household?.id,monthNow()],queryFn:()=>api.listBudgetSnoozes({householdId:data!.household!.id,month:monthNow()}),enabled:!!data?.household});
  const snoozeMap=new Map((snoozesQuery.data?.snoozes ?? []).map((x)=>[x.categoryId,x.nextThreshold]));
  const openNotif=(n:{id:number;target:string;type:string;body:string;amount?:number|null;createdAt:string})=>{ if(n.type!=="presupuesto_sugerido") void markNotifRead.mutateAsync(n.id).catch(()=>{}); setNotifOpen(false); if(n.type==="presupuesto_sugerido"){ const t=budgetSuggestionTarget(n); if(t?.cat){ openBudgetForm(t.cat.id,t.month,t.amount); } else { goTab("presupuestos"); } return; } if(n.type==="respuesta_opinion"){ setFeedbackShowMessages(true); setFeedbackOpen(true); return; } const tandaId=findTandaForNotification(n, allTandas); if(tandaId!=null){ openTandaDetail(tandaId); return; } goTab(n.target as Tab); };
  // Reglas de auto-categorización: si el concepto contiene la palabra, la
  // app pone sola esa categoría. Si la tabla aún no existe (falta correr
  // supabase/category-rules.sql), la lista sale vacía.
  const rulesQuery=useQuery({queryKey:["categoryRules"],queryFn:()=>api.listCategoryRules({householdId:data!.household!.id}),enabled:!!data?.household});
  const rules=rulesQuery.data?.rules ?? [];
  const saveRule=useMutation({mutationFn:async(v:{keyword:string;categoryId:number})=>await api.saveCategoryRule({householdId:data!.household!.id,...v}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["categoryRules"]}); }});
  const delRule=useMutation({mutationFn:async(id:number)=>await api.deleteCategoryRule({id}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["categoryRules"]}); }});
  // Gastos recurrentes: reglas y avisos pendientes de confirmar. Si la
  // tabla aún no existe (falta correr supabase/recurring-rules.sql), la
  // lista sale vacía y el guardado avisa con el error del servidor.
  const recRulesQuery=useQuery({queryKey:["recurringRules"],queryFn:()=>api.listRecurringRules({householdId:data!.household!.id}),enabled:!!data?.household});
  const recRules=recRulesQuery.data?.rules ?? [];
  const recPending=recRulesQuery.data?.pending ?? [];
  const saveRecRule=useMutation({mutationFn:async(v:{id?:number;concept:string;amount:number;accountId:number;categoryId:number|null;frequency:"weekly"|"biweekly"|"monthly";dayOfMonth:number|null;weekday:number|null;startDate:string;endDate:string|null;visibility:"private"|"shared";lastPromptedDate?:string|null})=>await api.saveRecurringRule({householdId:data!.household!.id,...v}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); }});
  const delRecRule=useMutation({mutationFn:async(id:number)=>await api.deleteRecurringRule({id,householdId:data!.household!.id}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); }});
  const setRecActive=useMutation({mutationFn:async(v:{id:number;isActive:number})=>await api.setRecurringRuleActive({id:v.id,householdId:data!.household!.id,isActive:v.isActive}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); }});
  const confirmRecOcc=useMutation({mutationFn:async(id:number)=>await api.confirmRecurringOccurrence({householdId:data!.household!.id,occurrenceId:id}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); qc.invalidateQueries({queryKey:["notifications"]}); qc.invalidateQueries({queryKey:["overview"]}); logUsageEvent(data!.household!.id,"movimientos","guardar_movimiento"); }});
  const skipRecOcc=useMutation({mutationFn:async(id:number)=>await api.skipRecurringOccurrence({householdId:data!.household!.id,occurrenceId:id}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); qc.invalidateQueries({queryKey:["notifications"]}); }});
  // Formulario de regla (nueva o edición) en Gastos recurrentes.
  const [recFormOpen,setRecFormOpen]=useState(false);
  const [recEditId,setRecEditId]=useState<number|null>(null);
  const [recConcept,setRecConcept]=useState("");
  const [recAmount,setRecAmount]=useState("");
  const [recAccount,setRecAccount]=useState("");
  const [recCat,setRecCat]=useState("");
  const [recFreq,setRecFreq]=useState<"weekly"|"biweekly"|"monthly">("monthly");
  const [recDay,setRecDay]=useState("1");
  const [recWeekday,setRecWeekday]=useState("1");
  const [recStart,setRecStart]=useState(todayISO());
  const [recEnd,setRecEnd]=useState("");
  const [recVis,setRecVis]=useState<"private"|"shared">("shared");
  const [recDelId,setRecDelId]=useState<number|null>(null);
  const recFreqLabel=(f:"weekly"|"biweekly"|"monthly")=>f==="weekly"?"Semanal":f==="biweekly"?"Quincenal":"Mensual";
  const recWeekdayName=(w:number)=>["domingo","lunes","martes","miércoles","jueves","viernes","sábado"][w] ?? "";
  const recWhenText=(r:{frequency:string;dayOfMonth:number|null;weekday:number|null;startDate:string})=>r.frequency==="weekly"?`Semanal · ${recWeekdayName(r.weekday ?? 1)}`:r.frequency==="biweekly"?`Quincenal · cada 14 días desde ${fmtDate(r.startDate)}`:`Mensual · día ${r.dayOfMonth ?? 1}`;
  const openRecForm=(r?:{id:number;concept:string;amount:number;accountId:number;categoryId:number|null;frequency:"weekly"|"biweekly"|"monthly";dayOfMonth:number|null;weekday:number|null;startDate:string;endDate:string|null;visibility:"private"|"shared"})=>{ if(r){ setRecEditId(r.id); setRecConcept(r.concept); setRecAmount(String(r.amount)); setRecAccount(String(r.accountId)); setRecCat(r.categoryId!=null?String(r.categoryId):""); setRecFreq(r.frequency); setRecDay(String(r.dayOfMonth ?? 1)); setRecWeekday(String(r.weekday ?? 1)); setRecStart(r.startDate); setRecEnd(r.endDate ?? ""); setRecVis(r.visibility); } else { setRecEditId(null); setRecConcept(""); setRecAmount(""); setRecAccount(""); setRecCat(""); setRecFreq("monthly"); setRecDay(String(new Date().getDate())); setRecWeekday("1"); setRecStart(todayISO()); setRecEnd(""); setRecVis("shared"); } setRecFormOpen(true); };
  // Avisos periódicos de tarjetas (corte y pago): una revisión por día.
  const periodicCheckedRef=useRef(false);
  useEffect(()=>{
    if(!data?.household || periodicCheckedRef.current) return;
    periodicCheckedRef.current=true;
    let today="";
    try{ today=todayISO(); if(localStorage.getItem("sf-periodic-alerts-date")===today) return; }catch{ return; }
    void api.checkPeriodicAlerts({householdId:data.household.id}).then((r)=>{ try{ localStorage.setItem("sf-periodic-alerts-date",today); }catch{} if(r.created>0) qc.invalidateQueries({queryKey:["notifications"]}); }).catch(()=>{});
  },[data?.household]);
  // Gastos recurrentes: una revisión por día al abrir la app. Si vence
  // una fecha, se crea el aviso en la campana (nunca se registra solo).
  const recurringCheckedRef=useRef(false);
  useEffect(()=>{
    if(!data?.household || recurringCheckedRef.current) return;
    recurringCheckedRef.current=true;
    let today="";
    try{ today=todayISO(); if(localStorage.getItem("sf-recurring-check-date")===today) return; }catch{ return; }
    void api.checkDueRecurring({householdId:data.household.id}).then((r)=>{ try{ localStorage.setItem("sf-recurring-check-date",today); }catch{} if(r.created>0){ qc.invalidateQueries({queryKey:["notifications"]}); qc.invalidateQueries({queryKey:["recurringRules"]}); } }).catch(()=>{});
  },[data?.household]);
  // Sincroniza el formulario de «Hogar y ajustes» con el hogar activo:
  // los estados de edición nacen con valores fijos ("familiar", "1",
  // "1500", "equal", "unanimous") mientras los campos muestran
  // defaultValue={hh.*}; sin este efecto, guardar sin tocar un campo
  // pisaba el valor real con el fijo (así un hogar Personal se volteaba
  // a Familiar solo por cambiar el nombre). Solo corre al cambiar de
  // hogar (el id), para no pisar lo que el usuario ya escribió si los
  // datos se recargan. Va aquí, antes de los retornos tempranos, para
  // no cambiar el orden de los hooks entre renders.
  useEffect(()=>{ const h=data?.household; if(!h) return; setEditMode(h.mode as "personal"|"familiar"); setEditCutoff(String(h.cutoffDay)); setEditThreshold(String(h.approvalThreshold)); setEditContrib(h.contributionRule as "equal"|"proportional"); setEditApproval(h.approvalRule as "unanimous"|"majority"); setEditName(""); },[data?.household?.id]);
  // Bloqueo con PIN local de 4 dígitos (solo en este dispositivo; no cifra
  // los datos). Se pide al entrar si está activado y al volver a la app
  // después de más de 10 minutos fuera.
  const [pinSetState,setPinSetState]=useState<boolean>(()=>pinIsSet());
  const [pinLocked,setPinLocked]=useState<boolean>(()=>pinIsSet() && !pinUnlocked());
  const [pinInput,setPinInput]=useState(""); const [pinError,setPinError]=useState(""); const [pinBusy,setPinBusy]=useState(false);
  const [pinCurrent,setPinCurrent]=useState(""); const [pinNew1,setPinNew1]=useState(""); const [pinNew2,setPinNew2]=useState(""); const [pinMsg,setPinMsg]=useState("");
  const lastHiddenRef=useRef(0);
  useEffect(()=>{
    const onVis=()=>{ if(document.hidden){ lastHiddenRef.current=Date.now(); } else if(pinIsSet() && Date.now()-lastHiddenRef.current>10*60*1000){ pinLock(); setPinLocked(true); } };
    document.addEventListener("visibilitychange",onVis);
    return ()=>document.removeEventListener("visibilitychange",onVis);
  },[]);
  const unlockPin=async()=>{
    if(pinInput.length!==4){ setPinError("Escriba los 4 dígitos."); return; }
    setPinBusy(true);
    const ok=await pinCheck(pinInput);
    setPinBusy(false);
    if(ok){ pinMarkUnlocked(); setPinLocked(false); setPinInput(""); setPinError(""); }
    else setPinError("PIN incorrecto. Inténtelo de nuevo.");
  };
  const createPin=async()=>{
    if(!/^\d{4}$/.test(pinNew1)){ setPinMsg("El PIN debe tener 4 dígitos."); return; }
    if(pinNew1!==pinNew2){ setPinMsg("Los dos PIN no coinciden."); return; }
    await pinSet(pinNew1);
    setPinSetState(true); setPinNew1(""); setPinNew2(""); setPinMsg("PIN activado en este dispositivo.");
  };
  const changePin=async()=>{
    if(!/^\d{4}$/.test(pinNew1)){ setPinMsg("El PIN nuevo debe tener 4 dígitos."); return; }
    if(pinNew1!==pinNew2){ setPinMsg("Los dos PIN no coinciden."); return; }
    if(!(await pinCheck(pinCurrent))){ setPinMsg("El PIN actual no coincide."); return; }
    await pinSet(pinNew1);
    setPinCurrent(""); setPinNew1(""); setPinNew2(""); setPinMsg("PIN cambiado.");
  };
  const removePin=async()=>{
    if(!(await pinCheck(pinCurrent))){ setPinMsg("El PIN actual no coincide."); return; }
    pinRemove(); setPinSetState(false); setPinCurrent(""); setPinMsg("PIN quitado.");
  };
  // Insignia del icono de la app instalada: número de avisos sin leer más
  // la versión nueva en espera (bellCount); se quita cuando ya no hay.
  // Solo funciona en navegadores que la soportan (Android con Chrome y
  // iPhone con iOS 16.4 o posterior).
  useEffect(()=>{ try{ const nav=navigator as Navigator & { setAppBadge?: (n?:number)=>Promise<void>; clearAppBadge?: ()=>Promise<void> }; if(bellCount>0) void nav.setAppBadge?.(bellCount); else void nav.clearAppBadge?.(); }catch{} },[bellCount]);

  // onboarding state
  const [planMode,setPlanMode]=useState<"personal"|"familiar">("familiar"); const [hhName,setHhName]=useState("Mi hogar"); const [ownerName,setOwnerName]=useState(""); const [ownerLast,setOwnerLast]=useState(""); const [invEmail,setInvEmail]=useState(""); const [invFound,setInvFound]=useState<{id:number;email:string;householdName:string;invitedName:string|null;kind:"household"|"tanda";tandaId:number|null;tandaName:string|null}[]>([]); const [invSearched,setInvSearched]=useState(false); const [joinFirst,setJoinFirst]=useState(""); const [joinLast,setJoinLast]=useState(""); const [ownerIncome,setOwnerIncome]=useState(""); const [cutoff,setCutoff]=useState("1"); const [contribRule,setContribRule]=useState<"equal"|"proportional">("equal"); const [approvalRule,setApprovalRule]=useState<"unanimous"|"majority">("unanimous"); const [threshold,setThreshold]=useState("1500"); const [hhCurrencySuggestion]=useState(suggestCurrency); const [hhCurrency,setHhCurrency]=useState<HouseholdCurrency>(hhCurrencySuggestion.currency);
  const findInv=useMutation({mutationFn:async()=>await api.findInvitations({email:invEmail}),onSuccess:(r)=>{setInvFound(r.invitations);setInvSearched(true);}});
  const respondInv=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondInvitation({id:v.id,accept:v.accept,firstName:joinFirst||undefined,lastName:joinLast||undefined}),onSuccess:(r)=>{ inv(); if(r.profileId) pickProfile(r.profileId); }});
  const createHh=useMutation({mutationFn:async()=>await api.createHousehold({mode:planMode,name:planMode==="personal"?(hhName==="Mi hogar"?"Mi dinero":hhName):hhName,currency:hhCurrency,cutoffDay:Number(cutoff)||1,contributionRule:contribRule,approvalRule,approvalThreshold:Number(threshold)||0,ownerName:ownerName||"Yo",ownerLastName:ownerLast,ownerIncome:Number(ownerIncome)||0}),onSuccess:()=>{ inv(); setChartsSeen(false); try{ localStorage.setItem("sf-first-guide-pending","1"); localStorage.removeItem("sf-guide-charts-seen"); }catch{} }});
  // Asistente de creación del espacio (paso a paso), secciones plegables de
  // registro y guía de primer uso tras crear el hogar.
  const [obStep,setObStep]=useState(0); const [obError,setObError]=useState("");
  const [mvMore,setMvMore]=useState(false); const [persMore,setPersMore]=useState(false);
  const [firstGuideOpen,setFirstGuideOpen]=useState(false);
  useEffect(()=>{ if(data?.household){ try{ if(localStorage.getItem("sf-first-guide-pending")==="1") setFirstGuideOpen(true); }catch{} } },[data?.household]);
  const dismissFirstGuide=()=>{ setFirstGuideOpen(false); try{ localStorage.removeItem("sf-first-guide-pending"); localStorage.setItem("sf-first-guide-seen","1"); }catch{} };
  // La guía se cierra sola cuando los pasos básicos ya están hechos:
  // cuenta inicial (o sueldo en Personal), primer movimiento y gráficas revisadas.
  useEffect(()=>{
    if(!firstGuideOpen || !data?.household) return;
    const step1 = data.household.mode==="personal" ? (data.personal?.salary||0)>0 : data.accounts.length>0;
    const step2 = data.totalMovements>0;
    if(step1 && step2 && chartsSeen) dismissFirstGuide();
  },[firstGuideOpen, data, chartsSeen]);

  // Invitación por enlace directo (?token=...): se resuelve al entrar y se
  // muestra el banner, CON hogar y SIN hogar: antes el banner solo existía
  // en la pantalla sin hogar, así que quien ya tenía un espacio (por
  // ejemplo, el Personal creado al registrarse) abría el enlace y caía en
  // silencio a su espacio vacío sin ver jamás la invitación. Si el enlace
  // ya no vale, se avisa en lugar de ignorarlo. Las invitaciones por
  // correo se aceptan o rechazan con las acciones existentes, que
  // verifican el correo invitado y entran al mismo hogar/tanda. El enlace
  // genérico del hogar es solo la invitación a probar la app: quien lo
  // abre empieza con su propio espacio (botón Empezar), sin solicitar
  // entrar a ningún hogar.
  type InvitePreviewFull = InvitePreview & { invitationId: number | null; tandaInvitationId: number | null; expiresAt: string };
  const [tokenRaw,setTokenRaw]=useState<string|null>(()=>readInviteToken());
  const [tokenInvite,setTokenInvite]=useState<InvitePreviewFull|null>(null);
  const [tokenDone,setTokenDone]=useState(false);
  // El enlace ya no vale (reemplazado, vencido o inexistente): se avisa
  // en claro en lugar de caer en silencio al espacio propio.
  const [tokenError,setTokenError]=useState(false);
  // Mientras haya un token por resolver, el modal de modo no se abre solo:
  // quien llega con invitación no debe crear su propio espacio antes de verla.
  const tokenPending = tokenRaw != null && !tokenInvite && !tokenError && !tokenDone;
  const [copiedLink,setCopiedLink]=useState("");
  const copyLink=async(url:string)=>{ try{ await navigator.clipboard.writeText(url); setCopiedLink(url); }catch{ try{ const t=document.createElement("textarea"); t.value=url; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); setCopiedLink(url); }catch{} } };
  // Mensaje de invitación: el enlace real (un solo uso, con token) va primero
  // y visible, seguido de los pasos para entrar. El mismo mensaje se copia
  // y se comparte por WhatsApp.
  const inviteMessage=(url:string)=>`${url}\nLe invito a SyncFinanzas, la app para llevar el dinero del hogar.\nPara entrar:\n1. Abra este enlace.\n2. Cree su cuenta con su correo y una contraseña.\n3. Acepte la invitación y entre al hogar.`;
  // Mensaje de invitación a una tanda: el enlace va primero, seguido de los
  // pasos para entrar. El mismo mensaje se copia y se comparte por WhatsApp.
  const tandaInviteMessage=(url:string,tandaName:string)=>`${url}\nLe invito a participar en la tanda ${tandaName} en SyncFinanzas.\nPara entrar:\n1. Abra este enlace.\n2. Cree su cuenta con su correo y una contraseña.\n3. Acepte la invitación y participe en la tanda.`;
  useEffect(()=>{
    const token = readInviteToken();
    if (!token) return;
    setTokenRaw(token);
    void fetch(`/api/invite?token=${encodeURIComponent(token)}`).then(r=>r.json()).then((j: InvitePreviewFull & { ok?: boolean })=>{ if (j && j.ok) setTokenInvite(j); else setTokenError(true); }).catch(()=>{ setTokenError(true); });
  },[]);
  const acceptTokenInvite=useMutation({mutationFn:async(_v?:{first?:string;last?:string})=>{
    if (!tokenInvite) throw new Error("No hay invitación por enlace.");
    if (tokenInvite.kind==="general") { if (!tokenRaw) throw new Error("Falta el enlace de invitación."); return await api.acceptGeneralInvite({token: tokenRaw}); }
    if (tokenInvite.kind==="household" && tokenInvite.invitationId) return await api.respondInvitation({id: tokenInvite.invitationId, accept: true, firstName: joinFirst||undefined, lastName: joinLast||undefined});
    if (tokenInvite.kind==="tanda" && tokenInvite.tandaInvitationId) return await api.respondTandaInvitation({id: tokenInvite.tandaInvitationId, accept: true, name: [joinFirst, joinLast].filter(Boolean).join(" ")||undefined});
    throw new Error("No se pudo identificar la invitación del enlace.");
  },onSuccess:(r)=>{ if(tokenInvite?.kind==="tanda"){
    // Invitación de tanda: el invitado NO se hace miembro del hogar del
    // invitador y el hogar activo NO cambia: la tanda se habilita en su
    // propio espacio Personal (listMyTandas) y se abre su detalle cuando
    // la lista ya la trae.
    const tid = (r && typeof r === "object" && "tandaId" in r) ? (r as { tandaId?: unknown }).tandaId : undefined;
    setTokenDone(true); try{ sessionStorage.removeItem("sf-invite-token"); }catch{} inv();
    void qc.invalidateQueries({queryKey:["myTandas"]}).then(()=>{ if(typeof tid === "number"){ setTandaDetailId(tid); setTab("tandas"); } });
    return;
  }
  const pid = (r && typeof r === "object" && "profileId" in r) ? (r as { profileId?: unknown }).profileId : undefined; if(typeof pid === "number") pickProfile(pid);
    // Al aceptar una invitación AL HOGAR, la persona entra a ese hogar:
    // el hogar activo cambia a ese hogar (antes se quedaba en la
    // membresía más antigua, el espacio propio).
    const hid = (r && typeof r === "object" && "householdId" in r) ? (r as { householdId?: unknown }).householdId : undefined;
    if(typeof hid === "number"){ setActiveHouseholdId(hid); writeStoredHousehold(hid, myEmail); }
    if(typeof hid === "number"){ setTab("inicio"); }
    setTokenDone(true); try{ sessionStorage.removeItem("sf-invite-token"); }catch{} inv(); }});
  const rejectTokenInvite=useMutation({mutationFn:async()=>{
    if (!tokenInvite) throw new Error("No hay invitación por enlace.");
    // La invitación general no crea nada: rechazarla es simplemente descartarla.
    if (tokenInvite.kind==="general") return { ok: true as const };
    if (tokenInvite.kind==="household" && tokenInvite.invitationId) return await api.respondInvitation({id: tokenInvite.invitationId, accept: false});
    if (tokenInvite.kind==="tanda" && tokenInvite.tandaInvitationId) return await api.respondTandaInvitation({id: tokenInvite.tandaInvitationId, accept: false});
    throw new Error("No se pudo identificar la invitación del enlace.");
  },onSuccess:()=>{ setTokenDone(true); try{ sessionStorage.removeItem("sf-invite-token"); }catch{} inv(); }});
  // Invitación general (cuenta personal): se envía desde la pantalla de entrada, sin hogar.
  const [genEmail,setGenEmail]=useState(""); const [genName,setGenName]=useState(""); const [genResult,setGenResult]=useState<(InviteSend & { id?: number })|null>(null);
  const createGenInv=useMutation({mutationFn:async()=>await api.createGeneralInvitation({email:genEmail,invitedName:genName||undefined}),onSuccess:(r)=>{ setGenResult(r); setGenEmail(""); setGenName(""); }});
  const resendGenInv=useMutation({mutationFn:async(id:number)=>await api.resendInvitation({kind:"general",invitationId:id}),onSuccess:(r)=>{ setGenResult(prev=>prev?{...prev,emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl}:prev); }});
  const resendInv=useMutation({mutationFn:async(v:{kind:"household"|"tanda";invitationId:number;tandaId?:number})=>await api.resendInvitation({kind:v.kind,invitationId:v.invitationId}),onSuccess:(r,v)=>{ if(v.kind==="household") setHhInvResult(r); else if(v.tandaId) setTInvResult(p=>({...p,[v.tandaId as number]:r})); inv(); }});
  // Ventana emergente para elegir el modo (Personal o Familiar) al crear el
  // espacio: se abre sola la primera vez que se muestra la pantalla de
  // entrada sin hogar (salvo que se haya llegado con una invitación por
  // correo, en cuyo caso se entra al hogar invitado sin crear uno nuevo;
  // el enlace para probar la app no entra a ningún hogar).
  const [modeModalOpen,setModeModalOpen]=useState(false); const [modeModalShown,setModeModalShown]=useState(false);
  useEffect(()=>{ if(data && !data.household && (!tokenInvite || tokenDone) && !tokenPending && !modeModalShown){ setModeModalOpen(true); setModeModalShown(true); } },[data,tokenInvite,tokenPending,tokenDone,modeModalShown]);
  // Aviso de invitación por enlace: se muestra CON hogar y SIN hogar, e
  // incluso si el resumen no cargó (la pantalla de error lo incluye
  // arriba): antes solo existía en la pantalla sin hogar, así que quien ya
  // tenía un espacio (por ejemplo, el Personal creado al registrarse)
  // abría el enlace y caía en silencio a su espacio vacío, sin ver jamás
  // la invitación. En una tanda, el enlace es la credencial: si el correo
  // de la sesión no coincide con el invitado, se acepta con el correo de
  // la sesión y se avisa al organizador (en el hogar, el correo distinto
  // sigue bloqueado). Si el enlace ya no vale, también se avisa.
  const tokenEmailMismatch = !!tokenInvite && tokenInvite.email !== "" && myEmail !== "" && tokenInvite.email.trim().toLowerCase() !== myEmail.trim().toLowerCase();
  const renderTokenInviteBanner = () => (
    <>
      {tokenInvite && !tokenDone && (
        <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2" role="status">
          <h2 className="font-display font-bold text-lg">{tokenInvite.kind==="household" && tokenInvite.generic ? "Invitación a probar la app" : "Invitación recibida por correo"}</h2>
          {tokenInvite.kind==="household" && tokenInvite.generic && <p className="text-sm">Le invitan a probar SyncFinanzas{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}. Cree su cuenta y empiece con su propio espacio; este enlace no le da acceso al hogar de quien le invitó ni genera ninguna solicitud.</p>}
          {tokenInvite.kind==="household" && !tokenInvite.generic && <p className="text-sm">Usted fue invitado al hogar <b>“{tokenInvite.householdName}”</b>{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}. Al aceptar, entrará a ese hogar.</p>}
          {tokenInvite.kind==="tanda" && <p className="text-sm">Usted fue invitado a la tanda <b>“{tokenInvite.tandaName}”</b>{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}. Al aceptar, se incorporará como participante. La tanda se habilitará en su perfil Personal, sin acceso al resto del hogar de quien le invitó.</p>}
          {tokenInvite.kind==="general" && <p className="text-sm">Usted fue invitado a crear su cuenta personal en SyncFinanzas{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}.</p>}
          {!tokenInvite.usable && <p className="text-sm text-[var(--red)]">Ya se usó o venció. Solicite una nueva.</p>}
          {tokenInvite.usable && tokenEmailMismatch && tokenInvite.kind==="tanda" && <p className="text-sm text-[var(--red)]">Esta invitación fue enviada a <b>{tokenInvite.email}</b>. Usted entró con <b>{myEmail}</b>. Si acepta, se incorporará a la tanda con <b>{myEmail}</b> y {tokenInvite.inviterName ? <><b>{tokenInvite.inviterName}</b> será avisado</> : "el organizador será avisado"}.</p>}
          {tokenInvite.usable && tokenEmailMismatch && tokenInvite.kind!=="tanda" && <p className="text-sm text-[var(--red)]">Esta invitación fue enviada a <b>{tokenInvite.email}</b>. Usted entró con <b>{myEmail}</b>. Inicie sesión con el correo invitado.</p>}
          {tokenInvite.usable && tokenInvite.kind==="household" && tokenInvite.generic && (
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} onClick={()=>{ setTokenInvite(null); try{ sessionStorage.removeItem("sf-invite-token"); }catch{} }}>Empezar</button>
            </div>
          )}
          {tokenInvite.usable && (!tokenEmailMismatch || tokenInvite.kind==="tanda") && !(tokenInvite.kind==="household" && tokenInvite.generic) && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Su nombre al aceptar la invitación del enlace" placeholder="Nombre" className={inputCls} value={joinFirst} onChange={e=>setJoinFirst(e.target.value)} />
                <input aria-label="Su apellido al aceptar la invitación del enlace" placeholder="Apellido" className={inputCls} value={joinLast} onChange={e=>setJoinLast(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} onClick={()=>acceptTokenInvite.mutate({})} disabled={acceptTokenInvite.isPending}>{tokenInvite.kind==="general"?"Aceptar y crear mi cuenta":"Aceptar invitación"}</button>
                <button type="button" className={btnGhost} onClick={()=>rejectTokenInvite.mutate()} disabled={rejectTokenInvite.isPending}>Rechazar</button>
              </div>
              {(acceptTokenInvite.error || rejectTokenInvite.error) && <p className="text-sm text-[var(--red)]">{String(acceptTokenInvite.error || rejectTokenInvite.error)}</p>}
            </>
          )}
        </div>
      )}
      {tokenError && !tokenInvite && !tokenDone && (
        <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2" role="status">
          <h2 className="font-display font-bold text-lg">Invitación recibida por correo</h2>
          <p className="text-sm text-[var(--red)]">Este enlace de invitación ya no funciona. Pida a quien le invitó que le envíe uno nuevo.</p>
        </div>
      )}
      {tokenDone && <p className="text-sm text-[var(--green)] mt-4" role="status">Invitación respondida.</p>}
    </>
  );
  const [hhInvResult,setHhInvResult]=useState<InviteSend|null>(null);
  const [tInvResult,setTInvResult]=useState<Record<number,InviteSend>>({});

  // movement form
  const [mvType,setMvType]=useState<"income"|"expense"|"transfer"|"debt_payment">("expense"); const [mvStep,setMvStep]=useState(1); const [mvAmount,setMvAmount]=useState(""); const [mvConcept,setMvConcept]=useState(""); const [mvAccount,setMvAccount]=useState(""); const [mvAccountError,setMvAccountError]=useState(""); const [mvToAccount,setMvToAccount]=useState(""); const [mvCat,setMvCat]=useState(""); const [mvSub,setMvSub]=useState(""); const [mvBudget,setMvBudget]=useState<number|null>(null); const [mvAssignPendingSql,setMvAssignPendingSql]=useState(false); const [mvDate,setMvDate]=useState(todayISO()); const [mvVis,setMvVis]=useState<"private"|"shared">("shared"); const [mvFilters,setMvFilters]=useState<MovementsFilterValue>(DEFAULT_MOVEMENTS_FILTER); const [editingMv,setEditingMv]=useState<number|null>(null); const [mvCurrency,setMvCurrency]=useState(""); const [mvConversionPendingSql,setMvConversionPendingSql]=useState(false);
  // Conversión de moneda (alcance B, reglas-visualizacion-moneda.md):
  // la moneda del movimiento es la elegida; por defecto, la de la
  // cuenta. El selector, el equivalente previsto y el aviso aparecen
  // SOLO cuando la moneda de la cuenta difiere de la del hogar; en
  // cualquier otro caso todo es como hoy. Las tasas vienen de
  // getOverview (exchangeRates); el cliente nunca llama a Frankfurter.
  // La cuenta se elige en el paso 3, así que el selector vive ahí.
  const hhCur: HouseholdCurrency = (data?.household?.currency as HouseholdCurrency) ?? "MXN";
  const mvAccountObj = data?.accounts.find(a=>a.id===Number(mvAccount));
  const mvAccountCurrency: HouseholdCurrency = (mvAccountObj?.currency as HouseholdCurrency) ?? hhCur;
  const mvShowCurrency = mvAccount !== "" && mvAccountCurrency !== hhCur;
  const mvCurrencyEffective: HouseholdCurrency = mvShowCurrency ? ((mvCurrency as HouseholdCurrency) || mvAccountCurrency) : hhCur;
  const mvRate: ExchangeRateInfo | null = mvShowCurrency ? findStoredRate(data?.exchangeRates ?? null, mvCurrencyEffective, hhCur) : null;
  const mvEquivalent: number | null = mvRate && mvAmount ? previewEquivalent(Number(mvAmount), mvRate) : null;
  const mvFxLabel: string | null = mvEquivalent != null ? fxLabel(Number(mvAmount), mvCurrencyEffective, mvEquivalent, hhCur) : null;
  const mvRateNotice: string | null = mvRate ? movementRateNotice(mvCurrencyEffective, hhCur, mvRate.rate, mvRate.date) : (mvShowCurrency ? "El tipo de cambio del día se aplicará al guardar." : null);
  // Traspaso: lo que recibe la cuenta destino, con la tasa guardada.
  const mvToAccountObj = data?.accounts.find(a=>a.id===Number(mvToAccount));
  const mvToCurrency: HouseholdCurrency = (mvToAccountObj?.currency as HouseholdCurrency) ?? hhCur;
  const mvToRate: ExchangeRateInfo | null = mvType === "transfer" && mvToAccount !== "" && mvToCurrency !== mvCurrencyEffective ? findStoredRate(data?.exchangeRates ?? null, mvCurrencyEffective, mvToCurrency) : null;
  const mvToAmount: number | null = mvToRate && mvAmount ? previewEquivalent(Number(mvAmount), mvToRate) : null;
  const mvToNotice: string | null = mvToRate ? movementRateNotice(mvCurrencyEffective, mvToCurrency, mvToRate.rate, mvToRate.date) : (mvType === "transfer" && mvToAccount !== "" && mvToCurrency !== mvCurrencyEffective ? "El tipo de cambio del día se aplicará al guardar." : null);
  // Etiqueta de una cuenta en un <select>: su saldo en su moneda de
  // origen cuando difiere de la del hogar (R2).
  const accOptionLabel = (a: { name: string; balance: number; currency?: string | null; nativeBalance?: number | null }) => `${a.name} (${fxLabel(a.nativeBalance, a.currency, a.balance, hhCur) ?? money(a.balance)})`;
  // Regla de auto-categorización aplicada en cada formulario (se muestra y
  // se puede corregir). La regla solo llena la categoría cuando está vacía
  // o cuando la categoría actual la puso una regla: si la persona eligió
  // otra categoría a mano, no se le cambia.
  const [appliedRuleMv,setAppliedRuleMv]=useState<{keyword:string;categoryName:string}|null>(null);
  const [appliedRulePers,setAppliedRulePers]=useState<{keyword:string;categoryName:string}|null>(null);
  const applyRuleTo=(concept:string,target:"mv"|"pers")=>{
    if(!data) return;
    const r=matchRule(rules,concept);
    if(!r){ if(target==="mv") setAppliedRuleMv(null); else setAppliedRulePers(null); return; }
    const cat=data.categories.find(c=>c.id===r.categoryId);
    if(!cat) return;
    if(target==="mv"){ if(mvCat==="" || appliedRuleMv){ setMvCat(String(r.categoryId)); setAppliedRuleMv({keyword:r.keyword,categoryName:cat.name}); } }
    else { if(persCat==="" || appliedRulePers){ setPersCat(String(r.categoryId)); setAppliedRulePers({keyword:r.keyword,categoryName:cat.name}); } }
  };
  // «Repetir este gasto» (paso 2, solo gasto nuevo): al guardar se crea
  // la regla con la fecha del gasto como inicio y como última avisada,
  // para que hoy no vuelva a avisar. La regla se crea en el onSuccess
  // de saveMv, con los datos del formulario.
  const [mvRepeat,setMvRepeat]=useState(false);
  const [mvRepeatFreq,setMvRepeatFreq]=useState<"weekly"|"biweekly"|"monthly">("monthly");
  const [mvRepeatDay,setMvRepeatDay]=useState("");
  const [mvRepeatWeekday,setMvRepeatWeekday]=useState("");
  const [mvRepeatError,setMvRepeatError]=useState("");
  // «Dividir entre categorías» (paso 2, solo gasto nuevo o edición de un
  // gasto dividido): cada línea es categoría + importe; las líneas deben
  // sumar exactamente el total. Al guardar, el gasto se divide en una
  // fila por parte con el mismo identificador de grupo (lo genera el
  // servidor). Incompatible con «Repetir este gasto»: una regla recurrente
  // tiene una sola categoría. El lector de comprobantes prellena el mismo
  // formulario: al activar Dividir, la categoría sugerida pasa a ser la
  // primera línea y el total a dividir es el importe leído.
  type SplitLine = { key: number; categoryId: string; amount: string; budgetId: number | null };
  const [mvSplit,setMvSplit]=useState(false);
  const [mvSplitLines,setMvSplitLines]=useState<SplitLine[]>([]);
  const [editingSplitGroup,setEditingSplitGroup]=useState<string|null>(null);
  const splitKeyRef=useRef(0);
  const mvSplitTotal = useMemo(()=>mvSplitLines.reduce((s,l)=>s+(Number(l.amount)||0),0),[mvSplitLines]);
  const mvSplitDiff = useMemo(()=>Math.round(((Number(mvAmount)||0)-mvSplitTotal)*100)/100,[mvAmount,mvSplitTotal]);
  const mvSplitDupCat = useMemo(()=>{ const seen=new Set<string>(); for(const l of mvSplitLines){ if(l.categoryId==="") continue; if(seen.has(l.categoryId)) return true; seen.add(l.categoryId); } return false; },[mvSplitLines]);
  const mvSplitValid = useMemo(()=>mvSplitLines.length>=2 && mvSplitLines.every(l=>l.categoryId!=="" && Number(l.amount)>0) && !mvSplitDupCat && mvSplitDiff===0,[mvSplitLines,mvSplitDupCat,mvSplitDiff]);
  const toggleSplit=(on:boolean)=>{
    if(editingSplitGroup!=null && !on) return; // editar un grupo es siempre dividido: no se puede «desdividir» y dejar huérfanas las demás partes
    if(on){
      setMvRepeat(false);
      const firstCat = mvCat && mvCat!=="__new__" ? mvCat : "";
      setMvSplitLines([
        { key: splitKeyRef.current++, categoryId: firstCat, amount: mvAmount, budgetId: null },
        { key: splitKeyRef.current++, categoryId: "", amount: "", budgetId: null },
      ]);
      setMvCat("");
      setMvSub("");
      setMvBudget(null);
      setMvSplit(true);
    } else {
      const first = mvSplitLines[0];
      if(first && first.categoryId!=="") setMvCat(first.categoryId);
      setMvSplit(false);
      setMvSplitLines([]);
    }
  };
  // Totales al instante al guardar un movimiento: en cuanto el servidor
  // confirma el guardado, la vista en caché se proyecta con el movimiento
  // guardado (los totales de Inicio y Presupuestos ya muestran el valor
  // nuevo) y luego se invalida para que el refetch concilie. Si el
  // guardado falla, onSuccess no corre y los totales quedan como estaban.
  // El refetch en vuelo de un guardado anterior se cancela antes de
  // invalidar, para que sus datos viejos no pisen la proyección.
  const overviewKey = ["overview", viewMonth, activeHouseholdId] as const;
  const projectMovementChange = (change: MovementChange) => {
    qc.setQueryData(overviewKey, (old: OverviewData | undefined) =>
      old ? applyMovementChange(old, change, { today: todayISO(), myEmail }) : old,
    );
  };
  const refreshAfterMovementSave = () => {
    void (async () => {
      await qc.cancelQueries({ queryKey: ["overview"] });
      inv();
    })();
  };
  const savedMovementFromForm = (id: number): SavedMovement => ({
    id,
    type: mvType,
    // La proyección optimista usa el equivalente en moneda del hogar
    // (lo que el servidor guardará en amount); el original y la tasa
    // viajan en los campos de conversión para mostrarse al instante.
    amount: mvEquivalent ?? Number(mvAmount),
    concept: mvConcept,
    accountId: mvAccount ? Number(mvAccount) : null,
    toAccountId: mvToAccount ? Number(mvToAccount) : null,
    categoryId: mvCat && mvCat !== "__new__" ? Number(mvCat) : null,
    subcategory: mvSub || null,
    budgetId: (mvType === "expense" || mvType === "debt_payment") ? (mvBudget ?? null) : null,
    splitGroupId: null,
    originalAmount: mvShowCurrency ? Number(mvAmount) : null,
    originalCurrency: mvShowCurrency ? mvCurrencyEffective : null,
    exchangeRate: mvRate?.rate ?? null,
    exchangeRateDate: mvRate?.date ?? null,
    transferToAmount: mvToAmount,
    date: mvDate,
    visibility: mvVis,
    profileId: mvProfile ? Number(mvProfile) : (me ? me.id : null),
  });
  const saveMv=useMutation({mutationFn:async()=>{
    if(mvSplit && mvType==="expense"){
      if(!mvSplitValid) throw new Error("Las partes deben sumar exactamente el total del gasto.");
      return await api.saveMovement({id:editingMv??undefined,householdId:data!.household!.id,type:"expense",amount:Number(mvAmount),currency:mvCurrencyEffective,concept:mvConcept,accountId:mvAccount?Number(mvAccount):null,categoryId:null,splits:mvSplitLines.map(l=>({categoryId:Number(l.categoryId),amount:Number(l.amount),budgetId:l.budgetId??undefined})),date:mvDate,visibility:mvVis,profileId:mvProfile?Number(mvProfile):(me?me.id:null),receipt:receipt?{dataBase64:receipt.dataBase64,mimeType:receipt.mimeType}:undefined});
    }
    return await api.saveMovement({id:editingMv??undefined,householdId:data!.household!.id,type:mvType,amount:Number(mvAmount),currency:mvCurrencyEffective,toAmount:mvToAmount??undefined,concept:mvConcept,accountId:mvAccount?Number(mvAccount):null,toAccountId:mvToAccount?Number(mvToAccount):null,categoryId:mvCat&&mvCat!=="__new__"?Number(mvCat):null,subcategory:mvSub||undefined,budgetId:(mvType==="expense"||mvType==="debt_payment")?mvBudget:undefined,date:mvDate,visibility:mvVis,profileId:mvProfile?Number(mvProfile):(me?me.id:null),receipt:receipt?{dataBase64:receipt.dataBase64,mimeType:receipt.mimeType}:undefined});
  },onSuccess:(r)=>{
    if(mvSplit && mvType==="expense" && r?.splitGroupId && r?.ids){
      const gid=r.splitGroupId;
      const oldParts=(data?.movements ?? []).filter(m=>m.splitGroupId===gid);
      const base={type:"expense" as const,concept:mvConcept,accountId:mvAccount?Number(mvAccount):null,toAccountId:null,subcategory:null,date:mvDate,visibility:mvVis,profileId:mvProfile?Number(mvProfile):(me?me.id:null)};
      const newParts:SavedMovement[]=mvSplitLines.map((l,i)=>{ const partEquiv = mvRate ? previewEquivalent(Number(l.amount), mvRate) : null; return {...base,id:r.ids?.[i] ?? 0,amount:partEquiv ?? Number(l.amount),categoryId:Number(l.categoryId),budgetId:l.budgetId ?? null,splitGroupId:gid,originalAmount:mvShowCurrency ? Number(l.amount) : null,originalCurrency:mvShowCurrency ? mvCurrencyEffective : null,exchangeRate:mvRate?.rate ?? null,exchangeRateDate:mvRate?.date ?? null,transferToAmount:null}; });
      for(const old of oldParts) projectMovementChange({kind:"delete",previous:old});
      for(const np of newParts) projectMovementChange({kind:"create",movement:np});
      refreshAfterMovementSave();resetMvForm();setMvAssignPendingSql(r?.savedBudgetAssignment===false);setMvConversionPendingSql(r?.savedConversion===false);if(inicioMvOpenRef.current){inicioMvOpenRef.current=false;setInicioMvOpen(false);}logUsageEvent(data!.household!.id,"movimientos","guardar_movimiento");
      return;
    }
    const wasRepeat=mvRepeat && editingMv==null && mvType==="expense";const repData=wasRepeat?{concept:mvConcept,amount:Number(mvAmount),accountId:mvAccount?Number(mvAccount):null,categoryId:mvCat&&mvCat!=="__new__"?Number(mvCat):null,date:mvDate,visibility:mvVis,freq:mvRepeatFreq,day:mvRepeatFreq==="monthly"?Number(mvRepeatDay||mvDate.slice(8,10)):null,weekday:mvRepeatFreq==="weekly"?Number(mvRepeatWeekday):null}:null;const previous=editingMv!=null?data?.movements.find(m=>m.id===editingMv)??null:null;const saved=savedMovementFromForm(r?.id ?? editingMv ?? 0);projectMovementChange(previous?{kind:"edit",movement:saved,previous}:{kind:"create",movement:saved});refreshAfterMovementSave();resetMvForm();setMvAssignPendingSql(r?.savedBudgetAssignment===false);setMvConversionPendingSql(r?.savedConversion===false);if(inicioMvOpenRef.current){inicioMvOpenRef.current=false;setInicioMvOpen(false);}logUsageEvent(data!.household!.id,"movimientos","guardar_movimiento");if(repData && repData.accountId){ void api.saveRecurringRule({householdId:data!.household!.id,concept:repData.concept,amount:repData.amount,accountId:repData.accountId,categoryId:repData.categoryId,frequency:repData.freq,dayOfMonth:repData.day,weekday:repData.weekday,startDate:repData.date,visibility:repData.visibility,lastPromptedDate:repData.date}).then(()=>{ qc.invalidateQueries({queryKey:["recurringRules"]}); }).catch((e)=>{ setMvRepeatError(`El gasto se guardó, pero no se pudo crear la regla: ${String(e)}`); }); }
  }});
  const [confirmDeleteMvId,setConfirmDeleteMvId]=useState<number|null>(null);
  const [expandedSplit,setExpandedSplit]=useState<Set<string>>(new Set());
  const [confirmDeleteProfId,setConfirmDeleteProfId]=useState<number|null>(null);
  const [confirmDelInvId,setConfirmDelInvId]=useState<number|null>(null);
  const delMv=useMutation({mutationFn:async(id:number)=>await api.deleteMovement({id}),onSuccess:(_r,id)=>{const previous=data?.movements.find(m=>m.id===id)??null;if(previous){ projectMovementChange({kind:"delete",previous}); if(previous.splitGroupId){ for(const part of (data?.movements ?? []).filter(m=>m.splitGroupId===previous.splitGroupId && m.id!==id)) projectMovementChange({kind:"delete",previous:part}); } }refreshAfterMovementSave();setConfirmDeleteMvId(null);}});
  // Borrado (único punto de llamada a la mutación de borrado): los dos avisos de confirmación (gasto único y gasto dividido) pasan por aquí, así el borrado solo ocurre desde «Avanzar».
  const confirmDeleteMovement=(id:number)=>delMv.mutate(id);
  const [confirmReverseId,setConfirmReverseId]=useState<number|null>(null);
  const revMv=useMutation({mutationFn:async(id:number)=>await api.reverseMovement({id}),onSuccess:(r,id)=>{const previous=data?.movements.find(m=>m.id===id)??null;if(previous){ if(previous.splitGroupId && r?.reversalIds?.length){ const parts=[...(data?.movements ?? [])].filter(m=>m.splitGroupId===previous.splitGroupId).sort((a,b)=>b.id-a.id); parts.forEach((part,i)=>projectMovementChange({kind:"reverse",previous:part,reversalId:r.reversalIds?.[i] ?? null})); } else { projectMovementChange({kind:"reverse",previous,reversalId:r?.reversalId ?? null}); } }refreshAfterMovementSave();setConfirmReverseId(null);}});

  // account form
  const [accFormName,setAccFormName]=useState(""); const [accType,setAccType]=useState<"bank"|"cash"|"credit"|"investment"|"loan">("bank"); const [accVis,setAccVis]=useState<"private"|"shared">("shared"); const [accInit,setAccInit]=useState("0"); const [editingAcc,setEditingAcc]=useState<number|null>(null); const [showAccPreview,setShowAccPreview]=useState(false); const [accCurrency,setAccCurrency]=useState(""); const [accCurrencyPendingSql,setAccCurrencyPendingSql]=useState(false);
  // Moneda de la cuenta (alcance B): libre entre MXN/USD/EUR, sin
  // importar la moneda del hogar; por defecto, la del hogar ("" = sin
  // elegir todavía). El saldo inicial se escribe en la moneda de la
  // cuenta. El aviso con la tasa aparece solo si difiere del hogar.
  const accCurrencyEffective: HouseholdCurrency = (accCurrency as HouseholdCurrency) || hhCur;
  const accRate: ExchangeRateInfo | null = accCurrencyEffective !== hhCur ? findStoredRate(data?.exchangeRates ?? null, accCurrencyEffective, hhCur) : null;
  const accNotice: string | null = accCurrencyEffective !== hhCur ? (accountRateNotice(accCurrencyEffective, hhCur, accRate) ?? accountRateNoticePending(accCurrencyEffective, hhCur)) : null;
  const saveAcc=useMutation({mutationFn:async()=>await api.saveAccount({id:editingAcc??undefined,householdId:data!.household!.id,name:accFormName,type:accType,visibility:accVis,initialBalance:Number(accInit)||0,currency:accCurrencyEffective}),onSuccess:(r)=>{inv();setAccFormName("");setEditingAcc(null);setShowAccPreview(false);setAccCurrency("");setAccCurrencyPendingSql(r?.savedCurrency===false);logUsageEvent(data!.household!.id,"cuentas","guardar_cuenta");}});
  // Equivalente previsto de un APORTE a fondo/meta desde una cuenta
  // extranjera (el importe se escribe en la moneda de la cuenta; R3).
  // Solo aportes: un retiro sale del fondo/meta, en moneda del hogar.
  const contributionFxPreview = (amountStr: string, accountIdStr: string): string | null => {
    const acc = data?.accounts.find(a=>a.id===Number(accountIdStr));
    if (!acc || !amountStr || Number(amountStr) <= 0) return null;
    const cur = (acc.currency as HouseholdCurrency) ?? hhCur;
    if (cur === hhCur) return null;
    const rate = findStoredRate(data?.exchangeRates ?? null, cur, hhCur);
    if (!rate) return "El tipo de cambio del día se aplicará al guardar.";
    const equiv = previewEquivalent(Number(amountStr), rate);
    const label = equiv != null ? fxLabel(Number(amountStr), cur, equiv, hhCur) : null;
    const notice = movementRateNotice(cur, hhCur, rate.rate, rate.date);
    return [label, notice].filter(Boolean).join(" · ");
  };
  const delAcc=useMutation({mutationFn:async(id:number)=>await api.deleteAccount({id}),onSuccess:()=>{inv();setDeleteAccountPreviewId(null);}});

  // Arqueo de cuentas (auditoría): lo contado en físico por cada cuenta y
  // en efectivo, contra lo que dice la app. La diferencia se calcula en
  // pantalla y el servidor la vuelve a calcular al guardar.
  const [ccOpen,setCcOpen]=useState(false); const [ccCounted,setCcCounted]=useState<Record<string,string>>({}); const [ccNote,setCcNote]=useState(""); const [ccError,setCcError]=useState(""); const [ccExpanded,setCcExpanded]=useState<number|null>(null);
  const saveCc=useMutation({mutationFn:async()=>{ const lines: {accountId:number|null;counted:number}[] = []; const cash=ccCounted["cash"]; if(cash!=null && cash!=="" && Number(cash)>=0) lines.push({accountId:null,counted:Number(cash)}); for(const a of data!.accounts){ const v=ccCounted[`acc-${a.id}`]; if(v!=null && v!=="" && Number(v)>=0) lines.push({accountId:a.id,counted:Number(v)}); } if(lines.length===0) throw new Error("Anote al menos una cantidad contada."); return await api.saveCashCount({householdId:data!.household!.id,lines,note:ccNote}); },onSuccess:()=>{inv(); qc.invalidateQueries({queryKey:["cashCounts"]}); setCcCounted({}); setCcNote(""); setCcError(""); setCcOpen(false); },onError:(e:Error)=>{setCcError(e.message);}});

  // budget
  const [budCat,setBudCat]=useState(""); const [budMonth,setBudMonth]=useState(monthNow()); const [budAmount,setBudAmount]=useState(""); const [budVis,setBudVis]=useState<"private"|"shared">("shared");
  // Subcategoría (vacío = toda la categoría) y gastos ya capturados:
  // por defecto NO se incluyen (el presupuesto nace como nuevo, como
  // pidió Heriberto). El servidor dice si quedaron guardados
  // (saved:false cuando falta correr su SQL).
  const [budSub,setBudSub]=useState(""); const [budIncludePrior,setBudIncludePrior]=useState(false); const [budPendingSql,setBudPendingSql]=useState(false);
  const [budStartDate,setBudStartDate]=useState(todayISO()); const [budStartDatePendingSql,setBudStartDatePendingSql]=useState(false);
  const [budEditId,setBudEditId]=useState<number|null>(null);
  const saveBud=useMutation({mutationFn:async(opts?:{startDateOverride?:string})=>{const effStart=opts?.startDateOverride ?? budStartDate;return await api.saveBudget({id:budEditId??undefined,householdId:data!.household!.id,categoryId:Number(budCat),month:budMonth,amount:Number(budAmount)||0,visibility:budVis,subcategory:budSub||undefined,includePriorExpenses:budIncludePrior,startDate:(!budIncludePrior && effStart!==todayISO())?effStart:undefined});},onSuccess:(r)=>{inv();setBudEditId(null);setBudAmount("");setBudSub("");setBudIncludePrior(false);setBudStartDate(todayISO());setBudBackfillOpen(false);setBudPendingSql(r?.saved===false);setBudStartDatePendingSql(r?.savedStartDate===false);logUsageEvent(data!.household!.id,"presupuestos","guardar_presupuesto");}});
  const [budBackfillOpen,setBudBackfillOpen]=useState(false);
  // Gastos ya registrados que entrarían al presupuesto nuevo (2026-11-25):
  // con fecha de inicio pasada y sin «suma todo», la ventana es [inicio,
  // ahora] por fecha de captura. Se listan con el espejo del reclamo
  // (applicableBudget con el presupuesto nuevo como hipotético) para que
  // la lista sea la misma que el servidor contaría. Solo el mes visible
  // trae las filas completas: para otro mes la lista queda vacía y el
  // formulario guarda directo. Solo para un presupuesto NUEVO (sin uno
  // igual ya creado): al actualizar uno existente no se pregunta, el
  // cambio de ventana aplica directo. Si la lista no está vacía, el
  // formulario no guarda directo: abre el pop-up de revisión.
  const budBackfill = useMemo(() => {
    if (!data || budIncludePrior || !budCat || !budMonth) return [];
    const start = budStartDate;
    if (!start || start >= todayISO()) return [];
    const catId = Number(budCat);
    if (data.budgets.some(b => b.categoryId === catId && b.month === budMonth && (b.subcategory ?? null) === (budSub || null))) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const nowMs = Date.now();
    const fake = { id: -999, categoryId: catId, month: budMonth, subcategory: budSub || null, amount: Number(budAmount) || 0, spent: 0, remaining: 0, pct: 0, visibility: budVis, includePriorExpenses: false, startDate: start } as unknown as (typeof data.budgets)[number];
    const hypo = { ...data, budgets: [...data.budgets, fake] };
    return data.movements.filter(m => (m.type === "expense" || m.type === "debt_payment") && !m.isReversed && m.reversalOfId == null && m.categoryId === catId && m.date.slice(0, 7) === budMonth && applicableBudget(hypo, { type: m.type as "expense" | "debt_payment", amount: m.amount, categoryId: m.categoryId, concept: m.concept, date: m.date, subcategory: m.subcategory ?? null, budgetId: m.budgetId ?? null })?.id === -999 && (m.createdAt ? (new Date(m.createdAt).getTime() >= startMs && new Date(m.createdAt).getTime() <= nowMs) : m.date >= start));
  }, [data, budCat, budSub, budMonth, budAmount, budVis, budIncludePrior, budStartDate]);
  const [deleteBudgetPreviewId,setDeleteBudgetPreviewId]=useState<number|null>(null);
  const [deleteAccountPreviewId,setDeleteAccountPreviewId]=useState<number|null>(null);
  const delBud=useMutation({mutationFn:async(id:number)=>await api.deleteBudget({id}),onSuccess:()=>{inv();setDeleteBudgetPreviewId(null);}});

  // category
  const [catFormName,setCatFormName]=useState(""); const [catKind,setCatKind]=useState<"income"|"expense">("expense"); const [catSubs,setCatSubs]=useState("");
  const saveCat=useMutation({mutationFn:async()=>await api.saveCategory({householdId:data!.household!.id,name:catFormName,kind:catKind,subcategories:catSubs.split(",").map(s=>s.trim()).filter(Boolean),isActive:1}),onSuccess:()=>{inv();setCatFormName("");setCatSubs("");}});

  // fund
  const [fundName,setFundName]=useState(""); const [fundTarget,setFundTarget]=useState(""); const [fundDate,setFundDate]=useState(""); const [fundImportance,setFundImportance]=useState("3"); const [fundAmt,setFundAmt]=useState<Record<number,string>>({});
  // Cuenta y modo (Aportar/Retirar) por fondo: todo movimiento de fondo
  // exige cuenta, con la etiqueta según el modo.
  const [fundAcc,setFundAcc]=useState<Record<number,string>>({}); const [fundAccError,setFundAccError]=useState<Record<number,string>>({}); const [fundMode,setFundMode]=useState<Record<number,"contribution"|"withdrawal">>({}); const [fundWithdrawPreviewId,setFundWithdrawPreviewId]=useState<number|null>(null);
  // Fecha límite e importancia del fondo: el servidor dice si quedaron
  // guardadas (saved:false cuando falta correr su SQL).
  const [fundDatePendingSql,setFundDatePendingSql]=useState(false); const [fundImpPendingSql,setFundImpPendingSql]=useState(false);
  // Edición de un fondo ya creado (meta y fecha límite).
  const [fundEditId,setFundEditId]=useState<number|null>(null); const [fundEditTarget,setFundEditTarget]=useState(""); const [fundEditDate,setFundEditDate]=useState(""); const [fundEditDatePendingSql,setFundEditDatePendingSql]=useState(false);
  // Importancia 1–5 de un fondo (editor «Cambiar», igual que en metas).
  const [impEditFundId,setImpEditFundId]=useState<number|null>(null); const [impEditFundValue,setImpEditFundValue]=useState("3");
  // Aporte rápido a un fondo desde Inicio (tarjeta fijada y lista).
  const [quickFundId,setQuickFundId]=useState<number|null>(null); const [quickFundAmt,setQuickFundAmt]=useState(""); const [quickFundAcc,setQuickFundAcc]=useState(""); const [quickFundAccError,setQuickFundAccError]=useState("");
  // Detalle de un fondo en Inicio (pop-up): la lista compacta de
  // «Fondos» ya no abre el formulario en línea, abre este modal con el
  // plan completo, como el detalle de la dona.
  const [fundDetailId,setFundDetailId]=useState<number|null>(null);
  // Frecuencia elegida por fondo (día/semana/mes): se guarda en el
  // dispositivo (localStorage); sin ella, Por día.
  const [fundFreq,setFundFreq]=useState<Record<number,FundFrequency>>({});
  const fundFrequency=(id:number):FundFrequency=>fundFreq[id] ?? readFundFrequency(id);
  const chooseFundFrequency=(id:number,freq:FundFrequency)=>{ writeFundFrequency(id,freq); setFundFreq(prev=>({...prev,[id]:freq})); };
  const closeFundDetail=()=>{ setFundDetailId(null); setQuickFundId(null); setQuickFundAmt(""); setQuickFundAcc(""); setQuickFundAccError(""); };
  const saveFund=useMutation({mutationFn:async()=>await api.saveFund({householdId:data!.household!.id,name:fundName,targetAmount:fundTarget?Number(fundTarget):null,targetDate:fundDate||undefined,visibility:"shared",importance:Number(fundImportance)||3}),onSuccess:(r)=>{inv();setFundDatePendingSql(r.savedDate===false);setFundImpPendingSql(r.savedImportance===false);setFundName("");setFundTarget("");setFundDate("");setFundImportance("3");logUsageEvent(data!.household!.id,"fondos","guardar_fondo");}});
  const updateFund=useMutation({mutationFn:async(v:{id:number;targetAmount:number|null;targetDate:string})=>await api.saveFund({id:v.id,householdId:data!.household!.id,name:data!.funds.find(f=>f.id===v.id)?.name ?? "",targetAmount:v.targetAmount,targetDate:v.targetDate,visibility:"shared"}),onSuccess:(r)=>{inv();setFundEditDatePendingSql(r.savedDate===false);setFundEditId(null);logUsageEvent(data!.household!.id,"fondos","guardar_fondo");}});
  const setFundImp=useMutation({mutationFn:async(v:{id:number;importance:number})=>await api.setFundImportance(v)});
  const fundMove=useMutation({mutationFn:async(v:{fundId:number;type:"contribution"|"withdrawal";amount:number;accountId:number})=>await api.addFundMovement({householdId:data!.household!.id,fundId:v.fundId,type:v.type,amount:v.amount,date:todayISO(),accountId:v.accountId}),onSuccess:(_,v)=>{inv();setFundAmt(a=>({...a,[v.fundId]:""}));setFundAcc(a=>({...a,[v.fundId]:""}));setFundAccError(a=>({...a,[v.fundId]:""}));setFundWithdrawPreviewId(null);logUsageEvent(data!.household!.id,"fondos",v.type==="withdrawal"?"retirar_meta":"aportar_meta");}});
  const delFund=useMutation({mutationFn:async(id:number)=>await api.deleteFund({id}),onSuccess:()=>{inv();setConfirmDelFundId(null);}});

  // goal
  const [goalName,setGoalName]=useState(""); const [goalTarget,setGoalTarget]=useState(""); const [goalDate,setGoalDate]=useState(""); const [goalSaved,setGoalSaved]=useState("0"); const [goalImportance,setGoalImportance]=useState("3"); const [goalAdd,setGoalAdd]=useState<Record<number,string>>({}); const [goalAddAcc,setGoalAddAcc]=useState<Record<number,string>>({}); const [goalAddAccError,setGoalAddAccError]=useState<Record<number,string>>({}); const [quickBud,setQuickBud]=useState<number|null>(null); const [quickBudAmt,setQuickBudAmt]=useState(""); const [quickBudAcc,setQuickBudAcc]=useState(""); const [quickBudAccError,setQuickBudAccError]=useState(""); const [payBudAssignPendingSql,setPayBudAssignPendingSql]=useState(false); const [quickGoal,setQuickGoal]=useState<number|null>(null); const [quickGoalAmt,setQuickGoalAmt]=useState(""); const [quickGoalAcc,setQuickGoalAcc]=useState(""); const [quickGoalAccError,setQuickGoalAccError]=useState(""); const [quickPat,setQuickPat]=useState<number|null>(null); const [quickPatVal,setQuickPatVal]=useState(""); const [confirmDelGoalId,setConfirmDelGoalId]=useState<number|null>(null); const [confirmDelFundId,setConfirmDelFundId]=useState<number|null>(null); const [accSummaryOpen,setAccSummaryOpen]=useState<number|null>(null); const [impEditGoalId,setImpEditGoalId]=useState<number|null>(null); const [impEditValue,setImpEditValue]=useState("3"); const [impPendingSql,setImpPendingSql]=useState(false);
  // Retirar de una meta: formulario espejo del de aportar, con su cuenta
  // de regreso.
  const [withdrawGoalId,setWithdrawGoalId]=useState<number|null>(null); const [withdrawGoalAmt,setWithdrawGoalAmt]=useState(""); const [withdrawGoalAcc,setWithdrawGoalAcc]=useState(""); const [withdrawGoalAccError,setWithdrawGoalAccError]=useState(""); const [goalWithdrawPreviewId,setGoalWithdrawPreviewId]=useState<number|null>(null);
  // Plan de la meta nueva: aporte mensual (vacío = se calcula del plazo),
  // plazo en meses, día del mes y cuenta del dinero ya ahorrado.
  const [goalMonthly,setGoalMonthly]=useState(""); const [goalMonths,setGoalMonths]=useState(""); const [goalDueDay,setGoalDueDay]=useState(""); const [goalInitialAcc,setGoalInitialAcc]=useState(""); const [goalFormError,setGoalFormError]=useState("");
  // Detalle de la gráfica de ingresos vs gastos: tipo y mes tocados.
  const [incExpDetail,setIncExpDetail]=useState<{kind:"income"|"expense";month:string;label:string}|null>(null);
  // Vista del detalle de ingresos/gastos: «Por cuenta» (grupos por cuenta,
  // la vista por defecto) o «Por fecha» (una sola lista cronológica).
  const [incExpView,setIncExpView]=useState<IncExpDetailView>("cuenta");
  const [catDetail,setCatDetail]=useState<{categoryId:number|null;name:string;total:number;month:string;pct:number}|null>(null);
  // Consejo («coquito») de un presupuesto: no es texto adicional — un
  // iconito de alerta junto al renglón abre este pop-up con el consejo.
  // Excedido: bajar el gasto y moverlo a la meta (consejo, sin mover
  // nada: ese dinero aún no existe). Sobrante: el sobrante sí se puede
  // proponer mover con el flujo existente (proposeSpendingAdjustment);
  // nada se mueve sin el toque del usuario.
  type Coquito={kind:"excedido"|"sobrante";catName:string;budgetId:number;amount:number;goalId:number|null};
  const [coquito,setCoquito]=useState<Coquito|null>(null);
  const [coquitoDone,setCoquitoDone]=useState(false);
  const [coquitoError,setCoquitoError]=useState("");
  // «Nueva meta» forzada abierta (el botón «Crear meta» del consejo):
  // null = comportamiento normal (abierta si no hay metas).
  const [newGoalOpen,setNewGoalOpen]=useState<boolean|null>(null);
  const closeCoquito=()=>{ setCoquito(null); setCoquitoDone(false); setCoquitoError(""); };
  const openCoquitoForBudget=(b:{id:number;categoryId:number;month:string;amount:number;spent:number;remaining:number},kind:"excedido"|"sobrante")=>{
    setCoquitoError(""); setCoquitoDone(false);
    setCoquito({kind,catName:getCatName(b.categoryId),budgetId:b.id,amount:Math.abs(b.remaining),goalId:pickTipGoal(data?.goals ?? [],data?.goalPlans ?? [],data?.fundMovements ?? [],s.currentMonth)?.id ?? null});
  };
  const [showMoneyLocation,setShowMoneyLocation]=useState(false);
  const [showSummary,setShowSummary]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [planWizardOpen,setPlanWizardOpen]=useState(false);
  const [showAllHomeMovs,setShowAllHomeMovs]=useState(false);
  // Toda meta nace con su plan: una sola acción crea meta + fondo + plan.
  const saveGoalWithPlan=useMutation({mutationFn:async()=>await api.saveGoalWithPlan({householdId:data!.household!.id,name:goalName,targetAmount:Number(goalTarget)||0,savedAmount:Number(goalSaved)||0,targetDate:goalDate||undefined,visibility:"shared",monthlyAmount:goalMonthly?Number(goalMonthly):undefined,months:Number(goalMonths)||0,dueDay:Number(goalDueDay)||data!.household!.cutoffDay,initialAccountId:goalInitialAcc?Number(goalInitialAcc):null,importance:Number(goalImportance)||3}),onSuccess:()=>{inv();setGoalName("");setGoalTarget("");setGoalSaved("0");setGoalDate("");setGoalMonthly("");setGoalMonths("");setGoalDueDay("");setGoalInitialAcc("");setGoalImportance("3");setGoalFormError("");logUsageEvent(data!.household!.id,"metas","guardar_meta");},onError:(e:Error)=>{setGoalFormError(e.message);}});
  const addGoal=useMutation({mutationFn:async(v:{id:number;amount:number;accountId:number})=>await api.addGoalSaving(v),onSuccess:(_,v)=>{inv();setGoalAdd(a=>({...a,[v.id]:""}));setGoalAddAcc(a=>({...a,[v.id]:""}));setGoalAddAccError(a=>({...a,[v.id]:""}));logUsageEvent(data!.household!.id,"metas","aportar_meta");}});
  const payBudget=useMutation({mutationFn:async(v:{categoryId:number;categoryName:string;subcategory?:string;budgetId?:number;visibility:string;amount:number;accountId:number|null})=>{ const payAcc = data?.accounts.find(a=>a.id===v.accountId); const payCur = (payAcc?.currency as HouseholdCurrency) ?? hhCur; return await api.saveMovement({householdId:data!.household!.id,type:"expense",amount:v.amount,currency:payCur,concept:`Pago · ${v.categoryName}`,accountId:v.accountId,categoryId:v.categoryId,subcategory:v.subcategory,budgetId:v.budgetId,date:todayISO(),visibility:v.visibility as "private"|"shared",profileId:me?me.id:null}); },onSuccess:(r,v)=>{ const payAcc = data?.accounts.find(a=>a.id===v.accountId); const payCur = (payAcc?.currency as HouseholdCurrency) ?? hhCur; const payRate = payCur !== hhCur ? findStoredRate(data?.exchangeRates ?? null, payCur, hhCur) : null; const payEquiv = payRate ? previewEquivalent(v.amount, payRate) : null; const saved:SavedMovement={id:r?.id ?? 0,type:"expense",amount:payEquiv ?? v.amount,concept:`Pago · ${v.categoryName}`,accountId:v.accountId,toAccountId:null,categoryId:v.categoryId,subcategory:v.subcategory ?? null,budgetId:v.budgetId ?? null,splitGroupId:null,originalAmount:payCur!==hhCur?v.amount:null,originalCurrency:payCur!==hhCur?payCur:null,exchangeRate:payRate?.rate ?? null,exchangeRateDate:payRate?.date ?? null,transferToAmount:null,date:todayISO(),visibility:v.visibility,profileId:me?me.id:null};projectMovementChange({kind:"create",movement:saved});refreshAfterMovementSave();if(r?.savedBudgetAssignment===false){setPayBudAssignPendingSql(true);}else{setPayBudAssignPendingSql(false);setQuickBud(null);setQuickBudAmt("");setQuickBudAcc("");logUsageEvent(data!.household!.id,"presupuestos","guardar_movimiento");}}});
  const contributeGoal=useMutation({mutationFn:async(v:{id:number;amount:number;accountId:number})=>await api.addGoalSaving(v),onSuccess:()=>{inv();setQuickGoal(null);setQuickGoalAmt("");setQuickGoalAcc("");setQuickGoalAccError("");logUsageEvent(data!.household!.id,"metas","aportar_meta");}});
  const withdrawGoal=useMutation({mutationFn:async(v:{id:number;amount:number;accountId:number})=>await api.addGoalSaving({id:v.id,amount:-v.amount,accountId:v.accountId}),onSuccess:()=>{inv();setWithdrawGoalId(null);setWithdrawGoalAmt("");setWithdrawGoalAcc("");setWithdrawGoalAccError("");setGoalWithdrawPreviewId(null);logUsageEvent(data!.household!.id,"metas","retirar_meta");}});
  const updatePat=useMutation({mutationFn:async(v:{id:number;name:string;kind:string;category:string;value:number;owner:string|null})=>await api.savePatrimony({id:v.id,householdId:data!.household!.id,name:v.name,kind:v.kind as "asset"|"liability",category:v.category,value:v.value,owner:v.owner??undefined}),onSuccess:()=>{inv();setQuickPat(null);setQuickPatVal("");}});
  const delGoal=useMutation({mutationFn:async(id:number)=>await api.deleteGoal({id}),onSuccess:()=>{inv();setConfirmDelGoalId(null);}});
  // Importancia 1–5 (G): el servidor dice si se guardó (saved:false
  // cuando falta correr supabase/add-goals-importance.sql).
  const setImp=useMutation({mutationFn:async(v:{id:number;importance:number})=>await api.setGoalImportance(v)});

  // plan de ahorro para una meta
  const [planGoalId,setPlanGoalId]=useState<number|null>(null);
  const [planResult,setPlanResult]=useState<Awaited<ReturnType<typeof api.analyzeGoalPlan>>|null>(null);
  const [planMonths,setPlanMonths]=useState("");
  const [planError,setPlanError]=useState("");
  // Cuenta del saldo inicial al armar el plan de una meta vieja sin plan.
  const [planInitialAcc,setPlanInitialAcc]=useState(""); const [planInitialAccError,setPlanInitialAccError]=useState("");
  const analyzePlan=useMutation({mutationFn:async(v:{goalId:number;months?:number})=>{ const g=data!.goals.find(x=>x.id===v.goalId)!; return await api.analyzeGoalPlan({householdId:data!.household!.id,goalId:g.id,name:g.name,targetAmount:g.targetAmount,savedAmount:g.savedAmount,targetDate:g.targetDate??undefined,months:v.months}); },onSuccess:(r,v)=>{setPlanGoalId(v.goalId);setPlanResult(r);setPlanMonths(String(r.months));setPlanError("");setPlanInitialAcc("");setPlanInitialAccError("");},onError:(e:Error)=>{setPlanError(e.message);}});
  const acceptPlan=useMutation({mutationFn:async(v:{goalId:number;monthlyAmount:number;months:number;dueDay:number;initialAccountId?:number|null})=>await api.acceptGoalPlan({householdId:data!.household!.id,...v}),onSuccess:()=>{inv();setPlanResult(null);setPlanGoalId(null);setPlanInitialAcc("");setPlanInitialAccError("");},onError:(e:Error)=>{setPlanError(e.message);}});

  // ajuste automático de gastos para llegar a la meta
  type AdjAnalysis = Awaited<ReturnType<typeof api.analyzeSpendingAdjustment>>;
  const [adjGoalId,setAdjGoalId]=useState<number|null>(null);
  const [adjAnalysis,setAdjAnalysis]=useState<AdjAnalysis|null>(null);
  const [adjError,setAdjError]=useState("");
  const [adjCuts,setAdjCuts]=useState<Record<number,string>>({});
  const [adjPropCuts,setAdjPropCuts]=useState<Record<number,Record<number,string>>>({});
  const analyzeAdj=useMutation({mutationFn:async(goalId:number)=>await api.analyzeSpendingAdjustment({householdId:data!.household!.id,goalId}),onSuccess:(r,v)=>{setAdjGoalId(v);setAdjAnalysis(r);setAdjCuts(Object.fromEntries(r.cuts.map(c=>[c.budgetId,String(c.cut)])));setAdjError("");},onError:(e:Error)=>{setAdjError(e.message);}});
  const proposeAdj=useMutation({mutationFn:async(v:{goalId:number;kind:"recorte"|"sobrante";cuts?:{budgetId:number;amount:number}[]})=>await api.proposeSpendingAdjustment({householdId:data!.household!.id,...v}),onSuccess:()=>{inv();setAdjAnalysis(null);setAdjGoalId(null);},onError:(e:Error)=>{setAdjError(e.message);}});
  const acceptAdj=useMutation({mutationFn:async(v:{id:number;cuts?:{budgetId:number;amount:number}[]})=>await api.acceptSpendingAdjustment(v),onSuccess:()=>{inv();},onError:(e:Error)=>{setAdjError(e.message);}});
  const rejectAdj=useMutation({mutationFn:async(id:number)=>await api.rejectSpendingAdjustment({id}),onSuccess:()=>{inv();},onError:(e:Error)=>{setAdjError(e.message);}});

  // agreement
  const [agTitle,setAgTitle]=useState(""); const [agDesc,setAgDesc]=useState(""); const [showAgPreview,setShowAgPreview]=useState(false);
  const saveAg=useMutation({mutationFn:async()=>await api.saveAgreement({householdId:data!.household!.id,title:agTitle,description:agDesc}),onSuccess:()=>{inv();setAgTitle("");setAgDesc("");setShowAgPreview(false);}});
  const [rejectAgreementPreviewId,setRejectAgreementPreviewId]=useState<number|null>(null); const [deleteAgreementPreviewId,setDeleteAgreementPreviewId]=useState<number|null>(null);
  const voteAg=useMutation({mutationFn:async(v:{agreementId:number;vote:"approve"|"reject"})=>{ const ownAdult=data!.profiles.find(p=>p.id===(data!.myProfileId ?? null) && p.kind==="adult") ?? (me && me.kind==="adult" ? me : null); if(!ownAdult) throw new Error("No tiene un perfil adulto para votar."); return await api.voteAgreement({agreementId:v.agreementId,profileId:ownAdult.id,vote:v.vote,householdId:data!.household!.id}); },onSuccess:()=>{inv();setRejectAgreementPreviewId(null);}});
  const delAg=useMutation({mutationFn:async(id:number)=>await api.deleteAgreement({id}),onSuccess:()=>{inv();setDeleteAgreementPreviewId(null);}});

  // patrimony
  const [patName,setPatName]=useState(""); const [patKind,setPatKind]=useState<"asset"|"liability">("asset"); const [patCat,setPatCat]=useState(""); const [patValue,setPatValue]=useState(""); const [patOwner,setPatOwner]=useState("");
  const savePat=useMutation({mutationFn:async()=>await api.savePatrimony({householdId:data!.household!.id,name:patName,kind:patKind,category:patCat,value:Number(patValue)||0,owner:patOwner||undefined}),onSuccess:()=>{inv();setPatName("");setPatValue("");}});
  const delPat=useMutation({mutationFn:async(id:number)=>await api.deletePatrimony({id}),onSuccess:inv});

  // profile
  const [profName,setProfName]=useState(""); const [profKind,setProfKind]=useState<"adult"|"dependent">("adult"); const [profType,setProfType]=useState("Hijo/a"); const [profIncome,setProfIncome]=useState("0"); const [profFixed,setProfFixed]=useState("0"); const [profEmail,setProfEmail]=useState("");
  const saveProf=useMutation({mutationFn:async()=>await api.saveProfile({householdId:data!.household!.id,name:profName,lastName:profLast,kind:profKind,dependentType:profKind==="dependent"?profType:undefined,monthlyIncome:Number(profIncome)||0,fixedCommitments:Number(profFixed)||0,email:profEmail||undefined}),onSuccess:()=>{inv();setProfName("");}});
  const delProf=useMutation({mutationFn:async(id:number)=>await api.deleteProfile({id}),onSuccess:()=>{inv();setConfirmDeleteProfId(null);}});

  // household edit
  const [editName,setEditName]=useState(""); const [editMode,setEditMode]=useState<"personal"|"familiar">("familiar"); const [editCutoff,setEditCutoff]=useState("1"); const [editContrib,setEditContrib]=useState<"equal"|"proportional">("equal"); const [editApproval,setEditApproval]=useState<"unanimous"|"majority">("unanimous"); const [editThreshold,setEditThreshold]=useState("1500"); const [editCurrency,setEditCurrency]=useState<HouseholdCurrency|"">("");
  const saveHh=useMutation({mutationFn:async()=>await api.updateHousehold({id:data!.household!.id,mode:editMode,name:editName||data!.household!.name,currency:editCurrency||(data!.household!.currency as HouseholdCurrency)||"MXN",cutoffDay:Number(editCutoff)||1,contributionRule:editContrib,approvalRule:editApproval,approvalThreshold:Number(editThreshold)||0}),onSuccess:inv});
  const demo=useMutation({mutationFn:async()=>await api.loadDemo({householdId:data!.household!.id}),onSuccess:inv});
  // Reinicio completo de la aplicación (botón dentro del menú desplegable de módulos)
  const [resetStep,setResetStep]=useState(0); const [resetWord,setResetWord]=useState(""); const [resetDone,setResetDone]=useState(false);
  const resetAll=useMutation({mutationFn:async()=>await api.resetAllData({householdId:data!.household!.id}),onSuccess:()=>{ inv(); setResetDone(true); setResetStep(0); setResetWord(""); setMenuOpen(false); setTab("inicio"); pickProfile(null); clearStoredHousehold(); setActiveHouseholdId(null); setObStep(0); setObError(""); setHhName("Mi hogar"); setOwnerName(""); setOwnerLast(""); setOwnerIncome(""); setModeModalShown(false); setModeModalOpen(false); setFirstGuideOpen(false); setChartsSeen(false); try{ localStorage.removeItem("sf-install-dismissed"); localStorage.removeItem("sf-first-guide-pending"); localStorage.removeItem("sf-guide-charts-seen"); localStorage.removeItem("sf-pin-hash"); sessionStorage.removeItem("sf-pin-unlocked"); localStorage.removeItem("sf-periodic-alerts-date"); }catch{} }});
  // personal
  const [salaryInput,setSalaryInput]=useState(""); const [persAmt,setPersAmt]=useState(""); const [persConcept,setPersConcept]=useState(""); const [persCat,setPersCat]=useState(""); const [persAccount,setPersAccount]=useState(""); const [persAccountError,setPersAccountError]=useState(""); const [persStep,setPersStep]=useState(1);
  const saveSalary=useMutation({mutationFn:async()=>await api.updatePersonalSalary({householdId:data!.household!.id,salary:Number(salaryInput)||0}),onSuccess:inv});
  const savePersExp=useMutation({mutationFn:async()=>{ const persAcc = data?.accounts.find(a=>a.id===Number(persAccount)); const persCur = (persAcc?.currency as HouseholdCurrency) ?? hhCur; return await api.saveMovement({householdId:data!.household!.id,type:"expense",amount:Number(persAmt),currency:persCur,concept:persConcept||"Gasto del día",accountId:persAccount?Number(persAccount):null,categoryId:persCat&&persCat!=="__new__"?Number(persCat):null,date:todayISO(),visibility:"private",profileId:me?me.id:null,receipt:persReceipt?{dataBase64:persReceipt.dataBase64,mimeType:persReceipt.mimeType}:undefined}); },onSuccess:(r)=>{ const persAcc = data?.accounts.find(a=>a.id===Number(persAccount)); const persCur = (persAcc?.currency as HouseholdCurrency) ?? hhCur; const persRate = persCur !== hhCur ? findStoredRate(data?.exchangeRates ?? null, persCur, hhCur) : null; const persEquiv = persRate ? previewEquivalent(Number(persAmt), persRate) : null; const saved:SavedMovement={id:r?.id ?? 0,type:"expense",amount:persEquiv ?? Number(persAmt),concept:persConcept||"Gasto del día",accountId:persAccount?Number(persAccount):null,toAccountId:null,categoryId:persCat&&persCat!=="__new__"?Number(persCat):null,subcategory:null,budgetId:null,splitGroupId:null,originalAmount:persCur!==hhCur?Number(persAmt):null,originalCurrency:persCur!==hhCur?persCur:null,exchangeRate:persRate?.rate ?? null,exchangeRateDate:persRate?.date ?? null,transferToAmount:null,date:todayISO(),visibility:"private",profileId:me?me.id:null};projectMovementChange({kind:"create",movement:saved});refreshAfterMovementSave();resetPersForm();logUsageEvent(data!.household!.id,"personal","guardar_movimiento");}});
  // Mike dinámico: preguntas con cifras reales del mes que se está viendo,
  // calculadas en el dispositivo con los datos ya cargados (sin llamadas nuevas
  // ni servicios externos). Las respuestas usan solo los movimientos que el
  // usuario ya ve en pantalla (en Familiar, compartidos más sus privados).
  const dynamicFaqs = useMemo(() => data ? dynamicHelpFaqs(data) : [], [data]);
  // Avisos de Mike: al abrir Movimientos o Gasto del día, si un
  // presupuesto está cerca de su límite o un plan de ahorro está en
  // riesgo, Mike lo detecta. Ya no sale ninguna burbuja en automático:
  // el aviso solo enciende el foco encima de la estrella (una vez por
  // sesión cada aviso, ver ./lib/helpDynamic). Al tocar la estrella se
  // abre el chat, donde está el mensaje de apertura.
  const [activeNudge, setActiveNudge] = useState<HelpNudge | null>(null);
  useEffect(() => {
    if (!data?.household) return;
    const n = pickHelpNudge(data, tab, loadNudgeShown());
    if (n) { markNudgeShown(n.id); setActiveNudge(cur => (cur && cur.id === n.id ? cur : n)); }
    else setActiveNudge(cur => (cur === null ? cur : null));
  }, [data, tab]);
  // Mike aprende del uso: al cargar el resumen, anota en el dispositivo
  // qué categorías se pasaron de presupuesto este mes y qué conceptos se
  // repiten (ver ./lib/helpDynamic). No se envía nada fuera del dispositivo.
  useEffect(() => { if (data) recordHelpLearning(data); }, [data]);
  // Revisión en vivo de lo que el usuario está capturando: presupuesto
  // restante, posible duplicado y monto sobre el promedio de la categoría.
  // Son solo avisos: nunca bloquean el guardado.
  const mvReview = useMemo(() => data ? reviewMovement(data, { type: mvType, amount: Number(mvAmount) || 0, categoryId: mvCat && mvCat!=="__new__" ? Number(mvCat) : null, subcategory: mvSub || null, budgetId: mvBudget, concept: mvConcept, date: mvDate, excludeId: editingMv ?? undefined }) : [], [data, mvType, mvAmount, mvCat, mvSub, mvBudget, mvConcept, mvDate, editingMv]);
  // Pregunta de asignación al meter el gasto (2026-11-24 con dos
  // presupuestos; 2026-11-25 también con uno solo): el gasto coincide con
  // un presupuesto general, uno de subcategoría, o los dos. La elección
  // (mvBudget) es el id del presupuesto elegido; -1 es «gastos generales»
  // (no cuenta en ningún presupuesto); null es no elegir (mandan las
  // reglas de reclamo, que asignan el gasto al presupuesto que coincida).
  const mvMonth = mvDate.slice(0, 7);
  const mvBudgetQuestion = useMemo(() => {
    if ((mvType !== "expense" && mvType !== "debt_payment") || !mvCat || mvCat === "__new__" || !data) return null;
    const catId = Number(mvCat);
    const general = data.budgets.find(b => b.categoryId === catId && b.month === mvMonth && b.subcategory == null) ?? null;
    const sub = mvSub && mvSub !== "__new__" ? data.budgets.find(b => b.categoryId === catId && b.month === mvMonth && b.subcategory === mvSub) ?? null : null;
    if (general && sub) return { kind: "both" as const, general, sub };
    if (general) return { kind: "single" as const, budget: general };
    if (sub) return { kind: "single" as const, budget: sub };
    return null;
  }, [data, mvType, mvCat, mvSub, mvMonth]);
  // Al cambiar la combinación (categoría, subcategoría o mes), la
  // elección anterior solo se conserva si sigue siendo una opción de la
  // pregunta actual (un presupuesto que coincide, o -1 mientras haya
  // pregunta); si no, se limpia y mandan las reglas de reclamo. Al
  // editar, la asignación guardada del movimiento se pre-selecciona
  // (la pone el botón Editar, -1 incluido) y este efecto la valida.
  useEffect(() => {
    setMvBudget(cur => {
      if (!mvBudgetQuestion) return null;
      if (cur === -1) return -1;
      if (mvBudgetQuestion.kind === "both") return (cur === mvBudgetQuestion.general.id || cur === mvBudgetQuestion.sub.id) ? cur : null;
      return cur === mvBudgetQuestion.budget.id ? cur : null;
    });
  }, [mvBudgetQuestion]);
  const persReview = useMemo(() => data ? reviewMovement(data, { type: "expense", amount: Number(persAmt) || 0, categoryId: persCat && persCat!=="__new__" ? Number(persCat) : null, concept: persConcept, date: todayISO() }) : [], [data, persAmt, persCat, persConcept]);
  // Acceso directo para registrar un gasto rápido (?accion=nuevo-gasto):
  // al entrar con ese parámetro, después de iniciar sesión y con el espacio
  // creado, se abre el formulario de gasto con el importe listo para escribir.
  // En modo Personal es el gasto del día; en modo Familiar, el pop-up de
  // registro sobre Inicio (sin ir a Movimientos).
  const [quickExpense,setQuickExpense]=useState<boolean>(()=>{ try{ return new URLSearchParams(window.location.search).get("accion")==="nuevo-gasto"; }catch{ return false; } });
  useEffect(()=>{
    if(!quickExpense || !data?.household) return;
    setQuickExpense(false);
    try{ const u=new URL(window.location.href); u.searchParams.delete("accion"); window.history.replaceState(null,"",u.pathname+u.search+u.hash); }catch{}
    const personal=data.household.mode==="personal";
    setMenuOpen(false);
    if(personal){ setTab("personal"); setPersStep(1); window.setTimeout(()=>{ const el=document.getElementById("pers-amt"); el?.scrollIntoView({block:"center",behavior:"smooth"}); (el as HTMLInputElement|null)?.focus({preventScroll:true}); },250); }
    else { setTab("inicio"); openInicioMovement("expense"); window.setTimeout(()=>{ const el=document.getElementById("mv-amount"); el?.scrollIntoView({block:"center",behavior:"smooth"}); (el as HTMLInputElement|null)?.focus({preventScroll:true}); },250); }
  },[quickExpense,data?.household]);
  // tandas
  const [tandaName,setTandaName]=useState(""); const [tandaCount,setTandaCount]=useState("10"); const [tandaAmount,setTandaAmount]=useState(""); const [tandaStart,setTandaStart]=useState(todayISO());
  const [tandaFreq,setTandaFreq]=useState<"semanal"|"quincenal"|"mensual">("quincenal"); const [tandaDrawMode,setTandaDrawMode]=useState<"random"|"weighted">("random");
  const [tandaCoverage,setTandaCoverage]=useState<"fondo"|"prorroga"|"reparto">("fondo"); const [tandaFine,setTandaFine]=useState(""); const [tandaMeeting,setTandaMeeting]=useState("");
  const [tandaTreasurer,setTandaTreasurer]=useState(""); const [tandaSubstitute,setTandaSubstitute]=useState("");
  const [tandaKind,setTandaKind]=useState<TandaKind>("ordinaria");
  const [fundKind,setFundKind]=useState<Record<number,string>>({}); const [fundAmount,setFundAmount]=useState<Record<number,string>>({}); const [fundNote,setFundNote]=useState<Record<number,string>>({});
  const [partName,setPartName]=useState<Record<number,string>>({}); const [partCard,setPartCard]=useState<Record<number,string>>({}); const [cardInput,setCardInput]=useState<Record<number,string>>({});
  const [drawSel,setDrawSel]=useState<Record<number,"random"|"weighted">>({});
  const [tandaDetailId,setTandaDetailId]=useState<number|null>(null);
  // Al abrir el detalle de una tanda se marcan como leídos sus avisos
  // «Nuevo participante en la tanda» y sus recordatorios de pago (una
  // vez por apertura; la marca es idempotente en el servidor). Así entrar
  // a Tandas limpia el aviso aunque no se haya tocado en la campanilla.
  // Vale también para una tanda invitada: el aviso vive en el hogar del
  // invitador, así que se marca con el hogar DE LA TANDA (no con el
  // hogar activo), y el despachador permite la acción a participantes
  // de la tanda, no solo a miembros.
  const markedTandaDetailRef=useRef<number|null>(null);
  useEffect(()=>{
    if(tandaDetailId==null || !data?.household){ markedTandaDetailRef.current=null; return; }
    if(markedTandaDetailRef.current===tandaDetailId) return;
    markedTandaDetailRef.current=tandaDetailId;
    void markTandaPartNotifRead.mutateAsync({householdId:tandaHouseholdId(tandaDetailId),tandaId:tandaDetailId}).catch(()=>{});
  },[tandaDetailId, data?.household?.id]);
  const [tInvEmail,setTInvEmail]=useState<Record<number,string>>({}); const [tInvName,setTInvName]=useState<Record<number,string>>({}); const [tJoinName,setTJoinName]=useState<Record<number,string>>({});
  const [rateName,setRateName]=useState<Record<number,string>>({}); const [rateStars,setRateStars]=useState<Record<number,string>>({}); const [rateComment,setRateComment]=useState<Record<number,string>>({});
  const saveTanda=useMutation({mutationFn:async()=>await api.saveTanda({householdId:data!.household!.id,name:tandaName,participantCount:Number(tandaCount)||10,amountPerQuincena:Number(tandaAmount)||0,startDate:tandaStart,frequency:tandaFreq,drawMode:tandaDrawMode,organizerProfileId:me?me.id:null,organizerName:me?fullName(me):undefined,coverageRule:tandaCoverage,fineAmount:Number(tandaFine)||0,meetingDay:tandaMeeting,treasurerProfileId:tandaTreasurer?Number(tandaTreasurer):null,substituteProfileId:tandaSubstitute?Number(tandaSubstitute):null,kind:tandaKind}),onSuccess:()=>{inv();setTandaName("");setTandaAmount("");setTandaFine("");setTandaMeeting("");setTandaTreasurer("");setTandaSubstitute("");setTandaKind("ordinaria");}});
  const setRole=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;role:"organizador"|"tesorero"|"suplente"|"participante"})=>await api.setTandaRole(v),onSuccess:inv});
  const setFixed=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;number:number|null})=>await api.setTandaFixedNumber({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const addFine=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;reason:"retardo"|"falta"})=>await api.addTandaFine({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const payFine=useMutation({mutationFn:async(v:{tandaId:number;fineId:number;file:File})=>{ let proof:{dataBase64:string;mimeType:string}; try{ const jpeg=await imageFileToJpeg(v.file); proof={dataBase64:jpeg.dataBase64,mimeType:jpeg.mimeType}; }catch{ proof=await fileToBase64(v.file); } return await api.payTandaFine({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,fineId:v.fineId,proof}); },onSuccess:inv});
  const verifyFine=useMutation({mutationFn:async(v:{tandaId:number;fineId:number;verified:boolean})=>await api.verifyTandaFine({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const reassignTurn=useMutation({mutationFn:async(v:{tandaId:number;excludedParticipantId:number;newParticipantId:number})=>await api.reassignExcludedTurn({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const addReplacement=useMutation({mutationFn:async(v:{tandaId:number;excludedParticipantId:number;name:string;email?:string;cardLast4?:string})=>await api.addReplacementParticipant({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const voteExclude=useMutation({mutationFn:async(v:{tandaId:number;targetParticipantId:number;vote?:"excluir"|"no"})=>await api.voteExcludeParticipant({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,targetParticipantId:v.targetParticipantId,vote:v.vote ?? "excluir"}),onSuccess:inv});
  const confirmDelivery=useMutation({mutationFn:async(v:{tandaId:number;quincenaIndex:number;receiverId:number|null;by:"organizador"|"receptor"})=>await api.confirmTandaDelivery({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const addFundEntry=useMutation({mutationFn:async(v:{tandaId:number})=>await api.addTandaFundEntry({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,kind:(fundKind[v.tandaId]||"fondo") as "aportacion"|"fondo",amount:Number(fundAmount[v.tandaId])||0,note:fundNote[v.tandaId]||undefined}),onSuccess:(_r,v)=>{inv();setFundAmount(p=>({...p,[v.tandaId]:""}));setFundNote(p=>({...p,[v.tandaId]:""}));}});
  const delTanda=useMutation({mutationFn:async(id:number)=>await api.deleteTanda({id}),onSuccess:inv});
  const addPart=useMutation({mutationFn:async(v:{tandaId:number;name:string;cardLast4?:string})=>await api.addTandaParticipant({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,name:v.name,cardLast4:v.cardLast4||undefined}),onSuccess:inv});
  const removePart=useMutation({mutationFn:async(id:number)=>await api.removeTandaParticipant({id}),onSuccess:inv});
  const setCard=useMutation({mutationFn:async(v:{id:number;cardLast4:string|null})=>await api.setParticipantCard(v),onSuccess:inv});
  const drawTanda=useMutation({mutationFn:async(v:{id:number;mode:"random"|"weighted"})=>await api.drawTanda({tandaId:v.id,mode:v.mode}),onSuccess:inv});
  const setPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;status:"paid"|"pending"|"late"})=>await api.setTandaPayment({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const uploadProof=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;file:File;paidDate?:string;readAmount?:number|null})=>{ let proof:{dataBase64:string;mimeType:string}; try{ const jpeg=await imageFileToJpeg(v.file); proof={dataBase64:jpeg.dataBase64,mimeType:jpeg.mimeType}; }catch{ proof=await fileToBase64(v.file); } return await api.setTandaPayment({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,participantId:v.participantId,quincenaIndex:v.quincenaIndex,status:"paid",paidDate:v.paidDate,readAmount:v.readAmount ?? undefined,proof}); },onSuccess:inv});
  // Revisión del comprobante de pago de tanda antes de guardar: se sube la
  // foto del depósito, la lectura llena importe y fecha, y la persona revisa
  // antes de confirmar. El importe leído se compara con el pago de la tanda;
  // la fecha leída se guarda como fecha de pago (si no se lee, queda hoy).
  // Nada se guarda sin revisar: el comprobante solo se sube al confirmar.
  const [tandaProofReview,setTandaProofReview]=useState<TandaProofReview|null>(null);
  const pickTandaProof=async(v:{tandaId:number;participantId:number;participantName:string;quincenaIndex:number;file:File})=>{
    const preview=URL.createObjectURL(v.file);
    setTandaProofReview({...v,preview,detail:null,paidDate:todayISO(),busy:true,error:"",notice:"",dateCheck:null});
    try{
      const jpeg=await imageFileToJpeg(v.file);
      const text=await readReceiptText(`data:${jpeg.mimeType};base64,${jpeg.dataBase64}`);
      const parsed=parseReceiptText(text);
      if(parsed.total==null){ setTandaProofReview(r=>r?{...r,busy:false,error:"No se pudo leer el total del comprobante. Puede confirmar el pago con la foto; el organizador lo verifica."}:r); return; }
      // La fecha leída solo se aplica si es verosímil (de este año y no
      // futura). Si es de otro año o futura, queda la fecha de hoy y se
      // pide confirmar la fecha de origen del pago antes de confirmar.
      const st=parsed.date?checkReceiptDate(parsed.date,todayISO()):{status:"none" as const};
      const dateCheck=parsed.date&&st.status!=="ok"?{readDate:parsed.date,reason:st.status==="future"?"future" as const:"other-year" as const}:null;
      setTandaProofReview(r=>r?{...r,detail:parsed,paidDate:dateCheck?todayISO():(parsed.date||todayISO()),dateCheck,busy:false,notice:`Leído del comprobante${parsed.store?` · ${parsed.store}`:""}${parsed.date?` · ${fmtDate(parsed.date)}`:""}. Revise antes de confirmar.`}:r);
    }catch(err){
      const detail=err instanceof OcrError?err.detail:"";
      setTandaProofReview(r=>r?{...r,busy:false,error:(err instanceof OcrError && err.code==="load" ? "No se pudo cargar el lector en este dispositivo. Puede confirmar el pago con la foto; el organizador lo verifica." : "No se pudo leer el comprobante en este dispositivo. Puede confirmar el pago con la foto; el organizador lo verifica.")+(detail?` Detalle: ${detail}`:"")}:r);
    }
  };
  const confirmTandaProof=()=>{
    const r=tandaProofReview; if(!r) return;
    if(r.dateCheck) return;
    uploadProof.mutate({tandaId:r.tandaId,participantId:r.participantId,quincenaIndex:r.quincenaIndex,file:r.file,paidDate:r.paidDate,readAmount:r.detail?.total ?? null},{onSuccess:()=>{ setTandaProofReview(null); }});
  };
  const verifyPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;verified:boolean})=>await api.verifyTandaPayment({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  const createTandaInv=useMutation({mutationFn:async(v:{tandaId:number})=>await api.createTandaInvitation({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,email:tInvEmail[v.tandaId]||"",invitedName:tInvName[v.tandaId]||undefined}),onSuccess:(r,v)=>{inv();setTInvResult(p=>({...p,[v.tandaId]:{emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl}}));setTInvEmail(p=>({...p,[v.tandaId]:""}));setTInvName(p=>({...p,[v.tandaId]:""}));}});
  const respondTandaInv=useMutation({mutationFn:async(v:{id:number;accept:boolean;name?:string})=>await api.respondTandaInvitation({id:v.id,accept:v.accept,name:v.name ?? (tJoinName[v.id]||undefined)}),onSuccess:()=>{ inv(); }});
  const cancelTandaInv=useMutation({mutationFn:async(id:number)=>await api.cancelTandaInvitation({id}),onSuccess:inv});
  const rateOrg=useMutation({mutationFn:async(v:{tandaId:number})=>await api.rateOrganizer({householdId:tandaHouseholdId(v.tandaId),tandaId:v.tandaId,raterName:rateName[v.tandaId]||"",stars:Number(rateStars[v.tandaId]||5),comment:rateComment[v.tandaId]||undefined}),onSuccess:(_r,v)=>{inv();setRateComment(p=>({...p,[v.tandaId]:""}));}});
  const remindPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number})=>await api.sendTandaReminder({householdId:tandaHouseholdId(v.tandaId),...v}),onSuccess:inv});
  // Pago de tanda con Mercado Pago (Checkout Pro, PRUEBA): crea la orden
  // en el servidor y abre el checkout en otra pestaña. La pestaña se abre
  // en blanco al pulsar (gesto del usuario) y se le pone la URL al
  // responder el servidor, para que el navegador no la bloquee. La orden
  // pendiente se guarda en el dispositivo para poder verificar el pago al
  // volver, sin depender solo del webhook.
  const mpTabRef=useRef<Window|null>(null);
  const mpOrderKey=(tandaId:number,quincenaIndex:number)=>`sf-mp-order-${tandaId}-${quincenaIndex}`;
  const [mpOrders,setMpOrders]=useState<Record<string,string>>(()=>{ try{ const out:Record<string,string>={}; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k?.startsWith("sf-mp-order-")){ const v=localStorage.getItem(k); if(v) out[k]=v; } } return out; }catch{ return {}; } });
  const mpSaveOrder=(tandaId:number,quincenaIndex:number,orderId:string)=>{ const k=mpOrderKey(tandaId,quincenaIndex); try{ localStorage.setItem(k,orderId); }catch{} setMpOrders(p=>({...p,[k]:orderId})); };
  const mpClearOrder=(tandaId:number,quincenaIndex:number)=>{ const k=mpOrderKey(tandaId,quincenaIndex); try{ localStorage.removeItem(k); }catch{} setMpOrders(p=>{ const n={...p}; delete n[k]; return n; }); };
  const createMpOrder=useMutation({
    mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number})=>await api.createMercadoPagoOrder({householdId:tandaHouseholdId(v.tandaId),...v}),
    onMutate:()=>{ try{ mpTabRef.current=window.open("about:blank","_blank"); }catch{ mpTabRef.current=null; } },
    onSuccess:(r,v)=>{ mpSaveOrder(v.tandaId,v.quincenaIndex,r.orderId); const tab=mpTabRef.current; mpTabRef.current=null; if(tab && !tab.closed) tab.location.href=r.checkoutUrl; else window.open(r.checkoutUrl,"_blank","noopener"); inv(); },
    onError:()=>{ const tab=mpTabRef.current; mpTabRef.current=null; try{ tab?.close(); }catch{} },
  });
  const checkMpOrder=useMutation({
    mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;orderId:string})=>await api.checkMercadoPagoOrder({householdId:tandaHouseholdId(v.tandaId),...v}),
    onSuccess:(r,v)=>{ if(r.paid){ mpClearOrder(v.tandaId,v.quincenaIndex); inv(); } else { } },
  });
  const [mvProfile,setMvProfile]=useState("");
  const [receipt,setReceipt]=useState<{dataBase64:string;mimeType:string;preview:string;file?:File}|null>(null);
  const [persReceipt,setPersReceipt]=useState<{dataBase64:string;mimeType:string;preview:string;file?:File}|null>(null);
  const [receiptView,setReceiptView]=useState<string|null>(null);
  // Deps del detalle de tanda (TandaDetail): todos los estados y
  // mutaciones que el desglose usa, agrupados para pasarlos juntos.
  const tandaDetailDeps: TandaDetailDeps = {
    drawSel, setDrawSel, fundKind, setFundKind, fundAmount, setFundAmount, fundNote, setFundNote,
    partName, setPartName, partCard, setPartCard, cardInput, setCardInput,
    tInvEmail, setTInvEmail, tInvName, setTInvName, tInvResult, tJoinName, setTJoinName,
    myEmail: myEmail || (meEarly?.email ?? "").trim().toLowerCase(),
    rateName, setRateName, rateStars, setRateStars, rateComment, setRateComment,
    tandaProofReview, setTandaProofReview, mpOrders, mpOrderKey, mpClearOrder,
    copiedLink, copyLink, tandaInviteMessage, setReceiptView,
    pickTandaProof, confirmTandaProof,
    delTanda, drawTanda, setPay, addFine, verifyPay, addFundEntry, payFine, verifyFine, reassignTurn, addReplacement, setRole, setFixed,
    voteExclude, removePart, setCard, addPart, createTandaInv, respondTandaInv, resendInv, cancelTandaInv,
    confirmDelivery, uploadProof, remindPay, createMpOrder, checkMpOrder, rateOrg,
  };
  // La foto que se guarda es la comprimida (máx. 1600 px, JPEG 0,85,
  // con imageFileToJpeg, la misma que usa el lector): una foto de 2–5 MB
  // baja a ~200–400 KB. Si la compresión falla (formato que este
  // dispositivo no decodifica), se guarda la original como antes.
  const pickReceipt=async(file:File|undefined,set:(v:{dataBase64:string;mimeType:string;preview:string;file?:File}|null)=>void)=>{ if(!file) return; try{ const jpeg=await imageFileToJpeg(file); set({dataBase64:jpeg.dataBase64,mimeType:jpeg.mimeType,preview:jpeg.preview,file}); }catch{ const r=await fileToBase64(file); set({dataBase64:r.dataBase64,mimeType:r.mimeType,preview:URL.createObjectURL(file),file}); } };
  const [editProfId,setEditProfId]=useState<number|null>(null); const [editProfName,setEditProfName]=useState(""); const [editProfLast,setEditProfLast]=useState("");
  const [profLast,setProfLast]=useState("");
  const [invEmail2,setInvEmail2]=useState(""); const [invName2,setInvName2]=useState("");
  const [acceptFirst,setAcceptFirst]=useState<Record<number,string>>({}); const [acceptLast,setAcceptLast]=useState<Record<number,string>>({});
  const saveProfEdit=useMutation({mutationFn:async()=>{ const pr=data!.profiles.find(x=>x.id===editProfId); if(!pr) throw new Error("Perfil"); return await api.saveProfile({id:pr.id,householdId:data!.household!.id,name:editProfName,lastName:editProfLast,kind:pr.kind as "adult"|"dependent",dependentType:pr.dependentType||undefined,monthlyIncome:pr.monthlyIncome,fixedCommitments:pr.fixedCommitments,email:pr.email||undefined}); },onSuccess:()=>{inv();setEditProfId(null);}});
  const createInv=useMutation({mutationFn:async()=>await api.createInvitation({householdId:data!.household!.id,email:invEmail2,invitedName:invName2||undefined}),onSuccess:(r)=>{inv();setHhInvResult({emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl});setInvEmail2("");setInvName2("");}});
  const respondInv2=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondInvitation({id:v.id,accept:v.accept,firstName:acceptFirst[v.id]||undefined,lastName:acceptLast[v.id]||undefined}),onSuccess:(r)=>{ inv(); if(r.profileId) pickProfile(r.profileId); }});
  // Aprobar o rechazar una solicitud de ingreso (código del hogar). Solo el
  // administrador ve los botones; el servidor vuelve a verificar el rol.
  const respondJoinReq=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondJoinRequest({id:v.id,accept:v.accept}),onSuccess:()=>{ inv(); }});
  const delInv=useMutation({mutationFn:async(id:number)=>await api.deleteInvitation({id}),onSuccess:inv});

  // subcategorías editables + lectura automática del comprobante
  const [newSubName,setNewSubName]=useState(""); const [newCatName,setNewCatName]=useState(""); const [newSubByCat,setNewSubByCat]=useState<Record<number,string>>({});
  const addSub=useMutation({mutationFn:async(v:{categoryId:number;name:string})=>await api.addSubcategory(v),onSuccess:inv});
  const removeSub=useMutation({mutationFn:async(v:{categoryId:number;name:string})=>await api.removeSubcategory(v),onSuccess:inv});
  // Lectura de comprobantes en el dispositivo (Tesseract.js, gratis, sin
  // servidor): se llena el importe, el concepto y la categoría; la persona
  // revisa antes de guardar. El motor se carga solo al leer.
  const [ocrBusyMv,setOcrBusyMv]=useState(false); const [ocrProgressMv,setOcrProgressMv]=useState(""); const [ocrErrorMv,setOcrErrorMv]=useState(""); const [ocrNoticeMv,setOcrNoticeMv]=useState(""); const [ocrErrDetailMv,setOcrErrDetailMv]=useState("");
  // Fecha leída del comprobante que está pendiente de confirmar: si el
  // lector lee una fecha de otro año o futura (año mal leído: "2026" sale
  // "2017"), no se aplica en silencio; la persona la confirma o corrige
  // antes de guardar. Se limpia al confirmar, al corregir la fecha a mano
  // o al reiniciar el formulario.
  const [ocrDateCheckMv,setOcrDateCheckMv]=useState<ReceiptDateCheck|null>(null); const [ocrDateErrorMv,setOcrDateErrorMv]=useState("");
  const [ocrBusyPers,setOcrBusyPers]=useState(false); const [ocrProgressPers,setOcrProgressPers]=useState(""); const [ocrErrorPers,setOcrErrorPers]=useState(""); const [ocrNoticePers,setOcrNoticePers]=useState(""); const [ocrErrDetailPers,setOcrErrDetailPers]=useState("");
  const runOcr=async(target:"mv"|"pers",fileOverride?:File)=>{
    const file=fileOverride ?? (target==="mv"?receipt?.file:persReceipt?.file);
    if(!file || !data) return;
    const setBusy=target==="mv"?setOcrBusyMv:setOcrBusyPers;
    const setProgress=target==="mv"?setOcrProgressMv:setOcrProgressPers;
    const setError=target==="mv"?setOcrErrorMv:setOcrErrorPers;
    const setNotice=target==="mv"?setOcrNoticeMv:setOcrNoticePers;
    const setDetail=target==="mv"?setOcrDetailMv:setOcrDetailPers;
    const setErrDetail=target==="mv"?setOcrErrDetailMv:setOcrErrDetailPers;
    setBusy(true); setError(""); setNotice(""); setDetail(null); setErrDetail(""); setProgress("Preparando la lectura…");
    try{
      const jpeg=await imageFileToJpeg(file);
      setProgress("Leyendo el comprobante en su dispositivo…");
      const text=await readReceiptText(`data:${jpeg.mimeType};base64,${jpeg.dataBase64}`,(p)=>{ setProgress(ocrStatusText(p.status,p.progress||0,p.downloadedMB,p.totalMB)); });
      const parsed=parseReceiptText(text);
      if(parsed.total==null){ setError("No se pudo leer el total del comprobante. Verifique que la foto sea nítida o escriba el importe."); return; }
      setDetail(parsed);
      const cat=resolveReceiptCategory(data.categories,parsed,"expense",rules);
      if(target==="mv"){
        setMvAmount(String(parsed.total));
        if(parsed.store){ setMvConcept(parsed.store); applyRuleTo(parsed.store,"mv"); }
        // La fecha leída solo se aplica si es verosímil (de este año y no
        // futura). Si es de otro año o futura, casi seguro el año salió
        // mal leído: no se aplica, queda la fecha de hoy y se pide
        // confirmar la fecha de origen del gasto antes de guardar.
        if(parsed.date){
          const st=checkReceiptDate(parsed.date,todayISO());
          if(st.status==="ok"){ setMvDate(parsed.date); setOcrDateCheckMv(null); setOcrDateErrorMv(""); }
          else setOcrDateCheckMv({readDate:parsed.date,reason:st.status==="future"?"future":"other-year"});
        } else { setOcrDateCheckMv(null); setOcrDateErrorMv(""); }
        if(cat && "id" in cat){ if(mvCat==="") setMvCat(String(cat.id)); setOcrLabelMv(""); }
        else if(cat && "label" in cat){ setOcrLabelMv(cat.label); setOcrNewCatName(cat.label); }
        else setOcrLabelMv("");
        // La revisión va por pasos con «Siguiente»: datos leídos (paso 1) →
        // categoría (paso 2, con crear la sugerida si no está) → revisar y
        // guardar (paso 3, con el detalle leído en «Más opciones»).
        setMvMore(true); setMvStep(1); scrollFormTop("mv-form");
        setNotice(`Leído del comprobante${parsed.store?` · ${parsed.store}`:""}${parsed.date?` · ${fmtDate(parsed.date)}`:""}. Revise antes de guardar.`);
      } else {
        setPersAmt(String(parsed.total));
        if(parsed.store){ setPersConcept(parsed.store); applyRuleTo(parsed.store,"pers"); }
        if(cat && "id" in cat){ if(persCat==="") setPersCat(String(cat.id)); setOcrLabelPers(""); }
        else if(cat && "label" in cat){ setOcrLabelPers(cat.label); setOcrNewCatName(cat.label); }
        else setOcrLabelPers("");
        setPersMore(true); setPersStep(1); scrollFormTop("pers-exp-form");
        setNotice(`Leído del comprobante${parsed.store?` · ${parsed.store}`:""}${parsed.date?` · ${fmtDate(parsed.date)}`:""}. Revise antes de guardar.`);
      }
    }catch(err){ const detail=err instanceof OcrError?err.detail:""; setErrDetail(detail); setError(err instanceof OcrError && err.code==="load" ? "No se pudo cargar el lector en este dispositivo. Intente de nuevo; la primera lectura descarga el lector y luego queda guardado." : "No se pudo leer el texto del comprobante. Verifique que la foto sea nítida o escriba el importe."); }
    finally{ setBusy(false); setProgress(""); }
  };
  // Subir el comprobante AL EMPEZAR el gasto: se adjunta la foto y la
  // lectura llena importe, concepto, categoría y fecha; la persona revisa
  // y corrige antes de guardar. Antes la foto solo se podía subir en el
  // paso 3, cuando ya todo estaba escrito a mano.
  const pickAndReadReceipt=async(file:File|undefined,target:"mv"|"pers")=>{
    if(!file) return;
    const set=target==="mv"?setReceipt:setPersReceipt;
    await pickReceipt(file,set);
    await runOcr(target,file);
  };
  // Detalle leído del comprobante y categoría sugerida por el lector propio.
  // El detalle solo se muestra para revisar, no se guarda. Si la categoría
  // sugerida no está en el hogar, el paso 2 ofrece crearla ya ajustada al
  // ticket, con la misma API del módulo Categorías (sin SQL nuevo).
  const [ocrDetailMv,setOcrDetailMv]=useState<ReceiptRead|null>(null);
  const [ocrDetailPers,setOcrDetailPers]=useState<ReceiptRead|null>(null);
  const [ocrLabelMv,setOcrLabelMv]=useState(""); const [ocrLabelPers,setOcrLabelPers]=useState("");
  const [ocrNewCatName,setOcrNewCatName]=useState("");
  const createCat=useMutation({mutationFn:async(v:{target:"mv"|"pers";name:string;kind:"income"|"expense"})=>await api.saveCategory({householdId:data!.household!.id,name:v.name,kind:v.kind,subcategories:[],isActive:1}),onSuccess:(r,v)=>{inv(); if(v.target==="mv"){ if(r.id) setMvCat(String(r.id)); setOcrLabelMv(""); } else { if(r.id) setPersCat(String(r.id)); setOcrLabelPers(""); } setOcrNewCatName(""); setNewCatName(""); }});
  // Reinicio completo de los formularios de movimiento: tras guardar, el
  // formulario debe quedar como recién abierto (sin foto, sin nota del
  // lector, sin concepto ni importe, fecha de hoy, paso 1). Antes solo se
  // limpiaban algunos campos y la nota «Leído del comprobante» (con el
  // nombre leído) y la fecha leída se quedaban, así que el siguiente gasto
  // heredaba el anterior.
  const resetMvForm=()=>{ setMvType("expense"); setMvStep(1); setMvAmount(""); setMvCurrency(""); setMvConversionPendingSql(false); setMvConcept(""); setMvAccount(""); setMvAccountError(""); setMvToAccount(""); setMvCat(""); setMvSub(""); setMvBudget(null); setMvDate(todayISO()); setMvVis("shared"); setMvProfile(""); setMvMore(false); setEditingMv(null); setReceipt(null); setOcrDetailMv(null); setOcrLabelMv(""); setOcrNewCatName(""); setOcrNoticeMv(""); setOcrErrorMv(""); setOcrErrDetailMv(""); setOcrProgressMv(""); setOcrBusyMv(false); setOcrDateCheckMv(null); setOcrDateErrorMv(""); setAppliedRuleMv(null); setVoiceNoticeMv(""); setVoiceErrorMv(""); setVoiceBusyMv(false); setNewSubName(""); setNewCatName(""); setMvRepeat(false); setMvRepeatFreq("monthly"); setMvRepeatDay(""); setMvRepeatWeekday(""); setMvRepeatError(""); setMvSplit(false); setMvSplitLines([]); setEditingSplitGroup(null); };
  const resetPersForm=()=>{ setPersAmt(""); setPersConcept(""); setPersReceipt(null); setPersCat(""); setPersAccount(""); setPersAccountError(""); setAppliedRulePers(null); setPersStep(1); setPersMore(false); setOcrDetailPers(null); setOcrLabelPers(""); setOcrNewCatName(""); setOcrNoticePers(""); setOcrErrorPers(""); setOcrErrDetailPers(""); setOcrProgressPers(""); setOcrBusyPers(false); setVoiceNoticePers(""); setVoiceErrorPers(""); setVoiceBusyPers(false); setNewCatName(""); };
  // Registro rápido desde Inicio: se queda en Inicio y abre el formulario
  // de movimientos en un pop-up, sin ir a Movimientos. Al guardar, el
  // pop-up se cierra y el tablero se actualiza. El ref espeja el estado
  // para que el onSuccess de saveMv (definido antes) lo vea al guardar.
  const [inicioMvOpen,setInicioMvOpen]=useState(false);
  const inicioMvOpenRef=useRef(false);
  const openInicioMovement=(t:"income"|"expense")=>{ resetMvForm(); setMvType(t); inicioMvOpenRef.current=true; setInicioMvOpen(true); };
  const closeInicioMovement=()=>{ inicioMvOpenRef.current=false; setInicioMvOpen(false); resetMvForm(); };
  // Precarga del lector de comprobantes: al abrir un formulario con
  // comprobante (Movimientos, Gasto del día o el pop-up de Inicio), los
  // archivos de la primera lectura se descargan en segundo plano mientras
  // la persona toma o elige la foto. Una sola vez por carga de la página;
  // si falla, la lectura normal sigue su curso.
  useEffect(()=>{ if(tab==="movimientos"||tab==="personal"||inicioMvOpen) void warmUpOcr(); },[tab,inicioMvOpen]);
  // Registro por voz con Web Speech API (gratis, en el navegador): dictar
  // "gasté 320 en el súper" llena importe, concepto y categoría; se revisa
  // antes de guardar. Si el navegador no lo soporta, se escribe el gasto.
  type SpeechRecognitionLike={lang:string;interimResults:boolean;maxAlternatives:number;onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;};
  const micIcon=<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/></svg>;
  const [voiceBusyMv,setVoiceBusyMv]=useState(false); const [voiceErrorMv,setVoiceErrorMv]=useState(""); const [voiceNoticeMv,setVoiceNoticeMv]=useState("");
  const [voiceBusyPers,setVoiceBusyPers]=useState(false); const [voiceErrorPers,setVoiceErrorPers]=useState(""); const [voiceNoticePers,setVoiceNoticePers]=useState("");
  const startVoice=(target:"mv"|"pers")=>{
    const w=window as unknown as {SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};
    const SR=w.SpeechRecognition || w.webkitSpeechRecognition;
    const setBusy=target==="mv"?setVoiceBusyMv:setVoiceBusyPers;
    const setError=target==="mv"?setVoiceErrorMv:setVoiceErrorPers;
    const setNotice=target==="mv"?setVoiceNoticeMv:setVoiceNoticePers;
    if(!SR){ setError("Su navegador no soporta el dictado por voz. Puede escribir el gasto."); return; }
    if(!data) return;
    const rec=new SR();
    rec.lang="es-MX"; rec.interimResults=false; rec.maxAlternatives=1;
    setBusy(true); setError(""); setNotice("");
    rec.onresult=(e)=>{
      const text=e.results[0]?.[0]?.transcript || "";
      const parsed=parseVoiceText(text,data.categories,rules);
      if(target==="mv"){
        if(parsed.amount!=null) setMvAmount(String(parsed.amount));
        if(parsed.concept){ setMvConcept(parsed.concept); applyRuleTo(parsed.concept,"mv"); }
        if(parsed.categoryId!=null && mvCat==="") setMvCat(String(parsed.categoryId));
        setNotice(parsed.amount!=null||parsed.concept?`Escuchado: «${parsed.heard}». Revise antes de guardar.`:"No se entendió el importe ni el concepto. Inténtelo de nuevo.");
      } else {
        if(parsed.amount!=null) setPersAmt(String(parsed.amount));
        if(parsed.concept){ setPersConcept(parsed.concept); applyRuleTo(parsed.concept,"pers"); }
        if(parsed.categoryId!=null && persCat==="") setPersCat(String(parsed.categoryId));
        setNotice(parsed.amount!=null||parsed.concept?`Escuchado: «${parsed.heard}». Revise antes de guardar.`:"No se entendió el importe ni el concepto. Inténtelo de nuevo.");
      }
    };
    rec.onerror=(e)=>{ setBusy(false); setError(e.error==="not-allowed"?"Permita el micrófono para dictar el gasto.":e.error==="no-speech"?"No se escuchó nada. Inténtelo de nuevo.":"No se pudo dictar el gasto."); };
    rec.onend=()=>setBusy(false);
    try{ rec.start(); }catch{ setBusy(false); }
  };
  // Importación y exportación CSV de movimientos.
  type ImportRow={date:string;concept:string;type:"income"|"expense"|"transfer"|"debt_payment";amount:number;categoryId:number|null;categoryName:string;accountId:number|null;include:boolean;duplicate:boolean};
  const [importOpen,setImportOpen]=useState(false); const [importRows,setImportRows]=useState<ImportRow[]|null>(null); const [importFileName,setImportFileName]=useState(""); const [importError,setImportError]=useState("");
  const normalizeImportDate=(raw:string):string|null=>{
    const s=raw.trim();
    const m=/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s);
    if(m) return `${m[1]}-${m[2]!.padStart(2,"0")}-${m[3]!.padStart(2,"0")}`;
    const m2=/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
    if(m2) return `${m2[3]}-${m2[2]!.padStart(2,"0")}-${m2[1]!.padStart(2,"0")}`;
    return null;
  };
  // ---- Historial de movimientos paginado (desde 2/3 peso) ----
  // El overview solo trae el mes visible; el historial del módulo
  // Movimientos se carga por páginas de 50 con los filtros aplicados en
  // el servidor (misma regla que filterMovements). Los totales de la
  // línea de conteo vienen del servidor (conjunto filtrado completo, no
  // solo la página). El CSV se exporta recorriendo TODAS las páginas con
  // los filtros actuales, como antes exportaba todo el historial
  // filtrado. Las claves de deduplicación de la importación se piden
  // bajo demanda al abrir el archivo (listMovementKeys), no en cada carga.
  type MovementPageArgs = { householdId: number; month?: string; type?: "income" | "expense" | "transfer" | "debt_payment"; account?: string; search?: string; subcategory?: string };
  const mvPageArgs = (f: MovementsFilterValue): MovementPageArgs | null => {
    if (!data?.household) return null;
    const args: MovementPageArgs = { householdId: data.household.id };
    if (f.month !== "") args.month = f.month;
    if (f.type !== "all") args.type = f.type;
    if (f.account !== "all") args.account = f.account;
    if (f.search.trim() !== "") args.search = f.search.trim();
    if (f.subcategory !== "all") args.subcategory = f.subcategory;
    return args;
  };
  const fetchAllMovementPages = async (args: MovementPageArgs) => {
    const out: Awaited<ReturnType<typeof api.listMovements>>["rows"] = [];
    let cursor: { date: string; id: number } | null = null;
    for (;;) {
      const page = await api.listMovements({ ...args, cursor, limit: 100 });
      out.push(...page.rows);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  };
  const mvQuery = useInfiniteQuery({
    queryKey: ["movements", activeHouseholdId, mvFilters],
    queryFn: async ({ pageParam }) => {
      const args = mvPageArgs(mvFilters);
      if (!args) throw new Error("Sin hogar activo.");
      return api.listMovements({ ...args, cursor: pageParam ?? null, limit: 50 });
    },
    initialPageParam: null as { date: string; id: number } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    enabled: !!data?.household,
  });
  // Detalle de ingresos vs gastos de un mes anterior: ese mes no viene en
  // el overview (solo el mes visible), así que se carga bajo demanda al
  // abrir el detalle; el mes visible usa las filas del overview.
  const incExpMonthQuery = useQuery({
    queryKey: ["movements", activeHouseholdId, { detail: "incexp", month: incExpDetail?.month }],
    queryFn: async () => {
      const args = mvPageArgs({ ...DEFAULT_MOVEMENTS_FILTER, month: incExpDetail!.month });
      if (!args) throw new Error("Sin hogar activo.");
      return fetchAllMovementPages(args);
    },
    enabled: !!incExpDetail && !!data?.household && incExpDetail.month !== data?.summary?.currentMonth,
  });
  const [exportingCsv, setExportingCsv] = useState(false);
  const exportCsv = async () => {
    if (!data?.household || exportingCsv) return;
    const args = mvPageArgs(mvFilters);
    if (!args) return;
    setExportingCsv(true);
    try {
      const meRow = meEarly?.id != null ? { id: meEarly.id, role: meEarly.role === "admin" ? "admin" : "member" } : null;
      const all = filterMovements((await fetchAllMovementPages(args)).filter(m => canSeeMovementRow(m, meRow)), mvFilters);
      const rows: (string | number | null)[][] = [["Fecha", "Concepto", "Tipo", "Categoría", "Subcategoría", "Cuenta", "Importe", "Visibilidad"]];
      for (const m of all) rows.push([m.date, m.concept, TYPE_LABEL[m.type] || m.type, getCatName(m.categoryId), m.subcategory || "", getAccName(m.accountId), m.amount, m.visibility === "shared" ? "Compartido" : "Privado"]);
      downloadTextFile(`syncfinanzas-movimientos-${monthNow()}.csv`, toCsv(rows), "text/csv;charset=utf-8");
    } finally { setExportingCsv(false); }
  };
  const handleImportFile=async(file:File|undefined)=>{
    if(!file || !data) return;
    setImportError("");
    try{
      const text=await file.text();
      const grid=parseCsv(text);
      if(grid.length<2){ setImportError("El archivo no tiene movimientos para importar."); return; }
      const header=grid[0]!.map(h=>normText(h));
      const findCol=(...names:string[])=>header.findIndex(h=>names.some(n=>h===n || h.includes(n)));
      const cDate=findCol("fecha","date");
      const cConcept=findCol("concepto","concept","descripcion","description");
      const cAmount=findCol("importe","monto","amount","total");
      const cType=findCol("tipo","type");
      const cCat=findCol("categoria","category");
      const cAcc=findCol("cuenta","account");
      if(cDate<0 || cConcept<0 || cAmount<0){ setImportError("No se reconocieron las columnas. El archivo necesita al menos Fecha, Concepto e Importe."); return; }
      // Claves de deduplicación de todo el historial visible: se piden
      // bajo demanda al abrir la importación (el overview ya no trae
      // todo el historial).
      const existing = new Set((await api.listMovementKeys({ householdId: data.household!.id })).keys);
      const rows:ImportRow[]=[];
      for(const g of grid.slice(1)){
        const dateRaw=(g[cDate]||"").trim();
        const concept=(g[cConcept]||"").trim();
        const amountRaw=(g[cAmount]||"").replace(/[$\s]/g,"").replace(/,/g,"");
        const amount=Number(amountRaw);
        if(!concept || !Number.isFinite(amount) || amount<=0) continue;
        const date=normalizeImportDate(dateRaw) || todayISO();
        const typeRaw=normText(g[cType]||"");
        const type:ImportRow["type"]=typeRaw.includes("ingreso")||typeRaw==="income"?"income":typeRaw.includes("transfer")?"transfer":typeRaw.includes("deuda")||typeRaw.includes("debt")?"debt_payment":"expense";
        const catText=cCat>=0?(g[cCat]||"").trim():"";
        let categoryId=catText?(data.categories.find(c=>normText(c.name)===normText(catText))?.id ?? null):null;
        if(!categoryId) categoryId=suggestCategoryId(data.categories,concept,rules);
        const accText=cAcc>=0?(g[cAcc]||"").trim():"";
        const accountId=accText?(data.accounts.find(a=>normText(a.name)===normText(accText))?.id ?? null):null;
        const key=`${date}|${normText(concept)}|${amount}|${type}`;
        rows.push({date,concept,type,amount,categoryId,categoryName:categoryId?getCatName(categoryId):"Sin categoría",accountId,include:!existing.has(key),duplicate:existing.has(key)});
      }
      if(rows.length===0){ setImportError("No se encontraron movimientos válidos en el archivo."); return; }
      setImportRows(rows); setImportFileName(file.name);
    }catch{ setImportError("No se pudo leer el archivo CSV."); }
  };
  const importMv=useMutation({mutationFn:async(rows:ImportRow[])=>await api.importMovements({householdId:data!.household!.id,movements:rows.filter(r=>r.include).map(r=>({type:r.type,amount:r.amount,concept:r.concept,categoryId:r.categoryId,date:r.date,visibility:"shared" as const,accountId:r.accountId}))}),onSuccess:()=>{ inv(); setImportRows(null); setImportOpen(false); }});
  // Formulario de reglas en Categorías.
  const [ruleKeyword,setRuleKeyword]=useState(""); const [ruleCat,setRuleCat]=useState("");



  const catsForType = useMemo(()=>{ if(!data) return []; const kind = mvType==="income"?"income":"expense"; if(mvType==="transfer") return []; return data.categories.filter(c=>c.kind===kind && c.isActive===1); },[data,mvType]);
  const selectedCat = data?.categories.find(c=>String(c.id)===mvCat);
  const filteredMovs = useMemo(()=>{ if(!data) return []; const meId = meEarly?.id ?? null; const meIsAdmin = meEarly?.role==="admin"; const meRow = meId!=null ? { id: meId, role: meIsAdmin ? "admin" : "member" } : null; const rows = (mvQuery.data?.pages ?? []).flatMap(p=>p.rows); return filterMovements(rows.filter(m=> canSeeMovementRow(m, meRow)), mvFilters); },[data,mvFilters,meEarly,mvQuery.data]);
  // Movimientos con las partes de cada gasto dividido agrupadas en una
  // sola entrada (el conteo de filas del servidor, mvTotals.total, sigue
  // contando filas, no grupos: se deja como está).
  const groupedMovs = useMemo(()=>groupSplitMovements(filteredMovs),[filteredMovs]);
  // Totales del conjunto filtrado completo (no solo la página cargada):
  // vienen de la primera página, que el servidor calcula sobre todo el
  // historial filtrado. La etiqueta «Anula …» de una reversión busca el
  // original también entre las filas cargadas y sus enlazadas (el
  // original puede estar en otro mes).
  const mvTotals = mvQuery.data?.pages[0] ? { total: mvQuery.data.pages[0].total, incomeTotal: mvQuery.data.pages[0].incomeTotal, expenseTotal: mvQuery.data.pages[0].expenseTotal } : { total: 0, incomeTotal: 0, expenseTotal: 0 };
  const reversalConceptById = useMemo(()=>{ const map = new Map<number,string>(); if(data) for(const m of data.movements) map.set(m.id, m.concept); for(const p of mvQuery.data?.pages ?? []) for(const m of [...p.rows, ...p.linked]) map.set(m.id, m.concept); return map; },[data, mvQuery.data]);

  // Los hooks van antes de los retornos de carga/error: si van después,
  // el primer render (cargando) llamaría menos hooks que el siguiente y
  // React fallaría. Cuenta de Efectivo por defecto: si el hogar tiene una
  // cuenta de efectivo real, el formulario la trae ya elegida (gastos se
  // descuentan de ahí, ingresos entran ahí). Si no hay cuenta de efectivo,
  // el campo queda vacío y la regla de cuenta obligatoria pide elegir una.
  const cashDefaultId = useMemo(()=> data?.defaultCashAccountId!=null ? String(data.defaultCashAccountId) : "", [data]);
  useEffect(()=>{ if(!mvAccount && cashDefaultId) setMvAccount(cashDefaultId); },[mvAccount, cashDefaultId]);
  useEffect(()=>{ if(!persAccount && cashDefaultId) setPersAccount(cashDefaultId); },[persAccount, cashDefaultId]);
  // Al cambiar el mes que muestra el tablero, la lista de Inicio vuelve a mostrar solo los 5 más recientes.
  useEffect(()=>{ setShowAllHomeMovs(false); },[data?.summary?.currentMonth]);
  if(q.isPending) return <LoadingSplash />;
  if(q.error) return <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-6"><div className="max-w-xl mx-auto">{renderTokenInviteBanner()}<p className="text-[var(--red)] mt-4">No se pudo cargar. {String(q.error)}</p><button className={btnPrimary+" mt-3"} onClick={()=>q.refetch()}>Reintentar</button></div></div>;
  if(!data) return null;

  // ---- ONBOARDING ----
  const fullName=(pr:{name:string;lastName?:string|null})=>`${pr.name} ${pr.lastName||""}`.trim();
  const me = meEarly;
  const tabLabel = (tid:Tab)=> TABS.find(x=>x.id===tid)?.label ?? tid;
  // Permisos de tanda del perfil actual (me): la interfaz solo muestra los
  // botones que corresponden a su rol; el servidor es la autoridad y rechaza
  // lo no permitido. El rol sale de la fila de participante (por correo o
  // por nombre) o de los campos organizador/tesorero/suplente de la tanda.
  const tandaPerms = (td: (typeof allTandas)[number]) => {
    const meName = me ? fullName(me).trim().toLowerCase() : "";
    // Sin hogar no hay perfil «me»: la fila se busca por el correo de
    // la sesión (invitado solo de tanda). Con hogar, me.email manda.
    const meEmail = (me?.email || myEmail || "").trim().toLowerCase();
    const myPart = td.participants.find(p => (p.email && meEmail !== "" && p.email.trim().toLowerCase() === meEmail) || (meName !== "" && p.name.trim().toLowerCase() === meName)) ?? null;
    const excluded = myPart?.excluded === 1;
    const rankOf = (r: string | null | undefined) => r === "organizador" ? 3 : (r === "tesorero" || r === "suplente") ? 2 : r === "participante" ? 1 : 0;
    let rank = 0;
    if (!excluded) {
      if (myPart) rank = Math.max(rank, rankOf(myPart.role));
      // El rango por perfil designado (organizador/tesorero/suplente) se
      // resuelve con el perfil DEL HOGAR DE LA TANDA (td.myProfileId): en
      // una tanda invitada, el perfil activo es el del espacio Personal
      // y su id no coincide con el del hogar del invitador.
      const myTandaProfileId = td.myProfileId ?? me?.id ?? null;
      if (myTandaProfileId != null) {
        if (td.organizerProfileId === myTandaProfileId) rank = Math.max(rank, 3);
        else if (td.treasurerProfileId === myTandaProfileId) rank = Math.max(rank, 2);
        else if (td.substituteProfileId === myTandaProfileId) rank = Math.max(rank, 2);
      }
    }
    const myParticipantId = !excluded && myPart ? myPart.id : null;
    // Rol RESUELTO de «me» (misma resolución que el servidor): la fila de
    // participante, o el perfil designado al crear la tanda. El candado de
    // pago (2026-11-26) solo deja verificar al Organizador y al Tesorero;
    // el Suplente tiene rango 2 pero no verifica.
    const rowRole = myPart?.role ?? null;
    let myRole: string | null = null;
    if (!excluded) {
      if (rowRole === "organizador" || rowRole === "tesorero") myRole = rowRole;
      else {
        const myTandaProfileId = td.myProfileId ?? me?.id ?? null;
        if (myTandaProfileId != null) {
          if (td.organizerProfileId === myTandaProfileId) myRole = "organizador";
          else if (td.treasurerProfileId === myTandaProfileId) myRole = "tesorero";
          else if (td.substituteProfileId === myTandaProfileId) myRole = "suplente";
          else myRole = rowRole;
        } else myRole = rowRole;
      }
    }
    // isAdmin es POR TANDA (lo calcula el servidor): en una tanda invitada
    // es falso aunque el usuario sea administrador de su propio espacio
    // Personal; si no, vería botones de organizador que no le corresponden.
    const tandaAdmin = td.isAdmin;
    return {
      isAdmin: tandaAdmin,
      myParticipantId,
      isParticipant: myParticipantId != null,
      canManage: tandaAdmin || rank >= 3,
      canTreasury: tandaAdmin || rank >= 2,
      canVerify: myRole === "organizador" || myRole === "tesorero",
      isOwn: (participantId: number) => myParticipantId === participantId,
    };
  };
  // Valores del formulario de tanda, compartidos por la pestaña Tandas y
  // por la vista «Mis tandas» del invitado sin hogar (que no crea tandas:
  // el formulario no se pinta, pero el módulo exige los valores).
  const tandaFormValues: TandaFormValues = {name:tandaName,count:tandaCount,amount:tandaAmount,start:tandaStart,freq:tandaFreq,drawMode:tandaDrawMode,coverage:tandaCoverage,fine:tandaFine,meeting:tandaMeeting,treasurer:tandaTreasurer,substitute:tandaSubstitute,kind:tandaKind};
  const onTandaFormChange = (patch: Partial<TandaFormValues>) => { if(patch.name!==undefined)setTandaName(patch.name); if(patch.count!==undefined)setTandaCount(patch.count); if(patch.amount!==undefined)setTandaAmount(patch.amount); if(patch.start!==undefined)setTandaStart(patch.start); if(patch.freq!==undefined)setTandaFreq(patch.freq); if(patch.drawMode!==undefined)setTandaDrawMode(patch.drawMode); if(patch.coverage!==undefined)setTandaCoverage(patch.coverage); if(patch.fine!==undefined)setTandaFine(patch.fine); if(patch.meeting!==undefined)setTandaMeeting(patch.meeting); if(patch.treasurer!==undefined)setTandaTreasurer(patch.treasurer); if(patch.substitute!==undefined)setTandaSubstitute(patch.substitute); if(patch.kind!==undefined)setTandaKind(patch.kind); };
  // Cajón del invitado sin hogar (2026-11-26): solo «Mis tandas»; al
  // final y visible va «Cerrar sesión» (prop onSignOut del cajón).
  const guestDrawerSections: DrawerMenuSection[] = [
    { title: "Planes y tandas", tabs: [{ id: "tandas", label: "Mis tandas" }] },
  ];
  // Cerrar sesión: la misma acción que Seguridad → «Cerrar sesión en este
  // dispositivo». Va al final del cajón para todos (con hogar y sin él).
  const handleSignOut = () => { void signOut().then(()=>window.location.reload()); };
  // Atajos del menú rápido (estrellas del cajón, 2026-11-24): tocar la
  // estrella fija o quita el atajo en el acto, sin pop-up ni aviso; si la
  // barra está llena (4), no cabe más y no cambia nada.
  const togglePin = (id:QuickShortcutId)=>{
    setQuickShortcuts((prev)=>{
      const next = toggleQuickShortcut(prev, id);
      writeQuickShortcuts(next);
      return next;
    });
  };
  if(!data.household){
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="max-w-xl mx-auto px-3 pb-28 pt-4">
          {tab === "tandas" ? (
            <div className="space-y-4">
              <div>
                <button type="button" aria-label="Volver" className="rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold" onClick={() => { setTab("inicio"); setTandaDetailId(null); }}>‹ Volver</button>
              </div>
              <TandasModule
                tandas={guestTandas}
                detailId={tandaDetailId}
                onDetailChange={setTandaDetailId}
                formValues={tandaFormValues}
                onFormChange={onTandaFormChange}
                onFormSubmit={()=>{}}
                formPending={false}
                organizerName={me?fullName(me):"usted"}
                adultProfiles={[]}
                detailDeps={tandaDetailDeps}
                permsFor={tandaPerms}
                hideForm
              />
            </div>
          ) : (<>
          {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-4 sm:p-5 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
          <p className="text-[var(--gold-text)] font-display font-extrabold tracking-wide text-sm">SYNCFINANZAS · VERSIÓN GRANDE</p>
          <h1 className="font-display text-2xl font-extrabold mt-2 leading-tight">Un solo hogar,<br/>cuentas claras.</h1>
          <p className="text-[var(--dim)] mt-3">Registre sus gastos e ingresos y vea cuánto le queda.</p>
          <div className="mt-4"><InstallCard installed={appInstalled} onInstall={handleInstallClick} /></div>
          <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2">
            <h2 className="font-display font-bold text-lg">¿Recibió una invitación?</h2>
            <p className="text-sm text-[var(--dim)]">Escriba su correo.</p>
            <div className="flex gap-2"><input aria-label="Correo para buscar invitación" type="email" placeholder="tu@correo.com" className={inputCls} value={invEmail} onChange={e=>setInvEmail(e.target.value)} /><button type="button" className={btnPrimary} onClick={()=>findInv.mutate()} disabled={!invEmail || findInv.isPending}>Buscar invitación</button></div>
            {invSearched && invFound.length===0 && <p className="text-sm text-[var(--dim)]">No hay invitación pendiente para ese correo.</p>}
            {invFound.map(iv=>(
              <div key={`${iv.kind}-${iv.id}`} className="border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2">
                {iv.kind==="tanda"
                  ? <p className="text-sm"><b>Invitación pendiente</b> para participar en la tanda <b>“{iv.tandaName}”</b>{iv.invitedName?` · confirme su nombre:`:" · confirme su nombre:"}</p>
                  : <p className="text-sm"><b>Invitación pendiente</b> para unirse a <b>“{iv.householdName}”</b>{iv.invitedName?` · confirme su nombre:`:" · confirme su nombre:"}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="Tu nombre al aceptar la invitación" placeholder="Nombre" className={inputCls} value={joinFirst} onChange={e=>setJoinFirst(e.target.value)} />
                  <input aria-label="Tu apellido al aceptar la invitación" placeholder="Apellido" className={inputCls} value={joinLast} onChange={e=>setJoinLast(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  {iv.kind==="tanda" ? (
                    <>
                      <button type="button" aria-label={`Aceptar invitación a la tanda ${iv.tandaName}`} className={btnPrimary} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:true,name:[joinFirst, joinLast].filter(Boolean).join(" ")||undefined})} disabled={respondTandaInv.isPending}>Aceptar y participar</button>
                      <button type="button" aria-label={`Rechazar invitación a la tanda ${iv.tandaName}`} className={btnGhost} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:false})} disabled={respondTandaInv.isPending}>Rechazar</button>
                    </>
                  ) : (
                    <>
                      <button type="button" aria-label={`Aceptar invitación a ${iv.householdName}`} className={btnPrimary} onClick={()=>respondInv.mutate({id:iv.id,accept:true})} disabled={respondInv.isPending}>Aceptar y entrar al hogar</button>
                      <button type="button" aria-label={`Rechazar invitación a ${iv.householdName}`} className={btnGhost} onClick={()=>respondInv.mutate({id:iv.id,accept:false})} disabled={respondInv.isPending}>Rechazar</button>
                    </>
                  )}
                </div>
                {(respondInv.error || respondTandaInv.error) && <p className="text-sm text-[var(--red)]">{String(respondInv.error || respondTandaInv.error)}</p>}
              </div>
            ))}
          </div>
          {renderTokenInviteBanner()}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-3.5 mt-4 space-y-2">
            <h2 className="font-display font-bold text-lg">Invitar a crear una cuenta personal</h2>
            <p className="text-sm text-[var(--dim)]">Recibirá un enlace directo.</p>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Correo para invitar a crear una cuenta personal" type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={genEmail} onChange={e=>setGenEmail(e.target.value)} />
              <input aria-label="Nombre de la persona invitada a crear una cuenta personal" placeholder="Nombre (opcional)" className={inputCls+" flex-1 min-w-[160px]"} value={genName} onChange={e=>setGenName(e.target.value)} />
              <button type="button" className={btnPrimary} onClick={()=>createGenInv.mutate()} disabled={!genEmail || createGenInv.isPending}>Enviar invitación</button>
            </div>
            {createGenInv.error && <p className="text-sm text-[var(--red)]">{String(createGenInv.error)}</p>}
            {genResult && (
              <div className="text-sm space-y-2">
                {genResult.emailSent
                  ? <p className="text-[var(--green)]">Correo enviado.</p>
                  : <><p className="text-[var(--red)]">Copie el enlace y envíelo usted:</p><p className="break-all bg-[var(--surface2)] rounded-xl p-2 text-xs">{genResult.inviteUrl}</p><button type="button" className={btnGhost} onClick={()=>copyLink(genResult.inviteUrl)}>{copiedLink===genResult.inviteUrl?"Enlace copiado":"Copiar enlace"}</button></>}
                {genResult.id && <p><button type="button" className="underline font-semibold text-sm" onClick={()=>resendGenInv.mutate(genResult.id as number)} disabled={resendGenInv.isPending}>Reenviar con enlace nuevo</button></p>}
              </div>
            )}
          </div>
          {modeModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Elija el modo de su espacio">
              <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display font-bold text-lg">¿Cómo quiere usar SyncFinanzas?</h2>
                    <p className="text-sm text-[var(--dim)] mt-1">Podrá cambiarlo después en Hogar.</p>
                  </div>
                  <button type="button" aria-label="Cerrar la elección de modo" onClick={()=>setModeModalOpen(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3" role="group" aria-label="Elija el modo Personal o Familiar">
                  <button type="button" aria-label="Modo Personal" onClick={()=>setPlanMode("personal")} className={`rounded-2xl border-2 p-3 text-left ${planMode==="personal"?"border-[var(--gold)] bg-[var(--surface2)]":"border-[var(--border)]"}`}><b className="font-display block">Personal</b><span className="text-[13px] text-[var(--dim)]">Su sueldo y sus gastos del día.</span></button>
                  <button type="button" aria-label="Modo Familiar" onClick={()=>setPlanMode("familiar")} className={`rounded-2xl border-2 p-3 text-left ${planMode==="familiar"?"border-[var(--gold)] bg-[var(--surface2)]":"border-[var(--border)]"}`}><b className="font-display block">Familiar</b><span className="text-[13px] text-[var(--dim)]">Gastos compartidos y privados.</span></button>
                </div>
                <button type="button" className={btnPrimary+" w-full mt-3"} onClick={()=>{ setModeModalOpen(false); setObStep(1); }}>Continuar</button>
              </div>
            </div>
          )}
          <form className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-3.5 mt-4 space-y-3" onSubmit={(e:FormEvent)=>{e.preventDefault();createHh.mutate();}}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-bold text-lg">{planMode==="personal"?"Su espacio personal":"Cree su hogar"}</h2>
              <span className="text-xs font-bold text-[var(--dim)] shrink-0">Paso {obStep+1} de 3</span>
            </div>
            <div className="flex gap-1.5" aria-label={`Paso ${obStep+1} de 3`}>
              {[0,1,2].map(i=><span key={i} className={`h-1.5 flex-1 rounded-full ${i<=obStep?"bg-[var(--gold)]":"bg-[var(--surface2)]"}`} />)}
            </div>
            {obStep===0 && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--dim)]">Elija su modo.</p>
                <div className="rounded-2xl border-2 border-[var(--gold)] bg-[var(--surface2)] p-3 flex items-center justify-between gap-2">
                  <div><b className="font-display block">{planMode==="personal"?"Personal":"Familiar"}</b><span className="text-[13px] text-[var(--dim)]">{planMode==="personal"?"Su sueldo y sus gastos del día.":"Gastos compartidos y privados."}</span></div>
                  <button type="button" className={btnGhost+" shrink-0"} onClick={()=>setModeModalOpen(true)}>Cambiar modo</button>
                </div>
                <button type="button" className={btnPrimary+" w-full"} onClick={()=>setObStep(1)}>Siguiente</button>
              </div>
            )}
            {obStep===1 && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--dim)]">Nombre su espacio y sus datos.</p>
                <div><Label htmlFor="hh-name">Nombre del hogar</Label><input id="hh-name" aria-label="Nombre del hogar" className={inputCls} value={hhName} onChange={e=>setHhName(e.target.value)} required /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label htmlFor="owner-name">Su nombre</Label><input id="owner-name" aria-label="Su nombre" className={inputCls} value={ownerName} onChange={e=>setOwnerName(e.target.value)} placeholder="Ej. Andrés" required /></div>
                  <div><Label htmlFor="owner-last">Su apellido</Label><input id="owner-last" aria-label="Su apellido" className={inputCls} value={ownerLast} onChange={e=>setOwnerLast(e.target.value)} placeholder="Ej. Téllez" /></div>
                  <div><Label htmlFor="owner-income">{planMode==="personal"?"Su sueldo mensual ($)":"Su ingreso mensual ($)"}</Label><input id="owner-income" aria-label="Su ingreso neto mensual" type="number" min="0" className={inputCls} value={ownerIncome} onChange={e=>setOwnerIncome(e.target.value)} placeholder="0" /></div>
                </div>
                <div><Label htmlFor="moneda-hogar">Moneda del hogar</Label><CurrencyPicker value={hhCurrency} onChange={setHhCurrency} /><p className="text-xs text-[var(--dim)] mt-1">Todo el hogar queda en esta moneda. Podrá cambiarla después en Hogar.</p>{hhCurrencySuggestion.detected && <p className="text-xs text-[var(--dim)]">Sugerida por la región de su teléfono: {currencyName(hhCurrencySuggestion.currency)}.</p>}</div>
                <p className="text-xs text-[var(--dim)]">Su nombre no se toma de su correo.</p>
                {obError && <p className="text-sm text-[var(--red)]">{obError}</p>}
                <div className="flex gap-2">
                  <button type="button" className={btnGhost+" flex-1"} onClick={()=>{setObError("");setObStep(0);}}>Atrás</button>
                  <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{ if(!hhName.trim()){ setObError("Escriba el nombre de su hogar."); return; } if(!ownerName.trim()){ setObError("Escriba su nombre."); return; } setObError(""); setObStep(2); }}>Siguiente</button>
                </div>
              </div>
            )}
            {obStep===2 && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--dim)]">Revise las reglas.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label htmlFor="cutoff">Día de corte (1–28)</Label><input id="cutoff" aria-label="Día de corte" type="number" min="1" max="28" className={inputCls} value={cutoff} onChange={e=>setCutoff(e.target.value)} /></div>
                  <div><Label htmlFor="threshold">Umbral de aprobación ($)</Label><input id="threshold" aria-label="Umbral de aprobación" type="number" min="0" className={inputCls} value={threshold} onChange={e=>setThreshold(e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label htmlFor="contrib-rule">Reparto del gasto</Label><select id="contrib-rule" aria-label="Reparto del gasto" className={inputCls} value={contribRule} onChange={e=>setContribRule(e.target.value as "equal"|"proportional")}><option value="equal">Partes iguales</option><option value="proportional">Proporcional al ingreso</option></select></div>
                  <div><Label htmlFor="approval-rule">Aprobación</Label><select id="approval-rule" aria-label="Aprobación" className={inputCls} value={approvalRule} onChange={e=>setApprovalRule(e.target.value as "unanimous"|"majority")}><option value="unanimous">Unánime</option><option value="majority">Mayoría</option></select></div>
                </div>
                <Help><b>Corte:</b> cierra su mes. <b>Umbral:</b> los gastos mayores requieren un Acuerdo.</Help>
                {createHh.error && <p className="text-sm text-[var(--red)]">{String(createHh.error)}</p>}
                <div className="flex gap-2">
                  <button type="button" className={btnGhost+" flex-1"} onClick={()=>setObStep(1)}>Atrás</button>
                  <button type="submit" className={btnPrimary+" flex-1"} disabled={createHh.isPending}>{createHh.isPending?"Creando…":planMode==="personal"?"Crear mi espacio":"Crear hogar"}</button>
                </div>
                <p className="text-xs text-[var(--dim)] text-center">7 de ingreso y 14 de gasto.</p>
              </div>
            )}
          </form>
          <InstallStepsDialog open={installStepsOpen} onClose={()=>setInstallStepsOpen(false)} />
          <HelpAssistant />
          </>)}
        </main>
        {/* Menú del invitado sin hogar (2026-11-26): el mismo cajón de
            hamburguesa, con «Mis tandas» y «Cerrar sesión» al final. Sin
            él, el invitado no tenía forma de llegar a su tanda ni de salir. */}
        {menuOpen && (
          <div aria-hidden="true" onClick={()=>setMenuOpen(false)} className="fixed inset-0 z-30 bg-black/60" />
        )}
        <div aria-hidden={!menuOpen} inert={!menuOpen} className={`fixed inset-y-0 left-0 z-50 w-[min(82vw,22rem)] bg-[var(--surface)] border-r-2 border-r-[var(--gold)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${menuOpen?"translate-x-0":"-translate-x-full"}`}>
          <div className="px-4 pt-safe pb-3 border-b border-[var(--border)]">
            <div className="flex items-start justify-between gap-2 pt-3">
              <div className="min-w-0">
                <p className="font-display font-extrabold leading-tight truncate text-[var(--text)]">SyncFinanzas</p>
                <p className="text-xs font-semibold text-[var(--text)] mt-0.5">INVITADO · SIN HOGAR</p>
              </div>
              <button type="button" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)} className="shrink-0 w-9 h-9 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] text-xl leading-none font-bold">×</button>
            </div>
          </div>
          <DrawerMenu
            sections={guestDrawerSections}
            currentTab={tab}
            onNavigate={(t)=>{ setTab(t); setMenuOpen(false); }}
            pinned={quickShortcuts}
            onTogglePin={togglePin}
            openGroups={openDrawerGroups}
            onToggleGroup={(title, open)=>setOpenDrawerGroups(prev=>({...prev,[title]:open}))}
            configOpen={configOpen}
            onToggleConfig={()=>setConfigOpen(o=>!o)}
            vistaOpen={vistaOpen}
            onToggleVista={()=>setVistaOpen(o=>!o)}
            darkMode={darkMode}
            onSetThemeMode={(d)=>setThemeMode(d)}
            onSignOut={handleSignOut}
          />
        </div>
        {!menuOpen && (
          <QuickBar
            currentTab={tab}
            menuOpen={menuOpen}
            shortcuts={[]}
            tabLabel={tabLabel}
            onToggleMenu={() => setMenuOpen((o) => !o)}
            onNewExpense={() => {}}
            onGoTab={(t) => { setTab(t); setMenuOpen(false); }}
          />
        )}
      </div>
    );
  }

  // La primera pantalla es siempre Inicio: al abrir la app, al entrar después
  // de iniciar sesión y al reabrirla, se ven saldo, gráficas, movimientos y las
  // tarjetas principales, sin abrir el menú ni ir a otra pestaña.
  const s=data.summary; const hh=data.household; setHouseholdCurrency(hh?.currency); const effTab:Tab = tab; const goTab=(x:Tab)=>{setTab(x); logUsageEvent(data?.household?.id, x, "ver_modulo"); if(x==="inicio"){ setChartsSeen(true); try{ localStorage.setItem("sf-guide-charts-seen","1"); }catch{} }};
  const scrollToLegalDoc = (docId: "privacy" | "terms" | "refunds") => {
    document.getElementById(`doc-${docId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Primera vista de la sesión: la analítica también cuenta el módulo en
  // el que se abre la app (goTab solo registra los cambios de módulo).
  const openTandaDetail=(id:number)=>{ setTandaDetailId(id); goTab("tandas"); };
  // Módulo Desarrollador: solo aparece en el menú para el dueño de la app.
  const drawerGroups: {title:string; tabs:Tab[]}[] = isAppOwner ? [...DRAWER_GROUPS, {title:"Desarrollador", tabs:["desarrollador"]}] : DRAWER_GROUPS;
  // Orden del menú: los grupos van en orden fijo (Mi dinero, Planes y
  // tandas, Ajustes, Desarrollador y Configuración al final); dentro de
  // cada grupo los módulos van en orden alfabético (español, sin
  // distinguir acentos), SALVO Mi dinero, que va por importancia
  // (Inicio, Personal, Hogar, Cuentas, Movimientos; ver orderDrawerTabs
  // en lib/drawerOrder). Configuración participa como un grupo más (Guía
  // de uso y Vista); Mike no es un grupo y sigue al pie del cajón.
  const drawerSections: DrawerMenuSection[] = [
    ...drawerGroups.map((g) => {
      const tabs = orderDrawerTabs(g.title, g.tabs, tabLabel).map((tid) => ({ id: tid, label: tabLabel(tid) }));
      // «Nuevo» abre el formulario desde el cajón y lleva su propia
      // estrella, para fijarlo o quitarlo como los demás atajos. Va AL
      // FINAL de Mi dinero (corrección de Heriberto 2026-11-24 ~12:06),
      // después de Movimientos.
      const rows = g.title === "Mi dinero" ? [...tabs, { action: "nuevo-gasto" as const, label: "Nuevo" }] : tabs;
      return { title: g.title, tabs: rows };
    }),
    { title: "Configuración", tabs: [], config: true },
  ];
  // Ir a un módulo y dejar el campo del importe a la vista con el cursor listo:
  // cambia de pestaña y, cuando el formulario ya se pintó, lo desplaza al centro
  // (así el encabezado fijo no lo tapa) y le da el foco para escribir.
  const goToForm=(x:Tab,fieldId:string)=>{ goTab(x); window.setTimeout(()=>{ const el=document.getElementById(fieldId); el?.scrollIntoView({block:"center",behavior:"smooth"}); (el as HTMLInputElement|null)?.focus({preventScroll:true}); },250); };
  // Al cambiar de paso dentro de un formulario, la tarjeta debe quedar visible:
  // se desplaza sola hasta arriba de la tarjeta (scroll-mt-28 evita que el
  // encabezado fijo la tape) para seguir llenando sin tener que buscarla.
  const scrollFormTop=(id:string)=>{ window.setTimeout(()=>{ document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"}); },60); };
  const openNewMovement=(t:"income"|"expense")=>{ setEditingMv(null); setMvType(t); setMvCat(""); setMvSub(""); setMvStep(1); goToForm("movimientos","mv-amount"); };
  const guideStep1 = hh.mode==="personal" ? data.personal.salary>0 : data.accounts.length>0;
  const guideStep2 = data.totalMovements>0;
  const guideStep3 = chartsSeen;
  const isAdmin = !me || me.role==="admin";
  // Permisos de tanda del perfil actual (me): la interfaz solo muestra los
  // botones que corresponden a su rol; el servidor es la autoridad y rechaza
  // lo no permitido. El rol sale de l se listan. Es la misma
  // regla de la lista de Movimientos. Los totales de las gráficas sí
  // incluyen todo el hogar; las ventanas de detalle solo listan lo visible
  // y avisan cuántos movimientos privados quedan fuera.
  // «mine» lo marca el servidor (el perfil del movimiento pertenece a la
  // cuenta del usuario): un movimiento propio nunca se esconde, aunque se
  // haya guardado con otro perfil de la misma cuenta o el perfil actual
  // del dispositivo sea otro. Sin ese dato, un gasto propio contado en
  // los totales podía no aparecer en la lista.
  const canSeeMov = (m:{visibility:string;profileId:number|null;mine?:boolean})=> canSeeMovementRow(m, me);
  const visibleMovs = data.movements.filter(canSeeMov);
  // Movimientos de la tarjeta de Inicio: solo los del mes que muestra el
  // tablero (los 5 más recientes de ese mes).
  const homeMovs = monthMovements(visibleMovs, s.currentMonth);
  // Totales del mes para el resumen visible de la tarjeta Movimientos
  // (misma lista y misma regla: sin reversados ni reversiones).
  const homeMovTotals = sumMonthMovements(homeMovs);
  const homeMovSummary = `Entradas ${money(homeMovTotals.income)} · Salidas ${money(homeMovTotals.expense)}`;
  // Presupuestos y metas del mes para sus resúmenes visibles.
  const monthBudgets = data.budgets.filter(b=>b.month===s.currentMonth);
  const monthBudgetsSum = sumBudgets(monthBudgets);
  const goalsSum = sumGoals(data.goals);
  // ---- Ajustes de la calculadora de Rebe (A–G) ----
  // Planes activos (sin cumplir ni cancelar): solo con plan hay apartado
  // del mes y «Te falta ahorrar este mes». Sin meta ni plan, todo queda
  // exactamente como hoy (las guardas `??` cubren datos viejos en caché
  // que aún no traen estos campos).
  const activeGoalPlans = data.goalPlans.filter(p=>p.status!=="cumplido" && p.status!=="cancelado");
  const monthSetAside = s.monthSetAside ?? 0;
  const monthRemaining = Math.round((s.monthIncome - s.monthExpense - monthSetAside)*100)/100;
  const monthShortfall = totalMonthShortfall(activeGoalPlans, data.fundMovements, s.currentMonth);
  const pinnedGoal = pickPinnedGoal(data.goals);
  const pinnedPlan = pinnedGoal ? data.goalPlans.find(p=>p.goalId===pinnedGoal.id) : undefined;
  // Fondo fijado arriba de Inicio (importancia 5, igual que la meta).
  const pinnedFund = pickPinnedFund(data.funds);
  const fundDetail = fundDetailId == null ? null : data.funds.find((f) => f.id === fundDetailId) ?? null;
  const accountSummaries = (data.accountSummaries ?? []) as AccountSummary[];
  // Lo apartado que no salió de ninguna cuenta (saldo inicial sin
  // cuenta, sobrante del mes): no se asigna a ninguna cuenta.
  const unassignedFunds = Math.round((s.totalInFunds - s.fundsFromAccounts)*100)/100;
  // Etiquetas de importancia 1–5 (formulario de meta y editor «Cambiar»).
  const importanceLabel = (n:number)=> n===1?"La menos importante":n===2?"Poco importante":n===3?"Normal":n===4?"Muy importante":"La más importante · se fija arriba de Inicio";
  // Editor en línea de la importancia de una meta (tarjeta de Metas y
  // tarjeta fijada de Inicio): mismo editor en los dos sitios.
  const renderImpEditor = (g:{id:number;name:string}) => (
    <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
      <Label htmlFor={`imp-${g.id}`}>Importancia de la meta</Label>
      <select id={`imp-${g.id}`} aria-label={`Importancia de ${g.name}, de 1 a 5`} className={inputCls} value={impEditValue} onChange={e=>setImpEditValue(e.target.value)}>
        {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} — {importanceLabel(n)}</option>)}
      </select>
      <p className="text-xs text-[var(--dim)] mt-1">Con 5, la meta se fija arriba de Inicio.</p>
      {impPendingSql && <p className="text-xs text-[var(--red)] mt-1">La importancia se guardará cuando se ejecute el SQL pendiente (supabase/add-goals-importance.sql).</p>}
      <div className="flex gap-2 mt-2">
        <button type="button" aria-label={`Guardar la importancia de ${g.name}`} className={btnPrimary} disabled={setImp.isPending} onClick={()=>{ setImp.mutate({id:g.id,importance:Number(impEditValue)},{onSuccess:(r)=>{inv(); setImpPendingSql(r.saved===false); setImpEditGoalId(null);}}); }}>{setImp.isPending?"Guardando…":"Guardar"}</button>
        <button type="button" aria-label="Cancelar el cambio de importancia" className={btnGhost} onClick={()=>setImpEditGoalId(null)}>Cancelar</button>
      </div>
    </div>
  );
  // Editor en línea de la importancia de un fondo (tarjeta de Fondos y
  // tarjeta fijada de Inicio): mismo editor que en las metas.
  const renderFundImpEditor = (f:{id:number;name:string}) => (
    <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
      <Label htmlFor={`imp-fund-${f.id}`}>Importancia del fondo</Label>
      <select id={`imp-fund-${f.id}`} aria-label={`Importancia de ${f.name}, de 1 a 5`} className={inputCls} value={impEditFundValue} onChange={e=>setImpEditFundValue(e.target.value)}>
        {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} — {importanceLabel(n)}</option>)}
      </select>
      <p className="text-xs text-[var(--dim)] mt-1">Con 5, el fondo se fija arriba de Inicio.</p>
      {fundImpPendingSql && <p className="text-xs text-[var(--red)] mt-1">La importancia se guardará cuando se ejecute el SQL pendiente (supabase/add-funds-importance.sql).</p>}
      <div className="flex gap-2 mt-2">
        <button type="button" aria-label={`Guardar la importancia de ${f.name}`} className={btnPrimary} disabled={setFundImp.isPending} onClick={()=>{ setFundImp.mutate({id:f.id,importance:Number(impEditFundValue)},{onSuccess:(r)=>{inv(); setFundImpPendingSql(r.saved===false); setImpEditFundId(null);}}); }}>{setFundImp.isPending?"Guardando…":"Guardar"}</button>
        <button type="button" aria-label="Cancelar el cambio de importancia" className={btnGhost} onClick={()=>setImpEditFundId(null)}>Cancelar</button>
      </div>
    </div>
  );
  // Formulario rápido «Aportar a {meta}»: se usa en la tarjeta de la
  // meta fijada (si la meta está fijada) y en «Metas y patrimonio» (si
  // no lo está), para no abrirlo dos veces a la vez.
  const renderQuickGoalForm = (g:{id:number;name:string}) => (
    <form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!quickGoalAmt||Number(quickGoalAmt)<=0) return; const notice=requiredGoalAccountNotice(quickGoalAcc); if(notice){ setQuickGoalAccError(notice); return; } contributeGoal.mutate({id:g.id,amount:Number(quickGoalAmt),accountId:Number(quickGoalAcc)});}}><p className="font-display font-bold text-sm">Aportar a {g.name}</p><div><Label htmlFor={`qg-amt-${g.id}`}>Importe ($)</Label><input id={`qg-amt-${g.id}`} autoFocus aria-label={`Importe a aportar a la meta ${g.name}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickGoalAmt} onChange={e=>setQuickGoalAmt(e.target.value)} /></div><div><Label htmlFor={`qg-acc-${g.id}`}>¿De dónde se descuenta?</Label><select id={`qg-acc-${g.id}`} aria-label="Cuenta de donde se descuenta el aporte a la meta" className={inputCls} value={quickGoalAcc} onChange={e=>{setQuickGoalAcc(e.target.value);setQuickGoalAccError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{(()=>{ const pv = contributionFxPreview(quickGoalAmt, quickGoalAcc); return pv ? <p className="text-xs text-[var(--dim)] mt-1">{pv}</p> : null; })()}{quickGoalAccError && <p className="text-sm text-[var(--red)]">{quickGoalAccError}</p>}{contributeGoal.error && <p className="text-sm text-[var(--red)]">{String(contributeGoal.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={contributeGoal.isPending||!quickGoalAmt}>{contributeGoal.isPending?"Guardando…":"Guardar aporte"}</button><button type="button" className={btnGhost} onClick={()=>setQuickGoal(null)}>Cancelar</button></div></form>
  );
  // Formulario rápido «Aportar a {fondo}»: se usa en la tarjeta del fondo
  // fijado y en la lista de Fondos de Inicio. Toda aportación exige
  // cuenta, con el mismo aviso que la tarjeta de Fondos.
  const renderQuickFundForm = (f:{id:number;name:string}) => (
    <form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); const amt=Number(quickFundAmt); if(!amt||amt<=0) return; const notice=requiredGoalAccountNotice(quickFundAcc); if(notice){ setQuickFundAccError(notice); return; } fundMove.mutate({fundId:f.id,type:"contribution",amount:amt,accountId:Number(quickFundAcc)},{onSuccess:()=>{setQuickFundId(null);setQuickFundAmt("");setQuickFundAcc("");setQuickFundAccError("");}});}}><p className="font-display font-bold text-sm">Aportar a {f.name}</p><div><Label htmlFor={`qf-amt-${f.id}`}>Importe ($)</Label><input id={`qf-amt-${f.id}`} autoFocus aria-label={`Importe a aportar a ${f.name}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickFundAmt} onChange={e=>setQuickFundAmt(e.target.value)} /></div><div><Label htmlFor={`qf-acc-${f.id}`}>¿De dónde se descuenta?</Label><select id={`qf-acc-${f.id}`} aria-label={`Cuenta de donde se descuenta el aporte a ${f.name}`} className={inputCls} value={quickFundAcc} onChange={e=>{setQuickFundAcc(e.target.value);setQuickFundAccError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{quickFundAccError && <p className="text-sm text-[var(--red)]">{quickFundAccError}</p>}{fundMove.error && <p className="text-sm text-[var(--red)]">{String(fundMove.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={fundMove.isPending||!quickFundAmt}>{fundMove.isPending?"Guardando…":"Guardar aporte"}</button><button type="button" className={btnGhost} onClick={()=>setQuickFundId(null)}>Cancelar</button></div></form>
  );
  // «Plan del fondo»: cuánto se puede apartar este mes y a qué ritmo,
  // calculado en vivo con el ingreso y los gastos reales del mes (nunca
  // un sueldo fijo supuesto), la cuenta con mayor saldo y los
  // presupuestos con sobrante. Se usa en la tarjeta del fondo fijado y
  // en la tarjeta del fondo en Fondos. `onToday` prellena el formulario
  // de aporte con el monto del día y la cuenta sugerida.
  const renderFundPlan = (
    f: { id: number; name: string; balance: number; targetAmount: number | null; targetDate?: string | null; createdAt?: string | null },
    onToday: (amount: number, accountId: number | null) => void,
  ) => {
    const surplus = monthBudgets
      .filter((b) => b.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)
      .slice(0, 2)
      .map((b) => ({ name: getCatName(b.categoryId), remaining: b.remaining }));
    const plan = fundPlan({
      fund: f,
      monthIncome: s.monthIncome,
      monthExpense: s.monthExpense,
      monthSetAside,
      perMonth: fundNeedPerMonth(f),
      fundMovements: data.fundMovements,
      currentYm: s.currentMonth,
      accounts: data.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
      surplusBudgets: surplus,
    });
    // Frecuencia elegida para este fondo (Por día por defecto): cambia
    // el botón de aportar y el cálculo de lo esperado y lo proyectado.
    // Con inicio chico, el ritmo efectivo es el asequible.
    const freq = fundFrequency(f.id);
    const effPerDay = plan.smallStart?.perDay ?? plan.perDay;
    const effPerWeek = plan.smallStart?.perWeek ?? plan.perWeek;
    const effPerMonth = plan.smallStart?.perMonth ?? plan.perMonth;
    const todayAmount = freq === "dia" ? effPerDay : freq === "semana" ? effPerWeek : effPerMonth;
    const todayLabel = freq === "dia" ? "hoy" : freq === "semana" ? "esta semana" : "este mes";
    const projected = plan.projected ? plan.projected[freq] : null;
    // Hay ritmo cuando hay meta, fecha vigente y aporte por día/semana/mes.
    const hasRhythm = plan.remaining != null && plan.remaining > 0 && !plan.datePassed && effPerDay != null && effPerWeek != null && effPerMonth != null && f.targetDate;
    return (
      <div className="mt-3 rounded-2xl bg-[var(--surface2)] p-3 sm:p-4">
        <p className="font-display font-bold text-sm">Plan del fondo</p>
        {plan.hasIncome ? (
          <>
            <p className="text-sm mt-1">Este mes entraron {money(s.monthIncome)} y gastaste {money(s.monthExpense)}.</p>
            <p className="text-xs text-[var(--dim)] mt-2">Puedes apartar este mes</p>
            <p className="font-display font-extrabold text-2xl text-[var(--accent)]">{money(plan.capacity)}</p>
            {plan.capacity === 0 && plan.smallStart == null && hasRhythm && (
              <p className="text-sm mt-2">El gasto de este mes ya se comió el ingreso, así que el plan no tiene con qué empezar este mes.</p>
            )}
          </>
        ) : plan.smallStart?.account ? (
          <p className="text-sm mt-1">Este mes aún no hay ingresos registrados, pero puede empezar con lo que tiene en {plan.smallStart.account.name}.</p>
        ) : hasRhythm ? (
          <p className="text-sm mt-1">Aún no hay ingresos registrados este mes. En cuanto registre uno, el plan le dirá con cuánto empezar.</p>
        ) : (
          <p className="text-sm mt-1">Este mes aún no hay ingresos registrados, así que no hay base para calcular el plan.</p>
        )}
        {plan.remaining != null && plan.remaining > 0 && !plan.datePassed && effPerDay != null && effPerWeek != null && effPerMonth != null && f.targetDate && (
          <>
            <p className="text-sm mt-2">Para llegar a los {money(plan.remaining)} el {fmtDate(f.targetDate)} (quedan {plan.daysLeft} {plan.daysLeft === 1 ? "día" : "días"}):</p>
            {plan.smallStart && (
              <div className="mt-2 rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-3">
                <p className="text-sm font-bold">Empiece con poco: {money(plan.smallStart.perDay)} al día{plan.smallStart.account ? ` desde ${plan.smallStart.account.name}` : ""}</p>
              </div>
            )}
            <p className="text-sm mt-2">Elige cómo aportar:</p>
            <div className="mt-2 space-y-2">
              {([
                { key: "dia" as FundFrequency, label: "Por día", amount: effPerDay },
                { key: "semana" as FundFrequency, label: "Por semana", amount: effPerWeek },
                { key: "mes" as FundFrequency, label: "Por mes", amount: effPerMonth },
              ]).map((row) => {
                const selected = freq === row.key;
                return (
                  <button key={row.key} type="button" aria-pressed={selected} aria-label={`Elegir aporte por ${row.key === "dia" ? "día" : row.key === "semana" ? "semana" : "mes"} al fondo ${f.name}`} onClick={() => chooseFundFrequency(f.id, row.key)} className={`flex w-full justify-between gap-2 rounded-xl px-3 py-2 text-sm ${selected ? "bg-[var(--surface)] border-2 border-[var(--accent)]" : "bg-[var(--surface)] border-2 border-transparent"}`}>
                    <span>{row.label}</span>
                    <span className="flex items-center gap-2"><b className="whitespace-nowrap">{money(row.amount)}</b>{selected && <span aria-hidden="true" className="font-bold text-[var(--accent)]">✓</span>}</span>
                  </button>
                );
              })}
            </div>
            {plan.expectedByNow != null && (
              <>
                <p className="text-sm mt-2">Esperado hasta hoy: {money(plan.expectedByNow)} · Aportado: {money(plan.contributedThisMonth)}</p>
                {plan.contributedThisMonth < plan.expectedByNow && (
                  <p className="text-sm mt-1 font-semibold text-[var(--red)]">Te faltan {money(plan.expectedByNow - plan.contributedThisMonth)} para ir al corriente.</p>
                )}
              </>
            )}
            {projected != null && f.targetAmount != null && (
              <>
                <p className="text-sm mt-2">Con este ritmo llegas a {money(projected)} el {fmtDate(f.targetDate)}.</p>
                {projected >= f.targetAmount ? (
                  <p className="text-sm mt-1 font-semibold text-[var(--green)]">Cubre la meta.</p>
                ) : plan.smallStart ? (
                  <p className="text-sm mt-1 font-semibold text-[var(--red)]">No cubre la meta de {money(f.targetAmount)}: mueva la fecha o ponga una meta más chica.</p>
                ) : (
                  <>
                    <p className="text-sm mt-1 font-semibold text-[var(--red)]">No llega: faltan {money(f.targetAmount - projected)}.</p>
                    <p className="text-sm mt-1">Para llegar, aporte más en cada periodo o mueva la fecha límite.</p>
                  </>
                )}
              </>
            )}
          </>
        )}
        {plan.remaining != null && plan.remaining > 0 && plan.datePassed && (
          <p className="text-sm mt-2 font-semibold text-[var(--red)]">La fecha límite ya pasó.</p>
        )}
        {plan.remaining != null && plan.remaining <= 0 && (
          <p className="text-sm mt-2 font-semibold">Meta alcanzada.</p>
        )}
        {f.targetAmount != null && !f.targetDate && (
          <p className="text-sm mt-2">Agrega una fecha límite para ver cuánto aportar por día, semana y mes.</p>
        )}
        {f.targetAmount == null && (
          <p className="text-sm mt-2">Pon una meta y una fecha límite para ver el plan completo.</p>
        )}
        {(plan.topAccount || plan.surplusBudgets.length > 0) && (
          <>
            <p className="text-sm font-semibold mt-3">¿De dónde agarrar?</p>
            {plan.topAccount && <p className="text-sm mt-1">· {plan.topAccount.name}, la cuenta con mayor saldo</p>}
            {plan.surplusBudgets.map((b) => (
              <p key={b.name} className="text-sm mt-1">· Sobrante de {b.name}: {money(b.remaining)} sin gastar</p>
            ))}
          </>
        )}
        {plan.verdict === "alcanza" && (
          <p className="text-sm mt-2 font-semibold text-[var(--green)]">Sí alcanza: después de apartar te quedan {money(plan.leftoverAfter)}.</p>
        )}
        {plan.verdict === "no-alcanza" && (
          <>
            <p className="text-sm mt-2 font-semibold text-[var(--red)]">No alcanza este mes: faltan {money(plan.shortfall)}.</p>
            <p className="text-sm mt-1">Revise sus gastos o mueva la fecha límite.</p>
          </>
        )}
        <p className="text-xs text-[var(--dim)] mt-2">Aportado este mes: {money(plan.contributedThisMonth)}{plan.needThisMonth != null ? ` de ${money(plan.needThisMonth)}` : ""}</p>
        {plan.needThisMonth != null && plan.needThisMonth > 0 && (
          <div className="h-2 bg-[var(--surface)] rounded-full mt-1"><div className="h-full bg-[var(--gold)] rounded-full" style={{ width: `${Math.min(100, Math.round((plan.contributedThisMonth / plan.needThisMonth) * 100))}%` }} /></div>
        )}
        {todayAmount != null && todayAmount > 0 && (
          <button type="button" aria-label={`Aportar ${money(todayAmount)} ${todayLabel} al fondo ${f.name}`} className={btnPrimary + " mt-3 w-full"} onClick={() => onToday(todayAmount, plan.smallStart?.account?.id ?? plan.topAccount?.id ?? null)}>Aportar {money(todayAmount)} ({todayLabel})</button>
        )}
      </div>
    );
  };
  // Meses con al menos un movimiento visible: el selector de mes solo
  // habilita esos meses, para que no se pueda elegir un mes en blanco.
  // La lista la calcula el servidor sobre todo el historial.
  const monthsWithMovs = new Set(data.monthsWithMovements ?? []);
  // Movimientos del detalle de ingresos vs gastos: misma regla con la que el
  // servidor arma las barras (mes tocado, ingreso o gasto/pago de deuda, sin
  // reversados ni reversiones), para que la suma coincida con la barra.
  // El mes visible usa las filas del overview; un mes anterior se carga
  // bajo demanda (incExpMonthQuery) y mientras tanto se muestra «Cargando…».
  const incExpRows = incExpDetail ? (incExpDetail.month === s.currentMonth ? data.movements : (incExpMonthQuery.data ?? [])) : [];
  const incExpBase = incExpDetail ? incExpRows.filter(m=> m.date.startsWith(incExpDetail.month) && !m.isReversed && !m.reversalOfId && (incExpDetail.kind==="income" ? m.type==="income" : (m.type==="expense"||m.type==="debt_payment"))).sort((a,b)=> b.date.localeCompare(a.date) || b.id-a.id) : [];
  const incExpLoading = !!incExpDetail && incExpDetail.month !== s.currentMonth && incExpMonthQuery.isPending;
  const incExpMovs = incExpBase.filter(canSeeMov);
  const incExpHiddenCount = incExpBase.length - incExpMovs.length;
  const catDetailBase = catDetail ? data.movements.filter(m=> (m.categoryId??null)===catDetail.categoryId && m.date.startsWith(catDetail.month) && (m.type==="expense"||m.type==="debt_payment") && !m.isReversed && m.reversalOfId==null).sort((a,b)=> b.date.localeCompare(a.date) || b.id-a.id) : [];
  const catDetailMovs = catDetailBase.filter(canSeeMov);
  const catDetailHiddenCount = catDetailBase.length - catDetailMovs.length;
  // Variación del neto contra el mes anterior, calculada de monthlySeries
  // (datos reales, nunca inventada). Si no hay mes anterior en la serie,
  // no se muestra la línea.
  const netVar = (()=>{ const idx=s.monthlySeries.findIndex(x=>x.month===s.currentMonth); if(idx<=0) return null; const cur=s.monthlySeries[idx]; const prev=s.monthlySeries[idx-1]; if(!cur||!prev) return null; const diff=(cur.income-cur.expense)-(prev.income-prev.expense); const prevName=fmtMonth(prev.month).replace(/\s+(de\s+)?\d{4}$/,""); return {diff, prevName}; })();
  const getCatName=(id:number|null)=>data.categories.find(c=>c.id===id)?.name||"—";
  // Título legible de un movimiento en las listas: si el concepto viene
  // vacío, se muestra la categoría y, si tampoco hay, «Gasto sin concepto».
  // Un movimiento guardado siempre debe verse en su lista, aunque su
  // concepto esté vacío.
  const movTitle=(m:{concept:string;categoryId:number|null})=> movementTitle(m, getCatName(m.categoryId)!=="—" ? getCatName(m.categoryId) : null);
  const getAccName=(id:number|null)=>data.accounts.find(a=>a.id===id)?.name||"Sin cuenta";
  const incExpByAcc: {key:string;name:string;total:number;movs:typeof incExpMovs}[] = groupMovementsByAccount(incExpMovs, (id)=>getAccName(id));

  // Formulario de registro de movimientos (pasos 1-3, con lectura de
  // comprobante en el paso 1). Se usa en el módulo Movimientos y en el
  // pop-up de registro rápido desde Inicio: la misma forma, sin duplicar
  // el JSX, y solo una instancia montada a la vez (el módulo y el pop-up
  // nunca se muestran juntos).
  const renderMvForm=()=>(
<form id="mv-form" className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2 scroll-mt-28" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(mvStep<3){ if(mvStep===1 && !mvAmount) return; setMvStep(mvStep+1); scrollFormTop("mv-form"); } else { if(ocrDateCheckMv){ setOcrDateErrorMv(`Confirme la fecha de origen del gasto: la fecha leída es ${fmtDate(ocrDateCheckMv.readDate)}. Use esa fecha, use la de hoy o corrija la fecha.`); setMvMore(true); scrollFormTop("mv-form"); return; } const notice=requiredAccountNotice(mvType,mvAccount); if(notice){ setMvAccountError(notice); return; } saveMv.mutate(); }}}>
  <h2 className="font-display font-bold text-lg">{editingMv?"Editar movimiento":"Registrar movimiento"}</h2>
  <p className="text-xs text-[var(--dim)]">Paso {mvStep} de 3</p>
  {mvAssignPendingSql && <p className="text-sm text-[var(--red)]">La asignación al presupuesto se guardará cuando se ejecute el SQL pendiente (supabase/add-movement-budget-assignment.sql). Por ahora, el gasto se cuenta según las reglas del presupuesto.</p>}
  {mvConversionPendingSql && <p className="text-sm text-[var(--red)]">El detalle de la conversión (importe original y tasa) se guardará cuando se ejecute el SQL pendiente (supabase/exchange-rates.sql). El gasto ya se cuenta en moneda del hogar.</p>}
  <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden" aria-hidden="true"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${mvStep*33.33}%`}} /></div>
  {ocrNoticeMv && <p className="text-xs text-[var(--green)]">{ocrNoticeMv}</p>}
  {ocrDateCheckMv && <div className="border border-[var(--red)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">Confirme la fecha de origen del gasto</p>
    <p className="text-sm mt-1">La fecha leída del comprobante es <b>{fmtDate(ocrDateCheckMv.readDate)}</b>{ocrDateCheckMv.reason==="future"?" (una fecha futura)":" (de otro año)"}. ¿Es esa la fecha del gasto?</p>
    <p className="text-xs text-[var(--dim)] mt-1">En el formulario quedó la fecha de hoy ({fmtDate(mvDate)}). Puede usar la fecha leída, dejar la de hoy o corregirla en «Más opciones» → Fecha.</p>
    <div className="flex gap-2 mt-2">
      <button type="button" aria-label={`Usar la fecha leída ${fmtDate(ocrDateCheckMv.readDate)}`} className={btnPrimary+" flex-1"} onClick={()=>{setMvDate(ocrDateCheckMv.readDate);setOcrDateCheckMv(null);setOcrDateErrorMv("");}}>Usar {fmtDate(ocrDateCheckMv.readDate)}</button>
      <button type="button" aria-label="Usar la fecha de hoy" className={btnGhost+" flex-1"} onClick={()=>{setMvDate(todayISO());setOcrDateCheckMv(null);setOcrDateErrorMv("");}}>Usar hoy</button>
    </div>
  </div>}
  {ocrDateErrorMv && <p className="text-sm text-[var(--red)]">{ocrDateErrorMv}</p>}
  {mvStep===1 && <>
  {mvRepeatError && <p className="text-sm text-[var(--red)]">{mvRepeatError}</p>}
  <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Tipo de movimiento">
    {(["expense","income","transfer","debt_payment"] as const).map(t=><button type="button" key={t} aria-label={TYPE_LABEL[t]} disabled={editingSplitGroup!=null} onClick={()=>{setMvType(t);setMvCat("");setMvSub("");if(t!=="expense"){setMvSplit(false);setMvSplitLines([]);}}} className={`rounded-full py-2 text-[12px] font-bold ${mvType===t?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"} disabled:opacity-50`}>{TYPE_LABEL[t]}</button>)}
  </div>
  {(mvType==="expense"||mvType==="debt_payment") && <div className="border border-dashed border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">¿Tiene el comprobante?</p>
    <p className="text-xs text-[var(--dim)]">Suba la foto y la app lee el importe, el concepto y la categoría. Puede revisar y corregir todo antes de guardar.</p>
    <label className={btnPrimary+" w-full mt-2 text-center cursor-pointer"} aria-label="Subir foto del comprobante al empezar">Subir foto del comprobante<input type="file" accept="image/*" className="hidden" aria-label="Archivo del comprobante" onChange={e=>{ const f=e.target.files?.[0]; void pickAndReadReceipt(f,"mv"); e.target.value=""; }} /></label>
    {receipt && <div className="flex items-center gap-2 mt-2"><img src={receipt.preview} alt="Vista previa de la foto del comprobante" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)]" /><button type="button" aria-label="Quitar foto del comprobante" className="text-xs underline text-[var(--red)]" onClick={()=>{setReceipt(null);setOcrDetailMv(null);setOcrLabelMv("");setOcrNoticeMv("");setOcrErrorMv("");setOcrErrDetailMv("");setOcrDateCheckMv(null);setOcrDateErrorMv("");}}>Quitar foto</button></div>}
    {receipt && <div className="mt-2">
      <button type="button" aria-label="Leer el comprobante de nuevo y llenar el formulario" className={btnGhost+" w-full"} disabled={ocrBusyMv} onClick={()=>void runOcr("mv")}>{ocrBusyMv?"Leyendo el comprobante…":"Leer el comprobante de nuevo"}</button>
      {ocrProgressMv && <p className="text-xs text-[var(--dim)] mt-1">{ocrProgressMv}</p>}
      {ocrErrorMv && <p className="text-xs text-[var(--red)] mt-1">{ocrErrorMv}</p>}
      {ocrErrDetailMv && <p className="text-xs text-[var(--dim)] mt-1">Detalle: {ocrErrDetailMv}</p>}
      <p className="text-xs text-[var(--dim)] mt-1">La lectura se hace en su dispositivo, sin costo.</p>
    </div>}
  </div>}
  <div><Label htmlFor="mv-amount">Importe ($)</Label><input id="mv-amount" aria-label="Importe del movimiento" type="number" min="0.01" step="0.01" required className={inputCls+" text-xl font-bold py-2"} value={mvAmount} onChange={e=>setMvAmount(e.target.value)} /></div>
  <button type="button" className={btnPrimary+" w-full"} disabled={!mvAmount} onClick={()=>{setMvStep(2); scrollFormTop("mv-form");}}>Siguiente</button>
  </>}
  {mvStep===2 && <>
  {mvType!=="transfer" && !mvSplit && <>
    <div><Label htmlFor="mv-cat">{mvType==="income"?"Tipo de ingreso":"Tipo de gasto"}</Label><select id="mv-cat" aria-label="Categoría del movimiento" className={inputCls} value={mvCat} onChange={e=>{setMvCat(e.target.value);setMvSub("");setAppliedRuleMv(null);}}><option value="">Sin categoría</option>{catsForType.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new__">+ Nueva categoría…</option></select></div>
    {mvCat==="__new__" && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
    <p className="text-sm">Escriba el nombre de la categoría nueva.</p>
    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" placeholder="Ej. Barbería" maxLength={40} className={inputCls} value={newCatName} onChange={e=>setNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría y usarla" className={btnPrimary} disabled={!newCatName.trim() || createCat.isPending} onClick={()=>createCat.mutate({target:"mv",name:newCatName.trim(),kind:mvType==="income"?"income":"expense"})}>{createCat.isPending?"Creando…":"Crear y usar"}</button></div>
    <button type="button" className="text-xs underline mt-2" onClick={()=>{setMvCat("");setNewCatName("");}}>Cancelar</button>
    {createCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createCat.error)}</p>}
  </div>}
    <div><Label htmlFor="mv-sub">Subcategoría</Label><select id="mv-sub" aria-label="Subcategoría del movimiento" className={inputCls} value={mvSub} onChange={e=>setMvSub(e.target.value)} disabled={!selectedCat}><option value="">{selectedCat?"Seleccione…":"Primero seleccione la categoría"}</option>{(selectedCat?.subcategories||[]).map(sb=><option key={sb} value={sb}>{sb}</option>)}<option value="__new__">+ Nueva subcategoría…</option></select>                {mvSub==="__new__" && selectedCat && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-2.5 bg-[var(--surface2)]"><p className="text-xs">¿Agregar “{newSubName||"…"}” a {selectedCat.name}?</p><div className="flex gap-2 mt-2"><input aria-label="Nombre de la nueva subcategoría" placeholder="Nombre de la subcategoría" className={inputCls} value={newSubName} onChange={e=>setNewSubName(e.target.value)} /><button type="button" aria-label="Confirmar y agregar la nueva subcategoría" className={btnPrimary} disabled={!newSubName.trim() || addSub.isPending} onClick={()=>addSub.mutate({categoryId:selectedCat.id,name:newSubName.trim()},{onSuccess:()=>{setMvSub(newSubName.trim());setNewSubName("");}})}>Sí, agregar</button></div>{addSub.error && <p className="text-xs text-[var(--red)] mt-1">{String(addSub.error)}</p>}</div>}
    </div>
  </>}
  {mvType==="transfer" && <p className="text-sm text-[var(--dim)]">Las transferencias no llevan categoría.</p>}
  {ocrLabelMv && mvCat==="" && mvType!=="transfer" && !mvSplit && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
    <p className="text-sm">La categoría sugerida «{ocrLabelMv}» no está en su hogar. Puede crearla ya ajustada a este ticket.</p>
    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" className={inputCls} value={ocrNewCatName} onChange={e=>setOcrNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría sugerida y usarla" className={btnPrimary} disabled={!ocrNewCatName.trim() || createCat.isPending} onClick={()=>createCat.mutate({target:"mv",name:ocrNewCatName.trim(),kind:"expense"})}>{createCat.isPending?"Creando…":"Crear y usar"}</button></div>
    <button type="button" className="text-xs underline mt-2" onClick={()=>setOcrLabelMv("")}>Omitir, elegiré otra</button>
    {createCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createCat.error)}</p>}
  </div>}
  {mvType==="expense" && (editingMv==null || editingSplitGroup!=null) && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-bold">Dividir entre categorías</p>
      <button type="button" role="switch" aria-checked={mvSplit} aria-label="Dividir entre categorías" disabled={editingSplitGroup!=null} onClick={()=>toggleSplit(!mvSplit)} className={`shrink-0 w-12 h-7 rounded-full ${mvSplit?"bg-[var(--accent)]":"bg-[var(--border)]"} relative disabled:opacity-50`}><span className={`absolute top-0.5 ${mvSplit?"right-0.5":"left-0.5"} w-6 h-6 rounded-full bg-[var(--bg)]`} /></button>
    </div>
    <p className="text-xs text-[var(--dim)]">Reparte el importe entre varias categorías. Las partes deben sumar el total del gasto.</p>
    {mvSplit && <>
      {mvSplitLines.map((line, li) => (
        <div key={line.key} className="flex gap-2 mt-2 items-center">
          <select aria-label={`Categoría de la parte ${li+1}`} className={inputCls+" flex-1 min-w-0"} value={line.categoryId} onChange={e=>{ const v=e.target.value; setMvSplitLines(ls=>ls.map((l,j)=>j===li?{...l,categoryId:v,budgetId:null}:l)); }}>
            <option value="">Seleccione…</option>
            {catsForType.filter(c=>c.id===Number(line.categoryId) || !mvSplitLines.some((l,j)=>j!==li && l.categoryId===String(c.id))).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input aria-label={`Importe de la parte ${li+1}`} type="number" min="0.01" step="0.01" className={inputCls+" w-28 shrink-0"} value={line.amount} onChange={e=>{ const v=e.target.value; setMvSplitLines(ls=>ls.map((l,j)=>j===li?{...l,amount:v}:l)); }} />
          <button type="button" aria-label={`Quitar la parte ${li+1}`} disabled={mvSplitLines.length<=2} onClick={()=>setMvSplitLines(ls=>ls.filter((_,j)=>j!==li))} className="shrink-0 w-8 h-8 rounded-full border border-[var(--border)] text-[var(--dim)] disabled:opacity-40">×</button>
        </div>
      ))}
      <button type="button" aria-label="Agregar otra categoría a la división" className="text-xs font-bold underline mt-2" onClick={()=>setMvSplitLines(ls=>[...ls, { key: splitKeyRef.current++, categoryId: "", amount: "", budgetId: null }])}>+ Agregar categoría</button>
      <p className={`text-xs mt-2 font-bold ${mvSplitDiff===0 && !mvSplitDupCat ? "text-[var(--green)]" : "text-[var(--red)]"}`}>Total de las partes {money(mvSplitTotal)} · {mvSplitDiff===0 ? "Coincide con el total." : mvSplitDiff>0 ? `Faltan ${money(mvSplitDiff)}.` : `Sobran ${money(-mvSplitDiff)}.`}</p>
      {mvSplitDupCat && <p className="text-xs text-[var(--red)] mt-1">No repita la misma categoría en la división.</p>}
    </>}
  </div>}
  {mvType==="expense" && editingMv==null && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-bold">Repetir este gasto</p>
      <button type="button" role="switch" aria-checked={mvRepeat} aria-label="Repetir este gasto" disabled={mvSplit} onClick={()=>{ if(!mvRepeat){ setMvRepeatDay(String(mvDate?Number(mvDate.slice(8,10)):1)); setMvRepeatWeekday(String(mvDate?new Date(mvDate+"T12:00:00").getDay():1)); } setMvRepeat(!mvRepeat); }} className={`shrink-0 w-12 h-7 rounded-full ${mvRepeat?"bg-[var(--accent)]":"bg-[var(--border)]"} relative disabled:opacity-50`}><span className={`absolute top-0.5 ${mvRepeat?"right-0.5":"left-0.5"} w-6 h-6 rounded-full bg-[var(--bg)]`} /></button>
    </div>
    <p className="text-xs text-[var(--dim)]">Al guardar, el gasto queda registrado hoy y se crea la regla. Cada vez que venza, le llegará un aviso para confirmarlo.</p>
    {mvSplit && <p className="text-xs text-[var(--dim)] mt-1">No se puede repetir un gasto dividido: una regla recurrente tiene una sola categoría.</p>}
    {mvRepeat && <>
    <div className="grid grid-cols-3 gap-1.5 mt-2" role="group" aria-label="Frecuencia del gasto recurrente">
      {(["weekly","biweekly","monthly"] as const).map(f=>(<button key={f} type="button" aria-label={`Repetir cada ${f==="weekly"?"semana":f==="biweekly"?"quincena":"mes"}`} onClick={()=>setMvRepeatFreq(f)} className={`rounded-full py-2.5 text-[13px] font-bold ${mvRepeatFreq===f?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>{f==="weekly"?"Semanal":f==="biweekly"?"Quincenal":"Mensual"}</button>))}
    </div>
    {mvRepeatFreq==="monthly" && <div className="mt-2"><Label htmlFor="mv-repeat-day">Día del mes</Label><input id="mv-repeat-day" aria-label="Día del mes del gasto recurrente" type="number" min={1} max={31} className={inputCls} value={mvRepeatDay} onChange={e=>setMvRepeatDay(e.target.value)} /><p className="text-xs text-[var(--dim)] mt-1">Si el mes no tiene ese día, se ajusta al último día del mes.</p></div>}
    {mvRepeatFreq==="weekly" && <div className="mt-2"><Label htmlFor="mv-repeat-weekday">Día de la semana</Label><select id="mv-repeat-weekday" aria-label="Día de la semana del gasto recurrente" className={inputCls} value={mvRepeatWeekday} onChange={e=>setMvRepeatWeekday(e.target.value)}>{["domingo","lunes","martes","miércoles","jueves","viernes","sábado"].map((w,i)=>(<option key={w} value={i}>{w}</option>))}</select></div>}
    {mvRepeatFreq==="biweekly" && <p className="text-xs text-[var(--dim)] mt-2">Cada 14 días a partir de la fecha del gasto.</p>}
    </>}
  </div>}
  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setMvStep(1); scrollFormTop("mv-form");}}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} disabled={mvCat==="__new__"} onClick={()=>{setMvStep(3); scrollFormTop("mv-form");}}>Siguiente</button></div>
  </>}
  {mvStep===3 && <>
  <div><Label htmlFor="mv-concept">Concepto</Label><div className="flex gap-2"><input id="mv-concept" aria-label="Concepto del movimiento" required className={inputCls+" flex-1"} value={mvConcept} onChange={e=>{setMvConcept(e.target.value);applyRuleTo(e.target.value,"mv");}} placeholder="Ej. Súper semanal" />{(mvType==="expense"||mvType==="debt_payment") && <button type="button" aria-label={voiceBusyMv?"Escuchando…":"Dictar el gasto por voz"} title="Dictar por voz" className="shrink-0 w-11 rounded-xl border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center" disabled={voiceBusyMv} onClick={()=>startVoice("mv")}>{micIcon}</button>}</div>
  {voiceBusyMv && <p className="text-xs text-[var(--dim)] mt-1">Escuchando… Diga, por ejemplo, «gasté 320 en el súper».</p>}
  {voiceErrorMv && <p className="text-xs text-[var(--red)] mt-1">{voiceErrorMv}</p>}
  {voiceNoticeMv && <p className="text-xs text-[var(--green)] mt-1">{voiceNoticeMv}</p>}
  {appliedRuleMv && <p className="text-xs text-[var(--dim)] mt-1">Regla aplicada: «{appliedRuleMv.keyword}» → {appliedRuleMv.categoryName}. Puede cambiarla en el paso 2.</p>}</div>
  <div><Label htmlFor="mv-account">{mvType==="income"?"¿A qué cuenta entra?":mvType==="transfer"?"¿De qué cuenta sale?":"¿De dónde se descuenta?"}</Label><select id="mv-account" aria-label="Cuenta del movimiento" className={inputCls} value={mvAccount} onChange={e=>{setMvAccount(e.target.value); setMvAccountError(""); setMvCurrency("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>
  {mvShowCurrency && <div><Label htmlFor="mv-currency">Moneda del movimiento</Label><select id="mv-currency" aria-label="Moneda del movimiento" className={inputCls} value={mvCurrencyEffective} onChange={e=>setMvCurrency(e.target.value)}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select>{mvFxLabel && <p className="text-sm font-bold mt-1">{mvFxLabel}</p>}{mvRateNotice && <p className="text-xs text-[var(--dim)] mt-1">{mvRateNotice}</p>}</div>}
  {mvAccountError && <p className="text-sm text-[var(--red)]">{mvAccountError}</p>}
  {!mvSplit && mvBudgetQuestion && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">{mvBudgetQuestion.kind === "both" ? `¿Al presupuesto general o al de ${mvBudgetQuestion.sub.subcategory}?` : `¿Aplica al presupuesto de ${mvBudgetQuestion.budget.subcategory ? `${getCatName(mvBudgetQuestion.budget.categoryId)} · ${mvBudgetQuestion.budget.subcategory}` : getCatName(mvBudgetQuestion.budget.categoryId)} o a gastos generales?`}</p>
    <p className="text-xs text-[var(--dim)]">{mvBudgetQuestion.kind === "both" ? `Este gasto coincide con el presupuesto general de ${getCatName(mvBudgetQuestion.general.categoryId)} y con el de ${mvBudgetQuestion.sub.subcategory}. Elija dónde se descuenta: solo cuenta en uno, no en los dos.` : `Este gasto coincide con el presupuesto de ${mvBudgetQuestion.budget.subcategory ? `${getCatName(mvBudgetQuestion.budget.categoryId)} · ${mvBudgetQuestion.budget.subcategory}` : getCatName(mvBudgetQuestion.budget.categoryId)}. Si no aplica, va a gastos generales.`}</p>
    <div className="grid grid-cols-2 gap-1.5 mt-2" role="group" aria-label="Presupuesto al que aplica el gasto">
      {mvBudgetQuestion.kind === "both" && <>
        <button type="button" aria-label="Presupuesto general" onClick={()=>setMvBudget(mvBudget===mvBudgetQuestion.general.id?null:mvBudgetQuestion.general.id)} className={`rounded-full py-2.5 text-[13px] font-bold ${mvBudget===mvBudgetQuestion.general.id?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Presupuesto general</button>
        <button type="button" aria-label={`Aplica al presupuesto de ${mvBudgetQuestion.sub.subcategory}`} onClick={()=>setMvBudget(mvBudget===mvBudgetQuestion.sub.id?null:mvBudgetQuestion.sub.id)} className={`rounded-full py-2.5 text-[13px] font-bold ${mvBudget===mvBudgetQuestion.sub.id?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Aplica a {mvBudgetQuestion.sub.subcategory}</button>
      </>}
      {mvBudgetQuestion.kind === "single" && <button type="button" aria-label={`Aplica al presupuesto de ${mvBudgetQuestion.budget.subcategory ?? getCatName(mvBudgetQuestion.budget.categoryId)}`} onClick={()=>setMvBudget(mvBudget===mvBudgetQuestion.budget.id?null:mvBudgetQuestion.budget.id)} className={`rounded-full py-2.5 text-[13px] font-bold ${mvBudget===mvBudgetQuestion.budget.id?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Aplica al presupuesto</button>}
      <button type="button" aria-label="Gastos generales" onClick={()=>setMvBudget(mvBudget===-1?null:-1)} className={`rounded-full py-2.5 text-[13px] font-bold ${mvBudget===-1?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"} ${mvBudgetQuestion.kind === "both" ? "col-span-2" : ""}`}>Gastos generales</button>
    </div>
    <p className="text-xs text-[var(--dim)] mt-1">{mvBudget===-1?"No se descuenta de ningún presupuesto; va a gastos generales.":mvBudgetQuestion.kind === "both" ? (mvBudget===mvBudgetQuestion.general.id?"Se descuenta del presupuesto general.":mvBudget===mvBudgetQuestion.sub.id?`Se descuenta del presupuesto de ${mvBudgetQuestion.sub.subcategory}.`:"Si no elige, se aplica según las reglas del presupuesto."):(mvBudget===mvBudgetQuestion.budget.id?`Se descuenta del presupuesto de ${mvBudgetQuestion.budget.subcategory ? `${getCatName(mvBudgetQuestion.budget.categoryId)} · ${mvBudgetQuestion.budget.subcategory}` : getCatName(mvBudgetQuestion.budget.categoryId)}.`:"Si no elige, se aplica al presupuesto según las reglas.")}</p>
  </div>}
  {mvSplit && mvSplitLines.map((line, li) => {
    const catId = line.categoryId ? Number(line.categoryId) : null;
    const q = catId != null ? data.budgets.find(b => b.categoryId === catId && b.month === mvMonth && b.subcategory == null) ?? null : null;
    if (!q) return null;
    return (
      <div key={line.key} className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
        <p className="text-sm font-bold">¿Aplica al presupuesto de {getCatName(catId)} o a gastos generales?</p>
        <p className="text-xs text-[var(--dim)]">La parte de {money(Number(line.amount) || 0)} en {getCatName(catId)} coincide con el presupuesto de este mes. Si no aplica, va a gastos generales.</p>
        <div className="grid grid-cols-2 gap-1.5 mt-2" role="group" aria-label={`Presupuesto al que aplica la parte de ${getCatName(catId)}`}>
          <button type="button" aria-label={`Aplica al presupuesto de ${getCatName(catId)}`} onClick={()=>setMvSplitLines(ls=>ls.map((l,j)=>j===li?{...l,budgetId:l.budgetId===q.id?null:q.id}:l))} className={`rounded-full py-2.5 text-[13px] font-bold ${line.budgetId===q.id?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Aplica al presupuesto</button>
          <button type="button" aria-label={`Gastos generales de ${getCatName(catId)}`} onClick={()=>setMvSplitLines(ls=>ls.map((l,j)=>j===li?{...l,budgetId:l.budgetId===-1?null:-1}:l))} className={`rounded-full py-2.5 text-[13px] font-bold ${line.budgetId===-1?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Gastos generales</button>
        </div>
        <p className="text-xs text-[var(--dim)] mt-1">{line.budgetId===-1?"No se descuenta de ningún presupuesto; va a gastos generales.":line.budgetId===q.id?`Se descuenta del presupuesto de ${getCatName(catId)}.`:"Si no elige, se aplica al presupuesto según las reglas."}</p>
      </div>
    );
  })}
  {ocrDetailMv && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">¿Este movimiento es Compartido o Privado?</p>
    <p className="text-xs text-[var(--dim)]">Revise antes de guardar: lo compartido lo ven todos; lo privado solo usted.</p>
    <div className="grid grid-cols-2 gap-1.5 mt-2" role="group" aria-label="Visibilidad del movimiento leído">
      <button type="button" aria-label="Movimiento compartido" onClick={()=>setMvVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="shared"?"bg-[var(--green)] text-[var(--bg)]":"border border-[var(--border)]"}`}>Compartido</button>
      <button type="button" aria-label="Movimiento privado" onClick={()=>setMvVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
    </div>
    <p className="text-xs text-[var(--dim)] mt-1">{mvVis==="shared"?"Lo ven todos.":"Solo usted lo ve."}</p>
  </div>}
  {mvType==="transfer" && <div><Label htmlFor="mv-to">Cuenta destino</Label><select id="mv-to" aria-label="Cuenta destino" className={inputCls} value={mvToAccount} onChange={e=>setMvToAccount(e.target.value)}><option value="">Seleccione…</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>}
  {mvType==="transfer" && mvToAccount !== "" && mvToCurrency !== mvCurrencyEffective && mvToAmount != null && <p className="text-sm font-bold">La cuenta destino recibirá {moneyIn(mvToAmount, mvToCurrency)}</p>}
  {mvType==="transfer" && mvToAccount !== "" && mvToCurrency !== mvCurrencyEffective && mvToNotice && <p className="text-xs text-[var(--dim)]">{mvToNotice}</p>}
  <div>
    <button type="button" aria-expanded={mvMore} aria-label={mvMore?"Ocultar más opciones del movimiento":"Mostrar más opciones del movimiento"} onClick={()=>setMvMore(o=>!o)} className="w-full text-left text-sm font-bold text-[var(--dim)] border border-[var(--border)] rounded-xl px-3 py-2.5">{mvMore?"▾ Ocultar más opciones":"▸ Más opciones"}</button>
    {mvMore && (<div className="space-y-2 mt-3">
  <div className="grid grid-cols-2 gap-2">
    <div><Label htmlFor="mv-date">Fecha</Label><input id="mv-date" aria-label="Fecha del movimiento" type="date" required className={inputCls} value={mvDate} onChange={e=>{setMvDate(e.target.value); setOcrDateCheckMv(null); setOcrDateErrorMv("");}} /></div>
  </div>
  <div className="border border-dashed border-[var(--border)] rounded-2xl p-4 sm:p-5">
    <Label htmlFor="mv-receipt">Foto del comprobante (opcional)</Label>
    <input id="mv-receipt" aria-label="Adjuntar foto del comprobante" type="file" accept="image/*" className="w-full text-sm" onChange={e=>{ void pickReceipt(e.target.files?.[0], setReceipt); }} />
    <p className="text-xs text-[var(--dim)] mt-1">Se guarda como comprobante.</p>
    {receipt && <div className="flex items-center gap-2 mt-2"><img src={receipt.preview} alt="Vista previa de la foto del comprobante" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)]" /><button type="button" aria-label="Quitar foto del comprobante" className="text-xs underline text-[var(--red)]" onClick={()=>{setReceipt(null);setOcrDetailMv(null);setOcrLabelMv("");setOcrNoticeMv("");setOcrErrorMv("");setOcrErrDetailMv("");setOcrDateCheckMv(null);setOcrDateErrorMv("");}}>Quitar foto</button></div>}
    {receipt && (mvType==="expense"||mvType==="debt_payment") && <div className="mt-2">
      <button type="button" aria-label="Leer el comprobante y llenar el formulario" className={btnPrimary+" w-full"} disabled={ocrBusyMv} onClick={()=>void runOcr("mv")}>{ocrBusyMv?"Leyendo el comprobante…":"Leer el comprobante"}</button>
      {ocrProgressMv && <p className="text-xs text-[var(--dim)] mt-1">{ocrProgressMv}</p>}
      {ocrErrorMv && <p className="text-xs text-[var(--red)] mt-1">{ocrErrorMv}</p>}
      {ocrErrDetailMv && <p className="text-xs text-[var(--dim)] mt-1">Detalle: {ocrErrDetailMv}</p>}
      {ocrNoticeMv && <p className="text-xs text-[var(--green)] mt-1">{ocrNoticeMv}</p>}
      {ocrDetailMv && <OcrDetail detail={ocrDetailMv} />}
      <p className="text-xs text-[var(--dim)] mt-1">La lectura se hace en su dispositivo, sin costo.</p>
    </div>}
  </div>
  <div><Label htmlFor="mv-profile">Hecho por</Label><select id="mv-profile" aria-label="Integrante que hizo el movimiento" className={inputCls} value={mvProfile} onChange={e=>setMvProfile(e.target.value)}><option value="">{me?`Yo (${fullName(me)})`:"El hogar"}</option>{data.profiles.filter(x=>x.kind==="adult").map(x=><option key={x.id} value={x.id}>{fullName(x)}</option>)}</select></div>
  <div>
    <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">Visibilidad</span>
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Selector de visibilidad compartido o privado">
      <button type="button" aria-label="Movimiento compartido" onClick={()=>setMvVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="shared"?"bg-[var(--green)] text-[var(--bg)]":"border border-[var(--border)]"}`}>Compartido</button>
      <button type="button" aria-label="Movimiento privado" onClick={()=>setMvVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
    </div>
    <p className="text-xs text-[var(--dim)] mt-1">{mvVis==="shared"?"Lo ven todos.":"Solo usted lo ve."}</p>
  </div>
    </div>)}
  </div>
  {!mvSplit && mvReview.length>0 && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">Revisión de Mike</p>
    {mvReview.map((w,i)=><p key={i} className="text-sm mt-1">{w}</p>)}
    <p className="text-xs text-[var(--dim)] mt-1">Es solo un aviso: puede guardar de todos modos.</p>
  </div>}
  {Number(mvAmount)>=hh.approvalThreshold && mvVis==="shared" && mvType==="expense" && <Help>Supera el umbral de {money(hh.approvalThreshold)}: requiere un Acuerdo.</Help>}
  {mvSplit && !mvSplitValid && <p className="text-sm text-[var(--red)]">{mvSplitDupCat ? "No repita la misma categoría en la división." : mvSplitLines.some(l=>l.categoryId==="" || !(Number(l.amount)>0)) ? "Cada parte necesita categoría e importe mayor que cero." : `Las partes deben sumar ${money(Number(mvAmount)||0)}: ${mvSplitDiff>0 ? `faltan ${money(mvSplitDiff)}` : `sobran ${money(-mvSplitDiff)}`}.`}</p>}
  {saveMv.error && <p className="text-sm text-[var(--red)]">{String(saveMv.error)}</p>}
  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setMvStep(2); scrollFormTop("mv-form");}}>Atrás</button><button className={btnPrimary+" flex-1"} disabled={saveMv.isPending || !mvAmount || !mvConcept || (mvSplit && !mvSplitValid)}>{saveMv.isPending?"Guardando…":editingMv?"Guardar cambios":"Finalizar"}</button></div>
  {editingMv && <button type="button" className={btnGhost+" w-full"} onClick={()=>{setEditingMv(null);setEditingSplitGroup(null);setMvStep(1);}}>Cancelar edición</button>}
  {data.accounts.length===0 && <Help>Si no tiene cuentas, los movimientos se descuentan de Efectivo.</Help>}
  </>}
</form>
  );
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {/* Velo oscuro detrás del menú: tapa la app de atrás para que el menú se vea como una capa aparte. */}
      {menuOpen && (
        <div aria-hidden="true" onClick={()=>setMenuOpen(false)} className="fixed inset-0 z-30 bg-black/60" />
      )}
      {/* Cajón lateral del menú: panel aparte que entra desde la izquierda, con su propio desplazamiento. */}
      <div aria-hidden={!menuOpen} inert={!menuOpen} className={`fixed inset-y-0 left-0 z-50 w-[min(82vw,22rem)] bg-[var(--surface)] border-r-2 border-r-[var(--gold)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${menuOpen?"translate-x-0":"-translate-x-full"}`}>
        <div className="px-4 pt-safe pb-3 border-b border-[var(--border)]">
          <div className="flex items-start justify-between gap-2 pt-3">
            <div className="min-w-0">
              <p className="font-display font-extrabold leading-tight truncate text-[var(--text)]">{hh.name}</p>
              <p className="text-xs font-semibold text-[var(--text)] mt-0.5">{hh.mode==="personal"?"MODO PERSONAL":"MODO FAMILIAR"}</p>
            </div>
            <button type="button" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)} className="shrink-0 w-9 h-9 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] text-xl leading-none font-bold">×</button>
          </div>
          <p className="text-sm font-semibold text-[var(--text)] mt-2">Disponible</p>
          <p className="font-display text-2xl font-extrabold text-[var(--text)]">{money2(s.availableFree)}</p>
          {(data.households ?? []).length>1 && (
            <HouseholdSwitcher households={data.households ?? []} activeId={hh.id} onPick={pickHousehold} />
          )}
        </div>
        <DrawerMenu
          sections={drawerSections}
          currentTab={effTab}
          onNavigate={(t)=>{goTab(t);setMenuOpen(false);}}
          pinned={quickShortcuts}
          onTogglePin={togglePin}
          onNewExpense={()=>{ setMenuOpen(false); openNewMovement("expense"); }}
          openGroups={openDrawerGroups}
          onToggleGroup={(title, open)=>setOpenDrawerGroups(prev=>({...prev,[title]:open}))}
          configOpen={configOpen}
          onToggleConfig={()=>setConfigOpen(o=>!o)}
          vistaOpen={vistaOpen}
          onToggleVista={()=>setVistaOpen(o=>!o)}
          darkMode={darkMode}
          onSetThemeMode={(d)=>setThemeMode(d)}
          onFeedback={()=>{ setMenuOpen(false); setFeedbackOpen(true); }}
          onSignOut={handleSignOut}
        />
        <div className="px-3 pb-4 pt-2 border-t border-[var(--border)]">
          <button type="button" aria-label="Abrir a Mike" onClick={()=>{ setMenuOpen(false); setHelpOpen(true); }} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--text)]">MIKE</span>
          </button>
        </div>
      </div>
      {/* Header */}
      <header className={`sticky top-0 ${menuOpen?"z-40":"z-20"} bg-[var(--bg)]/95 backdrop-blur border-b border-[var(--border)] pt-safe`}>
        <div className="max-w-5xl mx-auto px-2 sm:px-3 py-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display font-extrabold leading-tight flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] sm:text-xl"><span className="min-w-0 truncate">{hh.name}</span><span className="shrink-0 text-[11px] bg-[var(--accent)] text-[var(--accent-text)] rounded-full px-2 py-0.5 whitespace-nowrap">{hh.mode==="personal"?"MODO PERSONAL":"MODO FAMILIAR"}</span></p>
            </div>
            <div className="flex gap-1 sm:gap-2 shrink-0">
              <button type="button" aria-label="Ir a Inicio" aria-current={effTab==="inicio"?"page":undefined} onClick={()=>{goTab("inicio");setMenuOpen(false);window.setTimeout(()=>window.scrollTo({top:0,behavior:"smooth"}),60);}} className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center">
                <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </button>
              <button type="button" className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center" aria-label={bellLabel} onClick={toggleNotif}>
                <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                {bellCount>0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--badge)] text-[var(--on-badge)] text-[11px] font-bold flex items-center justify-center">{bellCount>99?"99+":bellCount}</span>}
              </button>
              {!appInstalled && <button type="button" className={btnGhost + " max-sm:px-2.5 max-sm:text-xs"} aria-label="Instalar SyncFinanzas en el celular" onClick={handleInstallClick}>Instalar</button>}
            </div>
          </div>
        </div>
        {notifOpen && (
          <div className="absolute right-3 top-full mt-1 z-40 w-[min(22rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl p-3" role="dialog" aria-label="Notificaciones">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-bold text-lg">Notificaciones</h2>
              <div className="flex items-center gap-2">
                {unreadCount>0 && <button type="button" className="text-xs font-bold underline" onClick={()=>markAllNotifRead.mutate()} disabled={markAllNotifRead.isPending}>Marcar todas como leídas</button>}
                <button type="button" aria-label="Cerrar notificaciones" onClick={()=>setNotifOpen(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
              </div>
            </div>
            {notifQuery.isPending && <p className="text-sm text-[var(--dim)] mt-2">Cargando avisos…</p>}
            {notifQuery.data && visibleNotifs.length===0 && !updateAvailable && <p className="text-sm text-[var(--dim)] mt-2">Sin avisos por ahora.</p>}
            <UpdateBellNotice updateAvailable={updateAvailable} updateApplying={updateApplying} updateFailed={updateFailed} onUpdate={handleApplyUpdate} />
            <ul className="mt-2 space-y-2">
              {visibleNotifs.map(n=>{
                const sug=n.type==="presupuesto_sugerido"?budgetSuggestionTarget(n):null;
                const sc=sug?.cat ?? null;
                const exc=n.type==="presupuesto_excedido"?exceededBudgetTarget(n):null;
                return (
                <li key={n.id}>
                  <div className={`rounded-xl border p-3 ${n.isRead?"border-[var(--border)]":"border-[var(--gold)] bg-[var(--surface2)]"}`}>
                    <button type="button" className="w-full text-left" onClick={()=>openNotif(n)}>
                      <p className="text-sm font-bold">{n.title}{!n.isRead && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-[var(--red)]" aria-label="Sin leer" />}</p>
                      <p className="text-sm text-[var(--dim)] mt-0.5">{n.body}</p>
                      <p className="text-xs text-[var(--dim)] mt-1">{new Date(n.createdAt).toLocaleString("es-MX",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</p>
                    </button>
                    {sug?.cat && <button type="button" className={btnGold+" mt-2"} onClick={(e)=>{e.stopPropagation(); handleBudgetSuggestion(n);}}>Crear presupuesto para {sug.cat.name}</button>}
                    {sc && <button type="button" className={btnGhost+" mt-2"} onClick={(e)=>{e.stopPropagation(); setSnoozeNotifId(n.id); setSnoozeAmt(String(nextHundredAbove(suggestionMonthTotal(n,sc.id,String(n.createdAt).slice(0,7))))); setSnoozePendingSql(false);}}>No por ahora</button>}
                    {snoozeNotifId===n.id && sc && (
                      <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
                        <p className="text-sm font-bold">¿Cuándo le aviso de nuevo?</p>
                        <p className="text-xs text-[var(--dim)] mt-0.5">{sc.name} lleva {money(suggestionMonthTotal(n,sc.id,String(n.createdAt).slice(0,7)))} este mes.</p>
                        <div className="mt-2"><Label htmlFor={`snooze-amt-${n.id}`}>Avísame de nuevo cuando llegue a ($)</Label><input id={`snooze-amt-${n.id}`} aria-label="Avísame de nuevo cuando llegue a" type="number" min="0" className={inputCls} value={snoozeAmt} onChange={e=>setSnoozeAmt(e.target.value)} /></div>
                        <p className="text-xs text-[var(--dim)] mt-1">Propuesto: {money(nextHundredAbove(suggestionMonthTotal(n,sc.id,String(n.createdAt).slice(0,7))))}, la centena siguiente arriba del total. Usted lo puede cambiar.</p>
                        {snoozePendingSql && <p className="text-xs text-[var(--red)] mt-1">La posposición se guardará cuando se ejecute el SQL pendiente (supabase/add-budget-suggestion-snooze.sql).</p>}
                        <div className="flex gap-2 mt-2">
                          <button type="button" className={btnPrimary} disabled={snoozeMut.isPending} onClick={()=>{ const v=Number(snoozeAmt)||0; if(v<=0) return; snoozeMut.mutate({categoryId:sc.id,month:String(n.createdAt).slice(0,7),nextThreshold:v}); }}>Guardar aviso</button>
                          <button type="button" className={btnGhost} onClick={()=>setSnoozeNotifId(null)}>Cancelar</button>
                        </div>
                      </div>
                    )}
                    {exc && <button type="button" className={btnGhost+" mt-2"} onClick={(e)=>{e.stopPropagation(); void markNotifRead.mutateAsync(n.id).catch(()=>{}); setNotifOpen(false); openCoquitoForBudget(exc,"excedido");}}>Consejo</button>}
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        )}
      </header>

      {/* Relleno inferior: 80 px base (barra 52 + margen 12 + 16 de aire)
          MÁS el área segura del teléfono, porque la barra también sube esa
          distancia (bottom: 12 px + safe-area): sin sumarla, en el iPhone
          la barra tapa los últimos ~18 px de la viñeta final. */}
      <main className="max-w-5xl mx-auto px-3 pt-4" style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
        {renderTokenInviteBanner()}
        {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-4 sm:p-5 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {firstGuideOpen && (
          <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5 sm:p-3.5" role="status">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-lg">Empiece en 3 pasos</h2>
                
              </div>
              <button type="button" aria-label="Cerrar la guía de inicio" onClick={dismissFirstGuide} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            <ol className="mt-3 space-y-2">
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep1?"bg-[var(--green)] text-[var(--bg)]":"bg-[var(--accent)] text-[var(--accent-text)]"} font-bold flex items-center justify-center text-sm`}>{guideStep1?"✓":"1"}</span><div className="flex-1"><p className="text-sm font-bold">{hh.mode==="personal"?"Registre su sueldo":"Abra su cuenta inicial"}</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Escriba su sueldo en Personal.":"Pulse Nueva cuenta en Cuentas."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab(hh.mode==="personal"?"personal":"cuentas")}>{hh.mode==="personal"?"Ir a Personal":"Ir a Cuentas"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep2?"bg-[var(--green)] text-[var(--bg)]":"bg-[var(--accent)] text-[var(--accent-text)]"} font-bold flex items-center justify-center text-sm`}>{guideStep2?"✓":"2"}</span><div className="flex-1"><p className="text-sm font-bold">Registre su primer gasto</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Registre su gasto del día en Personal.":"Escriba el importe en Movimientos."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>{ if(hh.mode==="personal"){ setPersStep(1); goToForm("personal","pers-amt"); } else { openNewMovement("expense"); } }}>{hh.mode==="personal"?"Ir a Personal":"Ir a Movimientos"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep3?"bg-[var(--green)] text-[var(--bg)]":"bg-[var(--accent)] text-[var(--accent-text)]"} font-bold flex items-center justify-center text-sm`}>{guideStep3?"✓":"3"}</span><div className="flex-1"><p className="text-sm font-bold">Revise sus gráficas</p><p className="text-sm text-[var(--dim)]">Vea su gasto por categoría en Inicio.</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab("inicio")}>Ir a Inicio</button></li>
            </ol>
            <button type="button" className={btnPrimary+" mt-3"} onClick={dismissFirstGuide}>Entendido</button>
          </div>
        )}
        {!appInstalled && !installDismissed && <div className="mb-3"><InstallCard installed={appInstalled} onInstall={handleInstallClick} onDismiss={dismissInstall} /></div>}
        {effTab==="inicio" && (
          <section>
            {/* Meta fijada por importancia 5 (variante A): lo primero de
                Inicio, arriba del total del ingreso, como tarjeta plegable
                estilo app con su resumen de una línea; se abre dentro de
                su propia viñeta y sale de «Metas y patrimonio». */}
            {pinnedGoal && <CollapsibleCard tone="gold" className="mb-4 md:mb-6"
              title={<h2 className="font-display font-bold text-lg">{pinnedGoal.name} <span className="ml-1 inline-block whitespace-nowrap text-xs font-bold rounded-full px-2 py-0.5 bg-[var(--gold)] text-[#13262E]">★ 5</span></h2>}
              above={<p className="text-sm text-[var(--dim)] mt-1">{pinnedGoal.pct}% · {money(pinnedGoal.savedAmount)} de {money(pinnedGoal.targetAmount)} · {pinnedGoal.targetAmount-pinnedGoal.savedAmount>0?`Restan ${money(pinnedGoal.targetAmount-pinnedGoal.savedAmount)} para la meta`:"Meta alcanzada"}</p>}
            >
              <div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${pinnedGoal.pct}%`}} /></div>
              {pinnedPlan && pinnedPlan.status!=="cumplido" && <>
                {(pinnedPlan.monthsByPlan ?? 0)>0 && <p className="text-sm mt-2">Llegas en {pinnedPlan.monthsByPlan} {(pinnedPlan.monthsByPlan ?? 0)===1?"mes":"meses"}{pinnedGoal.savedAmount>0 && (pinnedPlan.monthsFromZero ?? 0)>0 ? ` · Desde cero: ${pinnedPlan.monthsFromZero} meses` : ""}</p>}
                {planMonthShortfall(pinnedPlan, data.fundMovements, s.currentMonth)>0 && <p className="text-sm mt-1">Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(planMonthShortfall(pinnedPlan, data.fundMovements, s.currentMonth))}</b></p>}
              </>}
              <p className="text-sm mt-2">Importancia: {"★".repeat(pinnedGoal.importance ?? 3)}{"☆".repeat(5-(pinnedGoal.importance ?? 3))} {pinnedGoal.importance ?? 3} de 5 <button type="button" aria-label={`Cambiar la importancia de ${pinnedGoal.name}`} className="text-xs underline font-bold ml-1" onClick={()=>{setImpEditGoalId(impEditGoalId===pinnedGoal.id?null:pinnedGoal.id); setImpEditValue(String(pinnedGoal.importance ?? 3));}}>Cambiar</button></p>
              {impEditGoalId===pinnedGoal.id && renderImpEditor(pinnedGoal)}
              <div className="flex gap-2 mt-3">
                {pinnedPlan && <button type="button" aria-label={`Aportar a la meta ${pinnedGoal.name}`} className={btnPrimary+" flex-1"} onClick={()=>{setQuickGoal(quickGoal===pinnedGoal.id?null:pinnedGoal.id);setQuickGoalAmt("");setQuickGoalAcc("");setQuickGoalAccError("");}}>Aportar</button>}
                <button type="button" className={btnGhost+" flex-1"} onClick={()=>goTab("metas")}>Ver en Metas</button>
              </div>
              {pinnedPlan && quickGoal===pinnedGoal.id && renderQuickGoalForm(pinnedGoal)}
            </CollapsibleCard>}
            {/* Fondo fijado por importancia 5: igual que la meta fijada,
                justo después de ella y arriba del total del ingreso. */}
            {pinnedFund && <CollapsibleCard tone="gold" className="mb-4 md:mb-6"
              title={<h2 className="font-display font-bold text-lg">{pinnedFund.name} <span className="ml-1 inline-block whitespace-nowrap text-xs font-bold rounded-full px-2 py-0.5 bg-[var(--gold)] text-[#13262E]">★ 5</span></h2>}
              above={<p className="text-sm text-[var(--dim)] mt-1">{pinnedFund.targetAmount ? `${fundPct(pinnedFund)}% · ${money(pinnedFund.balance)} de ${money(pinnedFund.targetAmount)} · ${pinnedFund.targetAmount-pinnedFund.balance>0?`Restan ${money(pinnedFund.targetAmount-pinnedFund.balance)} para el fondo`:"Meta alcanzada"}` : `${money(pinnedFund.balance)} · Sin meta`}</p>}
            >
              {pinnedFund.targetAmount ? <div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${fundPct(pinnedFund)}%`}} /></div> : null}
              {pinnedFund.targetDate && <p className="text-sm mt-2">Meta {fmtDate(pinnedFund.targetDate)}{(()=>{const need=fundNeedPerMonth(pinnedFund); return need!==null && need>0 ? ` · faltan ${money(need)}/mes` : "";})()}</p>}
              <p className="text-sm mt-2">Importancia: {"★".repeat(pinnedFund.importance ?? 3)}{"☆".repeat(5-(pinnedFund.importance ?? 3))} {pinnedFund.importance ?? 3} de 5 <button type="button" aria-label={`Cambiar la importancia de ${pinnedFund.name}`} className="text-xs underline font-bold ml-1" onClick={()=>{setImpEditFundId(impEditFundId===pinnedFund.id?null:pinnedFund.id); setImpEditFundValue(String(pinnedFund.importance ?? 3));}}>Cambiar</button></p>
              {impEditFundId===pinnedFund.id && renderFundImpEditor(pinnedFund)}
              <div className="flex gap-2 mt-3">
                <button type="button" aria-label={`Aportar al fondo ${pinnedFund.name}`} className={btnPrimary+" flex-1"} onClick={()=>{setQuickFundId(quickFundId===pinnedFund.id?null:pinnedFund.id);setQuickFundAmt("");setQuickFundAcc("");setQuickFundAccError("");}}>Aportar</button>
                <button type="button" className={btnGhost+" flex-1"} onClick={()=>goTab("fondos")}>Ver en Fondos</button>
              </div>
              {quickFundId===pinnedFund.id && renderQuickFundForm(pinnedFund)}
              {renderFundPlan(pinnedFund, (amt, accId) => { setQuickFundId(pinnedFund.id); setQuickFundAmt(String(amt)); setQuickFundAcc(accId != null ? String(accId) : ""); setQuickFundAccError(""); })}
            </CollapsibleCard>}
            {/* Tarjeta principal quieta (propuesta Unslop): Disponible en
                36 px, flujo del mes y variación contra el mes anterior,
                calculada de monthlySeries. Al tocarla se abre la ventana
                «Resumen del mes», como antes hacía la banda. */}
            <button type="button" aria-label="Ver el resumen completo del mes" onClick={()=>setShowSummary(true)} className="relative block w-full overflow-hidden text-left bg-[var(--hero)] border border-[var(--border)] rounded-2xl p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
              <span aria-hidden="true" className="absolute left-0 right-0 top-0 h-[3px] bg-[var(--gold)]" />
              <span className="flex items-center justify-between gap-2 text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]"><span>Disponible · {fmtMonth(s.currentMonth).toUpperCase()}</span><span aria-label={`Moneda del hogar: ${getHouseholdCurrency()}`}>{getHouseholdCurrency()}</span></span>
              <span className="block font-display text-4xl font-extrabold leading-tight mt-1">{money2(s.availableFree)}</span>
              <span className="block text-sm text-[var(--dim)] mt-1">Total {money2(s.totalBalance)} − fondos apartados {money2(s.fundsReserved)}.</span>
              <span className="mt-4 grid grid-cols-3 gap-2 text-center">
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Entradas</span><span className="block font-display text-base font-bold text-[var(--green)]">{money(s.monthIncome)}</span></span>
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Salidas</span><span className="block font-display text-base font-bold text-[var(--red)]">{money(s.monthExpense)}</span></span>
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Neto</span><span className="block font-display text-base font-bold">{money(s.monthNet)}</span></span>
              </span>
              {activeGoalPlans.length>0 && <span className="block text-[13px] mt-3">Te queda del mes: <b className="whitespace-nowrap">{money(monthRemaining)}</b>{monthShortfall>0 && <> · Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(monthShortfall)}</b></>}</span>}
              {netVar && <span className="block text-[13px] text-[var(--dim)] mt-3">{netVar.diff>0?`Neto ${money(netVar.diff)} más que en ${netVar.prevName}`:netVar.diff<0?`Neto ${money(-netVar.diff)} menos que en ${netVar.prevName}`:`Neto igual que en ${netVar.prevName}`}</span>}
            </button>

            {data.totalMovements>0 && (
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <h2 className="font-display font-bold text-lg">Gasto por categoría · <span className="whitespace-nowrap"><svg className="inline-block align-[-2px] text-[var(--dim)]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {fmtMonthShort(s.currentMonth)}</span></h2>
                                <Suspense fallback={DonutFallback}><CategoryChart data={data.personal.byCategory} detailOpen={catDetail!==null} palette={DONUT_PALETTE_INICIO} large reserveLine minIconPct={5} onSelect={(d)=>setCatDetail({categoryId:d.categoryId,name:d.name,total:d.total,month:s.currentMonth,pct:d.pct})} /></Suspense>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <h2 className="font-display font-bold text-lg">Ingresos vs gastos · 3 meses atrás</h2>
                <Suspense fallback={BarsFallback}><MonthlyChart series={s.monthlySeries} currentMonth={s.currentMonth} todayMonth={todayISO().slice(0,7)} inicio onSelect={(kind,month,label)=>setIncExpDetail({kind,month,label})} /></Suspense>
              </div>
            </div>
            )}
            <HomeMovementsCard
              month={s.currentMonth}
              monthLabel={fmtMonth(s.currentMonth)}
              onMonthChange={setViewMonth}
              monthsWithMovements={monthsWithMovs}
              summary={homeMovSummary}
              rows={groupSplitMovements(homeMovs).map((entry)=>{ if (isSplitGroup(entry)) { const g = entry; return {key:g.key,title:movTitle(g.parts[0]!),detail:`${fmtDate(g.date)} · Gasto · ${g.parts.length} categorías · ${getAccName(g.accountId)}${g.allReversed?" · Reversado (fuera de los totales)":""}`,amount:`−${money(g.total)}`,isIncome:false,struck:g.allReversed,subRows:[...g.parts].reverse().map(p=>({title:getCatName(p.categoryId),amount:money(p.amount)}))}; } const m = entry; return {key:m.id,title:movTitle(m),detail:`${fmtDate(m.date)} · ${TYPE_LABEL[m.type]||m.type} · ${getCatName(m.categoryId)} · ${getAccName(m.accountId)}${m.isReversed?" · Reversado (fuera de los totales)":""}${m.reversalOfId?" · Reversión (fuera de los totales)":""}`,amount:`${m.type==="income"?"+":"−"}${money(m.amount)}`,isIncome:m.type==="income",struck:!!(m.isReversed||m.reversalOfId)}; })}
              hasAnyMovements={data.totalMovements>0}
              showAll={showAllHomeMovs}
              onToggleShowAll={()=>setShowAllHomeMovs(v=>!v)}
              onNewMovement={openInicioMovement}
            />
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.budgets.filter(b=>b.month===s.currentMonth).length===0 ? null : (
              <CollapsibleCard title={<h2 className="font-display font-bold text-lg">Presupuestos</h2>} above={<p className="text-sm text-[var(--dim)] mt-1">Total {money(monthBudgetsSum.total)} · Gastado {money(monthBudgetsSum.spent)}</p>}>
                {data.budgets.filter(b=>b.month===s.currentMonth).map(b=>(
                  <div key={b.id} className="mt-3"><button type="button" aria-label={`Pagar del presupuesto de ${getCatName(b.categoryId)}${b.subcategory?` · ${b.subcategory}`:""}`} className="w-full text-left" onClick={()=>{setQuickBud(quickBud===b.id?null:b.id);setQuickBudAmt("");setQuickBudAcc(cashDefaultId);setQuickBudAccError("");setPayBudAssignPendingSql(false);}}><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0">{getCatName(b.categoryId)}{b.subcategory?` · ${b.subcategory}`:""} · {b.visibility==="shared"?"Compartido":"Privado"}</span><span className="flex items-center gap-1 shrink-0"><b className="text-base whitespace-nowrap">{money(b.spent)} / {money(b.amount)}</b><span aria-hidden="true" className="text-[var(--dim)]">›</span></span></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${b.pct>=100?"bg-[var(--red)]":"bg-[var(--accent)]"}`} style={{width:`${Math.min(100,b.pct)}%`}} /></div></button><div className="flex items-center justify-between gap-2 mt-1">{b.remaining<0?<p className="text-[13px] font-bold text-[var(--red)]">Sobrepasado por {money(-b.remaining)} · {b.pct}% usado</p>:<p className="text-[13px] text-[var(--dim)]">Restan {money(b.remaining)} · {b.pct}% usado</p>}{b.remaining!==0 && <button type="button" aria-label={`Consejo para ${getCatName(b.categoryId)}${b.subcategory?` · ${b.subcategory}`:""}`} className="shrink-0 w-7 h-7 rounded-full bg-[var(--surface2)] border border-[var(--border)] flex items-center justify-center text-[var(--gold-text)]" onClick={()=>openCoquitoForBudget(b,b.remaining<0?"excedido":"sobrante")}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>}</div>{quickBud===b.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!quickBudAmt||Number(quickBudAmt)<=0) return; if(data.accounts.length>0 && !quickBudAcc){ setQuickBudAccError("Seleccione la cuenta de donde se descuenta."); return; } payBudget.mutate({categoryId:b.categoryId,categoryName:getCatName(b.categoryId),subcategory:b.subcategory??undefined,budgetId:todayISO().slice(0,7)===b.month?b.id:undefined,visibility:b.visibility,amount:Number(quickBudAmt),accountId:quickBudAcc?Number(quickBudAcc):null});}}><p className="font-display font-bold text-sm">Pagar · {getCatName(b.categoryId)}{b.subcategory?` · ${b.subcategory}`:""}</p><div><Label htmlFor={`qb-amt-${b.id}`}>Importe ($)</Label><input id={`qb-amt-${b.id}`} autoFocus aria-label={`Importe a pagar del presupuesto de ${getCatName(b.categoryId)}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickBudAmt} onChange={e=>setQuickBudAmt(e.target.value)} /></div><div><Label htmlFor={`qb-acc-${b.id}`}>¿De dónde se descuenta?</Label><select id={`qb-acc-${b.id}`} aria-label="Cuenta de donde se descuenta el pago del presupuesto" className={inputCls} value={quickBudAcc} onChange={e=>{setQuickBudAcc(e.target.value); setQuickBudAccError("");}}>{data.accounts.length>0?<option value="">Seleccione la cuenta</option>:<option value="">Efectivo</option>}{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{quickBudAccError && <p className="text-sm text-[var(--red)]">{quickBudAccError}</p>}{payBudget.error && <p className="text-sm text-[var(--red)]">{String(payBudget.error)}</p>}{payBudAssignPendingSql && <p className="text-sm text-[var(--red)]">La asignación al presupuesto se guardará cuando se ejecute el SQL pendiente (supabase/add-movement-budget-assignment.sql).</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={payBudget.isPending||!quickBudAmt}>{payBudget.isPending?"Guardando…":"Guardar pago"}</button><button type="button" className={btnGhost} onClick={()=>setQuickBud(null)}>Cancelar</button></div></form>)}
                  </div>
                ))}
              </CollapsibleCard>
              )}
              {data.goals.length===0 && data.patrimony.length===0 ? null : (
              <CollapsibleCard
                title={<h2 className="font-display font-bold text-lg">Metas y patrimonio</h2>}
                above={<>
                <div className="border-t border-[var(--border)] mt-3 pt-3 flex justify-between gap-2"><span className="text-sm">Patrimonio neto</span>{/* Un paso por encima de las cifras de Entradas, Salidas y Neto (font-display text-lg font-extrabold): con las mismas clases el cambio no se percibía (Heriberto 2026-11-18); shrink-0 es solo para que no se apriete en la fila. */}<b className="font-display text-lg font-extrabold whitespace-nowrap shrink-0">{money2(s.netWorth)}</b></div>
                <p className="text-xs text-[var(--dim)]">Activos {money(s.totalAssets)} − Pasivos {money(s.totalLiabilities)}.</p>
                {data.goals.length>0 && <p className="text-xs text-[var(--dim)]">Metas: {money(goalsSum.saved)} ahorrado de {money(goalsSum.target)} · {data.goals.length} {data.goals.length===1?"meta":"metas"}</p>}
                </>}
                below={<>
                {data.patrimony.length>3 && <button type="button" aria-label="Ver todo el patrimonio" className="text-sm font-bold underline mt-2" onClick={()=>goTab("patrimonio")}>Ver todos</button>}
                {data.patrimony.length===0 && <button type="button" aria-label="Agregar patrimonio" className={btnPrimary+" mt-2"} onClick={()=>goToForm("patrimonio","pat-value")}>+ Agregar patrimonio</button>}
                {data.goals.length===0 && <button type="button" aria-label="Agregar meta" className={btnPrimary+" mt-2"} onClick={()=>goToForm("metas","goal-target")}>+ Agregar meta</button>}
                </>}
              >
                {data.goals.filter(g=>g.id!==pinnedGoal?.id).slice(0,3).map(g=>{ const gPlan=data.goalPlans.find(p=>p.goalId===g.id); return <div key={g.id} className="mt-3"><button type="button" aria-label={gPlan?`Aportar a la meta ${g.name}`:`La meta ${g.name} no tiene plan de ahorro`} className="w-full text-left" onClick={()=>{ if(!gPlan) return; setQuickGoal(quickGoal===g.id?null:g.id);setQuickGoalAmt("");setQuickGoalAcc("");setQuickGoalAccError("");}}><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0">{g.name}{!gPlan && <span className="ml-2 text-xs font-semibold text-[var(--gold-text)]">Sin plan</span>}</span><span className="flex items-center gap-1 shrink-0"><b>{g.pct}%</b><span aria-hidden="true" className="text-[var(--dim)]">›</span></span></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div><p className="text-[13px] text-[var(--dim)]">{money(g.savedAmount)} de {money(g.targetAmount)}{g.targetDate?` · meta ${fmtDate(g.targetDate)}`:""} · {g.targetAmount-g.savedAmount>0?`Restan ${money(g.targetAmount-g.savedAmount)} para la meta`:"Meta alcanzada"}{!gPlan && " · Arme el plan en Metas para aportar"}</p></button>{quickGoal===g.id && gPlan && renderQuickGoalForm(g)}
                </div>; })}
                {data.patrimony.slice(0,3).map(p=><div key={p.id} className="mt-2"><button type="button" aria-label={`Actualizar el valor de ${p.name}`} className="w-full text-left flex justify-between gap-2 text-sm" onClick={()=>{setQuickPat(quickPat===p.id?null:p.id);setQuickPatVal(String(p.value));}}><span className="min-w-0">{p.name} · {p.kind==="asset"?"Activo":"Pasivo"}</span><b className="shrink-0 whitespace-nowrap">{money(p.value)}</b></button>{quickPat===p.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); updatePat.mutate({id:p.id,name:p.name,kind:p.kind,category:p.category,value:Number(quickPatVal)||0,owner:p.owner});}}><p className="font-display font-bold text-sm">Actualizar · {p.name}</p><div><Label htmlFor={`qp-val-${p.id}`}>Valor ($)</Label><input id={`qp-val-${p.id}`} autoFocus aria-label={`Nuevo valor de ${p.name}`} type="number" min="0" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickPatVal} onChange={e=>setQuickPatVal(e.target.value)} /></div>{updatePat.error && <p className="text-sm text-[var(--red)]">{String(updatePat.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={updatePat.isPending}>{updatePat.isPending?"Guardando…":"Guardar valor"}</button><button type="button" className={btnGhost} onClick={()=>setQuickPat(null)}>Cancelar</button></div></form>)}
                </div>)}
              </CollapsibleCard>
              )}
              {data.funds.length===0 ? null : (
              <CollapsibleCard
                title={<h2 className="font-display font-bold text-lg">Fondos</h2>}
                above={<p className="text-sm text-[var(--dim)] mt-1">Fondos: {money(data.funds.reduce((s,f)=>s+f.balance,0))} apartados · {data.funds.length} {data.funds.length===1?"fondo":"fondos"}</p>}
                below={<button type="button" aria-label="Ver todos los fondos" className="text-sm font-bold underline mt-2" onClick={()=>goTab("fondos")}>Ver en Fondos</button>}
                toggleLabel="Fondos"
              >
                {data.funds.filter(f=>f.id!==pinnedFund?.id).slice(0,3).map(f=>{ const pct=fundPct(f); return <div key={f.id} className="mt-3"><button type="button" aria-label={`Ver el detalle del fondo ${f.name}`} className="w-full text-left" onClick={()=>{setFundDetailId(f.id);}}><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0">{f.name}</span><span className="flex items-center gap-1 shrink-0"><b>{f.targetAmount?`${pct}%`:money(f.balance)}</b><span aria-hidden="true" className="text-[var(--dim)]">›</span></span></div>{f.targetAmount ? <div className="h-2 bg-[var(--surface2)] rounded-full mt-1"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${pct}%`}} /></div> : null}<p className="text-[13px] text-[var(--dim)]">{f.targetAmount?`${money(f.balance)} de ${money(f.targetAmount)}`:`${money(f.balance)}`}{f.targetDate?` · meta ${fmtDate(f.targetDate)}`:""}{f.targetAmount?(f.targetAmount-f.balance>0?` · Restan ${money(f.targetAmount-f.balance)} para el fondo`:" · Meta alcanzada"):" · Sin meta"}</p></button>
                </div>; })}
              </CollapsibleCard>
              )}
              <HomeTandasCard tandas={allTandas} onOpenDetail={openTandaDetail} onGoTandas={()=>goTab("tandas")} />
            </div>

          </section>
        )}

        {effTab==="movimientos" && (
          <section className="grid md:grid-cols-[340px_1fr] gap-4 md:gap-6 items-start">
            {renderMvForm()}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-bold text-lg">Movimientos</h2>
                {/* El envoltorio flex-1 mantiene el ancho completo del
                    embudo: su panel es absoluto y su ancho es
                    min(320px, 100%) del envoltorio relativo; sin él, como
                    ítem flex el embudo se encogería al ancho del botón y
                    el panel saldría de 40 px. El título va a la izquierda
                    y el embudo queda a la derecha (decisión de Heriberto
                    2026-11-18: faltaba el título en esta tarjeta). */}
                <div className="flex-1 min-w-0">
                  <MovementsFilter
                    value={mvFilters}
                    onChange={setMvFilters}
                    accounts={data.accounts}
                    subcategories={Array.from(new Set(data.categories.flatMap(c=>c.subcategories))).sort()}
                    monthsWithMovements={monthsWithMovs}
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--dim)] mt-2">{mvQuery.isPending ? "Cargando movimientos…" : `${mvTotals.total} movimientos · Entradas ${money(mvTotals.incomeTotal)} · Salidas ${money(mvTotals.expenseTotal)}`}</p>
              <div className="flex gap-2 flex-wrap mt-2">
                <button type="button" aria-label="Exportar los movimientos visibles a CSV" className={btnGhost} disabled={exportingCsv} onClick={exportCsv}>{exportingCsv?"Exportando…":"Exportar CSV"}</button>
                <button type="button" aria-label="Importar movimientos desde un archivo CSV" aria-expanded={importOpen} className={btnGhost} onClick={()=>{setImportOpen(o=>!o); setImportError("");}}>{importOpen?"Cerrar importación":"Importar CSV"}</button>
              </div>
              {importOpen && (
                <div className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2">
                  <p className="font-display font-bold text-sm">Importar movimientos</p>
                  <p className="text-xs text-[var(--dim)]">Archivo CSV con columnas Fecha, Concepto e Importe (opcional: Tipo, Categoría, Cuenta). Se separan por coma o punto y coma.</p>
                  <input aria-label="Elegir archivo CSV para importar" type="file" accept=".csv,text/csv" className="w-full text-sm" onChange={e=>{ void handleImportFile(e.target.files?.[0]); e.target.value=""; }} />
                  {importFileName && <p className="text-xs text-[var(--dim)]">Archivo: {importFileName}</p>}
                  {importError && <p className="text-sm text-[var(--red)]">{importError}</p>}
                  {importRows && (
                    <>
                      <p className="text-sm"><b>{importRows.filter(r=>r.include).length}</b> por importar · <b>{importRows.filter(r=>r.duplicate).length}</b> posible(s) duplicado(s) no se importan.</p>
                      <div className="max-h-64 overflow-auto border border-[var(--border)] rounded-xl bg-[var(--surface)]">
                        <table className="w-full text-xs">
                          <thead><tr className="text-left border-b border-[var(--border)]"><th className="p-2">Fecha</th><th className="p-2">Concepto</th><th className="p-2">Importe</th><th className="p-2">Categoría</th><th className="p-2">Importar</th></tr></thead>
                          <tbody>
                            {importRows.map((r,i)=>(
                              <tr key={i} className={`border-b border-[var(--border)] last:border-0 ${r.duplicate?"opacity-60":""}`}>
                                <td className="p-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                                <td className="p-2">{r.concept}{r.duplicate && <span className="block text-[var(--red)] font-bold">Posible duplicado</span>}</td>
                                <td className="p-2 whitespace-nowrap">{money2(r.amount)}</td>
                                <td className="p-2"><select aria-label={`Categoría de ${r.concept}`} className={inputCls+" text-xs py-1"} value={r.categoryId??""} onChange={e=>{ const v=e.target.value; setImportRows(rows=>rows!.map((x,j)=>j===i?{...x,categoryId:v?Number(v):null,categoryName:v?getCatName(Number(v)):"Sin categoría"}:x)); }}><option value="">Sin categoría</option>{data.categories.filter(c=>c.kind===(r.type==="income"?"income":"expense")).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                                <td className="p-2"><input type="checkbox" aria-label={`Importar ${r.concept}`} checked={r.include} onChange={e=>setImportRows(rows=>rows!.map((x,j)=>j===i?{...x,include:e.target.checked}:x))} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className={btnPrimary+" flex-1"} disabled={importMv.isPending || importRows.filter(r=>r.include).length===0} onClick={()=>importMv.mutate(importRows)}>{importMv.isPending?"Importando…":`Importar ${importRows.filter(r=>r.include).length} movimiento(s)`}</button>
                        <button type="button" className={btnGhost} onClick={()=>{setImportRows(null);setImportFileName("");}}>Cancelar</button>
                      </div>
                      {importMv.error && <p className="text-sm text-[var(--red)]">{String(importMv.error)}</p>}
                    </>
                  )}
                </div>
              )}
              {revMv.error && <p className="text-sm text-[var(--red)] mt-2">{String(revMv.error)}</p>}
              {revMv.isSuccess && <p className="text-sm text-[var(--green)] mt-2">Movimiento reversado.</p>}
              <div className="divide-y divide-[var(--border)] mt-2">
                {groupedMovs.map((entry)=>{ if (isSplitGroup(entry)) { const g = entry; const first = g.parts[0]!; const gAnnulled = g.allReversed; const gOpen = expandedSplit.has(g.key); const partsAsc = [...g.parts].reverse(); const gOrigCur = g.parts[0]?.originalCurrency ?? null; const gOrigTotal = g.parts.reduce((s,p)=>s+(p.originalAmount ?? 0),0); const gFx = g.parts.length>0 && gOrigCur!=null && g.parts.every(p=>p.originalCurrency===gOrigCur) ? fxLabel(gOrigTotal, gOrigCur, g.total, hhCur) : null; return <div key={g.key} className={`py-2 ${gAnnulled?"opacity-70":""}`}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-sm">{movTitle(first)}</p><p className="text-xs text-[var(--dim)]">{fmtDate(g.date)} · Gasto · {getAccName(g.accountId)} · {g.visibility==="shared"?"Compartido":"Privado"} · por {g.profileId?(fullName(data.profiles.find(x=>x.id===g.profileId)||{name:"Integrante"})):"el hogar"}</p>
                {gAnnulled && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">REVERSADO</span> <span className="text-xs text-[var(--dim)]">Fuera de los totales.</span></p>}
                </div><div className="text-right shrink-0"><p className={`font-display font-bold ${gFx?"text-sm":"whitespace-nowrap"} ${gAnnulled?"line-through":""}`}>−{gFx ?? money2(g.total)}</p>{g.receiptUrl && <span className="block mt-1"><img loading="lazy" decoding="async" src={g.receiptUrl} alt={`Foto del comprobante de ${g.concept}`} className="w-10 h-10 object-cover rounded-lg border border-[var(--border)] inline-block" /><br/><button aria-label={`Ver foto del comprobante de ${g.concept}`} className="text-xs underline font-bold" onClick={()=>setReceiptView(g.receiptUrl)}>Ver comprobante</button></span>}
                {!gAnnulled && <><button aria-label={`Editar ${g.concept}`} className="text-xs underline mr-2" onClick={()=>{setMvStep(1);setEditingMv(first.id);setEditingSplitGroup(g.groupId);setMvType("expense");setMvAmount(String(gFx ? gOrigTotal : g.total));setMvCurrency(gOrigCur ?? "");setMvConcept(g.concept);setMvAccount(g.accountId?String(g.accountId):"");setMvToAccount("");setMvCat("");setMvSub("");setMvBudget(null);setMvDate(g.date);setMvVis(g.visibility as "private"|"shared");setMvSplit(true);setMvSplitLines(partsAsc.map(p=>({ key: splitKeyRef.current++, categoryId: p.categoryId?String(p.categoryId):"", amount: String(p.originalAmount ?? p.amount), budgetId: p.budgetId ?? null })));scrollFormTop("mv-form");}}>Editar</button><button aria-label={`Reversar ${g.concept}`} className="text-xs underline font-bold mr-2" onClick={()=>setConfirmReverseId(confirmReverseId===first.id?null:first.id)}>Reversar</button><button aria-label={`Eliminar ${g.concept}`} className="text-xs underline text-[var(--red)]" onClick={()=>setConfirmDeleteMvId(confirmDeleteMvId===first.id?null:first.id)}>Eliminar</button></>}
                </div></div>
                <button type="button" aria-expanded={gOpen} aria-label={`${gOpen?"Ocultar":"Ver"} las ${g.parts.length} categorías de ${g.concept}`} onClick={()=>setExpandedSplit(prev=>{ const next=new Set(prev); if(next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })} className="text-xs font-bold text-[var(--dim)] mt-1">{gOpen?"▾":"▸"} {g.parts.length} categorías · {money2(g.total)}</button>
                {gOpen && <div className="mt-1 pl-3 border-l-2 border-[var(--border)]">{partsAsc.map(p=>(<div key={p.id} className="flex justify-between gap-2 py-1 text-[13px]"><span>{getCatName(p.categoryId)}{p.budgetId!=null && p.budgetId>0 ? " · aplica al presupuesto" : ""}</span><b className="whitespace-nowrap">{fxLabel(p.originalAmount, p.originalCurrency, p.amount, hhCur) ?? money2(p.amount)}</b></div>))}</div>}
                {confirmReverseId===first.id && !gAnnulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Reversar «{g.concept}» por <b className="whitespace-nowrap">{money2(g.total)}</b>? Se reversan las {g.parts.length} partes; todas quedan fuera de los totales.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la reversión de ${g.concept}`} className={btnPrimary} disabled={revMv.isPending} onClick={()=>revMv.mutate(first.id)}>{revMv.isPending?"Reversando…":"Sí, reversar"}</button><button type="button" aria-label="Cancelar la reversión" className={btnGhost} onClick={()=>setConfirmReverseId(null)}>Cancelar</button></div></div>}
                {confirmDeleteMvId===first.id && !gAnnulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar este gasto dividido?</p><p className="text-xs text-[var(--dim)] mt-1">«{g.concept}» por <b className="whitespace-nowrap">{money2(g.total)}</b> · {g.parts.length} partes. Se eliminan todas las partes. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Avanzar con la eliminación de ${g.concept}`} className={btnPrimary} disabled={delMv.isPending} onClick={()=>confirmDeleteMovement(first.id)}>{delMv.isPending?"Eliminando…":"Avanzar"}</button><button type="button" aria-label="Cancelar la eliminación" className={btnGhost} onClick={()=>setConfirmDeleteMvId(null)}>Cancelar</button></div></div>}
                </div>; } const m = entry; const annulled = m.isReversed || !!m.reversalOfId; return <div key={m.id} className={`py-2 ${annulled?"opacity-70":""}`}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-sm">{movTitle(m)}</p><p className="text-xs text-[var(--dim)]">{fmtDate(m.date)} · {TYPE_LABEL[m.type]||m.type} · {getCatName(m.categoryId)}{m.subcategory?` / ${m.subcategory}`:""} · {getAccName(m.accountId)} · {m.visibility==="shared"?"Compartido":"Privado"} · por {m.profileId?(fullName(data.profiles.find(x=>x.id===m.profileId)||{name:"Integrante"})):"el hogar"}</p>
                {(() => { const n = movementRateNotice(m.originalCurrency ?? "", hhCur, m.exchangeRate, m.exchangeRateDate); return n ? <p className="text-[11px] text-[var(--dim)]">{n}</p> : null; })()}
                {m.isReversed && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">REVERSADO</span> <span className="text-xs text-[var(--dim)]">Fuera de los totales.</span></p>}
                {!!m.reversalOfId && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-[var(--surface2)]">REVERSIÓN</span> <span className="text-xs text-[var(--dim)]">Anula «{reversalConceptById.get(m.reversalOfId)||""}».</span></p>}
                </div><div className="text-right shrink-0"><p className={`font-display font-bold whitespace-nowrap ${m.type==="income"?"text-[var(--green)]":""} ${annulled?"line-through":""}`}>{m.type==="income"?"+":"−"}{fxLabel(m.originalAmount, m.originalCurrency, m.amount, hhCur) ?? money2(m.amount)}</p>{m.receiptUrl && <span className="block mt-1"><img loading="lazy" decoding="async" src={m.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-10 h-10 object-cover rounded-lg border border-[var(--border)] inline-block" /><br/><button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold" onClick={()=>setReceiptView(m.receiptUrl)}>Ver comprobante</button></span>}
                {!annulled && <><button aria-label={`Editar ${m.concept}`} className="text-xs underline mr-2" onClick={()=>{setMvStep(1);setEditingMv(m.id);setMvType(m.type as typeof mvType);setMvAmount(String(m.originalAmount ?? m.amount));setMvCurrency(m.originalCurrency ?? "");setMvConcept(m.concept);setMvAccount(m.accountId?String(m.accountId):"");setMvToAccount(m.toAccountId?String(m.toAccountId):"");setMvCat(m.categoryId?String(m.categoryId):"");setMvSub(m.subcategory||"");setMvBudget(m.budgetId??null);setMvDate(m.date);setMvVis(m.visibility as "private"|"shared");scrollFormTop("mv-form");}}>Editar</button><button aria-label={`Reversar ${m.concept}`} className="text-xs underline font-bold mr-2" onClick={()=>setConfirmReverseId(confirmReverseId===m.id?null:m.id)}>Reversar</button><button aria-label={`Eliminar ${m.concept}`} className="text-xs underline text-[var(--red)]" onClick={()=>setConfirmDeleteMvId(confirmDeleteMvId===m.id?null:m.id)}>Eliminar</button></>}
                </div></div>
                {confirmReverseId===m.id && !annulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Reversar «{m.concept}» por <b className="whitespace-nowrap">{money2(m.amount)}</b>? Ambos quedan fuera de los totales.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la reversión de ${m.concept}`} className={btnPrimary} disabled={revMv.isPending} onClick={()=>revMv.mutate(m.id)}>{revMv.isPending?"Reversando…":"Sí, reversar"}</button><button type="button" aria-label="Cancelar la reversión" className={btnGhost} onClick={()=>setConfirmReverseId(null)}>Cancelar</button></div></div>}
                {confirmDeleteMvId===m.id && !annulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar este movimiento?</p><p className="text-xs text-[var(--dim)] mt-1">«{m.concept}» por <b className="whitespace-nowrap">{money2(m.amount)}</b>. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Avanzar con la eliminación de ${m.concept}`} className={btnPrimary} disabled={delMv.isPending} onClick={()=>confirmDeleteMovement(m.id)}>{delMv.isPending?"Eliminando…":"Avanzar"}</button><button type="button" aria-label="Cancelar la eliminación" className={btnGhost} onClick={()=>setConfirmDeleteMvId(null)}>Cancelar</button></div></div>}
                </div>; })}
              </div>
              {mvQuery.hasNextPage && <div className="mt-3 text-center"><button type="button" className={btnGhost} disabled={mvQuery.isFetchingNextPage} onClick={()=>mvQuery.fetchNextPage()}>{mvQuery.isFetchingNextPage?"Cargando más…":"Cargar más"}</button></div>}
              {mvQuery.isPending && <p className="text-sm text-[var(--dim)] mt-2">Cargando movimientos…</p>}
              {!mvQuery.isPending && filteredMovs.length===0 && <Empty title="Sin movimientos con ese filtro" body="Cambie el filtro o registre el primero." />}
            </div>
          </section>
        )}

        {effTab==="cuentas" && (<>
          <section className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 items-start">
            {showAccPreview ? (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2">
                <h2 className="font-display font-bold text-lg">{editingAcc?"Revise antes de guardar":"Revise antes de crear"}</h2>
                {(()=>{ const orig=editingAcc!=null?data.accounts.find(a=>a.id===editingAcc):undefined; const initVal=Number(accInit)||0; const initFx = accCurrencyEffective!==hhCur && accRate ? fxLabel(initVal, accCurrencyEffective, previewEquivalent(initVal, accRate) ?? initVal, hhCur) : null; const rows=[{label:"Nombre",old:orig?.name,val:accFormName},{label:"Tipo",old:orig?(TYPE_LABEL[orig.type]||orig.type):undefined,val:TYPE_LABEL[accType]},{label:"Visibilidad",old:orig?(orig.visibility==="shared"?"Compartida":"Privada"):undefined,val:accVis==="shared"?"Compartida":"Privada"},{label:"Moneda",old:orig?.currency,val:accCurrencyEffective},{label:"Saldo inicial",old:orig?(fxLabel(orig.initialBalanceOriginal, orig.currency, orig.initialBalance, hhCur) ?? money2(orig.initialBalance)):undefined,val:initFx ?? money2(initVal)}]; return (<div className="divide-y divide-[var(--border)]">{rows.map(r=>{ const changed=r.old!==undefined&&r.old!==r.val; return (<div key={r.label} className={`py-2 flex justify-between gap-2 ${changed?"bg-[var(--surface2)] rounded-lg px-2":""}`}><span className="text-sm text-[var(--dim)]">{r.label}</span><span className={`text-sm font-bold text-right ${changed?"text-[var(--accent)]":""}`}>{changed?`${r.old} → ${r.val}`:r.val}</span></div>); })}</div>); })()}
                <button type="button" className={btnPrimary+" w-full"} disabled={saveAcc.isPending} onClick={()=>saveAcc.mutate()}>{saveAcc.isPending?"Guardando…":editingAcc?"Guardar cambios":"Crear cuenta"}</button>
                <button type="button" className={btnGhost+" w-full"} onClick={()=>setShowAccPreview(false)}>Corregir</button>
                <p className="text-xs text-[var(--dim)]">Si algo no coincide, «Corregir» vuelve al formulario con los datos tal como estaban.</p>
                {saveAcc.error && <p className="text-sm text-[var(--red)]">{String(saveAcc.error)}</p>}
              </div>
            ) : (
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();setShowAccPreview(true);}}>
              <h2 className="font-display font-bold text-lg">{editingAcc?"Editar cuenta":"Nueva cuenta"}</h2>
              <Help>Se captura una sola vez.</Help>
              <div><Label htmlFor="acc-name">Nombre</Label><input id="acc-name" aria-label="Nombre de la cuenta" required className={inputCls} value={accFormName} onChange={e=>setAccFormName(e.target.value)} placeholder="Ej. Nómina Banorte" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="acc-type">Tipo</Label><select id="acc-type" aria-label="Tipo de cuenta" className={inputCls} value={accType} onChange={e=>setAccType(e.target.value as typeof accType)}><option value="bank">Bancaria</option><option value="cash">Efectivo</option><option value="credit">Tarjeta de crédito</option><option value="investment">Inversión</option><option value="loan">Préstamo</option></select></div>
                <div><Label htmlFor="acc-vis">Visibilidad</Label><select id="acc-vis" aria-label="Visibilidad de la cuenta" className={inputCls} value={accVis} onChange={e=>setAccVis(e.target.value as "private"|"shared")}><option value="shared">Compartida</option><option value="private">Privada</option></select></div>
              </div>
              <div><Label htmlFor="acc-currency">Moneda de la cuenta</Label><select id="acc-currency" aria-label="Moneda de la cuenta" className={inputCls} value={accCurrencyEffective} onChange={e=>setAccCurrency(e.target.value)}>{CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></div>
              {accNotice && <p className="text-xs text-[var(--dim)]">{accNotice}</p>}
              {accCurrencyPendingSql && <p className="text-sm text-[var(--red)]">La moneda de la cuenta se guardará cuando se ejecute el SQL pendiente (supabase/exchange-rates.sql).</p>}
              <div><Label htmlFor="acc-init">Saldo inicial ({accCurrencyEffective})</Label><input id="acc-init" aria-label="Saldo inicial" type="number" step="0.01" className={inputCls} value={accInit} onChange={e=>setAccInit(e.target.value)} /></div>
              <button className={btnPrimary+" w-full"}>{editingAcc?"Revisar cambios":"Revisar"}</button>
              {editingAcc && <button type="button" className={btnGhost+" w-full"} onClick={()=>{setEditingAcc(null);setAccCurrency("");}}>Cancelar</button>}
            </form>)}
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
              {data.accounts.map(a=>{ const accSum=accountSummaries.find(x=>x.accountId===a.id); const accMovs=data.movements.filter(m=>!m.isReversed&&m.reversalOfId==null&&(m.accountId===a.id||m.toAccountId===a.id)); const accFx = fxLabel(a.nativeBalance, a.currency, a.balance, hhCur); const accInitFx = fxLabel(a.initialBalanceOriginal, a.currency, a.initialBalance, hhCur); return <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">{a.name}</p><p className="text-xs text-[var(--dim)]">{TYPE_LABEL[a.type]||a.type} · {a.visibility==="shared"?"Compartida":"Privada"} · Inicial {accInitFx ?? money(a.initialBalance)}</p><p className={accFx ? "font-display text-base font-extrabold mt-2" : "font-display text-xl font-extrabold mt-2 whitespace-nowrap"}>{accFx ?? money2(a.balance)}</p><div className="mt-2 flex gap-2"><button aria-label={`Editar cuenta ${a.name}`} className="text-xs underline" onClick={()=>{setShowAccPreview(false);setEditingAcc(a.id);setAccFormName(a.name);setAccType(a.type as typeof accType);setAccVis(a.visibility as "private"|"shared");setAccInit(String(a.initialBalanceOriginal ?? a.initialBalance));setAccCurrency(a.currency ?? hhCur);}}>Editar</button>{deleteAccountPreviewId!==a.id && (<button aria-label={`Eliminar cuenta ${a.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>setDeleteAccountPreviewId(a.id)}>Eliminar</button>)}</div>{deleteAccountPreviewId===a.id && (<div className="mt-3 border border-[var(--gold)] rounded-2xl p-4 bg-[var(--surface2)] space-y-2" aria-label={`Revisión de la eliminación de la cuenta ${a.name}`}><p className="font-display font-bold text-sm">Revise antes de eliminar</p><div className="divide-y divide-[var(--border)]">{[{label:"Cuenta",val:a.name,changed:false},{label:"Saldo actual",val:accFx ?? money2(a.balance),changed:true},{label:"Saldo inicial",val:accInitFx ?? money(a.initialBalance),changed:false},{label:"Movimientos en este mes",val:String(accMovs.length),changed:false}].map(r=>(<div key={r.label} className="py-2 flex justify-between gap-2"><span className="text-sm text-[var(--dim)]">{r.label}</span><span className={`text-sm font-bold text-right ${r.changed?"text-[var(--accent)]":""}`}>{r.val}</span></div>))}</div><p className="text-sm text-[var(--dim)]">{TYPE_LABEL[a.type]||a.type} · {a.visibility==="shared"?"Compartida":"Privada"}</p><p className="text-sm font-semibold">Qué pasa al eliminar:</p><p className="text-sm">La cuenta se elimina y no se puede recuperar.</p><p className="text-sm">Sus movimientos no se borran: quedarán como «Sin cuenta».</p><p className="text-sm">Su saldo de {accFx ?? money2(a.balance)} sale del total del hogar.</p>{data.accounts.length===1 && (<p className="text-sm text-[var(--red)]">Es la única cuenta del hogar: sin cuentas no se podrán guardar gastos nuevos hasta crear otra.</p>)}<div className="flex gap-2"><button type="button" aria-label={`Confirmar la eliminación de la cuenta ${a.name}`} className={btnDanger+" flex-1"} disabled={delAcc.isPending} onClick={()=>delAcc.mutate(a.id)}>{delAcc.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label={`Cancelar la eliminación de la cuenta ${a.name}`} className={btnGhost} onClick={()=>setDeleteAccountPreviewId(null)}>Cancelar</button></div></div>)}{accSum && <><button type="button" aria-label={`Ver resumen de la cuenta ${a.name}`} aria-expanded={accSummaryOpen===a.id} className="text-xs underline mt-2" onClick={()=>setAccSummaryOpen(accSummaryOpen===a.id?null:a.id)}>{accSummaryOpen===a.id?"Ocultar resumen":"Ver resumen"}</button>{accSummaryOpen===a.id && <div className="mt-2 border-t border-[var(--border)] pt-2 text-sm space-y-1">{accountSummaryRows(accSum).map(r=>(<div key={r.key} className="flex justify-between gap-2"><span className={r.key==="balance"?"font-bold":"text-[var(--dim)]"}>{r.label}</span><b className="whitespace-nowrap">{r.sign<0?"−":""}{money2(r.amount)}</b></div>))}{unassignedFunds>0 && <p className="text-xs text-[var(--dim)]">Las aportaciones sin cuenta ({money(unassignedFunds)} apartado) no se asignan a ninguna cuenta.</p>}</div>}</>}</div>; })}
              {data.accounts.length===0 && <Empty title="Sin cuentas" body="Cree su primera cuenta." action={{label:"+ Agregar cuenta",onClick:()=>{setShowAccPreview(false);focusField("acc-name");}}} />}
            </div>
          </section>
          {isAdmin && (
            <div className="mt-3">
              <button type="button" aria-label={ccOpen?"Cerrar el arqueo de cuentas":"Abrir el arqueo de cuentas"} className={btnPrimary} onClick={()=>{ setCcOpen(!ccOpen); setCcError(""); }}>{ccOpen?"Cerrar arqueo":"Arqueo de cuentas"}</button>
              {ccOpen && (()=>{ const useSalary=s.hasSalaryIncome===1; const rows=[{key:"cash",name:"Efectivo",app:useSalary?s.salaryRemaining:s.unassignedNet,detail:useSalary?`Sueldo ${money(s.salaryIncome)} - Gastado ${money(s.salarySpent)} = Restante ${money2(s.salaryRemaining)}`:`En la app: ${money2(s.unassignedNet)}`,note:useSalary?undefined:"Registre el ingreso en Perfiles para comparar con el restante del sueldo."},...data.accounts.map(a=>({key:`acc-${a.id}`,name:a.name,app:a.balance,detail:`En la app: ${money2(a.balance)}`,note:undefined as string|undefined}))]; const countedRows=rows.filter(r=>{const v=ccCounted[r.key]; return v!=null&&v!==""&&Number(v)>=0&&!Number.isNaN(Number(v));}); const totalApp=Math.round(countedRows.reduce((x,r)=>x+r.app,0)*100)/100; const totalCounted=Math.round(countedRows.reduce((x,r)=>x+Number(ccCounted[r.key]),0)*100)/100; const totalDiff=Math.round((totalCounted-totalApp)*100)/100; return (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
                <h2 className="font-display font-bold text-lg">Arqueo de cuentas</h2>
                <p className="text-sm text-[var(--dim)] mt-1">Anote lo que contó en físico. El renglón de efectivo compara el restante del sueldo con lo contado. El arqueo no cambia los saldos, solo muestra la diferencia para revisarla después.</p>
                <div className="divide-y divide-[var(--border)] mt-2">
                  {rows.map(r=>{ const v=ccCounted[r.key]??""; const n=Number(v); const has=v!==""&&!Number.isNaN(n)&&n>=0; const d=has?Math.round((n-r.app)*100)/100:0; return (
                  <div key={r.key} className="py-2.5 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                    <div><p className="font-semibold text-sm">{r.name}</p><p className="text-xs text-[var(--dim)]">{r.detail}</p>{r.note && <p className="text-xs text-[var(--dim)] mt-0.5">{r.note}</p>}</div>
                    <div><Label htmlFor={`cc-${r.key}`}>Contado ($)</Label><input id={`cc-${r.key}`} aria-label={`Cantidad contada en ${r.name}`} type="number" min="0" step="0.01" className={inputCls+" w-32"} value={v} onChange={e=>setCcCounted({...ccCounted,[r.key]:e.target.value})} placeholder="0.00" /></div>
                    <div className="sm:text-right">{!has ? <span className="text-xs text-[var(--dim)]">Sin contar</span> : d===0 ? <span className="text-xs font-bold text-[var(--green)]">Sin diferencia</span> : <span className={`text-xs font-bold ${d<0?"text-[var(--red)]":"text-[var(--green)]"}`}>{d<0?`Falta ${money2(-d)}`:`Sobra ${money2(d)}`}</span>}</div>
                  </div>); })}
                </div>
                <div className="flex flex-wrap gap-4 text-sm mt-2 pt-2 border-t border-[var(--border)]"><span>En la app: <b className="whitespace-nowrap">{money2(totalApp)}</b></span><span>Contado: <b className="whitespace-nowrap">{money2(totalCounted)}</b></span><span>Diferencia: {countedRows.length===0 ? <b className="text-[var(--dim)]">Sin contar</b> : totalDiff===0 ? <b className="text-[var(--green)]">Sin diferencia</b> : <b className={totalDiff<0?"text-[var(--red)]":"text-[var(--green)]"}>{totalDiff<0?`Falta ${money2(-totalDiff)}`:`Sobra ${money2(totalDiff)}`}</b>}</span></div>
                <div className="mt-3"><Label htmlFor="cc-note">Nota (opcional)</Label><input id="cc-note" aria-label="Nota del arqueo, opcional" className={inputCls} value={ccNote} onChange={e=>setCcNote(e.target.value)} placeholder="Ej. Arqueo de cierre de mes" /></div>
                {ccError && <p className="text-sm text-[var(--red)] mt-2" role="alert">{ccError}</p>}
                <div className="flex gap-2 mt-3"><button type="button" className={btnPrimary} disabled={saveCc.isPending} onClick={()=>saveCc.mutate()}>{saveCc.isPending?"Guardando…":"Guardar arqueo"}</button><button type="button" className={btnGhost} onClick={()=>{ setCcOpen(false); setCcError(""); }}>Cancelar</button></div>
              </div>); })()}
              {ccQuery.isPending ? (
              <div className="mt-3">
                <h3 className="font-display font-bold text-lg">Historial de arqueos</h3>
                <p className="text-sm text-[var(--dim)] mt-2">Cargando arqueos…</p>
              </div>
              ) : ccQuery.error ? (
              <div className="mt-3">
                <h3 className="font-display font-bold text-lg">Historial de arqueos</h3>
                <p className="text-sm text-[var(--red)] mt-2">No se pudieron cargar los arqueos.</p>
              </div>
              ) : !ccQuery.data || ccQuery.data.counts.length===0 ? (
              <div className="mt-3">
                <h3 className="font-display font-bold text-lg">Historial de arqueos</h3>
                <p className="text-sm text-[var(--dim)] mt-2">Sin arqueos guardados todavía.</p>
              </div>
              ) : (
              <CollapsibleCard className="mt-3" title={<h3 className="font-display font-bold text-lg">Historial de arqueos</h3>} above={(()=>{ const cs = sumCashCounts(ccQuery.data.counts); return <p className="text-sm text-[var(--dim)] mt-1">{cs.total} {cs.total===1?"arqueo":"arqueos"} · {cs.withDiff} con diferencia{cs.netDiff===0 ? "" : cs.netDiff<0 ? ` · Faltan ${money2(-cs.netDiff)}` : ` · Sobran ${money2(cs.netDiff)}`}</p>; })()}>
                <div className="space-y-2 mt-2">
                  {ccQuery.data.counts.map(c=>(
                    <div key={c.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                      <div className="flex justify-between gap-2 items-start"><div><p className="font-display font-bold text-sm">Arqueo · {fmtDate(c.createdAt.slice(0,10))}</p><p className="text-xs text-[var(--dim)]">{c.createdByName}{c.note?` · ${c.note}`:""}</p><p className="text-xs text-[var(--dim)] mt-1">En la app {money2(c.totalApp)} · Contado {money2(c.totalCounted)}</p></div><p className={`font-display font-extrabold shrink-0 ${c.totalDiff===0?"text-[var(--green)]":c.totalDiff<0?"text-[var(--red)]":"text-[var(--green)]"}`}>{c.totalDiff===0?"Sin diferencia":c.totalDiff<0?`Falta ${money2(-c.totalDiff)}`:`Sobra ${money2(c.totalDiff)}`}</p></div>
                      <button type="button" aria-label={`Ver detalle del arqueo del ${fmtDate(c.createdAt.slice(0,10))}`} className="text-xs underline mt-2" onClick={()=>setCcExpanded(ccExpanded===c.id?null:c.id)}>{ccExpanded===c.id?"Ocultar detalle":"Ver detalle"}</button>
                      {ccExpanded===c.id && <div className="divide-y divide-[var(--border)] mt-2">{c.lines.map(l=>(<div key={l.accountId??"cash"} className="py-2 flex flex-wrap justify-between gap-2 text-sm"><span>{l.accountName}</span><span className="text-[var(--dim)]">App {money2(l.appBalance)} · Contado {money2(l.countedAmount)} · {l.difference===0?<b className="text-[var(--green)]">Sin diferencia</b>:l.difference<0?<b className="whitespace-nowrap text-[var(--red)]">Falta {money2(-l.difference)}</b>:<b className="whitespace-nowrap text-[var(--green)]">Sobra {money2(l.difference)}</b>}</span></div>))}</div>}
                    </div>
                  ))}</div>
              </CollapsibleCard>
              )}
            </div>
          )}
        </>)}


        {effTab==="presupuestos" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-5 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();setBudPendingSql(false);if(budBackfill.length>0){setBudBackfillOpen(true);return;}saveBud.mutate({});}}>
              <div><Label htmlFor="bud-cat">Categoría de gasto</Label><select id="bud-cat" aria-label="Categoría del presupuesto" required className={inputCls} disabled={budEditId!=null} value={budCat} onChange={e=>{setBudCat(e.target.value);setBudSub("");}}><option value="">Seleccione…</option>{data.categories.filter(c=>c.kind==="expense").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><Label htmlFor="bud-sub">Subcategoría</Label><select id="bud-sub" aria-label="Subcategoría del presupuesto" className={inputCls} value={budSub} onChange={e=>setBudSub(e.target.value)} disabled={!budCat||budEditId!=null}><option value="">Toda la categoría</option>{(data.categories.find(c=>c.id===Number(budCat))?.subcategories||[]).map(sb=><option key={sb} value={sb}>{sb}</option>)}</select></div>
              <div><Label htmlFor="bud-month">Mes</Label><input id="bud-month" aria-label="Mes del presupuesto" type="month" required className={inputCls} disabled={budEditId!=null} value={budMonth} onChange={e=>setBudMonth(e.target.value)} /></div>
              <div><Label htmlFor="bud-amount">Presupuestado ($)</Label><input id="bud-amount" aria-label="Monto presupuestado" type="number" min="0" required className={inputCls} value={budAmount} onChange={e=>setBudAmount(e.target.value)} /></div>
              <div><Label htmlFor="bud-vis">Visibilidad</Label><select id="bud-vis" aria-label="Visibilidad del presupuesto" className={inputCls} value={budVis} onChange={e=>setBudVis(e.target.value as "private"|"shared")}><option value="shared">Compartido</option><option value="private">Privado</option></select></div>
              <div className={budIncludePrior?"md:col-span-4":"md:col-span-2"}><Label htmlFor="bud-prior">Gastos ya capturados este mes</Label><select id="bud-prior" aria-label="Gastos ya capturados este mes" className={inputCls} value={budIncludePrior?"yes":"no"} onChange={e=>setBudIncludePrior(e.target.value==="yes")}><option value="no">No, empezar desde cero</option><option value="yes">Sí, incluirlos en el presupuesto</option></select></div>
              {!budIncludePrior && <div className="md:col-span-2"><Label htmlFor="bud-start">Fecha de inicio</Label><input id="bud-start" aria-label="Fecha de inicio del presupuesto" type="date" className={inputCls} value={budStartDate} onChange={e=>setBudStartDate(e.target.value)} /></div>}
              <button className={btnPrimary} disabled={saveBud.isPending}>{budEditId!=null?"Guardar cambios":"Crear presupuesto"}</button>{budEditId!=null && <button type="button" className={btnGhost} onClick={()=>{setBudEditId(null);setBudAmount("");setBudSub("");setBudIncludePrior(false);setBudStartDate(todayISO());setBudBackfillOpen(false);}}>Cancelar</button>}
            </form>
            {budBackfillOpen && budBackfill.length>0 && <div className="mt-3 border border-[var(--gold)] rounded-2xl p-4 bg-[var(--surface2)] space-y-2" aria-label="Revisión de los gastos ya registrados">
              <p className="font-display font-bold text-sm">Gastos ya registrados en este presupuesto</p>
              <p className="text-sm">Desde el {fmtDate(budStartDate)} se registraron estos gastos de {getCatName(Number(budCat))}{budSub ? ` · ${budSub}` : ""}. ¿Quieres agregarlos al presupuesto?</p>
              <div className="divide-y divide-[var(--border)]">{budBackfill.map(m=>(<div key={m.id} className="py-2 flex justify-between gap-2"><span className="text-sm">{fmtDate(m.date)} · {m.concept}</span><span className="text-sm font-bold whitespace-nowrap">{money(m.amount)}</span></div>))}</div>
              <p className="text-sm font-bold">Total: {money(budBackfill.reduce((s,m)=>s+m.amount,0))}</p>
              <div className="flex gap-2">
                <button type="button" aria-label="Sí, agregar los gastos registrados al presupuesto" className={btnPrimary+" flex-1"} disabled={saveBud.isPending} onClick={()=>{setBudBackfillOpen(false);saveBud.mutate({});}}>Sí, agregarlos</button>
                <button type="button" aria-label="No, empezar el presupuesto limpio" className={btnGhost} disabled={saveBud.isPending} onClick={()=>{setBudBackfillOpen(false);saveBud.mutate({startDateOverride: todayISO()});}}>No, empezar limpio</button>
              </div>
            </div>}
            <Help>{budSub ? `Solo cuentan los gastos de ${budSub}. ` : "Cuentan los gastos de toda la categoría. "}{budIncludePrior ? "Los gastos ya capturados este mes se descuentan del presupuesto." : budStartDate!==todayISO() ? `Nace como nuevo: solo cuentan los gastos capturados desde el ${fmtDate(budStartDate)}.` : "Nace como nuevo: los gastos ya capturados este mes no se descuentan; solo cuentan los gastos que registre desde ahora."}</Help>
            {budPendingSql && <p className="text-sm text-[var(--red)] mt-2">La subcategoría y la elección de gastos previos se guardarán cuando se ejecute el SQL pendiente (supabase/add-budget-subcategory.sql).</p>}
            {budStartDatePendingSql && <p className="text-sm text-[var(--red)] mt-2">La fecha de inicio se guardará cuando se ejecute el SQL pendiente (supabase/add-budget-start-date.sql).</p>}
            {(()=>{ const cur=monthNow(); const rows=data.categories.filter((c)=>c.kind==="expense").map((c)=>{ const total=monthTotalOf(c.id,cur) ?? 0; const a=avg3Of(c.id,cur); return { cat:c, total, avg:a.avg, monthsWithData:a.monthsWithData, suggested:Math.ceil(Math.max(total,a.avg)/100)*100, snoozed:snoozeMap.get(c.id) ?? null }; }).filter((r)=>r.total>=1 && !data.budgets.some((b)=>b.categoryId===r.cat.id && b.month===cur && b.subcategory==null)).sort((a,b)=>b.total-a.total); if(rows.length===0) return null; return (
            <CollapsibleCard className="mt-4 md:mt-6" defaultOpen title={<h2 className="font-display font-bold text-lg">Categorías sin presupuesto este mes</h2>} above={<p className="text-sm text-[var(--dim)] mt-1">{rows.length} {rows.length===1?"categoría":"categorías"} con gasto y sin presupuesto · desde $1</p>} toggleLabel="categorías sin presupuesto">
              {rows.map((r)=>(<div key={r.cat.id} className="py-3 border-b border-[var(--border)] last:border-0">
                <p className="font-semibold">{r.cat.name}</p>
                <p className="text-sm text-[var(--dim)]">Total del mes {money(r.total)} · {r.monthsWithData>0 ? `Promedio ${r.monthsWithData===3?"3 meses":`de ${r.monthsWithData} ${r.monthsWithData===1?"mes":"meses"}`}: ${money(r.avg)}` : "Aún no hay promedio de meses anteriores"} · Límite sugerido {money(r.suggested)}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" className={btnPrimary} onClick={()=>openBudgetForm(r.cat.id,cur,r.suggested)}>Crear presupuesto</button>
                  <button type="button" className={btnGhost} onClick={()=>{ setSnoozeRowOpen((o)=>({...o,[r.cat.id]:!(o[r.cat.id] ?? false)})); setSnoozeRowAmt((a)=>({...a,[r.cat.id]:a[r.cat.id] ?? String(nextHundredAbove(r.total))})); }}>Avísame cuando llegue a…</button>
                </div>
                {r.snoozed!=null && !(snoozeRowOpen[r.cat.id] ?? false) && <p className="text-sm mt-2">Aviso guardado: le pregunto de nuevo cuando llegue a {money(r.snoozed)}. <button type="button" className="text-xs underline font-bold" onClick={()=>{ setSnoozeRowOpen((o)=>({...o,[r.cat.id]:true})); setSnoozeRowAmt((a)=>({...a,[r.cat.id]:String(r.snoozed)})); }}>Cambiar</button></p>}
                {(snoozeRowOpen[r.cat.id] ?? false) && (<div className="mt-2 flex flex-wrap gap-2 items-end">
                  <div><Label htmlFor={`snooze-row-${r.cat.id}`}>Avísame cuando llegue a ($)</Label><input id={`snooze-row-${r.cat.id}`} aria-label={`Avísame de nuevo de ${r.cat.name} cuando llegue a`} type="number" min="0" className={inputCls} value={snoozeRowAmt[r.cat.id] ?? ""} onChange={(e)=>setSnoozeRowAmt((a)=>({...a,[r.cat.id]:e.target.value}))} /></div>
                  <button type="button" className={btnPrimary} disabled={snoozeMut.isPending} onClick={()=>{ const v=Number(snoozeRowAmt[r.cat.id])||0; if(v<=0) return; snoozeMut.mutate({categoryId:r.cat.id,month:cur,nextThreshold:v}); setSnoozeRowOpen((o)=>({...o,[r.cat.id]:false})); }}>Guardar aviso</button>
                </div>)}
                {snoozePendingSql && <p className="text-xs text-[var(--red)] mt-2">La posposición se guardará cuando se ejecute el SQL pendiente (supabase/add-budget-suggestion-snooze.sql).</p>}
              </div>))}
            </CollapsibleCard>); })()}
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.budgets.map(b=>{ const bName=`${getCatName(b.categoryId)}${b.subcategory?` · ${b.subcategory}`:""}`; const bMovs=data.movements.filter(m=>(m.type==="expense"||m.type==="debt_payment")&&!m.isReversed&&m.reversalOfId==null&&applicableBudget(data,{type:m.type as "expense"|"debt_payment",amount:m.amount,categoryId:m.categoryId,concept:m.concept,date:m.date,subcategory:m.subcategory??null,budgetId:m.budgetId??null})?.id===b.id); const bHasGeneral=b.subcategory!=null&&data.budgets.some(x=>x.categoryId===b.categoryId&&x.month===b.month&&x.subcategory==null); const bOthers=data.budgets.filter(x=>x.id!==b.id&&x.categoryId===b.categoryId&&x.month===b.month); return <div key={b.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><div className="flex justify-between"><b className="font-display">{getCatName(b.categoryId)}{b.subcategory?` · ${b.subcategory}`:""}</b><span className="text-xs bg-[var(--surface2)] rounded-full px-2 py-1">{b.month} · {b.visibility==="shared"?"Compartido":"Privado"}</span></div><p className="text-sm mt-2">Presupuestado <span className="whitespace-nowrap">{money(b.amount)}</span> · Gastado <span className="whitespace-nowrap">{money(b.spent)}</span> · {b.remaining<0?<b className="text-[var(--red)] whitespace-nowrap">Sobrepasado por {money(-b.remaining)}</b>:<b className="whitespace-nowrap">Restan {money(b.remaining)}</b>}</p><div className="h-2 bg-[var(--surface2)] rounded-full mt-2 overflow-hidden"><div className={`h-full ${b.pct>=100?"bg-[var(--red)]":b.pct>=80?"bg-[var(--gold)]":"bg-[var(--green)]"}`} style={{width:`${Math.min(100,b.pct)}%`}} /></div>{b.remaining<0?<p className="text-xs mt-1 font-bold text-[var(--red)]">Presupuesto excedido · {b.pct}% usado</p>:<p className="text-xs text-[var(--dim)] mt-1">{b.pct}% usado</p>}{!b.includePriorExpenses && <p className="text-xs text-[var(--dim)] mt-1">{b.startDate ? `Cuenta solo los gastos desde el ${fmtDate(b.startDate)}.` : "Cuenta solo los gastos desde su creación."}</p>}{deleteBudgetPreviewId===b.id ? (<div className="mt-3 border border-[var(--gold)] rounded-2xl p-4 bg-[var(--surface2)] space-y-2" aria-label={`Revisión de la eliminación del presupuesto de ${bName}`}><p className="font-display font-bold text-sm">Revise antes de eliminar</p><div className="divide-y divide-[var(--border)]">{[{label:"Presupuesto",val:bName,changed:false},{label:"Presupuestado",val:money(b.amount),changed:false},{label:"Gastado",val:money(b.spent),changed:false},{label:"Restan",val:b.remaining<0?`Sobrepasado por ${money(-b.remaining)}`:money(b.remaining),changed:true}].map(r=>(<div key={r.label} className="py-2 flex justify-between gap-2"><span className="text-sm text-[var(--dim)]">{r.label}</span><span className={`text-sm font-bold text-right ${r.changed?(b.remaining<0?"text-[var(--red)]":"text-[var(--accent)]"):""}`}>{r.val}</span></div>))}</div><p className="text-sm font-semibold">Qué les pasa a sus gastos:</p><p className="text-sm">No se borran.</p>{bMovs.length>0 ? (<p className="text-sm">{bHasGeneral?`Sus ${bMovs.length} ${bMovs.length===1?"gasto":"gastos"} (${money(b.spent)}) vuelven a contar en el presupuesto general de ${getCatName(b.categoryId)}, si lo hay.`:`Sus ${bMovs.length} ${bMovs.length===1?"gasto":"gastos"} (${money(b.spent)}) quedan sin presupuesto.`}</p>) : (<p className="text-sm">Este presupuesto no tiene gastos contados este mes.</p>)}{bOthers.length===0 ? (<p className="text-sm">La categoría quedará sin presupuesto este mes. Le podrá volver a salir el aviso para crear uno.</p>) : b.subcategory!=null ? (<p className="text-sm">La categoría seguirá con su presupuesto general de {getCatName(b.categoryId)}.</p>) : (<p className="text-sm">La categoría seguirá con su presupuesto de {bOthers[0]?.subcategory?`${getCatName(b.categoryId)} · ${bOthers[0].subcategory}`:getCatName(b.categoryId)}.</p>)}<div className="flex gap-2"><button type="button" aria-label={`Confirmar la eliminación del presupuesto de ${bName}`} className={btnDanger+" flex-1"} disabled={delBud.isPending} onClick={()=>delBud.mutate(b.id)}>{delBud.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label={`Cancelar la eliminación del presupuesto de ${bName}`} className={btnGhost} onClick={()=>setDeleteBudgetPreviewId(null)}>Cancelar</button></div></div>) : (<div className="flex gap-4 mt-1"><button type="button" aria-label={`Editar presupuesto de ${bName}`} className="text-xs underline" onClick={()=>openBudgetEdit(b)}>Editar</button><button type="button" aria-label={`Eliminar presupuesto de ${bName}`} className="text-xs underline text-[var(--red)]" onClick={()=>setDeleteBudgetPreviewId(b.id)}>Eliminar</button></div>)}</div>;})}
              {data.budgets.length===0 && <Empty title="Sin presupuestos" body="Uno por categoría o subcategoría y mes." action={{label:"+ Agregar presupuesto",onClick:()=>focusField("bud-amount")}} />}
            </div>
          </section>
        )}

        {effTab==="fondos" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex flex-wrap gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveFund.mutate();}}>
              <div className="flex-1 min-w-[180px]"><Label htmlFor="fund-name">Nombre del fondo</Label><input id="fund-name" aria-label="Nombre del fondo" required className={inputCls} value={fundName} onChange={e=>setFundName(e.target.value)} placeholder="Ej. Fondo de emergencia" /></div>
              <div><Label htmlFor="fund-target">Meta ($, opcional)</Label><input id="fund-target" aria-label="Meta del fondo" type="number" min="0" className={inputCls} value={fundTarget} onChange={e=>setFundTarget(e.target.value)} /></div>
              <div><Label htmlFor="fund-date">Fecha límite (opcional)</Label><input id="fund-date" aria-label="Fecha límite del fondo" type="date" className={inputCls} value={fundDate} onChange={e=>setFundDate(e.target.value)} /></div>
              <div><Label htmlFor="fund-importance">Importancia (1 a 5)</Label><select id="fund-importance" aria-label="Importancia del fondo, de 1 a 5" className={inputCls} value={fundImportance} onChange={e=>setFundImportance(e.target.value)}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} — {importanceLabel(n)}</option>)}</select></div>
              <button className={btnPrimary}>Crear fondo</button>
            </form>
            {fundDatePendingSql && <p className="text-sm text-[var(--red)] mt-2">La fecha límite se guardará cuando se ejecute el SQL pendiente (supabase/add-funds-target-date.sql).</p>}
            {fundImpPendingSql && <p className="text-sm text-[var(--red)] mt-2">La importancia se guardará cuando se ejecute el SQL pendiente (supabase/add-funds-importance.sql).</p>}
            <div className="mt-3"><Help>El dinero sigue en su cuenta; no cuenta como disponible.</Help></div>
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.funds.map(f=>{ const mode=fundMode[f.id]??"contribution"; const accErr=fundAccError[f.id]||""; return <CollapsibleCard key={f.id} title={<h2 className="font-display font-bold text-lg">{f.name}</h2>} above={<><p className="font-display text-xl font-extrabold mt-1 whitespace-nowrap">{money2(f.balance)}</p>{f.targetAmount && <p className="text-xs text-[var(--dim)]">Meta {money(f.targetAmount)} · {Math.min(100,Math.round(f.balance/f.targetAmount*100))}%</p>}{f.targetDate && <p className="text-xs text-[var(--dim)] mt-1">Meta {fmtDate(f.targetDate)}{(()=>{const need=fundNeedPerMonth(f); return need!==null && need>0 ? ` · faltan ${money(need)}/mes` : "";})()}</p>}</>} toggleLabel={`fondo ${f.name}`}><p className="text-sm mt-2"><span className="font-semibold">★ {f.importance ?? 3} de 5</span><button type="button" aria-label={`Cambiar la importancia de ${f.name}`} className="text-xs underline font-bold ml-1" onClick={()=>{setImpEditFundId(impEditFundId===f.id?null:f.id); setImpEditFundValue(String(f.importance ?? 3));}}>Cambiar</button><button type="button" aria-label={`Editar el fondo ${f.name}`} className="text-xs underline font-bold ml-2" onClick={()=>{setFundEditId(fundEditId===f.id?null:f.id); setFundEditTarget(f.targetAmount!=null?String(f.targetAmount):""); setFundEditDate(f.targetDate ?? ""); setFundEditDatePendingSql(false);}}>Editar</button></p>{impEditFundId===f.id && renderFundImpEditor(f)}{fundEditId===f.id && (<form className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); updateFund.mutate({id:f.id,targetAmount:fundEditTarget?Number(fundEditTarget):null,targetDate:fundEditDate});}}><div><Label htmlFor={`fund-edit-target-${f.id}`}>Meta ($, opcional)</Label><input id={`fund-edit-target-${f.id}`} aria-label={`Meta del fondo ${f.name}`} type="number" min="0" step="0.01" className={inputCls} value={fundEditTarget} onChange={e=>setFundEditTarget(e.target.value)} /></div><div><Label htmlFor={`fund-edit-date-${f.id}`}>Fecha límite (opcional)</Label><input id={`fund-edit-date-${f.id}`} aria-label={`Fecha límite del fondo ${f.name}`} type="date" className={inputCls} value={fundEditDate} onChange={e=>setFundEditDate(e.target.value)} /></div>{fundEditDatePendingSql && <p className="text-xs text-[var(--red)]">La fecha límite se guardará cuando se ejecute el SQL pendiente (supabase/add-funds-target-date.sql).</p>}<div className="flex gap-2"><button type="submit" aria-label={`Guardar los cambios del fondo ${f.name}`} className={btnPrimary} disabled={updateFund.isPending}>{updateFund.isPending?"Guardando…":"Guardar"}</button><button type="button" aria-label="Cancelar la edición del fondo" className={btnGhost} onClick={()=>setFundEditId(null)}>Cancelar</button></div></form>)}{renderFundPlan(f, (amt, accId) => { setFundMode({ ...fundMode, [f.id]: "contribution" }); setFundAmt({ ...fundAmt, [f.id]: String(amt) }); setFundAcc({ ...fundAcc, [f.id]: accId != null ? String(accId) : "" }); setFundAccError((a) => ({ ...a, [f.id]: "" })); })}<div className="flex gap-2 mt-3"><button type="button" aria-label={`Aportar a ${f.name}`} aria-pressed={mode==="contribution"} className={mode==="contribution"?btnPrimary:btnGhost} onClick={()=>{setFundMode({...fundMode,[f.id]:"contribution"});setFundAccError(a=>({...a,[f.id]:""}));}}>Aportar</button><button type="button" aria-label={`Retirar de ${f.name}`} aria-pressed={mode==="withdrawal"} className={mode==="withdrawal"?btnPrimary:btnGhost} onClick={()=>{setFundMode({...fundMode,[f.id]:"withdrawal"});setFundAccError(a=>({...a,[f.id]:""}));}}>Retirar</button></div><div className="mt-2"><Label htmlFor={`fund-amt-${f.id}`}>Importe ($)</Label><input id={`fund-amt-${f.id}`} aria-label={`Monto para ${f.name}`} type="number" min="0" placeholder="$ Monto" className={inputCls} value={fundAmt[f.id]||""} onChange={e=>setFundAmt({...fundAmt,[f.id]:e.target.value})} /></div><div className="mt-2"><Label htmlFor={`fund-acc-${f.id}`}>{mode==="withdrawal"?"¿A qué cuenta vuelve?":"¿De dónde se descuenta?"}</Label><select id={`fund-acc-${f.id}`} aria-label={mode==="withdrawal"?`Cuenta a la que vuelve el dinero de ${f.name}`:`Cuenta de donde se descuenta el aporte a ${f.name}`} className={inputCls} value={fundAcc[f.id]||""} onChange={e=>{setFundAcc({...fundAcc,[f.id]:e.target.value});setFundAccError(a=>({...a,[f.id]:""}));}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{(()=>{ const pv = mode==="contribution" ? contributionFxPreview(fundAmt[f.id]||"", fundAcc[f.id]||"") : null; return pv ? <p className="text-xs text-[var(--dim)] mt-1">{pv}</p> : null; })()}{accErr && <p className="text-sm text-[var(--red)] mt-1">{accErr}</p>}{fundMove.error && <p className="text-sm text-[var(--red)] mt-1">{String(fundMove.error)}</p>}<div className="mt-3"><button aria-label={`Guardar movimiento de ${f.name}`} className={btnPrimary} disabled={fundMove.isPending} onClick={()=>{ const amt=Number(fundAmt[f.id])||0; if(amt<=0) return; const notice=mode==="withdrawal"?requiredGoalReturnAccountNotice(fundAcc[f.id]):requiredGoalAccountNotice(fundAcc[f.id]); if(notice){ setFundAccError(a=>({...a,[f.id]:notice})); return; } if(mode==="withdrawal"){ setFundWithdrawPreviewId(f.id); } else { fundMove.mutate({fundId:f.id,type:mode,amount:amt,accountId:Number(fundAcc[f.id])}); } }}>{fundMove.isPending?"Guardando…":"Guardar"}</button></div>{fundWithdrawPreviewId===f.id && (<div className="mt-3 border border-[var(--gold)] rounded-2xl p-4 bg-[var(--surface2)] space-y-2" aria-label={`Revisión del retiro de ${f.name}`}><p className="font-display font-bold text-sm">Revise antes de retirar</p><div className="divide-y divide-[var(--border)]">{[{label:"Fondo",val:f.name,changed:false},{label:"Importe a retirar",val:money2(Number(fundAmt[f.id])||0),changed:false},{label:"Vuelve a la cuenta",val:data.accounts.find(a=>a.id===Number(fundAcc[f.id]))?.name ?? "—",changed:false},{label:"Saldo del fondo",val:`${money2(f.balance)} → ${money2(f.balance-(Number(fundAmt[f.id])||0))}`,changed:true}].map(r=>(<div key={r.label} className="py-2 flex justify-between gap-2"><span className="text-sm text-[var(--dim)]">{r.label}</span><span className={`text-sm font-bold text-right ${r.changed?"text-[var(--accent)]":""}`}>{r.val}</span></div>))}</div>{(f.balance-(Number(fundAmt[f.id])||0))<0 && <p className="text-sm text-[var(--red)]">El retiro deja el fondo en negativo.</p>}<div className="flex gap-2"><button type="button" aria-label={`Confirmar el retiro de ${f.name}`} className={btnPrimary+" flex-1"} disabled={fundMove.isPending} onClick={()=>{ fundMove.mutate({fundId:f.id,type:"withdrawal",amount:Number(fundAmt[f.id])||0,accountId:Number(fundAcc[f.id])}); }}>{fundMove.isPending?"Guardando…":"Retirar"}</button><button type="button" aria-label={`Corregir el retiro de ${f.name}`} className={btnGhost} onClick={()=>setFundWithdrawPreviewId(null)}>Corregir</button></div></div>)}<button aria-label={`Eliminar fondo ${f.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>setConfirmDelFundId(confirmDelFundId===f.id?null:f.id)}>Eliminar fondo</button>{confirmDelFundId===f.id && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar este fondo?</p><p className="text-xs text-[var(--dim)] mt-1">«{f.name}» por <b className="whitespace-nowrap">{money2(f.balance)}</b>. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la eliminación del fondo ${f.name}`} className={btnPrimary} disabled={delFund.isPending} onClick={()=>delFund.mutate(f.id)}>{delFund.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label="Cancelar la eliminación del fondo" className={btnGhost} onClick={()=>setConfirmDelFundId(null)}>Cancelar</button></div></div>}</CollapsibleCard>; })}
              {data.funds.length===0 && <Empty title="Sin fondos" body="Cree el fondo de emergencia." />}
            </div>
          </section>
        )}

        {effTab==="aportaciones" && (
          <section className="max-w-2xl">
            {s.contributions.length===0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
              <h2 className="font-display font-bold text-lg">Reparto del gasto — {s.currentMonth}</h2>
              <p className="text-sm text-[var(--dim)] mt-1">Base del reparto: <b className="whitespace-nowrap text-[var(--text)]">{money2(s.sharedExpenseMonth)}</b> · Regla: {hh.contributionRule==="equal"?"Partes iguales":"Proporcional al ingreso"}</p>
              <div className="bg-[var(--surface2)] rounded-2xl p-4 sm:p-5 mt-3 text-sm">{s.contributionsNote}</div>
              <Empty title="Sin adultos para repartir" body="Agregue adultos en Perfiles." />
              <Help><b>Capacidad</b> = ingreso − compromisos.</Help>
            </div>
            ) : (
            <CollapsibleCard
              title={<h2 className="font-display font-bold text-lg">Reparto del gasto — {s.currentMonth}</h2>}
              above={<>
              <p className="text-sm text-[var(--dim)] mt-1">Base del reparto: <b className="whitespace-nowrap text-[var(--text)]">{money2(s.sharedExpenseMonth)}</b> · Regla: {hh.contributionRule==="equal"?"Partes iguales":"Proporcional al ingreso"}</p>
              <div className="bg-[var(--surface2)] rounded-2xl p-4 sm:p-5 mt-3 text-sm">{s.contributionsNote}</div>
              <p className="text-sm mt-1">Total a repartir: <b className="whitespace-nowrap">{money2(sumContributions(s.contributions).total)}</b> · {s.contributions.length} {s.contributions.length===1?"persona":"personas"}</p>
              </>}
              below={<Help><b>Capacidad</b> = ingreso − compromisos.</Help>}
            >
              <div className="divide-y divide-[var(--border)] mt-3">
                {s.contributions.map(c=><div key={c.profileId} className="py-2 flex justify-between gap-2"><div><p className="font-semibold">{c.name}</p><p className="text-xs text-[var(--dim)]">Ingreso {money(c.income)} · Capacidad {money(c.capacity)}{hh.contributionRule==="proportional"?` · ${c.pctShare}% del ingreso conjunto`:""}</p>{c.shouldPay>c.capacity && c.capacity>=0 && <p className="text-xs text-[var(--red)]">Supera su capacidad de pago.</p>}</div><p className="font-display font-extrabold text-base whitespace-nowrap shrink-0">{money2(c.shouldPay)}</p></div>)}
              </div>
            </CollapsibleCard>
            )}
          </section>
        )}

        {effTab==="metas" && (
          <section>
            <CollapsibleCard title={<h2 className="font-display font-bold text-lg">Nueva meta</h2>} above={data.goals.length>0 ? <p className="text-sm text-[var(--dim)] mt-1">{data.goals.length} {data.goals.length===1?"meta":"metas"} · {money(data.goals.reduce((s,g)=>s+g.savedAmount,0))} ahorrado de {money(data.goals.reduce((s,g)=>s+g.targetAmount,0))}</p> : undefined} defaultOpen={data.goals.length===0} open={newGoalOpen ?? undefined} onToggle={newGoalOpen===null?undefined:()=>setNewGoalOpen((v)=>!(v ?? false))} toggleLabel="nueva meta">
            <button type="button" className={btnPrimary+" w-full mb-4"} onClick={()=>setPlanWizardOpen(true)}>Arma su plan financiero</button>
            <form className="space-y-3" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!goalName||!(Number(goalTarget)>0)) return; const months=Number(goalMonths); if(!months||months<1||months>120){ setGoalFormError("Escriba el plazo en meses (1 a 120)."); return; } const due=Number(goalDueDay); if(goalDueDay && (due<1||due>28)){ setGoalFormError("El día del mes debe ser entre 1 y 28."); return; } const saved=Number(goalSaved)||0; if(saved>0){ const notice=requiredInitialAccountNotice(goalInitialAcc); if(notice){ setGoalFormError(notice); return; } } setGoalFormError(""); saveGoalWithPlan.mutate();}}>
              <div className="grid md:grid-cols-4 gap-2 items-end">
              <div><Label htmlFor="goal-name">Nombre de la meta</Label><input id="goal-name" aria-label="Nombre de la meta" required className={inputCls} value={goalName} onChange={e=>setGoalName(e.target.value)} placeholder="Ej. Vacaciones" /></div>
              <div><Label htmlFor="goal-target">Monto objetivo ($)</Label><input id="goal-target" aria-label="Monto objetivo de la meta" type="number" min="1" required className={inputCls} value={goalTarget} onChange={e=>setGoalTarget(e.target.value)} /></div>
              <div><Label htmlFor="goal-saved">Ya ahorrado ($)</Label><input id="goal-saved" aria-label="Ya ahorrado en la meta" type="number" min="0" className={inputCls} value={goalSaved} onChange={e=>{setGoalSaved(e.target.value);setGoalFormError("");}} /></div>
              <div><Label htmlFor="goal-date">Fecha objetivo</Label><input id="goal-date" aria-label="Fecha objetivo de la meta" type="date" className={inputCls} value={goalDate} onChange={e=>setGoalDate(e.target.value)} /></div>
              </div>
              <div><Label htmlFor="goal-importance">Importancia (1 a 5)</Label><select id="goal-importance" aria-label="Importancia de la meta, de 1 a 5" className={inputCls} value={goalImportance} onChange={e=>setGoalImportance(e.target.value)}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} — {importanceLabel(n)}</option>)}</select><p className="text-xs text-[var(--dim)] mt-1">Con 5, la meta se fija arriba de Inicio.</p></div>
              <div className="rounded-2xl bg-[var(--surface2)] p-3 space-y-2">
                <p className="font-display font-bold text-sm">Plan de ahorro</p>
                <p className="text-xs text-[var(--dim)]">Toda meta nace con su plan: el dinero se aparta en un fondo separado y usted recibe avisos de cada aportación.</p>
                <div className="grid md:grid-cols-3 gap-2 items-end">
                  <div><Label htmlFor="goal-monthly">Aporte mensual ($)</Label><input id="goal-monthly" aria-label="Aporte mensual del plan" type="number" min="1" className={inputCls} value={goalMonthly} onChange={e=>setGoalMonthly(e.target.value)} placeholder="Se calcula del plazo" /></div>
                  <div><Label htmlFor="goal-months">Plazo (meses)</Label><input id="goal-months" aria-label="Plazo del plan en meses" type="number" min="1" max="120" required className={inputCls} value={goalMonths} onChange={e=>setGoalMonths(e.target.value)} placeholder="Ej. 12" /></div>
                  <div><Label htmlFor="goal-dueday">Día del mes</Label><input id="goal-dueday" aria-label="Día del mes del aporte" type="number" min="1" max="28" className={inputCls} value={goalDueDay} onChange={e=>setGoalDueDay(e.target.value)} placeholder={`Día ${data.household.cutoffDay}`} /></div>
                </div>
                {(Number(goalSaved)||0)>0 && <div><Label htmlFor="goal-initial-acc">¿De qué cuenta es ese dinero?</Label><select id="goal-initial-acc" aria-label="Cuenta de donde es el dinero ya ahorrado" className={inputCls} value={goalInitialAcc} onChange={e=>{setGoalInitialAcc(e.target.value);setGoalFormError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>}
              </div>
              {goalFormError && <p className="text-sm text-[var(--red)]">{goalFormError}</p>}
              <button className={btnPrimary} disabled={saveGoalWithPlan.isPending}>{saveGoalWithPlan.isPending?"Guardando…":"Crear meta con plan"}</button>
            </form>
            </CollapsibleCard>
            {analyzePlan.isPending && <p className="text-sm text-[var(--dim)] mt-3">Calculando el plan…</p>}
            {planError && <p className="text-sm text-[var(--red)] mt-3">{planError}</p>}
            {planResult && planGoalId!==null && (()=>{ const g=data.goals.find(x=>x.id===planGoalId); if(!g) return null; const r=planResult; return (
            <CollapsibleCard className="mt-3" defaultOpen title={<h2 className="font-display font-bold text-lg">Plan de ahorro · {g.name}</h2>}>
              <p className="text-sm mt-1">Aporte mensual: <b className="whitespace-nowrap">{money(r.monthlyAmount)}</b> durante <b>{r.months} meses</b> · día {r.dueDay} de cada mes.</p>
              <p className="text-sm text-[var(--dim)] mt-1">Ingreso mensual {money(r.income)} · Compromisos fijos {money(r.fixedCommitments)} · Gasto promedio {money(r.avgMonthlyExpense)} · Sobrante {money(r.surplus)}.</p>
              {r.feasible
                ? <p className="text-sm mt-2 text-[var(--green)] font-semibold">Sí le alcanza. Después del aporte sobran {money(r.surplus - r.monthlyAmount)} al mes.</p>
                : <><p className="text-sm mt-2 text-[var(--red)] font-semibold">No alcanza con {money(r.monthlyAmount)} al mes. Faltan {money(r.monthlyAmount - r.surplus)} al mes.</p>
                  {r.cutSuggestions.length>0 && <div className="mt-2"><p className="text-sm font-semibold">De dónde puede salir:</p>{r.cutSuggestions.map(c=><p key={c.categoryId??c.name} className="text-sm text-[var(--dim)]">· {c.name}: gasta {money(c.avgMonthly)} al mes. Recortar {money(c.suggestedCut)}.</p>)}</div>}
                  {r.extendedMonths>0 && <p className="text-sm mt-2">O alargue el plazo a {r.extendedMonths} meses, con {money(r.extendedMonthly)} al mes.</p>}</>}
              <div className="flex flex-wrap gap-2 items-end mt-3">
                <div><Label htmlFor="plan-months">Plazo (meses)</Label><input id="plan-months" aria-label="Plazo del plan en meses" type="number" min="1" max="120" className={inputCls} value={planMonths} onChange={e=>setPlanMonths(e.target.value)} /></div>
                {g.savedAmount>0 && <div><Label htmlFor="plan-initial-acc">¿De qué cuenta es ese dinero?</Label><select id="plan-initial-acc" aria-label="Cuenta de donde es el dinero ya ahorrado" className={inputCls} value={planInitialAcc} onChange={e=>{setPlanInitialAcc(e.target.value);setPlanInitialAccError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>}
                <button type="button" className={btnGhost} onClick={()=>analyzePlan.mutate({goalId:g.id,months:Number(planMonths)||undefined})}>Recalcular</button>
                <button type="button" className={btnPrimary} onClick={()=>{ if(g.savedAmount>0){ const notice=requiredInitialAccountNotice(planInitialAcc); if(notice){ setPlanInitialAccError(notice); return; } } acceptPlan.mutate({goalId:g.id,monthlyAmount:r.monthlyAmount,months:r.months,dueDay:r.dueDay,initialAccountId:planInitialAcc?Number(planInitialAcc):null}); }}>Aceptar plan</button>
                {r.extendedMonths>0 && <button type="button" className={btnPrimary} onClick={()=>{ if(g.savedAmount>0){ const notice=requiredInitialAccountNotice(planInitialAcc); if(notice){ setPlanInitialAccError(notice); return; } } acceptPlan.mutate({goalId:g.id,monthlyAmount:r.extendedMonthly,months:r.extendedMonths,dueDay:r.dueDay,initialAccountId:planInitialAcc?Number(planInitialAcc):null}); }}>Aceptar con {r.extendedMonths} meses</button>}
                <button type="button" className={btnGhost} onClick={()=>{setPlanResult(null);setPlanGoalId(null);setPlanError("");setPlanInitialAcc("");setPlanInitialAccError("");}}>Cerrar</button>
              </div>
              {planInitialAccError && <p className="text-sm text-[var(--red)] mt-2">{planInitialAccError}</p>}
              <p className="text-xs text-[var(--dim)] mt-2">Al aceptar, el dinero se aparta en un fondo separado de la meta y usted recibe avisos de cada aportación.</p>
            </CollapsibleCard>); })()}
            {adjError && <p className="text-sm text-[var(--red)] mt-3">{adjError}</p>}
            {adjAnalysis && adjGoalId!==null && (()=>{ const g=data.goals.find(x=>x.id===adjGoalId); if(!g) return null; const a=adjAnalysis; return (
            <CollapsibleCard className="mt-3" defaultOpen title={<h2 className="font-display font-bold text-lg">Ajuste de gastos · {g.name} · {fmtMonth(a.month)}</h2>}>
              {(()=>{ const plan=data.goalPlans.find(p=>p.goalId===g.id); if(!plan) return null; const short=planMonthShortfall(plan,data.fundMovements,s.currentMonth); return <p className="text-sm mt-1">El plan pide <b className="whitespace-nowrap">{money(plan.monthlyAmount)}</b>/mes y este mes lleva <b className="whitespace-nowrap">{money(plan.contributedThisMonth)}</b> aportado. Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(short)}</b></p>; })()}
              {a.noBudget.length>0 && <><p className="text-sm mt-2 font-semibold">Sin presupuesto este mes:</p>{a.noBudget.map(nb=>(<div key={nb.categoryId} className="mt-1"><p className="text-sm text-[var(--dim)]">· {nb.name}: {money(nb.spent)} este mes · promedio {money(nb.avg3)}.</p>{nb.avg3>0 && nb.spent>nb.avg3 ? <p className="text-sm mt-1 font-semibold text-[var(--gold-text)]">Recomendación: bajarlo a {money(nb.avg3)} libera {money(nb.spent-nb.avg3)} para la meta. Límite sugerido para monitorearlo: {money(nb.suggested)}.</p> : <p className="text-sm mt-1 text-[var(--dim)]">Límite sugerido para monitorearlo: {money(nb.suggested)}.</p>}<button type="button" className={btnPrimary+" mt-1"} onClick={()=>openBudgetForm(nb.categoryId,a.month,nb.suggested)}>Crear presupuesto para {nb.name}</button></div>))}</>}
              {a.totalOver>0 ? <>
                <p className="text-sm mt-1"><b>{a.overruns[0]?.name}</b> se pasó <b className="whitespace-nowrap text-[var(--red)]">{money(a.totalOver)}</b> de su presupuesto.</p>
                <p className="text-sm mt-2 font-semibold">De dónde se recorta:</p>
                {a.cuts.map(c=><div key={c.budgetId} className="flex items-center gap-2 mt-1"><p className="text-sm flex-1">· {c.name}: margen {money(c.slack)}.</p><input aria-label={`Recortar de ${c.name}`} type="number" min="0" max={c.slack} className={inputCls+" w-28"} value={adjCuts[c.budgetId]??String(c.cut)} onChange={e=>setAdjCuts({...adjCuts,[c.budgetId]:e.target.value})} /><span className="text-xs text-[var(--dim)]">queda en {money(Math.max(0, c.newBudget + c.cut - (Number(adjCuts[c.budgetId]??c.cut)||0)))}</span></div>)}
                {a.uncovered>0 && <p className="text-sm mt-1 text-[var(--red)]">Faltan {money(a.uncovered)} aun con los recortes.</p>}
                <p className="text-sm mt-1">{a.extendedMonths>0 ? `Su aportación cambia a ${money(a.newMonthlyAmount)} al mes y el plazo se alarga a ${a.extendedMonths} meses.` : a.monthlyDelta>0 ? `Su aportación sube a ${money(a.newMonthlyAmount)} al mes.` : "Su aportación a la meta no cambia."}</p>
                <p className="text-sm mt-1">{a.coversAll ? "Con este ajuste, sus gastos fijos, sus presupuestos y su aportación quedan cubiertos." : "Aun con este ajuste no alcanza para cubrir todo: se propone alargar el plazo de la meta."}</p>
              </> : <p className="text-sm mt-1 text-[var(--green)] font-semibold">Este mes ninguna categoría se pasó de su presupuesto.</p>}
              {a.totalSurplus>0 && <><p className="text-sm mt-2 font-semibold">Sobrante del mes:</p>{a.surplus.map(s=><p key={s.budgetId} className="text-sm text-[var(--dim)]">· {s.name}: sobran {money(s.slack)}.</p>)}<p className="text-sm mt-1">Puede mover {money(a.totalSurplus)} al fondo de la meta.</p></>}
              <div className="flex flex-wrap gap-2 mt-3">
                {a.totalOver>0 && <button type="button" className={btnPrimary} onClick={()=>proposeAdj.mutate({goalId:g.id,kind:"recorte",cuts:a.cuts.map(c=>({budgetId:c.budgetId,amount:Number(adjCuts[c.budgetId]??c.cut)||0}))})}>Proponer ajuste</button>}
                {a.totalSurplus>0 && <button type="button" className={btnPrimary} onClick={()=>proposeAdj.mutate({goalId:g.id,kind:"sobrante",cuts:a.surplus.map(s=>({budgetId:s.budgetId,amount:s.slack}))})}>Proponer mover sobrante</button>}
                <button type="button" className={btnGhost} onClick={()=>{setAdjAnalysis(null);setAdjGoalId(null);setAdjError("");}}>Cerrar</button>
              </div>
              <p className="text-xs text-[var(--dim)] mt-2">Al proponer, se envía un aviso con la campanita antes de mover nada. Nada se aplica sin que usted lo acepte.</p>
            </CollapsibleCard>); })()}
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.goals.map(g=>{ const plan=data.goalPlans.find(p=>p.goalId===g.id); const monthsLeft=g.targetDate?Math.max(1,Math.round((new Date(g.targetDate).getTime()-Date.now())/(1000*60*60*24*30))):null; const need=monthsLeft?Math.ceil((g.targetAmount-g.savedAmount)/monthsLeft):null; const pShort=plan?planMonthShortfall(plan,data.fundMovements,s.currentMonth):0; const pPrior=plan?planPriorSurplus(plan,data.fundMovements,s.currentMonth):0; const pCum=plan?planCumulativeContributed(plan,data.fundMovements):0; return <CollapsibleCard key={g.id} title={<p className="font-display font-bold text-lg">{g.name}{!plan && <span className="ml-2 text-xs font-semibold text-[var(--gold-text)]">Sin plan</span>} <span className="text-xs font-normal text-[var(--dim)]">{g.visibility==="shared"?"Compartida":"Privada"}</span></p>} above={<p className="text-sm text-[var(--dim)] mt-1">{money(g.savedAmount)} de {money(g.targetAmount)} · {g.pct}%{(()=>{ const nl=need!==null && need>0 ? need : plan ? plan.monthlyAmount : null; return nl!==null ? ` · faltan ${money(nl)}/mes` : ""; })()}</p>} toggleLabel={`la meta ${g.name}`} defaultOpen={data.spendingAdjustments.some(a=>a.goalId===g.id && a.status==="propuesto")}><p className="text-sm mt-1"><span className="font-semibold">★ {g.importance ?? 3} de 5</span><button type="button" aria-label={`Cambiar la importancia de ${g.name}`} className="text-xs underline font-bold ml-1" onClick={()=>{setImpEditGoalId(impEditGoalId===g.id?null:g.id); setImpEditValue(String(g.importance ?? 3));}}>Cambiar</button></p>{impEditGoalId===g.id && renderImpEditor(g)}<div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div>{g.targetDate && <p className="text-xs text-[var(--dim)] mt-1">Meta {fmtDate(g.targetDate)}{need!==null && need>0?` · faltan ${money(need)}/mes`:""}</p>}{plan && <><div className="flex gap-2 mt-3"><input aria-label={`Abonar a ${g.name}`} type="number" placeholder="$ Abonar" className={inputCls} value={goalAdd[g.id]||""} onChange={e=>setGoalAdd({...goalAdd,[g.id]:e.target.value})} /><button aria-label={`Abonar a la meta ${g.name}`} className={btnPrimary} onClick={()=>{ const amt=Number(goalAdd[g.id])||0; if(amt<=0) return; const notice=requiredGoalAccountNotice(goalAddAcc[g.id]); if(notice){ setGoalAddAccError(a=>({...a,[g.id]:notice})); return; } addGoal.mutate({id:g.id,amount:amt,accountId:Number(goalAddAcc[g.id])}); }}>Abonar</button><button type="button" aria-label={`Retirar de la meta ${g.name}`} className={btnGhost} onClick={()=>{setWithdrawGoalId(withdrawGoalId===g.id?null:g.id);setWithdrawGoalAmt("");setWithdrawGoalAcc("");setWithdrawGoalAccError("");}}>Retirar</button></div><div className="mt-2"><Label htmlFor={`goal-add-acc-${g.id}`}>¿De dónde se descuenta?</Label><select id={`goal-add-acc-${g.id}`} aria-label={`Cuenta de donde se descuenta el abono a ${g.name}`} className={inputCls} value={goalAddAcc[g.id]||""} onChange={e=>{setGoalAddAcc({...goalAddAcc,[g.id]:e.target.value});setGoalAddAccError(a=>({...a,[g.id]:""}));}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{(()=>{ const pv = contributionFxPreview(goalAdd[g.id]||"", goalAddAcc[g.id]||""); return pv ? <p className="text-xs text-[var(--dim)] mt-1">{pv}</p> : null; })()}{goalAddAccError[g.id] && <p className="text-sm text-[var(--red)] mt-1">{goalAddAccError[g.id]}</p>}{addGoal.error && <p className="text-sm text-[var(--red)] mt-1">{String(addGoal.error)}</p>}{withdrawGoalId===g.id && goalWithdrawPreviewId!==g.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); const amt=Number(withdrawGoalAmt); if(!amt||amt<=0) return; const notice=requiredGoalReturnAccountNotice(withdrawGoalAcc); if(notice){ setWithdrawGoalAccError(notice); return; } setGoalWithdrawPreviewId(g.id);}}><p className="font-display font-bold text-sm">Retirar de {g.name}</p><div><Label htmlFor={`wg-amt-${g.id}`}>Importe ($)</Label><input id={`wg-amt-${g.id}`} autoFocus aria-label={`Importe a retirar de la meta ${g.name}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={withdrawGoalAmt} onChange={e=>setWithdrawGoalAmt(e.target.value)} /></div><div><Label htmlFor={`wg-acc-${g.id}`}>¿A qué cuenta vuelve?</Label><select id={`wg-acc-${g.id}`} aria-label="Cuenta a la que vuelve el dinero retirado de la meta" className={inputCls} value={withdrawGoalAcc} onChange={e=>{setWithdrawGoalAcc(e.target.value);setWithdrawGoalAccError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>{withdrawGoalAccError && <p className="text-sm text-[var(--red)]">{withdrawGoalAccError}</p>}{withdrawGoal.error && <p className="text-sm text-[var(--red)]">{String(withdrawGoal.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={withdrawGoal.isPending||!withdrawGoalAmt}>{withdrawGoal.isPending?"Guardando…":"Guardar retiro"}</button><button type="button" className={btnGhost} onClick={()=>setWithdrawGoalId(null)}>Cancelar</button></div></form>)}{goalWithdrawPreviewId===g.id && (<div className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" aria-label={`Revisión del retiro de la meta ${g.name}`}><p className="font-display font-bold text-sm">Revise antes de retirar</p><div className="divide-y divide-[var(--border)]">{[{label:"Meta",val:g.name,changed:false},{label:"Importe a retirar",val:money2(Number(withdrawGoalAmt)||0),changed:false},{label:"Vuelve a la cuenta",val:data.accounts.find(a=>a.id===Number(withdrawGoalAcc))?.name ?? "—",changed:false},{label:"Ahorrado",val:`${money2(g.savedAmount)} → ${money2(g.savedAmount-(Number(withdrawGoalAmt)||0))}`,changed:true}].map(r=>(<div key={r.label} className="py-2 flex justify-between gap-2"><span className="text-sm text-[var(--dim)]">{r.label}</span><span className={`text-sm font-bold text-right ${r.changed?"text-[var(--accent)]":""}`}>{r.val}</span></div>))}</div>{(g.savedAmount-(Number(withdrawGoalAmt)||0))<0 && <p className="text-sm text-[var(--red)]">El retiro deja la meta en negativo.</p>}<div className="flex gap-2"><button type="button" aria-label={`Confirmar el retiro de la meta ${g.name}`} className={btnPrimary+" flex-1"} disabled={withdrawGoal.isPending} onClick={()=>{ withdrawGoal.mutate({id:g.id,amount:Number(withdrawGoalAmt)||0,accountId:Number(withdrawGoalAcc)}); }}>{withdrawGoal.isPending?"Guardando…":"Retirar"}</button><button type="button" aria-label={`Corregir el retiro de la meta ${g.name}`} className={btnGhost} onClick={()=>setGoalWithdrawPreviewId(null)}>Corregir</button></div></div>)}</>}{plan ? <div className="mt-3 rounded-2xl bg-[var(--surface2)] p-3"><p className="font-display font-bold text-sm">Plan de ahorro · {money(plan.monthlyAmount)}/mes · día {plan.dueDay}</p><p className="text-xs text-[var(--dim)] mt-1">Este mes: {money(plan.contributedThisMonth)} de {money(plan.monthlyAmount)} · Esperado hasta hoy: {money(plan.expectedByNow)}</p><div className="h-2 bg-[var(--surface)] rounded-full mt-2"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${Math.min(100, plan.monthlyAmount>0? Math.round(plan.contributedThisMonth/plan.monthlyAmount*100):0)}%`}} /></div><p className="text-xs mt-1">{plan.status==="cumplido" ? "Meta cumplida." : plan.atRisk ? <span className="text-[var(--red)] font-semibold">En riesgo: con el ritmo actual se cumpliría después de la fecha.</span> : plan.onTrack ? `Al corriente. Se cumple en ${fmtMonth(plan.projectedDate)}.` : `Atrasado. Se cumple en ${fmtMonth(plan.projectedDate)}.`}</p>{plan.status!=="cumplido" && (plan.monthsByPlan ?? 0)>0 && <p className="text-xs mt-1">Llegas en {plan.monthsByPlan} {(plan.monthsByPlan ?? 0)===1?"mes":"meses"}{g.savedAmount>0 && (plan.monthsFromZero ?? 0)>0 ? ` · Desde cero: ${plan.monthsFromZero} meses` : ""}</p>}{plan.status!=="cumplido" && <p className="text-xs mt-1">Acumulado: {money(pCum)} de {money(plan.expectedByNow)} esperado hasta hoy.</p>}{plan.status!=="cumplido" && pPrior>0 && <p className="text-xs mt-1">Llevas {money(pPrior)} adelantado de meses anteriores.</p>}{plan.status!=="cumplido" && pShort>0 && <p className="text-xs mt-1">Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(pShort)}</b></p>}<button type="button" aria-label={`Revisar ajuste de gastos de ${g.name}`} className={btnGhost+" mt-2 ml-2"} onClick={()=>analyzeAdj.mutate(g.id)}>Revisar ajuste</button>
{data.spendingAdjustments.filter(a=>a.goalId===g.id && a.status==="propuesto").map(a=>(
<div key={a.id} className="mt-3 rounded-2xl border border-[var(--gold)] bg-[var(--surface2)] p-3">
<p className="font-display font-bold text-sm">{a.kind==="recorte" ? "Ajuste de gastos propuesto" : "Sobrante para su meta"} · {fmtMonth(a.month)}</p>
{a.kind==="recorte" ? <>
<p className="text-xs mt-1"><b>{a.overCategoryName}</b> se pasó <b className="whitespace-nowrap text-[var(--red)]">{money(a.overAmount)}</b> de su presupuesto.</p>
{a.cuts.map(c=>(
<div key={c.budgetId??c.name} className="flex items-center gap-2 mt-1"><p className="text-xs flex-1">· {c.name}</p><input aria-label={`Recortar de ${c.name}`} type="number" min="0" className={inputCls+" w-24"} value={adjPropCuts[a.id]?.[c.budgetId??0]??String(c.amount)} onChange={e=>setAdjPropCuts({...adjPropCuts,[a.id]:{...(adjPropCuts[a.id]||{}),[c.budgetId??0]:e.target.value}})} /></div>
))}
<p className="text-xs mt-1">{a.newMonthlyAmount!=null && a.newMonthlyAmount!==plan.monthlyAmount ? `Su aportación cambia a ${money(a.newMonthlyAmount)} al mes.` : "Su aportación a la meta no cambia."}{a.extendedMonths>0 ? ` El plazo se alarga a ${a.extendedMonths} meses.` : ""}</p>
<p className="text-xs mt-1">{a.coversAll ? "Con este ajuste, sus gastos fijos, sus presupuestos y su aportación quedan cubiertos." : "Aun con este ajuste no alcanza para cubrir todo: se propone alargar el plazo de la meta."}</p>
<p className="text-xs mt-1 text-[var(--dim)]">Si no lo acepta, la meta se atrasará. {a.note}</p>
</> : <>
<p className="text-xs mt-1">Este mes gastó menos de lo planeado: sobran <b className="whitespace-nowrap">{money(a.overAmount)}</b> ({a.cuts.map(c=>`${c.name} ${money(c.amount)}`).join(", ")}).</p>
<p className="text-xs mt-1">Puede mover ese sobrante al fondo de la meta para llegar antes. Nada se mueve sin que usted lo acepte.</p>
</>}
<div className="flex gap-2 mt-2">
<button type="button" className={btnPrimary} onClick={()=>acceptAdj.mutate({id:a.id,cuts:a.cuts.filter(c=>c.budgetId!=null).map(c=>({budgetId:c.budgetId as number,amount:Number(adjPropCuts[a.id]?.[c.budgetId as number]??c.amount)||0}))})}>{a.kind==="recorte" ? "Aceptar ajuste" : "Mover a la meta"}</button>
<button type="button" className={btnGhost} onClick={()=>rejectAdj.mutate(a.id)}>Rechazar</button>
</div>
</div>
))}
</div> : <button type="button" aria-label={`Armar plan de ahorro para ${g.name}`} className={btnGhost+" mt-3"} onClick={()=>analyzePlan.mutate({goalId:g.id})}>Armar plan de ahorro</button>}<button aria-label={`Eliminar meta ${g.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>setConfirmDelGoalId(confirmDelGoalId===g.id?null:g.id)}>Eliminar</button>{confirmDelGoalId===g.id && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar esta meta?</p><p className="text-xs text-[var(--dim)] mt-1">«{g.name}» por <b className="whitespace-nowrap">{money2(g.targetAmount)}</b>. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la eliminación de la meta ${g.name}`} className={btnPrimary} disabled={delGoal.isPending} onClick={()=>delGoal.mutate(g.id)}>{delGoal.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label="Cancelar la eliminación de la meta" className={btnGhost} onClick={()=>setConfirmDelGoalId(null)}>Cancelar</button></div></div>}</CollapsibleCard>; })}
              {data.goals.length===0 && <Empty title="Sin metas" body="Cree su primera meta." action={{label:"+ Agregar meta",onClick:()=>focusField("goal-target")}} />}
            </div>
          </section>
        )}

        {effTab==="acuerdos" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 items-start">
            <div className="space-y-2">
              <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();setShowAgPreview(true);}}>
                <h2 className="font-display font-bold text-lg">Nueva propuesta</h2>
                <div><Label htmlFor="ag-title">Título del acuerdo</Label><input id="ag-title" aria-label="Título del acuerdo" required className={inputCls} value={agTitle} onChange={e=>setAgTitle(e.target.value)} placeholder="Ej. Toda deuda nueva requiere aviso previo" /></div>
                <div><Label htmlFor="ag-desc">Descripción</Label><textarea id="ag-desc" aria-label="Descripción del acuerdo" className={inputCls} rows={3} value={agDesc} onChange={e=>setAgDesc(e.target.value)} /></div>
                {!showAgPreview && <button className={btnPrimary+" w-full"}>Proponer acuerdo</button>}
              {showAgPreview && <div aria-label="Revisión de la propuesta del acuerdo" className="mt-3 border border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="font-bold text-sm">Revise antes de proponer</p><div className="mt-2 space-y-1 text-sm"><p className="flex justify-between gap-2"><span>Título</span><b>{agTitle}</b></p>{agDesc && <p className="text-xs text-[var(--dim)]">{agDesc}</p>}<p className="flex justify-between gap-2"><span>Regla del hogar</span><b>{(data.household?.approvalRule||"unanimous")==="unanimous"?"Unánime":"Mayoría"}</b></p></div><p className="font-bold text-sm mt-3">Qué pasa al proponer:</p><p className="text-sm mt-1">El acuerdo queda como Propuesta, pendiente de votación.</p>{(data.household?.approvalRule||"unanimous")==="unanimous"?<p className="text-sm mt-1">Se aprueba solo si todos los adultos votan Sí; un solo No lo rechaza.</p>:<p className="text-sm mt-1">Se aprueba con {Math.floor(data.profiles.filter(p=>p.kind==="adult").length/2)+1} votos Sí de {data.profiles.filter(p=>p.kind==="adult").length} adultos; con {Math.floor(data.profiles.filter(p=>p.kind==="adult").length/2)+1} votos No se rechaza.</p>}<p className="text-sm mt-1">Cada integrante adulto puede votar Sí o No.</p><div className="flex gap-2 mt-3"><button type="button" aria-label="Confirmar la propuesta del acuerdo" className={btnPrimary} disabled={saveAg.isPending} onClick={()=>saveAg.mutate()}>{saveAg.isPending?"Proponiendo…":"Proponer acuerdo"}</button><button type="button" aria-label="Corregir la propuesta del acuerdo" className={btnGhost} onClick={()=>setShowAgPreview(false)}>Corregir</button></div></div>}
              </form>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <p className="text-sm">Vota como <b>{(()=>{ const ownAdult=data.profiles.find(pp=>pp.id===(data.myProfileId ?? null) && pp.kind==="adult") ?? (me && me.kind==="adult" ? me : null); return ownAdult ? fullName(ownAdult) : "—"; })()}</b>.</p>
                <p className="text-xs text-[var(--dim)] mt-2">Regla del hogar: <b>{hh.approvalRule==="unanimous"?"Unánime":"Mayoría"}</b>. Cada quien vota con su propio perfil adulto.</p>
              </div>
              <div className="flex gap-2 text-center text-sm">
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="proposal").length}</b>Propuestas</div>
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="approved").length}</b>Aprobados</div>
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="rejected").length}</b>Rechazados</div>
              </div>
            </div>
            <div className="space-y-2">
              {data.agreements.map(a=>{
                const adults=data.profiles.filter(p=>p.kind==="adult");
                const myAdultId=(data.profiles.find(pp=>pp.id===(data.myProfileId ?? null) && pp.kind==="adult") ?? (me && me.kind==="adult" ? me : null))?.id ?? null;
                const myVote=myAdultId==null?undefined:a.votes.find(v=>v.profileId===myAdultId)?.vote;
                const myName=myAdultId==null?"Usted":data.profiles.find(p=>p.id===myAdultId)?.name||"Usted";
                const approves=a.votes.filter(v=>v.vote==="approve"&&v.profileId!==myAdultId).length;
                const rejects=a.votes.filter(v=>v.vote==="reject"&&v.profileId!==myAdultId).length;
                const rule=data.household?.approvalRule||"unanimous";
                const need=Math.floor(adults.length/2)+1;
                const newRejects=rejects+1;
                const willReject=rule==="unanimous"?newRejects>0:newRejects>=need;
                const totalSi=approves+(myVote==="approve"?1:0);
                const totalNo=rejects+(myVote==="reject"?1:0);
                const votesLine=a.votes.length===0?"sin votos":a.votes.map(v=>`${data.profiles.find(p=>p.id===v.profileId)?.name||"Perfil"}: ${v.vote==="approve"?"Sí":"No"}`).join(" · ");
                const otherVotes=a.votes.filter(v=>v.profileId!==myAdultId).map(v=>`${data.profiles.find(p=>p.id===v.profileId)?.name||"Perfil"}: ${v.vote==="approve"?"Sí":"No"}`).join(" · ");
                const voterLine=myVote?`${myName} ya votó ${myVote==="approve"?"Sí":"No"}.`:`${myName} aún no vota.`;
                return <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><div className="flex justify-between gap-2"><b className="font-display">{a.title}</b><span className={`text-xs rounded-full px-2.5 py-1 font-bold shrink-0 ${a.status==="approved"?"bg-green-100 text-green-800":a.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{a.status==="approved"?"Aprobado":a.status==="rejected"?"Rechazado":"Propuesta"}</span></div>{a.description && <p className="text-sm text-[var(--dim)] mt-1">{a.description}</p>}<p className="text-xs text-[var(--dim)] mt-2">Votos: {votesLine}</p><div className="flex gap-2 mt-3"><button aria-label={`Aprobar acuerdo ${a.title}`} className={btnPrimary} disabled={myAdultId==null} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"approve"})}>Votar Sí</button><button aria-label={`Rechazar acuerdo ${a.title}`} className={btnGhost} disabled={myAdultId==null} onClick={()=>setRejectAgreementPreviewId(a.id)}>Votar No</button>{deleteAgreementPreviewId!==a.id && <button aria-label={`Eliminar acuerdo ${a.title}`} className="text-xs underline text-[var(--red)] ml-auto" onClick={()=>setDeleteAgreementPreviewId(a.id)}>Eliminar</button>}</div>{myAdultId==null && <p className="text-xs text-[var(--dim)] mt-1">Sin perfil adulto no se puede votar.</p>}{rejectAgreementPreviewId===a.id && <div aria-label={`Revisión del voto No al acuerdo ${a.title}`} className="mt-3 border border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="font-bold text-sm">Revise antes de votar No</p><div className="mt-2 space-y-1 text-sm"><p className="flex justify-between gap-2"><span>Acuerdo</span><b>{a.title}</b></p>{a.description && <p className="text-xs text-[var(--dim)]">{a.description}</p>}<p className="flex justify-between gap-2"><span>Vota como</span><b>{myName}</b></p><p className="flex justify-between gap-2"><span>Votos hasta ahora</span><b>{totalSi+totalNo===0?"sin votos":`${totalSi} Sí · ${totalNo} No`}</b></p><p className="text-xs text-[var(--dim)]">{otherVotes?`${otherVotes}. ${voterLine}`:voterLine}</p><p className="flex justify-between gap-2"><span>Regla del hogar</span><b>{rule==="unanimous"?"Unánime":"Mayoría"}</b></p></div><p className="font-bold text-sm mt-3">Qué pasa si vota No:</p>{willReject?(<><p className="text-sm mt-1">Su voto No rechaza el acuerdo de inmediato.</p><p className="text-sm mt-1">El acuerdo queda como Rechazado, no se borra.</p></>):(<><p className="text-sm mt-1">Con su voto son {newRejects} de {need} votos No para rechazarlo.</p><p className="text-sm mt-1">El acuerdo sigue como Propuesta.</p></>)}{myVote==="approve" && <p className="text-sm mt-1">Su voto cambia de Sí a No.</p>}<p className="text-sm mt-1">Su voto se puede cambiar después; el estado se recalcula.</p><div className="flex gap-2 mt-3"><button aria-label={`Confirmar el voto No al acuerdo ${a.title}`} className={btnDanger} disabled={voteAg.isPending} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"reject"})}>{voteAg.isPending?"Votando…":"Votar No"}</button><button aria-label={`Cancelar el voto No al acuerdo ${a.title}`} className={btnGhost} onClick={()=>setRejectAgreementPreviewId(null)}>Cancelar</button></div></div>}{deleteAgreementPreviewId===a.id && <div aria-label={`Revisión de la eliminación del acuerdo ${a.title}`} className="mt-3 border border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="font-bold text-sm">Revise antes de eliminar</p><div className="mt-2 space-y-1 text-sm"><p className="flex justify-between gap-2"><span>Acuerdo</span><b>{a.title}</b></p>{a.description && <p className="text-xs text-[var(--dim)]">{a.description}</p>}<p className="flex justify-between gap-2"><span>Estado</span><b>{a.status==="approved"?"Aprobado":a.status==="rejected"?"Rechazado":"Propuesta"}</b></p><p className="flex justify-between gap-2"><span>Votos</span><b>{totalSi+totalNo===0?"sin votos":`${totalSi} Sí · ${totalNo} No`}</b></p></div><p className="font-bold text-sm mt-3">Qué pasa al eliminar:</p><p className="text-sm mt-1">El acuerdo se elimina y no se puede recuperar.</p><p className="text-sm mt-1">Sus votos se borran con él.</p><p className="text-sm mt-1">Si lo vuelve a necesitar, hay que proponerlo de nuevo.</p><div className="flex gap-2 mt-3"><button aria-label={`Confirmar la eliminación del acuerdo ${a.title}`} className={btnDanger} disabled={delAg.isPending} onClick={()=>delAg.mutate(a.id)}>{delAg.isPending?"Eliminando…":"Eliminar"}</button><button aria-label={`Cancelar la eliminación del acuerdo ${a.title}`} className={btnGhost} onClick={()=>setDeleteAgreementPreviewId(null)}>Cancelar</button></div></div>}</div>;})}
              {data.agreements.length===0 && <Empty title="Sin acuerdos registrados" body="Proponga la primera regla del hogar." />}
            </div>
          </section>
        )}

        {effTab==="patrimonio" && (
          <section>
            <div className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-4 sm:p-5 flex flex-wrap gap-6">
              <div><p className="text-sm opacity-80">Patrimonio neto</p><p className="font-display text-2xl font-extrabold whitespace-nowrap">{money2(s.netWorth)}</p></div>
              <div><p className="text-sm opacity-80">Activos ({data.patrimony.filter(p=>p.kind==="asset").length})</p><p className="font-display text-xl font-bold whitespace-nowrap">{money2(s.totalAssets)}</p></div>
              <div><p className="text-sm opacity-80">Pasivos ({data.patrimony.filter(p=>p.kind==="liability").length})</p><p className="font-display text-xl font-bold whitespace-nowrap">{money2(s.totalLiabilities)}</p></div>
                          </div>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-6 gap-2 items-end mt-3" onSubmit={(e:FormEvent)=>{e.preventDefault();savePat.mutate();}}>
              <div><Label htmlFor="pat-name">Nombre</Label><input id="pat-name" aria-label="Nombre de la partida de patrimonio" required className={inputCls} value={patName} onChange={e=>setPatName(e.target.value)} placeholder="Ej. Casa, Auto, Hipoteca" /></div>
              <div><Label htmlFor="pat-kind">Tipo</Label><select id="pat-kind" aria-label="Tipo de partida" className={inputCls} value={patKind} onChange={e=>setPatKind(e.target.value as "asset"|"liability")}><option value="asset">Activo</option><option value="liability">Pasivo</option></select></div>
              <div><Label htmlFor="pat-cat">Categoría</Label><input id="pat-cat" aria-label="Categoría de la partida" className={inputCls} value={patCat} onChange={e=>setPatCat(e.target.value)} placeholder="Inmueble, Vehículo…" /></div>
              <div><Label htmlFor="pat-value">Valor ($)</Label><input id="pat-value" aria-label="Valor de la partida" type="number" min="0" required className={inputCls} value={patValue} onChange={e=>setPatValue(e.target.value)} /></div>
              <div><Label htmlFor="pat-owner">Propietario</Label><input id="pat-owner" aria-label="Propietario de la partida" className={inputCls} value={patOwner} onChange={e=>setPatOwner(e.target.value)} placeholder="Compartido / nombre" /></div>
              <button className={btnPrimary}>Agregar</button>
            </form>
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {(["asset","liability"] as const).map(k=>(
                data.patrimony.filter(p=>p.kind===k).length===0 ? (
                <div key={k} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><h3 className="font-display font-bold text-lg">{k==="asset"?"Activos":"Pasivos"}</h3>
                  <p className="text-sm text-[var(--dim)] mt-2">Sin {k==="asset"?"activos":"pasivos"} registrados.</p><button type="button" aria-label="Agregar patrimonio" className={btnPrimary+" mt-2"} onClick={()=>focusField("pat-value")}>+ Agregar patrimonio</button>
                  <p className="font-display font-bold mt-2 text-right">Total: <span className="whitespace-nowrap">{money2(k==="asset"?s.totalAssets:s.totalLiabilities)}</span></p>
                </div>
                ) : (
                <CollapsibleCard key={k} title={<h3 className="font-display font-bold text-lg">{k==="asset"?"Activos":"Pasivos"}</h3>} below={<p className="font-display font-bold mt-2 text-right">{data.patrimony.filter(p=>p.kind===k).length} {data.patrimony.filter(p=>p.kind===k).length===1?"partida":"partidas"} · Total: <span className="whitespace-nowrap">{money2(k==="asset"?s.totalAssets:s.totalLiabilities)}</span></p>}>
                  {data.patrimony.filter(p=>p.kind===k).map(p=><div key={p.id} className="flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm"><span>{p.name}<span className="block text-xs text-[var(--dim)]">{p.category}{p.owner?` · ${p.owner}`:""}</span></span><span className="text-right"><b className="whitespace-nowrap">{money2(p.value)}</b><br/><button aria-label={`Eliminar ${p.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>delPat.mutate(p.id)}>Eliminar</button></span></div>)}
                </CollapsibleCard>
                )
              ))}
            </div>
          </section>
        )}

        {effTab==="categorias" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-4 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveCat.mutate();}}>
              <div><Label htmlFor="cat-name">Nueva categoría</Label><input id="cat-name" aria-label="Nombre de la nueva categoría" required className={inputCls} value={catFormName} onChange={e=>setCatFormName(e.target.value)} /></div>
              <div><Label htmlFor="cat-kind">Tipo</Label><select id="cat-kind" aria-label="Tipo de categoría" className={inputCls} value={catKind} onChange={e=>setCatKind(e.target.value as "income"|"expense")}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div>
              <div><Label htmlFor="cat-subs">Subcategorías (coma)</Label><input id="cat-subs" aria-label="Subcategorías separadas por coma" className={inputCls} value={catSubs} onChange={e=>setCatSubs(e.target.value)} placeholder="Súper, Mercado, Tienda" /></div>
              <button className={btnPrimary}>Crear categoría</button>
            </form>
            <div className="mt-3"><Help>La × quita una subcategoría.</Help></div>
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {(["income","expense"] as const).map(k=>(
                data.categories.filter(c=>c.kind===k).length===0 ? (
                <div key={k} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><h3 className="font-display font-bold text-lg">{k==="income"?`Ingresos (${data.categories.filter(c=>c.kind==="income").length})`:`Gastos (${data.categories.filter(c=>c.kind==="expense").length})`}</h3>
                </div>
                ) : (
                <CollapsibleCard key={k} title={<h3 className="font-display font-bold text-lg">{k==="income"?`Ingresos (${data.categories.filter(c=>c.kind==="income").length})`:`Gastos (${data.categories.filter(c=>c.kind==="expense").length})`}</h3>} above={<p className="text-sm text-[var(--dim)] mt-1">{categoryCounts(data.categories,k).subCount} subcategorías</p>}>
                  {data.categories.filter(c=>c.kind===k).map(c=><div key={c.id} className="py-2.5 border-b border-[var(--border)] last:border-0"><p className="text-sm font-semibold">{c.name} {c.isSystem===1 && <span className="text-xs text-[var(--dim)] font-normal">· del sistema</span>}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {c.subcategories.map(sb=><span key={sb} className="inline-flex items-center gap-1 bg-[var(--surface2)] rounded-full pl-2.5 pr-1 py-1 text-xs font-semibold">{sb}<button type="button" aria-label={`Eliminar subcategoría ${sb} de ${c.name}`} className="w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)] leading-none" onClick={()=>removeSub.mutate({categoryId:c.id,name:sb})}>×</button></span>)}
                      {c.subcategories.length===0 && <span className="text-xs text-[var(--dim)]">Sin subcategorías</span>}
                    </div>
                    <div className="flex gap-2 mt-2"><input aria-label={`Nueva subcategoría para ${c.name}`} placeholder="Nueva subcategoría…" className={inputCls} value={newSubByCat[c.id]||""} onChange={e=>setNewSubByCat({...newSubByCat,[c.id]:e.target.value})} /><button type="button" aria-label={`Agregar subcategoría a ${c.name}`} className={btnGhost} disabled={!(newSubByCat[c.id]||"").trim() || addSub.isPending} onClick={()=>addSub.mutate({categoryId:c.id,name:(newSubByCat[c.id]||"").trim()},{onSuccess:()=>setNewSubByCat(p=>({...p,[c.id]:""}))})}>Agregar</button></div>
                  </div>)}
                </CollapsibleCard>
                )
              ))}
            </div>
            {(addSub.error || removeSub.error) && <p className="text-sm text-[var(--red)] mt-2">{String(addSub.error || removeSub.error)}</p>}
            {rulesQuery.isPending ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <h3 className="font-display font-bold text-lg">Reglas de auto-categorización</h3>
              <p className="text-sm text-[var(--dim)] mt-1">Si el concepto contiene una palabra, la app pone sola esa categoría. Ejemplo: «OXXO» → Alimentación.</p>
              <p className="text-sm text-[var(--dim)] mt-2">Cargando reglas…</p>
            </div>
            ) : rulesQuery.error ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <h3 className="font-display font-bold text-lg">Reglas de auto-categorización</h3>
              <p className="text-sm text-[var(--dim)] mt-1">Si el concepto contiene una palabra, la app pone sola esa categoría. Ejemplo: «OXXO» → Alimentación.</p>
              <p className="text-sm text-[var(--red)] mt-2">No se pudieron cargar las reglas. Si es la primera vez, ejecute supabase/category-rules.sql en Supabase.</p>
            </div>
            ) : rules.length===0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <h3 className="font-display font-bold text-lg">Reglas de auto-categorización</h3>
              <p className="text-sm text-[var(--dim)] mt-1">Si el concepto contiene una palabra, la app pone sola esa categoría. Ejemplo: «OXXO» → Alimentación.</p>
                <form className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end mt-3" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!ruleKeyword.trim()||!ruleCat) return; saveRule.mutate({keyword:ruleKeyword.trim(),categoryId:Number(ruleCat)},{onSuccess:()=>{setRuleKeyword("");setRuleCat("");}});}}>
                  <div><Label htmlFor="rule-keyword">Palabra o frase</Label><input id="rule-keyword" aria-label="Palabra o frase de la regla" className={inputCls} value={ruleKeyword} onChange={e=>setRuleKeyword(e.target.value)} placeholder="Ej. OXXO" /></div>
                  <div><Label htmlFor="rule-cat">Categoría</Label><select id="rule-cat" aria-label="Categoría de la regla" className={inputCls} value={ruleCat} onChange={e=>setRuleCat(e.target.value)}><option value="">Seleccione…</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <button className={btnPrimary} disabled={saveRule.isPending || !ruleKeyword.trim() || !ruleCat}>Agregar regla</button>
                </form>
                {saveRule.error && <p className="text-sm text-[var(--red)] mt-2">{String(saveRule.error)}</p>}
              <p className="text-sm text-[var(--dim)] mt-3">Sin reglas todavía.</p>
                {delRule.error && <p className="text-sm text-[var(--red)] mt-2">{String(delRule.error)}</p>}
            </div>
            ) : (
            <CollapsibleCard
              className="mt-3"
              title={<h3 className="font-display font-bold text-lg">Reglas de auto-categorización</h3>}
              above={<>
              <p className="text-sm text-[var(--dim)] mt-1">Si el concepto contiene una palabra, la app pone sola esa categoría. Ejemplo: «OXXO» → Alimentación.</p>
                <form className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end mt-3" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!ruleKeyword.trim()||!ruleCat) return; saveRule.mutate({keyword:ruleKeyword.trim(),categoryId:Number(ruleCat)},{onSuccess:()=>{setRuleKeyword("");setRuleCat("");}});}}>
                  <div><Label htmlFor="rule-keyword">Palabra o frase</Label><input id="rule-keyword" aria-label="Palabra o frase de la regla" className={inputCls} value={ruleKeyword} onChange={e=>setRuleKeyword(e.target.value)} placeholder="Ej. OXXO" /></div>
                  <div><Label htmlFor="rule-cat">Categoría</Label><select id="rule-cat" aria-label="Categoría de la regla" className={inputCls} value={ruleCat} onChange={e=>setRuleCat(e.target.value)}><option value="">Seleccione…</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <button className={btnPrimary} disabled={saveRule.isPending || !ruleKeyword.trim() || !ruleCat}>Agregar regla</button>
                </form>
                {saveRule.error && <p className="text-sm text-[var(--red)] mt-2">{String(saveRule.error)}</p>}
                <p className="text-sm text-[var(--dim)] mt-1">{rules.length} {rules.length===1?"regla":"reglas"}</p>
              </>}
            >
              <div className="divide-y divide-[var(--border)] mt-2">{rules.map(r=>(<div key={r.id} className="py-2 flex justify-between gap-2 text-sm"><span>Si el concepto contiene «<b>{r.keyword}</b>» → <b>{r.categoryName}</b></span><button type="button" aria-label={`Eliminar la regla ${r.keyword}`} className="text-xs underline text-[var(--red)] shrink-0" disabled={delRule.isPending} onClick={()=>delRule.mutate(r.id)}>Eliminar</button></div>))}</div>
                {delRule.error && <p className="text-sm text-[var(--red)] mt-2">{String(delRule.error)}</p>}
            </CollapsibleCard>
            )}
          </section>
        )}

        {effTab==="recurrentes" && (
          <section>
            {recRulesQuery.isPending ? (
              <p className="text-sm text-[var(--dim)]">Cargando gastos recurrentes…</p>
            ) : recRulesQuery.error ? (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <h3 className="font-display font-bold text-lg">Gastos recurrentes</h3>
                <p className="text-sm text-[var(--red)] mt-1">No se pudieron cargar las reglas. Si es la primera vez, ejecute supabase/recurring-rules.sql en Supabase.</p>
              </div>
            ) : (<>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
              <h3 className="font-display font-bold text-lg">Pendientes de confirmar</h3>
              <p className="text-sm text-[var(--dim)] mt-1">Cuando vence una fecha, llega un aviso a la campana. Confirme para registrar el gasto u omita solo esa fecha.</p>
              {recPending.length===0 ? (
                <p className="text-sm text-[var(--dim)] mt-3">Sin avisos pendientes.</p>
              ) : (
                <div className="divide-y divide-[var(--border)] mt-2">{recPending.map(pp=>(<div key={pp.id} className="py-3">
                  <div className="flex justify-between gap-2"><p className="font-semibold text-sm">{pp.concept}</p><p className="font-semibold text-sm whitespace-nowrap">{money(pp.amount)}</p></div>
                  <p className="text-xs text-[var(--dim)] mt-0.5">{pp.dueDate===todayISO()?`Vence hoy`:`Venció el ${fmtDate(pp.dueDate)}`} · {pp.accountName ?? "Sin cuenta"}{pp.categoryName?` · ${pp.categoryName}`:""}</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" aria-label={`Confirmar ${pp.concept} de ${money(pp.amount)}`} className={btnPrimary} disabled={confirmRecOcc.isPending} onClick={()=>confirmRecOcc.mutate(pp.id)}>Confirmar</button>
                    <button type="button" aria-label={`Omitir ${pp.concept} de ${money(pp.amount)}`} className={btnGhost} disabled={skipRecOcc.isPending} onClick={()=>skipRecOcc.mutate(pp.id)}>Omitir</button>
                  </div>
                </div>))}</div>
              )}
              {(confirmRecOcc.error || skipRecOcc.error) && <p className="text-sm text-[var(--red)] mt-2">{String(confirmRecOcc.error || skipRecOcc.error)}</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <div className="flex justify-between items-start gap-2">
                <div><h3 className="font-display font-bold text-lg">Reglas</h3><p className="text-sm text-[var(--dim)] mt-1">Un gasto que se repite. La app nunca registra sola: avisa y usted confirma.</p></div>
                <button type="button" aria-label="Nueva regla de gasto recurrente" className={btnPrimary} onClick={()=>openRecForm()}>+ Nueva regla</button>
              </div>
              {recRules.length===0 ? (
                <p className="text-sm text-[var(--dim)] mt-3">Sin reglas todavía.</p>
              ) : (
                <div className="divide-y divide-[var(--border)] mt-2">{recRules.map(r=>(<div key={r.id} className="py-3">
                  <div className="flex justify-between gap-2"><p className="font-semibold text-sm">{r.concept}</p><p className="font-semibold text-sm whitespace-nowrap">{money(r.amount)}</p></div>
                  <p className="text-xs text-[var(--dim)] mt-0.5">{r.accountName ?? "Sin cuenta"}{r.categoryName?` · ${r.categoryName}`:""} · {recWhenText(r)}</p>
                  <p className="text-xs text-[var(--dim)] mt-0.5">{r.nextDueDate?`Próxima: ${fmtDate(r.nextDueDate)}`:"Sin próximas fechas"} · {r.isActive===1?"Activa":"Pausada"}{r.needsReview?" · Revisar":""}</p>
                  {r.needsReview && <p className="text-xs text-[var(--red)] mt-1">La cuenta o la categoría de esta regla ya no existe. Corríjala para volver a recibir avisos.</p>}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" aria-label={r.isActive===1?`Pausar la regla ${r.concept}`:`Reanudar la regla ${r.concept}`} className={btnGhost} disabled={setRecActive.isPending} onClick={()=>setRecActive.mutate({id:r.id,isActive:r.isActive===1?0:1})}>{r.isActive===1?"Pausar":"Reanudar"}</button>
                    <button type="button" aria-label={`Editar la regla ${r.concept}`} className={btnGhost} onClick={()=>openRecForm(r)}>Editar</button>
                    {recDelId===r.id ? (<><button type="button" aria-label={`Confirmar eliminar la regla ${r.concept}`} className={btnDanger} disabled={delRecRule.isPending} onClick={()=>delRecRule.mutate(r.id)}>Sí, eliminar</button><button type="button" className={btnGhost} onClick={()=>setRecDelId(null)}>Cancelar</button></>) : (<button type="button" aria-label={`Eliminar la regla ${r.concept}`} className={btnGhost} onClick={()=>setRecDelId(r.id)}>Eliminar</button>)}
                  </div>
                </div>))}</div>
              )}
              {(delRecRule.error || setRecActive.error) && <p className="text-sm text-[var(--red)] mt-2">{String(delRecRule.error || setRecActive.error)}</p>}
            </div>
            {recFormOpen && (<form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!recConcept.trim()||!recAmount||!recAccount) return; saveRecRule.mutate({id:recEditId??undefined,concept:recConcept.trim(),amount:Number(recAmount),accountId:Number(recAccount),categoryId:recCat?Number(recCat):null,frequency:recFreq,dayOfMonth:recFreq==="monthly"?Number(recDay):null,weekday:recFreq==="weekly"?Number(recWeekday):null,startDate:recStart,endDate:recEnd||null,visibility:recVis},{onSuccess:()=>{setRecFormOpen(false);setRecEditId(null);}});}}>
              <h3 className="font-display font-bold text-lg">{recEditId?"Editar regla":"Nueva regla"}</h3>
              <div><Label htmlFor="rec-concept">Concepto</Label><input id="rec-concept" aria-label="Concepto del gasto recurrente" required className={inputCls} value={recConcept} onChange={e=>setRecConcept(e.target.value)} placeholder="Ej. Renta" /></div>
              <div><Label htmlFor="rec-amount">Importe</Label><input id="rec-amount" aria-label="Importe del gasto recurrente" required type="number" min="0.01" step="0.01" inputMode="decimal" className={inputCls} value={recAmount} onChange={e=>setRecAmount(e.target.value)} placeholder="0.00" /></div>
              <div><Label htmlFor="rec-account">Cuenta</Label><select id="rec-account" aria-label="Cuenta del gasto recurrente" className={inputCls} value={recAccount} onChange={e=>setRecAccount(e.target.value)}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>
              <div><Label htmlFor="rec-cat">Categoría</Label><select id="rec-cat" aria-label="Categoría del gasto recurrente" className={inputCls} value={recCat} onChange={e=>setRecCat(e.target.value)}><option value="">Sin categoría</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div>
                <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">Frecuencia</span>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Frecuencia del gasto recurrente">
                  {(["weekly","biweekly","monthly"] as const).map(f=>(<button key={f} type="button" aria-label={`Repetir cada ${f==="weekly"?"semana":f==="biweekly"?"quincena":"mes"}`} onClick={()=>setRecFreq(f)} className={`rounded-full py-2.5 text-[13px] font-bold ${recFreq===f?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>{recFreqLabel(f)}</button>))}
                </div>
              </div>
              {recFreq==="monthly" && <div><Label htmlFor="rec-day">Día del mes</Label><input id="rec-day" aria-label="Día del mes del gasto recurrente" type="number" min={1} max={31} className={inputCls} value={recDay} onChange={e=>setRecDay(e.target.value)} /><p className="text-xs text-[var(--dim)] mt-1">Si el mes no tiene ese día, se ajusta al último día del mes.</p></div>}
              {recFreq==="weekly" && <div><Label htmlFor="rec-weekday">Día de la semana</Label><select id="rec-weekday" aria-label="Día de la semana del gasto recurrente" className={inputCls} value={recWeekday} onChange={e=>setRecWeekday(e.target.value)}>{["domingo","lunes","martes","miércoles","jueves","viernes","sábado"].map((w,i)=>(<option key={w} value={i}>{w}</option>))}</select></div>}
              {recFreq==="biweekly" && <p className="text-sm text-[var(--dim)]">Cada 14 días a partir de la fecha de inicio.</p>}
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="rec-start">Fecha de inicio</Label><input id="rec-start" aria-label="Fecha de inicio del gasto recurrente" type="date" required className={inputCls} value={recStart} onChange={e=>setRecStart(e.target.value)} /></div>
                <div><Label htmlFor="rec-end">Fecha de término (opcional)</Label><input id="rec-end" aria-label="Fecha de término del gasto recurrente" type="date" className={inputCls} value={recEnd} onChange={e=>setRecEnd(e.target.value)} /></div>
              </div>
              <div>
                <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">Visibilidad</span>
                <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Visibilidad del gasto recurrente">
                  <button type="button" aria-label="Gasto recurrente compartido" onClick={()=>setRecVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${recVis==="shared"?"bg-[var(--green)] text-[var(--bg)]":"border border-[var(--border)]"}`}>Compartido</button>
                  <button type="button" aria-label="Gasto recurrente privado" onClick={()=>setRecVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${recVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
                </div>
              </div>
              {saveRecRule.error && <p className="text-sm text-[var(--red)]">{String(saveRecRule.error)}</p>}
              <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setRecFormOpen(false);setRecEditId(null);}}>Cancelar</button><button className={btnPrimary+" flex-1"} disabled={saveRecRule.isPending || !recConcept.trim() || !recAmount || !recAccount}>{saveRecRule.isPending?"Guardando…":recEditId?"Guardar cambios":"Crear regla"}</button></div>
            </form>)}
            </>)}
          </section>
        )}

        {effTab==="perfiles" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 items-start">
            <div style={{gridColumn:"1 / -1"}} className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-4 sm:p-5 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]"><p className="font-display font-bold text-lg">Perfil en uso</p><p className="text-xs opacity-80">Lo que ve en este dispositivo.</p></div>
              <select aria-label="Perfil actual en este dispositivo" className="rounded-xl bg-[var(--surface)] text-[var(--text)] px-3 py-2.5 font-semibold" value={me?me.id:""} onChange={e=>pickProfile(Number(e.target.value))}>
                {data.profiles.map(x=><option key={x.id} value={x.id}>{fullName(x)} — {x.role==="admin"?"Administrador":"Integrante"}</option>)}
              </select>
              <span className="text-sm font-bold">{isAdmin?"Ve todo lo compartido.":"Ve lo compartido y sus privados."}</span>
            </div>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveProf.mutate();}}>
              <h2 className="font-display font-bold text-lg">Agregar persona</h2>
              <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="prof-name">Nombre</Label><input id="prof-name" aria-label="Nombre de la persona" required className={inputCls} value={profName} onChange={e=>setProfName(e.target.value)} /></div><div><Label htmlFor="prof-last">Apellido</Label><input id="prof-last" aria-label="Apellido de la persona" className={inputCls} value={profLast} onChange={e=>setProfLast(e.target.value)} /></div></div>
              <p className="text-xs text-[var(--dim)]">El nombre no se toma del correo.</p>
              <div><Label htmlFor="prof-kind">Tipo de perfil</Label><select id="prof-kind" aria-label="Tipo de perfil" className={inputCls} value={profKind} onChange={e=>setProfKind(e.target.value as "adult"|"dependent")}><option value="adult">Adulto</option><option value="dependent">Dependiente</option></select></div>
              {profKind==="dependent" && <div><Label htmlFor="prof-type">Relación</Label><select id="prof-type" aria-label="Relación del dependiente" className={inputCls} value={profType} onChange={e=>setProfType(e.target.value)}><option>Hijo/a menor</option><option>Hijo/a adulto</option><option>Padre/Madre</option><option>Otro dependiente</option></select></div>}
              {profKind==="adult" && <>
                <div><Label htmlFor="prof-email">Correo (para invitar)</Label><input id="prof-email" aria-label="Correo de la persona" type="email" className={inputCls} value={profEmail} onChange={e=>setProfEmail(e.target.value)} placeholder="pareja@correo.com" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label htmlFor="prof-income">Ingreso neto mensual ($)</Label><input id="prof-income" aria-label="Ingreso neto mensual" type="number" min="0" className={inputCls} value={profIncome} onChange={e=>setProfIncome(e.target.value)} /></div>
                  <div><Label htmlFor="prof-fixed">Compromisos fijos ($)</Label><input id="prof-fixed" aria-label="Compromisos fijos mensuales" type="number" min="0" className={inputCls} value={profFixed} onChange={e=>setProfFixed(e.target.value)} /></div>
                </div>
                <Help><b>Capacidad</b> = ingreso − compromisos.</Help>
              </>}
              <button className={btnPrimary+" w-full"}>Agregar persona</button>
            </form>
            <div className="space-y-2">
              {data.profiles.map(p=>(
                <div key={p.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                  <div className="flex justify-between gap-2">
                  <div className="flex-1"><p className="font-display font-bold text-lg">{fullName(p)} <span className="text-xs font-normal bg-[var(--surface2)] rounded-full px-2 py-0.5">{p.kind==="adult"?"Adulto":`Dependiente · ${p.dependentType||""}`}</span> <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${p.role==="admin"?"bg-[var(--gold)] text-[#13262E]":"bg-[var(--surface2)]"}`}>{p.role==="admin"?"Administrador del hogar":"Integrante"}</span></p>
                  {p.kind==="adult" ? <p className="text-sm text-[var(--dim)]">Ingreso {money(p.monthlyIncome)} · Compromisos {money(p.fixedCommitments)} · <b className="text-[var(--text)] whitespace-nowrap">Capacidad {money(p.capacity)}</b>{p.email?` · ${p.email}`:""}</p> : <p className="text-sm text-[var(--dim)]">No aporta ni vota.</p>}</div>
                  <div className="shrink-0 text-right space-y-1">
                    <button aria-label={`Editar nombre de ${fullName(p)}`} className="text-xs underline block" onClick={()=>{setEditProfId(p.id);setEditProfName(p.name);setEditProfLast(p.lastName||"");}}>Editar nombre</button>
                    {isAdmin && <button aria-label={`Eliminar perfil de ${fullName(p)}`} className="text-xs underline text-[var(--red)] block" onClick={()=>setConfirmDeleteProfId(confirmDeleteProfId===p.id?null:p.id)}>Eliminar</button>}
                    {editProfId===p.id && <span className="flex gap-1 mt-1"><input aria-label="Editar nombre" className={inputCls+" w-28"} value={editProfName} onChange={e=>setEditProfName(e.target.value)} /><input aria-label="Editar apellido" className={inputCls+" w-28"} value={editProfLast} onChange={e=>setEditProfLast(e.target.value)} /><button aria-label="Guardar nombre editado" className={btnPrimary} onClick={()=>saveProfEdit.mutate()}>Guardar</button></span>}
                  </div>
                  </div>
                  {isAdmin && confirmDeleteProfId===p.id && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar este perfil?</p><p className="text-xs text-[var(--dim)] mt-1">«{fullName(p)}». Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la eliminación del perfil ${fullName(p)}`} className={btnPrimary} disabled={delProf.isPending} onClick={()=>delProf.mutate(p.id)}>{delProf.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label="Cancelar la eliminación del perfil" className={btnGhost} onClick={()=>setConfirmDeleteProfId(null)}>Cancelar</button></div></div>}
                </div>
              ))}
              {data.profiles.length===0 && <Empty title="Sin perfiles" body="Agregue a los adultos del hogar." />}
              {data.invitations.length===0 ? (
              <div className="bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5">
                <h3 className="font-display font-bold text-lg">Invitaciones al hogar</h3>
                <p className="text-sm text-[var(--dim)] mt-1">Enlace directo, un solo uso, 7 días.</p>
                {isAdmin ? <div className="flex flex-wrap gap-2 mt-3"><input aria-label="Correo del invitado" type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={invEmail2} onChange={e=>setInvEmail2(e.target.value)} /><input aria-label="Nombre del invitado opcional" placeholder="Nombre (opcional, lo confirma él/ella)" className={inputCls+" flex-1 min-w-[160px]"} value={invName2} onChange={e=>setInvName2(e.target.value)} /><button aria-label="Enviar invitación al hogar" className={btnPrimary} onClick={()=>createInv.mutate()} disabled={!invEmail2 || createInv.isPending}>Invitar</button></div> : <p className="text-sm mt-2">Solo el administrador envía invitaciones.</p>}
                {createInv.isSuccess && <p className="text-sm text-[var(--green)] mt-2">{(createInv.data as {reused?:boolean})?.reused?"Se reutilizó la invitación pendiente.":"Invitación pendiente."}</p>}
                {hhInvResult && (
                  <div className="text-sm space-y-2 mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)]">
                    <p className="font-bold">Enlace de invitación listo{hhInvResult.emailSent?" · también se envió el correo.":""}</p>
                    <p className="break-all bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2 text-xs">{hhInvResult.inviteUrl}</p>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className={btnPrimary+" flex-1"} onClick={()=>copyLink(inviteMessage(hhInvResult.inviteUrl))}>{copiedLink===inviteMessage(hhInvResult.inviteUrl)?"Invitación copiada":"Copiar invitación"}</button>
                      <a className={btnGhost+" flex-1 flex items-center justify-center text-center"} href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(hhInvResult.inviteUrl))}`} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
                    </div>
                    {!hhInvResult.emailConfigured && <p className="text-xs text-[var(--dim)]">El correo no está configurado; comparta el enlace por WhatsApp.</p>}
                  </div>
                )}
                {createInv.error && <p className="text-sm text-[var(--red)] mt-2">{String(createInv.error)}</p>}
                <GenericHouseholdInvite householdId={hh.id} householdName={hh.name} isAdmin={isAdmin} api={api} copyLink={copyLink} copiedLink={copiedLink} />
                <HouseholdCode householdId={hh.id} householdName={hh.name} isAdmin={isAdmin} api={api} copyLink={copyLink} copiedLink={copiedLink} />
                <div className="divide-y divide-[var(--border)] mt-2">
                  <p className="text-sm text-[var(--dim)] py-2">Sin invitaciones registradas.</p>
                </div>
              </div>
              ) : (
              <CollapsibleCard
                tone="gold"
                title={<h3 className="font-display font-bold text-lg">Invitaciones al hogar</h3>}
                above={<>
                <p className="text-sm text-[var(--dim)] mt-1">Enlace directo, un solo uso, 7 días.</p>
                {isAdmin ? <div className="flex flex-wrap gap-2 mt-3"><input aria-label="Correo del invitado" type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={invEmail2} onChange={e=>setInvEmail2(e.target.value)} /><input aria-label="Nombre del invitado opcional" placeholder="Nombre (opcional, lo confirma él/ella)" className={inputCls+" flex-1 min-w-[160px]"} value={invName2} onChange={e=>setInvName2(e.target.value)} /><button aria-label="Enviar invitación al hogar" className={btnPrimary} onClick={()=>createInv.mutate()} disabled={!invEmail2 || createInv.isPending}>Invitar</button></div> : <p className="text-sm mt-2">Solo el administrador envía invitaciones.</p>}
                {createInv.isSuccess && <p className="text-sm text-[var(--green)] mt-2">{(createInv.data as {reused?:boolean})?.reused?"Se reutilizó la invitación pendiente.":"Invitación pendiente."}</p>}
                {hhInvResult && (
                  <div className="text-sm space-y-2 mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)]">
                    <p className="font-bold">Enlace de invitación listo{hhInvResult.emailSent?" · también se envió el correo.":""}</p>
                    <p className="break-all bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2 text-xs">{hhInvResult.inviteUrl}</p>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className={btnPrimary+" flex-1"} onClick={()=>copyLink(inviteMessage(hhInvResult.inviteUrl))}>{copiedLink===inviteMessage(hhInvResult.inviteUrl)?"Invitación copiada":"Copiar invitación"}</button>
                      <a className={btnGhost+" flex-1 flex items-center justify-center text-center"} href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(hhInvResult.inviteUrl))}`} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
                    </div>
                    {!hhInvResult.emailConfigured && <p className="text-xs text-[var(--dim)]">El correo no está configurado; comparta el enlace por WhatsApp.</p>}
                  </div>
                )}
                {createInv.error && <p className="text-sm text-[var(--red)] mt-2">{String(createInv.error)}</p>}
                <GenericHouseholdInvite householdId={hh.id} householdName={hh.name} isAdmin={isAdmin} api={api} copyLink={copyLink} copiedLink={copiedLink} />
                <HouseholdCode householdId={hh.id} householdName={hh.name} isAdmin={isAdmin} api={api} copyLink={copyLink} copiedLink={copiedLink} />
                <p className="text-sm text-[var(--dim)] mt-1">{data.invitations.length} {data.invitations.length===1?"invitación":"invitaciones"} · {invitationCounts(data.invitations).pending} pendientes{data.invitations.filter(i=>i.requested&&i.status==="pending").length>0 && <> · {data.invitations.filter(i=>i.requested&&i.status==="pending").length} solicitudes</>}</p>
                </>}
              >
                <div className="divide-y divide-[var(--border)] mt-2">
                  {data.invitations.map(iv=>(
                    iv.requested ? (
                      <JoinRequestRow key={iv.id} inv={iv} isAdmin={isAdmin} busy={respondJoinReq.isPending} householdName={hh.name} onRespond={(id,accept)=>respondJoinReq.mutate({id,accept})} onDelete={(id)=>delInv.mutate(id)} />
                    ) : (
                    <div key={iv.id} className="py-2.5 text-sm">
                      <div className="flex justify-between gap-2 flex-wrap"><span><b>{iv.email}</b>{iv.invitedName?` · ${iv.invitedName}`:""}</span><span className={`text-xs font-bold rounded-full px-2 py-0.5 ${iv.status==="accepted"?"bg-green-100 text-green-800":iv.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{iv.status==="accepted"?"Aceptada":iv.status==="rejected"?"Rechazada":"Pendiente"}</span></div>
                      {iv.status==="pending" && <div className="mt-2 space-y-2">{(()=>{ const isInvitee = myEmail.trim().toLowerCase() !== "" && iv.email.trim().toLowerCase() === myEmail.trim().toLowerCase(); return isInvitee ? (<><div className="grid grid-cols-2 gap-2"><input aria-label={`Nombre de quien acepta ${iv.email}`} placeholder="Su nombre" className={inputCls} value={acceptFirst[iv.id]||iv.invitedName||""} onChange={e=>setAcceptFirst({...acceptFirst,[iv.id]:e.target.value})} /><input aria-label={`Apellido de quien acepta ${iv.email}`} placeholder="Su apellido" className={inputCls} value={acceptLast[iv.id]||""} onChange={e=>setAcceptLast({...acceptLast,[iv.id]:e.target.value})} /></div><div className="flex gap-2 flex-wrap"><button aria-label={`Aceptar invitación de ${iv.email}`} className={btnPrimary} onClick={()=>respondInv2.mutate({id:iv.id,accept:true})}>Aceptar y entrar</button><button aria-label={`Rechazar invitación de ${iv.email}`} className={btnGhost} onClick={()=>respondInv2.mutate({id:iv.id,accept:false})}>Rechazar</button>{isAdmin && <><button aria-label={`Reenviar invitación a ${iv.email}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"household",invitationId:iv.id})} disabled={resendInv.isPending}>{resendInv.isPending?"Reenviando…":"Reenviar invitación"}</button><button aria-label={`Borrar invitación de ${iv.email}`} className="text-xs underline text-[var(--red)]" onClick={()=>setConfirmDelInvId(confirmDelInvId===iv.id?null:iv.id)}>Borrar</button></>}</div></>) : (<><p className="text-sm">Invitación enviada a {iv.invitedName?`${iv.invitedName} (${iv.email})`:iv.email} — pendiente de aceptar.</p>{isAdmin && <div className="flex gap-2 flex-wrap"><button aria-label={`Reenviar invitación a ${iv.email}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"household",invitationId:iv.id})} disabled={resendInv.isPending}>{resendInv.isPending?"Reenviando…":"Reenviar invitación"}</button><button aria-label={`Borrar invitación de ${iv.email}`} className="text-xs underline text-[var(--red)]" onClick={()=>setConfirmDelInvId(confirmDelInvId===iv.id?null:iv.id)}>Borrar</button></div>}</>); })()}{confirmDelInvId===iv.id && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar esta invitación?</p><p className="text-xs text-[var(--dim)] mt-1">El enlace dejará de funcionar. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la eliminación de la invitación de ${iv.email}`} className={btnPrimary} disabled={delInv.isPending} onClick={()=>delInv.mutate(iv.id)}>{delInv.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label="Cancelar la eliminación de la invitación" className={btnGhost} onClick={()=>setConfirmDelInvId(null)}>Cancelar</button></div></div>}</div>}
                    </div>
                    )
                  ))}
                </div>
              </CollapsibleCard>
              )}
              <JoinHouseholdByCode api={api} defaultFirstName={meEarly?.name ?? ""} defaultLastName={meEarly?.lastName ?? ""} />
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><h3 className="font-display font-bold text-lg">Fecha de corte del hogar: día {hh.cutoffDay}</h3><p className="text-sm text-[var(--dim)] mt-1">El mes se consulta por calendario; la fecha de corte está en Hogar.</p></div>
            </div>
          </section>
        )}

        
        {effTab==="personal" && (
          <section className="space-y-4 md:space-y-6">
            {/* Tarjeta principal como la de Inicio: superficie con acento
                dorado fino, cifra grande y quieta; sin bloque sólido. */}
            <div className="relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
              <span aria-hidden="true" className="absolute left-0 right-0 top-0 h-[3px] bg-[var(--gold)]" />
              <p className="text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Restante de su sueldo · {fmtMonth(s.currentMonth).toUpperCase()}</p>
              <p className="font-display text-4xl font-extrabold leading-tight mt-1 whitespace-nowrap">{money2(data.personal.remaining)}</p>
              <p className="text-sm text-[var(--dim)] mt-1">Sueldo {money2(data.personal.salary)} − gastado {money2(data.personal.monthSpent)}.</p>
              {activeGoalPlans.length>0 && <p className="text-sm mt-2">Te queda del mes: <b className="whitespace-nowrap">{money(Math.round((data.personal.remaining - monthSetAside)*100)/100)}</b>{monthShortfall>0 && <> · Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(monthShortfall)}</b></>}</p>}
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Sueldo mensual</p><p className="font-display font-bold whitespace-nowrap text-[var(--green)]">{money(data.personal.salary)}</p></div>
                <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Total gastado</p><p className="font-display font-bold whitespace-nowrap text-[var(--red)]">{money(data.personal.monthSpent)}</p></div>
                <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Gastos de hoy</p><p className="font-display font-bold whitespace-nowrap">{money(data.personal.todaySpent)}</p></div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 items-start">
              <div className="space-y-3">
                <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveSalary.mutate();}}>
                  <h2 className="font-display font-bold text-lg">Su sueldo mensual</h2>
                  <div><Label htmlFor="salary">Sueldo mensual ($)</Label><input id="salary" aria-label="Sueldo mensual personal" type="number" min="0" className={inputCls} placeholder={String(data.personal.salary||"")} value={salaryInput} onChange={e=>setSalaryInput(e.target.value)} /></div>
                  <button className={btnPrimary+" w-full"} disabled={saveSalary.isPending || !salaryInput}>Guardar sueldo</button>
                  {data.personal.salary===0 && <Help>Registre su sueldo para ver su saldo restante.</Help>}
                </form>
                <form id="pers-exp-form" className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2 scroll-mt-28" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(persStep<3){ if(persStep===1 && !persAmt) return; setPersStep(persStep+1); scrollFormTop("pers-exp-form"); } else { const notice=requiredAccountNotice("expense",persAccount); if(notice){ setPersAccountError(notice); return; } savePersExp.mutate(); }}}>
                  <h2 className="font-display font-bold text-lg">Gasto del día</h2>
                  <p className="text-xs text-[var(--dim)]">Paso {persStep} de 3</p>
                  <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden" aria-hidden="true"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${persStep*33.33}%`}} /></div>
                  {ocrNoticePers && <p className="text-xs text-[var(--green)]">{ocrNoticePers}</p>}
                  {persStep===1 && <>
                  <div className="border border-dashed border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
                    <p className="text-sm font-bold">¿Tiene el comprobante?</p>
                    <p className="text-xs text-[var(--dim)]">Suba la foto y la app lee el importe, el concepto y la categoría. Puede revisar y corregir todo antes de guardar.</p>
                    <label className={btnPrimary+" w-full mt-2 text-center cursor-pointer"} aria-label="Subir foto del comprobante al empezar">Subir foto del comprobante<input type="file" accept="image/*" className="hidden" aria-label="Archivo del comprobante" onChange={e=>{ const f=e.target.files?.[0]; void pickAndReadReceipt(f,"pers"); e.target.value=""; }} /></label>
                    {persReceipt && <div className="flex items-center gap-2 mt-2"><img src={persReceipt.preview} alt="Vista previa de la foto del comprobante" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)]" /><button type="button" aria-label="Quitar foto del comprobante" className="text-xs underline text-[var(--red)]" onClick={()=>{setPersReceipt(null);setOcrDetailPers(null);setOcrLabelPers("");setOcrNoticePers("");setOcrErrorPers("");setOcrErrDetailPers("");}}>Quitar foto</button></div>}
                    {persReceipt && <div className="mt-2">
                      <button type="button" aria-label="Leer el comprobante de nuevo y llenar el gasto del día" className={btnGhost+" w-full"} disabled={ocrBusyPers} onClick={()=>void runOcr("pers")}>{ocrBusyPers?"Leyendo el comprobante…":"Leer el comprobante de nuevo"}</button>
                      {ocrProgressPers && <p className="text-xs text-[var(--dim)] mt-1">{ocrProgressPers}</p>}
                      {ocrErrorPers && <p className="text-xs text-[var(--red)] mt-1">{ocrErrorPers}</p>}
                      {ocrErrDetailPers && <p className="text-xs text-[var(--dim)] mt-1">Detalle: {ocrErrDetailPers}</p>}
                      <p className="text-xs text-[var(--dim)] mt-1">La lectura se hace en su dispositivo, sin costo.</p>
                    </div>}
                  </div>
                  <div><Label htmlFor="pers-amt">Importe ($)</Label><input id="pers-amt" aria-label="Importe del gasto del día" type="number" min="0.01" step="0.01" required className={inputCls+" text-xl font-bold py-2"} value={persAmt} onChange={e=>setPersAmt(e.target.value)} /></div>
                  <button type="button" className={btnPrimary+" w-full"} disabled={!persAmt} onClick={()=>{setPersStep(2); scrollFormTop("pers-exp-form");}}>Siguiente</button>
                  </>}
                  {persStep===2 && <>
                  <div><Label htmlFor="pers-cat">Tipo de gasto</Label><select id="pers-cat" aria-label="Tipo de gasto del día" className={inputCls} value={persCat} onChange={e=>{setPersCat(e.target.value);setAppliedRulePers(null);}}><option value="">Sin categoría</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new__">+ Nueva categoría…</option></select></div>
                  {persCat==="__new__" && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
                    <p className="text-sm">Escriba el nombre de la categoría nueva.</p>
                    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" placeholder="Ej. Barbería" maxLength={40} className={inputCls} value={newCatName} onChange={e=>setNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría y usarla" className={btnPrimary} disabled={!newCatName.trim() || createCat.isPending} onClick={()=>createCat.mutate({target:"pers",name:newCatName.trim(),kind:"expense"})}>{createCat.isPending?"Creando…":"Crear y usar"}</button></div>
                    <button type="button" className="text-xs underline mt-2" onClick={()=>{setPersCat("");setNewCatName("");}}>Cancelar</button>
                    {createCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createCat.error)}</p>}
                  </div>}
                  {ocrLabelPers && persCat==="" && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
                    <p className="text-sm">La categoría sugerida «{ocrLabelPers}» no está en su hogar. Puede crearla ya ajustada a este ticket.</p>
                    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" className={inputCls} value={ocrNewCatName} onChange={e=>setOcrNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría sugerida y usarla" className={btnPrimary} disabled={!ocrNewCatName.trim() || createCat.isPending} onClick={()=>createCat.mutate({target:"pers",name:ocrNewCatName.trim(),kind:"expense"})}>{createCat.isPending?"Creando…":"Crear y usar"}</button></div>
                    <button type="button" className="text-xs underline mt-2" onClick={()=>setOcrLabelPers("")}>Omitir, elegiré otra</button>
                    {createCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createCat.error)}</p>}
                  </div>}
                  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setPersStep(1); scrollFormTop("pers-exp-form");}}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} disabled={persCat==="__new__"} onClick={()=>{setPersStep(3); scrollFormTop("pers-exp-form");}}>Siguiente</button></div>
                  </>}
                  {persStep===3 && <>
                  <div><Label htmlFor="pers-concept">Concepto del gasto</Label><div className="flex gap-2"><input id="pers-concept" aria-label="Concepto del gasto del día" className={inputCls+" flex-1"} value={persConcept} onChange={e=>{setPersConcept(e.target.value);applyRuleTo(e.target.value,"pers");}} placeholder="Ej. Alimentos, transporte, café…" /><button type="button" aria-label={voiceBusyPers?"Escuchando…":"Dictar el gasto por voz"} title="Dictar por voz" className="shrink-0 w-11 rounded-xl border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center" disabled={voiceBusyPers} onClick={()=>startVoice("pers")}>{micIcon}</button></div>
                  {voiceBusyPers && <p className="text-xs text-[var(--dim)] mt-1">Escuchando… Diga, por ejemplo, «gasté 320 en el súper».</p>}
                  {voiceErrorPers && <p className="text-xs text-[var(--red)] mt-1">{voiceErrorPers}</p>}
                  {voiceNoticePers && <p className="text-xs text-[var(--green)] mt-1">{voiceNoticePers}</p>}
                  {appliedRulePers && <p className="text-xs text-[var(--dim)] mt-1">Regla aplicada: «{appliedRulePers.keyword}» → {appliedRulePers.categoryName}. Puede cambiarla en el paso 2.</p>}</div>
                  <div><Label htmlFor="pers-account">¿De dónde se descuenta?</Label><select id="pers-account" aria-label="Cuenta del gasto del día" className={inputCls} value={persAccount} onChange={e=>{setPersAccount(e.target.value); setPersAccountError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accOptionLabel(a)}</option>)}</select></div>
                  {persAccountError && <p className="text-sm text-[var(--red)]">{persAccountError}</p>}
                  <div>
                    <button type="button" aria-expanded={persMore} aria-label={persMore?"Ocultar más opciones del gasto del día":"Mostrar más opciones del gasto del día"} onClick={()=>setPersMore(o=>!o)} className="w-full text-left text-sm font-bold text-[var(--dim)] border border-[var(--border)] rounded-xl px-3 py-2.5">{persMore?"▾ Ocultar más opciones":"▸ Más opciones: comprobante"}</button>
                    {persMore && (<div className="space-y-2 mt-3">
                  <div><Label htmlFor="pers-receipt">Foto del comprobante (opcional)</Label><input id="pers-receipt" aria-label="Adjuntar foto del comprobante del gasto del día" type="file" accept="image/*" className="w-full text-sm" onChange={e=>{ void pickReceipt(e.target.files?.[0], setPersReceipt); }} />{persReceipt && <img src={persReceipt.preview} alt="Vista previa del comprobante del gasto del día" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)] mt-2" />}<p className="text-xs text-[var(--dim)] mt-1">Se guarda como comprobante.</p>
                  {persReceipt && <div className="mt-2">
                    <button type="button" aria-label="Leer el comprobante y llenar el gasto del día" className={btnPrimary+" w-full"} disabled={ocrBusyPers} onClick={()=>void runOcr("pers")}>{ocrBusyPers?"Leyendo el comprobante…":"Leer el comprobante"}</button>
                    {ocrProgressPers && <p className="text-xs text-[var(--dim)] mt-1">{ocrProgressPers}</p>}
                    {ocrErrorPers && <p className="text-xs text-[var(--red)] mt-1">{ocrErrorPers}</p>}
                    {ocrErrDetailPers && <p className="text-xs text-[var(--dim)] mt-1">Detalle: {ocrErrDetailPers}</p>}
                    {ocrNoticePers && <p className="text-xs text-[var(--green)] mt-1">{ocrNoticePers}</p>}
                    {ocrDetailPers && <OcrDetail detail={ocrDetailPers} />}
                    <p className="text-xs text-[var(--dim)] mt-1">La lectura se hace en su dispositivo, sin costo.</p>
                  </div>}</div>
                    </div>)}
                  </div>
                  {persReview.length>0 && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
                    <p className="text-sm font-bold">Revisión de Mike</p>
                    {persReview.map((w,i)=><p key={i} className="text-sm mt-1">{w}</p>)}
                    <p className="text-xs text-[var(--dim)] mt-1">Es solo un aviso: puede guardar de todos modos.</p>
                  </div>}
                  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setPersStep(2); scrollFormTop("pers-exp-form");}}>Atrás</button><button className={btnPrimary+" flex-1"} disabled={savePersExp.isPending || !persAmt}>Finalizar</button></div>
                  <p className="text-xs text-[var(--dim)]">Se guarda hoy, en privado.</p>
                  </>}
                </form>
              </div>
              <div className="space-y-3">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                  <h2 className="font-display font-bold text-lg">Gasto por categoría · <span className="whitespace-nowrap"><svg className="inline-block align-[-2px] text-[var(--dim)]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> {fmtMonthShort(s.currentMonth)}</span></h2>
                                    <Suspense fallback={DonutFallback}><CategoryChart data={data.personal.byCategory} detailOpen={catDetail!==null} palette={DONUT_PALETTE_INICIO} large reserveLine minIconPct={5} onSelect={(d)=>setCatDetail({categoryId:d.categoryId,name:d.name,total:d.total,month:s.currentMonth,pct:d.pct})} /></Suspense>
                  <p className="text-sm mt-3 border-t border-[var(--border)] pt-2">Gastado en el mes: <b className="whitespace-nowrap">{money2(data.personal.monthSpent)}</b> · Restante: <b className="whitespace-nowrap">{money2(data.personal.remaining)}</b></p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                  <h2 className="font-display font-bold text-lg">Ingresos vs gastos · 3 meses atrás</h2>
                  <Suspense fallback={BarsFallback}><MonthlyChart series={s.monthlySeries} currentMonth={s.currentMonth} todayMonth={todayISO().slice(0,7)} inicio onSelect={(kind,month,label)=>setIncExpDetail({kind,month,label})} /></Suspense>
                </div>
                <HomeTandasCard tandas={allTandas} onOpenDetail={openTandaDetail} onGoTandas={()=>goTab("tandas")} />
                {data.personal.todayMovements.length===0 ? (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                  <h2 className="font-display font-bold text-lg">Gastos del día ({data.personal.todayCount})</h2>
                  <p className="text-sm text-[var(--dim)] mt-2">Hoy no se han registrado gastos.</p>
                  <p className="text-sm mt-2">Total de hoy: <b className="whitespace-nowrap">{money2(data.personal.todaySpent)}</b></p>
                </div>
                ) : (
                <CollapsibleCard
                  title={<h2 className="font-display font-bold text-lg">Gastos del día ({data.personal.todayCount})</h2>}
                  below={<>                  <p className="text-sm mt-2">Total de hoy: <b className="whitespace-nowrap">{money2(data.personal.todaySpent)}</b></p></>}
                >
                  {data.personal.todayMovements.map(m=>{ const full=data.movements.find(x=>x.id===m.id); return (
                    <div key={m.id} className="flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm"><span className="min-w-0">{m.concept}<span className="block text-xs text-[var(--dim)]">{getCatName(m.categoryId)}{full?` · ${getAccName(full.accountId)}`:""}</span>{full?.receiptUrl && <button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>setReceiptView(full.receiptUrl)}>Ver comprobante</button>}<button aria-label={`Reversar el gasto ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>{setConfirmReverseId(m.id);setMvFilters(DEFAULT_MOVEMENTS_FILTER);goTab("movimientos");}}>Reversar</button></span><span className="flex items-center gap-2">{full?.receiptUrl && <img loading="lazy" decoding="async" src={full.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-8 h-8 object-cover rounded-lg border border-[var(--border)]" />}<b className="whitespace-nowrap shrink-0">−{fxLabel(full?.originalAmount, full?.originalCurrency, m.amount, hhCur) ?? money2(m.amount)}</b></span></div>
                  ); })}
                </CollapsibleCard>
                )}
              </div>
            </div>
          </section>
        )}

        {effTab==="tandas" && (
          <TandasModule
            tandas={allTandas}
            detailId={tandaDetailId}
            onDetailChange={setTandaDetailId}
            formValues={tandaFormValues}
            onFormChange={onTandaFormChange}
            onFormSubmit={()=>saveTanda.mutate()}
            formPending={saveTanda.isPending}
            organizerName={me?fullName(me):"usted"}
            adultProfiles={data.profiles.filter(p=>p.kind==="adult").map(p=>({id:p.id,name:fullName(p)}))}
            detailDeps={tandaDetailDeps}
            permsFor={tandaPerms}
          />
        )}

        {effTab==="guia" && (
          <section className="space-y-4 md:space-y-6">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex items-center gap-2">
              <h2 className="font-display font-bold text-lg flex-1 min-w-0">Instalación en el celular</h2>
              <button type="button" className={btnPrimary+" shrink-0"} onClick={handleInstallClick}>Cómo instalar</button>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-lg">Enviar comentarios</h2>
                <p className="text-sm text-[var(--dim)] mt-0.5">Dudas, errores o mejoras. El dueño de la app los revisa antes de hacer cambios.</p>
              </div>
              <button type="button" className={btnPrimary+" shrink-0"} aria-label="Enviar comentarios sobre la app" onClick={()=>setFeedbackOpen(true)}>Enviar comentarios</button>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-lg">Datos de demostración</h2>
                <p className="text-sm text-[var(--dim)] mt-0.5">Cargue datos de ejemplo para probar la app. Solo funciona sin movimientos.</p>
                {demo.error && <p className="text-xs text-[var(--red)] mt-1">{String(demo.error)}</p>}
                {demo.isSuccess && <p className="text-xs text-[var(--green)] mt-1">Demo cargada: datos con “(demo)”.</p>}
              </div>
              <button type="button" className={btnPrimary+" shrink-0"} aria-label="Cargar datos de demostración" onClick={()=>demo.mutate()} disabled={demo.isPending || data.totalMovements>0} title={data.totalMovements>0?"La demo solo se carga sin movimientos":"Carga datos de ejemplo"}>{demo.isPending?"Cargando…":"Cargar demo"}</button>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">Gastos del día con comprobante</p><p className="text-sm text-[var(--dim)] mt-1">Suba la foto al empezar el gasto: la app lee el total en su dispositivo y llena el gasto.</p><button type="button" aria-label="Ir a Personal para probar la lectura del comprobante" className={btnGhost+" mt-2"} onClick={()=>goTab("personal")}>Probar en Personal</button></div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">Gráficas ingresos vs gastos</p><p className="text-sm text-[var(--dim)] mt-1">Por mes y por categoría.</p><button type="button" aria-label="Ir a Inicio para ver las gráficas" className={btnGhost+" mt-2"} onClick={()=>goTab("inicio")}>Ver gráficas</button></div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">Tandas</p><p className="text-sm text-[var(--dim)] mt-1">Cree su tanda e invite por correo.</p><button type="button" aria-label="Ir a Tandas desde la guía" className={btnGhost+" mt-2"} onClick={()=>goTab("tandas")}>Ir a Tandas</button></div>
            </div>
            <CollapsibleCard
              title={<h2 className="font-display font-bold text-lg">Guías por segmento</h2>}
              above={<>
              <p className="text-sm text-[var(--dim)] mt-1">Una guía por segmento · {guideCounts(MODULE_GROUPS).guides} guías en {guideCounts(MODULE_GROUPS).segments} segmentos</p>
              </>}
            >
              <div className="space-y-3 mt-3">
                {MODULE_GROUPS.map(g=>(
                  <div key={g.title}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] font-bold tracking-wide text-[var(--dim)]">{g.title.toUpperCase()}</p>
                      <button type="button" aria-label={`Leer la guía en PDF del segmento ${g.title}`} className={btnGhost+" shrink-0"} onClick={()=>setGuidePdf({title:g.title,src:GUIDE_PDF_BY_GROUP[g.title]||""})}>Guía en PDF</button>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {g.tabs.map(tid=>{ const t=TABS.find(x=>x.id===tid)!; const desc: Partial<Record<Tab,string>> = { inicio:"Disponible, gráficas y movimientos.", personal:"Su sueldo y sus gastos del día.", movimientos:"Registro con filtros y comprobantes.", cuentas:"Cuentas con saldo automático y arqueo de cuentas.", presupuestos:"Límites mensuales por categoría.", fondos:"Apartados en sus cuentas.", aportaciones:"Reparto del gasto compartido.", metas:"Ahorro con fecha.", acuerdos:"Votos de gastos mayores.", patrimonio:"Activos, pasivos y neto.", tandas:"Reunión, pase de lista y saldos.", categorias:"Categorías y subcategorías.", recurrentes:"Gastos que se repiten cada semana, quincena o mes.", perfiles:"Personas del hogar.", hogar:"Nombre, modo y reglas.", seguridad:"Seguridad de su información y bloqueo con PIN.", guia:"Instalación y guías.", legales:"Aviso de privacidad, términos, reembolsos y versión de prueba." }; return <div key={tid} className="py-2.5 flex items-start justify-between gap-2"><div><p className="font-semibold text-sm">{t.label}</p><p className="text-[13px] text-[var(--dim)]">{desc[tid]||""}</p></div><button type="button" aria-label={`Abrir el módulo ${t.label} desde la guía`} className={btnGhost+" shrink-0"} onClick={()=>goTab(tid)}>Abrir</button></div>; })}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          </section>
        )}

{effTab==="hogar" && (
          <section className="max-w-2xl space-y-4 md:space-y-6">
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-3" onSubmit={(e:FormEvent)=>{e.preventDefault();saveHh.mutate();}}>
              <h2 className="font-display font-bold text-lg">Hogar y ajustes</h2>
              <p className="text-sm text-[var(--dim)]">Cambie las reglas cuando quiera.</p>
              <div><Label htmlFor="edit-name">Nombre del hogar</Label><input id="edit-name" aria-label="Nombre del hogar editable" className={inputCls} defaultValue={hh.name} value={editName||undefined} placeholder={hh.name} onChange={e=>setEditName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="edit-cutoff">Día de corte</Label><input id="edit-cutoff" aria-label="Día de corte editable" type="number" min="1" max="28" className={inputCls} defaultValue={hh.cutoffDay} onChange={e=>{setEditCutoff(e.target.value);}} /></div>
                <div><Label htmlFor="edit-threshold">Umbral de aprobación ($)</Label><input id="edit-threshold" aria-label="Umbral de aprobación editable" type="number" min="0" className={inputCls} defaultValue={hh.approvalThreshold} onChange={e=>setEditThreshold(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="edit-mode">Modo del espacio</Label><select id="edit-mode" aria-label="Modo Personal o Familiar editable" className={inputCls} defaultValue={hh.mode} onChange={e=>setEditMode(e.target.value as "personal"|"familiar")}><option value="familiar">Familiar</option><option value="personal">Personal</option></select></div>
                <div><Label htmlFor="edit-contrib">Regla de aportación</Label><select id="edit-contrib" aria-label="Regla de aportación editable" className={inputCls} defaultValue={hh.contributionRule} onChange={e=>setEditContrib(e.target.value as "equal"|"proportional")}><option value="equal">Partes iguales</option><option value="proportional">Proporcional al ingreso</option></select></div>
                <div><Label htmlFor="edit-approval">Regla de aprobación</Label><select id="edit-approval" aria-label="Regla de aprobación editable" className={inputCls} defaultValue={hh.approvalRule} onChange={e=>setEditApproval(e.target.value as "unanimous"|"majority")}><option value="unanimous">Unánime</option><option value="majority">Mayoría</option></select></div>
              </div>
              <div><Label htmlFor="moneda-hogar">Moneda del hogar</Label><CurrencyPicker value={editCurrency||(hh.currency as HouseholdCurrency)||"MXN"} onChange={setEditCurrency} disabled={!isAdmin} /><p className="text-xs text-[var(--dim)] mt-1">Todo el hogar queda en esta moneda.</p><p className="text-xs text-[var(--dim)]">Si el hogar ya tiene movimientos, cambiar la moneda solo cambia el símbolo. Los importes guardados no se convierten.</p></div>
              {!isAdmin && <p className="text-sm text-[var(--red)]">Solo el administrador cambia las reglas.</p>}
              <button className={btnPrimary} disabled={saveHh.isPending || !isAdmin} onClick={()=>{ if(!editName) setEditName(hh.name); }}>{saveHh.isPending?"Guardando…":"Guardar reglas"}</button>
              {saveHh.isSuccess && <p className="text-sm text-[var(--green)]">Reglas guardadas.</p>}
            </form>
            <CollapsibleCard
              toggleLabel="los miembros del hogar"
              title={<h3 className="font-display font-bold text-lg">Miembros del hogar ({data.profiles.length})</h3>}
            >
              {data.profiles.map(p=><p key={p.id} className="text-sm py-1.5 border-b border-[var(--border)] last:border-0">{fullName(p)} · {p.role==="admin"?"Administrador del hogar":"Integrante"} · {p.kind==="adult"?"Adulto":"Dependiente"}{p.email?` · ${p.email}`:""}</p>)}
              <p className="text-xs text-[var(--dim)] mt-2">Invite en Perfiles → Invitaciones.</p>
            </CollapsibleCard>

            <CollapsibleCard
              open={activityOpen}
              onToggle={()=>setActivityOpen(v=>!v)}
              toggleLabel="el registro de actividad reciente"
              title={<span><span className="font-display font-bold text-lg">Registro de actividad reciente</span><span className="block text-xs text-[var(--dim)] mt-0.5">Últimas 30 · {data.activity.length} registrada{data.activity.length===1?"":"s"}</span></span>}
            >
              {data.activity.length===0 ? <p className="text-sm text-[var(--dim)] mt-2">Aún no hay operaciones registradas.</p> : <div className="divide-y divide-[var(--border)] mt-2">
                {data.activity.map(a=><div key={a.id} className="py-2 text-sm"><p><b>{a.action}</b>{a.detail?` — ${a.detail}`:""}</p><p className="text-xs text-[var(--dim)]">{new Date(a.createdAt).toLocaleString("es-MX",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</p></div>)}
              </div>}
            </CollapsibleCard>
            <CollapsibleCard
              open={quickGuideOpen}
              onToggle={()=>setQuickGuideOpen(v=>!v)}
              toggleLabel="la guía rápida"
              title={<span className="font-display font-bold text-lg">Guía rápida</span>}
              above={<p className="text-sm text-[var(--dim)] mt-1">5 pasos</p>}
            >
              <ol className="list-decimal ml-5 text-sm space-y-1.5 mt-2 text-[var(--dim)]">
                <li>Cree sus cuentas en <b>Cuentas</b>, con el saldo actual.</li>
                <li>Agregue a su pareja en <b>Perfiles</b>.</li>
                <li>Registre ingresos y gastos en <b>Movimientos</b>.</li>
                <li>Cree los <b>Presupuestos</b> del mes.</li>
                <li>Aparte en <b>Fondos</b>, defina una <b>Meta</b> y registre su <b>Patrimonio</b>.</li>
              </ol>
            </CollapsibleCard>
            <CollapsibleCard
              open={updatesOpen}
              onToggle={()=>setUpdatesOpen(v=>!v)}
              toggleLabel="las actualizaciones de la aplicación"
              title={<span><span className="font-display font-bold text-lg">Actualizaciones de la aplicación</span><span className="block text-xs text-[var(--dim)] mt-0.5">Versión: {APP_VERSION}</span></span>}
            >
              <p className="text-sm text-[var(--dim)] mt-2">Al actualizar no se cierra su sesión ni se borran sus datos.</p>
              <button type="button" className={btnGhost+" mt-2"} disabled={updateChecking} onClick={()=>{ void checkUpdatesManually(); }}>{updateChecking?"Revisando…":"Buscar actualizaciones"}</button>
              {updateCheckMsg && <p className="text-sm mt-2" role="status">{updateCheckMsg}</p>}
            </CollapsibleCard>
            <div className="pt-1">
              <button type="button" aria-label="Reiniciar la aplicación y borrar todos los datos" onClick={()=>{ setResetStep(1); setResetWord(""); }} className="text-xs text-[var(--dim)] underline">Reiniciar la aplicación</button>
              {resetStep>0 && (
                <div className="mt-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-3" role="dialog" aria-label="Confirmación para reiniciar la aplicación">
                  <p className="text-xs font-bold text-[var(--dim)]">Pregunta {resetStep} de 3</p>
                  {resetStep===1 && (
                    <>
                      <p className="text-sm">Se borrará todo de forma permanente: movimientos, cuentas, presupuestos, fondos, metas, acuerdos, patrimonio, tandas, invitaciones, perfiles, categorías y fotos, incluido su hogar. ¿Desea continuar?</p>
                      <div className="flex gap-2">
                        <button type="button" className={btnPrimary} onClick={()=>setResetStep(2)}>Sí, entiendo</button>
                        <button type="button" className={btnGhost} onClick={()=>setResetStep(0)}>Cancelar</button>
                      </div>
                    </>
                  )}
                  {resetStep===2 && (
                    <>
                      <p className="text-sm">Su hogar tiene {data.tandas.length} tanda(s) y {data.profiles.length} persona(s). Al reiniciar también se borrarán y no se podrán recuperar. ¿Está seguro?</p>
                      <div className="flex gap-2">
                        <button type="button" className={btnPrimary} onClick={()=>setResetStep(3)}>Sí, estoy seguro</button>
                        <button type="button" className={btnGhost} onClick={()=>setResetStep(0)}>Cancelar</button>
                      </div>
                    </>
                  )}
                  {resetStep===3 && (
                    <>
                      <p className="text-sm">Última confirmación. Para borrar todo, escriba REINICIAR.</p>
                      <div>
                        <Label htmlFor="reset-word">Escriba REINICIAR</Label>
                        <input id="reset-word" aria-label="Escriba REINICIAR para confirmar el reinicio" className={inputCls} value={resetWord} onChange={e=>setResetWord(e.target.value)} placeholder="REINICIAR" autoComplete="off" />
                      </div>
                      {resetAll.error && <p className="text-sm text-[var(--red)]">{String(resetAll.error)}</p>}
                      <div className="flex gap-2 flex-wrap">
                        <button type="button" aria-label="Confirmar: sí, borrar todo y reiniciar la aplicación" className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-bold disabled:opacity-50" disabled={resetWord.trim().toUpperCase()!=="REINICIAR" || resetAll.isPending} onClick={()=>resetAll.mutate()}>{resetAll.isPending?"Reiniciando…":"Sí, borrar todo"}</button>
                        <button type="button" aria-label="Cancelar el reinicio de la aplicación" className={btnGhost} onClick={()=>{ setResetStep(0); setResetWord(""); }}>Cancelar</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
        {effTab==="seguridad" && (
          <section className="max-w-2xl space-y-4 md:space-y-6">
            <div>
              <h2 className="font-display font-bold text-lg">Seguridad</h2>
              <p className="text-sm text-[var(--dim)]">Su información y el bloqueo con PIN en este dispositivo.</p>
            </div>
            <CollapsibleCard
              toggleLabel="la seguridad de su información"
              title={<h3 className="font-display font-bold text-lg">Seguridad de su información</h3>}
              above={<p className="text-sm text-[var(--dim)] mt-1">7 puntos</p>}
              below={<button type="button" aria-label="Cerrar sesión en este dispositivo" className="rounded-full border px-3 py-2 text-sm font-bold mt-3" onClick={()=>{ void signOut().then(()=>window.location.reload()); }}>Cerrar sesión en este dispositivo</button>}
            >
              <ul className="list-disc ml-5 text-sm space-y-1.5 mt-2 text-[var(--dim)]">
                <li>Contraseña de 12 caracteres; bloqueo 15 min tras 5 intentos.</li>
                <li>Cada registro se valida en el servidor.</li>
                <li>Lo privado solo lo ve su autor.</li>
                <li>Límite de peticiones por minuto.</li>
                <li>Sin claves en el código.</li>
                <li>Bloqueo con PIN en este dispositivo (opcional).</li>
                <li>Cierre de sesión en este dispositivo.</li>
              </ul>
            </CollapsibleCard>
            <CollapsibleCard
              toggleLabel="el bloqueo con PIN"
              title={<h3 className="font-display font-bold text-lg">Bloqueo con PIN en este dispositivo</h3>}
              above={<p className="text-sm text-[var(--dim)] mt-1">{pinSetState ? "PIN activo" : "Sin PIN"}</p>}
            >
              <p className="text-sm text-[var(--dim)] mt-1">Pide un PIN de 4 dígitos al reabrir la app en este dispositivo. Es un bloqueo local: no cifra sus datos y no impide entrar desde otro dispositivo con su cuenta.</p>
              {pinSetState ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm"><b>PIN activo</b> en este dispositivo.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="pin-current">PIN actual</Label><input id="pin-current" aria-label="PIN actual" type="password" inputMode="numeric" maxLength={4} autoComplete="off" className={inputCls} value={pinCurrent} onChange={e=>setPinCurrent(e.target.value.replace(/\D/g,""))} /></div>
                    <div><Label htmlFor="pin-new">PIN nuevo</Label><input id="pin-new" aria-label="PIN nuevo de 4 dígitos" type="password" inputMode="numeric" maxLength={4} autoComplete="off" className={inputCls} value={pinNew1} onChange={e=>setPinNew1(e.target.value.replace(/\D/g,""))} /></div>
                    <div><Label htmlFor="pin-new2">Repita el PIN nuevo</Label><input id="pin-new2" aria-label="Repita el PIN nuevo" type="password" inputMode="numeric" maxLength={4} autoComplete="off" className={inputCls} value={pinNew2} onChange={e=>setPinNew2(e.target.value.replace(/\D/g,""))} /></div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className={btnPrimary} onClick={()=>void changePin()}>Cambiar PIN</button>
                    <button type="button" className={btnGhost} onClick={()=>void removePin()}>Quitar PIN</button>
                    <button type="button" className={btnGhost} onClick={()=>{ pinLock(); setPinLocked(true); }}>Bloquear ahora</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="pin-new1">PIN de 4 dígitos</Label><input id="pin-new1" aria-label="PIN nuevo de 4 dígitos" type="password" inputMode="numeric" maxLength={4} autoComplete="off" className={inputCls} value={pinNew1} onChange={e=>setPinNew1(e.target.value.replace(/\D/g,""))} /></div>
                    <div><Label htmlFor="pin-new2b">Repita el PIN</Label><input id="pin-new2b" aria-label="Repita el PIN nuevo" type="password" inputMode="numeric" maxLength={4} autoComplete="off" className={inputCls} value={pinNew2} onChange={e=>setPinNew2(e.target.value.replace(/\D/g,""))} /></div>
                  </div>
                  <button type="button" className={btnPrimary} onClick={()=>void createPin()}>Activar PIN</button>
                </div>
              )}
              {pinMsg && <p className="text-sm text-[var(--green)] mt-2">{pinMsg}</p>}
            </CollapsibleCard>
          </section>
        )}
        {effTab==="desarrollador" && isAppOwner && (
          <section className="max-w-2xl space-y-4 md:space-y-6">
            <h2 className="font-display font-bold text-lg">Desarrollador</h2>
            <p className="text-sm text-[var(--dim)]">Herramientas del dueño de la app: opiniones de los testers y registro de usuarios.</p>
            <CollapsibleCard
              open={devFeedbackOpen}
              onToggle={()=>setDevFeedbackOpen(v=>!v)}
              toggleLabel="las opiniones de los testers"
              title={<span><span className="font-display font-bold text-lg">Opiniones de testers</span><span className="block text-xs text-[var(--dim)] mt-0.5">{fbQuery.data ? `${fbQuery.data.feedback.length} opinion${fbQuery.data.feedback.length===1?"":"es"}` : "Opiniones enviadas desde el formulario público."}</span></span>}
            >
                <p className="text-xs text-[var(--dim)] mt-2">Solo las ve el dueño de la app.</p>
                {fbQuery.isPending ? <p className="text-sm text-[var(--dim)] mt-2">Cargando opiniones…</p>
                : fbQuery.error ? <p className="text-sm text-[var(--red)] mt-2">No se pudieron cargar las opiniones.</p>
                : !fbQuery.data || fbQuery.data.feedback.length===0 ? <p className="text-sm text-[var(--dim)] mt-2">Sin opiniones todavía. Cuando un tester envíe la suya, aparecerá aquí.</p>
                : <FeedbackReviewList items={fbQuery.data.feedback} busy={setFbStatus.isPending} onSave={(v)=>{ setFbSaveError(null); setFbStatus.mutate({ ...v, householdId: data!.household!.id }); }} saveError={fbSaveError} onOpen={()=>markOpinionNotifRead.mutate()} />}
            </CollapsibleCard>
            <CollapsibleCard
              open={devUsersOpen}
              onToggle={()=>setDevUsersOpen(v=>!v)}
              toggleLabel="los usuarios de la app"
              title={<span><span className="font-display font-bold text-lg">Usuarios de la app</span><span className="block text-xs text-[var(--dim)] mt-0.5">{appUsersQuery.data ? `${appUsersQuery.data.total} usuario${appUsersQuery.data.total===1?"":"s"} han entrado` : "Quiénes han entrado a la app."}</span></span>}
            >
                <p className="text-xs text-[var(--dim)] mt-2">Solo lo ve el dueño de la app.</p>
                {appUsersQuery.isPending ? <p className="text-sm text-[var(--dim)] mt-2">Cargando usuarios…</p>
                : appUsersQuery.error ? <p className="text-sm text-[var(--red)] mt-2">No se pudieron cargar los usuarios.</p>
                : !appUsersQuery.data || appUsersQuery.data.total===0 ? <p className="text-sm text-[var(--dim)] mt-2">Sin usuarios todavía.</p>
                : <>
                  <p className="text-sm mt-2"><b>{appUsersQuery.data.total}</b> {appUsersQuery.data.total===1?"usuario ha entrado":"usuarios han entrado"} a la app.</p>
                  <div className="divide-y divide-[var(--border)] mt-2">
                    {appUsersQuery.data.users.map(u=>(
                      <div key={u.id} className="py-2.5 text-sm">
                        <div className="flex justify-between gap-2"><b>{u.name || u.email || "Usuario"}</b><span className="text-xs text-[var(--dim)] shrink-0">{u.lastSignInAt?`Último acceso: ${fmtDate(u.lastSignInAt.slice(0,10))}`:"Sin accesos registrados"}</span></div>
                        {u.email && <p className="text-xs text-[var(--dim)]">{u.email}</p>}
                        <p className="text-xs text-[var(--dim)]">Registro: {fmtDate(u.createdAt.slice(0,10))}</p>
                      </div>
                    ))}
                  </div>
                </>}
            </CollapsibleCard>
            <CollapsibleCard
              open={devUsageOpen}
              onToggle={()=>setDevUsageOpen(v=>!v)}
              toggleLabel="la analítica de uso"
              title={<span><span className="font-display font-bold text-lg">Analítica de uso</span><span className="block text-xs text-[var(--dim)] mt-0.5">Qué módulos y botones usan los testers durante la prueba.</span></span>}
            >
                <p className="text-xs text-[var(--dim)] mt-2">Solo la ve el dueño de la app. Solo se registran el módulo y el botón; no se guardan importes, conceptos, cuentas ni comprobantes.</p>
                {usageQuery.isPending ? <p className="text-sm text-[var(--dim)] mt-2">Cargando analítica…</p>
                : usageQuery.error ? <p className="text-sm text-[var(--red)] mt-2">No se pudo cargar la analítica.</p>
                : !usageQuery.data || usageQuery.data.tableMissing ? <p className="text-sm text-[var(--dim)] mt-2">Aún sin datos: falta correr supabase/add-usage-events.sql en casa. La app sigue funcionando igual.</p>
                : usageQuery.data.totals.length===0 ? <p className="text-sm text-[var(--dim)] mt-2">Sin eventos todavía. Cuando un tester entre a un módulo o guarde algo, aparecerá aquí.</p>
                : <>
                  <p className="text-sm font-bold mt-3">Botones más usados (todos)</p>
                  <div className="mt-1">
                    {usageQuery.data.totals.filter(t=>t.action!=="ver_modulo").map(t=>(
                      <div key={t.action} className="flex items-center gap-2 py-1 text-sm">
                        <span className="min-w-0 flex-1">{usageActionLabel(t.action)}</span>
                        <span className="shrink-0 h-2 rounded-full" style={{width: Math.max(8, Math.round(120*t.count/usageQuery.data!.totals.filter(x=>x.action!=="ver_modulo").reduce((m,x)=>Math.max(m,x.count),1))), backgroundColor:"#00C2B5"}} />
                        <b className="shrink-0" style={{color:"#00C2B5"}}>{t.count}</b>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm font-bold mt-4">Por usuario</p>
                  <div className="divide-y divide-[var(--border)] mt-1">
                    {usageQuery.data.users.map(u=>{
                      const au=appUsersQuery.data?.users.find(x=>x.id===u.userId);
                      const open=usageDetailUser===u.userId;
                      const evs=usageQuery.data!.events.filter(e=>e.userId===u.userId).slice(0,20);
                      return (
                      <div key={u.userId} className="py-2.5 text-sm">
                        <div className="flex justify-between gap-2"><b>{au?.name || au?.email || "Usuario"}</b><span className="text-xs text-[var(--dim)] shrink-0">{u.total} evento{u.total===1?"":"s"}</span></div>
                        {au?.email && <p className="text-xs text-[var(--dim)]">{au.email}</p>}
                        <p className="text-xs text-[var(--dim)]">Módulos: {u.modules.map(m=>`${usageModuleLabel(m.module)} ${m.count}`).join(" · ") || "—"}</p>
                        <p className="text-xs text-[var(--dim)]">Botones: {u.actions.filter(a=>a.action!=="ver_modulo").map(a=>`${usageActionLabel(a.action)} ${a.count}`).join(" · ") || "—"}</p>
                        <button type="button" className="text-xs font-bold mt-1" style={{color:"#00C2B5"}} aria-label={open?`Cerrar el detalle de ${au?.name || "este usuario"}`:`Ver el detalle de ${au?.name || "este usuario"}`} onClick={()=>setUsageDetailUser(open?null:u.userId)}>{open?"Cerrar detalle":"Ver detalle"}</button>
                        {open && <div className="mt-1">
                          {evs.length===0 ? <p className="text-xs text-[var(--dim)]">Sin eventos.</p> : evs.map((e,i)=>(
                            <p key={i} className="text-xs py-0.5"><span className="text-[var(--dim)]">{fmtDate(e.createdAt.slice(0,10))} {e.createdAt.slice(11,16)}</span> · {usageModuleLabel(e.module)} · {usageActionLabel(e.action)}</p>
                          ))}
                        </div>}
                      </div>);
                    })}
                  </div>
                  <p className="text-xs text-[var(--dim)] mt-3">Se borra al terminar el piloto.</p>
                </>}
            </CollapsibleCard>
          </section>
        )}
        {effTab==="legales" && (
          <section className="max-w-2xl space-y-4 md:space-y-6">
            <div>
              <h2 className="font-display font-bold text-lg">Documentos legales</h2>
              <p className="text-sm text-[var(--dim)]">Aviso de privacidad, términos y condiciones, política de reembolsos y versión de prueba. Son borradores pendientes de revisión de un abogado.</p>
            </div>
            <LegalDocumentsView acceptedAt={legalQuery.data?.acceptedAt ?? null} />
            <AboutSection onReadDoc={scrollToLegalDoc} />
          </section>
        )}
      </main>
      <InstallStepsDialog open={installStepsOpen} onClose={()=>setInstallStepsOpen(false)} />
      <HelpAssistant onGo={goTab} open={helpOpen} onOpenChange={setHelpOpen} hidden={menuOpen} dynamicFaqs={dynamicFaqs} overview={data} nudge={activeNudge} />
      {feedbackOpen && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={feedbackShowMessages ? "Respuesta a tu comentario" : "Enviar comentarios"}>
        <TesterFeedbackForm embedded initialNombre={meEarly ? fullName(meEarly) : ""} initialCorreo={myEmail} showMyMessages={feedbackShowMessages} onClose={()=>{ setFeedbackShowMessages(false); setFeedbackOpen(false); }} />
      </div>}
      {guidePdf && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Guía en PDF: ${guidePdf.title}`}>
        <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]">
            <div className="min-w-0"><p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">GUÍA DE USO · PDF</p><p className="font-display font-bold leading-tight truncate">{guidePdf.title}</p></div>
            <button type="button" aria-label="Cerrar la guía en PDF" onClick={()=>setGuidePdf(null)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          </div>
          <div className="overflow-y-auto p-3">
            <PdfViewer src={guidePdf.src} ariaLabel={`Guía en PDF del segmento ${guidePdf.title}`} labels={{loading:"Cargando la guía…",loadError:"No fue posible cargar la guía. Verifique su conexión e inténtelo de nuevo.",pageError:"No fue posible mostrar esta página de la guía.",previousPage:"Página anterior",nextPage:"Página siguiente",pageIndicator:(p,t)=>`Página ${p} de ${t}`,navigationAriaLabel:"Navegación de páginas de la guía",pageAriaLabel:(p,t)=>`Página ${p} de ${t} de la guía`}} />
          </div>
          <p className="px-3 py-2.5 border-t border-[var(--border)] text-xs text-[var(--dim)]">Cierre con la ×.</p>
        </div>
      </div>}
      {incExpDetail && <IncExpDetailModal
        kind={incExpDetail.kind}
        label={incExpDetail.label}
        householdCurrency={hh.currency}
        loading={incExpLoading}
        movementCount={incExpBase.length}
        accountCount={incExpByAcc.length}
        total={incExpBase.reduce((a,m)=>a+m.amount,0)}
        hiddenCount={incExpHiddenCount}
        view={incExpView}
        onViewChange={setIncExpView}
        groups={incExpByAcc}
        flatMovs={sortMovementsByDate(incExpMovs)}
        getCatName={getCatName}
        getAccName={getAccName}
        onClose={()=>setIncExpDetail(null)}
        onGoMovements={()=>{setIncExpDetail(null); goTab("movimientos");}}
      />}
      {catDetail && <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Gastos de ${catDetail.name} de ${fmtMonth(catDetail.month)}`} onClick={()=>setCatDetail(null)}>
        <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4" onClick={e=>e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">GASTOS · {fmtMonth(catDetail.month).toUpperCase()}</p>
              <p className="font-display font-bold text-lg leading-tight">Gastos de {catDetail.name}</p>
              <p className="text-sm text-[var(--dim)] mt-1">{catDetailBase.length} gasto(s) · {catDetail.pct}% del gasto del mes</p>
            </div>
            <button type="button" aria-label="Cerrar los gastos del rubro" onClick={()=>setCatDetail(null)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          </div>
          <p className="font-display text-2xl font-extrabold mt-2 whitespace-nowrap">−{money2(catDetail.total)}</p>
          {catDetailHiddenCount>0 && <p className="text-xs text-[var(--dim)] mt-1">No se muestran {catDetailHiddenCount} gasto(s) privado(s) de otros integrantes del hogar.</p>}
          <div className="mt-2">
            {catDetailBase.length===0 && <p className="text-sm text-[var(--dim)]">Sin gastos registrados en este rubro.</p>}
            {catDetailMovs.map(m=><div key={m.id} className="flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm"><span className="min-w-0">{m.concept}<span className="text-[var(--dim)] block text-xs">{fmtDate(m.date)}{m.subcategory?` · ${m.subcategory}`:""} · {getAccName(m.accountId)} · {m.visibility==="shared"?"Compartido":"Privado"}</span></span><b className="shrink-0 whitespace-nowrap">−{money(m.amount)}</b></div>)}
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{setCatDetail(null); goTab("movimientos");}}>Ver todos los movimientos</button>
            <button type="button" className={btnGhost} onClick={()=>setCatDetail(null)}>Cerrar</button>
          </div>
        </div>
      </div>}
      {fundDetail && <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Detalle del fondo ${fundDetail.name}`} onClick={closeFundDetail}>
        <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4" onClick={e=>e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">FONDO</p>
              <p className="font-display font-bold text-lg leading-tight">{fundDetail.name}</p>
              <p className="text-sm text-[var(--dim)] mt-1">{fundDetail.targetAmount ? `${fundPct(fundDetail)}% · ${money(fundDetail.balance)} de ${money(fundDetail.targetAmount)} · ${fundDetail.targetAmount-fundDetail.balance>0?`Restan ${money(fundDetail.targetAmount-fundDetail.balance)} para el fondo`:"Meta alcanzada"}` : `${money(fundDetail.balance)} · Sin meta`}</p>
            </div>
            <button type="button" aria-label="Cerrar el detalle del fondo" onClick={closeFundDetail} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          </div>
          {fundDetail.targetAmount ? <div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${fundPct(fundDetail)}%`}} /></div> : null}
          {fundDetail.targetDate && <p className="text-sm mt-2">Meta {fmtDate(fundDetail.targetDate)}{(()=>{const need=fundNeedPerMonth(fundDetail); return need!==null && need>0 ? ` · faltan ${money(need)}/mes` : "";})()}</p>}
          <p className="text-sm mt-2">Importancia: {"★".repeat(fundDetail.importance ?? 3)}{"☆".repeat(5-(fundDetail.importance ?? 3))} {fundDetail.importance ?? 3} de 5 <button type="button" aria-label={`Cambiar la importancia de ${fundDetail.name}`} className="text-xs underline font-bold ml-1" onClick={()=>{setImpEditFundId(impEditFundId===fundDetail.id?null:fundDetail.id); setImpEditFundValue(String(fundDetail.importance ?? 3));}}>Cambiar</button></p>
          {impEditFundId===fundDetail.id && renderFundImpEditor(fundDetail)}
          {renderFundPlan(fundDetail, (amt, accId) => { setQuickFundId(fundDetail.id); setQuickFundAmt(String(amt)); setQuickFundAcc(accId != null ? String(accId) : ""); setQuickFundAccError(""); })}
          {quickFundId===fundDetail.id && renderQuickFundForm(fundDetail)}
          <div className="flex gap-2 mt-4">
            <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{closeFundDetail(); goTab("fondos");}}>Ver en Fondos</button>
            <button type="button" className={btnGhost} onClick={closeFundDetail}>Cerrar</button>
          </div>
        </div>
      </div>}
      {coquito && (()=>{
        const goal=coquito.goalId!=null ? data.goals.find((g)=>g.id===coquito.goalId) ?? null : null;
        return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Consejo para ahorrar" onClick={()=>closeCoquito()}>
          <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-display font-bold text-lg leading-tight">Consejo para ahorrar</p>
              <button type="button" aria-label="Cerrar el consejo" onClick={()=>closeCoquito()} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            {coquitoDone ? (<>
              <p className="text-sm mt-2">Propuesta creada. Revise la meta {goal ? <b>{goal.name}</b> : "elegida"} para aceptarla: el sobrante se mueve a su fondo solo si usted la acepta.</p>
              <div className="flex gap-2 mt-4">
                <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{closeCoquito(); goTab("metas");}}>Ver la meta</button>
                <button type="button" className={btnGhost} onClick={()=>closeCoquito()}>Cerrar</button>
              </div>
            </>) : (<>
              <p className="text-sm mt-2">{coquito.kind==="excedido"
                ? <>Si baja <b className="whitespace-nowrap">{money(coquito.amount)}</b> en <b>{coquito.catName}</b>, puede moverlos al fondo de su meta{goal ? <><b> {goal.name}</b></> : ""}.</>
                : <>Te sobran <b className="whitespace-nowrap">{money(coquito.amount)}</b> en <b>{coquito.catName}</b>. Puede moverlos al fondo de su meta{goal ? <><b> {goal.name}</b></> : ""}.</>}</p>
              {!goal && <p className="text-sm text-[var(--dim)] mt-2">Cree una meta para apartar este sobrante.</p>}
              {coquito.kind==="excedido" && <p className="text-xs text-[var(--dim)] mt-2">Este consejo no mueve dinero: el ahorro se concreta cuando el gasto realmente baja.</p>}
              {coquitoError && <p className="text-sm text-[var(--red)] mt-2">{coquitoError}</p>}
              <div className="flex gap-2 mt-4">
                {goal && coquito.kind==="sobrante" && <button type="button" className={btnPrimary+" flex-1"} disabled={proposeAdj.isPending} onClick={async ()=>{ setCoquitoError(""); try { await proposeAdj.mutateAsync({goalId:goal.id,kind:"sobrante",cuts:[{budgetId:coquito.budgetId,amount:coquito.amount}]}); setCoquitoDone(true); } catch(e){ setCoquitoError(e instanceof Error ? e.message : String(e)); } }}>{proposeAdj.isPending?"Guardando…":"Proponer mover sobrante"}</button>}
                {goal && coquito.kind==="excedido" && <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{closeCoquito(); goTab("metas");}}>Ver la meta</button>}
                {!goal && <button type="button" className={btnPrimary+" flex-1"} onClick={()=>{closeCoquito(); setNewGoalOpen(true); goTab("metas");}}>Crear meta</button>}
                <button type="button" className={btnGhost} onClick={()=>closeCoquito()}>Cerrar</button>
              </div>
            </>)}
          </div>
        </div>
        );
      })()}
      {planWizardOpen && <PlanFinancieroWizard
        householdId={data!.household!.id}
        currentYm={s.currentMonth}
        cutoffDay={data!.household!.cutoffDay}
        profile={me ?? null}
        accounts={data!.accounts}
        monthIncome={data!.summary.monthIncome}
        categories={data!.categories}
        categoryTotals={data!.categoryMonthlyTotals}
        existingBudgets={data!.budgets}
        onClose={()=>setPlanWizardOpen(false)}
        onCreated={()=>{ inv(); }}
        createGoal={(args)=>api.saveGoalWithPlan(args)}
        createFund={(args)=>api.saveFund(args)}
        createBudget={(args)=>api.saveBudget(args)}
      />}
      {inicioMvOpen && <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Registrar movimiento" onClick={()=>closeInicioMovement()}>
        <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
          <button type="button" aria-label="Cerrar el registro de movimiento" onClick={()=>closeInicioMovement()} className="absolute right-3 top-3 z-10 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          {renderMvForm()}
        </div>
      </div>}
      {showSummary && <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Resumen del mes de ${fmtMonth(s.currentMonth)}`} onClick={()=>{setShowSummary(false);}}>
        <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4" onClick={e=>e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">RESUMEN · {fmtMonth(s.currentMonth).toUpperCase()}</p>
              <p className="font-display font-bold text-lg leading-tight">Resumen del mes</p>
            </div>
            <button type="button" aria-label="Cerrar el resumen del mes" onClick={()=>{setShowSummary(false);}} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          </div>
          <p className="text-sm text-[var(--dim)] mt-2">Disponible · {s.currentMonth}</p>
          <p className="font-display text-3xl font-extrabold mt-1">{money2(s.availableFree)}</p>
          <p className="text-sm text-[var(--dim)] mt-1">Total {money2(s.totalBalance)} − fondos apartados {money2(s.fundsReserved)}.</p>
          {/* El detalle ya no se despliega sobre la tarjeta: abre el pop-up
              «Dónde está su dinero», con el saldo por cuenta y tipo de cuenta. */}
          <button type="button" onClick={()=>setShowMoneyLocation(true)} className="text-sm font-bold underline underline-offset-2 mt-1">Ver dónde está su dinero ›</button>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-xs text-[var(--dim)]">Entradas</p><p className="font-display font-bold text-lg">{money(s.monthIncome)}</p></div>
            <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-xs text-[var(--dim)]">Salidas</p><p className="font-display font-bold text-lg">{money(s.monthExpense)}</p></div>
            <div className="bg-[var(--surface2)] rounded-2xl py-2"><p className="text-xs text-[var(--dim)]">Neto</p><p className="font-display font-bold text-lg">{money(s.monthNet)}</p></div>
          </div>
          {activeGoalPlans.length>0 && <p className="text-sm mt-3">Te queda del mes: <b className="whitespace-nowrap">{money(monthRemaining)}</b>{monthShortfall>0 && <> · Te falta ahorrar este mes: <b className="whitespace-nowrap">{money(monthShortfall)}</b></>}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" className={btnGhost+" flex-1"} onClick={()=>{setShowSummary(false);}}>Cerrar</button>
          </div>
        </div>
      </div>}
      {showMoneyLocation && <MoneyLocationModal
        monthLabel={fmtMonth(s.currentMonth)}
        householdCurrency={hh.currency}
        availableFree={s.availableFree}
        totalBalance={s.totalBalance}
        fundsReserved={s.fundsReserved}
        groups={buildBalanceBreakdown({accounts: data.accounts, unassignedNet: s.unassignedNet, totalBalance: s.totalBalance, fundsReserved: s.fundsReserved, availableFree: s.availableFree}).groups}
        unassignedNet={s.unassignedNet}
        openingBalance={s.openingBalance}
        priorMonthsNet={s.priorMonthsNet}
        monthNet={s.monthNet}
        fundsFromAccounts={s.fundsFromAccounts}
        totalInFunds={s.totalInFunds}
        funds={data.funds}
        accountSummaries={accountSummaries}
        onClose={()=>setShowMoneyLocation(false)}
      />}
      {receiptView && <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-3" role="dialog" aria-label="Fotografía del comprobante en tamaño completo">
        <img src={receiptView} alt="Fotografía del comprobante adjunta al gasto, en tamaño completo" className="max-h-[78vh] w-auto rounded-2xl object-contain" />
        <p className="text-white/80 text-xs mt-3">Comprobante del gasto.</p>
        <button aria-label="Cerrar fotografía del comprobante" className="mt-3 bg-[var(--surface)] text-[var(--text)] font-bold rounded-full px-6 py-2.5" onClick={()=>setReceiptView(null)}>Cerrar</button>
      </div>}
      {pinLocked && (
        <div className="fixed inset-0 z-[70] bg-[var(--bg)] flex flex-col items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Desbloquear SyncFinanzas con PIN">
          <p className="font-display font-extrabold text-xl">SyncFinanzas</p>
          <p className="text-sm text-[var(--dim)] mt-2 text-center">Escriba su PIN de 4 dígitos para entrar.</p>
          <form className="w-full max-w-xs mt-4 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); void unlockPin();}}>
            <input aria-label="PIN de 4 dígitos" type="password" inputMode="numeric" maxLength={4} autoComplete="off" autoFocus className={inputCls+" text-center text-2xl font-bold tracking-[0.5em]"} value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,""))} />
            {pinError && <p className="text-sm text-[var(--red)] text-center">{pinError}</p>}
            <button className={btnPrimary+" w-full"} disabled={pinBusy || pinInput.length!==4}>{pinBusy?"Comprobando…":"Desbloquear"}</button>
          </form>
          <button type="button" className="text-xs underline mt-4" onClick={async()=>{ pinRemove(); setPinSetState(false); setPinLocked(false); await signOut(); window.location.reload(); }}>Olvidé mi PIN · Cerrar sesión y quitar el PIN</button>
          <p className="text-xs text-[var(--dim)] mt-4 text-center max-w-xs">Bloqueo local en este dispositivo: no cifra sus datos.</p>
        </div>
      )}
      {/* Menú rápido: fijo abajo en todas las pestañas; se oculta mientras
          el cajón está abierto (el cajón se cierra con su × o tocando fuera de él). */}
      {!menuOpen && (
        <QuickBar
          currentTab={effTab}
          menuOpen={menuOpen}
          shortcuts={quickShortcuts}
          tabLabel={tabLabel}
          onToggleMenu={() => setMenuOpen((o) => !o)}
          onNewExpense={() => openNewMovement("expense")}
          onGoTab={(t) => { goTab(t); setMenuOpen(false); if (t === "inicio") window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60); }}
        />
      )}
    </div>
  );
}
