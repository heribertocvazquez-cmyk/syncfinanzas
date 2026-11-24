// Analítica de uso de la prueba (2026-11-24, aprobada por Heriberto).
//
// Solo se registran el MÓDULO (pantalla) y el BOTÓN (nombre de la acción),
// con fecha y hora. NUNCA importes, conceptos, cuentas, fotos ni ningún
// contenido de lo que el usuario guarda. El servidor rechaza cualquier
// módulo o acción fuera de estas listas: la lista es el límite, no solo
// una promesa (ver logUsage en server/src/actions.ts).
//
// El registro es silencioso y nunca interrumpe el uso de la app: si falla
// (falta correr supabase/add-usage-events.sql, sin red, sin sesión), no
// pasa nada visible.
import { api } from "../api";

export const USAGE_MODULES = [
  "inicio", "personal", "tandas", "movimientos", "cuentas", "categorias",
  "presupuestos", "fondos", "aportaciones", "metas", "acuerdos",
  "patrimonio", "perfiles", "hogar", "seguridad", "guia", "desarrollador",
  "legales",
] as const;
export type UsageModule = (typeof USAGE_MODULES)[number];

export const USAGE_ACTIONS = [
  "ver_modulo",
  "guardar_movimiento",
  "guardar_cuenta",
  "guardar_presupuesto",
  "guardar_meta",
  "guardar_fondo",
  "aportar_meta",
  "retirar_meta",
] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export const USAGE_MODULE_LABEL: Record<UsageModule, string> = {
  inicio: "Inicio",
  personal: "Personal",
  tandas: "Tandas",
  movimientos: "Movimientos",
  cuentas: "Cuentas",
  categorias: "Categorías",
  presupuestos: "Presupuestos",
  fondos: "Fondos",
  aportaciones: "Aportaciones",
  metas: "Metas",
  acuerdos: "Acuerdos",
  patrimonio: "Patrimonio",
  perfiles: "Perfiles",
  hogar: "Hogar",
  seguridad: "Seguridad",
  guia: "Guía de uso",
  desarrollador: "Desarrollador",
  legales: "Documentos legales",
};

export const USAGE_ACTION_LABEL: Record<UsageAction, string> = {
  ver_modulo: "Ver módulo",
  guardar_movimiento: "Guardar movimiento",
  guardar_cuenta: "Guardar cuenta",
  guardar_presupuesto: "Guardar presupuesto",
  guardar_meta: "Guardar meta",
  guardar_fondo: "Guardar fondo",
  aportar_meta: "Aportar a meta",
  retirar_meta: "Retirar de meta",
};

export function usageModuleLabel(module: string): string {
  return (USAGE_MODULE_LABEL as Record<string, string>)[module] ?? module;
}

export function usageActionLabel(action: string): string {
  return (USAGE_ACTION_LABEL as Record<string, string>)[action] ?? action;
}

/** Registra un evento de uso. Silencioso: nunca lanza, nunca avisa. */
export function logUsageEvent(
  householdId: number | null | undefined,
  module: string,
  action: string,
): void {
  if (!householdId) return;
  void api.logUsage({ householdId, module, action }, 5000).catch(() => {});
}
