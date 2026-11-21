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
// Aviso de que la actualización en espera ya no existe (el worker se
// volvió redundante o el navegador lo descartó): la app oculta el aviso
// para no ofrecer un botón que no puede hacer nada.
export const APP_UPDATE_GONE_EVENT = "sf-update-gone";
// Tiempo límite para que la recarga llegue tras pedir la activación:
// si no llega, el botón vuelve a servir con «Reintentar».
export const UPDATE_APPLY_TIMEOUT_MS = 15000;

let registration: ServiceWorkerRegistration | null = null;
let updateNotified = false;
let updateApplied = false;
let reloadScheduled = false;

function notifyUpdateAvailable() {
  updateNotified = true;
  window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
}

function notifyUpdateGone() {
  if (!updateNotified) return;
  updateNotified = false;
  window.dispatchEvent(new CustomEvent(APP_UPDATE_GONE_EVENT));
}

// Limpia el aviso cuando ya no hay worker en espera: la bandera
// `updateNotified` se prendía una vez y quedaba prendida para siempre,
// así que el aviso seguía ofreciendo actualizar aunque el worker en
// espera ya no existiera (redundante tras otra revisión, o descartado
// por el navegador). Pulsar Actualizar entonces no hacía nada y el
// botón se quedaba en «Actualizando…» sin salida.
function clearStaleNotice() {
  if (!updateNotified) return;
  if (registration?.waiting) return;
  notifyUpdateGone();
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
    // El worker en espera se volvió redundante (otra revisión instaló
    // uno más nuevo, o el navegador lo descartó): el aviso ya no vale.
    if (worker.state === "redundant") clearStaleNotice();
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
        if (reg.waiting) {
          notifyUpdateAvailable();
          // Seguir también al worker que ya estaba en espera: si se
          // vuelve redundante, el aviso debe apagarse.
          trackWorker(reg.waiting);
        }
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
  // No hay worker en espera: si el aviso seguía prendido de una
  // revisión anterior, ya no vale y se apaga.
  clearStaleNotice();
  return "latest";
}

// Aplica la versión nueva en espera: el worker se activa y la página
// recarga sola cuando toma el control. No cierra la sesión ni borra datos.
// Devuelve si se aplicó o si ya no había actualización en espera: antes
// era void y si no había worker en espera no hacía nada en silencio,
// mientras la app ya había puesto el botón en «Actualizando…» y nunca
// lo volvía a habilitar. Si no hay worker en espera, reintenta una
// revisión antes de rendirse.
export async function applyAppUpdate(): Promise<"applied" | "no-update"> {
  let waiting = registration?.waiting ?? null;
  if (!waiting && registration) {
    try {
      await registration.update();
    } catch {
      // Sin red no se puede revisar: no hay nada que aplicar.
    }
    await waitForWaiting(registration, 10000);
    waiting = registration.waiting;
  }
  if (!waiting) {
    clearStaleNotice();
    return "no-update";
  }
  updateApplied = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
  return "applied";
}
