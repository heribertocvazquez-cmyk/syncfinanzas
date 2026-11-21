// Bienvenida «Aquí empieza su vida financiera»: se muestra UNA sola vez,
// justo después de crear la cuenta en esta sesión (lo decide AuthGate con
// su estado en memoria, no con una bandera guardada: así a quien ya tiene
// cuenta jamás le aparece tras un despliegue). Tono formal de usted, sin
// modismos ni emojis. Paleta Marfil (variables del tema, igual que AuthGate).
export function WelcomeVidaFinanciera({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  const steps = [
    { n: "1", title: "Su perfil", text: "Su ingreso y sus compromisos." },
    { n: "2", title: "Su meta", text: "Su objetivo con fecha y plan." },
    { n: "3", title: "Su fondo", text: "Su apartado día a día." },
  ];
  return (
    <main className="min-h-screen flex items-start sm:items-center justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
      <div
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0"
        role="dialog"
        aria-label="Bienvenida a SyncFinanzas"
      >
        <p className="font-display font-bold text-[var(--accent)]">SyncFinanzas</p>
        <h1 className="font-display font-bold text-2xl mt-2">
          Aquí empieza
          <br />
          su vida financiera.
        </h1>
        <p className="text-sm text-[var(--dim)] mt-2">Lo acompañamos desde su primer peso:</p>
        <ol className="mt-4 space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3 items-start rounded-2xl bg-[var(--surface2)] p-3">
              <span
                aria-hidden="true"
                className="shrink-0 w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold flex items-center justify-center"
              >
                {s.n}
              </span>
              <span>
                <span className="block font-bold text-sm">{s.title}</span>
                <span className="block text-sm text-[var(--dim)]">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-3 mt-5"
        >
          Empezar
        </button>
        <button type="button" onClick={onSkip} className="underline font-semibold text-sm mt-3">
          Omitir por ahora
        </button>
      </div>
    </main>
  );
}
