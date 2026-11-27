# SyncFinanzas — Versión desplegable (Vercel + Supabase, planes gratuitos)

Diseñada por Ren.

Aplicación web de finanzas del hogar con modo Personal y modo Familiar,
tandas, comprobantes, gráficas y guías. Esta versión ya NO depende de Muse:
cualquier persona con el enlace puede entrar con su correo y contraseña,
con sesión abierta y datos compartidos en el hogar.

**No se necesita terminal ni pagar nada para el piloto con 10 personas.**
Todo se hace desde el navegador, con cuentas gratuitas.

## Qué cambió respecto a la versión de Muse

| Antes (Muse) | Ahora (desplegable) |
|---|---|
| Datos y sesión de `@hatch/space-sdk` (solo dentro de Muse) | Postgres de Supabase + Supabase Auth (correo y contraseña) |
| Fotos en blobs de Muse | Supabase Storage, bucket privado `comprobantes` |
| Lectura de comprobante con la inferencia de Muse | Visión por IA con OpenAI, **opcional** (ver abajo) |
| Invitaciones solo en la aplicación (sin correo) | Envío automático por correo con Resend, **opcional** (ver abajo): enlace directo con token de un solo uso, vigencia de 7 días; sin la clave, la aplicación muestra el enlace para copiarlo |
| Límite de peticiones en memoria del proceso | Límite persistente en la tabla `rate_limits` |
| Sin contraseñas propias (sesión de la plataforma) | Contraseña propia: mínimo 12 caracteres, con bloqueo tras 5 intentos fallidos |
| Un solo hogar por espacio | Muchos hogares: cada usuario solo ve su hogar (tabla `household_members`) |
| Sin link público | Link `https://<nombre>.vercel.app` |
| Visor de PDF de la plataforma | Visor nativo del navegador (no muestra el total de páginas) |

Las funciones son las mismas: Personal/Familiar, movimientos
Compartidos/Privados, reversar movimientos, reiniciar todo, tandas v2
(sorteo al azar o ponderado, comprobante verificado, estrellas del
organizador), presupuestos, fondos, metas, acuerdos, patrimonio, guías en
PDF, video guía, PWA instalable en Android e iOS, registro de actividad y
validación en el servidor.

## Cuentas gratuitas necesarias (3 obligatorias + 1 opcional)

1. **GitHub** (gratis): guarda el código y lo conecta con Vercel.
2. **Supabase** (plan Free): base de datos Postgres, autenticación y
   almacenamiento de fotos. Límites del plan gratuito: 500 MB de base de
   datos, 50 000 usuarios activos al mes, 1 GB de archivos. **Ojo: los
   proyectos gratuitos se pausan tras 7 días sin uso**; se reactivan con un
   clic en el panel de Supabase.
3. **Vercel** (plan Hobby, gratis): publica la aplicación y le da el enlace
   `https://<nombre>.vercel.app`. Límites del plan gratuito: 100 GB de
   transferencia al mes, suficiente para el piloto.
4. **Resend** (plan gratuito, opcional pero recomendado): envía las
   invitaciones por correo automáticamente (100 correos al día). Sin esta
   cuenta, las invitaciones se crean igual, pero el correo no se envía y la
   aplicación muestra el enlace para copiarlo. Ver el Paso 3b.

No se crea ninguna cuenta en este paquete: las crea Heriberto (o quien él
indique) siguiendo los pasos. No hay claves ni contraseñas en el código.

## Paso 1 — Subir el código a GitHub (10 minutos)

1. Entre a github.com con su cuenta y pulse **New repository**.
2. Nombre: `syncfinanzas`. Elija **Private** (recomendado: es su lógica de
   negocio). **No** marque ninguna casilla de README.
3. Pulse **uploading an existing file**.
4. En su computadora, descomprima el ZIP de este proyecto y arrastre **el
   contenido** de la carpeta `syncfinanzas` (no la carpeta) a la ventana de
   GitHub.
5. Pulse **Commit changes**. El código ya quedó guardado.

## Paso 2 — Crear el proyecto en Supabase (15 minutos)

1. Entre a supabase.com con su cuenta (puede entrar con GitHub) y pulse
   **New project**.
2. Nombre: `syncfinanzas`. Elija una contraseña segura para la base de datos
   y guárdela en un lugar seguro (no es la contraseña de la aplicación).
   Región: la más cercana (por ejemplo, São Paulo o US East).
3. Cuando el proyecto esté listo, abra **SQL Editor** > **New query**.
4. Abra el archivo `supabase/schema.sql` de este proyecto, copie TODO su
   contenido, péguelo en el editor y pulse **Run**. Debe decir que se
   ejecutó sin errores. Esto crea las 23 tablas, los índices, la seguridad
   (RLS) y el bucket privado `comprobantes`. Puede ejecutarse dos veces sin
   duplicar nada.
5. En **Authentication** > **Providers** > **Email**:
   - Desactive **Confirm email** (para el piloto: así la cuenta queda
     activa de inmediato, sin esperar el correo de confirmación).
   - En **Password requirements** (si aparece), ponga mínimo **12
     caracteres**. La aplicación además exige mayúscula, minúscula, número
     y símbolo.
6. Copie estos 3 valores (los necesitará en el paso 3):
   - **Settings > API > Project URL** → `SUPABASE_URL` y
     `VITE_SUPABASE_URL` (el mismo valor, dos veces).
   - **Settings > API > anon public** → `SUPABASE_ANON_KEY` y
     `VITE_SUPABASE_ANON_KEY` (el mismo valor, dos veces).
   - **Settings > API > service_role** → `SUPABASE_SERVICE_ROLE_KEY`.
     **Esta clave es secreta: solo va en Vercel, nunca en GitHub ni en el
     navegador.**
   - **Settings > Database > Connection string > Transaction pooler**
     (puerto **6543**): es la `DATABASE_URL`. Tiene el formato
     `postgresql://postgres.USUARIO:PASSWORD@...pooler.supabase.com:6543/postgres?sslmode=require`.
     Use la contraseña de la base de datos del paso 2. **No use la cadena
     directa (puerto 5432): en Vercel no funciona bien con las funciones
     serverless.**

## Paso 3 — Desplegar en Vercel (10 minutos)

1. Entre a vercel.com con su cuenta (puede entrar con GitHub) y pulse
   **Add New… > Project**.
2. Elija **Import** en el repositorio `syncfinanzas` de GitHub.
3. En **Environment Variables**, agregue una por una (sin comillas):
   - `SUPABASE_URL` = la URL del proyecto
   - `SUPABASE_ANON_KEY` = la clave anónima
   - `SUPABASE_SERVICE_ROLE_KEY` = la clave service_role (secreta)
   - `VITE_SUPABASE_URL` = la misma URL del proyecto
   - `VITE_SUPABASE_ANON_KEY` = la misma clave anónima
   - `DATABASE_URL` = la cadena del pooler (puerto 6543)
   - `OPENAI_API_KEY` = **opcional**, solo para la lectura automática de
     comprobantes (ver la sección siguiente). Si no la tiene, no agregue
     esta variable.
   - `RESEND_API_KEY` = **opcional, recomendado**, para el envío automático
     de invitaciones por correo (ver el Paso 3b). Si no la tiene, no agregue
     esta variable: las invitaciones mostrarán el enlace para copiarlo.
   - `RESEND_FROM` = **opcional**, remitente con dominio propio verificado
     (por ejemplo: `SyncFinanzas <invitaciones@sudominio.com>`). Sin esta
     variable, el remitente es `onboarding@resend.dev`.
   - `APP_URL` = **opcional**, la URL pública de la aplicación (por ejemplo:
     `https://syncfinanzas.vercel.app`). Si no la pone, se toma del dominio
     de Vercel.
4. Pulse **Deploy**. Vercel compila y publica. Al terminar muestra el
   enlace, por ejemplo: `https://syncfinanzas.vercel.app`.
5. Ese es el enlace del piloto: ábralo en el celular, cree su cuenta con
   correo y contraseña, y luego **instálelo** (ver Paso 5).

Si Vercel pide el **Framework Preset**, déjelo en **Vite** (el archivo
`vercel.json` ya trae la configuración). Si el despliegue falla, revise
primero que las 6 variables obligatorias estén completas y que la `DATABASE_URL` sea la
del pooler (6543).

## Paso 3b — Envío automático de invitaciones por correo (Resend, gratis)

Sin esta cuenta, las invitaciones **sí se crean**, pero el correo no se
envía: la aplicación muestra el enlace de invitación para copiarlo y
enviarlo por el medio que prefiera. Con Resend, el correo sale directo
desde la aplicación, con un enlace que abre la invitación sin compartir el
enlace manualmente.

1. Entre a resend.com y cree su cuenta gratuita (puede entrar con GitHub).
   El plan gratuito incluye **100 correos al día**, suficiente para el
   piloto con 10 personas.
2. En el panel, vaya a **API Keys** y pulse **Create API Key**. Póngale el
   nombre `syncfinanzas`, deje el permiso en **Sending access** y pulse
   **Add**. Copie la clave (empieza por `re_`): **solo se muestra una
   vez**. Guárdela en un lugar seguro; nunca la suba a GitHub ni la
   comparta en chat.
3. En Vercel, en el proyecto `syncfinanzas`, vaya a **Settings >
   Environment Variables** y agregue `RESEND_API_KEY` con esa clave.
4. Vuelva a desplegar: **Deployments > Redeploy** (o haga un cambio
   mínimo). Sin redesplegar, la variable no llega a la aplicación.
5. Pruebe: invite a un correo suyo desde Perfiles → Invitaciones. Debe
   llegar un correo de SyncFinanzas con el botón **Abrir invitación**.
   Al abrirlo, la persona crea su cuenta con el correo invitado y luego
   acepta o rechaza, entrando directamente al hogar o a la tanda.

- **Remitente:** sin configurar nada más, los correos salen de
  `onboarding@resend.dev` (remitente de pruebas de Resend). Para usar su
  propio dominio (por ejemplo, `invitaciones@sudominio.com`), en Resend
  vaya a **Domains > Add Domain**, siga los pasos de verificación DNS y
  luego configure `RESEND_FROM` en Vercel, por ejemplo:
  `SyncFinanzas <invitaciones@sudominio.com>`.
- **Enlace de invitación:** cada correo trae un enlace directo del tipo
  `https://<app>.vercel.app/invite?token=...`, de **un solo uso** y con
  **vigencia de 7 días**. Al aceptar o rechazar, el enlace deja de
  funcionar. Al reenviar una invitación, se genera un enlace nuevo y el
  anterior queda sin efecto. Solo el correo invitado puede aceptar.
- **Los 3 tipos de invitación usan el mismo mecanismo:** invitación al
  hogar (entra al mismo hogar, sin crear uno nuevo), invitación a una
  tanda (entra como participante visible) e invitación general para crear
  una cuenta personal (la persona crea su propio espacio personal).
- **Solución de problemas:** si el correo no llega, revise en Vercel que
  `RESEND_API_KEY` esté configurada y que haya redesplegado después de
  agregarla; revise también la carpeta de spam. En Resend, **Emails >
  Logs** muestra si el correo se envió o si hubo un error (por ejemplo,
  clave inválida). Si el remitente es `onboarding@resend.dev`, algunos
  buzones lo marcan como spam en la primera entrega.

## Paso 4 — Primera prueba (lista de verificación)

Haga esto con el enlace ya publicado, antes de invitar a las 10 personas:

1. Cree su cuenta con su correo y una contraseña fuerte (12 caracteres,
   mayúscula, minúscula, número y símbolo).
2. Cree su hogar (modo Personal o Familiar) y ponga su sueldo.
3. Registre un gasto y un ingreso; verifique que los saldos cuadren.
4. Suba la foto de un comprobante a un gasto y verifique que se vea.
5. Pruebe el botón **Reversar** en un movimiento.
6. Cree una tanda, invite a una segunda persona con otro correo: debe
   llegarle el correo con el botón **Abrir invitación** (si configuró
   Resend; si no, la aplicación le mostrará el enlace para copiarlo), y
   que esa persona cree su cuenta con el correo invitado y acepte la
   invitación: debe entrar **al mismo hogar**, sin crear uno nuevo.
   Pruebe también la invitación general desde la pantalla de entrada:
   la persona debe poder crear su cuenta personal con el enlace.
7. Pruebe el botón **Reiniciar todo** solo si quiere borrar los datos de
   prueba (pide escribir REINICIAR; es irreversible).
8. Cierre sesión y vuelva a entrar: los datos deben seguir ahí.

## Paso 5 — Instalar en el celular (gratis, sin tienda)

- **Android (Chrome):** abra el enlace, toque el botón **Instalar la
  aplicación** de la tarjeta de instalación, o el menú ⋮ > **Instalar
  aplicación**. Queda el icono en la pantalla principal.
- **iPhone (Safari):** abra el enlace **en Safari**, toque **Compartir** >
  **Agregar a pantalla de inicio** > **Agregar**. Apple no permite la
  instalación con un solo toque.
- En ambos casos la aplicación se abre a pantalla completa, con su sesión
  iniciada y los mismos datos.

## Lectura automática de comprobantes (aviso honesto)

En Muse, la lectura la hacía la inferencia de la plataforma. Fuera de Muse
no existe un servicio gratuito equivalente. Esta versión la implementa con
la API de OpenAI (modelo `gpt-4o-mini`, de bajo costo por foto) **solo si**
se configura `OPENAI_API_KEY` en Vercel:

- **Sin la clave:** al tocar **Leer comprobante**, la aplicación muestra un
  aviso claro y no inventa ninguna lectura. La foto se puede adjuntar como
  comprobante visual y el gasto se registra manualmente, como antes.
- **Con la clave:** la lectura funciona igual que en la prueba que hizo
  Heriberto en Muse (tienda, productos con importes y total).
- La clave de OpenAI es de pago por uso (no es suscripción premium de la
  aplicación). Si no quiere ese costo, no la configure: el resto de la
  aplicación no la necesita.

## Seguridad aplicada (checklist del video de CubePath Labs)

- **Claves fuera del código:** todas las claves viven en variables de
  entorno de Vercel. En el código no hay ninguna clave, contraseña ni dato
  bancario.
- **Validación en el servidor:** cada operación se valida con esquemas en
  `/api/actions` antes de tocar la base de datos.
- **Permisos por usuario:** cada acción verifica la sesión (JWT de Supabase)
  y la membresía del hogar (`household_members`). Un usuario no puede ver
  ni tocar el hogar de otro. Solo el administrador puede reiniciar todo,
  editar el hogar, eliminar perfiles o invitaciones. Las invitaciones solo
  las acepta el correo invitado.
- **Límites de peticiones:** por operación y por minuto, guardados en
  Postgres (la lectura de comprobantes es la más estricta).
- **Backups con logs:** registro de actividad (`activity_log`, últimas 30
  operaciones visibles en Hogar). Respaldo de la base: Supabase hace
  respaldos automáticos diarios en el plan gratuito (retención de 7 días);
  para un respaldo manual, en Supabase: **Database > Backups**.
- **Invitaciones por correo:** cada invitación genera un token de un solo
  uso con vigencia de 7 días; en la base solo se guarda su hash SHA-256
  (tabla `invitation_tokens`), nunca el token en texto plano. Al aceptar,
  rechazar, reenviar o borrar, el token anterior queda sin efecto. Solo el
  correo invitado puede aceptar. El correo se envía con Resend desde el
  servidor; sin `RESEND_API_KEY`, la aplicación muestra el enlace para
  copiarlo y nunca promete un correo que no salió.
- **Contraseñas:** mínimo 12 caracteres con mayúscula, minúscula, número y
  símbolo; bloqueo de 15 minutos tras 5 intentos fallidos; las guarda
  Supabase Auth con hash y sal.

## Qué NO se migra desde Muse

La aplicación desplegada **arranca vacía**. No se migran los datos de la
versión de Muse (movimientos, tandas, fotos ni perfiles), porque esa base
vive dentro de Muse y no se puede exportar con sus archivos. Cada persona
crea su hogar y sus datos desde cero en el enlace nuevo. Las categorías
predeterminadas (7 de ingreso, 14 de gasto) se crean solas al crear el
hogar, igual que en Muse.

## Solución de problemas

- **“Faltan VITE_SUPABASE_URL…” al abrir la aplicación:** las variables
  `VITE_…` no están en Vercel. Agréguelas y vuelva a desplegar (Deployments
  > Redeploy).
- **“Sesión no válida” siempre:** la `SUPABASE_URL` o la clave anónima no
  coinciden con el proyecto. Revise que sean del mismo proyecto de
  Supabase.
- **Error al crear el hogar o al guardar:** casi siempre es la
  `DATABASE_URL`: debe ser la del **pooler (6543)**, con la contraseña de
  la base de datos, y terminar en `?sslmode=require`.
- **“No se pudo ejecutar el SQL” en Supabase:** copie el archivo
  `supabase/schema.sql` completo, sin cortar el inicio ni el final.
- **La aplicación se ve pero no guarda:** revise en Vercel que la
  `SUPABASE_SERVICE_ROLE_KEY` esté configurada (sin ella el servidor no
  puede escribir).
- **“El correo de invitación no llegó”:** revise en Vercel que
  `RESEND_API_KEY` esté configurada y que haya redesplegado después de
  agregarla; revise la carpeta de spam. En Resend, **Emails > Logs**
  muestra si el correo se envió. Sin la clave, la aplicación muestra el
  enlace para copiarlo: no es un error, es el respaldo previsto.
- **El proyecto de Supabase se pausó:** en el panel de Supabase pulse
  **Restore / Resume**. Es normal en el plan gratuito tras 7 días sin uso.

## Estructura del proyecto

- `client/` — aplicación React (la misma interfaz de Muse, adaptada).
- `api/` — funciones serverless de Vercel: `actions.ts` (todas las
  operaciones), `auth.ts` (registro, inicio de sesión y bloqueo) e
  `invite.ts` (vista previa pública de un enlace de invitación).
- `server/src/` — lógica de negocio (`actions.ts`, 50 acciones),
  esquema Drizzle (`schema.ts`), envío de invitaciones por correo
  (`mail.ts`, Resend) y enlaces con token (`invites.ts`), y la capa que
  sustituye a Muse (`space-shim.ts`, `db.ts`, `supabase.ts`).
- `supabase/schema.sql` — tablas, índices, RLS y bucket (23 tablas).
- `public/` — manifiesto PWA, iconos y service worker.
