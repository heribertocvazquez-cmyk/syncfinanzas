// Instalación de la aplicación (PWA): captura temprana del evento del navegador.
//
// Chrome dispara `beforeinstallprompt` una sola vez por carga y puede llegar
// antes de que React monte la aplicación; si el único oyente vivía en un
// useEffect de App, el evento se perdía y el botón Instalar solo podía
// mostrar los pasos manuales. Por eso el oyente se registra aquí, en cuanto
// el módulo se carga desde main.tsx, y el evento queda guardado para que App
// lo tome al montar. El evento solo sirve una vez: al usarlo se limpia.
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let capturing = false;

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function consumeDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  const e = deferred;
  deferred = null;
  return e;
}

export function clearDeferredInstallPrompt(): void {
  deferred = null;
}

export function captureInstallPromptEarly(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
  });
}
