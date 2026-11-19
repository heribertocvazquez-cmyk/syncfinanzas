// Cola de evaluación de opiniones de testers (módulo Desarrollador, solo el
// dueño de la app): cada opinión lleva su estado —Por revisar, Ya existe,
// Error confirmado, Mejora aprobada, Descartado— y la respuesta que ve el
// tester al consultar con su correo. Nada se construye desde aquí: el estado
// es solo la evaluación; la decisión de construir se toma aparte.
import { useEffect, useRef, useState } from "react";
import { Stars, Label, inputCls, btnPrimary } from "../lib/uiShared";
import { CollapsibleCard } from "./CollapsibleCard";
import {
  FEEDBACK_STATES,
  FEEDBACK_STATE_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackState,
  type FeedbackType,
} from "../lib/feedback";

export type FeedbackReviewItem = {
  id: number;
  createdAt: string;
  nombre: string | null;
  correo: string | null;
  calificacionGeneral: number | null;
  facilidadUso: number | null;
  queFunciono: string | null;
  queFallo: string | null;
  sugerencia: string | null;
  modulo: string | null;
  dispositivo: string | null;
  tipo: string | null;
  descripcion: string | null;
  estado: string;
  respuesta: string | null;
};

export function FeedbackReviewRow(p: {
  f: FeedbackReviewItem;
  busy: boolean;
  onSave: (v: { id: number; estado: FeedbackState; respuesta: string | null }) => void;
}) {
  const { f } = p;
  const [estado, setEstado] = useState<FeedbackState>((f.estado as FeedbackState) || "por_revisar");
  const [respuesta, setRespuesta] = useState(f.respuesta ?? "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setEstado((f.estado as FeedbackState) || "por_revisar");
    setRespuesta(f.respuesta ?? "");
    setDirty(false);
  }, [f.estado, f.respuesta]);
  const estadoValido = (FEEDBACK_STATES as readonly string[]).includes(estado);
  return (
    <div className="py-2.5 text-sm">
      <div className="flex justify-between gap-2">
        <b>{f.nombre || "Tester"}</b>
        <span className="text-xs text-[var(--dim)] shrink-0">{f.createdAt.slice(0, 10)}</span>
      </div>
      <p className="mt-0.5">
        <span className="font-bold">{f.tipo ? FEEDBACK_TYPE_LABELS[f.tipo as FeedbackType] ?? "Opinión" : "Opinión"}</span>
        {" · "}
        <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-[var(--surface2)] border border-[var(--border)]">{FEEDBACK_STATE_LABELS[(estado as FeedbackState)] ?? estado}</span>
      </p>
      {f.calificacionGeneral != null && (
        <p className="mt-0.5">
          <Stars value={f.calificacionGeneral} />{" "}
          <span className="text-xs text-[var(--dim)]">General{f.facilidadUso != null ? ` · Facilidad ${f.facilidadUso}/5` : ""}</span>
        </p>
      )}
      <p className="text-xs text-[var(--dim)]">
        {f.modulo || "Sin módulo"} · {f.dispositivo || "Sin dispositivo"}
        {f.correo ? ` · ${f.correo}` : ""}
      </p>
      {f.descripcion ? (
        <p className="mt-1">{f.descripcion}</p>
      ) : (
        <>
          {f.queFunciono && <p className="mt-1"><b>Funcionó:</b> {f.queFunciono}</p>}
          {f.queFallo && <p><b>Falló:</b> {f.queFallo}</p>}
          {f.sugerencia && <p><b>Sugerencia:</b> {f.sugerencia}</p>}
        </>
      )}
      <div className="mt-2 space-y-2">
        <div>
          <Label htmlFor={`fb-estado-${f.id}`}>Estado de la evaluación</Label>
          <select
            id={`fb-estado-${f.id}`}
            aria-label={`Estado de la evaluación de la opinión de ${f.nombre || "Tester"}`}
            className={inputCls}
            value={estadoValido ? estado : "por_revisar"}
            onChange={(e) => { setEstado(e.target.value as FeedbackState); setDirty(true); }}
          >
            {FEEDBACK_STATES.map((s) => (
              <option key={s} value={s}>{FEEDBACK_STATE_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`fb-respuesta-${f.id}`}>Respuesta al tester (la ve al consultar con su correo)</Label>
          <textarea
            id={`fb-respuesta-${f.id}`}
            aria-label={`Respuesta al tester ${f.nombre || ""}`}
            className={inputCls + " min-h-[64px]"}
            value={respuesta}
            onChange={(e) => { setRespuesta(e.target.value); setDirty(true); }}
            placeholder="Ej. Ya existe: está en Tandas → Pagos por participante → Subir comprobante."
          />
        </div>
        <button
          type="button"
          className={btnPrimary}
          disabled={p.busy || !dirty}
          onClick={() => { p.onSave({ id: f.id, estado, respuesta: respuesta.trim() || null }); setDirty(false); }}
        >
          {p.busy ? "Guardando…" : "Guardar evaluación"}
        </button>
      </div>
    </div>
  );
}

/** Cola de opiniones agrupada: Pendientes (por_revisar) y Revisados (todo
 *  lo demás). Al guardar una evaluación, la opinión cambia de estado y se
 *  mueve sola de grupo al recargar la lista. Cada grupo muestra su conteo. */
export function FeedbackReviewList(p: {
  items: FeedbackReviewItem[];
  busy: boolean;
  onSave: (v: { id: number; estado: FeedbackState; respuesta: string | null }) => void;
  /** Se llama una vez al abrir la cola (al montarse la lista). */
  onOpen?: () => void;
}) {
  // Al abrir la cola de evaluación, los avisos de opiniones nuevas ya no
  // deben aparecer en la campanilla: el dueño entró a revisarlos. La lista
  // solo se monta cuando la tarjeta «Opiniones de testers» está abierta
  // (CollapsibleCard no pinta los hijos plegados), así que el montaje es
  // la apertura; al cerrar y volver a abrir se monta de nuevo y se vuelve
  // a avisar (la marca en el servidor es idempotente).
  const openedRef = useRef(false);
  const onOpenRef = useRef(p.onOpen);
  onOpenRef.current = p.onOpen;
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    onOpenRef.current?.();
  }, []);
  const pendientes = p.items.filter((f) => (f.estado || "por_revisar") === "por_revisar");
  const revisados = p.items.filter((f) => (f.estado || "por_revisar") !== "por_revisar");
  return (
    <div className="mt-2 space-y-2">
      <CollapsibleCard
        asSection
        defaultOpen
        toggleLabel="las opiniones pendientes"
        title={<span className="font-display font-bold">Pendientes ({pendientes.length})</span>}
      >
        {pendientes.length === 0 ? (
          <p className="text-sm text-[var(--dim)] py-2">Sin opiniones pendientes.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {pendientes.map((f) => (
              <FeedbackReviewRow key={f.id} f={f} busy={p.busy} onSave={p.onSave} />
            ))}
          </div>
        )}
      </CollapsibleCard>
      <CollapsibleCard
        asSection
        toggleLabel="las opiniones revisadas"
        title={<span className="font-display font-bold">Revisados ({revisados.length})</span>}
      >
        {revisados.length === 0 ? (
          <p className="text-sm text-[var(--dim)] py-2">Sin opiniones revisadas.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {revisados.map((f) => (
              <FeedbackReviewRow key={f.id} f={f} busy={p.busy} onSave={p.onSave} />
            ))}
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}
