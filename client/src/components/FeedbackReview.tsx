// Cola de evaluación de opiniones de testers (módulo Desarrollador, solo el
// dueño de la app): cada opinión lleva su estado —Por revisar, Ya existe,
// Error confirmado, Mejora aprobada, Descartado— y la respuesta que ve el
// tester al consultar con su correo. Nada se construye desde aquí: el estado
// es solo la evaluación; la decisión de construir se toma aparte.
import { useEffect, useState } from "react";
import { Stars, Label, inputCls, btnPrimary } from "../lib/uiShared";
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
