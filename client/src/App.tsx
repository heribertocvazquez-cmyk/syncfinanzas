import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./components/SafeArea";
import { readInviteToken, type InvitePreview } from "./components/AuthGate";
import { fileToBase64 } from "./lib/file";
import { supabase } from "./supabase";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";
import { PdfViewer } from "./components/PdfViewer";
import guiaVideo from "./assets/media-generation-video-explicativo-syncfinanzas-0-db93744d-d5cd-455b-a5df-f1f32c5644bc.mp4";
import guiaResumenPdf from "./assets/guia-resumen-registro.pdf";
import guiaPlanificacionPdf from "./assets/guia-planificacion.pdf";
import guiaDecisionesPdf from "./assets/guia-decisiones-patrimonio.pdf";
import guiaTandasPdf from "./assets/guia-tandas.pdf";
import guiaConfiguracionPdf from "./assets/guia-configuracion-ayuda.pdf";
import appIcon512 from "./assets/app-icon-512.png";

type Tab = "inicio"|"personal"|"tandas"|"movimientos"|"cuentas"|"categorias"|"presupuestos"|"fondos"|"aportaciones"|"metas"|"acuerdos"|"patrimonio"|"perfiles"|"hogar"|"guia";
const TABS: {id:Tab;label:string}[] = [
  {id:"inicio",label:"Inicio"},{id:"personal",label:"Personal"},{id:"movimientos",label:"Movimientos"},{id:"cuentas",label:"Cuentas"},{id:"presupuestos",label:"Presupuestos"},
  {id:"fondos",label:"Fondos"},{id:"aportaciones",label:"Aportaciones"},{id:"metas",label:"Metas"},{id:"acuerdos",label:"Acuerdos"},{id:"tandas",label:"Tandas"},
  {id:"patrimonio",label:"Patrimonio"},{id:"categorias",label:"Categorías"},{id:"perfiles",label:"Perfiles"},{id:"hogar",label:"Hogar"},{id:"guia",label:"Guía de uso"},
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
const MODULE_HINT: Partial<Record<Tab,string>> = {
  aportaciones:"Desde Movimientos",
  fondos:"Apartados en Cuentas",
  presupuestos:"Gasto por categoría",
  personal:"Sueldo y gastos del día",
  guia:"Instalación, guías y video",
};
// Guía en PDF de cada segmento: se abre dentro de la aplicación, en la pestaña Guía de uso.
const GUIDE_PDF_BY_GROUP: Record<string,string> = {
  "Resumen y registro diario": guiaResumenPdf,
  "Planificación": guiaPlanificacionPdf,
  "Decisiones y patrimonio": guiaDecisionesPdf,
  "Tandas": guiaTandasPdf,
  "Configuración y ayuda": guiaConfiguracionPdf,
};
const money = (n:number) => n.toLocaleString("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0});
const money2 = (n:number) => n.toLocaleString("es-MX",{style:"currency",currency:"MXN"});
function fmtDate(iso:string){ const [y=2026,m=1,d=1]=iso.split("-").map(Number); return new Date(y,(m||1)-1,d||1).toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"}); }
function todayISO(){ const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; }
function monthNow(){ return todayISO().slice(0,7); }
const TYPE_LABEL: Record<string,string> = { income:"Ingreso", expense:"Gasto", transfer:"Transferencia", debt_payment:"Pago de deuda", bank:"Bancaria", cash:"Efectivo", credit:"Tarjeta de crédito", investment:"Inversión", loan:"Préstamo" };
// Iconos de línea (SVG, sin emojis) por categoría, con fondo transparente:
// solo se ven en las gráficas y sus leyendas, con el trazo sobre el fondo de la app.
const CATEGORY_ICONS: Record<string, ReactNode> = {
  "Salario": <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></>,
  "Negocio": <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/></>,
  "Inversión": <><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></>,
  "Renta": <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2"/></>,
  "Pensión": <><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></>,
  "Apoyo familiar": <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  "Otro ingreso": <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
  "Alimentación": <><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>,
  "Vivienda": <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></>,
  "Transporte": <><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11"/><rect x="3" y="11" width="18" height="5" rx="1"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/></>,
  "Salud": <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></>,
  "Educación": <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  "Servicios": <><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></>,
  "Entretenimiento": <><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5V8.5z"/></>,
  "Ropa": <><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></>,
  "Mascotas": <><circle cx="6.5" cy="8" r="1.6"/><circle cx="10.5" cy="5.5" r="1.6"/><circle cx="14.5" cy="5.5" r="1.6"/><circle cx="18" cy="8" r="1.6"/><path d="M12 11c-3 0-5.5 2.2-5.5 4.8 0 1.6 1.2 2.7 2.8 2.7 1 0 1.8-.5 2.7-.5s1.7.5 2.7.5c1.6 0 2.8-1.1 2.8-2.7 0-2.6-2.5-4.8-5.5-4.8z"/></>,
  "Deudas": <><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></>,
  "Impuestos": <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></>,
  "Viajes": <><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></>,
  "Cuidado personal": <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></>,
  "Otro gasto": <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2"/></>,
  "__otro__": <><path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21V3z"/><path d="M9 8h6M9 12h6"/></>,
};
function CatIcon({name, size="md", className=""}:{name:string; size?:"sm"|"md"; className?:string}){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${size==="sm"?"w-3.5 h-3.5":"w-4 h-4"} ${className||"text-[var(--gold)]"}`} aria-hidden="true">{CATEGORY_ICONS[name] ?? CATEGORY_ICONS["__otro__"]}</svg>;
}
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
function CategoryChart({data}:{data:{name:string;total:number;pct:number}[]}){
  if(data.length===0) return <p className="text-sm text-[var(--dim)] mt-2">Sin gastos este mes.</p>;
  const total=data.reduce((a,d)=>a+d.total,0);
  return <div className="mt-2" role="img" aria-label="Gráfica de gasto por categoría">
    <div className="relative mx-auto w-44 h-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="none">
            {data.map((d,i)=><Cell key={d.name} fill={DONUT_COLORS[i%DONUT_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v)=>[`$${Number(v).toLocaleString("es-MX",{minimumFractionDigits:2})}`,"Gastado"]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xs text-[var(--dim)]">Total</span>
        <b className="font-display text-lg leading-tight">{money2(total)}</b>
      </div>
    </div>
    <div className="mt-2 space-y-2">
      {data.map((d,i)=>(
        <div key={d.name}>
          <div className="flex justify-between gap-2 text-sm"><span className="inline-flex items-center gap-2 min-w-0" style={{color:DONUT_COLORS[i%DONUT_COLORS.length]}}><CatIcon name={d.name} size="sm" className="text-inherit" /><span className="text-[var(--text)] truncate">{d.name}</span></span><b className="shrink-0">{money(d.total)} · {d.pct}%</b></div>
          <div className="h-1.5 bg-[var(--surface2)] rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full" style={{width:`${Math.min(100,Math.max(0,d.pct))}%`, background:DONUT_COLORS[i%DONUT_COLORS.length]}} /></div>
        </div>
      ))}
    </div>
  </div>;
}
function MonthlyChart({series}:{series:{label:string;income:number;expense:number}[]}){
  const data=series.map(x=>({label:x.label, Ingresos:x.income, Gastos:x.expense}));
  const allZero=data.every(d=>d.Ingresos===0&&d.Gastos===0);
  if(allZero) return <p className="text-sm text-[var(--dim)] mt-2">Sin movimientos todavía.</p>;
  return <div className="mt-2" role="img" aria-label="Gráfica de ingresos contra gastos por mes">
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{left:0,right:8,top:10,bottom:4}} barCategoryGap="30%" barGap={6}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={{fontSize:12, fill:"var(--text)"}} axisLine={{stroke:"var(--border)"}} tickLine={false} />
        <YAxis tickFormatter={(v:number)=>`$${v.toLocaleString("es-MX")}`} tick={{fontSize:11, fill:"var(--dim)"}} width={56} axisLine={false} tickLine={false} />
        <Tooltip cursor={{fill:"rgba(255,255,255,0.04)"}} formatter={(v,name)=>[`$${Number(v).toLocaleString("es-MX",{minimumFractionDigits:2})}`,name]} />
        <Legend content={()=>(<div className="flex justify-center gap-4 text-xs mt-1"><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#1B7A4D]" />Ingresos</span><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#B42318]" />Gastos</span></div>)} />
        <Bar dataKey="Ingresos" fill="#1B7A4D" radius={[6,6,0,0]} maxBarSize={26} />
        <Bar dataKey="Gastos" fill="#B42318" radius={[6,6,0,0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
function Help({children}:{children:React.ReactNode}){ return <p className="text-[13px] leading-snug text-[var(--dim)] bg-[var(--surface2)] rounded-xl px-3 py-2">{children}</p>; }
function Empty({title,body,action}:{title:string;body:string;action?:{label:string;onClick:()=>void}}){ return <div className="border border-dashed border-[var(--border)] rounded-2xl p-3.5 text-center"><p className="font-display font-bold">{title}</p><p className="text-sm text-[var(--dim)] mt-1">{body}</p>{action && <button type="button" aria-label={action.label} className={btnPrimary+" mt-3"} onClick={action.onClick}>{action.label}</button>}</div>; }
function focusField(id:string){ const el=document.getElementById(id); el?.scrollIntoView({behavior:"smooth",block:"center"}); (el as HTMLElement|null)?.focus(); }
function Stars({value,size}:{value:number;size?:string}){ const full=Math.round(value); return <span className={`text-[var(--gold)] ${size||"text-base"}`} role="img" aria-label={`${value} de 5 estrellas`}>{"★★★★★".slice(0,full)}{"☆☆☆☆☆".slice(0,5-full)}</span>; }
function Label({htmlFor,children}:{htmlFor:string;children:React.ReactNode}){ return <label htmlFor={htmlFor} className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">{children}</label>; }
const inputCls="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
const btnPrimary="rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost="rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold";

// ---- Instalación en el celular (aplicación instalable, pensada primero para el teléfono) ----
// El manifiesto (generado al cargar en main.tsx, con las rutas reales de los iconos) y las
// metaetiquetas de index.html declaran la aplicación como instalable: icono propio, pantalla
// completa y sin barra del navegador.
// En Android/Chrome el navegador ofrece el evento beforeinstallprompt y el botón lo dispara;
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
    "Abra el menú ⋮ de Chrome.",
    "Seleccione «Instalar aplicación».",
    "Confirme con «Instalar».",
  ],
  ios: [
    "Abra esta página en Safari.",
    "Toque Compartir, el cuadrado con la flecha hacia arriba.",
    "Seleccione «Agregar a pantalla de inicio».",
    "Confirme con «Agregar».",
  ],
  desktop: [
    "Toque el icono de instalación en la barra de direcciones.",
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
          <h2 className="font-display font-bold text-base">{title}</h2>
          <button type="button" aria-label="Cerrar las instrucciones de instalación" onClick={onClose} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
        </div>
        <ol className="list-decimal ml-5 text-sm space-y-1.5 mt-3">
          {INSTALL_STEPS[platform].map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <button type="button" className={btnPrimary + " mt-3 w-full"} onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}

// ---- Ayudante de uso (respuestas preparadas, sin servicios externos) ----
// Botón flotante con signo de interrogación, visible en toda la app. Al tocarlo
// abre una ventanita de chat que responde dudas de uso con una base de
// respuestas preparadas por palabras clave (sin claves ni servicios de pago).
// Cada respuesta es corta, en tono formal de usted, y trae un botón que lleva
// directo al lugar cuando la vista ya tiene navegación (onGo).
type HelpMsg = { from: "user" | "bot"; text: string; go?: Tab; goLabel?: string };
type HelpFaq = { keys: string[]; q: string; a: string; go?: Tab; goLabel?: string };
const HELP_FAQS: HelpFaq[] = [
  { keys: ["gast", "registr"], q: "¿Cómo registro un gasto?", a: "En Movimientos, escriba el importe, elija el tipo de gasto y pulse Registrar. En modo Personal también puede usar Gasto del día en Personal.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["ingres", "registr"], q: "¿Cómo registro un ingreso?", a: "En Movimientos, elija Ingreso, escriba el importe y pulse Registrar.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["cuenta", "agreg", "banc", "efectivo"], q: "¿Cómo agrego una cuenta?", a: "En Cuentas, pulse Nueva cuenta, escriba el nombre, el tipo y el saldo inicial.", go: "cuentas", goLabel: "Ir a Cuentas" },
  { keys: ["tanda"], q: "¿Cómo creo una tanda?", a: "En Tandas, escriba el nombre, el monto y el número de participantes, y pulse Crear tanda. Después invite por correo a los participantes.", go: "tandas", goLabel: "Ir a Tandas" },
  { keys: ["invit", "persona", "pareja", "agreg", "unir"], q: "¿Cómo invito a alguien?", a: "En Perfiles, escriba el correo de la persona y pulse Invitar. Recibirá un enlace directo para entrar a su hogar.", go: "perfiles", goLabel: "Ir a Perfiles" },
  { keys: ["espacio", "hogar", "inici", "empez", "crear"], q: "¿Cómo creo mi espacio?", a: "Para crear su espacio, elija Personal o Familiar, escriba el nombre de su hogar y sus datos, y pulse Crear hogar.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["instal", "celular", "pantalla", "descarg"], q: "¿Cómo instalo la app en mi celular?", a: "En iPhone, abra la app en Safari, toque Compartir y seleccione Agregar a pantalla de inicio. En Android, mantenga presionado el icono y toque Instalar app.", go: "guia", goLabel: "Ir a Guía de uso" },
  { keys: ["reinici", "borrar todo", "borrar los datos", "empezar de nuevo", "reset"], q: "¿Cómo reinicio todo?", a: "En Hogar, al final, pulse Reiniciar la aplicación y responda las 3 preguntas de control. Se borra el hogar completo y la app vuelve al inicio." },
  { keys: ["sueldo", "salario"], q: "¿Cómo registro mi sueldo?", a: "En Personal, escriba su sueldo mensual y pulse Guardar sueldo.", go: "personal", goLabel: "Ir a Personal" },
  { keys: ["presupuest", "limite"], q: "¿Cómo creo un presupuesto?", a: "En Presupuestos, elija la categoría, escriba el límite del mes y pulse Guardar.", go: "presupuestos", goLabel: "Ir a Presupuestos" },
  { keys: ["comprobante", "foto", "ticket", "escanear", "leer el comprobante"], q: "¿Cómo leo un comprobante?", a: "En Movimientos, en Más opciones, suba la foto del comprobante. Si la lectura automática está configurada, los gastos se crean solos; si no, registre el gasto manualmente.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["revers", "revertir", "deshacer", "corregir", "eliminar", "borrar un"], q: "¿Cómo reverso un movimiento?", a: "En Movimientos, pulse Reversar junto al movimiento. El registro queda, pero ya no cuenta en los totales.", go: "movimientos", goLabel: "Ir a Movimientos" },
  { keys: ["categor", "subcategor", "tipo de gasto"], q: "¿Cómo agrego una categoría?", a: "En Categorías puede ver, agregar y quitar categorías y subcategorías.", go: "categorias", goLabel: "Ir a Categorías" },
  { keys: ["perfil", "pareja", "familiar"], q: "¿Cómo agrego a mi pareja?", a: "En Perfiles puede ver a las personas del hogar y agregar a su pareja o familiares.", go: "perfiles", goLabel: "Ir a Perfiles" },
  { keys: ["saldo", "disponible", "cuanto me queda", "restante", "queda"], q: "¿Cuánto me queda?", a: "Su saldo disponible está en Inicio, en la tarjeta de arriba.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["grafic", "ingresos vs gastos"], q: "¿Dónde veo las gráficas?", a: "Las gráficas están en Inicio y aparecen cuando hay movimientos.", go: "inicio", goLabel: "Ir a Inicio" },
  { keys: ["modo", "cambi", "personal"], q: "¿Cómo cambio el modo?", a: "El modo se elige al crear el espacio y se cambia en Hogar.", go: "hogar", goLabel: "Ir a Hogar" },
  { keys: ["contrase", "clave", "correo"], q: "¿Cómo es mi cuenta?", a: "Su cuenta se crea con su correo y una contraseña de al menos 12 caracteres." },
  { keys: ["fondo", "apart"], q: "¿Cómo creo un fondo?", a: "En Fondos, cree un apartado con su meta y agregue dinero desde sus cuentas.", go: "fondos", goLabel: "Ir a Fondos" },
  { keys: ["meta", "ahorr"], q: "¿Cómo creo una meta?", a: "En Metas, escriba su meta, el monto y la fecha, y registre su ahorro.", go: "metas", goLabel: "Ir a Metas" },
  { keys: ["acuerdo", "vot", "aprobaci", "gasto mayor"], q: "¿Cómo se aprueba un gasto mayor?", a: "En Acuerdos se votan los gastos mayores al umbral de su hogar.", go: "acuerdos", goLabel: "Ir a Acuerdos" },
  { keys: ["patrimonio", "activo", "pasivo", "neto"], q: "¿Cómo registro mi patrimonio?", a: "En Patrimonio registre sus activos y pasivos para ver su patrimonio neto.", go: "patrimonio", goLabel: "Ir a Patrimonio" },
  { keys: ["demo", "demostraci", "ejemplo", "probar"], q: "¿Cómo pruebo con datos de ejemplo?", a: "Pulse Demo, arriba a la derecha, para cargar datos de ejemplo. Solo funciona sin movimientos." },
  { keys: ["aportaci", "reparto", "compartido"], q: "¿Dónde veo las aportaciones?", a: "Las aportaciones se calculan solas desde Movimientos y se ven en Aportaciones.", go: "aportaciones", goLabel: "Ir a Aportaciones" },
];
const HELP_SUGGESTED = ["¿Cómo registro un gasto?", "¿Cómo agrego una cuenta?", "¿Cómo creo una tanda?", "¿Cómo invito a alguien?"];
function normHelp(s: string){ return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim(); }
function findHelpAnswer(input: string): HelpFaq | null {
  const n = normHelp(input);
  if (!n) return null;
  let best: HelpFaq | null = null; let bestScore = 0;
  for (const f of HELP_FAQS) {
    let score = 0;
    for (const k of f.keys) if (n.includes(normHelp(k))) score += 1;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore > 0 ? best : null;
}
function HelpAssistant({ onGo }: { onGo?: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<HelpMsg[]>([{ from: "bot", text: "¿En qué puedo ayudarle? Pregunte cómo registrar, agregar o iniciar algo en SyncFinanzas." }]);
  const ask = (text: string) => {
    const q = text.trim(); if (!q) return;
    const found = findHelpAnswer(q);
    const reply: HelpMsg = found
      ? { from: "bot", text: found.a, go: found.go, goLabel: found.goLabel }
      : { from: "bot", text: "No encontré la respuesta a eso. Pruebe con una de las preguntas sugeridas o revise la Guía de uso.", go: onGo ? "guia" : undefined, goLabel: "Ir a Guía de uso" };
    setMsgs(m => [...m, { from: "user", text: q }, reply]);
    setInput("");
  };
  return (
    <>
      <button type="button" aria-label="Abrir el ayudante de uso" onClick={()=>setOpen(true)} className="fixed bottom-4 right-4 z-40 w-14 h-14 rounded-full bg-[var(--gold)] text-white font-display font-extrabold text-2xl shadow-lg flex items-center justify-center">?</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Ayudante de uso" onClick={()=>setOpen(false)}>
          <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-[var(--border)]">
              <div><h2 className="font-display font-bold text-base">Ayudante de uso</h2><p className="text-xs text-[var(--dim)]">Pregunte cómo usar la app.</p></div>
              <button type="button" aria-label="Cerrar el ayudante de uso" onClick={()=>setOpen(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {msgs.map((m,i)=>(
                <div key={i} className={`flex ${m.from==="user"?"justify-end":"justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from==="user"?"bg-[var(--gold)] text-white":"bg-[var(--surface2)]"}`}>
                    <p>{m.text}</p>
                    {m.from==="bot" && m.go && onGo && <button type="button" className={btnGhost+" mt-2"} onClick={()=>{ setOpen(false); onGo(m.go!); }}>{m.goLabel || "Ir"}</button>}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {HELP_SUGGESTED.map(s=><button key={s} type="button" className="rounded-full border border-[var(--border)] px-2.5 py-1.5 text-[13px] font-semibold" onClick={()=>ask(s)}>{s}</button>)}
            </div>
            <form className="flex gap-2 p-3 border-t border-[var(--border)]" onSubmit={(e:FormEvent)=>{ e.preventDefault(); ask(input); }}>
              <input aria-label="Escriba su duda sobre el uso de la aplicación" className={inputCls+" flex-1 min-w-0"} placeholder="Escriba su duda…" value={input} onChange={e=>setInput(e.target.value)} />
              <button type="submit" className={btnPrimary} disabled={!input.trim()}>Enviar</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function App(){
  const qc=useQueryClient();
  const [tab,setTab]=useState<Tab>("inicio"); const [tabChosen,setTabChosen]=useState(false); const [menuOpen,setMenuOpen]=useState(false); const [openGroup,setOpenGroup]=useState<string|null>(null); const [guidePdf,setGuidePdf]=useState<{title:string;src:string}|null>(null);
  // Instalación en el celular: se captura el evento del navegador y se detecta si ya está instalada.
  const [installPrompt,setInstallPrompt]=useState<BeforeInstallPromptEvent|null>(null); const [appInstalled,setAppInstalled]=useState<boolean>(()=>detectStandalone()); const [installDismissed,setInstallDismissed]=useState<boolean>(()=>{ try{ return localStorage.getItem("sf-install-dismissed")==="1"; }catch{ return false; } });
  const [installStepsOpen,setInstallStepsOpen]=useState(false);
  const [chartsSeen,setChartsSeen]=useState<boolean>(()=>{ try{ return localStorage.getItem("sf-guide-charts-seen")==="1"; }catch{ return false; } });
  useEffect(()=>{
    const onPrompt=(e:Event)=>{ e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled=()=>{ setAppInstalled(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt",onPrompt);
    window.addEventListener("appinstalled",onInstalled);
    return ()=>{ window.removeEventListener("beforeinstallprompt",onPrompt); window.removeEventListener("appinstalled",onInstalled); };
  },[]);
  const doInstall=async()=>{ if(!installPrompt) return; try{ await installPrompt.prompt(); const choice=await installPrompt.userChoice; if(choice.outcome==="accepted") setAppInstalled(true); }catch{ /* el navegador no ofreció la instalación; quedan los pasos manuales */ } setInstallPrompt(null); };
  const handleInstallClick=()=>{ if(installPrompt){ void doInstall(); } else { setInstallStepsOpen(true); } };
  const dismissInstall=()=>{ setInstallDismissed(true); try{ localStorage.setItem("sf-install-dismissed","1"); }catch{} };
  const [currentProfileId,setCurrentProfileId]=useState<number|null>(()=>{ try{ const v=localStorage.getItem("sf-profile"); return v?Number(v):null; }catch{ return null; } });
  const pickProfile=(id:number|null)=>{ setCurrentProfileId(id); try{ if(id) localStorage.setItem("sf-profile",String(id)); else localStorage.removeItem("sf-profile"); }catch{} };
  const q=useQuery({queryKey:["overview"],queryFn:()=>api.getOverview({})});
  const inv=()=>qc.invalidateQueries({queryKey:["overview"]});
  const data=q.data;

  // onboarding state
  const [planMode,setPlanMode]=useState<"personal"|"familiar">("familiar"); const [hhName,setHhName]=useState("Mi hogar"); const [ownerName,setOwnerName]=useState(""); const [ownerLast,setOwnerLast]=useState(""); const [invEmail,setInvEmail]=useState(""); const [invFound,setInvFound]=useState<{id:number;householdName:string;invitedName:string|null}[]>([]); const [invSearched,setInvSearched]=useState(false); const [joinFirst,setJoinFirst]=useState(""); const [joinLast,setJoinLast]=useState(""); const [ownerIncome,setOwnerIncome]=useState(""); const [cutoff,setCutoff]=useState("1"); const [contribRule,setContribRule]=useState<"equal"|"proportional">("equal"); const [approvalRule,setApprovalRule]=useState<"unanimous"|"majority">("unanimous"); const [threshold,setThreshold]=useState("1500");
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
  type InviteSend = { emailSent: boolean; emailConfigured: boolean; inviteUrl: string };
  const [tokenRaw,setTokenRaw]=useState<string|null>(null);
  const [tokenInvite,setTokenInvite]=useState<InvitePreviewFull|null>(null);
  const [tokenDone,setTokenDone]=useState(false);
  const [copiedLink,setCopiedLink]=useState("");
  const copyLink=async(url:string)=>{ try{ await navigator.clipboard.writeText(url); setCopiedLink(url); }catch{ try{ const t=document.createElement("textarea"); t.value=url; document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t); setCopiedLink(url); }catch{} } };
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
    if (tokenInvite.kind==="tanda" && tokenInvite.tandaInvitationId) return await api.respondTandaInvitation({id: tokenInvite.tandaInvitationId, accept: true, name: joinFirst||undefined});
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
  const [mvType,setMvType]=useState<"income"|"expense"|"transfer"|"debt_payment">("expense"); const [mvStep,setMvStep]=useState(1); const [mvAmount,setMvAmount]=useState(""); const [mvConcept,setMvConcept]=useState(""); const [mvAccount,setMvAccount]=useState(""); const [mvToAccount,setMvToAccount]=useState(""); const [mvCat,setMvCat]=useState(""); const [mvSub,setMvSub]=useState(""); const [mvDate,setMvDate]=useState(todayISO()); const [mvVis,setMvVis]=useState<"private"|"shared">("shared"); const [mvSearch,setMvSearch]=useState(""); const [mvFilter,setMvFilter]=useState("all"); const [editingMv,setEditingMv]=useState<number|null>(null);
  const saveMv=useMutation({mutationFn:async()=>await api.saveMovement({id:editingMv??undefined,householdId:data!.household!.id,type:mvType,amount:Number(mvAmount),concept:mvConcept,accountId:mvAccount?Number(mvAccount):null,toAccountId:mvToAccount?Number(mvToAccount):null,categoryId:mvCat?Number(mvCat):null,subcategory:mvSub||undefined,date:mvDate,visibility:mvVis,profileId:mvProfile?Number(mvProfile):(me?me.id:null),receipt:receipt?{dataBase64:receipt.dataBase64,mimeType:receipt.mimeType}:undefined}),onSuccess:()=>{inv();setMvAmount("");setMvConcept("");setEditingMv(null);setReceipt(null);setMvStep(1);setSavedNotice("Movimiento guardado.");}});
  const delMv=useMutation({mutationFn:async(id:number)=>await api.deleteMovement({id}),onSuccess:inv});
  const [confirmReverseId,setConfirmReverseId]=useState<number|null>(null);
  const revMv=useMutation({mutationFn:async(id:number)=>await api.reverseMovement({id}),onSuccess:()=>{inv();setConfirmReverseId(null);}});

  // account form
  const [accFormName,setAccFormName]=useState(""); const [accType,setAccType]=useState<"bank"|"cash"|"credit"|"investment"|"loan">("bank"); const [accVis,setAccVis]=useState<"private"|"shared">("shared"); const [accInit,setAccInit]=useState("0"); const [editingAcc,setEditingAcc]=useState<number|null>(null);
  const saveAcc=useMutation({mutationFn:async()=>await api.saveAccount({id:editingAcc??undefined,householdId:data!.household!.id,name:accFormName,type:accType,visibility:accVis,initialBalance:Number(accInit)||0}),onSuccess:()=>{inv();setAccFormName("");setEditingAcc(null);setSavedNotice("Cuenta guardada.");}});
  const delAcc=useMutation({mutationFn:async(id:number)=>await api.deleteAccount({id}),onSuccess:inv});

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
  const [goalName,setGoalName]=useState(""); const [goalTarget,setGoalTarget]=useState(""); const [goalDate,setGoalDate]=useState(""); const [goalSaved,setGoalSaved]=useState("0"); const [goalAdd,setGoalAdd]=useState<Record<number,string>>({});
  const saveGoal=useMutation({mutationFn:async()=>await api.saveGoal({householdId:data!.household!.id,name:goalName,targetAmount:Number(goalTarget)||0,savedAmount:Number(goalSaved)||0,targetDate:goalDate||undefined,visibility:"shared"}),onSuccess:()=>{inv();setGoalName("");setGoalTarget("");setSavedNotice("Meta guardada.");}});
  const addGoal=useMutation({mutationFn:async(v:{id:number;amount:number})=>await api.addGoalSaving(v),onSuccess:inv});
  const delGoal=useMutation({mutationFn:async(id:number)=>await api.deleteGoal({id}),onSuccess:inv});

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
  const resetAll=useMutation({mutationFn:async()=>await api.resetAllData({householdId:data!.household!.id}),onSuccess:()=>{ inv(); setResetDone(true); setResetStep(0); setResetWord(""); setMenuOpen(false); setTabChosen(false); setTab("inicio"); pickProfile(null); setObStep(0); setObError(""); setHhName("Mi hogar"); setOwnerName(""); setOwnerLast(""); setOwnerIncome(""); setModeModalShown(false); setModeModalOpen(false); setFirstGuideOpen(false); setChartsSeen(false); try{ localStorage.removeItem("sf-install-dismissed"); localStorage.removeItem("sf-first-guide-pending"); localStorage.removeItem("sf-guide-charts-seen"); }catch{} }});
  // personal
  const [salaryInput,setSalaryInput]=useState(""); const [persAmt,setPersAmt]=useState(""); const [persConcept,setPersConcept]=useState(""); const [persCat,setPersCat]=useState(""); const [persStep,setPersStep]=useState(1);
  const saveSalary=useMutation({mutationFn:async()=>await api.updatePersonalSalary({householdId:data!.household!.id,salary:Number(salaryInput)||0}),onSuccess:inv});
  const savePersExp=useMutation({mutationFn:async()=>await api.saveMovement({householdId:data!.household!.id,type:"expense",amount:Number(persAmt),concept:persConcept||"Gasto del día",categoryId:persCat?Number(persCat):null,date:todayISO(),visibility:"private",profileId:me?me.id:null,receipt:persReceipt?{dataBase64:persReceipt.dataBase64,mimeType:persReceipt.mimeType}:undefined}),onSuccess:()=>{inv();setPersAmt("");setPersConcept("");setPersReceipt(null);setPersCat("");setPersStep(1);setSavedNotice("Gasto del día guardado.");}});
  // Acceso directo para registrar un gasto rápido (?accion=nuevo-gasto):
  // al entrar con ese parámetro, después de iniciar sesión y con el espacio
  // creado, se abre el formulario de gasto con el importe listo para escribir.
  // En modo Personal es el gasto del día; en modo Familiar, Movimientos.
  const [quickExpense,setQuickExpense]=useState<boolean>(()=>{ try{ return new URLSearchParams(window.location.search).get("accion")==="nuevo-gasto"; }catch{ return false; } });
  useEffect(()=>{
    if(!quickExpense || !data?.household) return;
    setQuickExpense(false);
    try{ const u=new URL(window.location.href); u.searchParams.delete("accion"); window.history.replaceState(null,"",u.pathname+u.search+u.hash); }catch{}
    const personal=data.household.mode==="personal";
    setTabChosen(true); setTab(personal?"personal":"movimientos"); setMvType("expense"); setMvStep(1); setPersStep(1); setMenuOpen(false);
    window.setTimeout(()=>{ const el=document.getElementById(personal?"pers-amt":"mv-amount"); el?.scrollIntoView({block:"center",behavior:"smooth"}); (el as HTMLInputElement|null)?.focus({preventScroll:true}); },250);
  },[quickExpense,data?.household]);
  // tandas
  const [tandaName,setTandaName]=useState(""); const [tandaCount,setTandaCount]=useState("10"); const [tandaAmount,setTandaAmount]=useState(""); const [tandaStart,setTandaStart]=useState(todayISO());
  const [tandaFreq,setTandaFreq]=useState<"semanal"|"quincenal"|"mensual">("quincenal"); const [tandaDrawMode,setTandaDrawMode]=useState<"random"|"weighted">("random");
  const [partName,setPartName]=useState<Record<number,string>>({}); const [partCard,setPartCard]=useState<Record<number,string>>({}); const [cardInput,setCardInput]=useState<Record<number,string>>({});
  const [drawSel,setDrawSel]=useState<Record<number,"random"|"weighted">>({});
  const [tInvEmail,setTInvEmail]=useState<Record<number,string>>({}); const [tInvName,setTInvName]=useState<Record<number,string>>({}); const [tJoinName,setTJoinName]=useState<Record<number,string>>({});
  const [rateName,setRateName]=useState<Record<number,string>>({}); const [rateStars,setRateStars]=useState<Record<number,string>>({}); const [rateComment,setRateComment]=useState<Record<number,string>>({});
  const saveTanda=useMutation({mutationFn:async()=>await api.saveTanda({householdId:data!.household!.id,name:tandaName,participantCount:Number(tandaCount)||10,amountPerQuincena:Number(tandaAmount)||0,startDate:tandaStart,frequency:tandaFreq,drawMode:tandaDrawMode,organizerProfileId:me?me.id:null,organizerName:me?fullName(me):undefined}),onSuccess:()=>{inv();setTandaName("");setTandaAmount("");setSavedNotice("Tanda creada.");}});
  const delTanda=useMutation({mutationFn:async(id:number)=>await api.deleteTanda({id}),onSuccess:inv});
  const addPart=useMutation({mutationFn:async(v:{tandaId:number;name:string;cardLast4?:string})=>await api.addTandaParticipant({householdId:data!.household!.id,tandaId:v.tandaId,name:v.name,cardLast4:v.cardLast4||undefined}),onSuccess:inv});
  const removePart=useMutation({mutationFn:async(id:number)=>await api.removeTandaParticipant({id}),onSuccess:inv});
  const setCard=useMutation({mutationFn:async(v:{id:number;cardLast4:string})=>await api.setParticipantCard(v),onSuccess:inv});
  const drawTanda=useMutation({mutationFn:async(v:{id:number;mode:"random"|"weighted"})=>await api.drawTanda({tandaId:v.id,mode:v.mode}),onSuccess:inv});
  const setPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;status:"paid"|"pending"})=>await api.setTandaPayment({householdId:data!.household!.id,...v}),onSuccess:inv});
  const uploadProof=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;file:File})=>{ const r=await fileToBase64(v.file); return await api.setTandaPayment({householdId:data!.household!.id,tandaId:v.tandaId,participantId:v.participantId,quincenaIndex:v.quincenaIndex,status:"paid",proof:{dataBase64:r.dataBase64,mimeType:r.mimeType}}); },onSuccess:inv});
  const verifyPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number;verified:boolean})=>await api.verifyTandaPayment({householdId:data!.household!.id,...v}),onSuccess:inv});
  const createTandaInv=useMutation({mutationFn:async(v:{tandaId:number})=>await api.createTandaInvitation({householdId:data!.household!.id,tandaId:v.tandaId,email:tInvEmail[v.tandaId]||"",invitedName:tInvName[v.tandaId]||undefined}),onSuccess:(r,v)=>{inv();setTInvResult(p=>({...p,[v.tandaId]:{emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl}}));setTInvEmail(p=>({...p,[v.tandaId]:""}));setTInvName(p=>({...p,[v.tandaId]:""}));}});
  const respondTandaInv=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondTandaInvitation({id:v.id,accept:v.accept,name:tJoinName[v.id]||undefined}),onSuccess:inv});
  const rateOrg=useMutation({mutationFn:async(v:{tandaId:number})=>await api.rateOrganizer({householdId:data!.household!.id,tandaId:v.tandaId,raterName:rateName[v.tandaId]||"",stars:Number(rateStars[v.tandaId]||5),comment:rateComment[v.tandaId]||undefined}),onSuccess:(_r,v)=>{inv();setRateComment(p=>({...p,[v.tandaId]:""}));}});
  const remindPay=useMutation({mutationFn:async(v:{tandaId:number;participantId:number;quincenaIndex:number})=>await api.sendTandaReminder({householdId:data!.household!.id,...v}),onSuccess:inv});
  const [mvProfile,setMvProfile]=useState("");
  const [receipt,setReceipt]=useState<{dataBase64:string;mimeType:string;preview:string}|null>(null);
  const [persReceipt,setPersReceipt]=useState<{dataBase64:string;mimeType:string;preview:string}|null>(null);
  const [receiptView,setReceiptView]=useState<string|null>(null);
  const pickReceipt=async(file:File|undefined,set:(v:{dataBase64:string;mimeType:string;preview:string}|null)=>void)=>{ if(!file) return; const r=await fileToBase64(file); set({dataBase64:r.dataBase64,mimeType:r.mimeType,preview:URL.createObjectURL(file)}); };
  const [editProfId,setEditProfId]=useState<number|null>(null); const [editProfName,setEditProfName]=useState(""); const [editProfLast,setEditProfLast]=useState("");
  const [profLast,setProfLast]=useState("");
  const [invEmail2,setInvEmail2]=useState(""); const [invName2,setInvName2]=useState("");
  const [acceptFirst,setAcceptFirst]=useState<Record<number,string>>({}); const [acceptLast,setAcceptLast]=useState<Record<number,string>>({});
  const saveProfEdit=useMutation({mutationFn:async()=>{ const pr=data!.profiles.find(x=>x.id===editProfId); if(!pr) throw new Error("Perfil"); return await api.saveProfile({id:pr.id,householdId:data!.household!.id,name:editProfName,lastName:editProfLast,kind:pr.kind as "adult"|"dependent",dependentType:pr.dependentType||undefined,monthlyIncome:pr.monthlyIncome,fixedCommitments:pr.fixedCommitments,email:pr.email||undefined}); },onSuccess:()=>{inv();setEditProfId(null);}});
  const createInv=useMutation({mutationFn:async()=>await api.createInvitation({householdId:data!.household!.id,email:invEmail2,invitedName:invName2||undefined}),onSuccess:(r)=>{inv();setHhInvResult({emailSent:r.emailSent,emailConfigured:r.emailConfigured,inviteUrl:r.inviteUrl});setInvEmail2("");setInvName2("");}});
  const respondInv2=useMutation({mutationFn:async(v:{id:number;accept:boolean})=>await api.respondInvitation({id:v.id,accept:v.accept,firstName:acceptFirst[v.id]||undefined,lastName:acceptLast[v.id]||undefined}),onSuccess:(r)=>{ inv(); if(r.profileId) pickProfile(r.profileId); }});
  const delInv=useMutation({mutationFn:async(id:number)=>await api.deleteInvitation({id}),onSuccess:inv});

  // subcategorías editables + lectura automática del comprobante
  const [mvSubFilter,setMvSubFilter]=useState("all"); const [newSubName,setNewSubName]=useState(""); const [newSubByCat,setNewSubByCat]=useState<Record<number,string>>({});
  const addSub=useMutation({mutationFn:async(v:{categoryId:number;name:string})=>await api.addSubcategory(v),onSuccess:inv});
  const removeSub=useMutation({mutationFn:async(v:{categoryId:number;name:string})=>await api.removeSubcategory(v),onSuccess:inv});
  const [scanImg,setScanImg]=useState<{dataBase64:string;mimeType:string;preview:string}|null>(null); const [scanCat,setScanCat]=useState(""); const [scanPersImg,setScanPersImg]=useState<{dataBase64:string;mimeType:string;preview:string}|null>(null);
  const scanRcpt=useMutation({mutationFn:async(v:{img:{dataBase64:string;mimeType:string};visibility:"shared"|"private";categoryId?:number|null})=>await api.scanReceipt({householdId:data!.household!.id,image:v.img,visibility:v.visibility,categoryId:v.categoryId??null,profileId:me?me.id:null}),onSuccess:()=>{inv();setScanImg(null);setScanPersImg(null);setSavedNotice("Comprobante leído y gastos guardados.");}});



  const catsForType = useMemo(()=>{ if(!data) return []; const kind = mvType==="income"?"income":"expense"; if(mvType==="transfer") return []; return data.categories.filter(c=>c.kind===kind && c.isActive===1); },[data,mvType]);
  const selectedCat = data?.categories.find(c=>String(c.id)===mvCat);
  const filteredMovs = useMemo(()=>{ if(!data) return []; const meId = currentProfileId ?? data.profiles.find(x=>x.role==="admin")?.id ?? data.profiles.find(x=>x.kind==="adult")?.id ?? null; const meIsAdmin = meId!=null && data.profiles.find(x=>x.id===meId)?.role==="admin"; return data.movements.filter(m=> m.visibility==="shared" || (meId ? (m.profileId===meId || (m.profileId===null && meIsAdmin)) : true)).filter(m=>{ if(mvFilter!=="all" && m.type!==mvFilter) return false; if(mvSubFilter!=="all" && (m.subcategory||"")!==mvSubFilter) return false; if(mvSearch && !m.concept.toLowerCase().includes(mvSearch.toLowerCase())) return false; return true; }); },[data,mvFilter,mvSubFilter,mvSearch,currentProfileId]);

  if(q.isPending) return <div className="min-h-screen bg-[var(--bg)] p-6 text-center text-[var(--dim)]">Cargando SyncFinanzas…</div>;
  if(q.error) return <div className="min-h-screen bg-[var(--bg)] p-6"><p className="text-[var(--red)]">No se pudo cargar. {String(q.error)}</p><button className={btnPrimary} onClick={()=>q.refetch()}>Reintentar</button></div>;
  if(!data) return null;

  // ---- ONBOARDING ----
  if(!data.household){
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="max-w-xl mx-auto px-3 pb-6 pt-4">
          {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-3 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
          <p className="text-[var(--gold)] font-display font-extrabold tracking-wide text-sm">SYNCFINANZAS · VERSIÓN GRANDE</p>
          <h1 className="font-display text-2xl font-extrabold mt-2 leading-tight">Un solo hogar,<br/>cuentas claras.</h1>
          <p className="text-[var(--dim)] mt-3">Registre sus gastos e ingresos y vea cuánto le queda.</p>
          <div className="mt-4"><InstallCard installed={appInstalled} onInstall={handleInstallClick} /></div>
          <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2">
            <h2 className="font-display font-bold text-base">¿Recibió una invitación?</h2>
            <p className="text-sm text-[var(--dim)]">Escriba su correo.</p>
            <div className="flex gap-2"><input aria-label="Correo para buscar invitación" type="email" placeholder="tu@correo.com" className={inputCls} value={invEmail} onChange={e=>setInvEmail(e.target.value)} /><button type="button" className={btnPrimary} onClick={()=>findInv.mutate()} disabled={!invEmail || findInv.isPending}>Buscar invitación</button></div>
            {invSearched && invFound.length===0 && <p className="text-sm text-[var(--dim)]">No hay invitación pendiente para ese correo.</p>}
            {invFound.map(iv=>(
              <div key={iv.id} className="border border-[var(--border)] rounded-2xl p-3 space-y-2">
                <p className="text-sm"><b>Invitación pendiente</b> para unirse a <b>“{iv.householdName}”</b>{iv.invitedName?` · confirme su nombre:`:" · confirme su nombre:"}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="Tu nombre al aceptar la invitación" placeholder="Nombre" className={inputCls} value={joinFirst} onChange={e=>setJoinFirst(e.target.value)} />
                  <input aria-label="Tu apellido al aceptar la invitación" placeholder="Apellido" className={inputCls} value={joinLast} onChange={e=>setJoinLast(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button type="button" aria-label={`Aceptar invitación a ${iv.householdName}`} className={btnPrimary} onClick={()=>respondInv.mutate({id:iv.id,accept:true})} disabled={respondInv.isPending}>Aceptar y entrar al hogar</button>
                  <button type="button" aria-label={`Rechazar invitación a ${iv.householdName}`} className={btnGhost} onClick={()=>respondInv.mutate({id:iv.id,accept:false})} disabled={respondInv.isPending}>Rechazar</button>
                </div>
                {respondInv.error && <p className="text-sm text-[var(--red)]">{String(respondInv.error)}</p>}
              </div>
            ))}
          </div>
          {tokenInvite && !tokenDone && (
            <div className="bg-[var(--surface)] rounded-2xl border-2 border-[var(--gold)] p-3.5 mt-4 space-y-2" role="status">
              <h2 className="font-display font-bold text-base">Invitación recibida por correo</h2>
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
            <h2 className="font-display font-bold text-base">Invitar a crear una cuenta personal</h2>
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
                    <h2 className="font-display font-bold text-base">¿Cómo quiere usar SyncFinanzas?</h2>
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
              <h2 className="font-display font-bold text-base">{planMode==="personal"?"Su espacio personal":"Cree su hogar"}</h2>
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

  const s=data.summary; const hh=data.household; const effTab:Tab = (!tabChosen && hh.mode==="personal" && tab==="inicio") ? "personal" : tab; const goTab=(x:Tab)=>{setTabChosen(true);setTab(x); if(x==="inicio"){ setChartsSeen(true); try{ localStorage.setItem("sf-guide-charts-seen","1"); }catch{} }};
  const expandedGroup = openGroup ?? (MODULE_GROUPS.find(g=>g.tabs.includes(effTab))?.title ?? "");
  const fullName=(pr:{name:string;lastName?:string|null})=>`${pr.name} ${pr.lastName||""}`.trim();
  const me = data.profiles.find(x=>x.id===currentProfileId) || data.profiles.find(x=>x.role==="admin") || data.profiles.find(x=>x.kind==="adult") || null;
  const guideStep1 = hh.mode==="personal" ? data.personal.salary>0 : data.accounts.length>0;
  const guideStep2 = data.movements.length>0;
  const guideStep3 = chartsSeen;
  const isAdmin = !me || me.role==="admin";
  const visibleMovs = data.movements.filter(m=> m.visibility==="shared" || (me ? (m.profileId===me.id || (m.profileId===null && me.role==="admin")) : true));
  const getCatName=(id:number|null)=>data.categories.find(c=>c.id===id)?.name||"—";
  const getAccName=(id:number|null)=>data.accounts.find(a=>a.id===id)?.name||"—";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[var(--bg)]/95 backdrop-blur border-b border-[var(--border)] pt-safe">
        <div className="max-w-5xl mx-auto px-3 pt-3 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display font-extrabold leading-tight flex flex-wrap items-center gap-2"><span className="truncate">{hh.name}</span><span className="shrink-0 text-[11px] bg-[var(--gold)] text-white rounded-full px-2 py-0.5 whitespace-nowrap">{hh.mode==="personal"?"MODO PERSONAL":"MODO FAMILIAR"}</span></p>
              <p className="text-[11px] text-[var(--dim)] mt-1.5">Corte día {hh.cutoffDay} · Umbral {money(hh.approvalThreshold)}{me?` · ${fullName(me)} · ${me.role==="admin"?"Administrador":"Integrante"}`:""}</p>
            </div>
            <div className="flex gap-2 shrink-0 pt-0.5">
              {!appInstalled && <button type="button" className={btnGhost} aria-label="Instalar SyncFinanzas en el celular" onClick={handleInstallClick}>Instalar</button>}
              <button className={btnGhost} aria-label="Ver con datos de demostración" onClick={()=>demo.mutate()} disabled={demo.isPending || data.movements.length>0} title={data.movements.length>0?"La demo solo se carga sin movimientos":"Carga datos de ejemplo"}>Demo</button>
            </div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-3 pt-2 pb-3 flex items-center gap-3 border-t border-[var(--border)]">
          <button type="button" aria-label={menuOpen?"Cerrar menú de módulos":"Abrir menú de módulos"} aria-expanded={menuOpen} aria-controls="menu-modulos" onClick={()=>setMenuOpen(o=>!o)} className="shrink-0 w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex flex-col items-center justify-center gap-[5px]">
            <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-transform ${menuOpen?"translate-y-[7.5px] rotate-45":""}`} />
            <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-opacity ${menuOpen?"opacity-0":""}`} />
            <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--text)] transition-transform ${menuOpen?"-translate-y-[7.5px] -rotate-45":""}`} />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">MÓDULO ACTUAL</p>
            <p className="font-display font-bold leading-tight truncate">{TABS.find(t=>t.id===effTab)?.label}</p>
          </div>
          <p className="ml-auto text-xs text-[var(--dim)] hidden sm:block">Toque el menú para ver los módulos</p>
        </div>
        {menuOpen && (
          <nav id="menu-modulos" aria-label="Módulos agrupados por función" className="border-t border-[var(--border)] bg-[var(--surface)] max-h-[60vh] overflow-y-auto">
            <div className="max-w-5xl mx-auto px-3 py-2 space-y-2">
              <p className="text-xs text-[var(--dim)]">Seleccione un segmento.</p>
              {MODULE_GROUPS.map(g=>{ const isOpen = expandedGroup===g.title; const hasCurrent = g.tabs.includes(effTab); return (
                <div key={g.title} className="border border-[var(--border)] rounded-2xl overflow-hidden">
                  <button type="button" aria-label={`${isOpen?"Contraer":"Desplegar"} el segmento ${g.title}`} aria-expanded={isOpen} onClick={()=>setOpenGroup(isOpen?"":g.title)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left ${hasCurrent?"bg-[var(--surface2)]":"bg-[var(--surface)]"}`}>
                    <span className="min-w-0"><span className="block text-[13px] font-bold tracking-wide">{g.title.toUpperCase()}</span><span className="block text-[11px] text-[var(--dim)] truncate">{g.tabs.map(tid=>TABS.find(x=>x.id===tid)?.label).join(" · ")}{hasCurrent?` — está usted en ${TABS.find(x=>x.id===effTab)?.label}`:""}</span></span>
                    <span aria-hidden="true" className={`shrink-0 text-lg leading-none transition-transform ${isOpen?"rotate-180":""}`}>▾</span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
                      {g.tabs.map(tid=>{ const t=TABS.find(x=>x.id===tid)!; return <button key={t.id} type="button" aria-label={`Ir a ${t.label}`} aria-current={effTab===t.id?"page":undefined} onClick={()=>{goTab(t.id);setMenuOpen(false);}} className={`rounded-2xl px-3 py-2 text-left text-sm font-bold ${effTab===t.id?"bg-[var(--accent)] text-[var(--accent-text)]":"bg-[var(--surface2)] text-[var(--text)]"}`}>{t.label}{effTab===t.id && <span className="block text-[11px] font-semibold opacity-80">Módulo actual</span>}{MODULE_HINT[t.id] && <span className={`block text-[11px] font-normal mt-0.5 ${effTab===t.id?"opacity-80":"text-[var(--dim)]"}`}>{MODULE_HINT[t.id]}</span>}</button>; })}
                    </div>
                  )}
                </div>
              ); })}
            </div>
          </nav>
        )}
        {demo.error && <p className="max-w-5xl mx-auto px-3 pb-2 text-xs text-[var(--red)]">{String(demo.error)}</p>}
        {demo.isSuccess && <p className="max-w-5xl mx-auto px-3 pb-2 text-xs text-[var(--green)]">Demo cargada: datos con “(demo)”.</p>}
      </header>

      <main className="max-w-5xl mx-auto px-3 pb-8 pt-4">
        {resetDone && <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--green)] rounded-2xl p-3 flex items-start gap-2" role="status"><p className="text-sm flex-1"><b>Datos eliminados.</b> Empiece de nuevo.</p><button type="button" aria-label="Cerrar el aviso de reinicio completado" onClick={()=>setResetDone(false)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {savedNotice && <div className="mb-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center gap-2" role="status"><p className="text-sm flex-1">{savedNotice}</p><button type="button" className={btnPrimary} onClick={()=>{setSavedNotice(null);goTab("inicio");}}>Ir a Inicio</button><button type="button" aria-label="Cerrar el aviso" onClick={()=>setSavedNotice(null)} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button></div>}
        {firstGuideOpen && (
          <div className="mb-3 bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-3 sm:p-3.5" role="status">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-base">Empiece en 3 pasos</h2>
                
              </div>
              <button type="button" aria-label="Cerrar la guía de inicio" onClick={dismissFirstGuide} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
            </div>
            <ol className="mt-3 space-y-2">
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep1?"bg-[var(--green)]":"bg-[var(--gold)]"} text-white font-bold flex items-center justify-center text-sm`}>{guideStep1?"✓":"1"}</span><div className="flex-1"><p className="text-sm font-bold">{hh.mode==="personal"?"Registre su sueldo":"Abra su cuenta inicial"}</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Escriba su sueldo en Personal.":"Pulse Nueva cuenta en Cuentas."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab(hh.mode==="personal"?"personal":"cuentas")}>{hh.mode==="personal"?"Ir a Personal":"Ir a Cuentas"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep2?"bg-[var(--green)]":"bg-[var(--gold)]"} text-white font-bold flex items-center justify-center text-sm`}>{guideStep2?"✓":"2"}</span><div className="flex-1"><p className="text-sm font-bold">Registre su primer gasto</p><p className="text-sm text-[var(--dim)]">{hh.mode==="personal"?"Registre su gasto del día en Personal.":"Escriba el importe en Movimientos."}</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab(hh.mode==="personal"?"personal":"movimientos")}>{hh.mode==="personal"?"Ir a Personal":"Ir a Movimientos"}</button></li>
              <li className="flex gap-2 items-start"><span className={`shrink-0 w-7 h-7 rounded-full ${guideStep3?"bg-[var(--green)]":"bg-[var(--gold)]"} text-white font-bold flex items-center justify-center text-sm`}>{guideStep3?"✓":"3"}</span><div className="flex-1"><p className="text-sm font-bold">Revise sus gráficas</p><p className="text-sm text-[var(--dim)]">Vea su gasto por categoría en Inicio.</p></div><button type="button" className={btnGhost+" shrink-0"} onClick={()=>goTab("inicio")}>Ir a Inicio</button></li>
            </ol>
            <button type="button" className={btnPrimary+" mt-3"} onClick={dismissFirstGuide}>Entendido</button>
          </div>
        )}
        {!appInstalled && !installDismissed && <div className="mb-3"><InstallCard installed={appInstalled} onInstall={handleInstallClick} onDismiss={dismissInstall} /></div>}
        {effTab==="inicio" && (
          <section>
            <div className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-3.5">
              <p className="text-sm opacity-80">Disponible · {s.currentMonth}</p>
              <p className="font-display text-3xl font-extrabold mt-1">{money2(s.availableFree)}</p>
              <p className="text-sm opacity-80 mt-1">Total {money2(s.totalBalance)} − fondos {money2(s.totalInFunds)}.</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Entradas</p><p className="font-display font-bold">{money(s.monthIncome)}</p></div>
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Salidas</p><p className="font-display font-bold">{money(s.monthExpense)}</p></div>
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Neto</p><p className="font-display font-bold">{money(s.monthNet)}</p></div>
              </div>
            </div>

            {data.movements.length===0 ? (
              <p className="text-sm text-[var(--dim)] mt-3">Sin movimientos todavía.</p>
            ) : (
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                <h2 className="font-display font-bold">Gasto por categoría · {s.currentMonth}</h2>
                <CategoryChart data={data.personal.byCategory.map(c=>({name:c.name,total:c.total,pct:c.pct}))} />
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                <h2 className="font-display font-bold">Ingresos vs gastos</h2>
                <MonthlyChart series={s.monthlySeries} />
                <p className="text-xs text-[var(--dim)]">Últimos 6 meses.</p>
                <button type="button" aria-label="Ver los movimientos completos desde Inicio" className={btnPrimary+" mt-3"} onClick={()=>goTab("movimientos")}>Ver movimientos completos</button>
              </div>
            </div>
            )}
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                <h2 className="font-display font-bold">Presupuestos</h2>
                {data.budgets.filter(b=>b.month===s.currentMonth).length===0 ? <><p className="text-sm text-[var(--dim)] mt-2">Sin presupuestos este mes.</p><button type="button" aria-label="Agregar presupuesto" className={btnPrimary+" mt-2"} onClick={()=>goTab("presupuestos")}>+ Agregar presupuesto</button></> : data.budgets.filter(b=>b.month===s.currentMonth).map(b=>(
                  <div key={b.id} className="mt-3"><div className="flex justify-between text-sm"><span>{getCatName(b.categoryId)} · {b.visibility==="shared"?"Compartido":"Privado"}</span><b>{money(b.spent)} / {money(b.amount)}</b></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${b.pct>=100?"bg-[var(--red)]":"bg-[var(--gold)]"}`} style={{width:`${b.pct}%`}} /></div><p className="text-xs text-[var(--dim)]">Restan {money(b.remaining)} · {b.pct}% usado</p></div>
                ))}
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                <h2 className="font-display font-bold">Metas y patrimonio</h2>
                {data.goals.slice(0,3).map(g=><div key={g.id} className="mt-3"><div className="flex justify-between text-sm"><span>{g.name}</span><b>{g.pct}%</b></div><div className="h-2 bg-[var(--surface2)] rounded-full mt-1"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div><p className="text-xs text-[var(--dim)]">{money(g.savedAmount)} de {money(g.targetAmount)}{g.targetDate?` · meta ${fmtDate(g.targetDate)}`:""}</p></div>)}
                {data.goals.length===0 && <><p className="text-sm text-[var(--dim)] mt-2">Sin metas registradas.</p><button type="button" aria-label="Agregar meta" className={btnPrimary+" mt-2"} onClick={()=>goTab("metas")}>+ Agregar meta</button></>}
                <div className="border-t border-[var(--border)] mt-3 pt-3 flex justify-between"><span className="text-sm">Patrimonio neto</span><b className="font-display">{money2(s.netWorth)}</b></div>
                <p className="text-xs text-[var(--dim)]">Activos {money(s.totalAssets)} − Pasivos {money(s.totalLiabilities)}.</p>
                {data.patrimony.length===0 && <button type="button" aria-label="Agregar patrimonio" className={btnPrimary+" mt-2"} onClick={()=>goTab("patrimonio")}>+ Agregar patrimonio</button>}
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 mt-3">
              <h2 className="font-display font-bold">Actividad reciente</h2>
              {visibleMovs.slice(0,6).map(m=><div key={m.id} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm"><span className="min-w-0">{m.concept}<span className="text-[var(--dim)] block text-xs">{fmtDate(m.date)} · {getCatName(m.categoryId)} · {m.visibility==="shared"?"Compartido":"Privado"} · por {m.profileId?(fullName(data.profiles.find(x=>x.id===m.profileId)||{name:"Integrante"})):"el hogar"}{m.isReversed?" · Reversado (fuera de los totales)":""}{m.reversalOfId?" · Reversión (fuera de los totales)":""}</span></span><b className={`${m.type==="income"?"text-[var(--green)]":""} ${(m.isReversed||m.reversalOfId)?"line-through opacity-60":""}`}>{m.type==="income"?"+":"−"}{money(m.amount)}</b></div>)}
              {data.movements.length===0 && <p className="text-sm text-[var(--dim)] mt-2">Sin movimientos todavía.</p>}
              {data.movements.length>0 && <button type="button" aria-label="Ver todos los movimientos del hogar" className={btnGhost+" mt-2"} onClick={()=>goTab("movimientos")}>Ver todos los movimientos</button>}
            </div>
          </section>
        )}

        {effTab==="movimientos" && (
          <section className="grid md:grid-cols-[340px_1fr] gap-3 items-start">
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(mvStep<3){ if(mvStep===1 && !mvAmount) return; setMvStep(mvStep+1); } else saveMv.mutate();}}>
              <h2 className="font-display font-bold text-base">{editingMv?"Editar movimiento":"Registrar movimiento"}</h2>
              <p className="text-xs text-[var(--dim)]">Paso {mvStep} de 3</p>
              <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden" aria-hidden="true"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${mvStep*33.33}%`}} /></div>
              {mvStep===1 && <>
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Tipo de movimiento">
                {(["expense","income","transfer","debt_payment"] as const).map(t=><button type="button" key={t} aria-label={TYPE_LABEL[t]} onClick={()=>{setMvType(t);setMvCat("");setMvSub("");}} className={`rounded-full py-2 text-[12px] font-bold ${mvType===t?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>{TYPE_LABEL[t]}</button>)}
              </div>
              <div><Label htmlFor="mv-amount">Importe ($)</Label><input id="mv-amount" aria-label="Importe del movimiento" type="number" min="0.01" step="0.01" required className={inputCls+" text-xl font-bold py-2"} value={mvAmount} onChange={e=>setMvAmount(e.target.value)} /></div>
              <button type="button" className={btnPrimary+" w-full"} disabled={!mvAmount} onClick={()=>setMvStep(2)}>Siguiente</button>
              </>}
              {mvStep===2 && <>
              {mvType!=="transfer" && <>
                <div><Label htmlFor="mv-cat">{mvType==="income"?"Tipo de ingreso":"Tipo de gasto"}</Label><select id="mv-cat" aria-label="Categoría del movimiento" className={inputCls} value={mvCat} onChange={e=>{setMvCat(e.target.value);setMvSub("");}}><option value="">Sin categoría</option>{catsForType.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><Label htmlFor="mv-sub">Subcategoría</Label><select id="mv-sub" aria-label="Subcategoría del movimiento" className={inputCls} value={mvSub} onChange={e=>setMvSub(e.target.value)} disabled={!selectedCat}><option value="">{selectedCat?"Seleccione…":"Primero seleccione la categoría"}</option>{(selectedCat?.subcategories||[]).map(sb=><option key={sb} value={sb}>{sb}</option>)}<option value="__new__">+ Nueva subcategoría…</option></select>                {mvSub==="__new__" && selectedCat && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-2.5 bg-[var(--surface2)]"><p className="text-xs">¿Agregar “{newSubName||"…"}” a {selectedCat.name}?</p><div className="flex gap-2 mt-2"><input aria-label="Nombre de la nueva subcategoría" placeholder="Nombre de la subcategoría" className={inputCls} value={newSubName} onChange={e=>setNewSubName(e.target.value)} /><button type="button" aria-label="Confirmar y agregar la nueva subcategoría" className={btnPrimary} disabled={!newSubName.trim() || addSub.isPending} onClick={()=>addSub.mutate({categoryId:selectedCat.id,name:newSubName.trim()},{onSuccess:()=>{setMvSub(newSubName.trim());setNewSubName("");}})}>Sí, agregar</button></div>{addSub.error && <p className="text-xs text-[var(--red)] mt-1">{String(addSub.error)}</p>}</div>}
                </div>
              </>}
              {mvType==="transfer" && <p className="text-sm text-[var(--dim)]">Las transferencias no llevan categoría.</p>}
              <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>setMvStep(1)}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} onClick={()=>setMvStep(3)}>Siguiente</button></div>
              </>}
              {mvStep===3 && <>
              <div><Label htmlFor="mv-concept">Concepto</Label><input id="mv-concept" aria-label="Concepto del movimiento" required className={inputCls} value={mvConcept} onChange={e=>setMvConcept(e.target.value)} placeholder="Ej. Súper semanal" /></div>
              <div>
                <button type="button" aria-expanded={mvMore} aria-label={mvMore?"Ocultar más opciones del movimiento":"Mostrar más opciones del movimiento"} onClick={()=>setMvMore(o=>!o)} className="w-full text-left text-sm font-bold text-[var(--dim)] border border-[var(--border)] rounded-xl px-3 py-2.5">{mvMore?"▾ Ocultar más opciones":"▸ Más opciones"}</button>
                {mvMore && (<div className="space-y-2 mt-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="mv-account">Cuenta</Label><select id="mv-account" aria-label="Cuenta del movimiento" className={inputCls} value={mvAccount} onChange={e=>setMvAccount(e.target.value)}><option value="">Sin cuenta</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</select></div>
                {mvType==="transfer" && <div><Label htmlFor="mv-to">Cuenta destino</Label><select id="mv-to" aria-label="Cuenta destino" className={inputCls} value={mvToAccount} onChange={e=>setMvToAccount(e.target.value)}><option value="">Seleccione…</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
                <div><Label htmlFor="mv-date">Fecha</Label><input id="mv-date" aria-label="Fecha del movimiento" type="date" required className={inputCls} value={mvDate} onChange={e=>setMvDate(e.target.value)} /></div>
              </div>
              <div className="border border-dashed border-[var(--border)] rounded-2xl p-3">
                <Label htmlFor="mv-receipt">Foto del comprobante (opcional)</Label>
                <input id="mv-receipt" aria-label="Adjuntar foto del comprobante" type="file" accept="image/*" className="w-full text-sm" onChange={e=>{ void pickReceipt(e.target.files?.[0], setReceipt); }} />
                <p className="text-[11px] text-[var(--dim)] mt-1">Se guarda como comprobante.</p>
                {receipt && <div className="flex items-center gap-2 mt-2"><img src={receipt.preview} alt="Vista previa de la foto del comprobante" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)]" /><button type="button" aria-label="Quitar foto del comprobante" className="text-xs underline text-[var(--red)]" onClick={()=>setReceipt(null)}>Quitar foto</button></div>}
              </div>
              <div className="border-2 border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
                <p className="font-display font-bold text-sm">Lectura automática</p>
                                <p className="text-[11px] text-[var(--dim)] mt-1">Los gastos se crean solos.</p>
                <input aria-label="Fotografía del comprobante para lectura automática" type="file" accept="image/*" className="w-full text-sm mt-2" onChange={e=>{ const f=e.target.files?.[0]; if(f) void imageFileToJpeg(f).then(setScanImg).catch(()=>setScanImg(null)); e.target.value=""; }} />
                {scanImg && <div className="mt-2 space-y-2"><img src={scanImg.preview} alt="Vista previa del comprobante que se leerá automáticamente" className="w-full max-h-36 object-contain rounded-xl border border-[var(--border)] bg-white" />
                  <div><Label htmlFor="scan-cat">Categoría (opcional)</Label><select id="scan-cat" aria-label="Categoría para los productos leídos del comprobante" className={inputCls} value={scanCat} onChange={e=>setScanCat(e.target.value)}><option value="">Automática</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <button type="button" aria-label="Leer el comprobante y crear los gastos automáticamente" className={btnPrimary+" w-full"} disabled={scanRcpt.isPending} onClick={()=>scanRcpt.mutate({img:{dataBase64:scanImg.dataBase64,mimeType:scanImg.mimeType},visibility:mvVis,categoryId:scanCat?Number(scanCat):null})}>{scanRcpt.isPending?"Leyendo el comprobante…":"Leer comprobante y crear los gastos"}</button>
                </div>}
                {scanRcpt.isSuccess && scanRcpt.data && <p className="text-sm text-[var(--green)] mt-2">Se crearon {scanRcpt.data.created} gasto(s) por {money2(scanRcpt.data.totalDetected)}.</p>}
                {scanRcpt.error && <p className="text-sm text-[var(--red)] mt-2">{String(scanRcpt.error)}</p>}
              </div>
              <div><Label htmlFor="mv-profile">Hecho por</Label><select id="mv-profile" aria-label="Integrante que hizo el movimiento" className={inputCls} value={mvProfile} onChange={e=>setMvProfile(e.target.value)}><option value="">{me?`Yo (${fullName(me)})`:"El hogar"}</option>{data.profiles.filter(x=>x.kind==="adult").map(x=><option key={x.id} value={x.id}>{fullName(x)}</option>)}</select></div>
              <div>
                <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">Visibilidad</span>
                <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Selector de visibilidad compartido o privado">
                  <button type="button" aria-label="Movimiento compartido" onClick={()=>setMvVis("shared")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="shared"?"bg-[var(--green)] text-white":"border border-[var(--border)]"}`}>Compartido</button>
                  <button type="button" aria-label="Movimiento privado" onClick={()=>setMvVis("private")} className={`rounded-full py-2.5 text-[13px] font-bold ${mvVis==="private"?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>Privado</button>
                </div>
                <p className="text-[11px] text-[var(--dim)] mt-1">{mvVis==="shared"?"Lo ven todos.":"Solo usted lo ve."}</p>
              </div>
                </div>)}
              </div>
              {Number(mvAmount)>=hh.approvalThreshold && mvVis==="shared" && mvType==="expense" && <Help>Supera el umbral de {money(hh.approvalThreshold)}: requiere un Acuerdo.</Help>}
              {saveMv.error && <p className="text-sm text-[var(--red)]">{String(saveMv.error)}</p>}
              <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>setMvStep(2)}>Atrás</button><button className={btnPrimary+" flex-1"} disabled={saveMv.isPending || !mvAmount || !mvConcept}>{saveMv.isPending?"Guardando…":editingMv?"Guardar cambios":"Finalizar"}</button></div>
              {editingMv && <button type="button" className={btnGhost+" w-full"} onClick={()=>{setEditingMv(null);setMvStep(1);}}>Cancelar edición</button>}
              {data.accounts.length===0 && <Help>Cree primero una cuenta.</Help>}
              </>}
            </form>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Mostrar movimientos por tipo">
                {([["all","Todos"],["income","Ingresos"],["expense","Gastos"],["transfer","Transferencias"],["debt_payment","Pagos de deuda"]] as const).map(([v,l])=>(
                  <button key={v} type="button" aria-label={`Mostrar ${l}`} aria-pressed={mvFilter===v} onClick={()=>setMvFilter(v)} className={`rounded-full px-3.5 py-2 text-[13px] font-bold ${mvFilter===v?"bg-[var(--accent)] text-[var(--accent-text)]":"border border-[var(--border)]"}`}>{l}</button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap mt-2">
                <input aria-label="Buscar movimientos" placeholder="Buscar concepto…" className={inputCls+" flex-1 min-w-[160px]"} value={mvSearch} onChange={e=>setMvSearch(e.target.value)} />
                <select aria-label="Filtrar por subcategoría" className={inputCls+" w-auto"} value={mvSubFilter} onChange={e=>setMvSubFilter(e.target.value)}><option value="all">Todas</option>{Array.from(new Set(data.categories.flatMap(c=>c.subcategories))).sort().map(sb=><option key={sb} value={sb}>{sb}</option>)}<option value="">Sin subcategoría</option></select>
              </div>
              <p className="text-xs text-[var(--dim)] mt-2">{filteredMovs.length} movimientos · Entradas {money(filteredMovs.filter(m=>m.type==="income" && !m.isReversed && !m.reversalOfId).reduce((a,m)=>a+m.amount,0))} · Salidas {money(filteredMovs.filter(m=>m.type!=="income" && !m.isReversed && !m.reversalOfId).reduce((a,m)=>a+m.amount,0))}</p>
              {revMv.error && <p className="text-sm text-[var(--red)] mt-2">{String(revMv.error)}</p>}
              {revMv.isSuccess && <p className="text-sm text-[var(--green)] mt-2">Movimiento reversado.</p>}
              <div className="divide-y divide-[var(--border)] mt-2">
                {filteredMovs.map(m=>{ const annulled = m.isReversed || !!m.reversalOfId; return <div key={m.id} className={`py-2 ${annulled?"opacity-70":""}`}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-sm">{m.concept}</p><p className="text-xs text-[var(--dim)]">{fmtDate(m.date)} · {TYPE_LABEL[m.type]||m.type} · {getCatName(m.categoryId)}{m.subcategory?` / ${m.subcategory}`:""} · {getAccName(m.accountId)} · {m.visibility==="shared"?"Compartido":"Privado"} · por {m.profileId?(fullName(data.profiles.find(x=>x.id===m.profileId)||{name:"Integrante"})):"el hogar"}</p>
                {m.isReversed && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">REVERSADO</span> <span className="text-[11px] text-[var(--dim)]">Fuera de los totales.</span></p>}
                {!!m.reversalOfId && <p className="mt-1"><span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-[var(--surface2)]">REVERSIÓN</span> <span className="text-[11px] text-[var(--dim)]">Anula «{data.movements.find(x=>x.id===m.reversalOfId)?.concept||""}».</span></p>}
                </div><div className="text-right shrink-0"><p className={`font-display font-bold ${m.type==="income"?"text-[var(--green)]":""} ${annulled?"line-through":""}`}>{m.type==="income"?"+":"−"}{money2(m.amount)}</p>{m.receiptUrl && <span className="block mt-1"><img src={m.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-10 h-10 object-cover rounded-lg border border-[var(--border)] inline-block" /><br/><button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold" onClick={()=>setReceiptView(m.receiptUrl)}>Ver comprobante</button></span>}
                {!annulled && <><button aria-label={`Editar ${m.concept}`} className="text-xs underline mr-2" onClick={()=>{setMvStep(1);setEditingMv(m.id);setMvType(m.type as typeof mvType);setMvAmount(String(m.amount));setMvConcept(m.concept);setMvAccount(m.accountId?String(m.accountId):"");setMvCat(m.categoryId?String(m.categoryId):"");setMvSub(m.subcategory||"");setMvDate(m.date);setMvVis(m.visibility as "private"|"shared");}}>Editar</button><button aria-label={`Reversar ${m.concept}`} className="text-xs underline font-bold mr-2" onClick={()=>setConfirmReverseId(confirmReverseId===m.id?null:m.id)}>Reversar</button><button aria-label={`Eliminar ${m.concept}`} className="text-xs underline text-[var(--red)]" onClick={()=>delMv.mutate(m.id)}>Eliminar</button></>}
                </div></div>
                {confirmReverseId===m.id && !annulled && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Reversar «{m.concept}» por <b>{money2(m.amount)}</b>? Ambos quedan fuera de los totales.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la reversión de ${m.concept}`} className={btnPrimary} disabled={revMv.isPending} onClick={()=>revMv.mutate(m.id)}>{revMv.isPending?"Reversando…":"Sí, reversar"}</button><button type="button" aria-label="Cancelar la reversión" className={btnGhost} onClick={()=>setConfirmReverseId(null)}>Cancelar</button></div></div>}
                </div>; })}
              </div>
              {filteredMovs.length===0 && <Empty title="Sin movimientos con ese filtro" body="Cambie el filtro o registre el primero." />}
            </div>
          </section>
        )}

        {effTab==="cuentas" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveAcc.mutate();}}>
              <h2 className="font-display font-bold text-base">{editingAcc?"Editar cuenta":"Nueva cuenta"}</h2>
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
            <div className="grid sm:grid-cols-2 gap-2">
              {data.accounts.map(a=><div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">{a.name}</p><p className="text-xs text-[var(--dim)]">{TYPE_LABEL[a.type]||a.type} · {a.visibility==="shared"?"Compartida":"Privada"} · Inicial {money(a.initialBalance)}</p><p className="font-display text-xl font-extrabold mt-2">{money2(a.balance)}</p><div className="mt-2 flex gap-2"><button aria-label={`Editar cuenta ${a.name}`} className="text-xs underline" onClick={()=>{setEditingAcc(a.id);setAccFormName(a.name);setAccType(a.type as typeof accType);setAccVis(a.visibility as "private"|"shared");setAccInit(String(a.initialBalance));}}>Editar</button><button aria-label={`Eliminar cuenta ${a.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>delAcc.mutate(a.id)}>Eliminar</button></div></div>)}
              {data.accounts.length===0 && <Empty title="Sin cuentas" body="Cree su primera cuenta." action={{label:"+ Agregar cuenta",onClick:()=>focusField("acc-name")}} />}
            </div>
          </section>
        )}

        {effTab==="presupuestos" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 grid md:grid-cols-5 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveBud.mutate();}}>
              <div><Label htmlFor="bud-cat">Categoría de gasto</Label><select id="bud-cat" aria-label="Categoría del presupuesto" required className={inputCls} value={budCat} onChange={e=>setBudCat(e.target.value)}><option value="">Seleccione…</option>{data.categories.filter(c=>c.kind==="expense").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><Label htmlFor="bud-month">Mes</Label><input id="bud-month" aria-label="Mes del presupuesto" type="month" required className={inputCls} value={budMonth} onChange={e=>setBudMonth(e.target.value)} /></div>
              <div><Label htmlFor="bud-amount">Presupuestado ($)</Label><input id="bud-amount" aria-label="Monto presupuestado" type="number" min="0" required className={inputCls} value={budAmount} onChange={e=>setBudAmount(e.target.value)} /></div>
              <div><Label htmlFor="bud-vis">Visibilidad</Label><select id="bud-vis" aria-label="Visibilidad del presupuesto" className={inputCls} value={budVis} onChange={e=>setBudVis(e.target.value as "private"|"shared")}><option value="shared">Compartido</option><option value="private">Privado</option></select></div>
              <button className={btnPrimary} disabled={saveBud.isPending}>Crear presupuesto</button>
            </form>
            <Help>Se calcula desde sus movimientos.</Help>
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              {data.budgets.map(b=><div key={b.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><div className="flex justify-between"><b className="font-display">{getCatName(b.categoryId)}</b><span className="text-xs bg-[var(--surface2)] rounded-full px-2 py-1">{b.month} · {b.visibility==="shared"?"Compartido":"Privado"}</span></div><p className="text-sm mt-2">Presupuestado {money(b.amount)} · Gastado {money(b.spent)} · <b>Restan {money(b.remaining)}</b></p><div className="h-2 bg-[var(--surface2)] rounded-full mt-2 overflow-hidden"><div className={`h-full ${b.pct>=100?"bg-[var(--red)]":b.pct>=80?"bg-[var(--gold)]":"bg-[var(--green)]"}`} style={{width:`${b.pct}%`}} /></div><p className="text-xs text-[var(--dim)] mt-1">{b.pct}% usado {b.remaining<0?"· Presupuesto excedido":""}</p><button aria-label={`Eliminar presupuesto de ${getCatName(b.categoryId)}`} className="text-xs underline text-[var(--red)] mt-1" onClick={()=>delBud.mutate(b.id)}>Eliminar</button></div>)}
              {data.budgets.length===0 && <Empty title="Sin presupuestos" body="Uno por categoría y mes." action={{label:"+ Agregar presupuesto",onClick:()=>focusField("bud-cat")}} />}
            </div>
          </section>
        )}

        {effTab==="fondos" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-wrap gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveFund.mutate();}}>
              <div className="flex-1 min-w-[180px]"><Label htmlFor="fund-name">Nombre del fondo</Label><input id="fund-name" aria-label="Nombre del fondo" required className={inputCls} value={fundName} onChange={e=>setFundName(e.target.value)} placeholder="Ej. Fondo de emergencia" /></div>
              <div><Label htmlFor="fund-target">Meta ($, opcional)</Label><input id="fund-target" aria-label="Meta del fondo" type="number" min="0" className={inputCls} value={fundTarget} onChange={e=>setFundTarget(e.target.value)} /></div>
              <button className={btnPrimary}>Crear fondo</button>
            </form>
            <div className="mt-3"><Help>El dinero sigue en su cuenta; no cuenta como disponible.</Help></div>
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              {data.funds.map(f=><div key={f.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">{f.name}</p><p className="font-display text-xl font-extrabold mt-1">{money2(f.balance)}</p>{f.targetAmount && <p className="text-xs text-[var(--dim)]">Meta {money(f.targetAmount)} · {Math.min(100,Math.round(f.balance/f.targetAmount*100))}%</p>}<div className="flex gap-2 mt-3"><input aria-label={`Monto para ${f.name}`} type="number" min="0" placeholder="$ Monto" className={inputCls} value={fundAmt[f.id]||""} onChange={e=>setFundAmt({...fundAmt,[f.id]:e.target.value})} /><button aria-label={`Aportar a ${f.name}`} className={btnPrimary} onClick={()=>fundMove.mutate({fundId:f.id,type:"contribution",amount:Number(fundAmt[f.id])||0})}>Aportar</button><button aria-label={`Retirar de ${f.name}`} className={btnGhost} onClick={()=>fundMove.mutate({fundId:f.id,type:"withdrawal",amount:Number(fundAmt[f.id])||0})}>Retirar</button></div><button aria-label={`Eliminar fondo ${f.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>delFund.mutate(f.id)}>Eliminar fondo</button></div>)}
              {data.funds.length===0 && <Empty title="Sin fondos" body="Cree el fondo de emergencia." />}
            </div>
          </section>
        )}

        {effTab==="aportaciones" && (
          <section className="max-w-2xl">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5">
              <h2 className="font-display font-bold text-base">Reparto del gasto — {s.currentMonth}</h2>
              <p className="text-sm text-[var(--dim)] mt-1">Base del reparto: <b className="text-[var(--text)]">{money2(s.sharedExpenseMonth)}</b> · Regla: {hh.contributionRule==="equal"?"Partes iguales":"Proporcional al ingreso"}</p>
              <div className="bg-[var(--surface2)] rounded-2xl p-3 mt-3 text-sm">{s.contributionsNote}</div>
              <div className="divide-y divide-[var(--border)] mt-3">
                {s.contributions.map(c=><div key={c.profileId} className="py-2 flex justify-between gap-2"><div><p className="font-semibold">{c.name}</p><p className="text-xs text-[var(--dim)]">Ingreso {money(c.income)} · Capacidad {money(c.capacity)}{hh.contributionRule==="proportional"?` · ${c.pctShare}% del ingreso conjunto`:""}</p>{c.shouldPay>c.capacity && c.capacity>=0 && <p className="text-xs text-[var(--red)]">Supera su capacidad de pago.</p>}</div><p className="font-display font-extrabold text-base">{money2(c.shouldPay)}</p></div>)}
              </div>
              {s.contributions.length===0 && <Empty title="Sin adultos para repartir" body="Agregue adultos en Perfiles." />}
              <Help><b>Capacidad</b> = ingreso − compromisos.</Help>
            </div>
          </section>
        )}

        {effTab==="metas" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 grid md:grid-cols-5 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveGoal.mutate();}}>
              <div><Label htmlFor="goal-name">Nombre de la meta</Label><input id="goal-name" aria-label="Nombre de la meta" required className={inputCls} value={goalName} onChange={e=>setGoalName(e.target.value)} placeholder="Ej. Vacaciones" /></div>
              <div><Label htmlFor="goal-target">Monto objetivo ($)</Label><input id="goal-target" aria-label="Monto objetivo de la meta" type="number" min="1" required className={inputCls} value={goalTarget} onChange={e=>setGoalTarget(e.target.value)} /></div>
              <div><Label htmlFor="goal-saved">Ya ahorrado ($)</Label><input id="goal-saved" aria-label="Ya ahorrado en la meta" type="number" min="0" className={inputCls} value={goalSaved} onChange={e=>setGoalSaved(e.target.value)} /></div>
              <div><Label htmlFor="goal-date">Fecha objetivo</Label><input id="goal-date" aria-label="Fecha objetivo de la meta" type="date" className={inputCls} value={goalDate} onChange={e=>setGoalDate(e.target.value)} /></div>
              <button className={btnPrimary}>Crear meta</button>
            </form>
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              {data.goals.map(g=>{ const monthsLeft=g.targetDate?Math.max(1,Math.round((new Date(g.targetDate).getTime()-Date.now())/(1000*60*60*24*30))):null; const need=monthsLeft?Math.ceil((g.targetAmount-g.savedAmount)/monthsLeft):null; return <div key={g.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">{g.name} <span className="text-xs font-normal text-[var(--dim)]">{g.visibility==="shared"?"Compartida":"Privada"}</span></p><p className="font-display text-xl font-extrabold mt-1">{money(g.savedAmount)} <span className="text-sm font-semibold text-[var(--dim)]">de {money(g.targetAmount)} · {g.pct}%</span></p><div className="h-2 bg-[var(--surface2)] rounded-full mt-2"><div className="h-full bg-[var(--green)] rounded-full" style={{width:`${g.pct}%`}} /></div>{g.targetDate && <p className="text-xs text-[var(--dim)] mt-1">Meta {fmtDate(g.targetDate)}{need!==null && need>0?` · faltan ${money(need)}/mes`:""}</p>}<div className="flex gap-2 mt-3"><input aria-label={`Abonar a ${g.name}`} type="number" placeholder="$ Abonar" className={inputCls} value={goalAdd[g.id]||""} onChange={e=>setGoalAdd({...goalAdd,[g.id]:e.target.value})} /><button aria-label={`Abonar a la meta ${g.name}`} className={btnPrimary} onClick={()=>addGoal.mutate({id:g.id,amount:Number(goalAdd[g.id])||0})}>Abonar</button></div><button aria-label={`Eliminar meta ${g.name}`} className="text-xs underline text-[var(--red)] mt-2" onClick={()=>delGoal.mutate(g.id)}>Eliminar</button></div>; })}
              {data.goals.length===0 && <Empty title="Sin metas" body="Cree su primera meta." action={{label:"+ Agregar meta",onClick:()=>focusField("goal-name")}} />}
            </div>
          </section>
        )}

        {effTab==="acuerdos" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
            <div className="space-y-2">
              <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveAg.mutate();}}>
                <h2 className="font-display font-bold">Nueva propuesta</h2>
                <div><Label htmlFor="ag-title">Título del acuerdo</Label><input id="ag-title" aria-label="Título del acuerdo" required className={inputCls} value={agTitle} onChange={e=>setAgTitle(e.target.value)} placeholder="Ej. Toda deuda nueva requiere aviso previo" /></div>
                <div><Label htmlFor="ag-desc">Descripción</Label><textarea id="ag-desc" aria-label="Descripción del acuerdo" className={inputCls} rows={3} value={agDesc} onChange={e=>setAgDesc(e.target.value)} /></div>
                <button className={btnPrimary+" w-full"}>Proponer acuerdo</button>
              </form>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
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
              {data.agreements.map(a=><div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><div className="flex justify-between gap-2"><b className="font-display">{a.title}</b><span className={`text-xs rounded-full px-2.5 py-1 font-bold shrink-0 ${a.status==="approved"?"bg-green-100 text-green-800":a.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{a.status==="approved"?"Aprobado":a.status==="rejected"?"Rechazado":"Propuesta"}</span></div>{a.description && <p className="text-sm text-[var(--dim)] mt-1">{a.description}</p>}<p className="text-xs text-[var(--dim)] mt-2">Votos: {a.votes.length===0?"sin votos":a.votes.map(v=>`${data.profiles.find(p=>p.id===v.profileId)?.name||"Perfil"}: ${v.vote==="approve"?"Sí":"No"}`).join(" · ")}</p><div className="flex gap-2 mt-3"><button aria-label={`Aprobar acuerdo ${a.title}`} className={btnPrimary} disabled={!voteProfile} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"approve"})}>Votar Sí</button><button aria-label={`Rechazar acuerdo ${a.title}`} className={btnGhost} disabled={!voteProfile} onClick={()=>voteAg.mutate({agreementId:a.id,vote:"reject"})}>Votar No</button><button aria-label={`Eliminar acuerdo ${a.title}`} className="text-xs underline text-[var(--red)] ml-auto" onClick={()=>delAg.mutate(a.id)}>Eliminar</button></div>{!voteProfile && <p className="text-xs text-[var(--dim)] mt-1">Seleccione su perfil para votar.</p>}</div>)}
              {data.agreements.length===0 && <Empty title="Sin acuerdos registrados" body="Proponga la primera regla del hogar." />}
            </div>
          </section>
        )}

        {effTab==="patrimonio" && (
          <section>
            <div className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-3.5 flex flex-wrap gap-6">
              <div><p className="text-sm opacity-80">Patrimonio neto</p><p className="font-display text-2xl font-extrabold">{money2(s.netWorth)}</p></div>
              <div><p className="text-sm opacity-80">Activos ({data.patrimony.filter(p=>p.kind==="asset").length})</p><p className="font-display text-xl font-bold">{money2(s.totalAssets)}</p></div>
              <div><p className="text-sm opacity-80">Pasivos ({data.patrimony.filter(p=>p.kind==="liability").length})</p><p className="font-display text-xl font-bold">{money2(s.totalLiabilities)}</p></div>
                          </div>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 grid md:grid-cols-6 gap-2 items-end mt-3" onSubmit={(e:FormEvent)=>{e.preventDefault();savePat.mutate();}}>
              <div><Label htmlFor="pat-name">Nombre</Label><input id="pat-name" aria-label="Nombre de la partida de patrimonio" required className={inputCls} value={patName} onChange={e=>setPatName(e.target.value)} placeholder="Ej. Casa, Auto, Hipoteca" /></div>
              <div><Label htmlFor="pat-kind">Tipo</Label><select id="pat-kind" aria-label="Tipo de partida" className={inputCls} value={patKind} onChange={e=>setPatKind(e.target.value as "asset"|"liability")}><option value="asset">Activo</option><option value="liability">Pasivo</option></select></div>
              <div><Label htmlFor="pat-cat">Categoría</Label><input id="pat-cat" aria-label="Categoría de la partida" className={inputCls} value={patCat} onChange={e=>setPatCat(e.target.value)} placeholder="Inmueble, Vehículo…" /></div>
              <div><Label htmlFor="pat-value">Valor ($)</Label><input id="pat-value" aria-label="Valor de la partida" type="number" min="0" required className={inputCls} value={patValue} onChange={e=>setPatValue(e.target.value)} /></div>
              <div><Label htmlFor="pat-owner">Propietario</Label><input id="pat-owner" aria-label="Propietario de la partida" className={inputCls} value={patOwner} onChange={e=>setPatOwner(e.target.value)} placeholder="Compartido / nombre" /></div>
              <button className={btnPrimary}>Agregar</button>
            </form>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              {(["asset","liability"] as const).map(k=>(
                <div key={k} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><h3 className="font-display font-bold">{k==="asset"?"Activos":"Pasivos"}</h3>
                  {data.patrimony.filter(p=>p.kind===k).map(p=><div key={p.id} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm"><span>{p.name}<span className="block text-xs text-[var(--dim)]">{p.category}{p.owner?` · ${p.owner}`:""}</span></span><span className="text-right"><b>{money2(p.value)}</b><br/><button aria-label={`Eliminar ${p.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>delPat.mutate(p.id)}>Eliminar</button></span></div>)}
                  {data.patrimony.filter(p=>p.kind===k).length===0 && <><p className="text-sm text-[var(--dim)] mt-2">Sin {k==="asset"?"activos":"pasivos"} registrados.</p><button type="button" aria-label="Agregar patrimonio" className={btnPrimary+" mt-2"} onClick={()=>focusField("pat-name")}>+ Agregar patrimonio</button></>}
                  <p className="font-display font-bold mt-2 text-right">Total: {money2(k==="asset"?s.totalAssets:s.totalLiabilities)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {effTab==="categorias" && (
          <section>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 grid md:grid-cols-4 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveCat.mutate();}}>
              <div><Label htmlFor="cat-name">Nueva categoría</Label><input id="cat-name" aria-label="Nombre de la nueva categoría" required className={inputCls} value={catFormName} onChange={e=>setCatFormName(e.target.value)} /></div>
              <div><Label htmlFor="cat-kind">Tipo</Label><select id="cat-kind" aria-label="Tipo de categoría" className={inputCls} value={catKind} onChange={e=>setCatKind(e.target.value as "income"|"expense")}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div>
              <div><Label htmlFor="cat-subs">Subcategorías (coma)</Label><input id="cat-subs" aria-label="Subcategorías separadas por coma" className={inputCls} value={catSubs} onChange={e=>setCatSubs(e.target.value)} placeholder="Súper, Mercado, Tienda" /></div>
              <button className={btnPrimary}>Crear categoría</button>
            </form>
            <div className="mt-3"><Help>Toque la × para quitar una subcategoría.</Help></div>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              {(["income","expense"] as const).map(k=>(
                <div key={k} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><h3 className="font-display font-bold">{k==="income"?`Ingresos (${data.categories.filter(c=>c.kind==="income").length})`:`Gastos (${data.categories.filter(c=>c.kind==="expense").length})`}</h3>
                  {data.categories.filter(c=>c.kind===k).map(c=><div key={c.id} className="py-2.5 border-b border-[var(--border)] last:border-0"><p className="text-sm font-semibold">{c.name} {c.isSystem===1 && <span className="text-[11px] text-[var(--dim)] font-normal">· del sistema</span>}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {c.subcategories.map(sb=><span key={sb} className="inline-flex items-center gap-1 bg-[var(--surface2)] rounded-full pl-2.5 pr-1 py-1 text-xs font-semibold">{sb}<button type="button" aria-label={`Eliminar subcategoría ${sb} de ${c.name}`} className="w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)] leading-none" onClick={()=>removeSub.mutate({categoryId:c.id,name:sb})}>×</button></span>)}
                      {c.subcategories.length===0 && <span className="text-xs text-[var(--dim)]">Sin subcategorías</span>}
                    </div>
                    <div className="flex gap-2 mt-2"><input aria-label={`Nueva subcategoría para ${c.name}`} placeholder="Nueva subcategoría…" className={inputCls} value={newSubByCat[c.id]||""} onChange={e=>setNewSubByCat({...newSubByCat,[c.id]:e.target.value})} /><button type="button" aria-label={`Agregar subcategoría a ${c.name}`} className={btnGhost} disabled={!(newSubByCat[c.id]||"").trim() || addSub.isPending} onClick={()=>addSub.mutate({categoryId:c.id,name:(newSubByCat[c.id]||"").trim()},{onSuccess:()=>setNewSubByCat(p=>({...p,[c.id]:""}))})}>Agregar</button></div>
                  </div>)}
                </div>
              ))}
            </div>
            {(addSub.error || removeSub.error) && <p className="text-sm text-[var(--red)] mt-2">{String(addSub.error || removeSub.error)}</p>}
          </section>
        )}

        {effTab==="perfiles" && (
          <section className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
            <div style={{gridColumn:"1 / -1"}} className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-3 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]"><p className="font-display font-bold">Perfil en uso</p><p className="text-xs opacity-80">Lo que ve en este dispositivo.</p></div>
              <select aria-label="Perfil actual en este dispositivo" className="rounded-xl bg-white text-black px-3 py-2.5 font-semibold" value={me?me.id:""} onChange={e=>pickProfile(Number(e.target.value))}>
                {data.profiles.map(x=><option key={x.id} value={x.id}>{fullName(x)} — {x.role==="admin"?"Administrador":"Integrante"}</option>)}
              </select>
              <span className="text-sm font-bold">{isAdmin?"Ve todo lo compartido.":"Ve lo compartido y sus privados."}</span>
            </div>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveProf.mutate();}}>
              <h2 className="font-display font-bold text-base">Agregar persona</h2>
              <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="prof-name">Nombre</Label><input id="prof-name" aria-label="Nombre de la persona" required className={inputCls} value={profName} onChange={e=>setProfName(e.target.value)} /></div><div><Label htmlFor="prof-last">Apellido</Label><input id="prof-last" aria-label="Apellido de la persona" className={inputCls} value={profLast} onChange={e=>setProfLast(e.target.value)} /></div></div>
              <p className="text-[11px] text-[var(--dim)]">El nombre no se toma del correo.</p>
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
                <div key={p.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex justify-between gap-2">
                  <div className="flex-1"><p className="font-display font-bold">{fullName(p)} <span className="text-xs font-normal bg-[var(--surface2)] rounded-full px-2 py-0.5">{p.kind==="adult"?"Adulto":`Dependiente · ${p.dependentType||""}`}</span> <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${p.role==="admin"?"bg-[var(--gold)] text-white":"bg-[var(--surface2)]"}`}>{p.role==="admin"?"Administrador del hogar":"Integrante"}</span></p>
                  {p.kind==="adult" ? <p className="text-sm text-[var(--dim)]">Ingreso {money(p.monthlyIncome)} · Compromisos {money(p.fixedCommitments)} · <b className="text-[var(--text)]">Capacidad {money(p.capacity)}</b>{p.email?` · ${p.email}`:""}</p> : <p className="text-sm text-[var(--dim)]">No aporta ni vota.</p>}</div>
                  <div className="shrink-0 text-right space-y-1">
                    <button aria-label={`Editar nombre de ${fullName(p)}`} className="text-xs underline block" onClick={()=>{setEditProfId(p.id);setEditProfName(p.name);setEditProfLast(p.lastName||"");}}>Editar nombre</button>
                    {isAdmin && <button aria-label={`Eliminar perfil de ${fullName(p)}`} className="text-xs underline text-[var(--red)] block" onClick={()=>delProf.mutate(p.id)}>Eliminar</button>}
                    {editProfId===p.id && <span className="flex gap-1 mt-1"><input aria-label="Editar nombre" className={inputCls+" w-28"} value={editProfName} onChange={e=>setEditProfName(e.target.value)} /><input aria-label="Editar apellido" className={inputCls+" w-28"} value={editProfLast} onChange={e=>setEditProfLast(e.target.value)} /><button aria-label="Guardar nombre editado" className={btnPrimary} onClick={()=>saveProfEdit.mutate()}>Guardar</button></span>}
                  </div>
                </div>
              ))}
              {data.profiles.length===0 && <Empty title="Sin perfiles" body="Agregue a los adultos del hogar." />}
              <div className="bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl p-3">
                <h3 className="font-display font-bold">Invitaciones al hogar</h3>
                <p className="text-sm text-[var(--dim)] mt-1">Enlace directo, un solo uso, 7 días.</p>
                {isAdmin ? <div className="flex flex-wrap gap-2 mt-3"><input aria-label="Correo del invitado" type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={invEmail2} onChange={e=>setInvEmail2(e.target.value)} /><input aria-label="Nombre del invitado opcional" placeholder="Nombre (opcional, lo confirma él/ella)" className={inputCls+" flex-1 min-w-[160px]"} value={invName2} onChange={e=>setInvName2(e.target.value)} /><button aria-label="Enviar invitación al hogar" className={btnPrimary} onClick={()=>createInv.mutate()} disabled={!invEmail2 || createInv.isPending}>Invitar</button></div> : <p className="text-sm mt-2">Solo el administrador envía invitaciones.</p>}
                {createInv.isSuccess && <p className="text-sm text-[var(--green)] mt-2">{(createInv.data as {reused?:boolean})?.reused?"Se reutilizó la invitación pendiente.":"Invitación pendiente."}</p>}
                {hhInvResult && (
                  <div className="text-sm space-y-2 mt-2">
                    {hhInvResult.emailSent
                      ? <p className="text-[var(--green)]">Correo enviado.</p>
                      : <><p className="text-[var(--red)]">Copie el enlace y envíelo usted:</p><p className="break-all bg-[var(--surface2)] rounded-xl p-2 text-xs">{hhInvResult.inviteUrl}</p><button type="button" className={btnGhost} onClick={()=>copyLink(hhInvResult.inviteUrl)}>{copiedLink===hhInvResult.inviteUrl?"Enlace copiado":"Copiar enlace"}</button></>}
                  </div>
                )}
                {createInv.error && <p className="text-sm text-[var(--red)] mt-2">{String(createInv.error)}</p>}
                <div className="divide-y divide-[var(--border)] mt-2">
                  {data.invitations.map(iv=>(
                    <div key={iv.id} className="py-2.5 text-sm">
                      <div className="flex justify-between gap-2 flex-wrap"><span><b>{iv.email}</b>{iv.invitedName?` · ${iv.invitedName}`:""}</span><span className={`text-xs font-bold rounded-full px-2 py-0.5 ${iv.status==="accepted"?"bg-green-100 text-green-800":iv.status==="rejected"?"bg-red-100 text-red-800":"bg-[var(--surface2)]"}`}>{iv.status==="accepted"?"Aceptada":iv.status==="rejected"?"Rechazada":"Pendiente"}</span></div>
                      {iv.status==="pending" && <div className="mt-2 space-y-2"><div className="grid grid-cols-2 gap-2"><input aria-label={`Nombre de quien acepta ${iv.email}`} placeholder="Su nombre" className={inputCls} value={acceptFirst[iv.id]||iv.invitedName||""} onChange={e=>setAcceptFirst({...acceptFirst,[iv.id]:e.target.value})} /><input aria-label={`Apellido de quien acepta ${iv.email}`} placeholder="Su apellido" className={inputCls} value={acceptLast[iv.id]||""} onChange={e=>setAcceptLast({...acceptLast,[iv.id]:e.target.value})} /></div><div className="flex gap-2 flex-wrap"><button aria-label={`Aceptar invitación de ${iv.email}`} className={btnPrimary} onClick={()=>respondInv2.mutate({id:iv.id,accept:true})}>Aceptar y entrar</button><button aria-label={`Rechazar invitación de ${iv.email}`} className={btnGhost} onClick={()=>respondInv2.mutate({id:iv.id,accept:false})}>Rechazar</button>{isAdmin && <><button aria-label={`Reenviar invitación a ${iv.email}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"household",invitationId:iv.id})}>Reenviar correo</button><button aria-label={`Borrar invitación de ${iv.email}`} className="text-xs underline text-[var(--red)]" onClick={()=>delInv.mutate(iv.id)}>Borrar</button></>}</div></div>}
                    </div>
                  ))}
                  {data.invitations.length===0 && <p className="text-sm text-[var(--dim)] py-2">Sin invitaciones registradas.</p>}
                </div>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><h3 className="font-display font-bold">Fecha de corte del hogar: día {hh.cutoffDay}</h3><p className="text-sm text-[var(--dim)] mt-1">El mes se consulta por calendario; la fecha de corte está en Hogar.</p></div>
            </div>
          </section>
        )}

        
        {effTab==="personal" && (
          <section className="space-y-3">
            <div className="bg-[var(--accent)] text-[var(--accent-text)] rounded-2xl p-3.5">
              <p className="text-sm opacity-80">Restante de su sueldo · {s.currentMonth}</p>
              <p className="font-display text-3xl font-extrabold mt-1">{money2(data.personal.remaining)}</p>
              <p className="text-sm opacity-80 mt-1">Sueldo {money2(data.personal.salary)} − gastado {money2(data.personal.monthSpent)}.</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Sueldo mensual</p><p className="font-display font-bold">{money(data.personal.salary)}</p></div>
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Total gastado</p><p className="font-display font-bold">{money(data.personal.monthSpent)}</p></div>
                <div className="bg-white/10 rounded-2xl py-2"><p className="text-xs opacity-80">Gastos de hoy</p><p className="font-display font-bold">{money(data.personal.todaySpent)}</p></div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3 items-start">
              <div className="space-y-3">
                <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();saveSalary.mutate();}}>
                  <h2 className="font-display font-bold">Su sueldo mensual</h2>
                  <div><Label htmlFor="salary">Sueldo mensual ($)</Label><input id="salary" aria-label="Sueldo mensual personal" type="number" min="0" className={inputCls} placeholder={String(data.personal.salary||"")} value={salaryInput} onChange={e=>setSalaryInput(e.target.value)} /></div>
                  <button className={btnPrimary+" w-full"} disabled={saveSalary.isPending || !salaryInput}>Guardar sueldo</button>
                  {data.personal.salary===0 && <Help>Registre su sueldo para ver su saldo restante.</Help>}
                </form>
                <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault(); if(persStep<3){ if(persStep===1 && !persAmt) return; setPersStep(persStep+1); } else savePersExp.mutate();}}>
                  <h2 className="font-display font-bold">Gasto del día</h2>
                  <p className="text-xs text-[var(--dim)]">Paso {persStep} de 3</p>
                  <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden" aria-hidden="true"><div className="h-full bg-[var(--gold)] rounded-full" style={{width:`${persStep*33.33}%`}} /></div>
                  {persStep===1 && <>
                  <div><Label htmlFor="pers-amt">Importe ($)</Label><input id="pers-amt" aria-label="Importe del gasto del día" type="number" min="0.01" step="0.01" required className={inputCls+" text-xl font-bold py-2"} value={persAmt} onChange={e=>setPersAmt(e.target.value)} /></div>
                  <button type="button" className={btnPrimary+" w-full"} disabled={!persAmt} onClick={()=>setPersStep(2)}>Siguiente</button>
                  </>}
                  {persStep===2 && <>
                  <div><Label htmlFor="pers-cat">Tipo de gasto</Label><select id="pers-cat" aria-label="Tipo de gasto del día" className={inputCls} value={persCat} onChange={e=>setPersCat(e.target.value)}><option value="">Sin categoría</option>{data.categories.filter(c=>c.kind==="expense"&&c.isActive===1).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>setPersStep(1)}>Atrás</button><button type="button" className={btnPrimary+" flex-1"} onClick={()=>setPersStep(3)}>Siguiente</button></div>
                  </>}
                  {persStep===3 && <>
                  <div><Label htmlFor="pers-concept">Concepto del gasto</Label><input id="pers-concept" aria-label="Concepto del gasto del día" className={inputCls} value={persConcept} onChange={e=>setPersConcept(e.target.value)} placeholder="Ej. Alimentos, transporte, café…" /></div>
                  <div>
                    <button type="button" aria-expanded={persMore} aria-label={persMore?"Ocultar más opciones del gasto del día":"Mostrar más opciones del gasto del día"} onClick={()=>setPersMore(o=>!o)} className="w-full text-left text-sm font-bold text-[var(--dim)] border border-[var(--border)] rounded-xl px-3 py-2.5">{persMore?"▾ Ocultar más opciones":"▸ Más opciones: comprobante"}</button>
                    {persMore && (<div className="space-y-2 mt-3">
                  <div><Label htmlFor="pers-receipt">Foto del comprobante (opcional)</Label><input id="pers-receipt" aria-label="Adjuntar foto del comprobante del gasto del día" type="file" accept="image/*" className="w-full text-sm" onChange={e=>{ void pickReceipt(e.target.files?.[0], setPersReceipt); }} />{persReceipt && <img src={persReceipt.preview} alt="Vista previa del comprobante del gasto del día" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)] mt-2" />}<p className="text-[11px] text-[var(--dim)] mt-1">Se guarda como comprobante.</p></div>
                  <div className="border-2 border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
                    <p className="font-display font-bold text-sm">Leer el comprobante</p>
                    <p className="text-[11px] text-[var(--dim)] mt-1">Los gastos se registran solos.</p>
                    <input aria-label="Fotografía del comprobante para lectura automática en Personal" type="file" accept="image/*" className="w-full text-sm mt-2" onChange={e=>{ const f=e.target.files?.[0]; if(f) void imageFileToJpeg(f).then(setScanPersImg).catch(()=>setScanPersImg(null)); e.target.value=""; }} />
                    {scanPersImg && <div className="mt-2 space-y-2"><img src={scanPersImg.preview} alt="Vista previa del comprobante que se leerá en Personal" className="w-full max-h-32 object-contain rounded-xl border border-[var(--border)] bg-white" /><button type="button" aria-label="Leer el comprobante y registrar los gastos del día" className={btnPrimary+" w-full"} disabled={scanRcpt.isPending} onClick={()=>scanRcpt.mutate({img:{dataBase64:scanPersImg.dataBase64,mimeType:scanPersImg.mimeType},visibility:"private"})}>{scanRcpt.isPending?"Leyendo el comprobante…":"Leer comprobante y registrar los gastos"}</button></div>}
                    {scanRcpt.isSuccess && scanRcpt.data && <p className="text-sm text-[var(--green)] mt-2">Se registraron {scanRcpt.data.created} gasto(s) por {money2(scanRcpt.data.totalDetected)}.</p>}
                    {scanRcpt.error && <p className="text-sm text-[var(--red)] mt-2">{String(scanRcpt.error)}</p>}
                  </div>
                    </div>)}
                  </div>
                  <div className="flex gap-2"><button type="button" className={btnGhost+" flex-1"} onClick={()=>setPersStep(2)}>Atrás</button><button className={btnPrimary+" flex-1"} disabled={savePersExp.isPending || !persAmt}>Finalizar</button></div>
                  <p className="text-xs text-[var(--dim)]">Se guarda hoy, en privado.</p>
                  </>}
                </form>
              </div>
              <div className="space-y-3">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                  <h2 className="font-display font-bold">Gasto por categoría</h2>
                  <CategoryChart data={data.personal.byCategory.map(c=>({name:c.name,total:c.total,pct:c.pct}))} />
                  <p className="text-sm mt-3 border-t border-[var(--border)] pt-2">Gastado en el mes: <b>{money2(data.personal.monthSpent)}</b> · Restante: <b>{money2(data.personal.remaining)}</b></p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                  <h2 className="font-display font-bold">Ingresos vs gastos</h2>
                  <MonthlyChart series={s.monthlySeries} />
                  <p className="text-xs text-[var(--dim)]">Últimos 6 meses.</p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                  <h2 className="font-display font-bold">Mis tandas</h2>
                                    {data.tandas.length===0 && <p className="text-sm text-[var(--dim)] mt-2">Aún no tiene tandas.</p>}
                  {data.tandas.map(td=>{
                    const next = td.calendar.find(c=>c.date>=todayISO()) || td.calendar[td.calendar.length-1];
                    const myPend = td.payments.filter(p=>p.status!=="paid").length;
                    const unverified = td.payments.filter(p=>p.status==="paid" && p.verified!==1).length;
                    return <div key={td.id} className="border border-[var(--border)] rounded-2xl p-3 mt-3">
                      <p className="font-display font-bold text-sm">{td.name}</p>
                      <p className="text-xs text-[var(--dim)]">Organiza {td.organizerName||"—"} {td.organizerRating.count>0 && <span>· <Stars value={td.organizerRating.avg} size="text-xs" /> {td.organizerRating.avg} ({td.organizerRating.count})</span>} · {money(td.amountPerQuincena)} cada {td.cadenceDays} días · {td.participants.length}/{td.participantCount} participantes</p>
                      {next && <p className="text-sm mt-1">Siguiente: <b>{next.receiverName?`recibe ${next.receiverName}`:"pendiente de sorteo"}</b> · {fmtDate(next.date)} · {money(next.amount)}</p>}
                      <p className="text-xs text-[var(--dim)]">{unverified>0?`${unverified} comprobante(s) por verificar · `:""}{myPend>0?`${myPend} pago(s) pendientes`:"Sin pendientes"}</p>
                    </div>;
                  })}
                  <button type="button" aria-label="Ir a la pestaña Tandas desde Personal" className={btnPrimary+" mt-3"} onClick={()=>goTab("tandas")}>Ir a Tandas</button>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
                  <h2 className="font-display font-bold">Gastos del día ({data.personal.todayCount})</h2>
                  {data.personal.todayMovements.map(m=>{ const full=data.movements.find(x=>x.id===m.id); return (
                    <div key={m.id} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm"><span className="min-w-0">{m.concept}<span className="block text-xs text-[var(--dim)]">{getCatName(m.categoryId)}</span>{full?.receiptUrl && <button aria-label={`Ver foto del comprobante de ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>setReceiptView(full.receiptUrl)}>Ver comprobante</button>}<button aria-label={`Reversar el gasto ${m.concept}`} className="text-xs underline font-bold block" onClick={()=>{setConfirmReverseId(m.id);setMvFilter("all");setMvSearch("");setMvSubFilter("all");goTab("movimientos");}}>Reversar</button></span><span className="flex items-center gap-2">{full?.receiptUrl && <img src={full.receiptUrl} alt={`Foto del comprobante de ${m.concept}`} className="w-8 h-8 object-cover rounded-lg border border-[var(--border)]" />}<b>−{money2(m.amount)}</b></span></div>
                  ); })}
                  {data.personal.todayMovements.length===0 && <p className="text-sm text-[var(--dim)] mt-2">Hoy no se han registrado gastos.</p>}
                  <p className="text-sm mt-2">Total de hoy: <b>{money2(data.personal.todaySpent)}</b></p>
                </div>
              </div>
            </div>
          </section>
        )}

        {effTab==="tandas" && (
          <section className="space-y-3">
            <div className="bg-amber-50 border-2 border-[var(--gold)] rounded-2xl p-3 text-amber-900">
              <p className="font-display font-bold">Tandas con pagos verificados</p>
              <p className="text-sm mt-1">Cada participante sube su comprobante; el organizador lo verifica.</p>
            </div>
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 grid md:grid-cols-3 gap-2 items-end" onSubmit={(e:FormEvent)=>{e.preventDefault();saveTanda.mutate();}}>
              <div><Label htmlFor="tanda-name">Nombre de la tanda</Label><input id="tanda-name" aria-label="Nombre de la tanda" required className={inputCls} value={tandaName} onChange={e=>setTandaName(e.target.value)} placeholder="Ej. Tanda de la oficina" /></div>
              <div><Label htmlFor="tanda-count">Participantes</Label><input id="tanda-count" aria-label="Número de participantes de la tanda" type="number" min="2" max="30" required className={inputCls} value={tandaCount} onChange={e=>setTandaCount(e.target.value)} /></div>
              <div><Label htmlFor="tanda-amount">Monto por periodo ($)</Label><input id="tanda-amount" aria-label="Monto por periodo de la tanda" type="number" min="1" required className={inputCls} value={tandaAmount} onChange={e=>setTandaAmount(e.target.value)} /></div>
              <div><Label htmlFor="tanda-start">Fecha de inicio</Label><input id="tanda-start" aria-label="Fecha de inicio de la tanda" type="date" required className={inputCls} value={tandaStart} onChange={e=>setTandaStart(e.target.value)} /></div>
              <div><Label htmlFor="tanda-freq">Frecuencia de cobro</Label><select id="tanda-freq" aria-label="Frecuencia de cobro de la tanda" className={inputCls} value={tandaFreq} onChange={e=>setTandaFreq(e.target.value as "semanal"|"quincenal"|"mensual")}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></div>
              <div><Label htmlFor="tanda-drawmode">Sorteo</Label><select id="tanda-drawmode" aria-label="Modo de sorteo de la tanda" className={inputCls} value={tandaDrawMode} onChange={e=>setTandaDrawMode(e.target.value as "random"|"weighted")}><option value="random">Al azar</option><option value="weighted">Por cumplimiento</option></select></div>
              <p className="text-xs text-[var(--dim)] md:col-span-2">Organizador: <b>{me?fullName(me):"usted"}</b>.</p>
              <button className={btnPrimary} disabled={saveTanda.isPending}>Crear tanda</button>
            </form>
            {data.tandas.map(td=>(
              <div key={td.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 space-y-3">
                <div className="flex justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-display font-bold text-base">{td.name}</h3>
                    <p className="text-xs text-[var(--dim)]">{td.participantCount} participantes · {money(td.amountPerQuincena)} por {td.frequency==="semanal"?"semana":td.frequency==="mensual"?"mes":"quincena"} · recaudación cada {td.cadenceDays} días · inicio {fmtDate(td.startDate)} · en cada periodo se entrega el monto total de <b>{money(td.potPerQuincena)}</b></p>
                    <p className="text-sm mt-1.5">Organiza <b>{td.organizerName||"—"}</b> {td.organizerRating.count>0 ? <span><Stars value={td.organizerRating.avg} /> <b>{td.organizerRating.avg} de 5</b> · {td.organizerRating.count} calificación(es) otorgadas por los participantes{td.organizerRating.avg>=4.5 && td.organizerRating.count>=2 ? <> · <span className="bg-[var(--gold)] text-white text-[11px] font-bold rounded-full px-2 py-0.5">RECOMENDADO POR LOS PARTICIPANTES</span></> : ""}</span> : <span className="text-[var(--dim)]">· Aún sin calificaciones.</span>}</p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <button aria-label={`Eliminar tanda ${td.name}`} className={btnGhost} onClick={()=>delTanda.mutate(td.id)}>Eliminar</button>
                  </div>
                </div>
                <div className="bg-[var(--surface2)] rounded-2xl p-3">
                  <h4 className="font-display font-bold text-sm">Sorteo</h4>
                  <div className="flex flex-wrap gap-2 items-center mt-2">
                    <select aria-label={`Modo de sorteo de ${td.name}`} className={inputCls+" w-auto"} value={drawSel[td.id]||td.drawMode} onChange={e=>setDrawSel({...drawSel,[td.id]:e.target.value as "random"|"weighted"})}><option value="random">Al azar</option><option value="weighted">Por cumplimiento</option></select>
                    <button aria-label={`Hacer sorteo de ${td.name}`} className={btnPrimary} onClick={()=>drawTanda.mutate({id:td.id,mode:(drawSel[td.id]||td.drawMode) as "random"|"weighted"})} disabled={td.participants.length<2 || drawTanda.isPending}>Hacer sorteo</button>
                    <span className="text-xs text-[var(--dim)]">Modo guardado: <b>{td.drawMode==="weighted"?"Por cumplimiento":"Al azar"}</b></span>
                  </div>
                  <p className="text-xs text-[var(--dim)] mt-2"><b>Al azar:</b> igual para todos. <b>Por cumplimiento:</b> premia la puntualidad.</p>
                  {drawTanda.error && <p className="text-sm text-[var(--red)] mt-1">{String(drawTanda.error)}</p>}
                </div>
                <div>
                  <h4 className="font-display font-bold text-sm">Participantes ({td.participants.length}/{td.participantCount})</h4>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[...td.participants].sort((a,b)=>(a.drawOrder??999)-(b.drawOrder??999)).map(pt=>(
                      <span key={pt.id} className="bg-[var(--surface2)] rounded-2xl px-3 py-2 text-sm">
                        <b>{pt.drawOrder?`#${pt.drawOrder} · `:""}{pt.name}</b>
                        <span className="block text-xs">{pt.cardLast4?`•••• ${pt.cardLast4} registrada`:"Sin tarjeta registrada"}</span>
                        <span className="block text-xs mt-0.5">Puntaje: <b>{pt.stats.score}/100</b> · {pt.stats.paidCount}/{pt.stats.dueCount} pagos · {pt.stats.onTimePct}% puntuales</span>
                        {!pt.cardLast4 && <span className="flex gap-1 mt-1"><input aria-label={`Últimos 4 dígitos de la tarjeta de ${pt.name}`} maxLength={4} inputMode="numeric" placeholder="Últ. 4 dígitos" className={inputCls+" w-28"} value={cardInput[pt.id]||""} onChange={e=>setCardInput({...cardInput,[pt.id]:e.target.value.replace(/[^0-9]/g,"")})} /><button aria-label={`Registrar tarjeta simulada de ${pt.name}`} className="text-xs underline font-bold" onClick={()=>setCard.mutate({id:pt.id,cardLast4:cardInput[pt.id]||""})}>Registrar</button></span>}
                        <button aria-label={`Quitar a ${pt.name} de ${td.name}`} className="text-xs underline text-[var(--red)] block mt-0.5" onClick={()=>removePart.mutate(pt.id)}>Quitar</button>
                      </span>
                    ))}
                  </div>
                  {setCard.error && <p className="text-sm text-[var(--red)] mt-1">Solo los últimos 4 dígitos.</p>}
                  {td.participants.length<td.participantCount && <div className="flex flex-wrap gap-2 mt-3">
                    <input aria-label={`Nombre del nuevo participante en ${td.name}`} placeholder="Nombre del participante" className={inputCls+" flex-1 min-w-[160px]"} value={partName[td.id]||""} onChange={e=>setPartName({...partName,[td.id]:e.target.value})} />
                    <input aria-label={`Tarjeta simulada últimos 4 dígitos en ${td.name}`} placeholder="Últ. 4 díg. (opcional)" maxLength={4} inputMode="numeric" className={inputCls+" w-44"} value={partCard[td.id]||""} onChange={e=>setPartCard({...partCard,[td.id]:e.target.value.replace(/[^0-9]/g,"")})} />
                    <button aria-label={`Agregar participante a ${td.name}`} className={btnGhost} onClick={()=>addPart.mutate({tandaId:td.id,name:partName[td.id]||"",cardLast4:partCard[td.id]||undefined})} disabled={!partName[td.id]}>Agregar participante</button>
                  </div>}
                  {addPart.error && <p className="text-sm text-[var(--red)] mt-1">{String(addPart.error)}</p>}
                  <div className="border border-dashed border-[var(--gold)] rounded-2xl p-3 mt-3">
                    <p className="text-sm font-bold">Invitar por correo</p>
                    <p className="text-xs text-[var(--dim)] mt-0.5">Enlace directo, un solo uso, 7 días.</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <input aria-label={`Correo para invitar a ${td.name}`} type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={tInvEmail[td.id]||""} onChange={e=>setTInvEmail({...tInvEmail,[td.id]:e.target.value})} />
                      <input aria-label={`Nombre de la persona invitada a ${td.name}`} placeholder="Nombre (opcional)" className={inputCls+" w-44"} value={tInvName[td.id]||""} onChange={e=>setTInvName({...tInvName,[td.id]:e.target.value})} />
                      <button aria-label={`Enviar invitación a la tanda ${td.name}`} className={btnGhost} onClick={()=>createTandaInv.mutate({tandaId:td.id})} disabled={!tInvEmail[td.id] || createTandaInv.isPending}>Invitar a la tanda</button>
                    </div>
                    {createTandaInv.error && <p className="text-sm text-[var(--red)] mt-1">{String(createTandaInv.error)}</p>}
                    {(() => { const tRes = tInvResult[td.id]; if (!tRes) return null; return (
                      <div className="text-sm space-y-2 mt-2">
                        {tRes.emailSent
                          ? <p className="text-[var(--green)]">Correo enviado.</p>
                          : <><p className="text-[var(--red)]">Copie el enlace y envíelo usted:</p><p className="break-all bg-[var(--surface2)] rounded-xl p-2 text-xs">{tRes.inviteUrl}</p><button type="button" className={btnGhost} onClick={()=>copyLink(tRes.inviteUrl)}>{copiedLink===tRes.inviteUrl?"Enlace copiado":"Copiar enlace"}</button></>}
                      </div>
                    ); })()}
                    {td.invitations.filter(iv=>iv.status==="pending").map(iv=>(
                      <div key={iv.id} className="border border-[var(--border)] rounded-2xl p-3 mt-2 space-y-2 bg-[var(--surface)]">
                        <p className="text-sm"><b>Invitación pendiente</b> para {iv.email}{iv.invitedName?` (${iv.invitedName})`:""}.</p>
                        <input aria-label={`Nombre con el que acepta la invitación de ${iv.email}`} placeholder="Nombre con el que participará" className={inputCls} value={tJoinName[iv.id]||iv.invitedName||""} onChange={e=>setTJoinName({...tJoinName,[iv.id]:e.target.value})} />
                        <div className="flex gap-2 flex-wrap">
                          <button aria-label={`Aceptar invitación de ${iv.email} a ${td.name}`} className={btnPrimary} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:true})} disabled={respondTandaInv.isPending}>Aceptar y participar</button>
                          <button aria-label={`Rechazar invitación de ${iv.email} a ${td.name}`} className={btnGhost} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:false})} disabled={respondTandaInv.isPending}>Rechazar</button>
                          <button aria-label={`Reenviar invitación de ${iv.email} a ${td.name}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"tanda",invitationId:iv.id,tandaId:td.id})}>Reenviar correo</button>
                        </div>
                      </div>
                    ))}
                    {respondTandaInv.error && <p className="text-sm text-[var(--red)] mt-1">{String(respondTandaInv.error)}</p>}
                    {td.invitations.filter(iv=>iv.status!=="pending").length>0 && <p className="text-xs text-[var(--dim)] mt-2">{td.invitations.filter(iv=>iv.status==="accepted").length} aceptada(s) · {td.invitations.filter(iv=>iv.status==="rejected").length} rechazada(s).</p>}
                  </div>
                </div>
                <div>
                  <h4 className="font-display font-bold text-sm">Calendario de entregas</h4>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {td.calendar.map(c=>(
                      <div key={c.index} className={`rounded-2xl border p-3 ${c.receiverName?"border-[var(--gold)] bg-[var(--surface2)]":"border-dashed border-[var(--border)]"}`}>
                        <p className="text-xs text-[var(--dim)]">Periodo {c.index+1} · {fmtDate(c.date)}</p>
                        <p className="font-display font-bold">{c.receiverName?`Recibe ${c.receiverName}`:"Pendiente de sorteo"}</p>
                        <p className="text-sm">{money(c.amount)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-display font-bold text-sm">Pagos por participante</h4>
                  <p className="text-xs text-[var(--dim)]">Comprobante verificado por el organizador.</p>
                  <div className="space-y-2 mt-2">
                    {td.calendar.map(c=>{
                      const pendCount = td.participants.filter(pt=> (td.payments.find(pay=>pay.participantId===pt.id&&pay.quincenaIndex===c.index)?.status||"pending")!=="paid").length;
                      const unverified = td.participants.filter(pt=>{ const pay=td.payments.find(pay=>pay.participantId===pt.id&&pay.quincenaIndex===c.index); return pay?.status==="paid" && pay.verified!==1; }).length;
                      return (
                      <div key={c.index} className="border border-[var(--border)] rounded-2xl p-3">
                        <p className="text-sm font-bold">Periodo {c.index+1} · {fmtDate(c.date)} {c.receiverName?`· recibe ${c.receiverName}`:""} · {pendCount===0 && td.participants.length>0 ? (unverified>0 ? `Todos pagaron · ${unverified} pendiente(s) de verificación` : "Todos los pagos están verificados") : `${pendCount} pago(s) pendiente(s)`}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {td.participants.map(pt=>{
                            const pay = td.payments.find(x=>x.participantId===pt.id&&x.quincenaIndex===c.index);
                            const paid = pay?.status==="paid";
                            const verified = paid && pay?.verified===1;
                            return (
                              <span key={pt.id} className={`rounded-2xl px-3 py-2 text-xs font-semibold ${verified?"bg-green-100 text-green-900":paid?"bg-amber-100 text-amber-900":"bg-[var(--surface2)]"}`}>
                                <span className="block">{pt.name}: {verified?`Pago verificado${pay?.paidDate?` · pagó el ${fmtDate(pay.paidDate)}`:""}`:paid?`Pagado, en revisión${pay?.proofUrl?" (con comprobante)":" (sin comprobante)"}${pay?.paidDate?` · ${fmtDate(pay.paidDate)}`:""}`:"Pendiente"}</span>
                                <span className="flex flex-wrap gap-1 mt-1.5">
                                  {pay?.proofUrl && <span className="flex items-center gap-1"><img src={pay.proofUrl} alt={`Comprobante de pago de ${pt.name} periodo ${c.index+1}`} className="w-8 h-8 object-cover rounded-md border border-[var(--border)]" /><button aria-label={`Ver comprobante de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-white rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>setReceiptView(pay.proofUrl)}>Ver comprobante</button></span>}
                                  <label className="bg-white rounded-full px-2 py-1 font-bold border border-[var(--border)] cursor-pointer" aria-label={`Subir comprobante de ${pt.name} periodo ${c.index+1} de ${td.name}`}>{pay?.proofUrl?"Cambiar comprobante":"Subir comprobante"}<input type="file" accept="image/*" className="hidden" aria-label={`Archivo del comprobante de ${pt.name} periodo ${c.index+1}`} onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadProof.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,file:f}); e.target.value=""; }} /></label>
                                  {!verified && <button aria-label={`Verificar y confirmar el pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--green)] text-white rounded-full px-2 py-1 font-bold" onClick={()=>verifyPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,verified:true})}>Verificar pago</button>}
                                  {verified && <button aria-label={`Retirar la verificación del pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-white rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>verifyPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,verified:false})}>Retirar verificación</button>}
                                  <button aria-label={`${paid?"Marcar pendiente":"Marcar pagado sin comprobante"} a ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-white rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>setPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,status:paid?"pending":"paid"})}>{paid?"Marcar pendiente":"Marcar pagado"}</button>
                                  {!paid && <button aria-label={`Enviar recordatorio a ${pt.name} periodo ${c.index+1}`} className="bg-white rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>remindPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index})}>{pay?.reminderSent?"Recordatorio enviado":"Enviar recordatorio"}</button>}
                                </span>
                              </span>
                            );
                          })}
                          {td.participants.length===0 && <span className="text-xs text-[var(--dim)]">Agregue participantes.</span>}
                        </div>
                      </div>
                    );})}
                  </div>
                  {(uploadProof.error || verifyPay.error) && <p className="text-sm text-[var(--red)] mt-1">{String(uploadProof.error || verifyPay.error)}</p>}
                </div>
                <div className="border-t border-[var(--border)] pt-3">
                  <h4 className="font-display font-bold text-sm">Calificación del organizador</h4>
                  <p className="text-xs text-[var(--dim)]">Califique al organizador de 1 a 5.</p>
                  <div className="flex flex-wrap gap-2 mt-2 items-end">
                    <div><Label htmlFor={`rate-name-${td.id}`}>Tu nombre</Label><input id={`rate-name-${td.id}`} aria-label={`Tu nombre para calificar al organizador de ${td.name}`} placeholder="Ej. Participante" className={inputCls+" w-44"} value={rateName[td.id]||""} onChange={e=>setRateName({...rateName,[td.id]:e.target.value})} /></div>
                    <div><Label htmlFor={`rate-stars-${td.id}`}>Calificación de confiabilidad</Label><select id={`rate-stars-${td.id}`} aria-label={`Estrellas para el organizador de ${td.name}`} className={inputCls+" w-auto"} value={rateStars[td.id]||"5"} onChange={e=>setRateStars({...rateStars,[td.id]:e.target.value})}><option value="5">★★★★★ 5 · Muy confiable</option><option value="4">★★★★ 4 · Confiable</option><option value="3">★★★ 3 · Regular</option><option value="2">★★ 2 · Con incidencias</option><option value="1">★ 1 · No cumplió con lo acordado</option></select></div>
                    <div className="flex-1 min-w-[160px]"><Label htmlFor={`rate-comment-${td.id}`}>Comentario (opcional)</Label><input id={`rate-comment-${td.id}`} aria-label={`Comentario sobre el organizador de ${td.name}`} placeholder="Ej. Entregó cada monto en la fecha acordada" className={inputCls} value={rateComment[td.id]||""} onChange={e=>setRateComment({...rateComment,[td.id]:e.target.value})} /></div>
                    <button aria-label={`Enviar calificación al organizador de ${td.name}`} className={btnPrimary} onClick={()=>rateOrg.mutate({tandaId:td.id})} disabled={!rateName[td.id] || rateOrg.isPending}>Calificar</button>
                  </div>
                  {rateOrg.error && <p className="text-sm text-[var(--red)] mt-1">{String(rateOrg.error)}</p>}
                  {td.ratings.length>0 && <div className="mt-2 space-y-1">{td.ratings.map(r=><p key={r.id} className="text-sm"><Stars value={r.stars} size="text-sm" /> <b>{r.raterName}</b>{r.comment?` — “${r.comment}”`:""}</p>)}</div>}
                </div>
              </div>
            ))}
            {data.tandas.length===0 && <Empty title="Sin tandas" body="Cree la primera." />}
          </section>
        )}

        {effTab==="guia" && (
          <section className="space-y-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center gap-2">
              <h2 className="font-display font-bold text-base flex-1 min-w-0">Instalación en el celular</h2>
              <button type="button" className={btnPrimary+" shrink-0"} onClick={handleInstallClick}>Cómo instalar</button>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
              <h2 className="font-display font-bold text-base">Video explicativo (10 segundos)</h2>
              <p className="text-sm text-[var(--dim)] mt-1">Recorrido de 10 segundos.</p>
              <video controls preload="auto" playsInline src={guiaVideo} className="w-full rounded-2xl mt-3 border border-[var(--border)]" aria-label="Video explicativo de SyncFinanzas" />
              <div className="mt-3"><a href={guiaVideo} download="video-explicativo-syncfinanzas.mp4" className={btnGhost} aria-label="Descargar el video explicativo de SyncFinanzas">Descargar el video</a></div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">Gastos del día con comprobante</p><p className="text-sm text-[var(--dim)] mt-1">Suba la foto y los gastos se registran solos.</p><button type="button" aria-label="Ir a Personal para probar la lectura del comprobante" className={btnGhost+" mt-2"} onClick={()=>goTab("personal")}>Probar en Personal</button></div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">Gráficas ingresos vs gastos</p><p className="text-sm text-[var(--dim)] mt-1">Por mes y por categoría.</p><button type="button" aria-label="Ir a Inicio para ver las gráficas" className={btnGhost+" mt-2"} onClick={()=>goTab("inicio")}>Ver gráficas</button></div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3"><p className="font-display font-bold">Tandas</p><p className="text-sm text-[var(--dim)] mt-1">Cree su tanda e invite por correo.</p><button type="button" aria-label="Ir a Tandas desde la guía" className={btnGhost+" mt-2"} onClick={()=>goTab("tandas")}>Ir a Tandas</button></div>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
              <h2 className="font-display font-bold text-base">Guías por segmento</h2>
              <p className="text-sm text-[var(--dim)] mt-1">Una guía por segmento.</p>
              <div className="space-y-3 mt-3">
                {MODULE_GROUPS.map(g=>(
                  <div key={g.title}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] font-bold tracking-wide text-[var(--dim)]">{g.title.toUpperCase()}</p>
                      <button type="button" aria-label={`Leer la guía en PDF del segmento ${g.title}`} className={btnGhost+" shrink-0"} onClick={()=>setGuidePdf({title:g.title,src:GUIDE_PDF_BY_GROUP[g.title]||""})}>Guía en PDF</button>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {g.tabs.map(tid=>{ const t=TABS.find(x=>x.id===tid)!; const desc: Partial<Record<Tab,string>> = { inicio:"Disponible, gráficas y actividad.", personal:"Su sueldo y sus gastos del día.", movimientos:"Registro con filtros y comprobantes.", cuentas:"Cuentas con saldo automático.", presupuestos:"Límites mensuales por categoría.", fondos:"Apartados en sus cuentas.", aportaciones:"Reparto del gasto compartido.", metas:"Ahorro con fecha.", acuerdos:"Votos de gastos mayores.", patrimonio:"Activos, pasivos y neto.", tandas:"Sorteo y comprobantes.", categorias:"Categorías y subcategorías.", perfiles:"Personas del hogar.", hogar:"Nombre, modo y reglas.", guia:"Instalación, video y guías." }; return <div key={tid} className="py-2.5 flex items-start justify-between gap-2"><div><p className="font-semibold text-sm">{t.label}</p><p className="text-[13px] text-[var(--dim)]">{desc[tid]||""}</p></div><button type="button" aria-label={`Abrir el módulo ${t.label} desde la guía`} className={btnGhost+" shrink-0"} onClick={()=>goTab(tid)}>Abrir</button></div>; })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

{effTab==="hogar" && (
          <section className="max-w-2xl space-y-3">
            <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 space-y-3" onSubmit={(e:FormEvent)=>{e.preventDefault();saveHh.mutate();}}>
              <h2 className="font-display font-bold text-base">Hogar y ajustes</h2>
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
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5">
              <h3 className="font-display font-bold">Miembros del hogar ({data.profiles.length})</h3>
              {data.profiles.map(p=><p key={p.id} className="text-sm py-1.5 border-b border-[var(--border)] last:border-0">{fullName(p)} · {p.role==="admin"?"Administrador del hogar":"Integrante"} · {p.kind==="adult"?"Adulto":"Dependiente"}{p.email?` · ${p.email}`:""}</p>)}
              <p className="text-xs text-[var(--dim)] mt-2">Invite en Perfiles → Invitaciones.</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5">
              <h3 className="font-display font-bold">Seguridad de su información</h3>
              <ul className="list-disc ml-5 text-sm space-y-1.5 mt-2 text-[var(--dim)]">
                <li>Contraseña de 12 caracteres; bloqueo 15 min tras 5 intentos.</li>
                <li>Cada registro se valida en el servidor.</li>
                <li>Lo privado solo lo ve su autor.</li>
                <li>Límite de peticiones por minuto.</li>
                <li>Sin claves en el código.</li>
                <li>Cierre de sesión en este dispositivo.</li>
                <li><button type="button" aria-label="Cerrar sesión en este dispositivo" className="rounded-full border px-3 py-2 text-sm font-bold" onClick={()=>{ void supabase.auth.signOut(); }}>Cerrar sesión en este dispositivo</button></li>
              </ul>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5">
              <h3 className="font-display font-bold">Registro de actividad reciente</h3>
              <p className="text-xs text-[var(--dim)] mt-1">Últimas 30.</p>
              {data.activity.length===0 ? <p className="text-sm text-[var(--dim)] mt-2">Aún no hay operaciones registradas.</p> : <div className="divide-y divide-[var(--border)] mt-2">
                {data.activity.map(a=><div key={a.id} className="py-2 text-sm"><p><b>{a.action}</b>{a.detail?` — ${a.detail}`:""}</p><p className="text-xs text-[var(--dim)]">{new Date(a.createdAt).toLocaleString("es-MX",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</p></div>)}
              </div>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5">
              <h3 className="font-display font-bold">Guía rápida</h3>
              <ol className="list-decimal ml-5 text-sm space-y-1.5 mt-2 text-[var(--dim)]">
                <li>Cree sus cuentas en <b>Cuentas</b>, con el saldo actual.</li>
                <li>Agregue a su pareja en <b>Perfiles</b>.</li>
                <li>Registre ingresos y gastos en <b>Movimientos</b>.</li>
                <li>Cree los <b>Presupuestos</b> del mes.</li>
                <li>Aparte en <b>Fondos</b>, defina una <b>Meta</b> y registre su <b>Patrimonio</b>.</li>
              </ol>
            </div>
            <div className="pt-1">
              <button type="button" aria-label="Reiniciar la aplicación y borrar todos los datos" onClick={()=>{ setResetStep(1); setResetWord(""); }} className="text-xs text-[var(--dim)] underline">Reiniciar la aplicación</button>
              {resetStep>0 && (
                <div className="mt-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 space-y-3" role="dialog" aria-label="Confirmación para reiniciar la aplicación">
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
      </main>
      <InstallStepsDialog open={installStepsOpen} onClose={()=>setInstallStepsOpen(false)} />
      <HelpAssistant onGo={goTab} />
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
      {receiptView && <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-3" role="dialog" aria-label="Fotografía del comprobante en tamaño completo">
        <img src={receiptView} alt="Fotografía del comprobante adjunta al gasto, en tamaño completo" className="max-h-[78vh] w-auto rounded-2xl object-contain" />
        <p className="text-white/80 text-xs mt-3">Comprobante del gasto.</p>
        <button aria-label="Cerrar fotografía del comprobante" className="mt-3 bg-white text-black font-bold rounded-full px-6 py-2.5" onClick={()=>setReceiptView(null)}>Cerrar</button>
      </div>}
    </div>
  );
}
