// Convierte un archivo a base64 (sustituye a fileToBase64 de @hatch/space-sdk).
export async function fileToBase64(file: File): Promise<{ dataBase64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return { dataBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mimeType: file.type };
}
