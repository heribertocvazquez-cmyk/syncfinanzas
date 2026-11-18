// Lectura de comprobantes en el dispositivo con Tesseract.js (gratuito).
// El motor se carga solo cuando se usa (import dinámico): no engorda el
// paquete inicial. El núcleo, el worker y los datos del idioma español se
// sirven DESDE LA MISMA APP (public/tesseract/, copiados en cada build por
// scripts/fetch-tesseract-assets.mjs): antes se descargaban de la CDN de
// jsdelivr la primera vez (~9 MB) y en un teléfono con 4G esa descarga
// fallaba y la lectura no arrancaba. La foto no sale del dispositivo a
// ningún servidor de SyncFinanzas ni de OpenAI. Tras la primera lectura,
// el núcleo y el idioma quedan guardados en la caché del dispositivo
// (service worker + IndexedDB), así que las siguientes lecturas no
// descargan nada.

export type OcrProgress = { status: string; progress: number };

// Causa del fallo, para que la app diga el motivo real en vez del texto
// genérico de conexión: "load" = no se pudo cargar el lector (primera
// descarga o archivos ausentes); "read" = el lector cargó pero no pudo
// leer el texto de la imagen.
export class OcrError extends Error {
  code: "load" | "read";
  constructor(code: "load" | "read", message: string) {
    super(message);
    this.name = "OcrError";
    this.code = code;
  }
}

// Texto de progreso en lenguaje claro: en la primera lectura se descarga
// el lector, y la persona debe saber que eso es normal y solo pasa una vez.
export function ocrStatusText(status: string, progress: number): string {
  if (status === "loading tesseract core") return "Descargando el lector (solo la primera vez)…";
  if (status === "loading language traineddata") return "Descargando el idioma español (solo la primera vez)…";
  if (status === "initializing tesseract" || status === "initializing api") return "Preparando el lector…";
  if (status === "recognizing text") return `Leyendo el comprobante… ${Math.round((progress || 0) * 100)}%`;
  return "Leyendo el comprobante…";
}

const OCR_LOAD_TIMEOUT_MS = 120_000;

export async function readReceiptText(imageSrc: string, onProgress?: (p: OcrProgress) => void): Promise<string> {
  const mod = await import("tesseract.js");
  const workerPromise = mod.createWorker("spa", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    cacheMethod: "write",
    logger: (m: { status: string; progress?: number }) => {
      onProgress?.({ status: m.status, progress: m.progress ?? 0 });
    },
  });
  let worker: Awaited<typeof workerPromise> | null = null;
  try {
    worker = await Promise.race([
      workerPromise,
      new Promise<never>((_res, rej) =>
        setTimeout(() => rej(new OcrError("load", "ocr-load-timeout")), OCR_LOAD_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // Si el worker termina de cargar después del tiempo límite, se apaga
    // para no dejarlo corriendo en segundo plano.
    void workerPromise.then((w) => w.terminate()).catch(() => {});
    if (err instanceof OcrError) throw err;
    throw new OcrError("load", "No se pudo cargar el lector de comprobantes.");
  }
  try {
    const { data } = await worker.recognize(imageSrc);
    return data.text || "";
  } catch {
    throw new OcrError("read", "No se pudo leer el texto del comprobante.");
  } finally {
    await worker.terminate();
  }
}
