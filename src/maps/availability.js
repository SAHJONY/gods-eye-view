import { keySetupRequirement } from '../keySetupCore.mjs';
/**
 * Why Google 3D is unavailable, phrased so the tooltip and toast recommend the
 * RIGHT fix. With no credentials the fix is a key (or the ion route); with a
 * key or ion token configured, the tileset failed for another reason —
 * restrictions, quota, an EEA-billed key, or the network — and telling the
 * user to add a key they already added is the wrong advice.
 * @param {boolean} hasCredentials
 * @returns {string}
 */
export function photorealUnavailableReason(hasCredentials) {
  if (hasCredentials)
    return "Mosaicos Google 3D no disponibles — verifica las restricciones de API de la clave, la cuota o la red";
  return `${keySetupRequirement('google-maps')} — o un token de Cesium ion para la ruta alojada en ion`;
}
