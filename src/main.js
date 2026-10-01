import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { isClientModeHash } from './sharelink.js';

// Customer tracking mode (?client=1): present the globe as a plain
// SAHJONY vessel-tracking page — never disclose the internal tool.
// Applied before boot so the loading screen is rebranded too.
if (isClientModeHash()) {
  document.title = 'SAHJONY LIVE VIEW · Seguimiento de buque en vivo';
  document.body.classList.add('gev-client-mode');
  // Remove the pre-paint bootstrap rebrand so its ::after label does not
  // double-render next to the real heading text set below.
  document.getElementById('gev-client-bootstrap')?.remove();
  const loaderTitle = document.querySelector('#loading-screen h2');
  if (loaderTitle) loaderTitle.textContent = 'SAHJONY LIVE VIEW';
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  if (loaderStatus) loaderStatus.textContent = 'Cargando vista en vivo…';
}

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
