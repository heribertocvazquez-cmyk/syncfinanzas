// Versión de la aplicación, visible al final de Hogar ("Versión: …").
// CÓMO SE ACTUALIZA: en cada despliegue, cambie APP_VERSION por el hash
// corto del commit que se publica (el que muestra GitHub en la página del
// commit). El mismo valor va en public/sw.js (SW_VERSION): cuando cambia,
// el navegador detecta que hay una versión nueva del service worker y la
// app muestra el aviso "Hay una nueva versión" con el botón Actualizar.
// Nota: el valor nombra el commit de los cambios que se publican; el
// commit que solo actualiza esta línea no cambia el número.
// Redespliegue 2026-11-24: Vercel no tomó el commit de versión bedcf0f;
// este cambio mínimo fuerza un despliegue nuevo.
export const APP_VERSION = "cacacbf";
