// Descarga/copia los archivos del lector de comprobantes (Tesseract.js) a
// public/tesseract/, para que la app los sirva desde su propio origen.
// Por qué: Tesseract.js carga por defecto el núcleo, el worker y los datos
// del idioma desde la CDN de jsdelivr; en un teléfono con 4G esa descarga
// de ~9 MB falla y la lectura no arranca. Con los archivos en el mismo
// origen (Vercel), la primera lectura los descarga de la app y luego quedan
// guardados en la caché del dispositivo (service worker + IndexedDB).
//
// Estos archivos son binarios y NO se guardan en GitHub (el despliegue solo
// sube texto): este script se ejecuta en cada `npm run build`, antes de
// Vite, tanto en local como en Vercel. Los archivos del núcleo y del worker
// se copian de node_modules (versiones fijadas en package-lock.json).
// El idioma español se baja del modelo RÁPIDO oficial (tessdata_fast,
// commit fijado, no la rama main) y se comprime en el build: la primera
// lectura descarga ~2,7 MB en vez de ~9,9 MB. Si esa descarga falla, el
// build sigue con el modelo estándar de node_modules para no romper el
// despliegue. Si falta algún archivo, el build se detiene con error en vez
// de publicar una app con el lector roto.
//
// El .wasm suelto del núcleo SIMD NO se copia: el wasm va incrustado en
// el .js (wasmBinary) y ese archivo nunca se descarga (peso muerto de
// ~2,9 MB en dist/). El núcleo sin SIMD SÍ se copia: lo usan los
// teléfonos viejos (iOS < 16.4) donde la detección automática lo elige.

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const gzipAsync = promisify(gzip);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");

const COPIES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  // Núcleo sin SIMD (mismo motor sin esa optimización): lo usa la escalera
  // de carga del lector cuando el núcleo SIMD no arranca en el dispositivo.
  // Como el SIMD, lleva el wasm incrustado en el .js, así que solo se
  // copia el .js.
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
];

// Modelo rápido de español (tessdata_fast): mismo formato que el estándar,
// mucho más chico (2 294 433 B sin comprimir frente a 18 256 019 B).
// Commit fijado 2024-08-01 (el repo no ha cambiado desde entonces); nunca
// la rama main, para que el build sea reproducible.
const FAST_COMMIT = "87416418657359cb625c412a48b6e1d6d41c29bd";
const FAST_URL = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${FAST_COMMIT}/spa.traineddata`;
const FAST_MIN_RAW_BYTES = 1_000_000;

// Datos del idioma estándar (respaldo): @tesseract.js-data/spa 4.0.0.
// Se copia de node_modules (devDependency, versión fijada en
// package-lock.json), sin descargar nada en el build.
const LANG_SRC = "node_modules/@tesseract.js-data/spa/4.0.0/spa.traineddata.gz";
const LANG_FILE = "lang/spa.traineddata.gz";
const LANG_MIN_BYTES = 500_000;
const MODEL_FILE = "lang/model.txt";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Baja el modelo rápido, lo comprime a .gz en el build y deja constancia
// de qué modelo quedó instalado. Si algo falla, vuelve al estándar.
async function installLang() {
  const langPath = join(out, LANG_FILE);
  const modelPath = join(out, MODEL_FILE);
  try {
    const res = await fetch(FAST_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${FAST_URL}`);
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < FAST_MIN_RAW_BYTES) throw new Error(`modelo rápido incompleto: ${raw.length} bytes`);
    const gz = await gzipAsync(raw, { level: 9 });
    if (gz.length < LANG_MIN_BYTES) throw new Error(`modelo rápido comprimido incompleto: ${gz.length} bytes`);
    await writeFile(langPath, gz);
    await writeFile(modelPath, `tessdata_fast@${FAST_COMMIT}\n`);
    console.log(`tesseract: idioma rápido tessdata_fast (${(gz.length / 1024).toFixed(0)} KB .gz, de ${(raw.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`tesseract: no se pudo instalar el modelo rápido (${err.message}); se usa el estándar.`);
    const langSrc = join(root, LANG_SRC);
    if (!(await exists(langSrc))) {
      throw new Error(`Falta ${LANG_SRC}: ejecute npm install.`);
    }
    await copyFile(langSrc, langPath);
    const { size } = await stat(langPath);
    if (size < LANG_MIN_BYTES) throw new Error(`Archivo de idioma incompleto: ${size} bytes`);
    await writeFile(modelPath, "standard@4.0.0\n");
    console.log(`tesseract: copiado ${LANG_FILE} estándar (${(size / 1024).toFixed(0)} KB)`);
  }
}

async function main() {
  await mkdir(join(out, "core"), { recursive: true });
  await mkdir(join(out, "lang"), { recursive: true });
  for (const [src, dest] of COPIES) {
    const from = join(root, src);
    const to = join(out, dest);
    await copyFile(from, to);
    const { size } = await stat(to);
    console.log(`tesseract: copiado ${dest} (${(size / 1024).toFixed(0)} KB)`);
  }
  await installLang();
}

main().catch((err) => {
  console.error(`tesseract: ERROR: ${err.message}`);
  process.exit(1);
});
