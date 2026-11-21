// Pantalla de entrada (splash) con marca: solo se muestra mientras la app
// revisa la sesión y carga los datos (retorno temprano cuando q.isPending
// en App.tsx). Nebulosa animada (propuesta E, elegida por Heriberto
// 2026-11-20): solo CSS, sin video ni imágenes nuevas — tres capas de
// radial-gradient en los colores de la paleta Marfil/dona que fluyen lento
// como aurora boreal, más dos campos de estrellas que titilan (clases
// .sf-nebula-* y .sf-stars en theme.css). El logo se muestra como loseta
// con esquinas redondeadas y sombra suave (.sf-logo-tile), con el icono
// real de la app (/icon-512.png). La nebulosa queda detrás del contenido
// (z-index) y es oscura para no estorbar la lectura. Con
// prefers-reduced-motion el fondo queda estático.
export function LoadingSplash() {
  return (
    <div
      className="sf-splash min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ backgroundColor: "#151515" }}
      role="status"
      aria-label="Cargando SyncFinanzas"
    >
      <div className="sf-nebula sf-nebula-a" aria-hidden="true" />
      <div className="sf-nebula sf-nebula-b" aria-hidden="true" />
      <div className="sf-nebula sf-nebula-c" aria-hidden="true" />
      <div className="sf-stars" aria-hidden="true" />
      <div className="sf-stars sf-stars-b" aria-hidden="true" />
      <div className="relative z-10 flex flex-col items-center justify-center gap-4">
        <div className="sf-logo-tile">
          <img src="/icon-512.png" alt="SyncFinanzas" width={128} height={128} className="w-32 h-32" />
        </div>
        <p className="font-display text-3xl font-extrabold text-white leading-none">SyncFinanzas</p>
        <p className="text-sm font-semibold" style={{ color: "#00C2B5" }}>Finanzas del hogar</p>
        <div className="mt-2 flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-[3px] border-white/20 border-t-[#00C2B5] animate-spin" aria-hidden="true" />
          <p className="text-xs text-white/60">Cargando…</p>
        </div>
      </div>
    </div>
  );
}
