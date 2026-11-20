import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, TesterFeedbackForm } from "./App";
import { AuthGate } from "./components/AuthGate";
import "./theme.css";
import appIcon192 from "./assets/app-icon-192.png";
import { registerAppServiceWorker } from "./serviceWorkerUpdate";
import { captureInstallPromptEarly } from "./installPrompt";

// Instalación (PWA): se captura el evento beforeinstallprompt en cuanto
// carga el módulo, antes de que React monte, porque Chrome lo dispara una
// sola vez por carga y puede llegar antes que el oyente de App.
captureInstallPromptEarly();
import appIcon512 from "./assets/app-icon-512.png";

// Instalación en el celular (aplicación instalable, pensada primero para el
// teléfono): el manifiesto se genera al cargar con las rutas reales de los
// iconos ya compilados, porque el empaquetador les asigna nombres con hash y
// un manifiesto estático no podría referenciarlos. El manifiesto estático de
// public/manifest.webmanifest existe como respaldo. Junto con las
// metaetiquetas de index.html, esto permite instalar SyncFinanzas en la
// pantalla principal: Android/Chrome ofrece el botón «Instalar la
// aplicación» y en iPhone se agrega desde Compartir en Safari.
try {
  const base = document.baseURI;
  const manifest = {
    name: "SyncFinanzas — Finanzas del hogar",
    short_name: "SyncFinanzas",
    description:
      "Finanzas del hogar: gastos del día con comprobante, gráficas de ingresos contra gastos, presupuestos, metas, acuerdos y tandas.",
    lang: "es-MX",
    start_url: base,
    scope: base,
    display: "standalone",
    orientation: "portrait",
    background_color: "#151515",
    theme_color: "#151515",
    icons: [
      { src: new URL(appIcon192, base).href, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: new URL(appIcon512, base).href, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: new URL(appIcon512, base).href, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Atajos del icono (Android: mantener presionado el icono): "Registrar
    // gasto" abre la aplicación directo en el formulario de gasto.
    shortcuts: [
      {
        name: "Registrar gasto",
        short_name: "Gasto",
        description: "Registrar un gasto rápido",
        url: "/?accion=nuevo-gasto",
        icons: [{ src: new URL(appIcon192, base).href, sizes: "192x192", type: "image/png" }],
      },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
} catch {
  // Si el navegador no admite el manifiesto dinámico, quedan el manifiesto
  // estático y las metaetiquetas de index.html.
}

// Modo claro / oscuro: se aplica antes de pintar para que la app no
// parpadee al abrir. La elección guardada del usuario (localStorage
// "sf-theme") manda; la primera vez se usa el modo oscuro.
try {
  const stored = localStorage.getItem("sf-theme");
  const dark = stored ? stored === "dark" : true;
  document.documentElement.classList.toggle("dark", dark);
} catch {
  // Sin almacenamiento disponible: queda el modo oscuro.
}

// Service worker (solo en producción): guarda la cáscara de la aplicación
// para que la instalada se abra rápido y siga mostrando la pantalla
// principal sin conexión. Los datos siempre se consultan en línea.
// El módulo serviceWorkerUpdate avisa a la app cuando hay una versión
// nueva, para que muestre el aviso con el botón Actualizar.
registerAppServiceWorker();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const rootEl = document.querySelector<HTMLElement>("#root");
if (!rootEl) {
  throw new Error("missing root element");
}

// Formulario público de opiniones de testers (?feedback=1, segunda etapa):
// se muestra sin sesión ni cuenta, en lugar de la pantalla de acceso.
const isFeedbackForm = (()=>{ try{ return new URLSearchParams(window.location.search).get("feedback")==="1"; }catch{ return false; } })();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div>
        {isFeedbackForm ? <TesterFeedbackForm /> : (
          <AuthGate>
            <App />
          </AuthGate>
        )}
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
