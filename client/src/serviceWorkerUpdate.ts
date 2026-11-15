// Actualizaciones de la aplicación (PWA).
// El service worker guarda la cáscara de la app para que la versión
// instalada abra rápido, pero eso hacía que sirviera la versión vieja
// aunque se recargara: el navegador solo descarga un service worker nuevo
// cuando el archivo cambia, y nada avisaba al usuario.
// Ahora cada despliegue cambia la versión en public/sw.js (SW_VERSION).
// Cuando el navegador encuentra el worker nuevo, este queda en espera sin
// activarse solo, y este módulo avisa a la app (evento sf-update-available)
// para que muestre el aviso "Hay una nueva versión" con el botón
// Actualizar. Al pulsarlo, la página le pide al worker en espera que se
// active (SKIP_WAITING) y recarga cuando toma el control. La sesión y los
// datos no se tocan: viven en Supabase y la recarga solo cambia el código
// de la aplicación.
export const APP_UPDATE_EVENT = "sf-update-available";

let registration: ServiceWorkerRegistration | null = null;
let updateApplied = false;
let reloadScheduled = false;

function notifyUpdateAvailable() {
  window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
}

function trackWorker(worker: ServiceWorker | null) {
  if (!worker) return;
  if (worker.state === "installed" && registration?.waiting === worker) notifyUpdateAvailable();
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && registration?.waiting === worker) notifyUpdateAvailable();
  });
}

function waitForWaiting(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (reg.waiting) return resolve(true);
    const worker = reg.installing;
    if (!worker) return resolve(false);
    const timer = window.setTimeout(() => resolve(!!reg.waiting), timeoutMs);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" || worker.state === "redundant") {
        window.clearTimeout(timer);
        resolve(!!reg.waiting);
      }
    });
  });
}

export function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        if (reg.waiting) notifyUpdateAvailable();
        reg.addEventListener("updatefound", () => trackWorker(reg.installing));
        // Revisar si hay versión nueva al volver a la app.
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) void checkForAppUpdate();
        });
      })
      .catch(() => {
        // Sin service worker la aplicación sigue funcionando en línea.
      });
  });
  // Recargar solo cuando se aplicó una actualización (no en la primera
  // instalación, donde el worker también toma el control).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateApplied && !reloadScheduled) {
      reloadScheduled = true;
      window.location.reload();
    }
  });
}

// Revisión manual (Hogar → Buscar actualizaciones). Devuelve si hay una
// versión nueva en espera, si ya está al día, o si no se pudo revisar.
export async function checkForAppUpdate(): Promise<"update" | "latest" | "unavailable"> {
  if (!registration) return "unavailable";
  try {
    await registration.update();
  } catch {
    return "unavailable";
  }
  if (registration.waiting) {
    notifyUpdateAvailable();
    return "update";
  }
  const found = await waitForWaiting(registration, 10000);
  if (found) {
    notifyUpdateAvailable();
    return "update";
  }
  return "latest";
}

// Aplica la versión nueva en espera: el worker se activa y la página
// recarga sola cuando toma el control. No cierra la sesión ni borra datos.
export function applyAppUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return;
  updateApplied = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}
