// Gráficas de la app (dona de gasto por categoría y barras de ingresos
// contra gastos). Este módulo importa Recharts y se carga bajo demanda
// desde App.tsx con React.lazy, para que el paquete inicial no lo traiga:
// las únicas vistas que usan gráficas son Inicio y Personal («Ver
// gráficas» solo navega a Inicio; el detalle de movimientos y
// Presupuestos no dibujan gráficas).
import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, XAxis, YAxis } from "recharts";
import { money2 } from "../lib/format";

const DONUT_COLORS=["#00C2B5","#A34A6B","#2E86AB","#D97A3D","#7C5CBF","#C9A227","#4A9B8E","#5B7FA6","#8A6D3B","#3E7CB1"];

export type CatSlice = {categoryId:number|null;name:string;total:number;pct:number};
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
// Color de la etiqueta de la dona (icono + %) según la luminancia del
// relleno: oscuro #13262E sobre rellenos claros (turquesa, terracota,
// dorado, jade) y blanco sobre oscuros (ciruela, azules, violeta,
// bronce). Medido en contraste-marfil.py: todos ≥4.5:1 salvo los tres
// azules (4.11–4.45:1), que llevan un contorno oscuro fino en el texto
// para leerse sobre el relleno. La paleta aprobada no se oscurece: el
// relleno es lo que vio Heriberto en la vista previa.
export function donutLabelColor(fill: string): string {
  const light = new Set(["#00C2B5", "#D97A3D", "#C9A227", "#4A9B8E"]);
  return light.has(fill.toUpperCase()) ? "#13262E" : "#FFFFFF";
}
// Etiqueta de la dona: el símbolo del rubro y su % del gasto del mes en
// UNA sola línea, al mismo nivel (el % a la derecha del símbolo, sin
// texto extra). Solo segmentos ≥ minPct (en Inicio 10%). El grupo se
// centra al 62% del grosor del anillo: con el anillo más grueso
// (innerRadius 58%) el grupo queda dentro del segmento sin tocar el
// total del centro (el grupo mide ~29 px de ancho y su borde interior
// queda a ~70 px del centro; el total del centro mide ~120 px de ancho,
// mitad 60 px).
export function renderDonutLabel(p: any, minPct = 0, colors: string[] = DONUT_COLORS) {
  const datum = (p.payload ?? {}) as Partial<CatSlice>;
  const name = datum.name ?? p.name ?? "";
  const pct = typeof datum.pct === "number" ? datum.pct : (typeof p.percent === "number" ? p.percent * 100 : 0);
  // En Inicio las etiquetas solo van en segmentos grandes (≥10%).
  if (pct < minPct) return null;
  const RADIAN = Math.PI / 180;
  const inner = Number(p.innerRadius);
  const outer = Number(p.outerRadius);
  const radius = inner + (outer - inner) * 0.62;
  const x = Number(p.cx) + radius * Math.cos(-Number(p.midAngle) * RADIAN);
  const y = Number(p.cy) + radius * Math.sin(-Number(p.midAngle) * RADIAN);
  const fill = (typeof p.fill === "string" && p.fill) || colors[Number(p.index ?? 0) % colors.length] || DONUT_COLORS[0];
  const ink = donutLabelColor(fill);
  // La sombra (drop-shadow del icono y contorno oscuro del %) solo va en
  // las etiquetas BLANCAS: sobre rellenos claros el halo oscuro ayuda a
  // leer, pero sobre el aqua/terracota/dorado/jade la tinta ya es oscura
  // (#13262E) y el halo embarra el glifo. Las oscuras van limpias.
  const halo = ink === "#FFFFFF";
  const iconSize = 9;
  const gap = 2;
  const pctText = `${Math.round(pct)}%`;
  const textW = pctText.length * 6;
  const totalW = iconSize + gap + textW;
  return <g transform={`translate(${x - totalW / 2}, ${y - iconSize / 2})`} pointerEvents="none">
    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={halo ? {filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.35))"} : undefined} aria-hidden="true">{CAT_DONUT_ICONS[name] ?? CAT_DONUT_ICON_DEFAULT}</svg>
    <text x={iconSize + gap} y={iconSize / 2} dominantBaseline="central" fontSize={10} fontWeight={700} fill={ink} paintOrder={halo ? "stroke" : undefined} stroke={halo ? "rgba(0,0,0,0.35)" : undefined} strokeWidth={halo ? 2 : undefined}>{pctText}</text>
  </g>;
}
// Gráfica de dona de gasto por categoría. Opción 4 («solo el rubro
// tocado»): sin leyenda fija, cada segmento lleva dentro su símbolo y su
// % del gasto del mes en una línea. Al tocar un segmento queda marcado (más brillante, un poco
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
// (etiquetas —símbolo + %— solo en segmentos grandes).
export function CategoryChart({data, onSelect, detailOpen, palette, large, reserveLine, minIconPct}:{data:CatSlice[]; onSelect:(d:CatSlice)=>void; detailOpen:boolean; palette?:string[]; large?:boolean; reserveLine?:boolean; minIconPct?:number}){
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
          <Pie data={data} dataKey="total" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="var(--surface)" isAnimationActive={false} onClick={(d)=>{ handleSelect(d as unknown as CatSlice); }} style={{cursor:"pointer"}} label={(p:any)=>renderDonutLabel(p, minIconPct ?? 0, colors)} labelLine={false} activeIndex={activeIdx < 0 ? undefined : activeIdx} activeShape={(props: any)=><Sector {...props} outerRadius={Number(props.outerRadius) + 6} />}>
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
export function MonthlyChart({series,currentMonth,todayMonth,onSelect,inicio}:{series:{month:string;label:string;income:number;expense:number}[];currentMonth:string;todayMonth:string;onSelect:(kind:"income"|"expense",month:string,label:string)=>void;inicio?:boolean}){
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
        <Legend content={()=> inicio ? (<div className="flex justify-center gap-4 text-xs mt-1"><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--green)]" />Ingresos</span><span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--red)]" />Gastos</span></div>) : (<div className="flex justify-center gap-4 text-xs mt-1"><button type="button" aria-label={`Ver de dónde vienen los ingresos de ${curMonth?curMonth.label:"el mes"}`} className="inline-flex items-center gap-1 underline" onClick={()=>{ if(curMonth) onSelect("income",curMonth.month,curMonth.label); }}><span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--green)]" />Ingresos</button><button type="button" aria-label={`Ver de dónde salieron los gastos de ${curMonth?curMonth.label:"el mes"}`} className="inline-flex items-center gap-1 underline" onClick={()=>{ if(curMonth) onSelect("expense",curMonth.month,curMonth.label); }}><span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--red)]" />Gastos</button></div>)} />
        <Bar dataKey="Ingresos" fill="var(--green)" radius={[6,6,0,0]} maxBarSize={26} style={{cursor:"pointer"}} onClick={(d:any)=>{ const p=d?.payload ?? d; if(p?.month) onSelect("income",p.month,p.label); }}>
          {inicio && data.map((d,i)=><Cell key={i} fill="var(--green)" fillOpacity={isEmptyMonth(d)?0.4:1} />)}
        </Bar>
        <Bar dataKey="Gastos" fill="var(--red)" radius={[6,6,0,0]} maxBarSize={26} style={{cursor:"pointer"}} onClick={(d:any)=>{ const p=d?.payload ?? d; if(p?.month) onSelect("expense",p.month,p.label); }}>
          {inicio && data.map((d,i)=><Cell key={i} fill="var(--red)" fillOpacity={isEmptyMonth(d)?0.4:1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
