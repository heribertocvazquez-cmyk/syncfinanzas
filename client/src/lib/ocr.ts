// Lectura de comprobantes en el dispositivo con Tesseract.js (gratuito).
// El motor se carga solo cuando se usa (import dinámico): no engorda el
// paquete inicial. El núcleo, el worker y los datos del idioma español se
// sirven DESDE LA MISMA APP (public/tesseract/, copiados en cada build por
// scripts/fetch-tesseract-assets.mjs): antes se descargaban de la CDN de
// jsdelivr la primera vez (~9 MB) y en un teléfono con 4G esa descarga
// fallaba y la lectura no arrancaba. La foto no sale del dispositivo a
// ningún servidor de SyncFinanzas ni de OpenAI. Tras la primera lectura,
// el núcleo y el idioma quedan guardados en la caché del dispositivo
// (caché del navegador + IndexedDB), así que las siguientes lecturas no
// descargan nada.
//
// POR QUÉ FALLABA EN IPHONE (2026-11-17): la versión f44d730 ya servía
// los archivos desde la app, pero Tesseract.js 6 crea el worker desde
// una URL blob por defecto (workerBlobURL: true). La CSP de la app
// permite worker-src 'self', pero en WebKit/Safari las URLs blob NO
// coinciden con 'self' (bug de WebKit 153158) y Safari ni siquiera
// soporta worker-src (recae en script-src); además, en WebKit un worker
// blob se rechaza bajo CSP incluso con worker-src blob: explícito. Por
// eso new Worker(blobURL) falla SIEMPRE en iPhone con SecurityError,
// mientras en Chrome/Android funciona. La corrección es crear el worker
// directo desde el mismo origen (workerBlobURL: false), que solo necesita
// worker-src 'self' y funciona en los tres motores. Como el fallo era
// constante y no una descarga lenta, la carga prueba varias formas en
// escalera (directo, directo sin SIMD, blob, blob sin SIMD) y guarda el
// motivo real de cada intento en OcrError.detail, para que el siguiente
// fallo diga exactamente qué se rompió.

export type OcrProgress = { status: string; progress: number; downloadedMB?: number; totalMB?: number };

// Causa del fallo, para que la app diga el motivo real en vez del texto
// genérico de conexión: "load" = no se pudo cargar el lector (primera
// descarga o archivos ausentes); "read" = el lector cargó pero no pudo
// leer el texto de la imagen. `detail` lleva el motivo técnico (intentos,
// estados HTTP, error del navegador) y se muestra en letra pequeña bajo
// el mensaje, para diagnosticar el siguiente fallo.
export class OcrError extends Error {
  code: "load" | "read";
  detail: string;
  constructor(code: "load" | "read", message: string, detail = "") {
    super(message);
    this.name = "OcrError";
    this.code = code;
    this.detail = detail;
  }
}

// Tamaños reales de los archivos del lector (MB, medidos en el despliegue):
// el núcleo lleva el wasm incrustado en el .js, así que el .wasm aparte
// nunca se descarga.
const CORE_MB = 3.95;
const LANG_MB = 8.36;

function fmtMB(mb: number): string {
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

// Texto de progreso en lenguaje claro: en la primera lectura se descarga
// el lector, y la persona debe saber que eso es normal y solo pasa una vez.
export function ocrStatusText(status: string, progress: number, downloadedMB?: number, totalMB?: number): string {
  const mb = downloadedMB != null && totalMB != null ? ` ${fmtMB(downloadedMB)} de ${fmtMB(totalMB)}` : "";
  if (status === "loading tesseract core") return `Descargando el lector (solo la primera vez)…${mb}`;
  if (status === "loading language traineddata") return `Descargando el idioma español (solo la primera vez)…${mb}`;
  if (status === "initializing tesseract" || status === "initializing api") return "Preparando el lector…";
  if (status === "retrying") return "Probando otra forma de cargar el lector…";
  if (status === "recognizing text") return `Leyendo el comprobante… ${Math.round((progress || 0) * 100)}%`;
  return "Leyendo el comprobante…";
}

export const OCR_WORKER_PATH = "/tesseract/worker.min.js";
export const OCR_CORE_DIR = "/tesseract/core";
export const OCR_CORE_SIMD = "/tesseract/core/tesseract-core-simd-lstm.wasm.js";
export const OCR_CORE_LSTM = "/tesseract/core/tesseract-core-lstm.wasm.js";
export const OCR_LANG_PATH = "/tesseract/lang";

// Escalera de carga: el primer intento es el worker directo desde el mismo
// origen (el que funciona en Safari bajo CSP); los demás son respaldos por
// si el directo falla en otro navegador o el núcleo SIMD no arranca en el
// dispositivo (el núcleo sin SIMD es el mismo motor sin esa optimización).
export type OcrStrategy = { name: string; workerBlobURL: boolean; corePath: string };
export const OCR_STRATEGIES: OcrStrategy[] = [
  { name: "directo", workerBlobURL: false, corePath: OCR_CORE_DIR },
  { name: "directo-sin-simd", workerBlobURL: false, corePath: OCR_CORE_LSTM },
  { name: "blob", workerBlobURL: true, corePath: OCR_CORE_DIR },
  { name: "blob-sin-simd", workerBlobURL: true, corePath: OCR_CORE_LSTM },
];

const OCR_ATTEMPT_TIMEOUT_MS = 45_000;

// Revisión previa: el archivo debe existir en la app antes de intentar
// cargar el lector. HEAD no pasa por el service worker (solo atiende GET),
// así que comprueba el archivo real en el servidor.
async function headStatus(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return `HTTP ${res.status}`;
  } catch (err) {
    return `sin respuesta (${err instanceof Error ? err.name : "error"})`;
  }
}

type TesseractModule = typeof import("tesseract.js");
type TesseractWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>;

async function tryLoadStrategy(
  mod: TesseractModule,
  strategy: OcrStrategy,
  onProgress: (p: OcrProgress) => void,
  attemptLog: string[],
): Promise<TesseractWorker> {
  let lastStatus = "";
  const workerPromise = mod.createWorker("spa", 1, {
    workerPath: OCR_WORKER_PATH,
    workerBlobURL: strategy.workerBlobURL,
    corePath: strategy.corePath,
    langPath: OCR_LANG_PATH,
    cacheMethod: "write",
    logger: (m: { status: string; progress?: number }) => {
      lastStatus = m.status;
      const progress = m.progress ?? 0;
      let downloadedMB: number | undefined;
      let totalMB: number | undefined;
      if (m.status === "loading tesseract core") {
        downloadedMB = progress * CORE_MB;
        totalMB = CORE_MB;
      } else if (m.status === "loading language traineddata") {
        downloadedMB = progress * LANG_MB;
        totalMB = LANG_MB;
      }
      onProgress({ status: m.status, progress, downloadedMB, totalMB });
    },
  });
  try {
    return await Promise.race([
      workerPromise,
      new Promise<never>((_res, rej) => setTimeout(() => rej(new Error("tiempo agotado")), OCR_ATTEMPT_TIMEOUT_MS)),
    ]);
  } catch (err) {
    // Si el worker termina de cargar después del tiempo límite, se apaga
    // para no dejarlo corriendo en segundo plano.
    void workerPromise.then((w) => w.terminate()).catch(() => {});
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    attemptLog.push(`${strategy.name}: ${msg}${lastStatus ? ` (último estado: ${lastStatus})` : ""}`);
    throw err;
  }
}

export async function readReceiptText(imageSrc: string, onProgress?: (p: OcrProgress) => void): Promise<string> {
  const attemptLog: string[] = [];
  const emit = (p: OcrProgress) => onProgress?.(p);
  // Revisión previa de los archivos del lector.
  const workerStatus = await headStatus(OCR_WORKER_PATH);
  const simdStatus = await headStatus(OCR_CORE_SIMD);
  const lstmStatus = await headStatus(OCR_CORE_LSTM);
  attemptLog.push(`archivos: worker.min.js ${workerStatus}; núcleo SIMD ${simdStatus}; núcleo sin-SIMD ${lstmStatus}`);
  if (!workerStatus.startsWith("HTTP 2")) {
    throw new OcrError(
      "load",
      "No se pudo cargar el lector de comprobantes.",
      `No se encontró el archivo del lector (${OCR_WORKER_PATH}: ${workerStatus}). ${attemptLog.join(" | ")}`,
    );
  }
  // Solo se intentan las formas cuyos archivos existen.
  const strategies = OCR_STRATEGIES.filter((s) => {
    const coreStatus = s.corePath === OCR_CORE_LSTM ? lstmStatus : simdStatus;
    return coreStatus.startsWith("HTTP 2");
  });
  if (strategies.length === 0) {
    throw new OcrError(
      "load",
      "No se pudo cargar el lector de comprobantes.",
      `No se encontró el núcleo del lector (SIMD ${simdStatus}; sin-SIMD ${lstmStatus}).`,
    );
  }
  const mod = await import("tesseract.js");
  let worker: TesseractWorker | null = null;
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    if (!strategy) continue;
    if (i > 0) emit({ status: "retrying", progress: 0 });
    try {
      worker = await tryLoadStrategy(mod, strategy, emit, attemptLog);
      break;
    } catch {
      worker = null;
    }
  }
  if (!worker) {
    throw new OcrError("load", "No se pudo cargar el lector de comprobantes.", attemptLog.join(" | "));
  }
  try {
    const { data } = await worker.recognize(imageSrc);
    return data.text || "";
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new OcrError("read", "No se pudo leer el texto del comprobante.", msg);
  } finally {
    await worker.terminate();
  }
}
