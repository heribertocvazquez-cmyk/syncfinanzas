// Tarjeta y diálogo de instalación en el celular (PWA), extraídos de
// App.tsx (donde vivían en línea) para poder probar la guía que aparece
// sola la primera vez y el botón «Ya la instalé».
//
// Mejora «Acceso más fácil para mayores» (2026-11-21): la primera vez que
// un usuario NO instalado abre la app, la guía de instalación se muestra
// expandida por sí misma; «Ya la instalé» (o descartarla con la ×) la
// cierra y marca vista, y ya no vuelve a aparecer sola. La bandera vive en
// el dispositivo (localStorage «sf-guia-instalar-vista»); sin
// localStorage no se puede recordar y la guía se muestra.
//
// INTEGRACIÓN (la hace el agente de despliegue en App.tsx): borrar las
// definiciones en línea de InstallCard, InstallStepsDialog, INSTALL_STEPS
// y detectInstallPlatform, importarlas de aquí, e inicializar el estado
// con shouldAutoShowInstallGuide(detectStandalone()):
//   const [installStepsOpen,setInstallStepsOpen]=useState(() => shouldAutoShowInstallGuide(detectStandalone()));
// El resto no cambia: InstallCard e InstallStepsDialog conservan sus props.
import appIcon512 from "../assets/app-icon-512.png";
import { btnPrimary } from "../lib/uiShared";

// Bandera de «la guía de instalación ya se vio» en este dispositivo.
export const INSTALL_GUIDE_SEEN_KEY = "sf-guia-instalar-vista";

export function installGuideSeen(): boolean {
  try { return localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) === "1"; }
  catch { return false; }
}

export function markInstallGuideSeen(): void {
  try { localStorage.setItem(INSTALL_GUIDE_SEEN_KEY, "1"); }
  catch { /* sin almacenamiento no se puede recordar; la guía se mostrará de nuevo */ }
}

// ¿La guía debe aparecer sola al abrir la app? Sí, salvo que ya esté
// instalada o que ya se haya visto (o descartado). Sin localStorage no se
// puede recordar y se muestra.
export function shouldAutoShowInstallGuide(installed: boolean): boolean {
  if (installed) return false;
  try { return localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) !== "1"; }
  catch { return true; }
}

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
type InstallPlatform = "ios" | "android" | "desktop";
function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
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
export function InstallCard({ installed, onInstall, onDismiss }: { installed: boolean; onInstall: () => void; onDismiss?: () => void }) {
  return (
    <div className="bg-[var(--surface)] border-2 border-[var(--gold)] rounded-2xl px-3 py-2 flex items-center gap-2">
      <img src={appIcon512} alt="Icono de SyncFinanzas: una casa blanca con flechas de sincronización doradas sobre fondo azul marino" className="w-9 h-9 rounded-xl shrink-0 border border-[var(--border)]" />
      <p className="text-sm font-bold flex-1 min-w-0">Instale SyncFinanzas en su celular</p>
      {installed ? (
        <p className="text-sm font-semibold text-[var(--green)] shrink-0" role="status">Ya instalada.</p>
      ) : (
        <button type="button" aria-label="Instalar la aplicación SyncFinanzas en este dispositivo" className={btnPrimary + " shrink-0"} onClick={onInstall}>Instalar</button>
      )}
      {onDismiss && <button type="button" aria-label="Descartar el aviso de instalación" onClick={() => { markInstallGuideSeen(); onDismiss(); }} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>}
    </div>
  );
}
// En iPhone no hay instalación automática: el botón abre estos pasos cortos.
// En Android/Chrome, si el navegador ofrece la instalación, el botón la dispara.
// Cerrar el diálogo por cualquier vía (botón «Ya la instalé», × o tocar
// fuera) marca la guía como vista: ya no vuelve a aparecer sola.
export function InstallStepsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const platform = detectInstallPlatform();
  const title = platform === "ios" ? "Instalar en iPhone" : platform === "android" ? "Instalar en Android" : "Instalar en la computadora";
  const close = () => { markInstallGuideSeen(); onClose(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title} onClick={close}>
      <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-sm p-3.5" onClick={e=>e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display font-bold text-lg">{title}</h2>
          <button type="button" aria-label="Cerrar las instrucciones de instalación" onClick={close} className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold">×</button>
        </div>
        <p className="text-sm text-[var(--dim)] mt-2">El navegador no ofrece la instalación directa en este momento (por ejemplo, si el aviso se descartó antes). Siga estos pasos:</p>
        <ol className="list-decimal ml-5 text-sm space-y-1.5 mt-3">
          {INSTALL_STEPS[platform].map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {platform === "android" && <p className="text-xs text-[var(--dim)] mt-3">Si no aparece «Instalar y crear acceso directo», es posible que la aplicación ya esté instalada.</p>}
        <button type="button" className={btnPrimary + " mt-3 w-full"} onClick={close}>Ya la instalé</button>
      </div>
    </div>
  );
}
