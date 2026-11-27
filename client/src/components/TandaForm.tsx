import { useEffect, useState, type FormEvent } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { isoToDMY, parseDMYToISO } from "../lib/format";

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
//
// Detalles 2026-11-27 (verificados en pantalla, 9e6ed0c):
// - La fecha de inicio se teclea directa en dd/mm/aaaa: el input nativo
//   type="date" no aceptaba teclear «01/12/2026» ni el llenado normal.
//   El texto vive local (no borra el tecleo parcial) y solo una fecha
//   completa y válida actualiza el estado en ISO; una inválida vuelve a
//   la fecha válida al salir del campo.
// - El envío lee el formulario tal como se ve en pantalla (campos por
//   nombre): un llenado que no disparó el evento de React (autollenado)
//   igual se guarda con lo que el usuario ve, en lugar de mandar el
//   estado viejo.

export type TandaFrequency = "semanal" | "quincenal" | "mensual";
export type TandaKind = "ordinaria" | "compartamos";
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
  kind: TandaKind;
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
  const [startText, setStartText] = useState(() => isoToDMY(v.start));
  useEffect(() => {
    if (parseDMYToISO(startText) !== v.start) setStartText(isoToDMY(v.start));
    // Solo interesa el cambio externo (p. ej. limpieza tras crear); el
    // tecleo parcial no se toca mientras no sea una fecha válida distinta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.start]);
  const onStartChange = (raw: string) => {
    setStartText(raw);
    const iso = parseDMYToISO(raw);
    if (iso) set({ start: iso });
  };
  const onStartBlur = () => {
    if (!parseDMYToISO(startText)) setStartText(isoToDMY(v.start));
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // El envío lee el formulario tal como se ve en pantalla (los campos
    // por nombre): un llenado que no disparó el evento de React
    // (autollenado) igual se guarda con lo que el usuario ve, en lugar
    // de mandar el estado viejo. La fecha se toma del texto tecleado.
    const form = e.currentTarget;
    const s = (k: string, fallback: string) => {
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
      return el ? el.value : fallback;
    };
    p.onSubmit({
      name: s("name", v.name),
      count: s("count", v.count),
      amount: s("amount", v.amount),
      start: parseDMYToISO(s("start", "")) ?? v.start,
      freq: s("freq", v.freq) as TandaFrequency,
      drawMode: s("drawMode", v.drawMode) as TandaDrawMode,
      coverage: s("coverage", v.coverage) as TandaCoverage,
      fine: s("fine", v.fine),
      meeting: s("meeting", v.meeting),
      treasurer: s("treasurer", v.treasurer),
      substitute: s("substitute", v.substitute),
      kind: s("kind", v.kind) as TandaKind,
    });
  };
  return (
    <form className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 grid md:grid-cols-3 gap-2 items-end" onSubmit={onSubmit}>
      <div><Label htmlFor="tanda-name">Nombre de la tanda</Label><input id="tanda-name" name="name" aria-label="Nombre de la tanda" required className={inputCls} value={v.name} onChange={e => set({ name: e.target.value })} placeholder="Ej. Tanda de la oficina" /></div>
      <div><Label htmlFor="tanda-count">Participantes</Label><input id="tanda-count" name="count" aria-label="Número de participantes de la tanda" type="number" min="2" max="30" required className={inputCls} value={v.count} onChange={e => set({ count: e.target.value })} /></div>
      <div><Label htmlFor="tanda-amount">Monto por periodo ($)</Label><input id="tanda-amount" name="amount" aria-label="Monto por periodo de la tanda" type="number" min="1" required className={inputCls} value={v.amount} onChange={e => set({ amount: e.target.value })} /></div>
      <div><Label htmlFor="tanda-start">Fecha de inicio</Label><input id="tanda-start" name="start" aria-label="Fecha de inicio de la tanda" type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" required className={inputCls} value={startText} onChange={e => onStartChange(e.target.value)} onBlur={onStartBlur} /></div>
      <div><Label htmlFor="tanda-freq">Frecuencia de cobro</Label><select id="tanda-freq" name="freq" aria-label="Frecuencia de cobro de la tanda" className={inputCls} value={v.freq} onChange={e => set({ freq: e.target.value as TandaFrequency })}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></div>
      <div><Label htmlFor="tanda-drawmode">Sorteo</Label><select id="tanda-drawmode" name="drawMode" aria-label="Modo de sorteo de la tanda" className={inputCls} value={v.drawMode} onChange={e => set({ drawMode: e.target.value as TandaDrawMode })}><option value="random">Al azar</option><option value="weighted">Por cumplimiento</option></select></div>
      <CollapsibleCard
        asSection
        className="md:col-span-3"
        title={<h3 className="font-display font-bold text-sm">Opciones de grupo (Compartamos)</h3>}
        toggleLabel="opciones de grupo"
      >
        <div className="grid md:grid-cols-3 gap-2 items-end mt-2">
          <div><Label htmlFor="tanda-kind">Tipo de tanda</Label><select id="tanda-kind" name="kind" aria-label="Tipo de tanda" className={inputCls} value={v.kind} onChange={e => set({ kind: e.target.value as TandaKind })}><option value="ordinaria">Ordinaria (sin multas)</option><option value="compartamos">Compartamos (grupo formal, con multas)</option></select></div>
          <div><Label htmlFor="tanda-coverage">Si alguien no paga</Label><select id="tanda-coverage" name="coverage" aria-label="Regla si alguien no paga en la tanda" className={inputCls} value={v.coverage} onChange={e => set({ coverage: e.target.value as TandaCoverage })}><option value="fondo">Fondo solidario</option><option value="prorroga">Prórroga</option><option value="reparto">Reparto entre los demás</option></select></div>
          <div><Label htmlFor="tanda-fine">Multa por retardo o falta ($)</Label><input id="tanda-fine" name="fine" aria-label="Multa por retardo o falta en la tanda" type="number" min="0" className={inputCls} value={v.fine} onChange={e => set({ fine: e.target.value })} placeholder="0 = sin multa" /></div>
          <div><Label htmlFor="tanda-meeting">Día fijo de reunión</Label><select id="tanda-meeting" name="meeting" aria-label="Día fijo de reunión de la tanda" className={inputCls} value={v.meeting} onChange={e => set({ meeting: e.target.value })}><option value="">Sin día fijo</option><option value="lunes">Lunes</option><option value="martes">Martes</option><option value="miércoles">Miércoles</option><option value="jueves">Jueves</option><option value="viernes">Viernes</option><option value="sábado">Sábado</option><option value="domingo">Domingo</option></select></div>
          <div><Label htmlFor="tanda-treasurer">Tesorero (administra los fondos)</Label><select id="tanda-treasurer" name="treasurer" aria-label="Tesorero de la tanda" className={inputCls} value={v.treasurer} onChange={e => set({ treasurer: e.target.value })}><option value="">Sin tesorero</option>{p.adultProfiles.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></div>
          <div><Label htmlFor="tanda-substitute">Suplente</Label><select id="tanda-substitute" name="substitute" aria-label="Suplente de la tanda" className={inputCls} value={v.substitute} onChange={e => set({ substitute: e.target.value })}><option value="">Sin suplente</option>{p.adultProfiles.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></div>
        </div>
      </CollapsibleCard>
      <p className="text-xs text-[var(--dim)] md:col-span-2">Organizador: <b>{p.organizerName}</b>. Sin intereses: la tanda es ahorro entre conocidos.</p>
      <button className={btnPrimary} disabled={p.pending}>Crear tanda</button>
    </form>
  );
}
