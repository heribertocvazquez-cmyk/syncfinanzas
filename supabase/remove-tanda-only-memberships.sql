-- Quitar membresías derivadas solo de invitaciones de tanda (corrección de privacidad 2026-11-19).
-- Antes del despliegue de hoy, al aceptar una invitación de TANDA el invitado
-- quedaba como miembro del hogar del invitador (respondTandaInvitation creaba
-- la fila en household_members), y con esa membresía veía el panel completo
-- de ese hogar (movimientos, cuentas, presupuestos, miembros). Eso ya no debe
-- pasar: quien acepta una tanda solo participa en ESA tanda, que se le muestra
-- en su propio espacio Personal, sin acceso al hogar del invitador.
-- El despliegue ya NIEGA ese acceso en el servidor aunque la fila siga ahí
-- (el despachador y getOverview tratan la membresía solo de tanda como si no
-- existiera), así que este SQL es higiene, no el mecanismo de privacidad:
-- quita las filas viejas para que el selector «Cambiar de hogar» y los
-- registros queden limpios.
--
-- SOLO se borra la membresía de quien cumple TODO esto a la vez:
--   1. NO es dueño del hogar.
--   2. NO aceptó ninguna invitación AL HOGAR (por correo o por código).
--   3. ES participante (no excluido) de una tanda de ese hogar.
--   4. Aceptó una invitación de TANDA para una de esas tandas.
-- NUNCA se borra: el participante de la tanda, sus pagos, sus comprobantes,
-- ni la membresía de quien entró por invitación al hogar.
-- Ejecutar en Supabase → SQL Editor (proyecto jjkrhnmcbccnamxfbgnt).
-- Primero corre la vista previa (paso 1) y revisa las filas; si son solo las
-- de invitados de tanda, corre el DELETE (paso 2) y la verificación (paso 3).

-- 1) VISTA PREVIA: filas que se borrarán. Revíselas antes del DELETE.
SELECT DISTINCT hm.id AS membresia_id, hm.household_id, h.name AS hogar,
       hm.user_id, u.email AS correo_miembro
FROM public.household_members hm
JOIN public.households h ON h.id = hm.household_id
JOIN auth.users u ON u.id = hm.user_id
JOIN public.tandas t ON t.household_id = hm.household_id
JOIN public.tanda_participants tp ON tp.tanda_id = t.id
  AND lower(tp.email) = lower(u.email)
  AND tp.excluded <> 1
JOIN public.tanda_invitations ti ON ti.household_id = hm.household_id
  AND ti.status = 'accepted'
  AND ti.tanda_id = tp.tanda_id
LEFT JOIN public.invitations i ON i.household_id = hm.household_id
  AND i.status = 'accepted'
  AND lower(i.email) = lower(u.email)
WHERE hm.user_id <> h.owner_user_id
  AND i.id IS NULL
ORDER BY hm.household_id, u.email;

-- 2) BORRADO: solo las membresías de la vista previa.
DELETE FROM public.household_members
WHERE id IN (
  SELECT hm.id
  FROM public.household_members hm
  JOIN public.households h ON h.id = hm.household_id
  JOIN auth.users u ON u.id = hm.user_id
  JOIN public.tandas t ON t.household_id = hm.household_id
  JOIN public.tanda_participants tp ON tp.tanda_id = t.id
    AND lower(tp.email) = lower(u.email)
    AND tp.excluded <> 1
  JOIN public.tanda_invitations ti ON ti.household_id = hm.household_id
    AND ti.status = 'accepted'
    AND ti.tanda_id = tp.tanda_id
  LEFT JOIN public.invitations i ON i.household_id = hm.household_id
    AND i.status = 'accepted'
    AND lower(i.email) = lower(u.email)
  WHERE hm.user_id <> h.owner_user_id
    AND i.id IS NULL
);

-- 3) VERIFICACIÓN: debe devolver 0 filas (ya no queda ninguna membresía solo de tanda).
SELECT DISTINCT hm.id AS membresia_id, hm.household_id, h.name AS hogar,
       hm.user_id, u.email AS correo_miembro
FROM public.household_members hm
JOIN public.households h ON h.id = hm.household_id
JOIN auth.users u ON u.id = hm.user_id
JOIN public.tandas t ON t.household_id = hm.household_id
JOIN public.tanda_participants tp ON tp.tanda_id = t.id
  AND lower(tp.email) = lower(u.email)
  AND tp.excluded <> 1
JOIN public.tanda_invitations ti ON ti.household_id = hm.household_id
  AND ti.status = 'accepted'
  AND ti.tanda_id = tp.tanda_id
LEFT JOIN public.invitations i ON i.household_id = hm.household_id
  AND i.status = 'accepted'
  AND lower(i.email) = lower(u.email)
WHERE hm.user_id <> h.owner_user_id
  AND i.id IS NULL
ORDER BY hm.household_id, u.email;
