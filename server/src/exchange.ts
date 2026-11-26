// Tipos de cambio (alcance B, 2026-11-26): Frankfurter (tasas del BCE,
// gratis, sin clave) con caché en Supabase (exchange_rates,
// supabase/exchange-rates.sql). La tasa se consulta SOLO al guardar
// (crear cuenta, registrar movimiento, aportar a un fondo, traspaso):
// nunca en lectura (getOverview solo devuelve las guardadas) y nunca
// desde el cliente. El equivalente queda CONGELADO al registrar: los
// importes guardados no cambian aunque la tasa se mueva después.
//
// Regla de la caché: si la tasa guardada tiene menos de 24 h, se usa
// tal cual; si es más vieja, se pide una nueva a Frankfurter y se
// guarda; si Frankfurter falla y hay una guardada (aunque vieja), se
// usa esa; si no hay ninguna guardada y Frankfurter falla, la
// operación se rechaza con NO_RATE_MESSAGE.
//
// Dirección: la tasa es siempre base→destino (p. ej. USD→MXN 17.00) y
// el equivalente es importe * tasa. Para convertir se pide a
// Frankfurter base=moneda original, symbols=moneda del hogar.
//
// Pruebas: el módulo lee globalThis.__TEST_RATES__ cuando existe
// (mapa "USD->MXN": 17.00); con el stub, un par ausente equivale a
// Frankfurter caído (sin llamada de red).
import { sql } from "drizzle-orm";
import type { Db } from "./db.js";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const RATE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** Sin tasa guardada y Frankfurter caído: la operación no se hace. */
export const NO_RATE_MESSAGE = "No hay tipo de cambio disponible, intente más tarde.";
/** La tabla de tasas no existe: falta correr el SQL de conversión. */
export const RATE_SQL_MESSAGE = "Para registrar en otra moneda, primero ejecute el SQL de conversión (supabase/exchange-rates.sql).";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Equivalente en la moneda del hogar: importe * tasa (base→hogar). */
export function toHousehold(amount: number, rate: number): number {
  return round2(amount * rate);
}

export type StoredRate = {
  rate: number;
  /** Cuándo se consultó (para el límite de 24 h). */
  fetchedAt: string | null;
  /** Fecha de la tasa misma (la que muestra el aviso). */
  rateDate: string | null;
};

export type RateResult = {
  rate: number;
  rateDate: string;
  fromCache: boolean;
  cachedAt: string | null;
};

function testRates(): Record<string, number> | null {
  const t = (globalThis as unknown as { __TEST_RATES__?: Record<string, number> }).__TEST_RATES__;
  return t ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchFrankfurterRate(from: string, to: string): Promise<{ rate: number; date: string }> {
  const stub = testRates();
  if (stub) {
    const v = stub[`${from}->${to}`];
    if (v == null) throw new Error("Frankfurter no disponible (prueba).");
    return { rate: v, date: todayIso() };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${FRANKFURTER_URL}?base=${from}&symbols=${to}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const json = (await res.json()) as { base?: string; date?: string; rates?: Record<string, number> };
    const rate = json.rates?.[to];
    if (rate == null || !(rate > 0)) throw new Error("Frankfurter sin tasa.");
    return { rate, date: json.date ?? todayIso() };
  } finally {
    clearTimeout(timer);
  }
}

type RateRow = { rate: number; fetched_at: string | Date | null; rate_date: string | null };

function asStoredRate(row: RateRow | undefined): StoredRate | null {
  if (!row) return null;
  const fetchedAt = row.fetched_at instanceof Date ? row.fetched_at.toISOString() : (row.fetched_at ?? null);
  return {
    rate: row.rate,
    fetchedAt,
    rateDate: row.rate_date ?? (fetchedAt ? fetchedAt.slice(0, 10) : null),
  };
}

/** Lee la tasa guardada (tolerante: sin la tabla devuelve null). */
export async function readStoredRate(db: Db, from: string, to: string): Promise<StoredRate | null> {
  try {
    const res = (await db.execute(
      sql`SELECT rate, fetched_at, rate_date FROM exchange_rates WHERE base_currency = ${from} AND target_currency = ${to}`,
    )) as unknown as { rows?: RateRow[] } | RateRow[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    return asStoredRate(rows[0]);
  } catch {
    return null; // tabla aún no creada
  }
}

/** Guarda la tasa (tolerante: sin la tabla no hace nada). */
export async function storeRate(db: Db, from: string, to: string, rate: number, rateDate: string): Promise<boolean> {
  try {
    const existing = await readStoredRate(db, from, to);
    if (existing) {
      await db.execute(
        sql`UPDATE exchange_rates SET rate = ${rate}, fetched_at = now(), rate_date = ${rateDate} WHERE base_currency = ${from} AND target_currency = ${to}`,
      );
    } else {
      await db.execute(
        sql`INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at, rate_date) VALUES (${from}, ${to}, ${rate}, now(), ${rateDate})`,
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Tasa base→destino con la regla de la caché (24 h). Misma moneda: 1.
 * Sin tasa guardada y Frankfurter caído: lanza NO_RATE_MESSAGE.
 */
export async function getRate(db: Db, from: string, to: string): Promise<RateResult> {
  if (from === to) return { rate: 1, rateDate: todayIso(), fromCache: false, cachedAt: null };
  const stored = await readStoredRate(db, from, to);
  if (stored) {
    const age = stored.fetchedAt ? Date.now() - new Date(stored.fetchedAt).getTime() : Infinity;
    if (age < RATE_TTL_MS) {
      return { rate: stored.rate, rateDate: stored.rateDate ?? todayIso(), fromCache: true, cachedAt: stored.fetchedAt };
    }
  }
  try {
    const fresh = await fetchFrankfurterRate(from, to);
    await storeRate(db, from, to, fresh.rate, fresh.date);
    return { rate: fresh.rate, rateDate: fresh.date, fromCache: false, cachedAt: null };
  } catch {
    if (stored) {
      return { rate: stored.rate, rateDate: stored.rateDate ?? todayIso(), fromCache: true, cachedAt: stored.fetchedAt };
    }
    throw new Error(NO_RATE_MESSAGE);
  }
}

/** Todas las tasas guardadas, para que el cliente previsualice sin pedir nada más. Sin la tabla, lista vacía. */
export async function listStoredRates(db: Db): Promise<{ base: string; target: string; rate: number; fetchedAt: string | null; rateDate: string | null }[]> {
  try {
    const res = (await db.execute(
      sql`SELECT base_currency, target_currency, rate, fetched_at, rate_date FROM exchange_rates ORDER BY base_currency, target_currency`,
    )) as unknown as { rows?: { base_currency: string; target_currency: string; rate: number; fetched_at: string | Date | null; rate_date: string | null }[] } | { base_currency: string; target_currency: string; rate: number; fetched_at: string | Date | null; rate_date: string | null }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    return rows.map((r) => ({
      base: r.base_currency,
      target: r.target_currency,
      rate: r.rate,
      fetchedAt: r.fetched_at instanceof Date ? r.fetched_at.toISOString() : (r.fetched_at ?? null),
      rateDate: r.rate_date ?? (r.fetched_at ? (r.fetched_at instanceof Date ? r.fetched_at.toISOString().slice(0, 10) : String(r.fetched_at).slice(0, 10)) : null),
    }));
  } catch {
    return [];
  }
}
