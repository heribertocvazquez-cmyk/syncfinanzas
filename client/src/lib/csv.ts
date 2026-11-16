// CSV: lectura (importación) y escritura (exportación) en el dispositivo.
// Acepta comas o punto y coma como separador y celdas entre comillas.

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  // Separador: el que aparezca más en la primera línea con contenido.
  let delim = ",";
  for (const line of s.split(/\r?\n/)) {
    if (line.trim()) {
      const commas = (line.match(/,/g) || []).length;
      const semis = (line.match(/;/g) || []).length;
      if (semis > commas) delim = ";";
      break;
    }
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function toCsv(rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
