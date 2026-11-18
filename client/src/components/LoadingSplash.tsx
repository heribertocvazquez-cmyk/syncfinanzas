// Pantalla de entrada (splash) con marca: solo se muestra mientras la app
// revisa la sesión y carga los datos (retorno temprano cuando q.isPending
// en App.tsx). Sin video ni imágenes nuevas: usa el icono real de la app
// (/icon-512.png, casa blanca con flechas doradas sobre azul marino) y un
// indicador de carga dorado solo con CSS.
export function LoadingSplash() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ backgroundColor: "#0E2F3D" }}
      role="status"
      aria-label="Cargando SyncFinanzas"
    >
      <img src="/icon-512.png" alt="SyncFinanzas" width={112} height={112} className="w-28 h-28" />
      <p className="font-display text-3xl font-extrabold text-white leading-none">SyncFinanzas</p>
      <p className="text-sm font-semibold" style={{ color: "#D9A441" }}>Finanzas del hogar</p>
      <div className="mt-2 flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-[3px] border-white/20 border-t-[#D9A441] animate-spin" aria-hidden="true" />
        <p className="text-xs text-white/60">Cargando…</p>
      </div>
    </div>
  );
}
