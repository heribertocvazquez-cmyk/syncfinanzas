import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./components/SafeArea";
import { readInviteToken, type InvitePreview } from "./components/AuthGate";
import { fileToBase64 } from "./lib/file";
import { checkReceiptDate, matchRule, normText, parseReceiptText, parseVoiceText, resolveReceiptCategory, suggestCategoryId } from "./lib/smart";
import type { ReceiptDateCheck } from "./lib/smart";
import type { ReceiptRead } from "./lib/smart";
import { readReceiptText, ocrStatusText, OcrError } from "./lib/ocr";
import { downloadTextFile, parseCsv, toCsv } from "./lib/csv";
import { pinCheck, pinIsSet, pinLock, pinMarkUnlocked, pinRemove, pinSet, pinUnlocked } from "./lib/pin";
import { canSeeMovementRow, defaultCashAccountId, groupMovementsByAccount, monthMovements, movementTitle, requiredAccountNotice, sortMovementsByDate, type IncExpDetailView } from "./lib/movementsList";
import { categoryCounts, guideCounts, invitationCounts, sumBudgets, sumCashCounts, sumContributions, sumGoals, sumMonthMovements } from "./lib/cardSummaries";
import { MovementsFilter } from "./components/MovementsFilter";
import { DEFAULT_MOVEMENTS_FILTER, filterMovements, type MovementsFilterValue } from "./lib/movementsFilter";
import { buildBalanceBreakdown } from "./lib/balanceBreakdown";
import { MoneyLocationModal } from "./components/MoneyLocationModal";
import { IncExpDetailModal } from "./components/IncExpDetailModal";
import { HomeMovementsCard } from "./components/HomeMovementsCard";
import { CollapsibleCard } from "./components/CollapsibleCard";
import { money, money2, fmtDate, todayISO } from "./lib/format";
import { Stars, Label, inputCls, btnPrimary, btnGhost, Empty } from "./lib/uiShared";
import { OcrDetail } from "./components/OcrDetail";
import { TandasModule } from "./components/TandasModule";
import { HomeTandasCard } from "./components/HomeTandasCard";
import type { TandaDetailDeps, TandaInviteSend as InviteSend, TandaProofReview } from "./components/TandaDetail";
import { DrawerMenu, type DrawerMenuSection } from "./components/DrawerMenu";
import { DRAWER_GROUPS, orderDrawerTabs } from "./lib/drawerOrder";
import { HELP_FAQS, HELP_GREETED_KEY, buildGreeting, dynamicHelpFaqs, findHelpAnswer, frequentQuestions, loadHelpLearning, loadNudgeShown, markNudgeShown, matchSavingsWizard, pickHelpNudge, pickOpeningMessage, predictHelp, recordHelpLearning, recordHelpQuestion, reviewMovement, wizardMotive, wizardResultText, wizardStep, type HelpFaq, type HelpMsg, type HelpNudge, type OverviewData, type WizardState } from "./lib/helpDynamic";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, XAxis, YAxis } from "recharts";
import { api, fetchSession, signOut } from "./api";
import { PdfViewer } from "./components/PdfViewer";
import guiaResumenPdf from "./assets/guia-resumen-registro.pdf";
import guiaPlanificacionPdf from "./assets/guia-planificacion.pdf";
import guiaDecisionesPdf from "./assets/guia-decisiones-patrimonio.pdf";
import guiaTandasPdf from "./assets/guia-tandas.pdf";
import guiaConfiguracionPdf from "./assets/guia-configuracion-ayuda.pdf";
import { APP_VERSION } from "./version";
import { APP_UPDATE_EVENT, applyAppUpdate, checkForAppUpdate, isUpdateAvailable } from "./serviceWorkerUpdate";
import { clearDeferredInstallPrompt, consumeDeferredInstallPrompt } from "./installPrompt";
import appIcon512 from "./assets/app-icon-512.png";

export type Tab = "inicio"|"personal"|"tandas"|"movimientos"|"cuentas"|"categorias"|"presupuestos"|"fondos"|"aportaciones"|"metas"|"acuerdos"|"patrimonio"|"perfiles"|"hogar"|"guia"|"desarrollador";
const TABS: {id:Tab;label:string}[] = [
  {id:"inicio",label:"Inicio"},{id:"personal",label:"Personal"},{id:"movimientos",label:"Movimientos"},{id:"cuentas",label:"Cuentas"},{id:"presupuestos",label:"Presupuestos"},
  {id:"fondos",label:"Fondos"},{id:"aportaciones",label:"Aportaciones"},{id:"metas",label:"Metas"},{id:"acuerdos",label:"Acuerdos"},{id:"tandas",label:"Tandas"},
  {id:"patrimonio",label:"Patrimonio"},{id:"categorias",label:"Categorías"},{id:"perfiles",label:"Perfiles"},{id:"hogar",label:"Hogar"},{id:"guia",label:"Guía de uso"},{id:"desarrollador",label:"Desarrollador"},
];
// Los módulos se agrupan por función: varios se desprenden de otros (Aportaciones se calcula
// desde Movimientos; Fondos son apartados dentro de Cuentas; Presupuestos vigilan Categorías).
const MODULE_GROUPS: {title:string; tabs:Tab[]}[] = [
  {title:"Resumen y registro diario", tabs:["inicio","personal","movimientos","cuentas"]},
  {title:"Planificación", tabs:["presupuestos","fondos","aportaciones","metas"]},
  {title:"Decisiones y patrimonio", tabs:["acuerdos","patrimonio"]},
  {title:"Tandas", tabs:["tandas"]},
  {title:"Configuración y ayuda", tabs:["categorias","perfiles","hogar","guia"]},
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

const DONUT_COLORS=["#C5962C","#2E86AB","#1B7A4D","#B42318","#7C5CBF","#D97A3D","#4A9B8E","#8A6D3B","#5B7FA6","#A34A6B","#6B8E23","#9C6B30","#3E7CB1","#C0504D"];
// Gama propia de la dona de Inicio (propuesta Unslop): sin verde ni rojo,
// que ya son los colores del flujo de dinero. Los seis primeros son los de
// la propuesta; el resto son valores ya usados en el proyecto.
const DONUT_PALETTE_INICIO=["#C5962C","#2E86AB","#7C5CBF","#D97A3D","#4A9B8E","#8A6D3B","#5B7FA6","#A34A6B","#9C6B30","#3E7CB1"];
type CatSlice = {categoryId:number|null;name:string;total:number;pct:number};
// Símbolo de línea (SVG blanco, sin emojis) dentro de cada segmento de la
// dona de gasto por categoría, por nombre de categoría. Reutiliza los
// trazos de línea del proyecto (mismo estilo que los iconos del menú) y
// agrega los que faltaban en ese mismo estilo. Las categorías creadas por
// la persona usan el símbolo genérico de etiqueta.
const CAT_DONUT_ICONS: Record<string, ReactNode> = {
  "Alimentación": (<><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></>),
  "Vivienda": (<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>),
  "Transporte": (<><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></>),
  "Salud": (<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>),
  "Educación": (<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>),
  "Servicios": (<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>),
  "Entretenimiento": (<><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></>),
  "Ropa": (<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>),
  "Mascotas": (<path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z"/>),
  "Deudas": (<><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>),
  "Impuestos": (<><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></>),
  "Viajes": (<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>),
  "Cuidado personal": (<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></>),
  "Otro gasto": (<><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></>),
};
const CAT_DONUT_ICON_DEFAULT: ReactNode = (<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>);
// Etiqueta de la dona: dibuja el símbolo blanco del rubro en el centro de
// su segmento. Los símbolos son discretos (cerca de la mitad del grosor del
// anillo) y se achican más en los rubros pequeños para no invadir a los
// vecinos.
function renderDonutIcon(p: any, minPct = 0){
  const datum = (p.payload ?? {}) as Partial<CatSlice>;
  const name = datum.name ?? p.name ?? "";
  const pct = typeof datum.pct === "number" ? datum.pct : (typeof p.percent === "number" ? p.percent * 100 : 0);
  // En Inicio los símbolos solo van en segmentos grandes (≥10%).
  if (pct < minPct) return null;
  const size = pct >= 10 ? 10 : pct >= 5 ? 8 : 6;
  const RADIAN = Math.PI / 180;
  const radius = (Number(p.innerRadius) + Number(p.outerRadius)) / 2;
  const x = Number(p.cx) + radius * Math.cos(-Number(p.midAngle) * RADIAN);
  const y = Number(p.cy) + radius * Math.sin(-Number(p.midAngle) * RADIAN);
  return <g transform={`translate(${x - size / 2}, ${y - size / 2})`} pointerEvents="none">
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.35))"}} aria-hidden="true">{CAT_DONUT_ICONS[name] ?? CAT_DONUT_ICON_DEFAULT}</svg>
  </g>;
}
// Gráfica de dona de gasto por categoría. Opción 4 («solo el rubro
// tocado»): sin leyenda fija, cada segmento lleva dentro el símbolo blanco
// de su rubro. Al tocar un segmento queda marcado (más brillante, un poco
// separado, los demás atenuados), aparece debajo una sola línea con ese
// rubro, su monto y su porcentaje, y se abre directamente la ventana aparte
// con sus gastos registrados. Al cerrar la ventana, la selección se limpia:
// la dona vuelve completa y la línea desaparece. Tocar el segmento ya
// marcado lo desmarca sin abrir la ventana. El centro muestra siempre
// el total del mes. Sin tooltip: ningún recuadro debe aparecer al tocar ni
// al pasar sobre la dona. La animación de la dona está apagada
// (isAnimationActive={false}): Recharts reinicia la animación cada vez que
// cambia la selección y mientras corre esconde las etiquetas, por eso el
// símbolo del rubro desaparecía al tocar un segmento.
// Variantes de Inicio (propuesta Unslop, solo esa instancia; Personal
// conserva el comportamiento anterior): palette con gama propia sin verde
// ni rojo, large (dona de 220 px en móvil y 240 px en escritorio, centro
// en 24 px), reserveLine (la línea del rubro tiene altura reservada y no
// hay texto de ayuda, para que la tarjeta no cambie de alto) y minIconPct
// (símbolos solo en segmentos grandes).
function CategoryChart({data, onSelect, detailOpen, palette, large, reserveLine, minIconPct}:{data:CatSlice[]; onSelect:(d:CatSlice)=>void; detailOpen:boolean; palette?:string[]; large?:boolean; reserveLine?:boolean; minIconPct?:number}){
  const colors = palette ?? DONUT_COLORS;
  const [selName, setSelName] = useState<string|null>(null);
  // Al cerrar la ventana de detalle, la dona vuelve completa.
  useEffect(()=>{ if(!detailOpen) setSelName(null); },[detailOpen]);
  // Si cambia el mes y el rubro marcado ya no está en los datos, no se
  // muestra la línea; si sigue, se muestran sus montos del mes actual.
  const sel = selName ? (data.find(d=>d.name===selName) ?? null) : null;
  const activeIdx = sel ? data.indexOf(sel) : -1;
  if(data.length===0) return <p className="text-sm text-[var(--dim)] mt-2">Sin gastos este mes.</p>;
  const total=data.reduce((a,d)=>a+d.total,0);
  const handleSelect=(d:CatSlice)=>{
    // Tocar el segmento ya marcado lo desmarca, sin abrir la ventana.
    if(selName===d.name){ setSelName(null); return; }
    setSelName(d.name); onSelect(d);
  };
  return <div className="mt-2">
    <div className={`relative mx-auto ${large ? "w-[220px] h-[220px] md:w-60 md:h-60" : "w-44 h-44"}`} role="img" aria-label="Gráfica de gasto por categoría.">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="none" isAnimationActive={false} onClick={(d)=>{ handleSelect(d as unknown as CatSlice); }} style={{cursor:"pointer"}} label={(p:any)=>renderDonutIcon(p, minIconPct ?? 0)} labelLine={false} activeIndex={activeIdx < 0 ? undefined : activeIdx} activeShape={(props: any)=><Sector {...props} outerRadius={Number(props.outerRadius) + 6} />}>
            {data.map((d,i)=><Cell key={d.name} fill={colors[i%colors.length]} fillOpacity={sel && d.name!==sel.name ? 0.4 : 1} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xs text-[var(--dim)]">{large ? "Total del mes" : "Total"}</span>
        <b className={`font-display leading-tight ${large ? "text-2xl" : "text-lg"}`}>{money2(total)}</b>
      </div>
    </div>
    {reserveLine ? (
      <div className="mt-2 flex h-[30px] items-center justify-center" aria-live="polite">
        {sel && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface2)] border border-[var(--border)] px-3 py-1 text-sm">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{background:colors[data.indexOf(sel)%colors.length]}} aria-hidden="true" />
            <span>{sel.name} · {money2(sel.total)} · {sel.pct}%</span>
          </span>
        )}
      </div>
    ) : sel ? (
      <div className="mt-2 flex justify-center" aria-live="polite">
        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface2)] border border-[var(--border)] px-3 py-1 text-sm">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{background:colors[data.indexOf(sel)%colors.length]}} aria-hidden="true" />
          <span>{sel.name} · {money2(sel.total)} · {sel.pct}%</span>
        </span>
      </div>
    ) : null}
  </div>;
}
// Variante de Inicio (propuesta Unslop, solo esa instancia; Personal
// conserva el comportamiento anterior): leyenda como texto con punto de
// color (las barras siguen siendo táctiles), meses sin datos atenuados al
// 40%, mes actual con etiqueta «nov · actual» y eje ajustado al máximo real.
function MonthlyChart({series,currentMonth,todayMonth,onSelect,inicio}:{series:{month:string;label:string;income:number;expense:number}[];currentMonth:string;todayMonth:string;onSelect:(kind:"income"|"expense",month:string,label:string)=>void;inicio?:boolean}){
  const data=series.map(x=>({label:x.label, month:x.month, Ingresos:x.income, Gastos:x.expense}));
  const curMonth=data.find(d=>d.month===currentMonth) ?? data[data.length-1];
  // «· actual» marca el mes real en curso, no el mes que muestra el tablero
  // (si se ve un mes pasado, la etiqueta no aparece en ningún mes).
  const todayEntry=data.find(d=>d.month===todayMonth);
  const allZero=data.every(d=>d.Ingresos===0&&d.Gastos===0);
  const isEmptyMonth=(d:{Ingresos:number;Gastos:number})=>d.Ingresos===0&&d.Gastos===0;
  if(allZero) return <p className="text-sm text-[var(--dim)] mt-2">Sin movimientos todavía.</p>;
  return <div className="mt-2" role="img" aria-label="Gráfica de ingresos contra gastos por mes.">
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{left:0,right:8,top:10,bottom:4}} barCategoryGap="30%" barGap={6}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={{fontSize:12, fill:"var(--text)"}} tickFormatter={(v:string)=> inicio && todayEntry && v===todayEntry.label ? `${v} · actual` : v} axisLine={{stroke:"var(--border)"}} tickLine={false} />
        <YAxis domain={inicio ? [0, "dataMax"] : undefined} tickFormatter={(v:number)=>`$${v.toLocaleString("es-MX")}`} tick={{fontSize: inicio?12:11, fill:"var(--dim)"}} width={56} axisLine={false} tickLine={false} />
        <Legend content={()=> inicio ? (<div className="flex justify-center gap-4 text-xs mt-1"><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#1B7A4D]" />Ingresos</span><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#B42318]" />Gastos</span></div>) : (<div className="flex justify-center gap-4 text-xs mt-1"><button type="button" aria-label={`Ver de dónde vienen los ingresos de ${curMonth?curMonth.label:"el mes"}`} className="inline-flex items-center gap-1 underline" onClick={()=>{ if(curMonth) onSelect("income",curMonth.month,curMonth.label); }}><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#1B7A4D]" />Ingresos</button><button type="button" aria-label={`Ver de dónde salieron los gastos de ${curMonth?curMonth.label:"el mes"}`} className="inline-flex items-center gap-1 underline" onClick={()=>{ if(curMonth) onSelect("expense",curMonth.month,curMonth.label); }}><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#B42318]" />Gastos</button></div>)} />
        <Bar dataKey="Ingresos" fill="#1B7A4D" radius={[6,6,0,0]} maxBarSize={26} style={{cursor:"pointer"}} onClick={(d:any)=>{ const p=d?.payload ?? d; if(p?.month) onSelect("income",p.month,p.label); }}>
          {inicio && data.map((d,i)=><Cell key={i} fill="#1B7A4D" fillOpacity={isEmptyMonth(d)?0.4:1} />)}
        </Bar>
        <Bar dataKey="Gastos" fill="#B42318" radius={[6,6,0,0]} maxBarSize={26} style={{cursor:"pointer"}} onClick={(d:any)=>{ const p=d?.payload ?? d; if(p?.month) onSelect("expense",p.month,p.label); }}>
          {inicio && data.map((d,i)=><Cell key={i} fill="#B42318" fillOpacity={isEmptyMonth(d)?0.4:1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
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
type InstallPlatform = "ios" | "android" | "desktop";
function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}
const INSTALL_STEPS: Record<InstallPlatform, string[]> = {
  android: [
    "Abra el menú ⋮ de Chrome (arriba a la derecha).",
    "Seleccione «Instalar y crear acceso directo».",
    "Confirme con «Instalar».",
  ],
  ios: [
    "Abra esta página en Safari.",
    "Pulse Compartir, el cuadrado con la flecha hacia arriba.",
    "Seleccione «Agregar a pantalla de inicio».",
    "Confirme con «Agregar».",
  ],
  desktop: [
    "Pulse el icono de instalación en la barra de direcciones.",
    "Confirme con «Instalar».",
  ],
};
function InstallCard({ installed, onInstall, onDismiss }: { installed: boolean; onInstall: () => void; onDismiss?: () => void }) {
  return (
    <div className="bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl px-3 py-2 flex items-center gap-2">
      <img src={appIcon512} alt="Icono de SyncFinanzas: una casa blanca con flechas de sincronización doradas sobre fondo azul marino" className="w-9 h-9 rounded-xl shrink-0 border border-[var(--border)]" />
      <p className="text-sm font-bold flex-1 min-w-0">Instale SyncFinanzas en su celular</p>
      {installed ? (
        <p className="text-sm font-semibold text-[var(--green)] shrink-0" role="status">Ya instalada.</p>
      ) : (
        <button type="button" aria-label="Instalar la aplicación SyncFinanzas en este dispositivo" className={btnPrimary + " shrink-0"} onClick={onInstall}>Instalar</button>
      )}
      {onDismiss && <button type="button" aria-label="Descartar el aviso de instalación" onClick={onDismiss} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>}
    </div>
  );
}
// En iPhone no hay instalación automática: el botón abre estos pasos cortos.
// En Android/Chrome, si el navegador ofrece la instalación, el botón la dispara.
function InstallStepsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const platform = detectInstallPlatform();
  const title = platform === "ios" ? "Instalar en iPhone" : platform === "android" ? "Instalar en Android" : "Instalar en la computadora";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-sm p-3.5" onClick={e=>e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display font-bold text-lg">{title}</h2>
          <button type="button" aria-label="Cerrar las instrucciones de instalación" onClick={onClose} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
        </div>
        <p className="text-sm text-[var(--dim)] mt-2">El navegador no ofrece la instalación directa en este momento (por ejemplo, si el aviso se descartó antes). Siga estos pasos:</p>
        <ol className="list-decimal ml-5 text-sm space-y-1.5 mt-3">
          {INSTALL_STEPS[platform].map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {platform === "android" && <p className="text-xs text-[var(--dim)] mt-3">Si no aparece «Instalar y crear acceso directo», es posible que la aplicación ya esté instalada.</p>}
        <button type="button" className={btnPrimary + " mt-3 w-full"} onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}

// ---- Mike (respuestas preparadas + respuestas dinámicas con datos reales) ----
// Botón flotante con una estrella dorada, visible SIEMPRE en toda la app
// mientras el chat está cerrado, en modo Personal y Familiar. La estrella
// es estática y se arrastra: el usuario la toca y la mueve con el dedo (o
// el ratón) a cualquier punto de la pantalla y queda ahí; la posición se
// guarda en el dispositivo (localStorage "sf-help-fab-pos"). Un toque abre
// el chat; arrastrar no lo abre. Cuando Mike tiene una idea, una pregunta
// o un aviso para el usuario (saludo o aviso pendiente), la estrella lleva
// un foco encima, sin animación. Al tocarlo abre una ventanita de chat que
// responde dudas de uso con una base de respuestas preparadas por palabras
// clave (sin claves ni servicios de pago) y preguntas dinámicas calculadas
// en el dispositivo con los datos del hogar (en qué se gasta de más, dónde
// ahorrar, cómo va la meta, cuánto queda). Al abrir, el chat abre con un
// solo mensaje que cambia cada vez: ofrece ayuda o da un tip o una solución
// con datos reales, sin repetir el anterior; al cerrar, la conversación se
// borra para que al abrir de nuevo no se repita ni se apile el mismo. La
// presentación de Mike vive en la burbuja arriba de la estrella, no dentro
// del chat: la burbuja es crema (#F7F1E7) con letra oscura para que se
// diferencie del fondo, y dice solo «Hola, soy Mike.». Cada respuesta es
// corta, en tono formal de usted, y trae un botón que lleva directo al
// lugar cuando la vista ya tiene navegación (onGo). La lógica vive en
// ./lib/helpDynamic. Sin `open`/`onOpenChange` se maneja solo (así lo usa
// el asistente de creación de espacio). Con `open`/`onOpenChange` lo
// controla la app.
// Con `greeting`, al entrar a la app aparece una burbujita crema de saludo
// arriba de la estrella una vez por sesión, que se puede descartar; al
// tocarla se abre el chat. Nunca bloquea la pantalla. Con `hidden` (menú
// abierto) el botón se oculta, porque el cajón ya tiene su entrada a Mike.
// Además Mike es un asistente de ahorro conversacional: si el usuario
// pregunta cómo ahorrar más, no contesta de una vez, pregunta el motivo (con
// sus metas como opciones), el monto y el plazo, y piensa con sus datos
// reales para darle los parámetros (aporte mensual, recortes por categoría,
// plazo) con un botón para armar el plan en Metas. Y siempre está activo:
// con `nudge` interviene solo con una burbujita arriba de la estrella (qué
// quiere registrar, presupuesto cerca de su límite, plan de ahorro en
// riesgo), una sola vez por sesión cada aviso, con × para descartar, nunca
// un popup que bloquee. El saludo de entrada tiene prioridad sobre los
// avisos.
// Posición de la estrella de Mike. Se guarda en el dispositivo
// (localStorage "sf-help-fab-pos") como coordenadas en píxeles desde la
// esquina superior izquierda de la ventana; null = posición por defecto
// (abajo a la derecha). Siempre se limita a la ventana visible, para que
// la estrella nunca quede fuera de la pantalla ni bajo la barra del
// sistema (se reserva el área segura inferior en la posición por defecto).
const FAB_POS_KEY = "sf-help-fab-pos";
const FAB_SIZE = 48;
function clampFabPos(x: number, y: number): { x: number; y: number } {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 844;
  return { x: Math.max(8, Math.min(x, vw - FAB_SIZE - 8)), y: Math.max(8, Math.min(y, vh - FAB_SIZE - 8)) };
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
export function HelpAssistant({ onGo, open: controlledOpen, onOpenChange, dynamicFaqs, greeting, onDismissGreeting, overview, nudge, onDismissNudge, hidden }: { onGo?: (tab: Tab) => void; open?: boolean; onOpenChange?: (v: boolean) => void; dynamicFaqs?: HelpFaq[]; greeting?: { text: string; personal?: string | null } | null; onDismissGreeting?: () => void; overview?: OverviewData | null; nudge?: HelpNudge | null; onDismissNudge?: () => void; hidden?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const tipAddedRef = useRef(false);
  // Al cerrar, la conversación se borra (mensajes, asistente de ahorro y
  // caja de texto): así, al abrir de nuevo, Mike dice un mensaje distinto
  // y nunca se repite ni se apila el mismo. Antes los mensajes se quedaban
  // y cada apertura agregaba el mismo tip, por eso salía 3 veces seguidas.
  const setOpen = (v: boolean) => { if (!v) { tipAddedRef.current = false; setMsgs([]); setWizard(null); setInput(""); } if (onOpenChange) onOpenChange(v); else setInternalOpen(v); };
  const [input, setInput] = useState("");
  // El chat abre limpio, sin mensaje de presentación ni preguntas listadas:
  // la presentación de Mike vive en la burbuja arriba de la estrella. Solo
  // la caja de texto y, mientras el usuario escribe, las predicciones.
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
  // se limita de nuevo a la ventana visible.
  useEffect(() => {
    const onResize = () => setFabPos(cur => (cur ? clampFabPos(cur.x, cur.y) : cur));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // La burbuja de saludo o aviso va arriba de la estrella, como un globo de
  // idea; si la estrella está arriba de la pantalla, la burbuja va abajo de
  // ella para no salirse. Se alinea al lado con más espacio.
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 390;
  const fabCenterX = fabPos ? fabPos.x + FAB_SIZE / 2 : vw - 16 - FAB_SIZE / 2;
  const bubbleBelow = fabPos ? fabPos.y < 170 : false;
  const bubbleRight = fabCenterX > vw / 2;
  const hasIdea = Boolean(greeting || nudge);
  // Una sola burbuja: el saludo tiene prioridad sobre los avisos.
  const bubble = greeting
    ? { kind: "greeting" as const, text: greeting.text, personal: greeting.personal ?? null, actions: [] as { label: string; ask?: string; go?: Tab }[] }
    : nudge
      ? { kind: "nudge" as const, text: nudge.text, personal: null as string | null, actions: nudge.actions }
      : null;
  const dismissBubble = () => { if (bubble?.kind === "greeting") onDismissGreeting?.(); else if (bubble?.kind === "nudge") onDismissNudge?.(); };
  return (
    <>
      {!open && !hidden && (
        <div className="fixed z-40 w-12 h-12" style={fabPos ? { left: fabPos.x, top: fabPos.y } : { right: 16, bottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
          {bubble && controlledOpen !== undefined && (
            <div data-help-bubble role="status" className="absolute z-10 w-[min(240px,calc(100vw-24px))] rounded-2xl bg-[#F7F1E7] text-[#1A2A3A] border border-[#E0CBA8] shadow-lg px-3 py-2 cursor-pointer" style={bubbleBelow ? { top: "calc(100% + 10px)", ...(bubbleRight ? { right: 0 } : { left: 0 }) } : { bottom: "calc(100% + 10px)", ...(bubbleRight ? { right: 0 } : { left: 0 }) }} onClick={()=>{ setOpen(true); dismissBubble(); }}>
              <span aria-hidden="true" className="absolute w-3 h-3 rotate-45 bg-[#F7F1E7]" style={bubbleBelow ? { top: -6, ...(bubbleRight ? { right: 14 } : { left: 14 }) } : { bottom: -6, ...(bubbleRight ? { right: 14 } : { left: 14 }) }} />
              <div className="flex items-start gap-1.5">
                <p className="text-sm font-semibold flex-1">{bubble.text}</p>
                <button type="button" aria-label={bubble.kind === "greeting" ? "Descartar el saludo de Mike" : "Descartar el aviso de Mike"} onClick={(e)=>{ e.stopPropagation(); dismissBubble(); }} className="shrink-0 w-6 h-6 rounded-full bg-white/70 border border-[#D8C9A8] text-[#1A2A3A] text-base leading-none font-bold">×</button>
              </div>
              {bubble.personal && <p className="text-xs text-[#5A6B7A] mt-0.5">{bubble.personal}</p>}
              {bubble.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {bubble.actions.map(a=>(
                    <button key={a.label} type="button" className="rounded-full border border-[#B9A77E] text-[#1A2A3A] px-2.5 py-1 text-xs font-semibold" onClick={(e)=>{ e.stopPropagation(); if (a.ask) { setOpen(true); ask(a.ask); } else if (a.go && onGo) { setOpen(false); onGo(a.go); } dismissBubble(); }}>{a.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button ref={fabRef} type="button" data-help-fab aria-label={hasIdea ? "Abrir a Mike: tengo una idea para usted" : "Abrir a Mike"} onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerUp} onPointerCancel={onFabPointerCancel} onClick={onFabClick} className="help-fab-static relative w-12 h-12 rounded-full bg-[var(--gold)] text-[#13262E] shadow-xl flex items-center justify-center shrink-0">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6 pointer-events-none" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
            {hasIdea && (
              <span data-help-badge="idea" aria-hidden="true" className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#13262E] text-[var(--gold)] border-2 border-[var(--surface)] shadow flex items-center justify-center pointer-events-none">
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

// ---- Opiniones de testers (segunda etapa) ----
// Formulario público (?feedback=1): se muestra sin sesión, sin cuenta.
// Se envía a POST /api/feedback y se guarda en la tabla tester_feedback.
// main.tsx lo muestra en lugar de la pantalla de acceso cuando la URL trae
// ?feedback=1.
const FEEDBACK_MODULES = ["Inicio","Personal","Movimientos","Cuentas","Categorías","Presupuestos","Fondos","Aportaciones","Metas","Acuerdos","Patrimonio","Tandas","Perfiles","Hogar","Guía de uso","Instalación"];
const FEEDBACK_DEVICES = ["iPhone","Android","Computadora","Otro"];
function StarInput({label, value, onChange}:{label:string; value:number; onChange:(v:number)=>void}){
  return <div>
    <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">{label}</span>
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {[1,2,3,4,5].map(n=>(
        <button key={n} type="button" role="radio" aria-checked={value===n} aria-label={`${n} de 5 estrellas`} onClick={()=>onChange(n)} className="text-2xl leading-none text-[var(--gold)] px-0.5">{n<=value?"★":"☆"}</button>
      ))}
    </div>
  </div>;
}
export function TesterFeedbackForm(){
  const [nombre,setNombre]=useState(""); const [correo,setCorreo]=useState("");
  const [rating,setRating]=useState(0); const [ease,setEase]=useState(0);
  const [modulo,setModulo]=useState(""); const [dispositivo,setDispositivo]=useState("");
  const [worked,setWorked]=useState(""); const [failed,setFailed]=useState(""); const [suggestion,setSuggestion]=useState("");
  const [sent,setSent]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const submit=async(e:FormEvent)=>{
    e.preventDefault(); setError("");
    if(rating<1 || ease<1){ setError("Elija la calificación general y la facilidad de uso."); return; }
    setBusy(true);
    try{
      const res=await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nombre:nombre||null,correo:correo||null,calificacionGeneral:rating,facilidadUso:ease,queFunciono:worked||null,queFallo:failed||null,sugerencia:suggestion||null,modulo:modulo||null,dispositivo:dispositivo||null})});
      const json=(await res.json().catch(()=>null)) as {error?:string}|null;
      if(!res.ok) throw new Error(json?.error ?? "No se pudo enviar su opinión.");
      setSent(true);
    }catch(err){ setError(err instanceof Error?err.message:"No se pudo enviar su opinión."); }
    finally{ setBusy(false); }
  };
  if(sent) return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0 text-center">
        <h1 className="font-display font-bold text-2xl">SyncFinanzas</h1>
        <p className="text-sm mt-3">Gracias por su opinión. Sus comentarios ayudan a mejorar SyncFinanzas.</p>
        <button type="button" className={btnPrimary+" mt-4"} onClick={()=>{ setSent(false); setRating(0); setEase(0); setWorked(""); setFailed(""); setSuggestion(""); }}>Enviar otra opinión</button>
      </div>
    </main>
  );
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0">
        <h1 className="font-display font-bold text-2xl">SyncFinanzas</h1>
        <h2 className="font-display font-bold text-lg mt-4">Opiniones de testers</h2>
        <p className="text-sm text-[var(--dim)] mt-1">Cuéntenos cómo le fue con la app. No necesita cuenta.</p>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div><Label htmlFor="fb-nombre">Su nombre (opcional)</Label><input id="fb-nombre" aria-label="Su nombre, opcional" className={inputCls} value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Ej. Ana" autoComplete="name" /></div>
          <div><Label htmlFor="fb-correo">Su correo (opcional)</Label><input id="fb-correo" aria-label="Su correo, opcional" type="email" className={inputCls} value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="usted@correo.com" autoComplete="email" /></div>
          <StarInput label="Calificación general" value={rating} onChange={setRating} />
          <StarInput label="Facilidad de uso" value={ease} onChange={setEase} />
          <div><Label htmlFor="fb-modulo">Módulo</Label><select id="fb-modulo" aria-label="Módulo sobre el que opina" className={inputCls} value={modulo} onChange={e=>setModulo(e.target.value)}><option value="">Sin módulo en particular</option>{FEEDBACK_MODULES.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
          <div><Label htmlFor="fb-dispositivo">Dispositivo</Label><select id="fb-dispositivo" aria-label="Dispositivo desde el que probó la app" className={inputCls} value={dispositivo} onChange={e=>setDispositivo(e.target.value)}><option value="">Sin especificar</option>{FEEDBACK_DEVICES.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
          <div><Label htmlFor="fb-funciono">Qué funcionó</Label><textarea id="fb-funciono" aria-label="Qué funcionó bien en la app" className={inputCls+" min-h-[72px]"} value={worked} onChange={e=>setWorked(e.target.value)} placeholder="Lo que le gustó o le resultó fácil." /></div>
          <div><Label htmlFor="fb-fallo">Qué falló</Label><textarea id="fb-fallo" aria-label="Qué falló en la app" className={inputCls+" min-h-[72px]"} value={failed} onChange={e=>setFailed(e.target.value)} placeholder="Lo que no funcionó o le costó trabajo." /></div>
          <div><Label htmlFor="fb-sugerencia">Sugerencia</Label><textarea id="fb-sugerencia" aria-label="Sugerencia para mejorar la app" className={inputCls+" min-h-[72px]"} value={suggestion} onChange={e=>setSuggestion(e.target.value)} placeholder="Qué cambiaría o agregaría." /></div>
          {error && <p className="text-sm text-[var(--red)]" role="alert">{error}</p>}
          <button type="submit" className={btnPrimary+" w-full"} disabled={busy}>{busy?"Enviando…":"Enviar opinión"}</button>
        </form>
      </div>
    </main>
  );
}

export function App(){
  const qc=useQueryClient();
  const [tab,setTab]=useState<Tab>("inicio"); const [menuOpen,setMenuOpen]=useState(false); const [guidePdf,setGuidePdf]=useState<{title:string;src:string}|null>(null);
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
  useEffect(()=>{ if(menuOpen){ setOpenDrawerGroups({}); setConfigOpen(tab==="guia"); setVistaOpen(false); } },[menuOpen]);
  // Instalación en el celular: se captura el evento del navegador y se detecta si ya está instalada.
  const [installPrompt,setInstallPrompt]=useState<BeforeInstallPromptEvent|null>(null); const [appInstalled,setAppInstalled]=useState<boolean>(()=>detectStandalone()); const [installDismissed,setInstallDismissed]=useState<boolean>(()=>{ try{ return localStorage.getItem("sf-install-dismissed")==="1"; }catch{ return false; } });
  const [installStepsOpen,setInstallStepsOpen]=useState(false);
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
  // la app muestra el aviso con el botón Actualizar (pancarta arriba de
  // Inicio y entrada en la campanilla). Al actualizar solo cambia el código;
  // la sesión y los datos no se tocan.
  const [darkMode,setDarkMode]=useState(()=>{ try{ return document.documentElement.classList.contains("dark"); }catch{ return false; } });
  // Cambia el tema y guarda la elección ("sf-theme"); sin elección guardada
  // la app arranca en modo oscuro (main.tsx). Se usa desde Configuración.
  const setThemeMode=(next:boolean)=>{ setDarkMode(next); try{ localStorage.setItem("sf-theme", next?"dark":"light"); }catch{} try{ document.documentElement.classList.toggle("dark", next); }catch{} };
  const [updateAvailable,setUpdateAvailable]=useState(false); const [updateApplying,setUpdateApplying]=useState(false); const [updateChecking,setUpdateChecking]=useState(false); const [updateCheckMsg,setUpdateCheckMsg]=useState<string|null>(null);
  useEffect(()=>{
    const onUpdate=()=>setUpdateAvailable(true);
    window.addEventListener(APP_UPDATE_EVENT,onUpdate);
    // Aviso "pegajoso": si el worker nuevo ya quedó en espera antes de
    // que este oyente se montara, el aviso no se pierde hasta la siguiente
    // revisión. También se revisa al abrir la app, por si hay una versión
    // nueva esperando desde antes.
    if(isUpdateAvailable()) setUpdateAvailable(true);
    void checkForAppUpdate();
    return ()=>window.removeEventListener(APP_UPDATE_EVENT,onUpdate);
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
  const checkUpdatesManually=async()=>{
    setUpdateChecking(true); setUpdateCheckMsg(null);
    const r=await checkForAppUpdate();
    setUpdateChecking(false);
    if(r==="update"){ setUpdateAvailable(true); setUpdateCheckMsg("Hay una nueva versión. Pulse Actualizar arriba."); }
    else if(r==="latest"){ setUpdateCheckMsg("Ya tiene la versión más reciente."); }
    else { setUpdateCheckMsg("No se pudo revisar la actualización."); }
  };
  const [currentProfileId,setCurrentProfileId]=useState<number|null>(()=>{ try{ const v=localStorage.getItem("sf-profile"); return v?Number(v):null; }catch{ return null; } });
  const pickProfile=(id:number|null)=>{ setCurrentProfileId(id); try{ if(id) localStorage.setItem("sf-profile",String(id)); else localStorage.removeItem("sf-profile"); }catch{} };
  // Mes que muestra el tablero: null = mes en curso; el selector de mes y
  // año de la tarjeta Movimientos fija otro mes y el servidor recalcula
  // las cifras del mes sobre él.
  const [viewMonth,setViewMonth]=useState<string|null>(null);
  const q=useQuery({queryKey:["overview",viewMonth],queryFn:()=>api.getOverview(viewMonth?{month:viewMonth}:{})});
  const inv=()=>{ qc.invalidateQueries({queryKey:["overview"]}); qc.invalidateQueries({queryKey:["notifications"]}); };
  const data=q.data;
  // Opiniones de testers (segunda etapa): se consultan solo si hay hogar y
  // la sesión es del dueño de la app; el servidor vuelve a verificar el correo.
  const meEarly = data ? (data.profiles.find(x=>x.id===currentProfileId) || data.profiles.find(x=>x.role==="admin") || data.profiles.find(x=>x.kind==="adult") || null) : null;
  const fbQuery=useQuery({queryKey:["testerFeedback"],queryFn:()=>api.listTesterFeedback({householdId:data!.household!.id}),enabled:!!data?.household && isAppOwner});
  // Registro de usuarios de la app: total y lista de quienes han entrado.
  // Solo lo ve el dueño de la app; el servidor vuelve a verificar el correo.
  const appUsersQuery=useQuery({queryKey:["appUsers"],queryFn:()=>api.listAppUsers({householdId:data!.household!.id}),enabled:!!data?.household && isAppOwner});
  // Arqueos de efectivo: historial de recuentos guardados. Solo los
  // consulta el administrador del hogar; el servidor vuelve a verificar
  // el rol. Si la tabla aún no existe, la lista sale vacía.
  const ccQuery=useQuery({queryKey:["cashCounts"],queryFn:()=>api.listCashCounts({householdId:data!.household!.id}),enabled:!!data?.household && (!meEarly || meEarly.role==="admin")});
  // Avisos dentro de la app (campanita + insignia del icono): cada usuario
  // ve solo sus propios avisos. Si la tabla aún no existe, la lista sale
  // vacía y nada se rompe.
  const notifQuery=useQuery({queryKey:["notifications"],queryFn:()=>api.listNotifications({householdId:data!.household!.id}),enabled:!!data?.household});
  const unreadCount=notifQuery.data?.unreadCount??0;
  // La campanilla también avisa de una versión nueva en espera: cuenta como
  // un aviso sin leer más, para llegar a Actualizar sin subir hasta arriba.
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
  const openNotif=(n:{id:number;target:string})=>{ void markNotifRead.mutateAsync(n.id).catch(()=>{}); setNotifOpen(false); goTab(n.target as Tab); };
  // Reglas de auto-categorización: si el concepto contiene la palabra, la
  // app pone sola esa categoría. Si la tabla aún no existe (falta correr
  // supabase/category-rules.sql), la lista sale vacía.
  const rulesQuery=useQuery({queryKey:["categoryRules"],queryFn:()=>api.listCategoryRules({householdId:data!.household!.id}),enabled:!!data?.household});
  const rules=rulesQuery.data?.rules ?? [];
  const saveRule=useMutation({mutationFn:async(v:{keyword:string;categoryId:number})=>await api.saveCategoryRule({householdId:data!.household!.id,...v}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["categoryRules"]}); }});
  const delRule=useMutation({mutationFn:async(id:number)=>await api.deleteCategoryRule({id}),onSuccess:()=>{ qc.invalidateQueries({queryKey:["categoryRules"]}); }});
  // Avisos periódicos de tarjetas (corte y pago): una revisión por día.
  const periodicCheckedRef=useRef(false);
  useEffect(()=>{
    if(!data?.household || periodicCheckedRef.current) return;
    periodicCheckedRef.current=true;
    let today="";
    try{ today=todayISO(); if(localStorage.getItem("sf-periodic-alerts-date")===today) return; }catch{ return; }
    void api.checkPeriodicAlerts({householdId:data.household.id}).then((r)=>{ try{ localStorage.setItem("sf-periodic-alerts-date",today); }catch{} if(r.created>0) qc.invalidateQueries({queryKey:["notifications"]}); }).catch(()=>{});
  },[data?.household]);
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
  const [planMode,setPlanMode]=useState<"personal"|"familiar">("familiar"); const [hhName,setHhName]=useState("Mi hogar"); const [ownerName,setOwnerName]=useState(""); const [ownerLast,setOwnerLast]=useState(""); const [invEmail,setInvEmail]=useState(""); const [invFound,setInvFound]=useState<{id:number;email:string;householdName:string;invitedName:string|null;kind:"household"|"tanda";tandaId:number|null;tandaName:string|null}[]>([]); const [invSearched,setInvSearched]=useState(false); const [joinFirst,setJoinFirst]=useState(""); const [joinLast,setJoinLast]=useState(""); const [ownerIncome,setOwnerIncome]=useState(""); const [cutoff,setCutoff]=useState("1"); const [contribRule,setContribRule]=useState<"equal"|"proportional">("equal"); const [approvalRule,setApprovalRule]=useState<"unanimous"|"majority">("unanimous"); const [threshold,setThreshold]=useState("1500");
  const findInv=useMutation({mutationFn:async()=>await api.findInvitations({email:invEmail}),onSuccess:(r)=>{setInvFound(r.invitations);setInvSearched(true);}});
  const respondInv=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondInvitation({id:v.id,accept:v.accept,firstName:joinFirst||undefined,lastName:joinLast||undefined}),onSuccess:inv});
  const createHh=useMutation({mutationFn:async()=>await api.createHousehold({mode:planMode,name:planMode==="personal"?(hhName==="Mi hogar"?"Mi dinero personal":hhName):hhName,currency:"MXN",cutoffDay:Number(cutoff)||1,contributionRule:contribRule,approvalRule,approvalThreshold:Number(threshold)||0,ownerName:ownerName||"Yo",ownerLastName:ownerLast,ownerIncome:Number(ownerIncome)||0}),onSuccess:()=>{ inv(); setChartsSeen(false); try{ localStorage.setItem("sf-first-guide-pending","1"); localStorage.removeItem("sf-guide-charts-seen"); }catch{} }});
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
    const step2 = data.movements.length>0;
    if(step1 && step2 && chartsSeen) dismissFirstGuide();
  },[firstGuideOpen, data, chartsSeen]);

  // Invitación por enlace directo (?token=...): se resuelve al entrar, se
  // muestra el banner y se acepta o rechaza con las acciones existentes,
  // que verifican el correo invitado y entran al mismo hogar/tanda.
  type InvitePreviewFull = InvitePreview & { invitationId: number | null; tandaInvitationId: number | null; expiresAt: string };
  const [tokenRaw,setTokenRaw]=useState<string|null>(null);
  const [tokenInvite,setTokenInvite]=useState<InvitePreviewFull|null>(null);
  const [tokenDone,setTokenDone]=useState(false);
  const [copiedLink,setCopiedLink]=useState("");
  const copyLink=async(url:string)=>{ try{ await navigator.clipboard.writeText(url); setCopiedLink(url); }catch{ try{ const t=document.createElement("textarea"); t.value=url; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); setCopiedLink(url); }catch{} } };
  // Mensaje de invitación: el enlace real (un solo uso, con token) va primero
  // y visible, seguido de los pasos para entrar. El mismo mensaje se copia
  // y se comparte por WhatsApp.
  const inviteMessage=(url:string)=>`${url}\nLe invito a SyncFinanzas, la app para llevar el dinero del hogar.\nPara entrar:\n1. Abra este enlace.\n2. Cree su cuenta con su correo y una contraseña.\n3. Acepte la invitación y entre al hogar.`;
  // Mensaje de invitación a una tanda: el enlace va primero, seguido de los
  // pasos para entrar. El mismo mensaje se copia y se comparte por WhatsApp.
  const tandaInviteMessage=(url:string,tandaName:string)=>`${url}\nLe invito a participar en la tanda ${tandaName} en SyncFinanzas.\nPara entrar:\n1. Abra este enlace.\n2. Cree su cuenta con el correo invitado y una contraseña.\n3. Acepte la invitación y participe en la tanda.`;
  useEffect(()=>{
    const token = readInviteToken();
    if (!token) return;
    setTokenRaw(token);
    void fetch(`/api/invite?token=${encodeURIComponent(token)}`).then(r=>r.json()).then((j: InvitePreviewFull & { ok?: boolean })=>{ if (j && j.ok) setTokenInvite(j); }).catch(()=>{});
  },[]);
  const acceptTokenInvite=useMutation({mutationFn:async()=>{
    if (!tokenInvite) throw new Error("No hay invitación por enlace.");
    if (tokenInvite.kind==="general") { if (!tokenRaw) throw new Error("Falta el enlace de invitación."); return await api.acceptGeneralInvite({token: tokenRaw}); }
    if (tokenInvite.kind==="household" && tokenInvite.invitationId) return await api.respondInvitation({id: tokenInvite.invitationId, accept: true, firstName: joinFirst||undefined, lastName: joinLast||undefined});
    if (tokenInvite.kind==="tanda" && tokenInvite.tandaInvitationId) return await api.respondTandaInvitation({id: tokenInvite.tandaInvitationId, accept: true, name: [joinFirst, joinLast].filter(Boolean).join(" ")||undefined});
    throw new Error("No se pudo identificar la invitación del enlace.");
  },onSuccess:()=>{ setTokenDone(true); try{ sessionStorage.removeItem("sf-invite-token"); }catch{} inv(); }});
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
  // enlace, en cuyo caso se entra al hogar invitado sin crear uno nuevo).
  const [modeModalOpen,setModeModalOpen]=useState(false); const [modeModalShown,setModeModalShown]=useState(false);
  useEffect(()=>{ if(data && !data.household && !tokenInvite && !modeModalShown){ setModeModalOpen(true); setModeModalShown(true); } },[data,tokenInvite,modeModalShown]);
  const [hhInvResult,setHhInvResult]=useState<InviteSend|null>(null);
  const [tInvResult,setTInvResult]=useState<Record<number,InviteSend>>({});

  // movement form
  const [mvType,setMvType]=useState<"income"|"expense"|"transfer"|"debt_payment">("expense"); const [mvStep,setMvStep]=useState(1); const [mvAmount,setMvAmount]=useState(""); const [mvConcept,setMvConcept]=useState(""); const [mvAccount,setMvAccount]=useState(""); const [mvAccountError,setMvAccountError]=useState(""); const [mvToAccount,setMvToAccount]=useState(""); const [mvCat,setMvCat]=useState(""); const [mvSub,setMvSub]=useState(""); const [mvDate,setMvDate]=useState(todayISO()); const [mvVis,setMvVis]=useState<"private"|"shared">("shared"); const [mvFilters,setMvFilters]=useState<MovementsFilterValue>(DEFAULT_MOVEMENTS_FILTER); const [editingMv,setEditingMv]=useState<number|null>(null);
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
  const saveMv=useMutation({mutationFn:async()=>await api.saveMovement({id:editingMv??undefined,householdId:data!.household!.id,type:mvType,amount:Number(mvAmount),concept:mvConcept,accountId:mvAccount?Number(mvAccount):null,toAccountId:mvToAccount?Number(mvToAccount):null,categoryId:mvCat?Number(mvCat):null,subcategory:mvSub||undefined,date:mvDate,visibility:mvVis,profileId:mvProfile?Number(mvProfile):(me?me.id:null),receipt:receipt?{dataBase64:receipt.dataBase64,mimeType:receipt.mimeType}:undefined}),onSuccess:()=>{inv();resetMvForm();if(inicioMvOpenRef.current){inicioMvOpenRef.current=false;setInicioMvOpen(false);}setSavedNotice("Movimiento guardado.");}});
  const delMv=useMutation({mutationFn:async(id:number)=>await api.deleteMovement({id}),onSuccess:inv});
  const [confirmReverseId,setConfirmReverseId]=useState<number|null>(null);
  const revMv=useMutation({mutationFn:async(id:number)=>await api.reverseMovement({id}),onSuccess:()=>{inv();setConfirmReverseId(null);}});

  // account form
  const [accFormName,setAccFormName]=useState(""); const [accType,setAccType]=useState<"bank"|"cash"|"credit"|"investment"|"loan">("bank"); const [accVis,setAccVis]=useState<"private"|"shared">("shared"); const [accInit,setAccInit]=useState("0"); const [editingAcc,setEditingAcc]=useState<number|null>(null);
  const saveAcc=useMutation({mutationFn:async()=>await api.saveAccount({id:editingAcc??undefined,householdId:data!.household!.id,name:accFormName,type:accType,visibility:accVis,initialBalance:Number(accInit)||0}),onSuccess:()=>{inv();setAccFormName("");setEditingAcc(null);setSavedNotice("Cuenta guardada.");}});
  const delAcc=useMutation({mutationFn:async(id:number)=>await api.deleteAccount({id}),onSuccess:inv});

  // Arqueo de cuentas (auditoría): lo contado en físico por cada cuenta y
  // en efectivo, contra lo que dice la app. La diferencia se calcula en
  // pantalla y el servidor la vuelve a calcular al guardar.
  const [ccOpen,setCcOpen]=useState(false); const [ccCounted,setCcCounted]=useState<Record<string,string>>({}); const [ccNote,setCcNote]=useState(""); const [ccError,setCcError]=useState(""); const [ccExpanded,setCcExpanded]=useState<number|null>(null);
  const saveCc=useMutation({mutationFn:async()=>{ const lines: {accountId:number|null;counted:number}[] = []; const cash=ccCounted["cash"]; if(cash!=null && cash!=="" && Number(cash)>=0) lines.push({accountId:null,counted:Number(cash)}); for(const a of data!.accounts){ const v=ccCounted[`acc-${a.id}`]; if(v!=null && v!=="" && Number(v)>=0) lines.push({accountId:a.id,counted:Number(v)}); } if(lines.length===0) throw new Error("Anote al menos una cantidad contada."); return await api.saveCashCount({householdId:data!.household!.id,lines,note:ccNote}); },onSuccess:()=>{inv(); qc.invalidateQueries({queryKey:["cashCounts"]}); setCcCounted({}); setCcNote(""); setCcError(""); setCcOpen(false); setSavedNotice("Arqueo guardado.");},onError:(e:Error)=>{setCcError(e.message);}});

  // budget
  const [budCat,setBudCat]=useState(""); const [budMonth,setBudMonth]=useState(monthNow()); const [budAmount,setBudAmount]=useState(""); const [budVis,setBudVis]=useState<"private"|"shared">("shared");
  const saveBud=useMutation({mutationFn:async()=>await api.saveBudget({householdId:data!.household!.id,categoryId:Number(budCat),month:budMonth,amount:Number(budAmount)||0,visibility:budVis}),onSuccess:()=>{inv();setBudAmount("");setSavedNotice("Presupuesto guardado.");}});
  const delBud=useMutation({mutationFn:async(id:number)=>await api.deleteBudget({id}),onSuccess:inv});

  // category
  const [catFormName,setCatFormName]=useState(""); const [catKind,setCatKind]=useState<"income"|"expense">("expense"); const [catSubs,setCatSubs]=useState("");
  const saveCat=useMutation({mutationFn:async()=>await api.saveCategory({householdId:data!.household!.id,name:catFormName,kind:catKind,subcategories:catSubs.split(",").map(s=>s.trim()).filter(Boolean),isActive:1}),onSuccess:()=>{inv();setCatFormName("");setCatSubs("");}});

  // fund
  const [fundName,setFundName]=useState(""); const [fundTarget,setFundTarget]=useState(""); const [fundAmt,setFundAmt]=useState<Record<number,string>>({});
  const saveFund=useMutation({mutationFn:async()=>await api.saveFund({householdId:data!.household!.id,name:fundName,targetAmount:fundTarget?Number(fundTarget):null,visibility:"shared"}),onSuccess:()=>{inv();setFundName("");setFundTarget("");setSavedNotice("Fondo guardado.");}});
  const fundMove=useMutation({mutationFn:async(v:{fundId:number;type:"contribution"|"withdrawal";amount:number})=>await api.addFundMovement({householdId:data!.household!.id,fundId:v.fundId,type:v.type,amount:v.amount,date:todayISO()}),onSuccess:inv});
  const delFund=useMutation({mutationFn:async(id:number)=>await api.deleteFund({id}),onSuccess:inv});

  // goal
  const [goalName,setGoalName]=useState(""); const [goalTarget,setGoalTarget]=useState(""); const [goalDate,setGoalDate]=useState(""); const [goalSaved,setGoalSaved]=useState("0"); const [goalAdd,setGoalAdd]=useState<Record<number,string>>({}); const [quickBud,setQuickBud]=useState<number|null>(null); const [quickBudAmt,setQuickBudAmt]=useState(""); const [quickBudAcc,setQuickBudAcc]=useState(""); const [quickGoal,setQuickGoal]=useState<number|null>(null); const [quickGoalAmt,setQuickGoalAmt]=useState(""); const [quickGoalAcc,setQuickGoalAcc]=useState(""); const [quickPat,setQuickPat]=useState<number|null>(null); const [quickPatVal,setQuickPatVal]=useState("");
  // Detalle de la gráfica de ingresos vs gastos: tipo y mes tocados.
  const [incExpDetail,setIncExpDetail]=useState<{kind:"income"|"expense";month:string;label:string}|null>(null);
  // Vista del detalle de ingresos/gastos: «Por cuenta» (grupos por cuenta,
  // la vista por defecto) o «Por fecha» (una sola lista cronológica).
  const [incExpView,setIncExpView]=useState<IncExpDetailView>("cuenta");
  const [catDetail,setCatDetail]=useState<{categoryId:number|null;name:string;total:number;month:string}|null>(null);
  const [showMoneyLocation,setShowMoneyLocation]=useState(false);
  const [showSummary,setShowSummary]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [showAllHomeMovs,setShowAllHomeMovs]=useState(false);
  const saveGoal=useMutation({mutationFn:async()=>await api.saveGoal({householdId:data!.household!.id,name:goalName,targetAmount:Number(goalTarget)||0,savedAmount:Number(goalSaved)||0,targetDate:goalDate||undefined,visibility:"shared"}),onSuccess:()=>{inv();setGoalName("");setGoalTarget("");setSavedNotice("Meta guardada.");}});
  const addGoal=useMutation({mutationFn:async(v:{id:number;amount:number})=>await api.addGoalSaving(v),onSuccess:inv});
  const payBudget=useMutation({mutationFn:async(v:{categoryId:number;categoryName:string;visibility:string;amount:number;accountId:number|null})=>await api.saveMovement({householdId:data!.household!.id,type:"expense",amount:v.amount,concept:`Pago · ${v.categoryName}`,accountId:v.accountId,categoryId:v.categoryId,date:todayISO(),visibility:v.visibility as "private"|"shared",profileId:me?me.id:null}),onSuccess:()=>{inv();setQuickBud(null);setQuickBudAmt("");setQuickBudAcc("");setSavedNotice("Gasto registrado.");}});
  const contributeGoal=useMutation({mutationFn:async(v:{id:number;amount:number;accountId:number|null})=>await api.addGoalSaving(v),onSuccess:()=>{inv();setQuickGoal(null);setQuickGoalAmt("");setQuickGoalAcc("");setSavedNotice("Aporte registrado.");}});
  const updatePat=useMutation({mutationFn:async(v:{id:number;name:string;kind:string;category:string;value:number;owner:string|null})=>await api.savePatrimony({id:v.id,householdId:data!.household!.id,name:v.name,kind:v.kind as "asset"|"liability",category:v.category,value:v.value,owner:v.owner??undefined}),onSuccess:()=>{inv();setQuickPat(null);setQuickPatVal("");setSavedNotice("Patrimonio actualizado.");}});
  const delGoal=useMutation({mutationFn:async(id:number)=>await api.deleteGoal({id}),onSuccess:inv});

  // plan de ahorro para una meta
  const [planGoalId,setPlanGoalId]=useState<number|null>(null);
  const [planResult,setPlanResult]=useState<Awaited<ReturnType<typeof api.analyzeGoalPlan>>|null>(null);
  const [planMonths,setPlanMonths]=useState("");
  const [planError,setPlanError]=useState("");
  const analyzePlan=useMutation({mutationFn:async(v:{goalId:number;months?:number})=>{ const g=data!.goals.find(x=>x.id===v.goalId)!; return await api.analyzeGoalPlan({householdId:data!.household!.id,goalId:g.id,name:g.name,targetAmount:g.targetAmount,savedAmount:g.savedAmount,targetDate:g.targetDate??undefined,months:v.months}); },onSuccess:(r,v)=>{setPlanGoalId(v.goalId);setPlanResult(r);setPlanMonths(String(r.months));setPlanError("");},onError:(e:Error)=>{setPlanError(e.message);}});
  const acceptPlan=useMutation({mutationFn:async(v:{goalId:number;monthlyAmount:number;months:number;dueDay:number})=>await api.acceptGoalPlan({householdId:data!.household!.id,...v}),onSuccess:()=>{inv();setPlanResult(null);setPlanGoalId(null);setSavedNotice("Plan de ahorro guardado.");},onError:(e:Error)=>{setPlanError(e.message);}});
  const cancelPlan=useMutation({mutationFn:async(goalId:number)=>await api.cancelGoalPlan({householdId:data!.household!.id,goalId}),onSuccess:()=>{inv();setSavedNotice("Plan cancelado. El fondo y el dinero se conservan.");}});

  // ajuste automático de gastos para llegar a la meta
  type AdjAnalysis = Awaited<ReturnType<typeof api.analyzeSpendingAdjustment>>;
  const [adjGoalId,setAdjGoalId]=useState<number|null>(null);
  const [adjAnalysis,setAdjAnalysis]=useState<AdjAnalysis|null>(null);
  const [adjError,setAdjError]=useState("");
  const [adjCuts,setAdjCuts]=useState<Record<number,string>>({});
  const [adjPropCuts,setAdjPropCuts]=useState<Record<number,Record<number,string>>>({});
  const analyzeAdj=useMutation({mutationFn:async(goalId:number)=>await api.analyzeSpendingAdjustment({householdId:data!.household!.id,goalId}),onSuccess:(r,v)=>{setAdjGoalId(v);setAdjAnalysis(r);setAdjCuts(Object.fromEntries(r.cuts.map(c=>[c.budgetId,String(c.cut)])));setAdjError("");},onError:(e:Error)=>{setAdjError(e.message);}});
  const proposeAdj=useMutation({mutationFn:async(v:{goalId:number;kind:"recorte"|"sobrante";cuts?:{budgetId:number;amount:number}[]})=>await api.proposeSpendingAdjustment({householdId:data!.household!.id,...v}),onSuccess:()=>{inv();setAdjAnalysis(null);setAdjGoalId(null);setSavedNotice("Ajuste propuesto. Se envió el aviso a su hogar antes de mover nada.");},onError:(e:Error)=>{setAdjError(e.message);}});
  const acceptAdj=useMutation({mutationFn:async(v:{id:number;cuts?:{budgetId:number;amount:number}[]})=>await api.acceptSpendingAdjustment(v),onSuccess:()=>{inv();setSavedNotice("Ajuste aplicado.");},onError:(e:Error)=>{setAdjError(e.message);}});
  const rejectAdj=useMutation({mutationFn:async(id:number)=>await api.rejectSpendingAdjustment({id}),onSuccess:()=>{inv();setSavedNotice("Ajuste rechazado. No se movió nada.");},onError:(e:Error)=>{setAdjError(e.message);}});

  // agreement
  const [agTitle,setAgTitle]=useState(""); const [agDesc,setAgDesc]=useState(""); const [voteProfile,setVoteProfile]=useState("");
  const saveAg=useMutation({mutationFn:async()=>await api.saveAgreement({householdId:data!.household!.id,title:agTitle,description:agDesc}),onSuccess:()=>{inv();setAgTitle("");setAgDesc("");}});
  const voteAg=useMutation({mutationFn:async(v:{agreementId:number;vote:"approve"|"reject"})=>await api.voteAgreement({agreementId:v.agreementId,profileId:Number(voteProfile),vote:v.vote,householdId:data!.household!.id}),onSuccess:inv});
  const delAg=useMutation({mutationFn:async(id:number)=>await api.deleteAgreement({id}),onSuccess:inv});

  // patrimony
  const [patName,setPatName]=useState(""); const [patKind,setPatKind]=useState<"asset"|"liability">("asset"); const [patCat,setPatCat]=useState(""); const [patValue,setPatValue]=useState(""); const [patOwner,setPatOwner]=useState("");
  const savePat=useMutation({mutationFn:async()=>await api.savePatrimony({householdId:data!.household!.id,name:patName,kind:patKind,category:patCat,value:Number(patValue)||0,owner:patOwner||undefined}),onSuccess:()=>{inv();setPatName("");setPatValue("");}});
  const delPat=useMutation({mutationFn:async(id:number)=>await api.deletePatrimony({id}),onSuccess:inv});

  // profile
  const [profName,setProfName]=useState(""); const [profKind,setProfKind]=useState<"adult"|"dependent">("adult"); const [profType,setProfType]=useState("Hijo/a"); const [profIncome,setProfIncome]=useState("0"); const [profFixed,setProfFixed]=useState("0"); const [profEmail,setProfEmail]=useState("");
  const saveProf=useMutation({mutationFn:async()=>await api.saveProfile({householdId:data!.household!.id,name:profName,lastName:profLast,kind:profKind,dependentType:profKind==="dependent"?profType:undefined,monthlyIncome:Number(profIncome)||0,fixedCommitments:Number(profFixed)||0,email:profEmail||undefined}),onSuccess:()=>{inv();setProfName("");}});
  const delProf=useMutation({mutationFn:async(id:number)=>await api.deleteProfile({id}),onSuccess:inv});

  // household edit
  const [editName,setEditName]=useState(""); const [editMode,setEditMode]=useState<"personal"|"familiar">("familiar"); const [editCutoff,setEditCutoff]=useState("1"); const [editContrib,setEditContrib]=useState<"equal"|"proportional">("equal"); const [editApproval,setEditApproval]=useState<"unanimous"|"majority">("unanimous"); const [editThreshold,setEditThreshold]=useState("1500");
  const saveHh=useMutation({mutationFn:async()=>await api.updateHousehold({id:data!.household!.id,mode:editMode,name:editName||data!.household!.name,currency:"MXN",cutoffDay:Number(editCutoff)||1,contributionRule:editContrib,approvalRule:editApproval,approvalThreshold:Number(editThreshold)||0}),onSuccess:inv});
  const demo=useMutation({mutationFn:async()=>await api.loadDemo({householdId:data!.household!.id}),onSuccess:inv});
  // Reinicio completo de la aplicación (botón dentro del menú desplegable de módulos)
  const [resetStep,setResetStep]=useState(0); const [resetWord,setResetWord]=useState(""); const [resetDone,setResetDone]=useState(false); const [savedNotice,setSavedNotice]=useState<string|null>(null);
  const savedNoticeRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{ if(savedNotice){ savedNoticeRef.current?.scrollIntoView({behavior:"smooth",block:"center"}); } },[savedNotice]);
  const resetAll=useMutation({mutationFn:async()=>await api.resetAllData({householdId:data!.household!.id}),onSuccess:()=>{ inv(); setResetDone(true); setResetStep(0); setResetWord(""); setMenuOpen(false); setTab("inicio"); pickProfile(null); setObStep(0); setObError(""); setHhName("Mi hogar"); setOwnerName(""); setOwnerLast(""); setOwnerIncome(""); setModeModalShown(false); setModeModalOpen(false); setFirstGuideOpen(false); setChartsSeen(false); try{ localStorage.removeItem("sf-install-dismissed"); localStorage.removeItem("sf-first-guide-pending"); localStorage.removeItem("sf-guide-charts-seen"); localStorage.removeItem("sf-pin-hash"); sessionStorage.removeItem("sf-pin-unlocked"); localStorage.removeItem("sf-periodic-alerts-date"); }catch{} }});
  // personal
  const [salaryInput,setSalaryInput]=useState(""); const [persAmt,setPersAmt]=useState(""); const [persConcept,setPersConcept]=useState(""); const [persCat,setPersCat]=useState(""); const [persAccount,setPersAccount]=useState(""); const [persAccountError,setPersAccountError]=useState(""); const [persStep,setPersStep]=useState(1);
  const saveSalary=useMutation({mutationFn:async()=>await api.updatePersonalSalary({householdId:data!.household!.id,salary:Number(salaryInput)||0}),onSuccess:inv});
  const savePersExp=useMutation({mutationFn:async()=>await api.saveMovement({householdId:data!.household!.id,type:"expense",amount:Number(persAmt),concept:persConcept||"Gasto del día",accountId:persAccount?Number(persAccount):null,categoryId:persCat?Number(persCat):null,date:todayISO(),visibility:"private",profileId:me?me.id:null,receipt:persReceipt?{dataBase64:persReceipt.dataBase64,mimeType:persReceipt.mimeType}:undefined}),onSuccess:()=>{inv();resetPersForm();setSavedNotice("Gasto del día guardado.");}});
  // Mike dinámico: preguntas con cifras reales del mes que se está viendo,
  // calculadas en el dispositivo con los datos ya cargados (sin llamadas nuevas
  // ni servicios externos). Las respuestas usan solo los movimientos que el
  // usuario ya ve en pantalla (en Familiar, compartidos más sus privados).
  const dynamicFaqs = useMemo(() => data ? dynamicHelpFaqs(data) : [], [data]);
  const [greetingDismissed, setGreetingDismissed] = useState(false);
  const greeting = useMemo(() => {
    if (!data?.household || greetingDismissed) return null;
    try { if (sessionStorage.getItem(HELP_GREETED_KEY)) return null; } catch {}
    return buildGreeting(data);
  }, [data, greetingDismissed]);
  const dismissGreeting = () => { try { sessionStorage.setItem(HELP_GREETED_KEY, "1"); } catch {} setGreetingDismissed(true); };
  // Avisos proactivos de Mike: al abrir Movimientos o Gasto del día
  // pregunta qué quiere registrar; si un presupuesto está cerca de su
  // límite o un plan de ahorro está en riesgo, avisa. Cada aviso sale una
  // sola vez por sesión (ver ./lib/helpDynamic) y se puede descartar.
  const [activeNudge, setActiveNudge] = useState<HelpNudge | null>(null);
  useEffect(() => {
    if (!data?.household) return;
    const n = pickHelpNudge(data, tab, loadNudgeShown());
    if (n) { markNudgeShown(n.id); setActiveNudge(cur => (cur && cur.id === n.id ? cur : n)); }
    else setActiveNudge(cur => (cur === null ? cur : null));
  }, [data, tab]);
  const dismissNudge = () => setActiveNudge(null);
  // Mike aprende del uso: al cargar el resumen, anota en el dispositivo
  // qué categorías se pasaron de presupuesto este mes y qué conceptos se
  // repiten (ver ./lib/helpDynamic). No se envía nada fuera del dispositivo.
  useEffect(() => { if (data) recordHelpLearning(data); }, [data]);
  // Revisión en vivo de lo que el usuario está capturando: presupuesto
  // restante, posible duplicado y monto sobre el promedio de la categoría.
  // Son solo avisos: nunca bloquean el guardado.
  const mvReview = useMemo(() => data ? reviewMovement(data, { type: mvType, amount: Number(mvAmount) || 0, categoryId: mvCat ? Number(mvCat) : null, concept: mvConcept, date: mvDate, excludeId: editingMv ?? undefined }) : [], [data, mvType, mvAmount, mvCat, mvConcept, mvDate, editingMv]);
  const persReview = useMemo(() => data ? reviewMovement(data, { type: "expense", amount: Number(persAmt) || 0, categoryId: persCat ? Number(persCat) : null, concept: persConcept, date: todayISO() }) : [], [data, persAmt, persCat, persConcept]);
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
  const [fundKind,setFundKind]=useState<Record<number,string>>({}); const [fundAmount,setFundAmount]=useState<Record<number,string>>({}); const [fundNote,setFundNote]=useState<Record<number,string>>({});
  const [partName,setPartName]=useState<Record<number,string>>({}); const [partCard,setPartCard]=useState<Record<number,string>>({}); const [cardInput,setCardInput]=useState<Record<number,string>>({});
  const [drawSel,setDrawSel]=useState<Record<number,"random"|"weighted">>({});
  const [tandaDetailId,setTandaDetailId]=useState<number|null>(null);
  const [tInvEmail,setTInvEmail]=useState<Record<number,string>>({}); const [tInvName,setTInvName]=useState<Record<number,string>>({}); const [tJoinName,setTJoinName]=useState<Record<number,string>>({});
  const [rateName,setRateName]=useState<Record<number,string>>({}); const [rateStars,setRateStars]=useState<Record<number,string>>({}); const [rateComment,setRateComment]=useState<Record<number,string>>({});
  const saveTanda=useMutation({mutationFn:async()=>await api.saveTanda({householdId:data!.household!.id,name:tandaName,participantCount:Number(tandaCount)||10,amountPerQuincena:Number(tandaAmount)||0,startDate:tandaStart,frequency:tandaFreq,drawMode:tandaDrawMode,organizerProfileId:me?me.id:null,organizerName:me?fullName(me):undefined,coverageRule:tandaCoverage,fineAmount:Number(tandaFine)||0,meetingDay:tandaMeeting,treasurerProfileId:tandaTreasurer?Number(tandaTreasurer):null,substituteProfileId:tandaSubstitute?Number(tandaSubstitute):null}),onSuccess:()=>{inv();setTandaName("");setTandaAmount("");setTandaFine("");setTandaMeeting("");setTandaTreasurer("");setTandaSubstitute("");setSavedNotice("Tanda creada.");}});
  const setRole=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;role:"organizador"|"tesorero"|"suplente"|"participante"})=>await api.setTandaRole(v),onSuccess:inv});
  const addFine=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;reason:"retardo"|"falta"})=>await api.addTandaFine({householdId:data!.household!.id,...v}),onSuccess:inv});
  const payFine=useMutation({mutationFn:async(v:{tandaId:number;fineId:number})=>await api.payTandaFine({householdId:data!.household!.id,...v}),onSuccess:inv});
  const voteExclude=useMutation({mutationFn:async(v:{tandaId:number;targetParticipantId:number})=>await api.voteExcludeParticipant({householdId:data!.household!.id,...v,voterName:me?fullName(me):"Organizador"}),onSuccess:inv});
  const confirmDelivery=useMutation({mutationFn:async(v:{tandaId:number;quincenaIndex:number;receiverId:number|null;by:"organizador"|"receptor"})=>await api.confirmTandaDelivery({householdId:data!.household!.id,...v}),onSuccess:inv});
  const addFundEntry=useMutation({mutationFn:async(v:{tandaId:number})=>await api.addTandaFundEntry({householdId:data!.household!.id,tandaId:v.tandaId,kind:(fundKind[v.tandaId]||"fondo") as "aportacion"|"fondo"|"multa",amount:Number(fundAmount[v.tandaId])||0,note:fundNote[v.tandaId]||undefined}),onSuccess:(_r,v)=>{inv();setFundAmount(p=>({...p,[v.tandaId]:""}));setFundNote(p=>({...p,[v.tandaId]:""}));}});
  const delTanda=useMutation({mutationFn:async(id:number)=>await api.deleteTanda({id}),onSuccess:inv});
  const addPart=useMutation({mutationFn:async(v:{tandaId:number;name:string;cardLast4?:string})=>await api.addTandaParticipant({householdId:data!.household!.id,tandaId:v.tandaId,name:v.name,cardLast4:v.cardLast4||undefined}),onSuccess:inv});
  const removePart=useMutation({mutationFn:async(id:number)=>await api.removeTandaParticipant({id}),onSuccess:inv});
  const setCard=useMutation({mutationFn:async(v:{id:number;cardLast4:string})=>await api.setParticipantCard(v),onSuccess:inv});
  const drawTanda=useMutation({mutationFn:async(v:{id:number;mode:"random"|"weighted"})=>await api.drawTanda({tandaId:v.id,mode:v.mode}),onSuccess:inv});
  const setPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;status:"paid"|"pending"|"late"})=>await api.setTandaPayment({householdId:data!.household!.id,...v}),onSuccess:inv});
  const uploadProof=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;file:File;paidDate?:string})=>{ const r=await fileToBase64(v.file); return await api.setTandaPayment({householdId:data!.household!.id,tandaId:v.tandaId,participantId:v.participantId,quincenaIndex:v.quincenaIndex,status:"paid",paidDate:v.paidDate,proof:{dataBase64:r.dataBase64,mimeType:r.mimeType}}); },onSuccess:inv});
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
    uploadProof.mutate({tandaId:r.tandaId,participantId:r.participantId,quincenaIndex:r.quincenaIndex,file:r.file,paidDate:r.paidDate},{onSuccess:()=>{ setTandaProofReview(null); setSavedNotice("Pago registrado con comprobante."); }});
  };
  const verifyPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;verified:boolean})=>await api.verifyTandaPayment({householdId:data!.household!.id,...v}),onSuccess:inv});
  const createTandaInv=useMutation({mutationFn:async(v:{tandaId:number})=>await api.createTandaInvitation({householdId:data!.household!.id,tandaId:v.tandaId,email:tInvEmail[v.tandaId]||"",invitedName:tInvName[v.tandaId]||undefined}),onSuccess:(r,v)=>{inv();setTInvResult(p=>({...p,[v.tandaId]:{emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl}}));setTInvEmail(p=>({...p,[v.tandaId]:""}));setTInvName(p=>({...p,[v.tandaId]:""}));}});
  const respondTandaInv=useMutation({mutationFn:async(v:{id:number;accept:boolean;name?:string})=>await api.respondTandaInvitation({id:v.id,accept:v.accept,name:v.name ?? (tJoinName[v.id]||undefined)}),onSuccess:inv});
  const rateOrg=useMutation({mutationFn:async(v:{tandaId:number})=>await api.rateOrganizer({householdId:data!.household!.id,tandaId:v.tandaId,raterName:rateName[v.tandaId]||"",stars:Number(rateStars[v.tandaId]||5),comment:rateComment[v.tandaId]||undefined}),onSuccess:(_r,v)=>{inv();setRateComment(p=>({...p,[v.tandaId]:""}));}});
  const remindPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number})=>await api.sendTandaReminder({householdId:data!.household!.id,...v}),onSuccess:inv});
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
    mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number})=>await api.createMercadoPagoOrder({householdId:data!.household!.id,...v}),
    onMutate:()=>{ try{ mpTabRef.current=window.open("about:blank","_blank"); }catch{ mpTabRef.current=null; } },
    onSuccess:(r,v)=>{ mpSaveOrder(v.tandaId,v.quincenaIndex,r.orderId); const tab=mpTabRef.current; mpTabRef.current=null; if(tab && !tab.closed) tab.location.href=r.checkoutUrl; else window.open(r.checkoutUrl,"_blank","noopener"); inv(); setSavedNotice("Se abrió el pago de Mercado Pago (PRUEBA) en otra pestaña. Al volver, pulse Verificar pago."); },
    onError:()=>{ const tab=mpTabRef.current; mpTabRef.current=null; try{ tab?.close(); }catch{} },
  });
  const checkMpOrder=useMutation({
    mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;orderId:string})=>await api.checkMercadoPagoOrder({householdId:data!.household!.id,...v}),
    onSuccess:(r,v)=>{ if(r.paid){ mpClearOrder(v.tandaId,v.quincenaIndex); inv(); setSavedNotice("Pago confirmado por Mercado Pago."); } else { setSavedNotice("El pago aún no aparece como aprobado en Mercado Pago. Inténtelo de nuevo en un momento."); } },
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
    rateName, setRateName, rateStars, setRateStars, rateComment, setRateComment,
    tandaProofReview, setTandaProofReview, mpOrders, mpOrderKey, mpClearOrder,
    copiedLink, copyLink, tandaInviteMessage, setReceiptView,
    pickTandaProof, confirmTandaProof,
    delTanda, drawTanda, setPay, addFine, verifyPay, addFundEntry, payFine, setRole,
    voteExclude, removePart, setCard, addPart, createTandaInv, respondTandaInv, resendInv,
    confirmDelivery, uploadProof, remindPay, createMpOrder, checkMpOrder, rateOrg,
  };
  const pickReceipt=async(file:File|undefined,set:(v:{dataBase64:string;mimeType:string;preview:string;file?:File}|null)=>void)=>{ if(!file) return; const r=await fileToBase64(file); set({dataBase64:r.dataBase64,mimeType:r.mimeType,preview:URL.createObjectURL(file),file}); };
  const [editProfId,setEditProfId]=useState<number|null>(null); const [editProfName,setEditProfName]=useState(""); const [editProfLast,setEditProfLast]=useState("");
  const [profLast,setProfLast]=useState("");
  const [invEmail2,setInvEmail2]=useState(""); const [invName2,setInvName2]=useState("");
  const [acceptFirst,setAcceptFirst]=useState<Record<number,string>>({}); const [acceptLast,setAcceptLast]=useState<Record<number,string>>({});
  const saveProfEdit=useMutation({mutationFn:async()=>{ const pr=data!.profiles.find(x=>x.id===editProfId); if(!pr) throw new Error("Perfil"); return await api.saveProfile({id:pr.id,householdId:data!.household!.id,name:editProfName,lastName:editProfLast,kind:pr.kind as "adult"|"dependent",dependentType:pr.dependentType||undefined,monthlyIncome:pr.monthlyIncome,fixedCommitments:pr.fixedCommitments,email:pr.email||undefined}); },onSuccess:()=>{inv();setEditProfId(null);}});
  const createInv=useMutation({mutationFn:async()=>await api.createInvitation({householdId:data!.household!.id,email:invEmail2,invitedName:invName2||undefined}),onSuccess:(r)=>{inv();setHhInvResult({emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl});setInvEmail2("");setInvName2("");}});
  const respondInv2=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondInvitation({id:v.id,accept:v.accept,firstName:acceptFirst[v.id]||undefined,lastName:acceptLast[v.id]||undefined}),onSuccess:(r)=>{ inv(); if(r.profileId) pickProfile(r.profileId); }});
  const delInv=useMutation({mutationFn:async(id:number)=>await api.deleteInvitation({id}),onSuccess:inv});

  // subcategorías editables + lectura automática del comprobante
  const [newSubName,setNewSubName]=useState(""); const [newSubByCat,setNewSubByCat]=useState<Record<number,string>>({});
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
  const createOcrCat=useMutation({mutationFn:async(v:{target:"mv"|"pers";name:string})=>await api.saveCategory({householdId:data!.household!.id,name:v.name,kind:"expense",subcategories:[],isActive:1}),onSuccess:(r,v)=>{inv(); if(v.target==="mv"){ if(r.id) setMvCat(String(r.id)); setOcrLabelMv(""); } else { if(r.id) setPersCat(String(r.id)); setOcrLabelPers(""); } setOcrNewCatName(""); setSavedNotice("Categoría creada y seleccionada.");}});
  // Reinicio completo de los formularios de movimiento: tras guardar, el
  // formulario debe quedar como recién abierto (sin foto, sin nota del
  // lector, sin concepto ni importe, fecha de hoy, paso 1). Antes solo se
  // limpiaban algunos campos y la nota «Leído del comprobante» (con el
  // nombre leído) y la fecha leída se quedaban, así que el siguiente gasto
  // heredaba el anterior.
  const resetMvForm=()=>{ setMvType("expense"); setMvStep(1); setMvAmount(""); setMvConcept(""); setMvAccount(""); setMvAccountError(""); setMvToAccount(""); setMvCat(""); setMvSub(""); setMvDate(todayISO()); setMvVis("shared"); setMvProfile(""); setMvMore(false); setEditingMv(null); setReceipt(null); setOcrDetailMv(null); setOcrLabelMv(""); setOcrNewCatName(""); setOcrNoticeMv(""); setOcrErrorMv(""); setOcrErrDetailMv(""); setOcrProgressMv(""); setOcrBusyMv(false); setOcrDateCheckMv(null); setOcrDateErrorMv(""); setAppliedRuleMv(null); setVoiceNoticeMv(""); setVoiceErrorMv(""); setVoiceBusyMv(false); setNewSubName(""); };
  const resetPersForm=()=>{ setPersAmt(""); setPersConcept(""); setPersReceipt(null); setPersCat(""); setPersAccount(""); setPersAccountError(""); setAppliedRulePers(null); setPersStep(1); setPersMore(false); setOcrDetailPers(null); setOcrLabelPers(""); setOcrNewCatName(""); setOcrNoticePers(""); setOcrErrorPers(""); setOcrErrDetailPers(""); setOcrProgressPers(""); setOcrBusyPers(false); setVoiceNoticePers(""); setVoiceErrorPers(""); setVoiceBusyPers(false); };
  // Registro rápido desde Inicio: se queda en Inicio y abre el formulario
  // de movimientos en un pop-up, sin ir a Movimientos. Al guardar, el
  // pop-up se cierra y el tablero se actualiza. El ref espeja el estado
  // para que el onSuccess de saveMv (definido antes) lo vea al guardar.
  const [inicioMvOpen,setInicioMvOpen]=useState(false);
  const inicioMvOpenRef=useRef(false);
  const openInicioMovement=(t:"income"|"expense")=>{ resetMvForm(); setMvType(t); inicioMvOpenRef.current=true; setInicioMvOpen(true); };
  const closeInicioMovement=()=>{ inicioMvOpenRef.current=false; setInicioMvOpen(false); resetMvForm(); };
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
  const exportCsv=()=>{
    const rows:(string|number|null)[][]=[["Fecha","Concepto","Tipo","Categoría","Subcategoría","Cuenta","Importe","Visibilidad"]];
    for(const m of filteredMovs) rows.push([m.date,m.concept,TYPE_LABEL[m.type]||m.type,getCatName(m.categoryId),m.subcategory||"",getAccName(m.accountId),m.amount,m.visibility==="shared"?"Compartido":"Privado"]);
    downloadTextFile(`syncfinanzas-movimientos-${monthNow()}.csv`,toCsv(rows),"text/csv;charset=utf-8");
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
      const existing=new Set(data.movements.filter(m=>!m.isReversed && !m.reversalOfId).map(m=>`${m.date}|${normText(m.concept)}|${m.amount}|${m.type}`));
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
  const importMv=useMutation({mutationFn:async(rows:ImportRow[])=>await api.importMovements({householdId:data!.household!.id,movements:rows.filter(r=>r.include).map(r=>({type:r.type,amount:r.amount,concept:r.concept,categoryId:r.categoryId,date:r.date,visibility:"shared" as const,accountId:r.accountId}))}),onSuccess:(r)=>{ inv(); setImportRows(null); setImportOpen(false); setSavedNotice(`Se importaron ${r.imported} movimiento(s)${r.skipped?` · ${r.skipped} duplicado(s) no se importaron`:""}.`); }});
  // Formulario de reglas en Categorías.
  const [ruleKeyword,setRuleKeyword]=useState(""); const [ruleCat,setRuleCat]=useState("");



  const catsForType = useMemo(()=>{ if(!data) return []; const kind = mvType==="income"?"income":"expense"; if(mvType==="transfer") return []; return data.categories.filter(c=>c.kind===kind && c.isActive===1); },[data,mvType]);
  const selectedCat = data?.categories.find(c=>String(c.id)===mvCat);
  const filteredMovs = useMemo(()=>{ if(!data) return []; const meId = currentProfileId ?? data.profiles.find(x=>x.role==="admin")?.id ?? data.profiles.find(x=>x.kind==="adult")?.id ?? null; const meIsAdmin = meId!=null && data.profiles.find(x=>x.id===meId)?.role==="admin"; const meRow = meId!=null ? { id: meId, role: meIsAdmin ? "admin" : "member" } : null; return filterMovements(data.movements.filter(m=> canSeeMovementRow(m, meRow)), mvFilters); },[data,mvFilters,currentProfileId]);

  // Los hooks van antes de los retornos de carga/error: si van después,
  // el primer render (cargando) llamaría menos hooks que el siguiente y
  // React fallaría. Cuenta de Efectivo por defecto: si el hogar tiene una
  // cuenta de efectivo real, el formulario la trae ya elegida (gastos se
  // descuentan de ahí, ingresos entran ahí). Si no hay cuenta de efectivo,
  // el campo queda vacío y la regla de cuenta obligatoria pide elegir una.
  const cashDefaultId = useMemo(()=> data ? defaultCashAccountId(data.accounts, data.movements) : "", [data]);
  useEffect(()=>{ if(!mvAccount && cashDefaultId) setMvAccount(cashDefaultId); },[mvAccount, cashDefaultId]);
  useEffect(()=>{ if(!persAccount && cashDefaultId) setPersAccount(cashDefaultId); },[persAccount, cashDefaultId]);
  // Al cambiar el mes que muestra el tablero, la lista de Inicio vuelve a mostrar solo los 5 más recientes.
  useEffect(()=>{ setShowAllHomeMovs(false); },[data?.summary?.currentMonth]);
  if(q.isPending) return <div className="min-h-screen bg-[var(--bg)] p-6 text-center text-[var(--dim)]">Cargando SyncFinanzas…</div>;
  if(q.error) return <div className="min-h-screen bg-[var(--bg)] p-6"><p className="text-[var(--red)]">No se pudo cargar. {String(q.error)}</p><button className={btnPrimary} onClick={()=>q.refetch()}>Reintentar</button></div>;
  if(!data) return null;

  // ---- ONBOARDING ----
  if(!data.household){
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="max-w-xl mx-auto px-3 pb-6 pt-4">
          {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-4 sm:p-5 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
          <p className="text-[var(--gold)] font-display font-extrabold tracking-wide text-sm">SYNCFINANZAS · VERSIÓN GRANDE</p>
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
          {tokenInvite && !tokenDone && (
            <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2" role="status">
              <h2 className="font-display font-bold text-lg">Invitación recibida por correo</h2>
              {tokenInvite.kind==="household" && <p className="text-sm">Usted fue invitado al hogar <b>“{tokenInvite.householdName}”</b>{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}. Al aceptar, entrará a ese hogar.</p>}
              {tokenInvite.kind==="tanda" && <p className="text-sm">Usted fue invitado a la tanda <b>“{tokenInvite.tandaName}”</b>{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}. Al aceptar, se incorporará como participante.</p>}
              {tokenInvite.kind==="general" && <p className="text-sm">Usted fue invitado a crear su cuenta personal en SyncFinanzas{tokenInvite.inviterName?` · le invitó ${tokenInvite.inviterName}`:""}.</p>}
              {!tokenInvite.usable && <p className="text-sm text-[var(--red)]">Ya se usó o venció. Solicite una nueva.</p>}
              {tokenInvite.usable && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input aria-label="Su nombre al aceptar la invitación del enlace" placeholder="Nombre" className={inputCls} value={joinFirst} onChange={e=>setJoinFirst(e.target.value)} />
                    <input aria-label="Su apellido al aceptar la invitación del enlace" placeholder="Apellido" className={inputCls} value={joinLast} onChange={e=>setJoinLast(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} onClick={()=>acceptTokenInvite.mutate()} disabled={acceptTokenInvite.isPending}>{tokenInvite.kind==="general"?"Aceptar y crear mi cuenta":"Aceptar invitación"}</button>
                    <button type="button" className={btnGhost} onClick={()=>rejectTokenInvite.mutate()} disabled={rejectTokenInvite.isPending}>Rechazar</button>
                  </div>
                  {(acceptTokenInvite.error || rejectTokenInvite.error) && <p className="text-sm text-[var(--red)]">{String(acceptTokenInvite.error || rejectTokenInvite.error)}</p>}
                </>
              )}
            </div>
          )}
          {tokenDone && <p className="text-sm text-[var(--green)] mt-4" role="status">Invitación respondida.</p>}
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
        </main>
      </div>
    );
  }

  // La primera pantalla es siempre Inicio: al abrir la app, al entrar después
  // de iniciar sesión y al reabrirla, se ven saldo, gráficas, movimientos y las
  // tarjetas principales, sin abrir el menú ni ir a otra pestaña.
  const s=data.summary; const hh=data.household; const effTab:Tab = tab; const goTab=(x:Tab)=>{setTab(x); if(x==="inicio"){ setChartsSeen(true); try{ localStorage.setItem("sf-guide-charts-seen","1"); }catch{} }};
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
  const tabLabel = (tid:Tab)=> TABS.find(x=>x.id===tid)?.label ?? tid;
  const drawerSections: DrawerMenuSection[] = [...drawerGroups.map(g=>({title:g.title, tabs: orderDrawerTabs(g.title, g.tabs, tabLabel).map(tid=>({id:tid, label:tabLabel(tid)}))})), {title:"Configuración", tabs:[], config:true}];
  // Ir a un módulo y dejar el campo del importe a la vista con el cursor listo:
  // cambia de pestaña y, cuando el formulario ya se pintó, lo desplaza al centro
  // (así el encabezado fijo no lo tapa) y le da el foco para escribir.
  const goToForm=(x:Tab,fieldId:string)=>{ goTab(x); window.setTimeout(()=>{ const el=document.getElementById(fieldId); el?.scrollIntoView({block:"center",behavior:"smooth"}); (el as HTMLInputElement|null)?.focus({preventScroll:true}); },250); };
  // Al cambiar de paso dentro de un formulario, la tarjeta debe quedar visible:
  // se desplaza sola hasta arriba de la tarjeta (scroll-mt-28 evita que el
  // encabezado fijo la tape) para seguir llenando sin tener que buscarla.
  const scrollFormTop=(id:string)=>{ window.setTimeout(()=>{ document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"}); },60); };
  const openNewMovement=(t:"income"|"expense")=>{ setEditingMv(null); setMvType(t); setMvCat(""); setMvSub(""); setMvStep(1); goToForm("movimientos","mv-amount"); };
  const fullName=(pr:{name:string;lastName?:string|null})=>`${pr.name} ${pr.lastName||""}`.trim();
  const me = data.profiles.find(x=>x.id===currentProfileId) || data.profiles.find(x=>x.role==="admin") || data.profiles.find(x=>x.kind==="adult") || null;
  const guideStep1 = hh.mode==="personal" ? data.personal.salary>0 : data.accounts.length>0;
  const guideStep2 = data.movements.length>0;
  const guideStep3 = chartsSeen;
  const isAdmin = !me || me.role==="admin";
  // Permisos de tanda del perfil actual (me): la interfaz solo muestra los
  // botones que corresponden a su rol; el servidor es la autoridad y rechaza
  // lo no permitido. El rol sale de la fila de participante (por correo o
  // por nombre) o de los campos organizador/tesorero/suplente de la tanda.
  const tandaPerms = (td: (typeof data.tandas)[number]) => {
    const meName = me ? fullName(me).trim().toLowerCase() : "";
    const meEmail = (me?.email || "").trim().toLowerCase();
    const myPart = td.participants.find(p => (p.email && meEmail !== "" && p.email.trim().toLowerCase() === meEmail) || (meName !== "" && p.name.trim().toLowerCase() === meName)) ?? null;
    const excluded = myPart?.excluded === 1;
    const rankOf = (r: string | null | undefined) => r === "organizador" ? 3 : (r === "tesorero" || r === "suplente") ? 2 : r === "participante" ? 1 : 0;
    let rank = 0;
    if (!excluded) {
      if (myPart) rank = Math.max(rank, rankOf(myPart.role));
      if (me) {
        if (td.organizerProfileId === me.id) rank = Math.max(rank, 3);
        else if (td.treasurerProfileId === me.id) rank = Math.max(rank, 2);
        else if (td.substituteProfileId === me.id) rank = Math.max(rank, 2);
      }
    }
    const myParticipantId = !excluded && myPart ? myPart.id : null;
    return {
      isAdmin,
      myParticipantId,
      isParticipant: myParticipantId != null,
      canManage: isAdmin || rank >= 3,
      canTreasury: isAdmin || rank >= 2,
      isOwn: (participantId: number) => myParticipantId === participantId,
    };
  };
  // Visibilidad de movimientos: en modo Familiar un integrante ve los
  // movimientos compartidos, los suyos y (si es administrador) los sin
  // perfil; los privados de otros integrantes no se listan. Es la misma
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
  // Meses con al menos un movimiento visible: el selector de mes solo
  // habilita esos meses, para que no se pueda elegir un mes en blanco.
  const monthsWithMovs = new Set(visibleMovs.map(m=>m.date.slice(0,7)));
  // Movimientos del detalle de ingresos vs gastos: misma regla con la que el
  // servidor arma las barras (mes tocado, ingreso o gasto/pago de deuda, sin
  // reversados ni reversiones), para que la suma coincida con la barra.
  const incExpBase = incExpDetail ? data.movements.filter(m=> m.date.startsWith(incExpDetail.month) && !m.isReversed && !m.reversalOfId && (incExpDetail.kind==="income" ? m.type==="income" : (m.type==="expense"||m.type==="debt_payment"))).sort((a,b)=> b.date.localeCompare(a.date) || b.id-a.id) : [];
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
  <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Tipo de movimiento">
    {(["expense","income","transfer","debt_payment"] as const).map(t=><button type="button" key={t} aria-label={TYPE_LABEL[t]} onClick={()=>{setMvType(t);setMvCat("");setMvSub("");}} className={`rounded-full py-2 text-[12px] font-bold ${mvType===t?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>{TYPE_LABEL[t]}</button>)}
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
  {mvType!=="transfer" && <>
    <div><Label htmlFor="mv-cat">{mvType==="income"?"Tipo de ingreso":"Tipo de gasto"}</Label><select id="mv-cat" aria-label="Categoría del movimiento" className={inputCls} value={mvCat} onChange={e=>{setMvCat(e.target.value);setMvSub("");setAppliedRuleMv(null);}}><option value="">Sin categoría</option>{catsForType.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div><Label htmlFor="mv-sub">Subcategoría</Label><select id="mv-sub" aria-label="Subcategoría del movimiento" className={inputCls} value={mvSub} onChange={e=>setMvSub(e.target.value)} disabled={!selectedCat}><option value="">{selectedCat?"Seleccione…":"Primero seleccione la categoría"}</option>{(selectedCat?.subcategories||[]).map(sb=><option key={sb} value={sb}>{sb}</option>)}<option value="__new__">+ Nueva subcategoría…</option></select>                {mvSub==="__new__" && selectedCat && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-2.5 bg-[var(--surface2)]"><p className="text-xs">¿Agregar “{newSubName||"…"}” a {selectedCat.name}?</p><div className="flex gap-2 mt-2"><input aria-label="Nombre de la nueva subcategoría" placeholder="Nombre de la subcategoría" className={inputCls} value={newSubName} onChange={e=>setNewSubName(e.target.value)} /><button type="button" aria-label="Confirmar y agregar la nueva subcategoría" className={btnPrimary} disabled={!newSubName.trim() || addSub.isPending} onClick={()=>addSub.mutate({categoryId:selectedCat.id,name:newSubName.trim()},{onSuccess:()=>{setMvSub(newSubName.trim());setNewSubName("");}})}>Sí, agregar</button></div>{addSub.error && <p className="text-xs text-[var(--red)] mt-1">{String(addSub.error)}</p>}</div>}
    </div>
  </>}
  {mvType==="transfer" && <p className="text-sm text-[var(--dim)]">Las transferencias no llevan categoría.</p>}
  {ocrLabelMv && mvCat==="" && mvType!=="transfer" && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
    <p className="text-sm">La categoría sugerida «{ocrLabelMv}» no está en su hogar. Puede crearla ya ajustada a este ticket.</p>
    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" className={inputCls} value={ocrNewCatName} onChange={e=>setOcrNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría sugerida y usarla" className={btnPrimary} disabled={!ocrNewCatName.trim() || createOcrCat.isPending} onClick={()=>createOcrCat.mutate({target:"mv",name:ocrNewCatName.trim()})}>{createOcrCat.isPending?"Creando…":"Crear y usar"}</button></div>
    <button type="button" className="text-xs underline mt-2" onClick={()=>setOcrLabelMv("")}>Omitir, elegiré otra</button>
    {createOcrCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createOcrCat.error)}</p>}
  </div>}
  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setMvStep(1); scrollFormTop("mv-form");}}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} onClick={()=>{setMvStep(3); scrollFormTop("mv-form");}}>Siguiente</button></div>
  </>}
  {mvStep===3 && <>
  <div><Label htmlFor="mv-concept">Concepto</Label><div className="flex gap-2"><input id="mv-concept" aria-label="Concepto del movimiento" required className={inputCls+" flex-1"} value={mvConcept} onChange={e=>{setMvConcept(e.target.value);applyRuleTo(e.target.value,"mv");}} placeholder="Ej. Súper semanal" />{(mvType==="expense"||mvType==="debt_payment") && <button type="button" aria-label={voiceBusyMv?"Escuchando…":"Dictar el gasto por voz"} title="Dictar por voz" className="shrink-0 w-11 rounded-xl border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center" disabled={voiceBusyMv} onClick={()=>startVoice("mv")}>{micIcon}</button>}</div>
  {voiceBusyMv && <p className="text-xs text-[var(--dim)] mt-1">Escuchando… Diga, por ejemplo, «gasté 320 en el súper».</p>}
  {voiceErrorMv && <p className="text-xs text-[var(--red)] mt-1">{voiceErrorMv}</p>}
  {voiceNoticeMv && <p className="text-xs text-[var(--green)] mt-1">{voiceNoticeMv}</p>}
  {appliedRuleMv && <p className="text-xs text-[var(--dim)] mt-1">Regla aplicada: «{appliedRuleMv.keyword}» → {appliedRuleMv.categoryName}. Puede cambiarla en el paso 2.</p>}</div>
  <div><Label htmlFor="mv-account">{mvType==="income"?"¿A qué cuenta entra?":mvType==="transfer"?"¿De qué cuenta sale?":"¿De dónde se descuenta?"}</Label><select id="mv-account" aria-label="Cuenta del movimiento" className={inputCls} value={mvAccount} onChange={e=>{setMvAccount(e.target.value); setMvAccountError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</select></div>
  {mvAccountError && <p className="text-sm text-[var(--red)]">{mvAccountError}</p>}
  {ocrDetailMv && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">¿Este movimiento es Compartido o Privado?</p>
    <p className="text-xs text-[var(--dim)]">Revise antes de guardar: lo compartido lo ven todos; lo privado solo usted.</p>
    <div className="grid grid-cols-2 gap-1.5 mt-2" role="group" aria-label="Visibilidad del movimiento leído">
      <button type="button" aria-label="Movimiento compartido" onClick={()=>setMvVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="shared"?"bg-[var(--green)] text-white":"border border-[var(--border)]"}`}>Compartido</button>
      <button type="button" aria-label="Movimiento privado" onClick={()=>setMvVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
    </div>
    <p className="text-xs text-[var(--dim)] mt-1">{mvVis==="shared"?"Lo ven todos.":"Solo usted lo ve."}</p>
  </div>}
  {mvType==="transfer" && <div><Label htmlFor="mv-to">Cuenta destino</Label><select id="mv-to" aria-label="Cuenta destino" className={inputCls} value={mvToAccount} onChange={e=>setMvToAccount(e.target.value)}><option value="">Seleccione…</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
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
      <button type="button" aria-label="Movimiento compartido" onClick={()=>setMvVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="shared"?"bg-[var(--green)] text-white":"border border-[var(--border)]"}`}>Compartido</button>
      <button type="button" aria-label="Movimiento privado" onClick={()=>setMvVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
    </div>
    <p className="text-xs text-[var(--dim)] mt-1">{mvVis==="shared"?"Lo ven todos.":"Solo usted lo ve."}</p>
  </div>
    </div>)}
  </div>
  {mvReview.length>0 && <div className="border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
    <p className="text-sm font-bold">Revisión de Mike</p>
    {mvReview.map((w,i)=><p key={i} className="text-sm mt-1">{w}</p>)}
    <p className="text-xs text-[var(--dim)] mt-1">Es solo un aviso: puede guardar de todos modos.</p>
  </div>}
  {Number(mvAmount)>=hh.approvalThreshold && mvVis==="shared" && mvType==="expense" && <Help>Supera el umbral de {money(hh.approvalThreshold)}: requiere un Acuerdo.</Help>}
  {saveMv.error && <p className="text-sm text-[var(--red)]">{String(saveMv.error)}</p>}
  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setMvStep(2); scrollFormTop("mv-form");}}>Atrás</button><button className={btnPrimary+" flex-1"} disabled={saveMv.isPending || !mvAmount || !mvConcept}>{saveMv.isPending?"Guardando…":editingMv?"Guardar cambios":"Finalizar"}</button></div>
  {editingMv && <button type="button" className={btnGhost+" w-full"} onClick={()=>{setEditingMv(null);setMvStep(1);}}>Cancelar edición</button>}
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
              <p className="font-display font-extrabold leading-tight truncate">{hh.name}</p>
              <p className="text-xs text-[var(--dim)] mt-0.5">{hh.mode==="personal"?"MODO PERSONAL":"MODO FAMILIAR"}</p>
            </div>
            <button type="button" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)} className="shrink-0 w-9 h-9 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
          </div>
          <p className="text-sm text-[var(--dim)] mt-2">Disponible</p>
          <p className="font-display text-2xl font-extrabold">{money2(s.availableFree)}</p>
        </div>
        <DrawerMenu
          sections={drawerSections}
          currentTab={effTab}
          onNavigate={(t)=>{goTab(t);setMenuOpen(false);}}
          openGroups={openDrawerGroups}
          onToggleGroup={(title, open)=>setOpenDrawerGroups(prev=>({...prev,[title]:open}))}
          configOpen={configOpen}
          onToggleConfig={()=>setConfigOpen(o=>!o)}
          vistaOpen={vistaOpen}
          onToggleVista={()=>setVistaOpen(o=>!o)}
          darkMode={darkMode}
          onSetThemeMode={(d)=>setThemeMode(d)}
        />
        <div className="px-3 pb-4 pt-2 border-t border-[var(--border)]">
          <button type="button" aria-label="Abrir a Mike" onClick={()=>{ setMenuOpen(false); setHelpOpen(true); }} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--dim)]">MIKE</span>
          </button>
        </div>
      </div>
      {/* Header */}
      <header className={`sticky top-0 ${menuOpen?"z-40":"z-20"} bg-[var(--bg)]/95 backdrop-blur border-b border-[var(--border)] pt-safe`}>
        <div className="max-w-5xl mx-auto px-2 sm:px-3 py-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" aria-label={menuOpen?"Cerrar menú de módulos":"Abrir menú de módulos"} aria-expanded={menuOpen} aria-controls="menu-modulos" onClick={()=>setMenuOpen(o=>!o)} className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex flex-col items-center justify-center gap-[5px]">
              <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-transform ${menuOpen?"translate-y-[7.5px] rotate-45":""}`} />
              <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-opacity ${menuOpen?"opacity-0":""}`} />
              <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-transform ${menuOpen?"-translate-y-[7.5px] -rotate-45":""}`} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-display font-extrabold leading-tight flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] sm:text-xl"><span className="min-w-0 truncate">{hh.name}</span><span className="shrink-0 text-[11px] bg-[#E8B84A] text-[#13262E] rounded-full px-2 py-0.5 whitespace-nowrap">{hh.mode==="personal"?"MODO PERSONAL":"MODO FAMILIAR"}</span></p>
            </div>
            <div className="flex gap-1 sm:gap-2 shrink-0">
              <button type="button" aria-label="Ir a Inicio" aria-current={effTab==="inicio"?"page":undefined} onClick={()=>{goTab("inicio");setMenuOpen(false);window.setTimeout(()=>window.scrollTo({top:0,behavior:"smooth"}),60);}} className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center">
                <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </button>
              <button type="button" className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center" aria-label={bellLabel} onClick={toggleNotif}>
                <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                {bellCount>0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--red)] text-white text-[11px] font-bold flex items-center justify-center">{bellCount>99?"99+":bellCount}</span>}
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
            {notifQuery.data && notifQuery.data.notifications.length===0 && !updateAvailable && <p className="text-sm text-[var(--dim)] mt-2">Sin avisos por ahora.</p>}
            {updateAvailable && (
              <div className="mt-2 rounded-xl border-2 border-[var(--gold)] bg-[var(--surface2)] p-3" role="status">
                <p className="text-sm font-bold">Hay una nueva versión de la app</p>
                <p className="text-sm text-[var(--dim)] mt-0.5">Actualice para ver los últimos cambios. Su cuenta y sus datos no cambian.</p>
                <button type="button" className={btnPrimary+" mt-2"} disabled={updateApplying} onClick={()=>{ setUpdateApplying(true); applyAppUpdate(); }}>{updateApplying?"Actualizando…":"Actualizar ahora"}</button>
              </div>
            )}
            <ul className="mt-2 space-y-2">
              {notifQuery.data?.notifications.map(n=>(
                <li key={n.id}>
                  <button type="button" className={`w-full text-left rounded-xl border p-3 ${n.isRead?"border-[var(--border)]":"border-[var(--gold)] bg-[var(--surface2)]"}`} onClick={()=>openNotif(n)}>
                    <p className="text-sm font-bold">{n.title}{!n.isRead && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-[var(--red)]" aria-label="Sin leer" />}</p>
                    <p className="text-sm text-[var(--dim)] mt-0.5">{n.body}</p>
                    <p className="text-xs text-[var(--dim)] mt-1">{new Date(n.createdAt).toLocaleString("es-MX",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-3 pb-8 pt-4">
        {updateAvailable && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5 flex items-center gap-2" role="status"><p className="text-sm flex-1"><b>Hay una nueva versión de SyncFinanzas.</b> Su cuenta y sus datos no cambian.</p><button type="button" className={btnPrimary} disabled={updateApplying} onClick={()=>{ setUpdateApplying(true); applyAppUpdate(); }}>{updateApplying?"Actualizando…":"Actualizar"}</button><button type="button" aria-label="Cerrar el aviso de actualización" onClick={()=>setUpdateAvailable(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-4 sm:p-5 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {savedNotice && <div ref={savedNoticeRef} className="mb-3 bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5 flex flex-wrap items-center gap-2" role="status"><span className="shrink-0 w-7 h-7 rounded-full bg-[var(--green)] text-white font-bold flex items-center justify-center text-sm">✓</span><p className="text-sm font-bold flex-1 min-w-40">{savedNotice}</p><button type="button" aria-label="Ir a Inicio" className="w-full sm:w-auto rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-6 py-3 text-base flex items-center justify-center gap-2 shrink-0" onClick={()=>{setSavedNotice(null);goTab("inicio");}}>↑ Ir a Inicio</button><button type="button" aria-label="Cerrar el aviso" onClick={()=>setSavedNotice(null)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {firstGuideOpen && (
          <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5 sm:p-3.5" role="status">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-lg">Empiece en 3 pasos</h2>
                
              </div>
              <button type="button" aria-label="Cerrar la guía de inicio" onClick={dismissFirstGuide} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            <ol className="mt-3 space-y-2">
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep1?"bg-[var(--green)] text-white":"bg-[#E8B84A] text-[#13262E]"} font-bold flex items-center justify-center text-sm`}>{guideStep1?"✓":"1"}</span><div className="flex-1"><p className="text-sm font-bold">{hh.mode==="personal"?"Registre su sueldo":"Abra su cuenta inicial"}</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Escriba su sueldo en Personal.":"Pulse Nueva cuenta en Cuentas."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab(hh.mode==="personal"?"personal":"cuentas")}>{hh.mode==="personal"?"Ir a Personal":"Ir a Cuentas"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep2?"bg-[var(--green)] text-white":"bg-[#E8B84A] text-[#13262E]"} font-bold flex items-center justify-center text-sm`}>{guideStep2?"✓":"2"}</span><div className="flex-1"><p className="text-sm font-bold">Registre su primer gasto</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Registre su gasto del día en Personal.":"Escriba el importe en Movimientos."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>{ if(hh.mode==="personal"){ setPersStep(1); goToForm("personal","pers-amt"); } else { openNewMovement("expense"); } }}>{hh.mode==="personal"?"Ir a Personal":"Ir a Movimientos"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep3?"bg-[var(--green)] text-white":"bg-[#E8B84A] text-[#13262E]"} font-bold flex items-center justify-center text-sm`}>{guideStep3?"✓":"3"}</span><div className="flex-1"><p className="text-sm font-bold">Revise sus gráficas</p><p className="text-sm text-[var(--dim)]">Vea su gasto por categoría en Inicio.</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab("inicio")}>Ir a Inicio</button></li>
            </ol>
            <button type="button" className={btnPrimary+" mt-3"} onClick={dismissFirstGuide}>Entendido</button>
          </div>
        )}
        {!appInstalled && !installDismissed && <div className="mb-3"><InstallCard installed={appInstalled} onInstall={handleInstallClick} onDismiss={dismissInstall} /></div>}
        {effTab==="inicio" && (
          <section>
            {/* Tarjeta principal quieta (propuesta Unslop): Disponible en
                36 px, flujo del mes y variación contra el mes anterior,
                calculada de monthlySeries. Al tocarla se abre la ventana
                «Resumen del mes», como antes hacía la banda. */}
            <button type="button" aria-label="Ver el resumen completo del mes" onClick={()=>setShowSummary(true)} className="relative block w-full overflow-hidden text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
              <span aria-hidden="true" className="absolute left-0 right-0 top-0 h-[3px] bg-[var(--gold)]" />
              <span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Disponible · {fmtMonth(s.currentMonth).toUpperCase()}</span>
              <span className="block font-display text-4xl font-extrabold leading-tight mt-1">{money2(s.availableFree)}</span>
              <span className="block text-sm text-[var(--dim)] mt-1">Total {money2(s.totalBalance)} − fondos apartados {money2(s.fundsReserved)}.</span>
              <span className="mt-4 grid grid-cols-3 gap-2 text-center">
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Entradas</span><span className="block font-display text-base font-bold text-[var(--green)]">{money(s.monthIncome)}</span></span>
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Salidas</span><span className="block font-display text-base font-bold text-[var(--red)]">{money(s.monthExpense)}</span></span>
                <span className="block"><span className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--gold-text)]">Neto</span><span className="block font-display text-base font-bold">{money(s.monthNet)}</span></span>
              </span>
              {netVar && <span className="block text-[13px] text-[var(--dim)] mt-3">{netVar.diff>0?`Neto ${money(netVar.diff)} más que en ${netVar.prevName}`:netVar.diff<0?`Neto ${money(-netVar.diff)} menos que en ${netVar.prevName}`:`Neto igual que en ${netVar.prevName}`}</span>}
            </button>

            {data.movements.length>0 && (
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <h2 className="font-display font-bold text-lg">Gasto por categoría · {fmtMonth(s.currentMonth)}</h2>
                                <CategoryChart data={data.personal.byCategory} detailOpen={catDetail!==null} palette={DONUT_PALETTE_INICIO} large reserveLine minIconPct={10} onSelect={(d)=>setCatDetail({categoryId:d.categoryId,name:d.name,total:d.total,month:s.currentMonth})} />
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <h2 className="font-display font-bold text-lg">Ingresos vs gastos · últimos 6 meses</h2>
                <MonthlyChart series={s.monthlySeries} currentMonth={s.currentMonth} todayMonth={todayISO().slice(0,7)} inicio onSelect={(kind,month,label)=>setIncExpDetail({kind,month,label})} />
              </div>
            </div>
            )}
            <HomeMovementsCard
              month={s.currentMonth}
              monthLabel={fmtMonth(s.currentMonth)}
              onMonthChange={setViewMonth}
              monthsWithMovements={monthsWithMovs}
              summary={homeMovSummary}
              rows={homeMovs.map(m=>({key:m.id,title:movTitle(m),detail:`${fmtDate(m.date)} · ${TYPE_LABEL[m.type]||m.type} · ${getCatName(m.categoryId)} · ${getAccName(m.accountId)}${m.isReversed?" · Reversado (fuera de los totales)":""}${m.reversalOfId?" · Reversión (fuera de los totales)":""}`,amount:`${m.type==="income"?"+":"−"}${money(m.amount)}`,isIncome:m.type==="income",struck:!!(m.isReversed||m.reversalOfId)}))}
              hasAnyMovements={data.movements.length>0}
              showAll={showAllHomeMovs}
              onToggleShowAll={()=>setShowAllHomeMovs(v=>!v)}
              onNewMovement={openInicioMovement}
            />
            <div className="grid md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.budgets.filter(b=>b.month===s.currentMonth).length===0 ? null : (
              <CollapsibleCard title={<h2 className="font-display font-bold text-lg">Presupuestos</h2>} above={<p className="text-sm text-[var(--dim)] mt-1">Total {money(monthBudgetsSum.total)} · Gastado {money(monthBudgetsSum.spent)}</p>}>
                {data.budgets.filter(b=>b.month===s.currentMonth).map(b=>(
                  <div key={b.id} className="mt-3"><button type="button" aria-label={`Pagar del presupuesto de ${getCatName(b.categoryId)}`} className="w-full text-left" onClick={()=>{setQuickBud(quickBud===b.id?null:b.id);setQuickBudAmt("");setQuickBudAcc("");}}><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0">{getCatName(b.categoryId)} · {b.visibility==="shared"?"Compartido":"Privado"}</span><span className="flex items-center gap-1 shrink-0"><b className="text-base whitespace-nowrap">{money(b.spent)} / {money(b.amount)}</b><span aria-hidden="true" className="text-[var(--dim)]">›</span></span></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${b.pct>=100?"bg-[var(--red)]":"bg-[var(--accent)]"}`} style={{width:`${Math.min(100,b.pct)}%`}} /></div>{b.remaining<0?<p className="text-[13px] font-bold text-[var(--red)]">Sobrepasado por {money(-b.remaining)} · {b.pct}% usado</p>:<p className="text-[13px] text-[var(--dim)]">Restan {money(b.remaining)} · {b.pct}% usado</p>}</button>{quickBud===b.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!quickBudAmt||Number(quickBudAmt)<=0) return; payBudget.mutate({categoryId:b.categoryId,categoryName:getCatName(b.categoryId),visibility:b.visibility,amount:Number(quickBudAmt),accountId:quickBudAcc?Number(quickBudAcc):null});}}><p className="font-display font-bold text-sm">Pagar · {getCatName(b.categoryId)}</p><div><Label htmlFor={`qb-amt-${b.id}`}>Importe ($)</Label><input id={`qb-amt-${b.id}`} autoFocus aria-label={`Importe a pagar del presupuesto de ${getCatName(b.categoryId)}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickBudAmt} onChange={e=>setQuickBudAmt(e.target.value)} /></div><div><Label htmlFor={`qb-acc-${b.id}`}>¿De dónde se descuenta?</Label><select id={`qb-acc-${b.id}`} aria-label="Cuenta de donde se descuenta el pago del presupuesto" className={inputCls} value={quickBudAcc} onChange={e=>setQuickBudAcc(e.target.value)}><option value="">Efectivo</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</select></div>{payBudget.error && <p className="text-sm text-[var(--red)]">{String(payBudget.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={payBudget.isPending||!quickBudAmt}>{payBudget.isPending?"Guardando…":"Guardar pago"}</button><button type="button" className={btnGhost} onClick={()=>setQuickBud(null)}>Cancelar</button></div></form>)}
                  </div>
                ))}
              </CollapsibleCard>
              )}
              {data.goals.length===0 && data.patrimony.length===0 ? null : (
              <CollapsibleCard
                title={<h2 className="font-display font-bold text-lg">Metas y patrimonio</h2>}
                above={<>
                <div className="border-t border-[var(--border)] mt-3 pt-3 flex justify-between gap-2"><span className="text-sm">Patrimonio neto</span>{/* Mismas clases que las cifras de Entradas, Salidas y Neto de la tarjeta principal (font-display text-base font-bold): decisión visual deliberada 2026-11-17, para que se lea igual de grande que esas; shrink-0 es solo para que no se apriete en la fila. */}<b className="font-display text-base font-bold whitespace-nowrap shrink-0">{money2(s.netWorth)}</b></div>
                <p className="text-xs text-[var(--dim)]">Activos {money(s.totalAssets)} − Pasivos {money(s.totalLiabilities)}.</p>
                {data.goals.length>0 && <p className="text-xs text-[var(--dim)]">Metas: {money(goalsSum.saved)} ahorrado de {money(goalsSum.target)} · {data.goals.length} {data.goals.length===1?"meta":"metas"}</p>}
                </>}
                below={<>
                {data.patrimony.length>3 && <button type="button" aria-label="Ver todo el patrimonio" className="text-sm font-bold underline mt-2" onClick={()=>goTab("patrimonio")}>Ver todos</button>}
                {data.patrimony.length===0 && <button type="button" aria-label="Agregar patrimonio" className={btnPrimary+" mt-2"} onClick={()=>goToForm("patrimonio","pat-value")}>+ Agregar patrimonio</button>}
                {data.goals.length===0 && <button type="button" aria-label="Agregar meta" className={btnPrimary+" mt-2"} onClick={()=>goToForm("metas","goal-target")}>+ Agregar meta</button>}
                </>}
              >
                {data.goals.slice(0,3).map(g=><div key={g.id} className="mt-3"><button type="button" aria-label={`Aportar a la meta ${g.name}`} className="w-full text-left" onClick={()=>{setQuickGoal(quickGoal===g.id?null:g.id);setQuickGoalAmt("");setQuickGoalAcc("");}}><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0">{g.name}</span><span className="flex items-center gap-1 shrink-0"><b>{g.pct}%</b><span aria-hidden="true" className="text-[var(--dim)]">›</span></span></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div><p className="text-[13px] text-[var(--dim)]">{money(g.savedAmount)} de {money(g.targetAmount)}{g.targetDate?` · meta ${fmtDate(g.targetDate)}`:""} · {g.targetAmount-g.savedAmount>0?`Restan ${money(g.targetAmount-g.savedAmount)} para la meta`:"Meta alcanzada"}</p></button>{quickGoal===g.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(!quickGoalAmt||Number(quickGoalAmt)<=0) return; contributeGoal.mutate({id:g.id,amount:Number(quickGoalAmt),accountId:quickGoalAcc?Number(quickGoalAcc):null});}}><p className="font-display font-bold text-sm">Aportar a {g.name}</p><div><Label htmlFor={`qg-amt-${g.id}`}>Importe ($)</Label><input id={`qg-amt-${g.id}`} autoFocus aria-label={`Importe a aportar a la meta ${g.name}`} type="number" min="0.01" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickGoalAmt} onChange={e=>setQuickGoalAmt(e.target.value)} /></div><div><Label htmlFor={`qg-acc-${g.id}`}>¿De dónde se descuenta?</Label><select id={`qg-acc-${g.id}`} aria-label="Cuenta de donde se descuenta el aporte a la meta" className={inputCls} value={quickGoalAcc} onChange={e=>setQuickGoalAcc(e.target.value)}><option value="">Efectivo</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</select></div>{contributeGoal.error && <p className="text-sm text-[var(--red)]">{String(contributeGoal.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={contributeGoal.isPending||!quickGoalAmt}>{contributeGoal.isPending?"Guardando…":"Guardar aporte"}</button><button type="button" className={btnGhost} onClick={()=>setQuickGoal(null)}>Cancelar</button></div></form>)}
                </div>)}
                {data.patrimony.slice(0,3).map(p=><div key={p.id} className="mt-2"><button type="button" aria-label={`Actualizar el valor de ${p.name}`} className="w-full text-left flex justify-between gap-2 text-sm" onClick={()=>{setQuickPat(quickPat===p.id?null:p.id);setQuickPatVal(String(p.value));}}><span className="min-w-0">{p.name} · {p.kind==="asset"?"Activo":"Pasivo"}</span><b className="shrink-0 whitespace-nowrap">{money(p.value)}</b></button>{quickPat===p.id && (<form className="mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)] space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); updatePat.mutate({id:p.id,name:p.name,kind:p.kind,category:p.category,value:Number(quickPatVal)||0,owner:p.owner});}}><p className="font-display font-bold text-sm">Actualizar · {p.name}</p><div><Label htmlFor={`qp-val-${p.id}`}>Valor ($)</Label><input id={`qp-val-${p.id}`} autoFocus aria-label={`Nuevo valor de ${p.name}`} type="number" min="0" step="0.01" required className={inputCls+" text-lg font-bold"} value={quickPatVal} onChange={e=>setQuickPatVal(e.target.value)} /></div>{updatePat.error && <p className="text-sm text-[var(--red)]">{String(updatePat.error)}</p>}<div className="flex gap-2"><button className={btnPrimary+" flex-1"} disabled={updatePat.isPending}>{updatePat.isPending?"Guardando…":"Guardar valor"}</button><button type="button" className={btnGhost} onClick={()=>setQuickPat(null)}>Cancelar</button></div></form>)}
                </div>)}
              </CollapsibleCard>
              )}
              <HomeTandasCard tandas={data.tandas} onOpenDetail={openTandaDetail} onGoTandas={()=>goTab("tandas")} />
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
              <p className="text-xs text-[var(--dim)] mt-2">{filteredMovs.length} movimientos · Entradas {money(filteredMovs.filter(m=>m.type==="income" && !m.isReversed && !m.reversalOfId).reduce((a,m)=>a+m.amount,0))} · Salidas {money(filteredMovs.filter(m=>m.type!=="income" && !m.isReversed && !m.reversalOfId).reduce((a,m)=>a+m.amount,0))}</p>
              <div className="flex gap-2 flex-wrap mt-2">
                <button type="button" aria-label="Exportar los movimientos visibles a CSV" className={btnGhost} onClick={exportCsv}>Exportar CSV</button>
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
                {filteredMovs.map(m=>{ const annulled = m.isReversed || !!m.reversalOfId; return <div key={m.id} className={`py-2 ${annulled?"opacity-70":""}`}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-sm">{movTitle(m)}</p><p className="text-xs text-[var(--dim)]">{fmtDate(m.date)} · {TYPE_LABEL[m.type]||m.type} · {getCatName(m.categoryId)}{m.subcategory?` / ${m.subcategory}`:""} · {getAccName(m.accountId)} · {m.visibility==="shared"?"Compartido":"Privado"} · por {m.profileId?(fullName(data.profiles.find(x=>x.id===m.profileId)||{name:"Integrante"})):"el hogar"}</p>
                {m.isReversed && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">REVERSADO</span> <span className="text-xs text-[var(--dim)]">Fuera de los totales.</span></p>}
                {!!m.reversalOfId && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-[var(--surface2)]">REVERSIÓN</span> <span className="text-xs text-[var(--dim)]">Anula «{data.movements.find(x=>x.id===m.reversalOfId)?.concept||""}».</span></p>}
                </div><div className="text-right shrink-0"><p className={`font-display font-bold whitespace-nowrap ${m.type==="income"?"text-[var(--green)]":""} ${annulled?"line-through":""}`}>{m.type==="income"?"+":"−"}{money2(m.amount)}</p>{m.receiptUrl && <span className="block mt-1"><img src={m.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-10 h-10 object-cover rounded-lg border border-[var(--border)] inline-block" /><br/><button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold" onClick={()=>setReceiptView(m.receiptUrl)}>Ver comprobante</button></span>}
                {!annulled && <><button aria-label={`Editar ${m.concept}`} className="text-xs underline mr-2" onClick={()=>{setMvStep(1);setEditingMv(m.id);setMvType(m.type as typeof mvType);setMvAmount(String(m.amount));setMvConcept(m.concept);setMvAccount(m.accountId?String(m.accountId):"");setMvCat(m.categoryId?String(m.categoryId):"");setMvSub(m.subcategory||"");setMvDate(m.date);setMvVis(m.visibility as "private"|"shared");scrollFormTop("mv-form");}}>Editar</button><button aria-label={`Reversar ${m.concept}`} className="text-xs underline font-bold mr-2" onClick={()=>setConfirmReverseId(confirmReverseId===m.id?null:m.id)}>Reversar</button><button aria-label={`Eliminar ${m.concept}`} className="text-xs underline text-[var(--red)]" onClick={()=>delMv.mutate(m.id)}>Eliminar</button></>}
                </div></div>
                {confirmReverseId===m.id && !annulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Reversar «{m.concept}» por <b className="whitespace-nowrap">{money2(m.amount)}</b>? Ambos quedan fuera de los totales.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la reversión de ${m.concept}`} className={btnPrimary} disabled={revMv.isPending} onClick={()=>revMv.mutate(m.id)}>{revMv.isPending?"Reversando…":"Sí, reversar"}</button><button type="button" aria-label="Cancelar la reversión" className={btnGhost} onClick={()=>setConfirmReverseId(null)}>Cancelar</button></div></div>}
                </div>; })}
              </div>
              {filteredMovs.length===0 && <Empty title="Sin movimientos con ese filtro" body="Cambie el filtro o registre el primero." />}
            </div>
          </section>
        )}

        {effTab==="cuentas" && (<>
          <section className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 items-start">
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveAcc.mutate();}}>
              <h2 className="font-display font-bold text-lg">{editingAcc?"Editar cuenta":"Nueva cuenta"}</h2>
              <Help>Se captura una sola vez.</Help>
              <div><Label htmlFor="acc-name">Nombre</Label><input id="acc-name" aria-label="Nombre de la cuenta" required className={inputCls} value={accFormName} onChange={e=>setAccFormName(e.target.value)} placeholder="Ej. Nómina Banorte" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="acc-type">Tipo</Label><select id="acc-type" aria-label="Tipo de cuenta" className={inputCls} value={accType} onChange={e=>setAccType(e.target.value as typeof accType)}><option value="bank">Bancaria</option><option value="cash">Efectivo</option><option value="credit">Tarjeta de crédito</option><option value="investment">Inversión</option><option value="loan">Préstamo</option></select></div>
                <div><Label htmlFor="acc-vis">Visibilidad</Label><select id="acc-vis" aria-label="Visibilidad de la cuenta" className={inputCls} value={accVis} onChange={e=>setAccVis(e.target.value as "private"|"shared")}><option value="shared">Compartida</option><option value="private">Privada</option></select></div>
              </div>
              <div><Label htmlFor="acc-init">Saldo inicial ($)</Label><input id="acc-init" aria-label="Saldo inicial" type="number" step="0.01" className={inputCls} value={accInit} onChange={e=>setAccInit(e.target.value)} /></div>
              <button className={btnPrimary+" w-full"} disabled={saveAcc.isPending}>{editingAcc?"Guardar cambios":"Crear cuenta"}</button>
              {editingAcc && <button type="button" className={btnGhost+" w-full"} onClick={()=>setEditingAcc(null)}>Cancelar</button>}
            </form>
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
              {data.accounts.map(a=><div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">{a.name}</p><p className="text-xs text-[var(--dim)]">{TYPE_LABEL[a.type]||a.type} · {a.visibility==="shared"?"Compartida":"Privada"} · Inicial {money(a.initialBalance)}</p><p className="font-display text-xl font-extrabold mt-2 whitespace-nowrap">{money2(a.balance)}</p><div className="mt-2 flex gap-2"><button aria-label={`Editar cuenta ${a.name}`} className="text-xs underline" onClick={()=>{setEditingAcc(a.id);setAccFormName(a.name);setAccType(a.type as typeof accType);setAccVis(a.visibility as "private"|"shared");setAccInit(String(a.initialBalance));}}>Editar</button><button aria-label={`Eliminar cuenta ${a.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>delAcc.mutate(a.id)}>Eliminar</button></div></div>)}
              {data.accounts.length===0 && <Empty title="Sin cuentas" body="Cree su primera cuenta." action={{label:"+ Agregar cuenta",onClick:()=>focusField("acc-name")}} />}
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
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-5 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveBud.mutate();}}>
              <div><Label htmlFor="bud-cat">Categoría de gasto</Label><select id="bud-cat" aria-label="Categoría del presupuesto" required className={inputCls} value={budCat} onChange={e=>setBudCat(e.target.value)}><option value="">Seleccione…</option>{data.categories.filter(c=>c.kind==="expense").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><Label htmlFor="bud-month">Mes</Label><input id="bud-month" aria-label="Mes del presupuesto" type="month" required className={inputCls} value={budMonth} onChange={e=>setBudMonth(e.target.value)} /></div>
              <div><Label htmlFor="bud-amount">Presupuestado ($)</Label><input id="bud-amount" aria-label="Monto presupuestado" type="number" min="0" required className={inputCls} value={budAmount} onChange={e=>setBudAmount(e.target.value)} /></div>
              <div><Label htmlFor="bud-vis">Visibilidad</Label><select id="bud-vis" aria-label="Visibilidad del presupuesto" className={inputCls} value={budVis} onChange={e=>setBudVis(e.target.value as "private"|"shared")}><option value="shared">Compartido</option><option value="private">Privado</option></select></div>
              <button className={btnPrimary} disabled={saveBud.isPending}>Crear presupuesto</button>
            </form>
            <Help>Los gastos de la categoría en el mes se descuentan solos del presupuesto.</Help>
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.budgets.map(b=><div key={b.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><div className="flex justify-between"><b className="font-display">{getCatName(b.categoryId)}</b><span className="text-xs bg-[var(--surface2)] rounded-full px-2 py-1">{b.month} · {b.visibility==="shared"?"Compartido":"Privado"}</span></div><p className="text-sm mt-2">Presupuestado <span className="whitespace-nowrap">{money(b.amount)}</span> · Gastado <span className="whitespace-nowrap">{money(b.spent)}</span> · {b.remaining<0?<b className="text-[var(--red)] whitespace-nowrap">Sobrepasado por {money(-b.remaining)}</b>:<b className="whitespace-nowrap">Restan {money(b.remaining)}</b>}</p><div className="h-2 bg-[var(--surface2)] rounded-full mt-2 overflow-hidden"><div className={`h-full ${b.pct>=100?"bg-[var(--red)]":b.pct>=80?"bg-[var(--gold)]":"bg-[var(--green)]"}`} style={{width:`${Math.min(100,b.pct)}%`}} /></div>{b.remaining<0?<p className="text-xs mt-1 font-bold text-[var(--red)]">Presupuesto excedido · {b.pct}% usado</p>:<p className="text-xs text-[var(--dim)] mt-1">{b.pct}% usado</p>}<button aria-label={`Eliminar presupuesto de ${getCatName(b.categoryId)}`} className="text-xs underline text-[var(--red)] mt-1" onClick={()=>delBud.mutate(b.id)}>Eliminar</button></div>)}
              {data.budgets.length===0 && <Empty title="Sin presupuestos" body="Uno por categoría y mes." action={{label:"+ Agregar presupuesto",onClick:()=>focusField("bud-amount")}} />}
            </div>
          </section>
        )}

        {effTab==="fondos" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex flex-wrap gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveFund.mutate();}}>
              <div className="flex-1 min-w-[180px]"><Label htmlFor="fund-name">Nombre del fondo</Label><input id="fund-name" aria-label="Nombre del fondo" required className={inputCls} value={fundName} onChange={e=>setFundName(e.target.value)} placeholder="Ej. Fondo de emergencia" /></div>
              <div><Label htmlFor="fund-target">Meta ($, opcional)</Label><input id="fund-target" aria-label="Meta del fondo" type="number" min="0" className={inputCls} value={fundTarget} onChange={e=>setFundTarget(e.target.value)} /></div>
              <button className={btnPrimary}>Crear fondo</button>
            </form>
            <div className="mt-3"><Help>El dinero sigue en su cuenta; no cuenta como disponible.</Help></div>
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.funds.map(f=><div key={f.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">{f.name}</p><p className="font-display text-xl font-extrabold mt-1 whitespace-nowrap">{money2(f.balance)}</p>{f.targetAmount && <p className="text-xs text-[var(--dim)]">Meta {money(f.targetAmount)} · {Math.min(100,Math.round(f.balance/f.targetAmount*100))}%</p>}<div className="flex gap-2 mt-3"><input aria-label={`Monto para ${f.name}`} type="number" min="0" placeholder="$ Monto" className={inputCls} value={fundAmt[f.id]||""} onChange={e=>setFundAmt({...fundAmt,[f.id]:e.target.value})} /><button aria-label={`Aportar a ${f.name}`} className={btnPrimary} onClick={()=>fundMove.mutate({fundId:f.id,type:"contribution",amount:Number(fundAmt[f.id])||0})}>Aportar</button><button aria-label={`Retirar de ${f.name}`} className={btnGhost} onClick={()=>fundMove.mutate({fundId:f.id,type:"withdrawal",amount:Number(fundAmt[f.id])||0})}>Retirar</button></div><button aria-label={`Eliminar fondo ${f.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>delFund.mutate(f.id)}>Eliminar fondo</button></div>)}
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
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-5 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveGoal.mutate();}}>
              <div><Label htmlFor="goal-name">Nombre de la meta</Label><input id="goal-name" aria-label="Nombre de la meta" required className={inputCls} value={goalName} onChange={e=>setGoalName(e.target.value)} placeholder="Ej. Vacaciones" /></div>
              <div><Label htmlFor="goal-target">Monto objetivo ($)</Label><input id="goal-target" aria-label="Monto objetivo de la meta" type="number" min="1" required className={inputCls} value={goalTarget} onChange={e=>setGoalTarget(e.target.value)} /></div>
              <div><Label htmlFor="goal-saved">Ya ahorrado ($)</Label><input id="goal-saved" aria-label="Ya ahorrado en la meta" type="number" min="0" className={inputCls} value={goalSaved} onChange={e=>setGoalSaved(e.target.value)} /></div>
              <div><Label htmlFor="goal-date">Fecha objetivo</Label><input id="goal-date" aria-label="Fecha objetivo de la meta" type="date" className={inputCls} value={goalDate} onChange={e=>setGoalDate(e.target.value)} /></div>
              <button className={btnPrimary}>Crear meta</button>
            </form>
            {analyzePlan.isPending && <p className="text-sm text-[var(--dim)] mt-3">Calculando el plan…</p>}
            {planError && <p className="text-sm text-[var(--red)] mt-3">{planError}</p>}
            {planResult && planGoalId!==null && (()=>{ const g=data.goals.find(x=>x.id===planGoalId); if(!g) return null; const r=planResult; return (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-lg">Plan de ahorro · {g.name}</h2>
              <p className="text-sm mt-1">Aporte mensual: <b className="whitespace-nowrap">{money(r.monthlyAmount)}</b> durante <b>{r.months} meses</b> · día {r.dueDay} de cada mes.</p>
              <p className="text-sm text-[var(--dim)] mt-1">Ingreso mensual {money(r.income)} · Compromisos fijos {money(r.fixedCommitments)} · Gasto promedio {money(r.avgMonthlyExpense)} · Sobrante {money(r.surplus)}.</p>
              {r.feasible
                ? <p className="text-sm mt-2 text-[var(--green)] font-semibold">Sí le alcanza. Después del aporte sobran {money(r.surplus - r.monthlyAmount)} al mes.</p>
                : <><p className="text-sm mt-2 text-[var(--red)] font-semibold">No alcanza con {money(r.monthlyAmount)} al mes. Faltan {money(r.monthlyAmount - r.surplus)} al mes.</p>
                  {r.cutSuggestions.length>0 && <div className="mt-2"><p className="text-sm font-semibold">De dónde puede salir:</p>{r.cutSuggestions.map(c=><p key={c.categoryId??c.name} className="text-sm text-[var(--dim)]">· {c.name}: gasta {money(c.avgMonthly)} al mes. Recortar {money(c.suggestedCut)}.</p>)}</div>}
                  {r.extendedMonths>0 && <p className="text-sm mt-2">O alargue el plazo a {r.extendedMonths} meses, con {money(r.extendedMonthly)} al mes.</p>}</>}
              <div className="flex flex-wrap gap-2 items-end mt-3">
                <div><Label htmlFor="plan-months">Plazo (meses)</Label><input id="plan-months" aria-label="Plazo del plan en meses" type="number" min="1" max="120" className={inputCls} value={planMonths} onChange={e=>setPlanMonths(e.target.value)} /></div>
                <button type="button" className={btnGhost} onClick={()=>analyzePlan.mutate({goalId:g.id,months:Number(planMonths)||undefined})}>Recalcular</button>
                <button type="button" className={btnPrimary} onClick={()=>acceptPlan.mutate({goalId:g.id,monthlyAmount:r.monthlyAmount,months:r.months,dueDay:r.dueDay})}>Aceptar plan</button>
                {r.extendedMonths>0 && <button type="button" className={btnPrimary} onClick={()=>acceptPlan.mutate({goalId:g.id,monthlyAmount:r.extendedMonthly,months:r.extendedMonths,dueDay:r.dueDay})}>Aceptar con {r.extendedMonths} meses</button>}
                <button type="button" className={btnGhost} onClick={()=>{setPlanResult(null);setPlanGoalId(null);setPlanError("");}}>Cerrar</button>
              </div>
              <p className="text-xs text-[var(--dim)] mt-2">Al aceptar, el dinero se aparta en un fondo separado de la meta y usted recibe avisos de cada aportación.</p>
            </div>); })()}
            {adjError && <p className="text-sm text-[var(--red)] mt-3">{adjError}</p>}
            {adjAnalysis && adjGoalId!==null && (()=>{ const g=data.goals.find(x=>x.id===adjGoalId); if(!g) return null; const a=adjAnalysis; return (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-3">
              <h2 className="font-display font-bold text-lg">Ajuste de gastos · {g.name} · {fmtMonth(a.month)}</h2>
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
            </div>); })()}
            <div className="grid sm:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">
              {data.goals.map(g=>{ const plan=data.goalPlans.find(p=>p.goalId===g.id); const monthsLeft=g.targetDate?Math.max(1,Math.round((new Date(g.targetDate).getTime()-Date.now())/(1000*60*60*24*30))):null; const need=monthsLeft?Math.ceil((g.targetAmount-g.savedAmount)/monthsLeft):null; return <div key={g.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><p className="font-display font-bold text-lg">{g.name} <span className="text-xs font-normal text-[var(--dim)]">{g.visibility==="shared"?"Compartida":"Privada"}</span></p><p className="font-display text-xl font-extrabold mt-1"><span className="whitespace-nowrap">{money(g.savedAmount)}</span> <span className="text-sm font-semibold text-[var(--dim)]">de <span className="whitespace-nowrap">{money(g.targetAmount)}</span> · {g.pct}%</span></p><div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div>{g.targetDate && <p className="text-xs text-[var(--dim)] mt-1">Meta {fmtDate(g.targetDate)}{need!==null && need>0?` · faltan ${money(need)}/mes`:""}</p>}<div className="flex gap-2 mt-3"><input aria-label={`Abonar a ${g.name}`} type="number" placeholder="$ Abonar" className={inputCls} value={goalAdd[g.id]||""} onChange={e=>setGoalAdd({...goalAdd,[g.id]:e.target.value})} /><button aria-label={`Abonar a la meta ${g.name}`} className={btnPrimary} onClick={()=>addGoal.mutate({id:g.id,amount:Number(goalAdd[g.id])||0})}>Abonar</button></div>{plan ? <div className="mt-3 rounded-2xl bg-[var(--surface2)] p-3"><p className="font-display font-bold text-sm">Plan de ahorro · {money(plan.monthlyAmount)}/mes · día {plan.dueDay}</p><p className="text-xs text-[var(--dim)] mt-1">Este mes: {money(plan.contributedThisMonth)} de {money(plan.monthlyAmount)} · Esperado hasta hoy: {money(plan.expectedByNow)}</p><div className="h-2 bg-[var(--surface)] rounded-full mt-2"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${Math.min(100, plan.monthlyAmount>0? Math.round(plan.contributedThisMonth/plan.monthlyAmount*100):0)}%`}} /></div><p className="text-xs mt-1">{plan.status==="cumplido" ? "Meta cumplida." : plan.atRisk ? <span className="text-[var(--red)] font-semibold">En riesgo: con el ritmo actual se cumpliría después de la fecha.</span> : plan.onTrack ? `Al corriente. Se cumple en ${fmtMonth(plan.projectedDate)}.` : `Atrasado. Se cumple en ${fmtMonth(plan.projectedDate)}.`}</p><button type="button" aria-label={`Quitar el plan de ${g.name}`} className="text-xs underline text-[var(--dim)] mt-2" onClick={()=>cancelPlan.mutate(g.id)}>Quitar plan</button><button type="button" aria-label={`Revisar ajuste de gastos de ${g.name}`} className={btnGhost+" mt-2 ml-2"} onClick={()=>analyzeAdj.mutate(g.id)}>Revisar ajuste</button>
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
</div> : <button type="button" aria-label={`Armar plan de ahorro para ${g.name}`} className={btnGhost+" mt-3"} onClick={()=>analyzePlan.mutate({goalId:g.id})}>Armar plan de ahorro</button>}<button aria-label={`Eliminar meta ${g.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>delGoal.mutate(g.id)}>Eliminar</button></div>; })}
              {data.goals.length===0 && <Empty title="Sin metas" body="Cree su primera meta." action={{label:"+ Agregar meta",onClick:()=>focusField("goal-target")}} />}
            </div>
          </section>
        )}

        {effTab==="acuerdos" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-4 md:gap-6 items-start">
            <div className="space-y-2">
              <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveAg.mutate();}}>
                <h2 className="font-display font-bold text-lg">Nueva propuesta</h2>
                <div><Label htmlFor="ag-title">Título del acuerdo</Label><input id="ag-title" aria-label="Título del acuerdo" required className={inputCls} value={agTitle} onChange={e=>setAgTitle(e.target.value)} placeholder="Ej. Toda deuda nueva requiere aviso previo" /></div>
                <div><Label htmlFor="ag-desc">Descripción</Label><textarea id="ag-desc" aria-label="Descripción del acuerdo" className={inputCls} rows={3} value={agDesc} onChange={e=>setAgDesc(e.target.value)} /></div>
                <button className={btnPrimary+" w-full"}>Proponer acuerdo</button>
              </form>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                <Label htmlFor="vote-profile">Voto como</Label>
                <select id="vote-profile" aria-label="Votar como perfil" className={inputCls} value={voteProfile} onChange={e=>setVoteProfile(e.target.value)}><option value="">Seleccione su perfil…</option>{data.profiles.filter(p=>p.kind==="adult").map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <p className="text-xs text-[var(--dim)] mt-2">Regla del hogar: <b>{hh.approvalRule==="unanimous"?"Unánime":"Mayoría"}</b>.</p>
              </div>
              <div className="flex gap-2 text-center text-sm">
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="proposal").length}</b>Propuestas</div>
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="approved").length}</b>Aprobados</div>
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl py-2"><b className="font-display block text-lg">{data.agreements.filter(a=>a.status==="rejected").length}</b>Rechazados</div>
              </div>
            </div>
            <div className="space-y-2">
              {data.agreements.map(a=><div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"><div className="flex justify-between gap-2"><b className="font-display">{a.title}</b><span className={`text-xs rounded-full px-2.5 py-1 font-bold shrink-0 ${a.status==="approved"?"bg-green-100 text-green-800":a.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{a.status==="approved"?"Aprobado":a.status==="rejected"?"Rechazado":"Propuesta"}</span></div>{a.description && <p className="text-sm text-[var(--dim)] mt-1">{a.description}</p>}<p className="text-xs text-[var(--dim)] mt-2">Votos: {a.votes.length===0?"sin votos":a.votes.map(v=>`${data.profiles.find(p=>p.id===v.profileId)?.name||"Perfil"}: ${v.vote==="approve"?"Sí":"No"}`).join(" · ")}</p><div className="flex gap-2 mt-3"><button aria-label={`Aprobar acuerdo ${a.title}`} className={btnPrimary} disabled={!voteProfile} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"approve"})}>Votar Sí</button><button aria-label={`Rechazar acuerdo ${a.title}`} className={btnGhost} disabled={!voteProfile} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"reject"})}>Votar No</button><button aria-label={`Eliminar acuerdo ${a.title}`} className="text-xs underline text-[var(--red)] ml-auto" onClick={()=>delAg.mutate(a.id)}>Eliminar</button></div>{!voteProfile && <p className="text-xs text-[var(--dim)] mt-1">Seleccione su perfil para votar.</p>}</div>)}
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
                <div key={p.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex justify-between gap-2">
                  <div className="flex-1"><p className="font-display font-bold text-lg">{fullName(p)} <span className="text-xs font-normal bg-[var(--surface2)] rounded-full px-2 py-0.5">{p.kind==="adult"?"Adulto":`Dependiente · ${p.dependentType||""}`}</span> <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${p.role==="admin"?"bg-[var(--gold)] text-[#13262E]":"bg-[var(--surface2)]"}`}>{p.role==="admin"?"Administrador del hogar":"Integrante"}</span></p>
                  {p.kind==="adult" ? <p className="text-sm text-[var(--dim)]">Ingreso {money(p.monthlyIncome)} · Compromisos {money(p.fixedCommitments)} · <b className="text-[var(--text)] whitespace-nowrap">Capacidad {money(p.capacity)}</b>{p.email?` · ${p.email}`:""}</p> : <p className="text-sm text-[var(--dim)]">No aporta ni vota.</p>}</div>
                  <div className="shrink-0 text-right space-y-1">
                    <button aria-label={`Editar nombre de ${fullName(p)}`} className="text-xs underline block" onClick={()=>{setEditProfId(p.id);setEditProfName(p.name);setEditProfLast(p.lastName||"");}}>Editar nombre</button>
                    {isAdmin && <button aria-label={`Eliminar perfil de ${fullName(p)}`} className="text-xs underline text-[var(--red)] block" onClick={()=>delProf.mutate(p.id)}>Eliminar</button>}
                    {editProfId===p.id && <span className="flex gap-1 mt-1"><input aria-label="Editar nombre" className={inputCls+" w-28"} value={editProfName} onChange={e=>setEditProfName(e.target.value)} /><input aria-label="Editar apellido" className={inputCls+" w-28"} value={editProfLast} onChange={e=>setEditProfLast(e.target.value)} /><button aria-label="Guardar nombre editado" className={btnPrimary} onClick={()=>saveProfEdit.mutate()}>Guardar</button></span>}
                  </div>
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
                <p className="text-sm text-[var(--dim)] mt-1">{data.invitations.length} {data.invitations.length===1?"invitación":"invitaciones"} · {invitationCounts(data.invitations).pending} pendientes</p>
                </>}
              >
                <div className="divide-y divide-[var(--border)] mt-2">
                  {data.invitations.map(iv=>(
                    <div key={iv.id} className="py-2.5 text-sm">
                      <div className="flex justify-between gap-2 flex-wrap"><span><b>{iv.email}</b>{iv.invitedName?` · ${iv.invitedName}`:""}</span><span className={`text-xs font-bold rounded-full px-2 py-0.5 ${iv.status==="accepted"?"bg-green-100 text-green-800":iv.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{iv.status==="accepted"?"Aceptada":iv.status==="rejected"?"Rechazada":"Pendiente"}</span></div>
                      {iv.status==="pending" && <div className="mt-2 space-y-2"><div className="grid grid-cols-2 gap-2"><input aria-label={`Nombre de quien acepta ${iv.email}`} placeholder="Su nombre" className={inputCls} value={acceptFirst[iv.id]||iv.invitedName||""} onChange={e=>setAcceptFirst({...acceptFirst,[iv.id]:e.target.value})} /><input aria-label={`Apellido de quien acepta ${iv.email}`} placeholder="Su apellido" className={inputCls} value={acceptLast[iv.id]||""} onChange={e=>setAcceptLast({...acceptLast,[iv.id]:e.target.value})} /></div><div className="flex gap-2 flex-wrap"><button aria-label={`Aceptar invitación de ${iv.email}`} className={btnPrimary} onClick={()=>respondInv2.mutate({id:iv.id,accept:true})}>Aceptar y entrar</button><button aria-label={`Rechazar invitación de ${iv.email}`} className={btnGhost} onClick={()=>respondInv2.mutate({id:iv.id,accept:false})}>Rechazar</button>{isAdmin && <><button aria-label={`Reenviar invitación a ${iv.email}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"household",invitationId:iv.id})} disabled={resendInv.isPending}>{resendInv.isPending?"Reenviando…":"Reenviar invitación"}</button><button aria-label={`Borrar invitación de ${iv.email}`} className="text-xs underline text-[var(--red)]" onClick={()=>delInv.mutate(iv.id)}>Borrar</button></>}</div></div>}
                    </div>
                  ))}
                </div>
              </CollapsibleCard>
              )}
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
                  <div><Label htmlFor="pers-cat">Tipo de gasto</Label><select id="pers-cat" aria-label="Tipo de gasto del día" className={inputCls} value={persCat} onChange={e=>{setPersCat(e.target.value);setAppliedRulePers(null);}}><option value="">Sin categoría</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  {ocrLabelPers && persCat==="" && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
                    <p className="text-sm">La categoría sugerida «{ocrLabelPers}» no está en su hogar. Puede crearla ya ajustada a este ticket.</p>
                    <div className="flex gap-2 mt-2"><input aria-label="Nombre de la categoría nueva" className={inputCls} value={ocrNewCatName} onChange={e=>setOcrNewCatName(e.target.value)} /><button type="button" aria-label="Crear la categoría sugerida y usarla" className={btnPrimary} disabled={!ocrNewCatName.trim() || createOcrCat.isPending} onClick={()=>createOcrCat.mutate({target:"pers",name:ocrNewCatName.trim()})}>{createOcrCat.isPending?"Creando…":"Crear y usar"}</button></div>
                    <button type="button" className="text-xs underline mt-2" onClick={()=>setOcrLabelPers("")}>Omitir, elegiré otra</button>
                    {createOcrCat.error && <p className="text-xs text-[var(--red)] mt-1">{String(createOcrCat.error)}</p>}
                  </div>}
                  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>{setPersStep(1); scrollFormTop("pers-exp-form");}}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} onClick={()=>{setPersStep(3); scrollFormTop("pers-exp-form");}}>Siguiente</button></div>
                  </>}
                  {persStep===3 && <>
                  <div><Label htmlFor="pers-concept">Concepto del gasto</Label><div className="flex gap-2"><input id="pers-concept" aria-label="Concepto del gasto del día" className={inputCls+" flex-1"} value={persConcept} onChange={e=>{setPersConcept(e.target.value);applyRuleTo(e.target.value,"pers");}} placeholder="Ej. Alimentos, transporte, café…" /><button type="button" aria-label={voiceBusyPers?"Escuchando…":"Dictar el gasto por voz"} title="Dictar por voz" className="shrink-0 w-11 rounded-xl border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center" disabled={voiceBusyPers} onClick={()=>startVoice("pers")}>{micIcon}</button></div>
                  {voiceBusyPers && <p className="text-xs text-[var(--dim)] mt-1">Escuchando… Diga, por ejemplo, «gasté 320 en el súper».</p>}
                  {voiceErrorPers && <p className="text-xs text-[var(--red)] mt-1">{voiceErrorPers}</p>}
                  {voiceNoticePers && <p className="text-xs text-[var(--green)] mt-1">{voiceNoticePers}</p>}
                  {appliedRulePers && <p className="text-xs text-[var(--dim)] mt-1">Regla aplicada: «{appliedRulePers.keyword}» → {appliedRulePers.categoryName}. Puede cambiarla en el paso 2.</p>}</div>
                  <div><Label htmlFor="pers-account">¿De dónde se descuenta?</Label><select id="pers-account" aria-label="Cuenta del gasto del día" className={inputCls} value={persAccount} onChange={e=>{setPersAccount(e.target.value); setPersAccountError("");}}><option value="">Seleccione la cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</select></div>
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
                  <h2 className="font-display font-bold text-lg">Gasto por categoría · {fmtMonth(s.currentMonth)}</h2>
                                    <CategoryChart data={data.personal.byCategory} detailOpen={catDetail!==null} palette={DONUT_PALETTE_INICIO} large reserveLine minIconPct={10} onSelect={(d)=>setCatDetail({categoryId:d.categoryId,name:d.name,total:d.total,month:s.currentMonth})} />
                  <p className="text-sm mt-3 border-t border-[var(--border)] pt-2">Gastado en el mes: <b className="whitespace-nowrap">{money2(data.personal.monthSpent)}</b> · Restante: <b className="whitespace-nowrap">{money2(data.personal.remaining)}</b></p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
                  <h2 className="font-display font-bold text-lg">Ingresos vs gastos · últimos 6 meses</h2>
                  <MonthlyChart series={s.monthlySeries} currentMonth={s.currentMonth} todayMonth={todayISO().slice(0,7)} inicio onSelect={(kind,month,label)=>setIncExpDetail({kind,month,label})} />
                </div>
                <HomeTandasCard tandas={data.tandas} onOpenDetail={openTandaDetail} onGoTandas={()=>goTab("tandas")} />
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
                    <div key={m.id} className="flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm"><span className="min-w-0">{m.concept}<span className="block text-xs text-[var(--dim)]">{getCatName(m.categoryId)}{full?` · ${getAccName(full.accountId)}`:""}</span>{full?.receiptUrl && <button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>setReceiptView(full.receiptUrl)}>Ver comprobante</button>}<button aria-label={`Reversar el gasto ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>{setConfirmReverseId(m.id);setMvFilters(DEFAULT_MOVEMENTS_FILTER);goTab("movimientos");}}>Reversar</button></span><span className="flex items-center gap-2">{full?.receiptUrl && <img src={full.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-8 h-8 object-cover rounded-lg border border-[var(--border)]" />}<b className="whitespace-nowrap shrink-0">−{money2(m.amount)}</b></span></div>
                  ); })}
                </CollapsibleCard>
                )}
              </div>
            </div>
          </section>
        )}

        {effTab==="tandas" && (
          <TandasModule
            tandas={data.tandas}
            detailId={tandaDetailId}
            onDetailChange={setTandaDetailId}
            formValues={{name:tandaName,count:tandaCount,amount:tandaAmount,start:tandaStart,freq:tandaFreq,drawMode:tandaDrawMode,coverage:tandaCoverage,fine:tandaFine,meeting:tandaMeeting,treasurer:tandaTreasurer,substitute:tandaSubstitute}}
            onFormChange={(patch)=>{ if(patch.name!==undefined)setTandaName(patch.name); if(patch.count!==undefined)setTandaCount(patch.count); if(patch.amount!==undefined)setTandaAmount(patch.amount); if(patch.start!==undefined)setTandaStart(patch.start); if(patch.freq!==undefined)setTandaFreq(patch.freq); if(patch.drawMode!==undefined)setTandaDrawMode(patch.drawMode); if(patch.coverage!==undefined)setTandaCoverage(patch.coverage); if(patch.fine!==undefined)setTandaFine(patch.fine); if(patch.meeting!==undefined)setTandaMeeting(patch.meeting); if(patch.treasurer!==undefined)setTandaTreasurer(patch.treasurer); if(patch.substitute!==undefined)setTandaSubstitute(patch.substitute); }}
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
                <h2 className="font-display font-bold text-lg">Datos de demostración</h2>
                <p className="text-sm text-[var(--dim)] mt-0.5">Cargue datos de ejemplo para probar la app. Solo funciona sin movimientos.</p>
                {demo.error && <p className="text-xs text-[var(--red)] mt-1">{String(demo.error)}</p>}
                {demo.isSuccess && <p className="text-xs text-[var(--green)] mt-1">Demo cargada: datos con “(demo)”.</p>}
              </div>
              <button type="button" className={btnPrimary+" shrink-0"} aria-label="Cargar datos de demostración" onClick={()=>demo.mutate()} disabled={demo.isPending || data.movements.length>0} title={data.movements.length>0?"La demo solo se carga sin movimientos":"Carga datos de ejemplo"}>{demo.isPending?"Cargando…":"Cargar demo"}</button>
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
                      {g.tabs.map(tid=>{ const t=TABS.find(x=>x.id===tid)!; const desc: Partial<Record<Tab,string>> = { inicio:"Disponible, gráficas y movimientos.", personal:"Su sueldo y sus gastos del día.", movimientos:"Registro con filtros y comprobantes.", cuentas:"Cuentas con saldo automático y arqueo de cuentas.", presupuestos:"Límites mensuales por categoría.", fondos:"Apartados en sus cuentas.", aportaciones:"Reparto del gasto compartido.", metas:"Ahorro con fecha.", acuerdos:"Votos de gastos mayores.", patrimonio:"Activos, pasivos y neto.", tandas:"Reunión, pase de lista y saldos.", categorias:"Categorías y subcategorías.", perfiles:"Personas del hogar.", hogar:"Nombre, modo y reglas.", guia:"Instalación y guías." }; return <div key={tid} className="py-2.5 flex items-start justify-between gap-2"><div><p className="font-semibold text-sm">{t.label}</p><p className="text-[13px] text-[var(--dim)]">{desc[tid]||""}</p></div><button type="button" aria-label={`Abrir el módulo ${t.label} desde la guía`} className={btnGhost+" shrink-0"} onClick={()=>goTab(tid)}>Abrir</button></div>; })}
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
              <Help>Moneda: <b>MXN</b>.</Help>
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
                : <div className="divide-y divide-[var(--border)] mt-2">
                  {fbQuery.data.feedback.map(f=>(
                    <div key={f.id} className="py-2.5 text-sm">
                      <div className="flex justify-between gap-2"><b>{f.nombre || "Tester"}</b><span className="text-xs text-[var(--dim)] shrink-0">{fmtDate(f.createdAt.slice(0,10))}</span></div>
                      <p className="mt-0.5"><Stars value={f.calificacionGeneral} /> <span className="text-xs text-[var(--dim)]">General · Facilidad {f.facilidadUso}/5</span></p>
                      <p className="text-xs text-[var(--dim)]">{f.modulo || "Sin módulo"} · {f.dispositivo || "Sin dispositivo"}{f.correo?` · ${f.correo}`:""}</p>
                      {f.queFunciono && <p className="mt-1"><b>Funcionó:</b> {f.queFunciono}</p>}
                      {f.queFallo && <p><b>Falló:</b> {f.queFallo}</p>}
                      {f.sugerencia && <p><b>Sugerencia:</b> {f.sugerencia}</p>}
                    </div>
                  ))}
                </div>}
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
          </section>
        )}
      </main>
      <InstallStepsDialog open={installStepsOpen} onClose={()=>setInstallStepsOpen(false)} />
      <HelpAssistant onGo={goTab} open={helpOpen} onOpenChange={setHelpOpen} hidden={menuOpen} dynamicFaqs={dynamicFaqs} greeting={greeting} onDismissGreeting={dismissGreeting} overview={data} nudge={activeNudge} onDismissNudge={dismissNudge} />
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
              <p className="text-sm text-[var(--dim)] mt-1">{catDetailBase.length} gasto(s)</p>
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
          <div className="flex gap-2 mt-4">
            <button type="button" className={btnGhost+" flex-1"} onClick={()=>{setShowSummary(false);}}>Cerrar</button>
          </div>
        </div>
      </div>}
      {showMoneyLocation && <MoneyLocationModal
        monthLabel={fmtMonth(s.currentMonth)}
        availableFree={s.availableFree}
        totalBalance={s.totalBalance}
        fundsReserved={s.fundsReserved}
        groups={buildBalanceBreakdown({accounts: data.accounts, unassignedNet: s.unassignedNet, totalBalance: s.totalBalance, fundsReserved: s.fundsReserved, availableFree: s.availableFree}).groups}
        unassignedNet={s.unassignedNet}
        openingBalance={s.openingBalance}
        priorMonthsNet={s.priorMonthsNet}
        monthNet={s.monthNet}
        fundsFromAccounts={s.fundsFromAccounts}
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
    </div>
  );
}
