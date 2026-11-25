// Pantalla de acceso de SyncFinanzas (Supabase Auth).
// Cada persona entra con su correo y una contraseña propia:
//  - Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.
//  - 5 intentos fallidos bloquean el correo 15 minutos.
//  - La contraseña la guarda Supabase Auth (hash con sal); SyncFinanzas no
//    la ve ni la almacena.
// Si la persona ya tiene sesión, muestra la aplicación. También gestiona
// el restablecimiento de contraseña (enlace por correo) y el cierre de sesión.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase, initialRecoverySignal } from "../supabase";
import { fetchSession } from "../api";
import { WelcomeVidaFinanciera } from "./WelcomeVidaFinanciera";

export function passwordChecks(password: string): { ok: boolean; message: string } {
  if (password.length < 12) return { ok: false, message: "Mínimo 12 caracteres." };
  if (!/[A-Z]/.test(password)) return { ok: false, message: "Debe incluir al menos una letra mayúscula." };
  if (!/[a-z]/.test(password)) return { ok: false, message: "Debe incluir al menos una letra minúscula." };
  if (!/[0-9]/.test(password)) return { ok: false, message: "Debe incluir al menos un número." };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, message: "Debe incluir al menos un símbolo (por ejemplo: ! ? # $)." };
  return { ok: true, message: "Contraseña fuerte." };
}

type Mode = "login" | "signup" | "forgot" | "recovery";

export interface InvitePreview {
  kind: "household" | "tanda" | "general";
  email: string;
  invitedName: string | null;
  inviterName: string | null;
  householdName: string | null;
  tandaName: string | null;
  usable: boolean;
  /** Enlace para probar la app (sin correo ni invitación concreta):
   *  solo dice quién invitó; no da acceso a ningún hogar. */
  generic?: boolean;
}

/** Lee el token de invitación de la URL (?token=...) y lo guarda para
 *  después de crear la cuenta o iniciar sesión. */
export function readInviteToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    if (fromUrl) sessionStorage.setItem("sf-invite-token", fromUrl);
    return fromUrl || sessionStorage.getItem("sf-invite-token");
  } catch {
    return null;
  }
}

export async function fetchInvitePreview(token: string): Promise<InvitePreview | null> {
  try {
    const res = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
    const json = (await res.json().catch(() => null)) as (InvitePreview & { ok?: boolean }) | null;
    if (!res.ok || !json || json.ok !== true) return null;
    return json;
  } catch {
    return null;
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<boolean | null>(null);
  // La recuperación se decide con la señal capturada al cargar el módulo
  // (ver supabase.ts): leer el hash aquí llegaba tarde en el teléfono,
  // porque la librería ya lo había borrado al leer el enlace.
  const [mode, setMode] = useState<Mode>(() =>
    initialRecoverySignal ? "recovery" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  // Bienvenida «Aquí empieza su vida financiera»: solo se muestra cuando
  // la cuenta se creó en ESTA sesión (el registro recién completado). El
  // criterio es este estado en memoria: nunca se lee una bandera guardada
  // para decidir mostrarla, así a quien ya tiene cuenta jamás le aparece
  // tras un despliegue ni al volver a entrar. Al cerrar se anota
  // `sf-bienvenida-vista` en localStorage solo como registro.
  const [showWelcome, setShowWelcome] = useState(false);
  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem("sf-bienvenida-vista", "1");
    } catch {
      // Sin almacenamiento disponible: nada que anotar.
    }
  };

  // La sesión vive en la cookie segura del servidor (punto 10): se
  // consulta a GET /api/session. El cliente ya no guarda el token en
  // localStorage ni escucha cambios de sesión de Supabase.
  useEffect(() => {
    let alive = true;
    void fetchSession().then((u) => {
      if (alive) setSession(!!u);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Enlace de invitación: si la persona llegó con ?token=..., se muestra
  // de qué se trata y el correo invitado queda prellenado, para que cree su
  // cuenta directamente con ese correo.
  useEffect(() => {
    const token = readInviteToken();
    if (!token) return;
    void fetchInvitePreview(token).then((p) => {
      if (!p) return;
      setInvitePreview(p);
      setEmail(p.email);
      if (p.kind !== "general") setMode("signup");
    });
  }, []);

  // Red 2: la sesión de recuperación que la librería ya estableció. Si el
  // evento PASSWORD_RECOVERY llega después del montaje (la lectura del
  // enlace termina tras la red), se cambia a recuperación aunque el hash
  // ya no esté en la URL.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Red 3: si la sesión ya estaba establecida al montar (la librería
  // terminó de leer el enlace antes del montaje), se entra en
  // recuperación. Con persistSession: false el cliente solo tiene sesión
  // si la acaba de leer de la URL, y el único flujo que pone una sesión
  // en la URL es la recuperación.
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) setMode("recovery");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (session === null) {
    return <p className="p-6 text-center text-sm text-[var(--dim)]">Cargando SyncFinanzas…</p>;
  }
  if (session) {
    if (showWelcome) {
      return <WelcomeVidaFinanciera onStart={dismissWelcome} onSkip={dismissWelcome} />;
    }
    return <>{children}</>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "recovery") {
        const check = passwordChecks(password);
        if (!check.ok) throw new Error(check.message);
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw new Error("No se pudo restablecer la contraseña. Solicite un enlace nuevo.");
        setInfo("Su contraseña se restableció. Ya puede iniciar sesión.");
        // El token de recuperación ya se usó: se quita del enlace para que
        // al recargar no se vuelva a entrar en modo de recuperación con un
        // token consumido.
        try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* sin historial disponible */ }
        setMode("login");
        setPassword("");
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, email, password }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        needsConfirmation?: boolean;
        user?: { id?: string; email?: string };
      } | null;
      if (!res.ok) throw new Error(json?.error ?? "No se pudo completar la operación.");
      if (mode === "forgot") {
        setInfo(json?.message ?? "Si el correo está registrado, recibirá un enlace para restablecer su contraseña.");
        return;
      }
      if (json?.needsConfirmation) {
        setInfo("Revise su correo: debe confirmar su cuenta antes de entrar.");
        return;
      }
      if (json?.user) {
        // El servidor ya emitió la cookie de sesión en la respuesta: se
        // confirma con /api/session y se muestra la aplicación.
        const u = await fetchSession();
        if (!u) throw new Error("No se pudo iniciar la sesión. Inténtelo de nuevo.");
        setSession(true);
        // Cuenta recién creada en esta sesión: mostrar la bienvenida una
        // sola vez. Al iniciar sesión con una cuenta existente no se
        // muestra (criterio en memoria, no bandera guardada).
        if (mode === "signup") setShowWelcome(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error. Inténtelo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    login: "Iniciar sesión",
    signup: "Crear su cuenta",
    forgot: "Restablecer contraseña",
    recovery: "Elija una contraseña nueva",
  };
  const check = passwordChecks(password);

  return (
    <main className="min-h-screen flex items-start sm:items-center justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0">
        <h1 className="font-display font-bold text-2xl">SyncFinanzas</h1>
        <p className="text-sm text-[var(--dim)] mt-1">Finanzas del hogar, claras y compartidas.</p>
        <p className="font-display font-bold text-base mt-2">Aquí empieza su vida financiera</p>
        {invitePreview && (
          <div className="mt-4 rounded-2xl border-2 border-[var(--gold)] bg-[var(--surface2)] p-4" role="status">
            <p className="font-display font-bold">Usted recibió una invitación</p>
            <p className="text-sm text-[var(--dim)] mt-1">
              {invitePreview.kind === "household" && invitePreview.generic && <>Le invitan a probar SyncFinanzas{invitePreview.inviterName ? <> · le invitó {invitePreview.inviterName}</> : null}. Cree su cuenta y empiece con su propio espacio.</>}
              {invitePreview.kind === "household" && !invitePreview.generic && <>Para unirse al hogar <b>“{invitePreview.householdName}”</b>{invitePreview.inviterName ? <> · le invitó {invitePreview.inviterName}</> : null}.</>}
              {invitePreview.kind === "tanda" && <>Para participar en la tanda <b>“{invitePreview.tandaName}”</b>{invitePreview.inviterName ? <> · le invitó {invitePreview.inviterName}</> : null}.</>}
              {invitePreview.kind === "general" && <>Para crear su cuenta personal en SyncFinanzas{invitePreview.inviterName ? <> · le invitó {invitePreview.inviterName}</> : null}.</>}
            </p>
            <p className="text-sm mt-1">
              {invitePreview.usable
                ? invitePreview.kind === "household" && invitePreview.generic
                  ? "Cree su cuenta; después podrá crear su propio espacio. Este enlace no le da acceso al hogar de quien le invitó."
                  : "Cree su cuenta con el correo invitado y luego podrá aceptar o rechazar la invitación, sin crear un hogar nuevo por error."
                : "Esta invitación ya fue utilizada o venció. Solicite una invitación nueva a la persona que lo invitó."}
            </p>
          </div>
        )}
        <h2 className="font-display font-bold text-lg mt-5">{titles[mode]}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode !== "recovery" && (
            <label className="block text-sm font-semibold">
              Correo electrónico
              <input
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full rounded-xl border px-3 py-2.5 font-normal"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usted@correo.com"
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="block text-sm font-semibold">
              Contraseña
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete={mode === "signup" || mode === "recovery" ? "new-password" : "current-password"}
                className="mt-1 w-full rounded-xl border px-3 py-2.5 font-normal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 12 caracteres"
              />
            </label>
          )}
          {(mode === "signup" || mode === "recovery") && password.length > 0 && (
            <p className={`text-xs ${check.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{check.message}</p>
          )}
          {mode === "signup" && (
            // El ejemplo debe cumplir la regla (12 caracteres, mayúscula,
            // minúscula, número y símbolo): «Casa2026!» solo tiene 9 y
            // fallaría la validación, así que se usa su extensión válida.
            <p className="text-xs text-[var(--dim)]">
              Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo. Ejemplo: Casa2026!Azul
            </p>
          )}
          {mode !== "forgot" && mode !== "recovery" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
              Mostrar contraseña
            </label>
          )}
          {error && <p className="text-sm text-[var(--red)]" role="alert">{error}</p>}
          {info && <p className="text-sm text-[var(--green)]" role="status">{info}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-3 disabled:opacity-50"
          >
            {busy ? "Espere…" : titles[mode]}
          </button>
        </form>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-sm">
          {mode === "login" && (
            <>
              <button type="button" className="underline font-semibold" onClick={() => { setMode("signup"); setError(""); setInfo(""); }}>
                Crear una cuenta
              </button>
              <button type="button" className="underline font-semibold" onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}>
                Olvidé mi contraseña
              </button>
            </>
          )}
          {mode !== "login" && (
            <button type="button" className="underline font-semibold" onClick={() => { setMode("login"); setError(""); setInfo(""); }}>
              Volver a iniciar sesión
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--dim)] mt-5">
          Su contraseña debe tener al menos 12 caracteres, con mayúscula, minúscula, número y símbolo. Tras 5
          intentos fallidos, el correo se bloquea 15 minutos. Sus datos se guardan en su cuenta, no en el
          dispositivo: al instalar la aplicación verá la misma información, con su sesión iniciada.
        </p>
      </div>
    </main>
  );
}
