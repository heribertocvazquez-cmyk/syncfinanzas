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
// Vite, tanto en local como en Vercel. Los archivos del núcleo, del worker
// y del idioma se copian de node_modules (versiones fijadas en
// package-lock.json); no se descarga nada en el build. Si falta algún
// archivo, el build se detiene con error en vez de publicar una app con el
// lector roto.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");

const COPIES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "core/tesseract-core-simd-lstm.wasm"],
  // Núcleo sin SIMD (mismo motor sin esa optimización): lo usa la escalera
  // de carga del lector cuando el núcleo SIMD no arranca en el dispositivo.
  // Como el SIMD, lleva el wasm incrustado en el .js, así que solo se
  // copia el .js.
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
];

// Datos del idioma español (tesseract.js 6 los pide como .gz y los
// descomprime en el worker). Es exactamente el archivo que la librería
// descarga por defecto: @tesseract.js-data/spa 4.0.0. Se copia de
// node_modules (devDependency, versión fijada en package-lock.json), sin
// descargar nada en el build.
const LANG_SRC = "node_modules/@tesseract.js-data/spa/4.0.0/spa.traineddata.gz";
const LANG_FILE = "lang/spa.traineddata.gz";
const LANG_MIN_BYTES = 1_000_000;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
  const langPath = join(out, LANG_FILE);
  const langSrc = join(root, LANG_SRC);
  if (!(await exists(langSrc))) {
    throw new Error(`Falta ${LANG_SRC}: ejecute npm install.`);
  }
  await copyFile(langSrc, langPath);
  const { size } = await stat(langPath);
  if (size < LANG_MIN_BYTES) throw new Error(`Archivo de idioma incompleto: ${size} bytes`);
  console.log(`tesseract: copiado ${LANG_FILE} (${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(`tesseract: ERROR: ${err.message}`);
  process.exit(1);
});
