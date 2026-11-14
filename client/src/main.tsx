import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import "./theme.css";
import appIcon192 from "./assets/app-icon-192.png";
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
    background_color: "#F4F6F5",
    theme_color: "#0E2F3D",
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

// Service worker (solo en producción): guarda la cáscara de la aplicación
// para que la instalada se abra rápido y siga mostrando la pantalla
// principal sin conexión. Los datos siempre se consultan en línea.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sin service worker la aplicación sigue funcionando en línea.
    });
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const rootEl = document.querySelector<HTMLElement>("#root");
if (!rootEl) {
  throw new Error("missing root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div>
        <AuthGate>
          <App />
        </AuthGate>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
