// Franja superior de área segura (sustituye a SafeAreaTopScrim de
// @hatch/space-sdk): reserva el espacio del notch / barra de estado.
export function SafeAreaTopScrim({ backgroundColor }: { backgroundColor?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{ height: "env(safe-area-inset-top, 0px)", backgroundColor: backgroundColor ?? "transparent" }}
    />
  );
}
