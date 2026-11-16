// Lectura de comprobantes en el dispositivo con Tesseract.js (gratuito).
// El motor se carga solo cuando se usa (import dinámico): no engorda el
// paquete inicial. El núcleo y los datos del idioma se descargan de la CDN
// de Tesseract.js la primera vez que se lee un comprobante; la foto no sale
// del dispositivo a ningún servidor de SyncFinanzas ni de OpenAI.

export type OcrProgress = { status: string; progress: number };

export async function readReceiptText(imageSrc: string, onProgress?: (p: OcrProgress) => void): Promise<string> {
  const mod = await import("tesseract.js");
  const worker = await mod.createWorker("spa", 1, {
    logger: (m: { status: string; progress?: number }) => {
      onProgress?.({ status: m.status, progress: m.progress ?? 0 });
    },
  });
  try {
    const { data } = await worker.recognize(imageSrc);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}
