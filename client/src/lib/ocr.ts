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
//
// POR QUÉ SEGUÍA FALLANDO (2026-11-17, tercera ronda): con el worker
// directo los archivos daban HTTP 200 y el worker arrancaba, pero se
// quedaba colgado en "initializing tesseract" hasta el tiempo límite
// (45 s) en los dos intentos directos, y los intentos blob daban
// "undefined". La causa era la CSP: script-src 'self' NO permite
// compilar WebAssembly — hace falta 'wasm-unsafe-eval' (CSP nivel 3;
// Safari 16+, Chrome 97+, Firefox 102+). El núcleo del lector se
// compila con WebAssembly.instantiateStreaming (o instantiate desde un
// búfer) justo en "initializing tesseract": el navegador rechaza la
// compilación dentro del worker, el worker nunca resuelve y la promesa
// del hilo principal nunca se cumple, así que solo queda el tiempo
// límite. Los datos del idioma vienen DESPUÉS ("initializing api" y
// luego "loading language traineddata"), así que no eran el bloqueo.
// El "undefined" de los intentos blob es otro síntoma de lo mismo:
// tesseract.js rechaza la promesa del worker con el mensaje del evento
// de error (worker.onerror = t => reject(t.message)), y cuando la carga
// del script del worker se bloquea por CSP ese mensaje viene vacío.
// La corrección es 'wasm-unsafe-eval' en script-src (solo permite
// compilar WebAssembly; eval() de JavaScript sigue bloqueado), más una
// comprobación rápida de WebAssembly antes de la escalera para que un
// bloqueo así falle de inmediato con su motivo, en vez de colgarse.

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

// Convierte cualquier valor rechazado en texto diagnóstico. Tesseract.js
// rechaza a veces SIN valor (undefined): cuando la carga del script del
// worker se bloquea, su onerror rechaza la promesa con el mensaje del
// evento de error, y en Safari ese mensaje viene vacío, así que
// `String(undefined)` era todo el diagnóstico ("blob: undefined").
export function serializeErr(err: unknown): string {
  if (err === undefined) return "rechazado sin valor (undefined)";
  if (err === null) return "rechazado sin valor (null)";
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

// Comprobación rápida de WebAssembly antes de cargar el lector: compila
// un módulo mínimo válido (solo la cabecera). Si la CSP del sitio no
// incluye 'wasm-unsafe-eval' en script-src, el navegador rechaza la
// compilación y el worker se queda colgado en "initializing tesseract"
// hasta el tiempo límite de cada intento, sin decir nada. Esta prueba
// falla de inmediato con su motivo, en el hilo principal, antes de
// gastar 4 intentos de 45 s.
const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export async function checkWasmAllowed(): Promise<void> {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.compile !== "function") {
    throw new OcrError(
      "load",
      "No se pudo cargar el lector de comprobantes.",
      "Este navegador no permite compilar WebAssembly, que es lo que usa el lector.",
    );
  }
  try {
    await WebAssembly.compile(WASM_MAGIC);
  } catch (err) {
    throw new OcrError(
      "load",
      "No se pudo cargar el lector de comprobantes.",
      `El navegador bloquea la compilación de WebAssembly (la política de seguridad del sitio no lo permite; hace falta 'wasm-unsafe-eval' en script-src). ${serializeErr(err)}`,
    );
  }
}

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
  if (status === "retry-read") return "Probando otra forma de leer el comprobante…";
  if (status === "recognizing text") return `Leyendo el comprobante… ${Math.round((progress || 0) * 100)}%`;
  return "Leyendo el comprobante…";
}

// ---- Preparación de la foto antes de leerla (texto chico y denso) ----

// Pasa los píxeles de un canvas a grises y estira el contraste entre los
// percentiles 1 y 99: el texto gris de un comprobante en papel sale negro
// sobre blanco, que es lo que Tesseract lee mejor. Función pura sobre los
// datos del canvas, para poder probarla sin navegador.
export function enhanceReceiptPixels(data: Uint8ClampedArray): void {
  const n = data.length / 4;
  if (n === 0) return;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gray[i] = Math.round(0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!);
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]!]!++;
  const edge = Math.max(1, Math.floor(n * 0.01));
  let lo = 0;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= edge) { lo = v; break; }
  }
  let hi = 255;
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= edge) { hi = v; break; }
  }
  if (hi - lo < 16) return; // casi plano o ya blanco y negro: no tocar
  const span = hi - lo;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let v = Math.round(((gray[i]! - lo) * 255) / span);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
  }
}

// Amplía la foto cuando es chica (hasta 2x, con el lado mayor en 3200 px
// como tope), la pasa a grises y le estira el contraste. La foto de un
// comprobante en papel suele traer el texto de pocos píxeles: sin esto,
// Tesseract no devuelve nada útil. Todo en el dispositivo, con el canvas
// del navegador, sin dependencias nuevas.
export async function preprocessReceiptImage(imageSrc: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("No se pudo cargar la imagen para prepararla."));
    img.src = imageSrc;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("No se pudo medir la imagen para prepararla.");
  const scale = Math.min(2, 3200 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("No fue posible procesar la imagen en este dispositivo.");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = cx.getImageData(0, 0, canvas.width, canvas.height);
  enhanceReceiptPixels(imageData.data);
  cx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Calidad de un texto leído: palabras reales + dígitos + señales de
// importe y fecha. Sirve para quedarse con el mejor intento de lectura.
export function scoreOcrText(text: string): number {
  const words = text.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/g) || [];
  const digits = text.match(/\d/g) || [];
  let score = words.length * 2 + digits.length;
  if (/\$?\s*\d[\d,]*\.\d{2}/.test(text)) score += 20;
  if (/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(text)) score += 20;
  return score;
}

// Un texto sirve para analizarlo: trae varias palabras o un importe.
export function isUsableOcrText(text: string): boolean {
  return scoreOcrText(text) >= 20;
}

type PsmMode = NonNullable<Parameters<TesseractWorker["setParameters"]>[0]["tessedit_pageseg_mode"]>;

// Lee la foto con reintentos: primero como viene (PSM automático, el
// comportamiento actual); si el texto no sirve, reintenta con la foto
// preparada (ampliada, grises, contraste) en PSM 6 y luego en PSM 11, y
// se queda con el mejor texto. Si un intento falla (el lector se cae con
// esa imagen), se sigue con el siguiente en vez de fallar de inmediato;
// solo si ningún intento devuelve texto se lanza el error de lectura.
// Los modos PSM vienen del módulo cargado en forma dinámica (mod.PSM)
// para no meter tesseract.js en el paquete inicial.
async function recognizeWithRetries(
  worker: TesseractWorker,
  imageSrc: string,
  emit: (p: OcrProgress) => void,
  attemptLog: string[],
  psmEnum: TesseractModule["PSM"],
): Promise<string> {
  let bestText = "";
  let bestScore = -1;
  let preparedSrc: string | null = null;
  const prepare = async (): Promise<string> => {
    if (preparedSrc == null) preparedSrc = await preprocessReceiptImage(imageSrc);
    return preparedSrc;
  };
  const attempts: { label: string; psm: PsmMode; src: () => Promise<string> }[] = [
    { label: "original PSM 3", psm: psmEnum.AUTO, src: async () => imageSrc },
    { label: "preparada PSM 6", psm: psmEnum.SINGLE_BLOCK, src: prepare },
    { label: "preparada PSM 11", psm: psmEnum.SPARSE_TEXT, src: prepare },
  ];
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]!;
    if (i > 0) {
      if (isUsableOcrText(bestText)) break;
      emit({ status: "retry-read", progress: 0 });
    }
    let src: string;
    try {
      src = await attempt.src();
    } catch (err) {
      attemptLog.push(`${attempt.label}: no se pudo preparar la imagen (${serializeErr(err)})`);
      continue;
    }
    try {
      await worker.setParameters({ tessedit_pageseg_mode: attempt.psm });
      const { data } = await worker.recognize(src);
      const text = data.text || "";
      const score = scoreOcrText(text);
      attemptLog.push(`${attempt.label}: ${text.trim().length} caracteres, puntaje ${score}`);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    } catch (err) {
      attemptLog.push(`${attempt.label}: falló (${serializeErr(err)})`);
    }
  }
  if (!bestText.trim()) {
    throw new OcrError("read", "No se pudo leer el texto del comprobante.", attemptLog.join(" | "));
  }
  return bestText;
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
    const msg = serializeErr(err);
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
  // Comprobación rápida: si el navegador no permite compilar WebAssembly,
  // cada intento se quedaría colgado hasta el tiempo límite sin decir nada.
  // Mejor fallar de inmediato con el motivo real.
  await checkWasmAllowed();
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
    const text = await recognizeWithRetries(worker, imageSrc, emit, attemptLog, mod.PSM);
    return text;
  } catch (err) {
    if (err instanceof OcrError) throw err;
    const msg = serializeErr(err);
    throw new OcrError("read", "No se pudo leer el texto del comprobante.", `${msg}${attemptLog.length > 0 ? ` | ${attemptLog.join(" | ")}` : ""}`);
  } finally {
    await worker.terminate();
  }
}
