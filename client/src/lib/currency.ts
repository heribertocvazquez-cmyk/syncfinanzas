// Moneda del hogar (alcance A, 2026-11-26): cada hogar tiene UNA moneda
// (MXN, USD o EUR). Sin conversión: los importes se guardan y se suman
// tal cual; la moneda solo cambia con qué símbolo se muestran. La
// suscripción Familiar sigue en MXN (no pasa por aquí). Los hogares que
// ya existen quedan en MXN (default de la columna households.currency).
export type HouseholdCurrency = "MXN" | "USD" | "EUR";

export const CURRENCIES: { code: HouseholdCurrency; name: string }[] = [
  { code: "MXN", name: "Peso mexicano" },
  { code: "USD", name: "Dólar" },
  { code: "EUR", name: "Euro" },
];

export function currencyName(code: HouseholdCurrency): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? "Peso mexicano";
}

export function isHouseholdCurrency(v: unknown): v is HouseholdCurrency {
  return v === "MXN" || v === "USD" || v === "EUR";
}

// Zonas horarias que resuelven la sugerencia cuando el idioma no trae
// región (p. ej. «en» a secas). Solo las zonas inequívocas de México,
// Estados Unidos y España; cualquier otra cae en el default MXN.
const US_TIMEZONES =
  /^(America\/(New_York|Chicago|Denver|Los_Angeles|Anchorage|Phoenix|Detroit|Boise|Indiana\/Indianapolis|Kentucky\/Louisville|North_Dakota\/Center|Juneau|Metlakatla|Nome|Sitka|Yakutat)|Pacific\/Honolulu)$/;
const MX_TIMEZONES =
  /^America\/(Mexico_City|Monterrey|Tijuana|Cancun|Merida|Chihuahua|Hermosillo|Mazatlan|Matamoros|Ojinaga|Bahia_Banderas)$/;
const ES_TIMEZONES = /^Europe\/Madrid$/;

/** Sugerencia de moneda por región. Fuente principal: la región del
 *  idioma del dispositivo (p. ej. «es-MX» → MXN, «en-US» → USD,
 *  «es-ES» → EUR). Si el idioma no trae región, la zona horaria del
 *  dispositivo (Intl.DateTimeFormat). Si no se puede detectar nada,
 *  MXN. `detected` dice si la sugerencia vino de una región reconocida
 *  (cuando es falso, la app preselecciona MXN sin decir que lo sugirió
 *  la región). */
export function suggestCurrencyFromRegion(
  locale?: string | null,
  timeZone?: string | null,
): { currency: HouseholdCurrency; detected: boolean } {
  const region = (locale || "").split(/[-_]/)[1]?.toUpperCase() || "";
  if (region === "US") return { currency: "USD", detected: true };
  if (region === "ES") return { currency: "EUR", detected: true };
  if (region === "MX") return { currency: "MXN", detected: true };
  const tz = timeZone || "";
  if (US_TIMEZONES.test(tz)) return { currency: "USD", detected: true };
  if (ES_TIMEZONES.test(tz)) return { currency: "EUR", detected: true };
  if (MX_TIMEZONES.test(tz)) return { currency: "MXN", detected: true };
  return { currency: "MXN", detected: false };
}

// ---- Conversión de moneda (alcance B, 2026-11-26) ----
// Reglas de visualización (reglas-visualizacion-moneda.md, aprobadas
// 2026-11-26): los totales de Inicio van en moneda del hogar y los cubre
// la insignia de la tarjeta Disponible (R1); todo importe de una cuenta
// concreta lleva su moneda de origen cuando difiere de la del hogar
// (R2); el aviso del tipo de cambio (tasa + fecha) aparece SOLO cuando
// la moneda difiere de la del hogar (R4); el «$» solo nunca distingue
// moneda: todo importe que pueda ser de otra moneda lleva su código
// (R5). Tono formal de usted, sin modismos ni emojis decorativos.

/** Importe con una moneda explícita, p. ej. moneyIn(100, "USD") →
 *  «US$100.00». A diferencia de money()/money2() (format.ts), que usan
 *  la moneda del hogar, este formateador toma la moneda que se le pasa. */
export function moneyIn(n: number, code: HouseholdCurrency): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: code });
}

/** Una tasa guardada tal como la devuelve getOverview (exchangeRates). */
export type ExchangeRateInfo = { base: string; target: string; rate: number; date: string };

/** Busca la tasa guardada de base→target (p. ej. USD→MXN). Si falta el
 *  par directo, deriva el inverso (1/tasa) de la guardada: las tasas de
 *  un par son recíprocas por construcción, así que el previsto de un
 *  traspaso funciona aunque solo se haya guardado la dirección
 *  contraria (caso común: hogar MXN con cuenta USD, traspaso MXN→USD
 *  cuando solo existe USD→MXN). */
export function findStoredRate(
  rates: ExchangeRateInfo[] | undefined | null,
  base: string,
  target: string,
): ExchangeRateInfo | null {
  if (!rates) return null;
  const direct = rates.find((r) => r.base === base && r.target === target);
  if (direct) return direct;
  const inv = rates.find((r) => r.base === target && r.target === base);
  if (inv && inv.rate > 0) {
    return { base, target, rate: Math.round((1 / inv.rate) * 1e6) / 1e6, date: inv.date };
  }
  return null;
}

/** Fecha corta en español, p. ej. «26 nov 2026». */
export function fmtRateDate(iso: string): string {
  const [y = 2026, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** true si la fecha de la tasa es de ayer o más vieja. */
export function isRateDateOld(dateIso: string, todayIso?: string): boolean {
  return dateIso < (todayIso ?? todayISO());
}

/** Línea de la tasa con su fecha: «Tipo de cambio del día: 1 USD =
 *  $17.00 MXN (26 nov 2026).» o, si es vieja, «Tipo de cambio del
 *  25 nov 2026: 1 USD = $17.00 MXN.» */
export function rateLine(
  base: string,
  target: string,
  rate: number,
  dateIso: string,
  todayIso?: string,
): string {
  const one = `1 ${base} = ${moneyIn(rate, target as HouseholdCurrency)} ${target}`;
  return isRateDateOld(dateIso, todayIso)
    ? `Tipo de cambio del ${fmtRateDate(dateIso)}: ${one}.`
    : `Tipo de cambio del día: ${one} (${fmtRateDate(dateIso)}).`;
}

function currencyNamePlural(code: HouseholdCurrency): string {
  if (code === "MXN") return "pesos mexicanos";
  if (code === "USD") return "dólares";
  return "euros";
}

/** Aviso al crear o editar una cuenta en moneda distinta a la del hogar,
 *  p. ej. «Los movimientos de esta cuenta se convertirán a pesos
 *  mexicanos con el tipo de cambio del día: 1 USD = $17.00 MXN
 *  (26 nov 2026).» null cuando no hay conversión (misma moneda o sin tasa). */
export function accountRateNotice(
  accountCurrency: string,
  householdCurrency: string,
  rate: ExchangeRateInfo | null,
  todayIso?: string,
): string | null {
  if (accountCurrency === householdCurrency || !rate) return null;
  return `Los movimientos de esta cuenta se convertirán a ${currencyNamePlural(
    householdCurrency as HouseholdCurrency,
  )} con el ${rateLine(
    accountCurrency,
    householdCurrency,
    rate.rate,
    rate.date,
    todayIso,
  ).replace(/^Tipo de cambio/, "tipo de cambio")}`;
}

/** Aviso junto al equivalente previsto al registrar un movimiento en
 *  moneda distinta, y en el detalle del movimiento guardado (tasa
 *  congelada): «Tipo de cambio aplicado: 1 USD = $17.00 MXN
 *  (26 nov 2026).» o, si es vieja, «Tipo de cambio del 25 nov 2026:
 *  1 USD = $17.00 MXN.» null cuando no hay conversión. */
export function movementRateNotice(
  movementCurrency: string,
  householdCurrency: string,
  rate: number | null,
  dateIso: string | null,
  todayIso?: string,
): string | null {
  if (movementCurrency === householdCurrency || rate == null || !dateIso) return null;
  const one = `1 ${movementCurrency} = ${moneyIn(rate, householdCurrency as HouseholdCurrency)} ${householdCurrency}`;
  return isRateDateOld(dateIso, todayIso)
    ? `Tipo de cambio del ${fmtRateDate(dateIso)}: ${one}.`
    : `Tipo de cambio aplicado: ${one} (${fmtRateDate(dateIso)}).`;
}

/** Etiqueta de un importe con su moneda de origen (R2): «USD 100.00 ≈
 *  MXN 1,700.00». null cuando la moneda de origen es la del hogar o no
 *  hay importe original: en ese caso el importe se muestra como hoy. */
export function fxLabel(
  originalAmount: number | null | undefined,
  originalCurrency: string | null | undefined,
  equivalent: number,
  householdCurrency: string,
): string | null {
  if (originalAmount == null || !originalCurrency || originalCurrency === householdCurrency) return null;
  // Código explícito en los dos lados (R2/R5): moneyIn formatea MXN
  // como «$1,700.00» sin código, y «$» solo no distingue pesos de
  // dólares. Así la etiqueta es igual en jsdom y en el navegador:
  // «USD 100.00 ≈ MXN 1,700.00».
  return `${moneyCode(originalAmount, originalCurrency)} ≈ ${moneyCode(equivalent, householdCurrency)}`;
}

/** Importe con el código de moneda explícito, p. ej.
 *  moneyCode(100, "USD") → «USD 100.00». Determinista entre jsdom y el
 *  navegador (a diferencia de moneyIn, que usa el símbolo de Intl). */
export function moneyCode(n: number, code: string): string {
  return `${code} ${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Equivalente previsto con una tasa guardada: round2(importe * tasa). */
export function previewEquivalent(amount: number, rate: ExchangeRateInfo | null): number | null {
  if (!rate) return null;
  return Math.round(amount * rate.rate * 100) / 100;
}

/** Aviso cuando la cuenta es extranjera pero aún no hay tasa guardada
 *  (el servidor la pedirá al guardar): sin tasa, solo la frase. */
export function accountRateNoticePending(accountCurrency: string, householdCurrency: string): string | null {
  if (accountCurrency === householdCurrency) return null;
  return `Los movimientos de esta cuenta se convertirán a ${currencyNamePlural(
    householdCurrency as HouseholdCurrency,
  )} con el tipo de cambio del día.`;
}

/** true cuando hay conversión: la moneda difiere de la del hogar. */
export function needsConversion(currency: string | null | undefined, householdCurrency: string): boolean {
  return currency != null && currency !== householdCurrency;
}

export function suggestCurrency(): { currency: HouseholdCurrency; detected: boolean } {
  let locale: string | undefined;
  let timeZone: string | undefined;
  try {
    locale = typeof navigator !== "undefined" ? navigator.language : undefined;
  } catch {
    locale = undefined;
  }
  try {
    timeZone =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined;
  } catch {
    timeZone = undefined;
  }
  return suggestCurrencyFromRegion(locale, timeZone);
}
