// Documentos legales de SyncFinanzas (borradores, 2026-11-16).
//
// Los textos van ÍNTEGROS en la app, sin reescribir: son los borradores de
// ~/workspace/research_notes/legal-syncfinanzas-20-puntos-20261116/, pendientes
// de revisión de un abogado. Las partes entre corchetes [POR DEFINIR] son
// decisiones que faltan y NO se rellenan con datos inventados: quedan tal
// como están, para que Heriberto (y el abogado) las completen.
// La aceptación que se guarda es por VERSIÓN: si cambia la versión de
// algún documento, la aceptación vieja ya no vale y la puerta vuelve a
// aparecer (ver server/src/actions.ts, LEGAL_DOC_VERSIONS).
//
// El apartado «Versión de prueba» NO es un cuarto documento legal para
// aceptar por separado: es un apartado informativo dentro de la misma
// aceptación. Su versión queda registrada junto a las de los 3 documentos,
// en la misma fila de aceptación.

export const LEGAL_DOC_VERSION = "v1-2026-11-16";
export const LEGAL_NOTICE_VERSION = "v2-2026-11-24";
export const LEGAL_DOC_BADGE = "Borrador 2026-11-16 — pendiente de revisión de un abogado";

export interface LegalDoc {
  id: "privacy" | "terms" | "refunds";
  title: string;
  badge: string;
  body: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: "privacy",
    title: "Aviso de privacidad",
    badge: LEGAL_DOC_BADGE,
    body: `# BORRADOR — Aviso de privacidad de SyncFinanzas

> **BORRADOR — PENDIENTE DE REVISIÓN DE UN ABOGADO.** Este texto NO es el aviso definitivo ni debe publicarse tal cual. Es el punto de partida para que un abogado lo revise y valide la versión final en México, sobre todo por tratarse de datos financieros y de derechos ARCO. Las partes entre corchetes \`[POR DEFINIR]\` son decisiones que faltan.

## 1. Responsable del tratamiento

El responsable del tratamiento de sus datos personales es **[POR DEFINIR: nombre legal o persona responsable — hoy la app la opera Heriberto Cruz Vázquez como persona física; confirmar si habrá una persona moral]**.

- Correo de contacto para privacidad y derechos ARCO: **[POR DEFINIR: confirmar si es heribertocvazquez@gmail.com u otro correo institucional]**.
- Domicilio: [POR DEFINIR].

## 2. Datos personales que se tratan

SyncFinanzas solo pide los datos que cada función necesita; no pide dirección, teléfono, INE, RFC, cuentas bancarias ni ubicación:

- **Cuenta:** correo electrónico y contraseña (la contraseña la guarda Supabase Auth con hash; SyncFinanzas no la ve ni la almacena).
- **Hogar:** nombre del hogar, modo (Personal o Familiar), día de corte, reglas de reparto y aprobación, y umbral de aviso de gasto.
- **Perfiles:** nombre, apellidos, tipo (adulto o dependiente), ingreso mensual neto, compromisos fijos y correo opcional. Si usted registra a un dependiente menor de edad, solo se guarda su nombre y su relación con usted (ver punto 6).
- **Movimientos y finanzas:** concepto, importe, fecha, categoría, cuenta, visibilidad (Compartido o Privado) y foto opcional del comprobante.
- **Tandas:** nombres y correos de los participantes, pagos y comprobantes de pago.
- **Opiniones de testers (formulario opcional):** nombre y correo opcionales, calificaciones y comentarios.
- **Actividad y avisos:** registro de actividad del hogar y avisos (nuevo integrante, presupuesto excedido, etc.).

## 3. Finalidades

Sus datos se usan solo para que la app funcione: mostrar sus finanzas, calcular saldos y presupuestos, gestionar su hogar y sus tandas, enviarle avisos dentro de la app y atender sus solicitudes. No se usan para publicidad ni se venden.

## 4. Terceros que reciben datos

- **Supabase** (base de datos, autenticación y almacenamiento de fotos): recibe su correo, su contraseña con hash, los datos de su hogar y las fotos de comprobantes. Es donde viven los datos.
- **Vercel** (alojamiento de la app y la API): recibe las peticiones a la app (dirección IP y registros de acceso).
- **jsDelivr** (CDN del motor de lectura de comprobantes, Tesseract.js): cuando usted lee un comprobante, su navegador descarga el motor desde jsDelivr. La foto del comprobante NO sale de su dispositivo para leerse; solo la descarga deja ver su dirección IP.
- **Resend** (correos de invitación) y **OpenAI** (lectura automática opcional de comprobantes): hoy no están configurados y no reciben ningún dato. Si se configuran, se actualizará este aviso antes de usarlos.

No se comparte ningún dato con fines publicitarios ni con brokers de datos.

## 5. Cookies y almacenamiento local

La app usa solo lo esencial para funcionar:

- Dos cookies de sesión (\`sf_access\` y \`sf_refresh\`): guardan su sesión de forma segura (\`httpOnly\`, \`Secure\`, \`SameSite=Lax\`). Sin ellas no se puede entrar a la app.
- Almacenamiento local del navegador: el tema claro u oscuro, el PIN local (solo su hash, en su dispositivo), el perfil elegido y marcas de guía e instalación.

No hay cookies de analítica, publicidad ni rastreo de terceros.

## 6. Menores de edad

El servicio es para personas adultas. Si usted registra como dependiente a un hijo o hija menor de edad, lo hace bajo su responsabilidad como padre, madre o tutor, y solo se guarda su nombre y su relación con usted. **[POR DEFINIR con el abogado: procedimiento de consentimiento y constancia, o limitación de los datos de menores.]**

## 7. Derechos ARCO y revocación del consentimiento

Usted puede ejercer sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO), así como revocar su consentimiento, escribiendo al correo del punto 1 e indicando su nombre, su correo registrado y qué derecho quiere ejercer. El responsable debe responder en los plazos que marca la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP). **[POR DEFINIR con el abogado: plazos exactos y medio de respuesta.]**

La cancelación de sus datos incluye el borrado de su cuenta de acceso y de todos los datos de su hogar. Hoy el borrado completo se atiende por ese correo; el borrado desde la app (botón de borrado de cuenta) está pendiente de implementarse. El reinicio de datos disponible en Hogar borra los datos del hogar, pero no la cuenta de acceso.

## 8. Cambios a este aviso

Si cambia qué datos se tratan o con quién se comparten, se actualizará este aviso y se le avisará dentro de la app antes de que el cambio aplique.

## 9. Fecha de última actualización

[POR DEFINIR: fecha en que el abogado valide la versión final.]`,
  },
  {
    id: "terms",
    title: "Términos y condiciones",
    badge: LEGAL_DOC_BADGE,
    body: `# BORRADOR — Términos y condiciones de SyncFinanzas

> **BORRADOR — PENDIENTE DE REVISIÓN DE UN ABOGADO.** Este texto NO es la versión definitiva ni debe publicarse tal cual. Es el punto de partida para que un abogado lo revise y valide la versión final en México. Las partes entre corchetes \`[POR DEFINIR]\` son decisiones que faltan.

## 1. Qué es SyncFinanzas

SyncFinanzas es una aplicación para organizar las finanzas del hogar: registro de gastos e ingresos, presupuestos, metas de ahorro, acuerdos, patrimonio y tandas entre personas conocidas. La opera **[POR DEFINIR: nombre legal o persona responsable]** (en adelante, «el operador»).

## 2. Cuenta

- Para usar la app usted crea una cuenta con su correo electrónico y una contraseña (mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo).
- Usted es responsable de su contraseña y de lo que se haga con su cuenta. Si cree que alguien más entró a su cuenta, cambie su contraseña y avise al operador.
- El servicio es para personas adultas. Si usted registra dependientes menores de edad, lo hace bajo su responsabilidad (ver el aviso de privacidad).
- Tras 5 intentos fallidos de inicio de sesión, el correo se bloquea 15 minutos.

## 3. Uso permitido

Usted se compromete a usar la app solo para sus finanzas personales o de su hogar, con datos verdaderos, y a no usarla para actividades ilícitas, para engañar a otros integrantes de su hogar o de su tanda, ni para dañar la app o a otros usuarios.

## 4. Tandas: la app no mueve dinero

- La app organiza tandas: registra quiénes participan, en qué orden les toca, quién pagó y quién recibió, con comprobante de pago subido por el participante.
- **La app no recibe, guarda, mueve ni entrega dinero de las tandas.** Los pagos se hacen fuera de la app, entre los participantes, por los medios que ellos acuerden (efectivo, transferencia, depósito).
- La app no cobra intereses, no calcula CAT, no consulta Buró de Crédito y no es intermediario financiero ni institución de crédito.
- El operador no responde por pagos que no se hagan, por entregas entre participantes ni por desacuerdos dentro de una tanda; las reglas de cada tanda (multas, cobertura, exclusión) las define el grupo y se registran en la app.

## 5. Precios y planes

- **Personal: gratis.** Para una persona, con sus finanzas y sus tandas.
- **Familiar: $49 MXN + IVA = $56.84 MXN final al mes por hogar** (no por persona), con 30 días gratis al inicio. El precio final con IVA incluido es $56.84 MXN al mes por hogar.
- Hoy la app no cobra nada real: el cobro se activará cuando se integre el medio de pago y se avisará antes dentro de la app. Los cargos se hacen por mes, por hogar.
- **Cancelación:** usted puede cancelar su plan Familiar cuando quiera desde la app, sin penalización; la cancelación aplica al final del periodo ya pagado. Los reembolsos se rigen por la Política de reembolsos.

## 6. Sus datos y su privacidad

El tratamiento de sus datos se rige por el Aviso de privacidad de SyncFinanzas, que debe leer antes de crear su cuenta. Al crear su cuenta usted acepta estos términos y el aviso de privacidad (las casillas nacen sin palomear; usted las marca).

## 7. Disponibilidad y responsabilidad

- La app se ofrece «como está». El operador procura que esté disponible, pero no garantiza que nunca falle ni que no pierda datos; se recomienda no depender de la app como único registro de sus finanzas.
- El operador no responde por decisiones financieras que usted tome con la información de la app: los cálculos usan los números que usted registra.
- El plan de ahorro de una meta es una proyección con sus propios números; no es una promesa de rendimiento ni de ganancia.

## 8. Cambios y terminación

- El operador puede actualizar estos términos y avisar dentro de la app antes de que apliquen; si usted sigue usando la app, acepta la versión nueva.
- Usted puede dejar de usar la app cuando quiera y pedir el borrado de su cuenta (ver el aviso de privacidad, derechos ARCO). El operador puede suspender cuentas que incumplan estos términos.

## 9. Ley aplicable y contacto

Estos términos se rigen por las leyes de México. Para cualquier duda o reclamación, escriba a **[POR DEFINIR: correo de contacto]**.

## 10. Fecha de última actualización

[POR DEFINIR: fecha en que el abogado valide la versión final.]`,
  },
  {
    id: "refunds",
    title: "Política de reembolsos",
    badge: LEGAL_DOC_BADGE,
    body: `# BORRADOR — Política de reembolsos de SyncFinanzas

> **BORRADOR — PENDIENTE DE REVISIÓN DE UN ABOGADO.** Este texto NO es la versión definitiva ni debe publicarse tal cual. Es el punto de partida para que un abogado lo revise y valide la versión final en México. Las partes entre corchetes \`[POR DEFINIR]\` son decisiones que faltan.

## 1. Planes y cobro

- **Personal: gratis.** Sin cobro y sin reembolsos que aplicar.
- **Familiar: $49 MXN + IVA = $56.84 MXN final al mes por hogar** (no por persona), con 30 días gratis al inicio. El precio final con IVA incluido es $56.84 MXN al mes por hogar, y se muestra así antes de pagar.
- Hoy la app no cobra nada real: esta política aplica a partir de que se active el cobro, y se avisará antes dentro de la app. El cobro es mensual, por hogar, por adelantado.

## 2. Periodo gratis

Los 30 días gratis no se cobran. Si usted cancela durante el periodo gratis, no se le cobra nada. El primer cobro se hace al terminar los 30 días, salvo que usted cancele antes.

## 3. Cancelación

Usted puede cancelar su plan Familiar cuando quiera desde la app, sin penalización. La cancelación aplica al final del periodo ya pagado: usted sigue usando el plan Familiar hasta que termine ese mes, y después su hogar pasa al plan Personal gratis. Cancelar no borra sus datos (eso es aparte: ver el aviso de privacidad y el borrado de cuenta).

## 4. Cuándo hay reembolso

Se devuelve el dinero en estos casos:

- **Error de cobro:** se le cobró sin que usted lo autorizara, o se le cobró dos veces el mismo mes. Se devuelve el cobro duplicado o no autorizado.
- **Cobro después de cancelar:** se le cobró un mes que ya había cancelado antes de su fecha de cobro. Se devuelve ese mes.
- **Falla grave del servicio:** la app no estuvo disponible o no funcionó para su uso básico durante una parte importante del mes pagado, por causa atribuible al operador. El reembolso es proporcional a los días afectados, a juicio del operador.

## 5. Cuándo NO hay reembolso

- El mes en curso ya iniciado: si usted cancela a mitad de un mes pagado, ese mes no se devuelve; usted lo usa hasta que termine (ver punto 3).
- No haber usado la app durante el mes pagado.
- Haber aceptado el cobro y después cambiar de opinión sin que haya un error de cobro ni una falla del servicio.

## 6. Cómo pedir un reembolso

Escriba a **[POR DEFINIR: correo de contacto]** indicando su correo registrado, la fecha y el importe del cobro, y el motivo. El operador revisa la solicitud y responde en **[POR DEFINIR con el abogado: plazo de respuesta, por ejemplo 10 días hábiles]**. Si procede, el reembolso se hace por el mismo medio con el que se pagó, en **[POR DEFINIR: plazo de devolución]**.

## 7. Cambios a esta política

Si cambia, se avisará dentro de la app antes de que aplique, y la versión vigente será la publicada en la app.

## 8. Fecha de última actualización

[POR DEFINIR: fecha en que el abogado valide la versión final.]`,
  },
];

// Apartado informativo «Versión de prueba» (2026-11-23; v2 2026-11-24,
// aprobada por Heriberto): va en la misma pantalla de aceptación, junto a
// los 3 borradores, y en los documentos de Configuración. NO es un cuarto
// documento legal para aceptar por separado: la aceptación cubre los 3
// documentos y este apartado queda registrado como parte de la versión
// aceptada (notice_version). La v2 agrega UNA línea: durante la prueba se
// analizarán qué botones son los más usados (analítica de uso: solo el
// módulo y el botón, sin importes ni contenido; ver usageLog.ts y
// supabase/add-usage-events.sql). Al subir la versión, la puerta vuelve a
// aparecer para todos en su siguiente entrada, incluida la de Heriberto.
export const LEGAL_TEST_NOTICE = {
  title: "Versión de prueba",
  badge: "Información para testers",
  body: `La app está en fase de pruebas; las actualizaciones son frecuentes y pueden cambiar pantallas y funciones.

Sobre su información: sus datos solo los ve su hogar; no se comparten con terceros ni con otros hogares; no se usan para otra cosa que hacer funcionar la app; y al terminar el piloto o cuando lo pidan, se borran.

Durante el tiempo de prueba se analizarán qué botones son los más usados.`,
};
