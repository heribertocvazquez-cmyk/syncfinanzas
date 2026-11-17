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
//
// REVISIONES: además de al volver a la app, se revisa 3 veces al día
// (cada 8 horas), al recuperar el foco, al restaurar la página y al abrir
// la campanilla. Tres veces al día basta para avisar sin gastar recurso
// ni memoria: cada revisión es solo una petición pequeña del archivo
// sw.js, y en segundo plano los temporizadores se suspenden. El navegador
// por su cuenta solo revisa una vez cada 24 h; estas revisiones usan
// registration.update() explícito, que salta ese límite, igual que el
// botón manual "Buscar actualizaciones".
export const APP_UPDATE_EVENT = "sf-update-available";

let registration: ServiceWorkerRegistration | null = null;
let updateNotified = false;
let updateApplied = false;
let reloadScheduled = false;

function notifyUpdateAvailable() {
  updateNotified = true;
  window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
}

// Si el aviso ya se disparó antes de que la app montara su oyente (el
// worker nuevo quedó en espera antes de que React montara), la app lo
// puede consultar al arrancar en vez de esperar a que el evento llegue.
export function isUpdateAvailable() {
  return updateNotified || !!registration?.waiting;
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
        // Revisión periódica 3 veces al día (cada 8 horas): basta para
        // avisar de una versión nueva sin gastar recurso ni memoria; en
        // segundo plano los temporizadores se suspenden.
        window.setInterval(() => {
          void checkForAppUpdate();
        }, 8 * 60 * 60 * 1000);
        // Revisar también al recuperar el foco y al restaurar la página:
        // en iPhone la PWA no recarga al reabrirla, así que la navegación
        // no dispara la revisión.
        window.addEventListener("focus", () => {
          void checkForAppUpdate();
        });
        window.addEventListener("pageshow", () => {
          void checkForAppUpdate();
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
