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

/** Sugerencia para este dispositivo: lee navigator.language y la zona
 *  horaria del sistema. Fuera del navegador devuelve MXN sin detectar. */
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
