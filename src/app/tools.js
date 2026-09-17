import { SceneDirector } from '../scenes/director.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { createGevActionRunner } from '../voice/gevActions.js';
import { initSahjonyVoice } from '../voice/sahjonyVoice.js';
import { initStreetView } from '../streetview/streetView.js';
import { initDriveForDollars } from '../drive/driveForDollars.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

/** Attach scene tools, rendering listeners and the application debug handle. */
export function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const { dataManager } = data;
  const sceneDirector = new SceneDirector(viewer, styleManager, dataManager, {
    dataPacks: sceneDataPacks,
    isMapStackAvailable: (id) =>
      mapStackController?.isStackAvailable(id) === true,
  });
  dataManager.layers
    .get('bhote-koshi-2026')
    ?.module.attachSceneController(sceneDirector);
  defer(() => sceneDirector.destroy());
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  // DISPLAY ▸ Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button.
  const drawTool = initDrawTool({ viewer, annotations });
  defer(() => drawTool?.destroy());
  if (startChrome)
    defer(startChrome({ loadingScreen, styleManager, dataManager, signal }));
  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    const hidden = document.hidden;
    viewer.useDefaultRenderLoop = !hidden;
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    sceneDirector,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  const voiceCommands = initGevVoiceCommands({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    signal,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    sceneDirector,
    annotations,
  });
  defer(() => {
    voiceCommands.stop({ removeUi: true });
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  // Street View (keyless: KartaView embed + 3D street level + Google link).
  const streetView = initStreetView({ viewer, signal });
  defer(() => {
    streetView.destroy();
    if (window.__gevStreetView) delete window.__gevStreetView;
  });
  debug.streetView = streetView;
  // Driver for Dollars — wholesaling drive mode (GPS route + property pins).
  const drive = initDriveForDollars({ viewer, streetView, signal });
  defer(() => {
    drive.destroy();
    if (window.__gevDriveForDollars) delete window.__gevDriveForDollars;
  });
  debug.drive = drive;
  // Voice prefers the drive GPS fix (hands-free while driving), then map center.
  streetView.setFocusProvider(() => drive.currentFix());
  // SAHJONY VOZ — free bilingual (ES/EN) voice commander. Dedicated action
  // runner driving the same GEV actions; no API keys, no cost.
  const sahjonyVoice = initSahjonyVoice({
    runner: createGevActionRunner({
      ...voice,
      floorServices: operations.surface.groundFloor,
      annotationResolver: operations.annotationResolver,
      searchNavigation: operations.searchAndFlyTo,
      signal,
      placeSearch,
      viewer,
      styleManager,
      dataManager,
      sceneDirector,
      annotations,
    }),
    dataManager,
    signal,
    extensions: {
      __street_view: () => streetView.openAtCurrent(),
      __drive_start: () => drive.start(),
      __drive_stop: () => drive.stop(),
      __drive_mark: () => drive.markProperty(),
    },
  });
  defer(() => {
    sahjonyVoice.destroy();
  });
  debug.sahjonyVoice = sahjonyVoice;
  // If the paid realtime backend is unreachable (no API key configured),
  // retire the legacy voice control — SAHJONY VOZ (free, bilingual) is the
  // voice interface. The control reappears automatically if a backend is
  // ever configured, since this probe runs on every startup.
  try {
    fetch('/api/realtime/token?tier=standard', { cache: 'no-store' }).then(
      (response) => {
        if (!response.ok) document.getElementById('gev-voice-control')?.remove();
      },
      () => document.getElementById('gev-voice-control')?.remove(),
    );
  } catch {
    document.getElementById('gev-voice-control')?.remove();
  }
  return { sceneDirector, annotations, voiceCommands, sahjonyVoice, streetView, drive };
}
