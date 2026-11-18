import type { FormEvent } from "react";
import { CollapsibleCard } from "./CollapsibleCard";

// Formulario de creación de tanda (decisión de Heriberto 2026-11-18,
// opción C «Sencilla con avanzado opcional»): por defecto solo se ve el
// perfil sencillo — nombre, participantes, monto por periodo, fecha de
// inicio, frecuencia de cobro, sorteo y el botón Crear tanda. Los campos
// de grupo formal (si alguien no paga, multa, día fijo de reunión,
// tesorero, suplente) viven dentro de «Opciones de grupo (Compartamos)»,
// que empieza CERRADA (patrón plegable existente, CollapsibleCard
// asSection, como las secciones dentro de una tanda). No se elimina ni se
// agrega ningún campo: solo se reagrupa. El aviso «Tandas con pagos
// verificados» queda fuera, en el módulo, y aplica a las dos. Las tandas
// que ya existen no cambian: el guardado sigue mandando todos los valores,
// con los de grupo en sus valores por defecto cuando no se abre la
// sección.

export type TandaFrequency = "semanal" | "quincenal" | "mensual";
export type TandaDrawMode = "random" | "weighted";
export type TandaCoverage = "fondo" | "prorroga" | "reparto";

export type TandaFormValues = {
  name: string;
  count: string;
  amount: string;
  start: string;
  freq: TandaFrequency;
  drawMode: TandaDrawMode;
  coverage: TandaCoverage;
  fine: string;
  meeting: string;
  treasurer: string;
  substitute: string;
};

export type TandaAdultProfile = { id: number; name: string };

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">{children}</label>;
}
const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

export function TandaForm(p: {
  values: TandaFormValues;
  onChange: (patch: Partial<TandaFormValues>) => void;
  onSubmit: (values: TandaFormValues) => void;
  pending: boolean;
  organizerName: string;
  adultProfiles: TandaAdultProfile[];
}) {
  const v = p.values;
  const set = p.onChange;
  return (
    <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-3 gap-2 items-end" onSubmit={(e: FormEvent) => { e.preventDefault(); p.onSubmit(v); }}>
      <div><Label htmlFor="tanda-name">Nombre de la tanda</Label><input id="tanda-name" aria-label="Nombre de la tanda" required className={inputCls} value={v.name} onChange={e => set({ name: e.target.value })} placeholder="Ej. Tanda de la oficina" /></div>
      <div><Label htmlFor="tanda-count">Participantes</Label><input id="tanda-count" aria-label="Número de participantes de la tanda" type="number" min="2" max="30" required className={inputCls} value={v.count} onChange={e => set({ count: e.target.value })} /></div>
      <div><Label htmlFor="tanda-amount">Monto por periodo ($)</Label><input id="tanda-amount" aria-label="Monto por periodo de la tanda" type="number" min="1" required className={inputCls} value={v.amount} onChange={e => set({ amount: e.target.value })} /></div>
      <div><Label htmlFor="tanda-start">Fecha de inicio</Label><input id="tanda-start" aria-label="Fecha de inicio de la tanda" type="date" required className={inputCls} value={v.start} onChange={e => set({ start: e.target.value })} /></div>
      <div><Label htmlFor="tanda-freq">Frecuencia de cobro</Label><select id="tanda-freq" aria-label="Frecuencia de cobro de la tanda" className={inputCls} value={v.freq} onChange={e => set({ freq: e.target.value as TandaFrequency })}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></div>
      <div><Label htmlFor="tanda-drawmode">Sorteo</Label><select id="tanda-drawmode" aria-label="Modo de sorteo de la tanda" className={inputCls} value={v.drawMode} onChange={e => set({ drawMode: e.target.value as TandaDrawMode })}><option value="random">Al azar</option><option value="weighted">Por cumplimiento</option></select></div>
      <CollapsibleCard
        asSection
        className="md:col-span-3"
        title={<h3 className="font-display font-bold text-sm">Opciones de grupo (Compartamos)</h3>}
        toggleLabel="opciones de grupo"
      >
        <div className="grid md:grid-cols-3 gap-2 items-end mt-2">
          <div><Label htmlFor="tanda-coverage">Si alguien no paga</Label><select id="tanda-coverage" aria-label="Regla si alguien no paga en la tanda" className={inputCls} value={v.coverage} onChange={e => set({ coverage: e.target.value as TandaCoverage })}><option value="fondo">Fondo solidario</option><option value="prorroga">Prórroga</option><option value="reparto">Reparto entre los demás</option></select></div>
          <div><Label htmlFor="tanda-fine">Multa por retardo o falta ($)</Label><input id="tanda-fine" aria-label="Multa por retardo o falta en la tanda" type="number" min="0" className={inputCls} value={v.fine} onChange={e => set({ fine: e.target.value })} placeholder="0 = sin multa" /></div>
          <div><Label htmlFor="tanda-meeting">Día fijo de reunión</Label><select id="tanda-meeting" aria-label="Día fijo de reunión de la tanda" className={inputCls} value={v.meeting} onChange={e => set({ meeting: e.target.value })}><option value="">Sin día fijo</option><option value="lunes">Lunes</option><option value="martes">Martes</option><option value="miércoles">Miércoles</option><option value="jueves">Jueves</option><option value="viernes">Viernes</option><option value="sábado">Sábado</option><option value="domingo">Domingo</option></select></div>
          <div><Label htmlFor="tanda-treasurer">Tesorero (administra los fondos)</Label><select id="tanda-treasurer" aria-label="Tesorero de la tanda" className={inputCls} value={v.treasurer} onChange={e => set({ treasurer: e.target.value })}><option value="">Sin tesorero</option>{p.adultProfiles.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></div>
          <div><Label htmlFor="tanda-substitute">Suplente</Label><select id="tanda-substitute" aria-label="Suplente de la tanda" className={inputCls} value={v.substitute} onChange={e => set({ substitute: e.target.value })}><option value="">Sin suplente</option>{p.adultProfiles.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></div>
        </div>
      </CollapsibleCard>
      <p className="text-xs text-[var(--dim)] md:col-span-2">Organizador: <b>{p.organizerName}</b>. Sin intereses: la tanda es ahorro entre conocidos.</p>
      <button className={btnPrimary} disabled={p.pending}>Crear tanda</button>
    </form>
  );
}
