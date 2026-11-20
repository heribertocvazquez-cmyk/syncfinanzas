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
  /** Mensaje de error del último guardado de ESTA fila (null si no falló
   *  o no se ha intentado). Lo pone App.tsx desde la mutación. */
  saveError?: string | null;
}) {
  const { f } = p;
  const [estado, setEstado] = useState<FeedbackState>((f.estado as FeedbackState) || "por_revisar");
  const [respuesta, setRespuesta] = useState(f.respuesta ?? "");
  const [dirty, setDirty] = useState(false);
  // Aviso de «seguirá en Pendientes» del guardado que se acaba de hacer
  // con respuesta escrita y estado todavía en Por revisar: se muestra en
  // cuanto se pulsa Guardar y se limpia al recargar la lista, donde ya lo
  // cubre el aviso derivado de los datos guardados.
  const [justSavedPending, setJustSavedPending] = useState(false);
  useEffect(() => {
    setEstado((f.estado as FeedbackState) || "por_revisar");
    setRespuesta(f.respuesta ?? "");
    setDirty(false);
    setJustSavedPending(false);
  }, [f.estado, f.respuesta]);
  // Si el guardado falló, el botón debe seguir habilitado para reintentar
  // sin tener que editar de nuevo: el onClick apaga dirty al disparar la
  // mutación y aquí se vuelve a encender al llegar el error.
  useEffect(() => {
    if (p.saveError) setDirty(true);
  }, [p.saveError]);
  // Advertencia de Pendientes: una respuesta guardada (o que se acaba de
  // guardar) con el estado todavía en Por revisar NO mueve la fila de
  // grupo — la fila seguirá en Pendientes hasta que se cambie el estado.
  // El estado nunca se cambia solo; lo decide el dueño. Mientras el
  // borrador difiere de lo guardado (p. ej. ya se eligió otro estado sin
  // guardar), el aviso no se muestra para no contradecir la insignia.
  const staysPending =
    (f.estado || "por_revisar") === "por_revisar" && (f.respuesta ?? "").trim() !== "";
  const draftMatchesSaved =
    estado === ((f.estado as FeedbackState) || "por_revisar") && respuesta === (f.respuesta ?? "");
  const showPendingWarning =
    (staysPending && draftMatchesSaved) || (justSavedPending && estado === "por_revisar");
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
            onChange={(e) => { setEstado(e.target.value as FeedbackState); setDirty(true); setJustSavedPending(false); }}
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
            onChange={(e) => { setRespuesta(e.target.value); setDirty(true); setJustSavedPending(false); }}
            placeholder="Ej. Ya existe: está en Tandas → Pagos por participante → Subir comprobante."
          />
        </div>
        <button
          type="button"
          className={btnPrimary}
          disabled={p.busy || !dirty}
          onClick={() => {
            const resp = respuesta.trim() || null;
            if (resp && estado === "por_revisar") setJustSavedPending(true);
            p.onSave({ id: f.id, estado, respuesta: resp });
            setDirty(false);
          }}
        >
          {p.busy ? "Guardando…" : "Guardar evaluación"}
        </button>
        {p.saveError ? (
          <p className="text-sm text-[var(--red)]" role="alert">{p.saveError}</p>
        ) : null}
        {showPendingWarning ? (
          <p className="text-sm text-[var(--gold-text)]" role="note">⚠ La opinión seguirá en Pendientes: para sacarla de Pendientes cambie el estado.</p>
        ) : null}
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
  /** Error del último guardado fallido ({id, message}); solo la fila con
   *  ese id muestra el aviso. Null cuando no hay error pendiente. */
  saveError?: { id: number; message: string } | null;
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
              <FeedbackReviewRow key={f.id} f={f} busy={p.busy} onSave={p.onSave} saveError={p.saveError && p.saveError.id === f.id ? p.saveError.message : null} />
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
              <FeedbackReviewRow key={f.id} f={f} busy={p.busy} onSave={p.onSave} saveError={p.saveError && p.saveError.id === f.id ? p.saveError.message : null} />
            ))}
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}
