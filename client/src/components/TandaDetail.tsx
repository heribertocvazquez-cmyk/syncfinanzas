import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { warmUpOcr } from "../lib/ocr";
import { CollapsibleCard } from "./CollapsibleCard";
import { ComprobanteVerificado } from "./ComprobanteVerificado";
import { OcrDetail } from "./OcrDetail";
import { fmtDate, isoToDMY, money, money2, parseDMYToISO, todayISO } from "../lib/format";
import { Stars, Label, inputCls, btnPrimary, btnGhost } from "../lib/uiShared";
import { tandaCalendarSummary, tandaFinesSummary, tandaMeetingSummary, tandaPaymentsSummary } from "../lib/cardSummaries";
import type { ReceiptDateCheck, ReceiptRead } from "../lib/smart";
import type { Tanda } from "./TandaCard";

// Detalle completo de una tanda creada (decisión de Heriberto 2026-11-18):
// todo el desglose de seguimiento — sorteo, reunión con pase de lista,
// saldos separados, multas, participantes con agregar/invitar, calendario
// del mes, calendario de entregas, pagos por participante y calificación
// del organizador — vive DENTRO de la tanda y se abre desde su tarjeta
// compacta. Antes este bloque se pintaba en línea debajo del formulario
// de creación en el módulo Tandas. Sin cambios de campos ni de lógica:
// solo se mueve de sitio. Las secciones que pueden estar vacías muestran
// un mensaje visible al abrirse, para que el «+» / «−» siempre tenga un
// efecto visible (reporte de Heriberto 2026-11-18).

export type TandaPerms = {
  isAdmin: boolean;
  myParticipantId: number | null;
  isParticipant: boolean;
  canManage: boolean;
  canTreasury: boolean;
  // Candado de pago (2026-11-26): solo Organizador y Tesorero verifican
  // pagos; el Suplente tiene rango 2 pero no verifica.
  canVerify: boolean;
  isOwn: (participantId: number) => boolean;
};
export type TandaInviteSend = { emailSent: boolean; emailConfigured: boolean; inviteUrl: string };
export type TandaProofReview = {
  tandaId: number; participantId: number; participantName: string; quincenaIndex: number;
  file: File; preview: string; detail: ReceiptRead | null; paidDate: string;
  busy: boolean; error: string; notice: string; dateCheck: ReceiptDateCheck | null;
};
export type TandaMutation<V> = {
  mutate: (v: V, opts?: { onSuccess?: () => void }) => void;
  isPending: boolean;
  error: Error | null;
};
type StrMap = Record<number, string>;
type SetStrMap = Dispatch<SetStateAction<Record<number, string>>>;

export type TandaDetailDeps = {
  drawSel: Record<number, "random" | "weighted">;
  setDrawSel: Dispatch<SetStateAction<Record<number, "random" | "weighted">>>;
  fundKind: StrMap; setFundKind: SetStrMap;
  fundAmount: StrMap; setFundAmount: SetStrMap;
  fundNote: StrMap; setFundNote: SetStrMap;
  partName: StrMap; setPartName: SetStrMap;
  partCard: StrMap; setPartCard: SetStrMap;
  cardInput: StrMap; setCardInput: SetStrMap;
  tInvEmail: StrMap; setTInvEmail: SetStrMap;
  tInvName: StrMap; setTInvName: SetStrMap;
  tInvResult: Record<number, TandaInviteSend>;
  tJoinName: StrMap; setTJoinName: SetStrMap;
  // Correo de la sesión actual (minúsculas): solo la persona invitada
  // (sesión con el correo invitado) ve Aceptar/Rechazar en una invitación
  // de tanda pendiente. Quien la mandó u otra persona ve solo el estado
  // con Reenviar; el servidor vuelve a verificar el correo al responder.
  myEmail: string;
  rateName: StrMap; setRateName: SetStrMap;
  rateStars: StrMap; setRateStars: SetStrMap;
  rateComment: StrMap; setRateComment: SetStrMap;
  tandaProofReview: TandaProofReview | null;
  setTandaProofReview: Dispatch<SetStateAction<TandaProofReview | null>>;
  mpOrders: Record<string, string>;
  mpOrderKey: (tandaId: number, quincenaIndex: number) => string;
  mpClearOrder: (tandaId: number, quincenaIndex: number) => void;
  copiedLink: string;
  copyLink: (url: string) => void;
  tandaInviteMessage: (url: string, tandaName: string) => string;
  setReceiptView: (url: string | null) => void;
  pickTandaProof: (v: { tandaId: number; participantId: number; participantName: string; quincenaIndex: number; file: File }) => void;
  confirmTandaProof: () => void;
  delTanda: TandaMutation<number>;
  drawTanda: TandaMutation<{ id: number; mode: "random" | "weighted" }>;
  setPay: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number; status: "paid" | "pending" | "late" }>;
  addFine: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number; reason: "retardo" | "falta" }>;
  verifyPay: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number; verified: boolean }>;
  addFundEntry: TandaMutation<{ tandaId: number }>;
  // La multa se paga con comprobante (candado 2026-11-26): el archivo va
  // aquí y App lo convierte a base64 como el comprobante de pago.
  payFine: TandaMutation<{ tandaId: number; fineId: number; file: File }>;
  verifyFine: TandaMutation<{ tandaId: number; fineId: number; verified: boolean }>;
  // Destino del turno del excluido (D1, 2026-11-26): reasignación a un
  // participante activo, o reemplazo nuevo aprobado por el Organizador.
  reassignTurn: TandaMutation<{ tandaId: number; excludedParticipantId: number; newParticipantId: number }>;
  addReplacement: TandaMutation<{ tandaId: number; excludedParticipantId: number; name: string; email?: string; cardLast4?: string }>;
  setRole: TandaMutation<{ tandaId: number; participantId: number; role: "organizador" | "tesorero" | "suplente" | "participante" }>;
  setFixed: TandaMutation<{ tandaId: number; participantId: number; number: number | null }>;
  voteExclude: TandaMutation<{ tandaId: number; targetParticipantId: number; vote?: "excluir" | "no" }>;
  removePart: TandaMutation<number>;
  // cardLast4 null quita la tarjeta simulada (2026-11-26).
  setCard: TandaMutation<{ id: number; cardLast4: string | null }>;
  addPart: TandaMutation<{ tandaId: number; name: string; cardLast4?: string }>;
  createTandaInv: TandaMutation<{ tandaId: number }>;
  respondTandaInv: TandaMutation<{ id: number; accept: boolean }>;
  resendInv: TandaMutation<{ kind: "tanda"; invitationId: number; tandaId: number }>;
  cancelTandaInv: TandaMutation<number>;
  confirmDelivery: TandaMutation<{ tandaId: number; quincenaIndex: number; receiverId: number | null; by: "organizador" | "receptor" }>;
  uploadProof: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number; file: File; paidDate: string }>;
  remindPay: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number }>;
  createMpOrder: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number }>;
  checkMpOrder: TandaMutation<{ tandaId: number; participantId: number; quincenaIndex: number; orderId: string }>;
  rateOrg: TandaMutation<{ tandaId: number }>;
};

// Calendario mensual en rejilla para una tanda: lunes a domingo, con los
// días de pago en turquesa y los días de entrega en azul. Solo muestra
// fechas y estados; no cobra nada.
const CAL_WEEKDAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
function parseISODate(iso:string){ const [y=2026,m=1,d=1]=iso.split("-").map(Number); return new Date(y,(m||1)-1,d||1); }
function daysFromToday(iso:string){ const t=new Date(); t.setHours(0,0,0,0); return Math.round((parseISODate(iso).getTime()-t.getTime())/86400000); }
function capFirst(s:string){ return s.charAt(0).toUpperCase()+s.slice(1); }

// Validación Luhn del número completo de la tarjeta simulada (2026-11-26):
// el número completo se valida en el teléfono y nunca se envía al
// servidor; solo los últimos 4 dígitos viajan. 13 a 19 dígitos.
function luhnOk(num: string): boolean {
  const d = num.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0; let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function TandaMonthCalendar({td, p, pickTandaProof}:{td:Tanda; p:TandaPerms; pickTandaProof: TandaDetailDeps["pickTandaProof"]}){
  const now = new Date();
  const [view,setView] = useState({y:now.getFullYear(), m:now.getMonth()});
  const [selected,setSelected] = useState<string|null>(null);
  const todayKey = todayISO();
  if (td.calendar.length===0) return <p className="text-sm text-[var(--dim)]">Sin periodos todavía.</p>;
  const byDate = new Map(td.calendar.map(c=>[c.date, c]));
  const upcoming = td.calendar.filter(c=>c.date>=todayKey);
  const nextPay = upcoming[0] || null;
  const nextReceive = upcoming.find(c=>c.receiverName) || null;
  const payDays = nextPay ? daysFromToday(nextPay.date) : null;
  const recDays = nextReceive ? daysFromToday(nextReceive.date) : null;
  const payLine = !nextPay ? "La tanda terminó. No hay fechas próximas para pagar."
    : payDays===0 ? `Hoy se paga · ${fmtDate(nextPay.date)}`
    : payDays===1 ? `Falta 1 día para pagar · ${fmtDate(nextPay.date)}`
    : `Faltan ${payDays} días para pagar · ${fmtDate(nextPay.date)}`;
  const recLine = !nextReceive ? (nextPay ? "Aún sin sorteo: no hay entrega programada." : "Sin entregas próximas.")
    : recDays===0 ? `Hoy recibe ${nextReceive.receiverName} · ${fmtDate(nextReceive.date)}`
    : recDays===1 ? `Falta 1 día para recibir · recibe ${nextReceive.receiverName} · ${fmtDate(nextReceive.date)}`
    : `Faltan ${recDays} días para recibir · recibe ${nextReceive.receiverName} · ${fmtDate(nextReceive.date)}`;
  const first = new Date(view.y, view.m, 1);
  const leading = (first.getDay()+6)%7;
  const daysInMonth = new Date(view.y, view.m+1, 0).getDate();
  const monthLabel = capFirst(first.toLocaleDateString("es-MX",{month:"long",year:"numeric"}));
  const sel = selected ? byDate.get(selected) : null;
  const shiftMonth = (d:number)=>{ setView(v=>{ const dt=new Date(v.y, v.m+d, 1); return {y:dt.getFullYear(), m:dt.getMonth()}; }); };
  const activeParts = td.participants.filter(p=>p.excluded!==1);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Mes anterior" className={btnGhost} onClick={()=>shiftMonth(-1)}>‹</button>
          <span className="text-sm font-bold min-w-[132px] text-center">{monthLabel}</span>
          <button type="button" aria-label="Mes siguiente" className={btnGhost} onClick={()=>shiftMonth(1)}>›</button>
          <button type="button" aria-label="Volver al mes actual" className={btnGhost} onClick={()=>setView({y:now.getFullYear(), m:now.getMonth()})}>Hoy</button>
        </div>
      </div>
      <div className="bg-[var(--surface2)] border border-[var(--accent)] rounded-2xl p-4 sm:p-5 space-y-1 mt-2">
        <p className="text-sm font-bold text-[var(--gold-text)]">{payLine}</p>
        <p className="text-sm font-bold text-[var(--blue-ink)]">{recLine}</p>
        {(()=>{ const myId=p.myParticipantId; if(myId==null||!nextPay) return null; const myPay=td.payments.find(x=>x.participantId===myId&&x.quincenaIndex===nextPay.index); if(myPay?.status==="paid") return null; const me=td.participants.find(x=>x.id===myId); return (
          <label className={btnPrimary+" mt-2 inline-flex cursor-pointer"} aria-label={`Subir comprobante de su pago del periodo ${nextPay.index+1} de ${td.name}`}>Subir comprobante · {money(td.amountPerQuincena)}<input type="file" accept="image/*" className="hidden" aria-label={`Archivo del comprobante de su pago del periodo ${nextPay.index+1}`} onChange={e=>{ const f=e.target.files?.[0]; if(f) void pickTandaProof({tandaId:td.id,participantId:myId,participantName:me?.name||"Participante",quincenaIndex:nextPay.index,file:f}); e.target.value=""; }} /></label>
        ); })()}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-2">
        {CAL_WEEKDAYS.map(wd=><div key={wd} className="text-xs font-bold text-[var(--dim)] text-center py-1">{wd}</div>)}
        {Array.from({length: leading+daysInMonth}, (_,i)=>{
          if(i<leading) return <div key={`b${i}`} />;
          const d = i-leading+1;
          const key = `${view.y}-${String(view.m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const c = byDate.get(key);
          const isToday = key===todayKey;
          const isPast = key<todayKey;
          const inner = (<>
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${isToday?"bg-[var(--accent)] text-[var(--accent-text)]":""}`}>{d}</span>
            {c && <>
              <span className="block mt-0.5 text-xs leading-[1.15] font-bold rounded px-0.5 py-px bg-[var(--accent)] text-[var(--accent-text)]">Pagar {money(td.amountPerQuincena)}</span>
              {c.receiverName && <span className="block mt-0.5 text-xs leading-[1.15] font-bold rounded px-0.5 py-px bg-[var(--blue)] text-[var(--blue-text)] truncate">Recibe: {c.receiverName}</span>}
            </>}
          </>);
          const cls = `min-h-[54px] rounded-lg border p-1 text-left align-top ${c ? "border-[var(--accent)] bg-[var(--surface2)]" : "border-[var(--border)]"} ${isPast && c ? "opacity-60" : ""} ${isToday && !c ? "ring-2 ring-[var(--accent)]" : ""} ${selected===key ? "ring-2 ring-[var(--accent)]" : ""}`;
          return c
            ? <button key={key} type="button" aria-label={`Periodo ${c.index+1} el ${fmtDate(key)}${c.receiverName?`, recibe ${c.receiverName}`:""}`} className={cls} onClick={()=>setSelected(selected===key?null:key)}>{inner}</button>
            : <div key={key} className={cls}>{inner}</div>;
        })}
      </div>
      <p className="text-xs text-[var(--dim)] mt-2"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--accent)] border border-[var(--accent)] align-middle mr-1" />Día de pago · <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--blue)] border border-[var(--blue)] align-middle mr-1" />Día de entrega.</p>
      {sel && (
        <div className="bg-[var(--surface2)] rounded-2xl p-4 sm:p-5 mt-2">
          <div className="flex justify-between gap-2 items-start">
            <div>
              <p className="font-display font-bold text-sm">Periodo {sel.index+1} · {fmtDate(sel.date)}</p>
              <p className="text-sm mt-0.5">{sel.receiverName ? <>Recibe <b>{sel.receiverName}</b> · <b className="whitespace-nowrap">{money(sel.amount)}</b></> : "Pendiente de sorteo"}</p>
              <p className="text-sm">Cada participante paga <b className="whitespace-nowrap">{money(td.amountPerQuincena)}</b></p>
            </div>
            <button type="button" aria-label="Cerrar detalle del día" className={btnGhost} onClick={()=>setSelected(null)}>×</button>
          </div>
          <div className="space-y-1 mt-2">
            {activeParts.map(pt=>{
              const pay = td.payments.find(x=>x.participantId===pt.id && x.quincenaIndex===sel.index);
              const st = pay?.status || "pending";
              // Candado de pago (2026-11-26): pagado sin verificar se muestra
              // «En revisión», no «Pagado»; «Pagado» solo tras la verificación.
              const dst = st==="paid" ? (pay?.verified===1 ? "paid" : "review") : st;
              return <p key={pt.id} className="text-sm flex justify-between gap-2"><span>{pt.name}</span><span className={`text-xs font-bold rounded-full px-2 py-0.5 shrink-0 ${dst==="paid"?"bg-green-100 text-green-900":dst==="late"?"bg-red-100 text-red-900":"bg-amber-100 text-amber-900"}`}>{dst==="paid"?"Pagado":dst==="late"?"Atrasado":dst==="review"?"En revisión":"Pendiente"}{pay?.verified===1?" · Verificado":""}{pay?.paidDate?` · ${fmtDate(pay.paidDate)}`:""}</span></p>;
            })}
            {activeParts.length===0 && <p className="text-sm text-[var(--dim)]">Agregue participantes.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// Revisión del comprobante de pago de tanda antes de guardar. Vive en un
// solo sitio — justo después del calendario, dentro de su tarjeta
// plegable (abierta por defecto mientras dura la revisión) — tanto si el
// participante sube el comprobante desde el botón directo del encabezado
// como desde la fila de «Pagos por participante»: el flujo es el mismo
// (pickTandaProof → revisión con importe leído y aviso si no coincide con
// el monto de la tanda → «Confirmar pago»). Antes vivía dentro de la
// sección plegada de pagos, donde quedaba enterrado.
function TandaProofReviewPanel({ td, review, setReview, uploadProof, confirm }: {
  td: Tanda;
  review: TandaProofReview;
  setReview: Dispatch<SetStateAction<TandaProofReview | null>>;
  uploadProof: { isPending: boolean; error: Error | null };
  confirm: () => void;
}) {
  // El título del panel («Revisar comprobante · nombre · Periodo n ·
  // fecha») lo lleva la tarjeta plegable que lo envuelve; aquí solo
  // queda el contenido de la revisión.
  // Fecha del pago tecleable (2026-11-27): el input nativo type="date" no
  // acepta teclear «01/12/2026» (verificado en pantalla en cc6ff27) y la
  // tarjeta «Comprobante Verificado» mostraba la fecha de hoy aunque el
  // comprobante fuera de otra fecha. Mismo patrón que «Fecha de inicio»
  // del formulario de tanda (00297d1): el texto vive en estado local y
  // solo una fecha completa y válida actualiza paidDate en ISO; una
  // inválida vuelve a la fecha válida al salir del campo.
  const [dateText, setDateText] = useState(() => isoToDMY(review.paidDate));
  useEffect(() => {
    if (parseDMYToISO(dateText) !== review.paidDate) setDateText(isoToDMY(review.paidDate));
    // Solo interesa el cambio externo (botones «Usar la fecha leída» /
    // «Usar hoy», nueva revisión); el tecleo parcial no se toca mientras
    // no sea una fecha válida distinta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.paidDate]);
  const onDateChange = (raw: string) => {
    setDateText(raw);
    const iso = parseDMYToISO(raw);
    if (iso) setReview(r => r ? { ...r, paidDate: iso, dateCheck: null } : r);
  };
  const onDateBlur = () => {
    if (!parseDMYToISO(dateText)) setDateText(isoToDMY(review.paidDate));
  };
  return (
    <div className="border border-[var(--gold)] rounded-2xl p-4 bg-[var(--surface2)] space-y-2">
      <div className="flex items-center gap-2">
        <img src={review.preview} alt="Foto del comprobante del depósito" className="w-11 h-11 object-cover rounded-xl border border-[var(--border)]" />
        <p className="text-sm">Pago de la tanda: <b className="whitespace-nowrap">{money(td.amountPerQuincena)}</b></p>
      </div>
      {review.busy && <p className="text-xs text-[var(--dim)]">Leyendo el comprobante en su dispositivo…</p>}
      {review.error && <p className="text-xs text-[var(--red)]">{review.error}</p>}
      {review.notice && <p className="text-xs text-[var(--green)]">{review.notice}</p>}
      {review.dateCheck && <div className="border border-[var(--red)] rounded-xl p-3 bg-[var(--surface2)]">
        <p className="text-sm font-bold">Confirme la fecha de origen del pago</p>
        <p className="text-xs mt-1">La fecha leída del comprobante es <b>{fmtDate(review.dateCheck.readDate)}</b>{review.dateCheck.reason==="future"?" (una fecha futura)":" (de otro año)"}. ¿Es esa la fecha del pago?</p>
        <p className="text-xs text-[var(--dim)] mt-1">Quedó la fecha de hoy ({fmtDate(review.paidDate)}). Puede usar la fecha leída, dejar la de hoy o corregirla en «Fecha del pago».</p>
        <div className="flex gap-2 mt-2">
          <button type="button" aria-label={`Usar la fecha leída ${fmtDate(review.dateCheck.readDate)}`} className={btnPrimary+" flex-1"} onClick={()=>setReview(r=>r?{...r,paidDate:r.dateCheck!.readDate,dateCheck:null}:r)}>Usar {fmtDate(review.dateCheck.readDate)}</button>
          <button type="button" aria-label="Usar la fecha de hoy" className={btnGhost+" flex-1"} onClick={()=>setReview(r=>r?{...r,paidDate:todayISO(),dateCheck:null}:r)}>Usar hoy</button>
        </div>
      </div>}
      {review.detail && <>
        <div className="flex justify-between gap-2 text-sm"><span className="text-[var(--dim)]">Importe leído</span><b className="whitespace-nowrap">{money2(review.detail.total ?? 0)}</b></div>
        {review.detail.total != null && Math.abs(review.detail.total - td.amountPerQuincena) > 0.51
          ? <p className="text-xs font-bold text-[var(--red)]">El importe leído no coincide con el pago de la tanda ({money(td.amountPerQuincena)}). Revise antes de confirmar.</p>
          : <p className="text-xs text-[var(--green)]">El importe leído coincide con el pago de la tanda.</p>}
        <OcrDetail detail={review.detail} />
      </>}
      <div><Label htmlFor="tanda-proof-date">Fecha del pago</Label><input id="tanda-proof-date" name="paidDate" aria-label="Fecha del pago de tanda" type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" required className={inputCls} value={dateText} onChange={e=>onDateChange(e.target.value)} onBlur={onDateBlur} /></div>
      <div className="flex gap-2">
        <button type="button" className={btnPrimary+" flex-1"} disabled={uploadProof.isPending || review.busy || !!review.dateCheck} onClick={confirm}>{uploadProof.isPending?"Guardando…":"Confirmar pago"}</button>
        <button type="button" className={btnGhost} onClick={()=>setReview(null)}>Cancelar</button>
      </div>
      {uploadProof.error && <p className="text-xs text-[var(--red)]">{String(uploadProof.error)}</p>}
    </div>
  );
}

export function TandaDetail({ td, p, deps }: { td: Tanda; p: TandaPerms; deps: TandaDetailDeps }) {
  const {
    drawSel, setDrawSel, fundKind, setFundKind, fundAmount, setFundAmount, fundNote, setFundNote,
    partName, setPartName, partCard, setPartCard,
    tInvEmail, setTInvEmail, tInvName, setTInvName, tInvResult, tJoinName, setTJoinName, myEmail,
    rateName, setRateName, rateStars, setRateStars, rateComment, setRateComment,
    tandaProofReview, setTandaProofReview, mpOrders, mpOrderKey, mpClearOrder,
    copiedLink, copyLink, tandaInviteMessage, setReceiptView,
    pickTandaProof, confirmTandaProof,
    delTanda, drawTanda, setPay, addFine, verifyPay, addFundEntry, payFine, verifyFine, reassignTurn, addReplacement, setRole, setFixed,
    voteExclude, removePart, setCard, addPart, createTandaInv, respondTandaInv, resendInv, cancelTandaInv,
    confirmDelivery, uploadProof, remindPay, createMpOrder, checkMpOrder, rateOrg,
  } = deps;
  // Precarga del lector de comprobantes al abrir el detalle de la tanda:
  // los botones de «Subir comprobante» están en esta pantalla, así que la
  // primera lectura ya se descarga en segundo plano mientras la persona
  // revisa. Una sola vez por carga de la página; si falla, la lectura
  // normal sigue su curso.
  useEffect(()=>{ void warmUpOcr(); },[]);
  // Confirmación en línea para eliminar una invitación pendiente (mismo
  // patrón que el borrado de movimientos): solo se ejecuta al confirmar.
  const [confirmCancelTInvId, setConfirmCancelTInvId] = useState<number|null>(null);
  // Número completo de la tarjeta simulada, por participante (2026-11-26):
  // vive solo en el teléfono; al registrar solo salen los últimos 4.
  const [cardFull, setCardFull] = useState<Record<number, string>>({});
  // Confirmación en línea para quitar una tarjeta simulada (mismo patrón
  // que eliminar una invitación): solo se ejecuta al confirmar.
  const [confirmRemoveCardId, setConfirmRemoveCardId] = useState<number|null>(null);
  // Tarjeta «Comprobante Verificado» (2026-11-27): se abre al tocar el
  // chip de un pago verificado, en «Pagos por participante» o en la lista
  // de asistencia. Solo pagos de turno, no multas.
  const [verifiedCard, setVerifiedCard] = useState<{ participantId: number; participantName: string; quincenaIndex: number } | null>(null);
  const openVerifiedCard = (participantId: number, participantName: string, quincenaIndex: number) => {
    const pay = td.payments.find(x=>x.participantId===participantId && x.quincenaIndex===quincenaIndex);
    if (pay?.verified===1) setVerifiedCard({ participantId, participantName, quincenaIndex });
  };
  // Destino del turno de un excluido (D1): a quién se reasigna el turno y
  // los datos del reemplazo nuevo. Estado local por participante excluido.
  const [reassignTo, setReassignTo] = useState<Record<number, string>>({});
  const [replDraft, setReplDraft] = useState<Record<number, { name: string; email: string }>>({});
  const meetingItems = td.attendance.items.filter(
    (it) => !(td.participants.find((pp) => pp.id === it.participantId)?.excluded === 1),
  );
  // Resúmenes de una línea para las secciones plegadas (reporte
  // 2026-11-19 16:02): próximo pago del calendario del mes y fecha del
  // periodo en revisión del comprobante.
  const nextPayCal = td.calendar.find((c) => c.date >= todayISO());
  const reviewPeriodDate = tandaProofReview ? td.calendar.find((c) => c.index === tandaProofReview.quincenaIndex)?.date ?? null : null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-3">
      <CollapsibleCard
        asSection
        title={<div className="flex justify-between flex-wrap gap-2">
          <h3 className="font-display font-bold text-lg">{td.name}</h3>
          <div className="flex gap-2 items-start">
            {p.canManage && <button aria-label={`Eliminar tanda ${td.name}`} className={btnGhost} onClick={()=>delTanda.mutate(td.id)}>Eliminar</button>}
            {delTanda.error && <p className="text-sm text-[var(--red)]">{String(delTanda.error)}</p>}
          </div>
        </div>}
        above={<>
          <p className="text-xs text-[var(--dim)]">{td.participantCount} participantes · {money(td.amountPerQuincena)} por {td.frequency==="semanal"?"semana":td.frequency==="mensual"?"mes":"quincena"} · recaudación cada {td.cadenceDays} días · inicio {fmtDate(td.startDate)} · en cada periodo se entrega el monto total de <b className="whitespace-nowrap">{money(td.potPerQuincena)}</b></p>
          <p className="text-sm mt-1.5">Organiza <b>{td.organizerName||"—"}</b>{td.treasurerName?<> · Tesorero: <b>{td.treasurerName}</b></>:""}{td.substituteName?<> · Suplente: <b>{td.substituteName}</b></>:""} {td.organizerRating.count>0 ? <span><Stars value={td.organizerRating.avg} /> <b>{td.organizerRating.avg} de 5</b> · {td.organizerRating.count} calificación(es) otorgadas por los participantes{td.organizerRating.avg>=4.5 && td.organizerRating.count>=2 ? <> · <span className="bg-[var(--gold)] text-[#13262E] text-[11px] font-bold rounded-full px-2 py-0.5">RECOMENDADO POR LOS PARTICIPANTES</span></> : ""}</span> : <span className="text-[var(--dim)]">· Aún sin calificaciones.</span>}</p>
        </>}
      >
        <p className="text-xs text-[var(--dim)] mt-1">Si alguien no paga: <b>{td.coverageRule==="fondo"?"Fondo solidario":td.coverageRule==="prorroga"?"Prórroga":"Reparto entre los demás"}</b>{td.fineAmount>0?<> · Multa {money(td.fineAmount)} por retardo o falta</>:" · Sin multa"}{td.meetingDay?<> · Reunión los <b>{td.meetingDay}</b></>:""}{td.kind==="compartamos"?<> · <b>Tanda Compartamos</b> (con multas)</>:" · Tanda ordinaria (sin multas)"}{td.turnsLocked===1?<> · <b>Turnos fijados</b></>:""}</p>
      </CollapsibleCard>
      <div className="bg-[var(--surface2)] rounded-2xl p-4 sm:p-5">
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Sorteo</h4>}
          above={<p className="text-xs text-[var(--dim)] mt-0.5">{td.drawMode==="weighted"?"Por cumplimiento":"Al azar"} · {td.participants.length} de {td.participantCount} participantes{td.turnsLocked===1?" · Turnos fijados":""}</p>}
        >
          {p.canManage && <div className="flex flex-wrap gap-2 items-center mt-2">
            <select aria-label={`Modo de sorteo de ${td.name}`} className={inputCls+" w-auto"} value={drawSel[td.id]||td.drawMode} onChange={e=>setDrawSel({...drawSel,[td.id]:e.target.value as "random"|"weighted"})}><option value="random">Al azar</option><option value="weighted">Por cumplimiento</option></select>
            <button aria-label={`Hacer sorteo de ${td.name}`} className={btnPrimary} onClick={()=>drawTanda.mutate({id:td.id,mode:(drawSel[td.id]||td.drawMode) as "random"|"weighted"})} disabled={td.participants.length<2 || drawTanda.isPending || td.turnsLocked===1}>Hacer sorteo</button>
          </div>}
          {p.canManage && td.participants.length<2 && td.turnsLocked!==1 && <p className="text-xs text-[var(--red)] mt-1">Para el sorteo se necesitan al menos 2 participantes ({td.participants.length} de {td.participantCount} ahora). Agregue participantes en la sección de abajo.</p>}
          {td.turnsLocked!==1 && (() => {
            const fixed = td.participants.filter(pt => pt.fixedDrawOrder != null);
            const hasTreasurer = td.participants.some(pt => pt.role === "tesorero");
            return (<>
              <p className="text-xs text-[var(--dim)] mt-2">{fixed.length>0
                ? <>Números fijos: <b>{fixed.map(pt => `${pt.role==="organizador"?"Organizador":"Tesorero"}: n.º ${pt.fixedDrawOrder}`).join(" · ")}</b> · los demás se sortean entre los números libres.</>
                : "Sin números fijos: todos los participantes se sortean."}</p>
              {p.canManage && !hasTreasurer && <p className="text-xs text-[var(--dim)] mt-1">Aún no hay Tesorero asignado: solo el Organizador puede tener número fijo. Asigne el Tesorero en la lista de participantes antes de sortear.</p>}
            </>);
          })()}
          <span className="text-xs text-[var(--dim)]">Modo guardado: <b>{td.drawMode==="weighted"?"Por cumplimiento":"Al azar"}</b>{td.turnsLocked===1 && <> · <b>Turnos fijados, no se puede repetir el sorteo</b></>}</span>
          <p className="text-xs text-[var(--dim)] mt-2"><b>Al azar:</b> igual para todos. <b>Por cumplimiento:</b> premia la puntualidad.</p>
          {drawTanda.error && <p className="text-sm text-[var(--red)] mt-1">{String(drawTanda.error)}</p>}
        </CollapsibleCard>
      </div>
      <div className="bg-[var(--surface2)] rounded-2xl p-4 sm:p-5 space-y-3">
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Reunión del grupo · Ronda {td.attendance.index+1} de {td.participantCount}</h4>}
          above={<>
          <p className="text-xs text-[var(--dim)] mt-0.5">Ficha: <b>TANDA-{td.id}-R{td.attendance.index+1}</b> · Monto {money(td.amountPerQuincena)} por persona · Fecha límite {fmtDate(td.attendance.date)} · Se entrega {money(td.attendance.amount)}{td.attendance.receiverName?` a ${td.attendance.receiverName}`:""}</p>
          {(()=>{ const ms = tandaMeetingSummary(td.attendance.items, td.participants); return <p className="text-xs text-[var(--dim)] mt-0.5">{ms.paid} pagaron · {ms.late} atrasados · {ms.pending} pendientes</p>; })()}
          </>}
        >
          <div className="space-y-1.5 mt-2">
            {meetingItems.length===0 && <p className="text-sm text-[var(--dim)]">Aún no hay participantes en esta ronda.</p>}
            {meetingItems.map(it=>{
              return (
              <div key={it.participantId} className="flex flex-wrap items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-3 py-2">
                <span className="text-sm flex-1 min-w-[120px]"><b>{it.name}</b> <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${it.status==="paid"?(it.verified===1?"bg-green-100 text-green-900":"bg-amber-100 text-amber-900"):it.status==="late"?"bg-red-100 text-red-900":"bg-amber-100 text-amber-900"}`}>{it.status==="paid"?(it.verified===1?"Pagado":"En revisión"):it.status==="late"?"Atrasado":"Pendiente"}</span>{it.paidDate && <span className="text-xs text-[var(--dim)]"> · pagó el {fmtDate(it.paidDate)}</span>}{it.verified===1 && <button type="button" aria-label={`Ver comprobante verificado de ${it.name} en la ronda ${td.attendance.index+1}`} className="text-xs text-[var(--green)] underline font-bold" onClick={()=>openVerifiedCard(it.participantId, it.name, td.attendance.index)}> · Verificado</button>}{it.fineAmount>0 && <span className="text-xs text-[var(--red)]"> · Multa {money(it.fineAmount)}</span>}{it.status==="paid" && it.proofAmount!=null && <span className="text-xs text-[var(--dim)]"> · Comprobante {money2(it.proofAmount)} · Tanda {money(td.amountPerQuincena)}{Math.abs(it.proofAmount-td.amountPerQuincena)>0.51?" · No coincide":""}</span>}</span>
                <span className="flex flex-wrap gap-1">
                  {it.status==="pending" && p.canTreasury && <button aria-label={`Marcar atrasado a ${it.name} en la ronda ${td.attendance.index+1}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>setPay.mutate({tandaId:td.id,participantId:it.participantId,quincenaIndex:td.attendance.index,status:"late"})}>Marcar atrasado</button>}
                  {it.status==="late" && td.kind==="compartamos" && td.fineAmount>0 && p.canTreasury && <button aria-label={`Aplicar multa a ${it.name} en la ronda ${td.attendance.index+1}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>addFine.mutate({tandaId:td.id,participantId:it.participantId,quincenaIndex:td.attendance.index,reason:"retardo"})}>Aplicar multa {money(td.fineAmount)}</button>}
                  {it.status==="paid" && it.verified!==1 && p.canVerify && <button aria-label={`Verificar pago de ${it.name} en la ronda ${td.attendance.index+1}`} className="bg-[var(--green)] text-[var(--bg)] rounded-full px-2 py-1 text-xs font-bold" onClick={()=>verifyPay.mutate({tandaId:td.id,participantId:it.participantId,quincenaIndex:td.attendance.index,verified:true})}>Verificar pago</button>}
                  {it.proofUrl && <button aria-label={`Ver comprobante de ${it.name} en la ronda ${td.attendance.index+1}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>setReceiptView(it.proofUrl)}>Ver comprobante</button>}
                </span>
              </div>
              );
            })}
          </div>
          {(setPay.error || addFine.error) && <p className="text-sm text-[var(--red)] mt-1">{String(setPay.error || addFine.error)}</p>}
        </CollapsibleCard>
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Saldos separados</h4>}
          above={<p className="text-xs text-[var(--dim)] mt-0.5">Aportación {money(td.balances.aportacion)} · Fondo solidario {money(td.balances.fondo)} · Multas pendientes {money(td.balances.multasPendientes)}</p>}
        >
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-2"><p className="text-xs text-[var(--dim)]">Aportación</p><p className="font-display font-bold text-sm whitespace-nowrap">{money(td.balances.aportacion)}</p></div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-2"><p className="text-xs text-[var(--dim)]">Fondo solidario</p><p className="font-display font-bold text-sm whitespace-nowrap">{money(td.balances.fondo)}</p></div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-2"><p className="text-xs text-[var(--dim)]">Multas pendientes</p><p className="font-display font-bold text-sm whitespace-nowrap">{money(td.balances.multasPendientes)}</p>{td.balances.multasCobradas>0 && <p className="text-xs text-[var(--dim)]">Cobradas {money(td.balances.multasCobradas)}</p>}</div>
          </div>
          {p.canTreasury && <div className="flex flex-wrap gap-2 mt-2 items-end">
            <div><Label htmlFor={`fund-kind-${td.id}`}>Tipo</Label><select id={`fund-kind-${td.id}`} aria-label={`Tipo de movimiento de fondos de ${td.name}`} className={inputCls+" w-auto"} value={fundKind[td.id]||"fondo"} onChange={e=>setFundKind({...fundKind,[td.id]:e.target.value})}><option value="fondo">Fondo solidario</option><option value="aportacion">Aportación</option></select></div>
            <div><Label htmlFor={`fund-amount-${td.id}`}>Monto ($)</Label><input id={`fund-amount-${td.id}`} aria-label={`Monto del movimiento de fondos de ${td.name}`} type="number" min="1" className={inputCls+" w-32"} value={fundAmount[td.id]||""} onChange={e=>setFundAmount({...fundAmount,[td.id]:e.target.value})} /></div>
            <div className="flex-1 min-w-[140px]"><Label htmlFor={`fund-note-${td.id}`}>Nota (opcional)</Label><input id={`fund-note-${td.id}`} aria-label={`Nota del movimiento de fondos de ${td.name}`} className={inputCls} value={fundNote[td.id]||""} onChange={e=>setFundNote({...fundNote,[td.id]:e.target.value})} placeholder="Ej. Aporte al fondo" /></div>
            <button aria-label={`Registrar movimiento de fondos de ${td.name}`} className={btnGhost} onClick={()=>addFundEntry.mutate({tandaId:td.id})} disabled={!fundAmount[td.id] || addFundEntry.isPending}>Registrar</button>
          </div>}
          {addFundEntry.error && <p className="text-sm text-[var(--red)] mt-1">{String(addFundEntry.error)}</p>}
        </CollapsibleCard>
        {td.fines.length>0 && (
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Multas</h4>}
          above={(()=>{ const fs = tandaFinesSummary(td.fines); return <p className="text-xs text-[var(--dim)] mt-0.5">{td.fines.length} {td.fines.length===1?"multa":"multas"} · Pendientes {money(fs.pendingAmount)} · Pagadas {money(fs.paidAmount)}</p>; })()}
        >
          <div className="space-y-1.5 mt-2">
            {td.fines.map(f=>{ const pn = td.participants.find(p=>p.id===f.participantId)?.name || "Participante";
              // Estados del candado de multas (2026-11-26): Pendiente (sin
              // comprobante) · En revisión (pagada con comprobante, sin
              // verificar) · Pagada · Verificada. Las multas viejas pagadas
              // antes del candado no tienen comprobante y se muestran solo
              // «Pagada», sin chip de revisión ni botones.
              const isVerified = f.status==="pagada" && f.verified===1;
              const inReview = f.status==="pagada" && f.verified!==1 && !!f.proofUrl;
              const chip = isVerified ? "Pagada · Verificada" : inReview ? "En revisión" : f.status==="pagada" ? "Pagada" : "Pendiente";
              return (
              <div key={f.id} className="flex flex-wrap items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-3 py-2">
                <span className="text-sm flex-1 min-w-[120px]"><b>{pn}</b> · {money(f.amount)} · {f.reason==="falta"?"Falta":"Retardo"} · periodo {f.quincenaIndex+1} · <b>{chip}</b></span>
                {f.proofUrl && <button aria-label={`Ver comprobante de la multa de ${pn}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>setReceiptView(f.proofUrl)}>Ver comprobante</button>}
                {f.status==="pendiente" && (p.canTreasury || p.isOwn(f.participantId)) && <label className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)] cursor-pointer" aria-label={`Subir comprobante de la multa de ${pn}`}>Subir comprobante<input type="file" accept="image/*" className="hidden" aria-label={`Archivo del comprobante de la multa de ${pn}`} onChange={e=>{ const file=e.target.files?.[0]; if(file) payFine.mutate({tandaId:td.id,fineId:f.id,file}); e.target.value=""; }} /></label>}
                {inReview && p.canVerify && <button aria-label={`Verificar multa de ${pn}`} className="bg-[var(--green)] text-[var(--bg)] rounded-full px-2 py-1 text-xs font-bold" onClick={()=>verifyFine.mutate({tandaId:td.id,fineId:f.id,verified:true})}>Verificar multa</button>}
                {isVerified && p.canVerify && <button aria-label={`Retirar verificación de la multa de ${pn}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>verifyFine.mutate({tandaId:td.id,fineId:f.id,verified:false})}>Retirar verificación</button>}
              </div>
            ); })}
          </div>
          {(payFine.error || verifyFine.error) && <p className="text-sm text-[var(--red)] mt-1">{String(payFine.error || verifyFine.error)}</p>}
        </CollapsibleCard>
        )}
      </div>
      <div>
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Participantes ({td.participants.length}/{td.participantCount})</h4>}
        >
          {td.participants.length===0 && <p className="text-sm text-[var(--dim)] mt-2">Aún no hay participantes. Agréguelos con el formulario de abajo.</p>}
          <div className="flex flex-wrap gap-2 mt-2">
          {[...td.participants].sort((a,b)=>(a.drawOrder??999)-(b.drawOrder??999)).map(pt=>{
            // Destino del turno de un excluido (D1, 2026-11-26): quién lo
            // cubre — un reemplazo (replacesParticipantId) o un participante
            // activo con turno extra (extraDrawOrder).
            const cover = pt.excluded===1 ? td.participants.find(o=>o.extraDrawOrder===pt.drawOrder || o.replacesParticipantId===pt.id) ?? null : null;
            const turnCovered = cover != null;
            const replacedName = pt.replacesParticipantId!=null ? td.participants.find(o=>o.id===pt.replacesParticipantId)?.name ?? null : null;
            const forVotes = td.votes.filter(v=>v.targetParticipantId===pt.id && v.vote==="excluir").length;
            const againstVotes = td.votes.filter(v=>v.targetParticipantId===pt.id && v.vote==="no").length;
            const fullNum = cardFull[pt.id]||"";
            return (
            <span key={pt.id} className="bg-[var(--surface2)] rounded-2xl px-3 py-2 text-sm">
              <b>{pt.drawOrder?`#${pt.drawOrder} · `:""}{pt.name}</b>{pt.fixedDrawOrder!=null && !pt.drawOrder && <span className="text-xs"> · n.º {pt.fixedDrawOrder} fijo</span>}
              <span className="block text-xs">{pt.cardLast4?`•••• ${pt.cardLast4} registrada`:"Sin tarjeta registrada"}</span>
              {pt.cardLast4 && (p.isOwn(pt.id) || p.canManage) && <span className="block mt-0.5">{confirmRemoveCardId===pt.id ? <span className="flex gap-1 items-center"><span className="text-xs">¿Quitar la tarjeta simulada?</span><button aria-label={`Confirmar quitar la tarjeta simulada de ${pt.name}`} className="text-xs underline font-bold" onClick={()=>{ setCard.mutate({id:pt.id,cardLast4:null}); setConfirmRemoveCardId(null); }}>Sí, quitar</button><button aria-label="Cancelar quitar la tarjeta simulada" className="text-xs underline" onClick={()=>setConfirmRemoveCardId(null)}>Cancelar</button></span> : <button aria-label={`Quitar tarjeta simulada de ${pt.name}`} className="text-xs underline font-bold" onClick={()=>setConfirmRemoveCardId(pt.id)}>Quitar tarjeta</button>}</span>}
              {pt.replacesParticipantId!=null && <span className="block text-xs mt-0.5">Reemplazo{replacedName?` de ${replacedName}`:""}{pt.replacementPending>0 ? <> · Debe cubrir <b className="text-[var(--red)]">{money(pt.replacementPending)}</b> pendiente antes de recibir el fondo.</> : " · Sin pendiente."}</span>}
              <span className="block text-xs mt-0.5">Puntaje: <b>{pt.stats.score}/100</b> · {pt.stats.paidCount}/{pt.stats.dueCount} pagos · {pt.stats.onTimePct}% puntuales · Racha: <b>{pt.stats.streak}</b>{pt.excluded===1 && <> · <b className="text-[var(--red)]">Excluido por votación</b>{turnCovered && cover ? <> · Turno cubierto por <b>{cover.name}</b></> : pt.drawOrder!=null ? " · Turno por asignar" : ""}</>}</span>
              <span className="flex gap-1 mt-1 items-center">{p.canManage ? <select aria-label={`Rol de ${pt.name} en ${td.name}`} className={inputCls+" w-auto !py-1 !px-2 text-xs"} value={pt.role} onChange={e=>setRole.mutate({tandaId:td.id,participantId:pt.id,role:e.target.value as "organizador"|"tesorero"|"suplente"|"participante"})}><option value="participante">Participante</option><option value="organizador">Organizador</option><option value="tesorero">Tesorero</option><option value="suplente">Suplente</option></select> : <span className="text-xs font-bold">{pt.role==="organizador"?"Organizador":pt.role==="tesorero"?"Tesorero":pt.role==="suplente"?"Suplente":"Participante"}</span>}{pt.excluded!==1 && (p.isParticipant || p.isAdmin) && !p.isOwn(pt.id) && <><button aria-label={`Proponer exclusión de ${pt.name} de ${td.name}`} className="text-xs underline font-bold" onClick={()=>voteExclude.mutate({tandaId:td.id,targetParticipantId:pt.id,vote:"excluir"})}>Proponer exclusión</button><button aria-label={`Votar en contra de la exclusión de ${pt.name} de ${td.name}`} className="text-xs underline font-bold" onClick={()=>voteExclude.mutate({tandaId:td.id,targetParticipantId:pt.id,vote:"no"})}>Votar en contra</button></>}</span>
              {td.turnsLocked!==1 && (pt.role==="organizador" || pt.role==="tesorero") && p.canManage && (
                <span className="flex gap-1 mt-1 items-center">
                  <label htmlFor={`fixed-${pt.id}`} className="text-xs font-bold">Número fijo</label>
                  <select id={`fixed-${pt.id}`} aria-label={`Número fijo de ${pt.name} en ${td.name}`} className={inputCls+" w-auto !py-1 !px-2 text-xs"} value={pt.fixedDrawOrder ?? ""} onChange={e=>setFixed.mutate({tandaId:td.id,participantId:pt.id,number:e.target.value===""?null:Number(e.target.value)})}>
                    <option value="">Sin fijo</option>
                    {Array.from({length: td.participantCount}, (_,i)=>i+1).map(n=>(<option key={n} value={n} disabled={td.participants.some(o=>o.id!==pt.id && o.fixedDrawOrder===n)}>n.º {n}</option>))}
                  </select>
                  {pt.fixedDrawOrder!=null && <span className="text-xs font-bold">n.º {pt.fixedDrawOrder} fijo</span>}
                </span>
              )}
              {(forVotes>0 || againstVotes>0) && <span className="block text-xs mt-0.5">Votos para excluir: <b>{forVotes}</b> a favor · <b>{againstVotes}</b> en contra de {td.participants.filter(p=>p.excluded!==1).length} activos (se excluye con más de la mitad).</span>}
              {pt.excluded===1 && pt.drawOrder!=null && !turnCovered && p.canManage && (
                <span className="block mt-1 space-y-1">
                  <span className="block text-xs font-bold">Turno n.º {pt.drawOrder} por asignar</span>
                  <span className="flex gap-1 items-center">
                    <select aria-label={`Reasignar el turno de ${pt.name} a`} className={inputCls+" w-auto !py-1 !px-2 text-xs"} value={reassignTo[pt.id]||""} onChange={e=>setReassignTo({...reassignTo,[pt.id]:e.target.value})}>
                      <option value="">Reasignar turno a…</option>
                      {td.participants.filter(o=>o.id!==pt.id && o.excluded!==1).map(o=>(<option key={o.id} value={o.id}>{o.name}</option>))}
                    </select>
                    <button aria-label={`Confirmar reasignación del turno de ${pt.name}`} className="text-xs underline font-bold" disabled={!reassignTo[pt.id] || reassignTurn.isPending} onClick={()=>reassignTurn.mutate({tandaId:td.id,excludedParticipantId:pt.id,newParticipantId:Number(reassignTo[pt.id])})}>Reasignar</button>
                  </span>
                  <span className="flex gap-1 items-center">
                    <input aria-label={`Nombre del reemplazo de ${pt.name}`} placeholder="Nombre del reemplazo" className={inputCls+" w-44 !py-1 !px-2 text-xs"} value={replDraft[pt.id]?.name||""} onChange={e=>setReplDraft({...replDraft,[pt.id]:{name:e.target.value,email:replDraft[pt.id]?.email||""}})} />
                    <input aria-label={`Correo del reemplazo de ${pt.name}`} type="email" placeholder="Correo (opcional)" className={inputCls+" w-44 !py-1 !px-2 text-xs"} value={replDraft[pt.id]?.email||""} onChange={e=>setReplDraft({...replDraft,[pt.id]:{name:replDraft[pt.id]?.name||"",email:e.target.value}})} />
                    <button aria-label={`Agregar reemplazo de ${pt.name}`} className="text-xs underline font-bold" disabled={!(replDraft[pt.id]?.name||"").trim() || addReplacement.isPending} onClick={()=>addReplacement.mutate({tandaId:td.id,excludedParticipantId:pt.id,name:(replDraft[pt.id]?.name||"").trim(),email:(replDraft[pt.id]?.email||"").trim()||undefined})}>Agregar reemplazo</button>
                  </span>
                </span>
              )}
              {!pt.cardLast4 && p.isOwn(pt.id) && <span className="flex gap-1 mt-1"><input aria-label={`Número completo de la tarjeta simulada de ${pt.name}`} maxLength={19} inputMode="numeric" placeholder="Número completo (solo se guardan los últimos 4)" className={inputCls+" w-56"} value={fullNum} onChange={e=>setCardFull({...cardFull,[pt.id]:e.target.value.replace(/[^0-9]/g,"").slice(0,16)})} /><button aria-label={`Registrar tarjeta simulada de ${pt.name}`} className="text-xs underline font-bold" disabled={!luhnOk(fullNum) || setCard.isPending} onClick={()=>setCard.mutate({id:pt.id,cardLast4:fullNum.slice(-4)})}>Registrar</button></span>}
              {fullNum.length>0 && !luhnOk(fullNum) && <span className="block text-xs text-[var(--red)]">El número no es válido. Revíselo.</span>}
              {p.canManage && <button aria-label={`Quitar a ${pt.name} de ${td.name}`} className="text-xs underline text-[var(--red)] block mt-0.5" onClick={()=>removePart.mutate(pt.id)}>Quitar</button>}
            </span>
            );
          })}
          </div>
        {(setRole.error || setFixed.error || voteExclude.error || removePart.error || reassignTurn.error || addReplacement.error) && <p className="text-sm text-[var(--red)] mt-1">{String(setRole.error || setFixed.error || voteExclude.error || removePart.error || reassignTurn.error || addReplacement.error)}</p>}
        {setCard.error && <p className="text-sm text-[var(--red)] mt-1">{String(setCard.error)}</p>}
        {td.participants.length<td.participantCount && p.canManage && <div className="flex flex-wrap gap-2 mt-3">
          <input aria-label={`Nombre del nuevo participante en ${td.name}`} placeholder="Nombre del participante" className={inputCls+" flex-1 min-w-[160px]"} value={partName[td.id]||""} onChange={e=>setPartName({...partName,[td.id]:e.target.value})} />
          <input aria-label={`Tarjeta simulada últimos 4 dígitos en ${td.name}`} placeholder="Últ. 4 díg. (opcional)" maxLength={4} inputMode="numeric" className={inputCls+" w-44"} value={partCard[td.id]||""} onChange={e=>setPartCard({...partCard,[td.id]:e.target.value.replace(/[^0-9]/g,"")})} />
          <button aria-label={`Agregar participante a ${td.name}`} className={btnGhost} onClick={()=>addPart.mutate({tandaId:td.id,name:partName[td.id]||"",cardLast4:partCard[td.id]||undefined})} disabled={!partName[td.id]}>Agregar participante</button>
        </div>}
        {addPart.error && <p className="text-sm text-[var(--red)] mt-1">{String(addPart.error)}</p>}
        <div className="border border-dashed border-[var(--gold)] rounded-2xl p-4 sm:p-5 mt-3">
          <p className="text-sm font-bold">Invitar por correo</p>
          <p className="text-xs text-[var(--dim)] mt-0.5">Enlace directo, un solo uso, 7 días.</p>
          {p.canManage && <div className="flex flex-wrap gap-2 mt-2">
            <input aria-label={`Correo para invitar a ${td.name}`} type="email" placeholder="correo@ejemplo.com" className={inputCls+" flex-1 min-w-[180px]"} value={tInvEmail[td.id]||""} onChange={e=>setTInvEmail({...tInvEmail,[td.id]:e.target.value})} />
            <input aria-label={`Nombre de la persona invitada a ${td.name}`} placeholder="Nombre (opcional)" className={inputCls+" w-44"} value={tInvName[td.id]||""} onChange={e=>setTInvName({...tInvName,[td.id]:e.target.value})} />
            <button aria-label={`Enviar invitación a la tanda ${td.name}`} className={btnGhost} onClick={()=>createTandaInv.mutate({tandaId:td.id})} disabled={!tInvEmail[td.id] || createTandaInv.isPending}>Invitar a la tanda</button>
          </div>}
          {createTandaInv.error && <p className="text-sm text-[var(--red)] mt-1">{String(createTandaInv.error)}</p>}
          {(() => { const tRes = tInvResult[td.id]; if (!tRes) return null; return (
            <div className="text-sm space-y-2 mt-2 border border-[var(--gold)] rounded-2xl p-4 sm:p-5 bg-[var(--surface2)]">
              <p className="font-bold">Enlace de invitación listo{tRes.emailSent?" · también se envió el correo.":""}</p>
              <p className="break-all bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2 text-xs">{tRes.inviteUrl}</p>
              <div className="flex gap-2 flex-wrap">
                <button type="button" className={btnPrimary+" flex-1"} onClick={()=>copyLink(tandaInviteMessage(tRes.inviteUrl, td.name))}>{copiedLink===tandaInviteMessage(tRes.inviteUrl, td.name)?"Invitación copiada":"Copiar invitación"}</button>
                <a className={btnGhost+" flex-1 flex items-center justify-center text-center"} href={`https://wa.me/?text=${encodeURIComponent(tandaInviteMessage(tRes.inviteUrl, td.name))}`} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
              </div>
              {!tRes.emailConfigured && <p className="text-xs text-[var(--dim)]">El correo no está configurado; comparta el enlace por WhatsApp.</p>}
            </div>
          ); })()}
          {td.invitations.filter(iv=>iv.status==="pending").map(iv=>{
            // Solo la invitada ve Aceptar/Rechazar: la sesión activa debe
            // ser la del correo invitado. Quien mandó la invitación (o
            // cualquier otra persona) ve solo el estado con Reenviar; el
            // enlace para copiar/compartir sale al crear o al reenviar (el
            // bloque «Enlace de invitación listo» de arriba). Sin correo de
            // sesión todavía, no se muestra la acción a nadie.
            const isInvitee = myEmail.trim().toLowerCase() !== "" && iv.email.trim().toLowerCase() === myEmail.trim().toLowerCase();
            return (
            <div key={iv.id} className="border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-2 space-y-2 bg-[var(--surface)]">
              {isInvitee ? (<>
              <p className="text-sm"><b>Invitación pendiente</b> para {iv.email}{iv.invitedName?` (${iv.invitedName})`:""}.</p>
              <input aria-label={`Nombre con el que acepta la invitación de ${iv.email}`} placeholder="Nombre con el que participará" className={inputCls} value={tJoinName[iv.id]||iv.invitedName||""} onChange={e=>setTJoinName({...tJoinName,[iv.id]:e.target.value})} />
              <div className="flex gap-2 flex-wrap">
                <button aria-label={`Aceptar invitación de ${iv.email} a ${td.name}`} className={btnPrimary} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:true})} disabled={respondTandaInv.isPending}>Aceptar y participar</button>
                <button aria-label={`Rechazar invitación de ${iv.email} a ${td.name}`} className={btnGhost} onClick={()=>respondTandaInv.mutate({id:iv.id,accept:false})} disabled={respondTandaInv.isPending}>Rechazar</button>
              </div>
              </>) : (<>
              <p className="text-sm">Invitación enviada a {iv.invitedName?`${iv.invitedName} (${iv.email})`:iv.email} — pendiente de aceptar.</p>
              {p.canManage && <div className="flex gap-2 flex-wrap">
                <button aria-label={`Reenviar invitación de ${iv.email} a ${td.name}`} className="text-xs underline font-bold" onClick={()=>resendInv.mutate({kind:"tanda",invitationId:iv.id,tandaId:td.id})}>Reenviar invitación</button>
                <button aria-label={`Eliminar invitación de ${iv.email} a ${td.name}`} className="text-xs underline text-[var(--red)]" onClick={()=>setConfirmCancelTInvId(confirmCancelTInvId===iv.id?null:iv.id)}>Eliminar invitación</button>
              </div>}
              {p.canManage && confirmCancelTInvId===iv.id && <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]"><p className="text-xs">¿Está seguro de eliminar esta invitación?</p><p className="text-xs text-[var(--dim)] mt-1">El enlace dejará de funcionar. Esta acción no se puede deshacer.</p><div className="flex gap-2 mt-2"><button type="button" aria-label={`Confirmar la eliminación de la invitación de ${iv.email} a ${td.name}`} className={btnPrimary} disabled={cancelTandaInv.isPending} onClick={()=>cancelTandaInv.mutate(iv.id)}>{cancelTandaInv.isPending?"Eliminando…":"Eliminar"}</button><button type="button" aria-label="Cancelar la eliminación de la invitación" className={btnGhost} onClick={()=>setConfirmCancelTInvId(null)}>Cancelar</button></div></div>}
              </>)}
            </div>
            );
          })}
          {respondTandaInv.error && <p className="text-sm text-[var(--red)] mt-1">{String(respondTandaInv.error)}</p>}
          {cancelTandaInv.error && <p className="text-sm text-[var(--red)] mt-1">{String(cancelTandaInv.error)}</p>}
          {td.invitations.filter(iv=>iv.status!=="pending").length>0 && <p className="text-xs text-[var(--dim)] mt-2">{td.invitations.filter(iv=>iv.status==="accepted").length} aceptada(s) · {td.invitations.filter(iv=>iv.status==="rejected").length} rechazada(s).</p>}
        </div>
        </CollapsibleCard>
      </div>
      <div>
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Calendario del mes</h4>}
          above={<p className="text-xs text-[var(--dim)] mt-0.5">{td.calendar.length} periodos · {nextPayCal ? `próximo pago ${fmtDate(nextPayCal.date)}` : "sin pagos próximos"}</p>}
        >
          <TandaMonthCalendar td={td} p={p} pickTandaProof={pickTandaProof} />
        </CollapsibleCard>
      </div>
      {tandaProofReview && tandaProofReview.tandaId===td.id && (
        <CollapsibleCard
          asSection
          defaultOpen
          title={<h4 className="font-display font-bold text-sm">Revisar comprobante · {tandaProofReview.participantName} · Periodo {tandaProofReview.quincenaIndex+1}{reviewPeriodDate?` · ${fmtDate(reviewPeriodDate)}`:""}</h4>}
        >
          <TandaProofReviewPanel td={td} review={tandaProofReview} setReview={setTandaProofReview} uploadProof={uploadProof} confirm={confirmTandaProof} />
        </CollapsibleCard>
      )}
      <div>
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Calendario de entregas</h4>}
          above={(()=>{ const cs = tandaCalendarSummary(td.calendar, td.deliveries); return <p className="text-xs text-[var(--dim)] mt-0.5">{cs.periods} periodos · {cs.assigned} con receptor · {cs.confirmed} entregas confirmadas</p>; })()}
        >
          {td.calendar.length===0 && <p className="text-sm text-[var(--dim)] mt-2">Aún no hay periodos.</p>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mt-4">
          {td.calendar.map(c=>(
            <div key={c.index} className={`rounded-2xl border p-3 ${c.receiverName?"border-[var(--gold)] bg-[var(--surface2)]":"border-dashed border-[var(--border)]"}`}>
              <p className="text-xs text-[var(--dim)]">Periodo {c.index+1} · {fmtDate(c.date)}</p>
              <p className="font-display font-bold text-lg">{c.receiverName?`Recibe ${c.receiverName}`:c.turnNote==="por_asignar"?"Turno por asignar":"Pendiente de sorteo"}</p>
              {c.turnNote==="reasignado" && <p className="text-xs text-[var(--dim)]">Turno reasignado.</p>}
              <p className="text-sm whitespace-nowrap">{money(c.amount)}</p>
              {c.receiverName && (()=>{ const dv = td.deliveries.find(x=>x.quincenaIndex===c.index); return (
                <span className="block mt-1.5 space-y-1">
                  <span className="block text-xs">Entrega: {dv?.organizerConfirmed===1 ? <b className="text-[var(--green)]">Confirmada por el organizador</b> : "Sin confirmar por el organizador"} · Recepción: {dv?.receiverConfirmed===1 ? <b className="text-[var(--green)]">Confirmada por quien recibe</b> : "Sin confirmar por quien recibe"}</span>
                  <span className="flex flex-wrap gap-1">
                    {dv?.organizerConfirmed!==1 && p.canTreasury && <button aria-label={`Confirmar entrega del periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>confirmDelivery.mutate({tandaId:td.id,quincenaIndex:c.index,receiverId:c.receiverId,by:"organizador"})}>Confirmo entrega</button>}
                    {dv?.receiverConfirmed!==1 && (p.isAdmin || p.isOwn(c.receiverId ?? -1)) && <button aria-label={`Confirmar recepción del periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 text-xs font-bold border border-[var(--border)]" onClick={()=>confirmDelivery.mutate({tandaId:td.id,quincenaIndex:c.index,receiverId:c.receiverId,by:"receptor"})}>Confirmo recepción</button>}
                  </span>
                </span>
              ); })()}
            </div>
          ))}
          </div>
        {confirmDelivery.error && <p className="text-sm text-[var(--red)] mt-1">{String(confirmDelivery.error)}</p>}
        </CollapsibleCard>
      </div>
      <div>
        <CollapsibleCard
          asSection
          title={<h4 className="font-display font-bold text-sm">Pagos por participante</h4>}
          above={<>
        <p className="text-xs text-[var(--dim)]">Comprobante verificado por el organizador o el tesorero.</p>
        {(()=>{ const ps = tandaPaymentsSummary(td.calendar, td.participants, td.payments); return <p className="text-xs text-[var(--dim)]">{ps.verified} pagos verificados · {ps.unverified} por verificar · {ps.pending} pendientes</p>; })()}
          </>}
        >
          <div className="space-y-2 mt-2">
          {td.calendar.map(c=>{
            const pendCount = td.participants.filter(pt=> (td.payments.find(pay=>pay.participantId===pt.id&&pay.quincenaIndex===c.index)?.status||"pending")!=="paid").length;
            const unverified = td.participants.filter(pt=>{ const pay=td.payments.find(pay=>pay.participantId===pt.id&&pay.quincenaIndex===c.index); return pay?.status==="paid" && pay.verified!==1; }).length;
            return (
            <div key={c.index} className="border border-[var(--border)] rounded-2xl p-4 sm:p-5">
              <p className="text-sm font-bold">Periodo {c.index+1} · {fmtDate(c.date)} {c.receiverName?`· recibe ${c.receiverName}`:""} · {pendCount===0 && td.participants.length>0 ? (unverified>0 ? `Todos con comprobante · ${unverified} por verificar` : "Todos los pagos están verificados") : `${pendCount} pago(s) pendiente(s)`}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {td.participants.map(pt=>{
                  const pay = td.payments.find(x=>x.participantId===pt.id&&x.quincenaIndex===c.index);
                  const paid = pay?.status==="paid";
                  const verified = paid && pay?.verified===1;
                  return (
                    <span key={pt.id} className={`rounded-2xl px-3 py-2 text-xs font-semibold ${verified?"bg-green-100 text-green-900":paid?"bg-amber-100 text-amber-900":"bg-[var(--surface2)]"}`}>
                      {verified ? <button type="button" aria-label={`Ver comprobante verificado de ${pt.name} periodo ${c.index+1}`} className="block text-left underline font-bold" onClick={()=>openVerifiedCard(pt.id, pt.name, c.index)}>{pt.name}: Pago verificado{pay?.paidDate?` · pagó el ${fmtDate(pay.paidDate)}`:""}</button> : <span className="block">{pt.name}: {paid?`En revisión${pay?.proofUrl?" (con comprobante)":" (sin comprobante)"}${pay?.paidDate?` · ${fmtDate(pay.paidDate)}`:""}`:"Pendiente"}</span>}
                      {paid && pay?.proofUrl && pay.proofAmount != null && <span className="block">Comprobante {money2(pay.proofAmount)} · Tanda {money(td.amountPerQuincena)}{Math.abs(pay.proofAmount-td.amountPerQuincena)>0.51?" · No coincide con el monto":" · Coincide con el monto"}</span>}
                      <span className="flex flex-wrap gap-1 mt-1.5">
                        {pay?.proofUrl && <span className="flex items-center gap-1"><img loading="lazy" decoding="async" src={pay.proofUrl} alt={`Comprobante de pago de ${pt.name} periodo ${c.index+1}`} className="w-8 h-8 object-cover rounded-md border border-[var(--border)]" /><button aria-label={`Ver comprobante de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>setReceiptView(pay.proofUrl)}>Ver comprobante</button></span>}
                        {(p.canTreasury || p.isOwn(pt.id)) && <label className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)] cursor-pointer" aria-label={`Subir comprobante de ${pt.name} periodo ${c.index+1} de ${td.name}`}>{pay?.proofUrl?"Cambiar comprobante":"Subir comprobante"}<input type="file" accept="image/*" className="hidden" aria-label={`Archivo del comprobante de ${pt.name} periodo ${c.index+1}`} onChange={e=>{ const f=e.target.files?.[0]; if(f) void pickTandaProof({tandaId:td.id,participantId:pt.id,participantName:pt.name,quincenaIndex:c.index,file:f}); e.target.value=""; }} /></label>}
                        {!paid && (()=>{ const orderId=mpOrders[mpOrderKey(td.id,c.index)] || pay?.mpOrderId || null; if(orderId){ return (<>{p.canTreasury && <button aria-label={`Verificar pago de Mercado Pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" disabled={checkMpOrder.isPending} onClick={()=>checkMpOrder.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,orderId})}>{checkMpOrder.isPending?"Verificando…":"Verificar en Mercado Pago"}</button>}{p.isOwn(pt.id) && <button aria-label={`Cancelar el pago de Mercado Pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>mpClearOrder(td.id,c.index)}>Cancelar</button>}<span className="text-[var(--dim)]">Pago abierto en Mercado Pago (PRUEBA).</span></>); } if(!p.isOwn(pt.id)) return null; return (<><button aria-label={`Pagar con Mercado Pago el periodo ${c.index+1} de ${pt.name} en ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" disabled={createMpOrder.isPending} onClick={()=>createMpOrder.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index})}>{createMpOrder.isPending?"Abriendo pago…":"Pagar con Mercado Pago · PRUEBA"}</button><span className="text-[var(--dim)]">PRUEBA: pague con una cuenta compradora de prueba de Mercado Pago, no con su cuenta real.</span></>); })()}
                        {paid && !verified && p.canVerify && <button aria-label={`Verificar y confirmar el pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--green)] text-[var(--bg)] rounded-full px-2 py-1 font-bold" onClick={()=>verifyPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,verified:true})}>Verificar pago</button>}
                        {verified && p.canVerify && <button aria-label={`Retirar la verificación del pago de ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>verifyPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,verified:false})}>Retirar verificación</button>}
                        {paid && (p.canTreasury || p.isOwn(pt.id)) && <button aria-label={`Marcar pendiente a ${pt.name} periodo ${c.index+1} de ${td.name}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>setPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index,status:"pending"})}>Marcar pendiente</button>}
                        {!paid && p.canTreasury && <button aria-label={`Enviar recordatorio a ${pt.name} periodo ${c.index+1}`} className="bg-[var(--surface)] rounded-full px-2 py-1 font-bold border border-[var(--border)]" onClick={()=>remindPay.mutate({tandaId:td.id,participantId:pt.id,quincenaIndex:c.index})}>{pay?.reminderSent?"Recordatorio enviado":"Enviar recordatorio"}</button>}
                      </span>
                    </span>
                  );
                })}
                {td.participants.length===0 && <span className="text-xs text-[var(--dim)]">Agregue participantes.</span>}
              </div>
            </div>
          );})}
          </div>
        {(uploadProof.error || verifyPay.error || remindPay.error || createMpOrder.error || checkMpOrder.error) && <p className="text-sm text-[var(--red)] mt-1">{String(uploadProof.error || verifyPay.error || remindPay.error || createMpOrder.error || checkMpOrder.error)}</p>}
        </CollapsibleCard>
      </div>
      <CollapsibleCard
        asSection
        title={<h4 className="font-display font-bold text-sm">Calificación del organizador</h4>}
        above={<p className="text-xs text-[var(--dim)] mt-0.5">{td.organizerRating.count>0 ? `${td.organizerRating.avg} de 5 · ${td.organizerRating.count} calificación(es)` : "Aún sin calificaciones."}</p>}
      >
        <p className="text-xs text-[var(--dim)]">Califique al organizador de 1 a 5.</p>
        {(p.isParticipant || p.isAdmin) && td.organizerProfileId !== td.myProfileId && <div className="flex flex-wrap gap-2 mt-2 items-end">
          <div><Label htmlFor={`rate-name-${td.id}`}>Tu nombre</Label><input id={`rate-name-${td.id}`} aria-label={`Tu nombre para calificar al organizador de ${td.name}`} placeholder="Ej. Participante" className={inputCls+" w-44"} value={rateName[td.id]||""} onChange={e=>setRateName({...rateName,[td.id]:e.target.value})} /></div>
          <div><Label htmlFor={`rate-stars-${td.id}`}>Calificación de confiabilidad</Label><select id={`rate-stars-${td.id}`} aria-label={`Estrellas para el organizador de ${td.name}`} className={inputCls+" w-auto"} value={rateStars[td.id]||"5"} onChange={e=>setRateStars({...rateStars,[td.id]:e.target.value})}><option value="5">★★★★★ 5 · Muy confiable</option><option value="4">★★★★ 4 · Confiable</option><option value="3">★★★ 3 · Regular</option><option value="2">★★ 2 · Con incidencias</option><option value="1">★ 1 · No cumplió con lo acordado</option></select></div>
          <div className="flex-1 min-w-[160px]"><Label htmlFor={`rate-comment-${td.id}`}>Comentario (opcional)</Label><input id={`rate-comment-${td.id}`} aria-label={`Comentario sobre el organizador de ${td.name}`} placeholder="Ej. Entregó cada monto en la fecha acordada" className={inputCls} value={rateComment[td.id]||""} onChange={e=>setRateComment({...rateComment,[td.id]:e.target.value})} /></div>
          <button aria-label={`Enviar calificación al organizador de ${td.name}`} className={btnPrimary} onClick={()=>rateOrg.mutate({tandaId:td.id})} disabled={!rateName[td.id] || rateOrg.isPending}>Calificar</button>
        </div>}
        {rateOrg.error && <p className="text-sm text-[var(--red)] mt-1">{String(rateOrg.error)}</p>}
        {td.ratings.length>0 && <div className="mt-2 space-y-1">{td.ratings.map(r=><p key={r.id} className="text-sm"><Stars value={r.stars} size="text-sm" /> <b>{r.raterName}</b>{r.comment?` — “${r.comment}”`:""}</p>)}</div>}
      </CollapsibleCard>
      {verifiedCard && (()=>{ const pay = td.payments.find(x=>x.participantId===verifiedCard.participantId && x.quincenaIndex===verifiedCard.quincenaIndex); if (!pay || pay.verified!==1) return null; return <ComprobanteVerificado data={{ tandaName: td.name, participantName: verifiedCard.participantName, quincenaIndex: verifiedCard.quincenaIndex, amountPerQuincena: td.amountPerQuincena, paidDate: pay.paidDate ?? null, reference: pay.reference, verifiedByName: pay.verifiedByName ?? null, verifiedAt: pay.verifiedAt ?? null, proofUrl: pay.proofUrl ?? null, proofAmount: pay.proofAmount ?? null }} onClose={()=>setVerifiedCard(null)} onViewPhoto={(url)=>setReceiptView(url)} />; })()}
    </div>
  );
}
