// Formulario público de opiniones de testers (?feedback=1) y canal de dudas
// y mejoras: se muestra sin sesión, sin cuenta. Se envía a POST
// /api/feedback y se guarda en la tabla tester_feedback. main.tsx lo muestra
// en lugar de la pantalla de acceso cuando la URL trae ?feedback=1; dentro
// de la app se abre en modo integrado (embedded) desde el menú
// «Enviar comentarios», con el nombre y el correo ya llenos si hay sesión.
// El tester puede consultar el estado y la respuesta de sus mensajes con su
// correo (sin envío de correos: Resend no está configurado).
import { useState, type FormEvent } from "react";
import { Label, inputCls, btnPrimary, btnGhost } from "../lib/uiShared";
import {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPE_PLACEHOLDERS,
  FEEDBACK_STATE_LABELS,
  fetchMyFeedback,
  type FeedbackType,
  type MyFeedbackMessage,
} from "../lib/feedback";

const FEEDBACK_MODULES = ["Inicio","Personal","Movimientos","Cuentas","Categorías","Presupuestos","Fondos","Aportaciones","Metas","Acuerdos","Patrimonio","Tandas","Perfiles","Hogar","Guía de uso","Instalación"];
const FEEDBACK_DEVICES = ["iPhone","Android","Computadora","Otro"];

function StarInput({label, value, onChange}:{label:string; value:number; onChange:(v:number)=>void}){
  return <div>
    <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">{label}</span>
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {[1,2,3,4,5].map(n=>(
        <button key={n} type="button" role="radio" aria-checked={value===n} aria-label={`${n} de 5 estrellas`} onClick={()=>onChange(n)} className="text-2xl leading-none text-[var(--gold-text)] px-0.5">{n<=value?"★":"☆"}</button>
      ))}
    </div>
  </div>;
}

function LookupSection(){
  const [correo,setCorreo]=useState("");
  const [results,setResults]=useState<MyFeedbackMessage[]|null>(null);
  const [searched,setSearched]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const search=async(e:FormEvent)=>{
    e.preventDefault(); setError(""); setSearched(false);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())){ setError("Escriba un correo válido."); return; }
    setBusy(true);
    try{ const r=await fetchMyFeedback(correo); setResults(r); setSearched(true); }
    catch(err){ setError(err instanceof Error?err.message:"No se pudo consultar sus mensajes."); }
    finally{ setBusy(false); }
  };
  return (
    <div className="mt-5 pt-4 border-t border-[var(--border)]">
      <h3 className="font-display font-bold">Consultar mis mensajes</h3>
      <p className="text-sm text-[var(--dim)] mt-0.5">Escriba el correo que usó al enviar y vea el estado y la respuesta de sus mensajes.</p>
      <form className="mt-3 flex gap-2" onSubmit={search}>
        <input aria-label="Correo para consultar sus mensajes" type="email" className={inputCls+" flex-1 min-w-0"} value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="usted@correo.com" autoComplete="email" />
        <button type="submit" className={btnGhost+" shrink-0"} disabled={busy}>{busy?"Buscando…":"Consultar"}</button>
      </form>
      {error && <p className="text-sm text-[var(--red)] mt-2" role="alert">{error}</p>}
      {searched && results !== null && (
        results.length===0
          ? <p className="text-sm text-[var(--dim)] mt-2">Sin mensajes con ese correo todavía.</p>
          : <div className="divide-y divide-[var(--border)] mt-2">
              {results.map(m=>(
                <div key={m.id} className="py-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <b>{m.tipo ? FEEDBACK_TYPE_LABELS[m.tipo as FeedbackType] ?? "Opinión" : "Opinión"}{m.modulo?` · ${m.modulo}`:""}</b>
                    <span className="text-xs text-[var(--dim)] shrink-0">{m.createdAt.slice(0,10)}</span>
                  </div>
                  <p className="mt-0.5">{m.descripcion || m.queFallo || m.sugerencia || "Sin descripción."}</p>
                  <p className="text-xs mt-1"><span className="font-bold">Estado:</span> {FEEDBACK_STATE_LABELS[(m.estado as keyof typeof FEEDBACK_STATE_LABELS)] ?? m.estado}</p>
                  {m.respuesta && <p className="text-xs mt-0.5"><span className="font-bold">Respuesta del dueño:</span> {m.respuesta}</p>}
                </div>
              ))}
            </div>
      )}
    </div>
  );
}

export function TesterFeedbackForm(p: { embedded?: boolean; initialNombre?: string; initialCorreo?: string; onClose?: () => void }){
  const [nombre,setNombre]=useState(p.initialNombre ?? "");
  const [correo,setCorreo]=useState(p.initialCorreo ?? "");
  const [tipo,setTipo]=useState<FeedbackType | "">("");
  const [descripcion,setDescripcion]=useState("");
  const [rating,setRating]=useState(0); const [ease,setEase]=useState(0);
  const [modulo,setModulo]=useState(""); const [dispositivo,setDispositivo]=useState("");
  const [sent,setSent]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const submit=async(e:FormEvent)=>{
    e.preventDefault(); setError("");
    if(!tipo){ setError("Elija el tipo: duda, error o mejora."); return; }
    if(!descripcion.trim()){ setError("Describa su duda, el error o la mejora."); return; }
    setBusy(true);
    try{
      const res=await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nombre:nombre||null,correo:correo||null,tipo,descripcion:descripcion.trim(),calificacionGeneral:rating||null,facilidadUso:ease||null,modulo:modulo||null,dispositivo:dispositivo||null})});
      const json=(await res.json().catch(()=>null)) as {error?:string}|null;
      if(!res.ok) throw new Error(json?.error ?? "No se pudo enviar su opinión.");
      setSent(true);
    }catch(err){ setError(err instanceof Error?err.message:"No se pudo enviar su opinión."); }
    finally{ setBusy(false); }
  };
  const reset=()=>{ setSent(false); setTipo(""); setDescripcion(""); setRating(0); setEase(0); };
  const body = sent ? (
    <div className="text-center">
      <p className="text-sm mt-3">Gracias por su mensaje. El dueño de la app lo revisa y le responde aquí mismo.</p>
      <p className="text-sm text-[var(--dim)] mt-1">Puede consultar el estado de su mensaje con su correo, en «Consultar mis mensajes».</p>
      <div className="flex gap-2 justify-center mt-4">
        <button type="button" className={btnPrimary} onClick={reset}>Enviar otro mensaje</button>
        {p.embedded && p.onClose && <button type="button" className={btnGhost} onClick={p.onClose}>Cerrar</button>}
      </div>
      <div className="text-left"><LookupSection /></div>
    </div>
  ) : (
    <>
    <form className="mt-4 space-y-3" onSubmit={submit}>
      <div>
        <span className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">Tipo de mensaje</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de mensaje">
          {FEEDBACK_TYPES.map(t=>(
            <button key={t} type="button" role="radio" aria-checked={tipo===t} aria-label={FEEDBACK_TYPE_LABELS[t]} onClick={()=>setTipo(t)} className={`rounded-full px-3 py-2 text-sm font-bold border ${tipo===t?"bg-[var(--accent)] text-[var(--accent-text)] border-transparent":"bg-[var(--surface)] border-[var(--border)]"}`}>{FEEDBACK_TYPE_LABELS[t]}</button>
          ))}
        </div>
      </div>
      <div><Label htmlFor="fb-descripcion">Descripción</Label><textarea id="fb-descripcion" aria-label="Descripción de su duda, error o mejora" className={inputCls+" min-h-[96px]"} value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder={tipo?FEEDBACK_TYPE_PLACEHOLDERS[tipo]:"Elija el tipo y describa su duda, el error o la mejora."} /></div>
      <div><Label htmlFor="fb-nombre">Su nombre (opcional)</Label><input id="fb-nombre" aria-label="Su nombre, opcional" className={inputCls} value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Ej. Ana" autoComplete="name" /></div>
      <div><Label htmlFor="fb-correo">Su correo (opcional)</Label><input id="fb-correo" aria-label="Su correo, opcional" type="email" className={inputCls} value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="usted@correo.com" autoComplete="email" /><p className="text-xs text-[var(--dim)] mt-1">Si escribe su correo, podrá consultar el estado y la respuesta de su mensaje.</p></div>
      <StarInput label="Calificación general (opcional)" value={rating} onChange={setRating} />
      <StarInput label="Facilidad de uso (opcional)" value={ease} onChange={setEase} />
      <div><Label htmlFor="fb-modulo">Módulo</Label><select id="fb-modulo" aria-label="Módulo sobre el que opina" className={inputCls} value={modulo} onChange={e=>setModulo(e.target.value)}><option value="">Sin módulo en particular</option>{FEEDBACK_MODULES.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
      <div><Label htmlFor="fb-dispositivo">Dispositivo</Label><select id="fb-dispositivo" aria-label="Dispositivo desde el que probó la app" className={inputCls} value={dispositivo} onChange={e=>setDispositivo(e.target.value)}><option value="">Sin especificar</option>{FEEDBACK_DEVICES.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
      {error && <p className="text-sm text-[var(--red)]" role="alert">{error}</p>}
      <button type="submit" className={btnPrimary+" w-full"} disabled={busy}>{busy?"Enviando…":"Enviar mensaje"}</button>
    </form>
    <LookupSection />
    </>
  );
  if(p.embedded) return (
    <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 text-[var(--text)] max-h-[92vh] overflow-y-auto">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display font-bold text-lg">Enviar comentarios</h2>
          <p className="text-sm text-[var(--dim)] mt-0.5">Dudas, errores o mejoras. El dueño de la app los revisa antes de hacer cambios.</p>
        </div>
        {p.onClose && <button type="button" aria-label="Cerrar el formulario de comentarios" onClick={p.onClose} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>}
      </div>
      {body}
    </div>
  );
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0">
        <h1 className="font-display font-bold text-2xl">SyncFinanzas</h1>
        <h2 className="font-display font-bold text-lg mt-4">Opiniones de testers</h2>
        <p className="text-sm text-[var(--dim)] mt-1">Cuéntenos su duda, el error que encontró o la mejora que propone. No necesita cuenta.</p>
        {body}
      </div>
    </main>
  );
}
