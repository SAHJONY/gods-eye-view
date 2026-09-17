import { SceneDirector } from '../scenes/director.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { createGevActionRunner } from '../voice/gevActions.js';
import { initSahjonyVoice } from '../voice/sahjonyVoice.js';
import { initStreetView } from '../streetview/streetView.js';
import { initDriveForDollars } from '../drive/driveForDollars.js';
// Wholesale real-estate intelligence: deal engine, persistent lead pipeline,
// CSV importer, 3D lead map, AI workforce, mission-control dashboard.
import * as wholesaleEngine from '../wholesale/dealEngine.js';
import {
  createLead as wsCreateLead,
  getLead as wsGetLead,
  updateLead as wsUpdateLead,
  listLeads as wsListLeads,
  moveLead as wsMoveLead,
  deleteLead as wsDeleteLead,
  addAgentNote as wsAddAgentNote,
  listBuyers as wsListBuyers,
} from '../wholesale/leadStore.js';
import { parseLeadsCsv as parseWholesaleCsv } from '../wholesale/leadImporter.js';
import { initLeadMapLayer } from '../wholesale/leadMapLayer.js';
import { initDealDashboard } from '../wholesale/dealDashboard.js';
import { createWorkforce } from '../agents/workforce.js';
import { initWorkforcePanel } from '../agents/workforcePanel.js';
// Crude oil brokerage: cargo deal economics, persistent cargo/counterparty
// pipeline, CSV importer, 3D tanker map, AI workforce, mission-control
// dashboard.
import * as crudeEngine from '../crude/cargoEngine.js';
import {
  createCargo as coCreateCargo,
  getCargo as coGetCargo,
  updateCargo as coUpdateCargo,
  moveCargo as coMoveCargo,
  deleteCargo as coDeleteCargo,
  listCargoes as coListCargoes,
  addCargoNote as coAddCargoNote,
  createCounterparty as coCreateCounterparty,
  getCounterparty as coGetCounterparty,
  updateCounterparty as coUpdateCounterparty,
  deleteCounterparty as coDeleteCounterparty,
  listCounterparties as coListCounterparties,
  addCounterpartyNote as coAddCounterpartyNote,
  asWorkforceStore as coAsWorkforceStore,
  stats as coStats,
} from '../crude/counterpartyStore.js';
import { parseCargoCsv as parseCrudeCsv } from '../crude/cargoImporter.js';
import { initTankerMapLayer } from '../crude/tankerMapLayer.js';
import { initCrudeDashboard } from '../crude/crudeDashboard.js';
import { createWorkforce as createCrudeWorkforce } from '../agents/crudeWorkforce.js';
import { initCrudeWorkforcePanel } from '../agents/crudeWorkforcePanel.js';
// Import/export trade: RFQ deal economics, persistent supplier/RFQ pipeline,
// CSV importer, 3D shipping-lane map, AI workforce, mission-control
// dashboard.
import * as tradeEngine from '../trade/rfqEngine.js';
import {
  createRfq as trCreateRfq,
  getRfq as trGetRfq,
  updateRfq as trUpdateRfq,
  moveRfq as trMoveRfq,
  deleteRfq as trDeleteRfq,
  listRfqs as trListRfqs,
  addRfqNote as trAddRfqNote,
  createSupplier as trCreateSupplier,
  getSupplier as trGetSupplier,
  updateSupplier as trUpdateSupplier,
  deleteSupplier as trDeleteSupplier,
  listSuppliers as trListSuppliers,
  addSupplierNote as trAddSupplierNote,
  asWorkforceStore as trAsWorkforceStore,
  stats as trStats,
} from '../trade/supplierStore.js';
import { parseTradeCsv as parseTradeCsv } from '../trade/supplierImporter.js';
import { initShippingMapLayer } from '../trade/shippingLayer.js';
import { initTradeDashboard } from '../trade/tradeDashboard.js';
import { createWorkforce as createTradeWorkforce } from '../agents/tradeWorkforce.js';
import { initTradeWorkforcePanel } from '../agents/tradeWorkforcePanel.js';
// MY CUBA CASH: verified-provider store, corridor math, 3D corridor map,
// mission-control dashboard, AI workforce + panel. Six seeded providers only;
// provider fees stay undisclosed until Juan enters them. Nothing invented.
import * as cubacashEngine from '../cubacash/corridorEngine.js';
import {
  createProvider as ccCreateProvider,
  getProvider as ccGetProvider,
  updateProvider as ccUpdateProvider,
  moveProvider as ccMoveProvider,
  deleteProvider as ccDeleteProvider,
  listProviders as ccListProviders,
  addProviderNote as ccAddProviderNote,
  createCorridor as ccCreateCorridor,
  getCorridor as ccGetCorridor,
  updateCorridor as ccUpdateCorridor,
  deleteCorridor as ccDeleteCorridor,
  listCorridors as ccListCorridors,
  addCorridorNote as ccAddCorridorNote,
  asWorkforceStore as ccAsWorkforceStore,
  stats as ccStats,
} from '../cubacash/providerStore.js';
import { parseCubacashCsv as parseCubacashCsv } from '../cubacash/corridorImporter.js';
import { initCorridorMapLayer } from '../cubacash/corridorMapLayer.js';
import { initCubacashDashboard } from '../cubacash/cubacashDashboard.js';
import { createWorkforce as createCubacashWorkforce } from '../agents/cubacashWorkforce.js';
import { initCubacashWorkforcePanel } from '../agents/cubacashWorkforcePanel.js';
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
  // --- Wholesale: shared persistent lead store --------------------------------
  // One store (localStorage) spoken in the three shapes its consumers expect:
  // the dashboard/map-layer shape, and the AI workforce engine shape.
  // Mutations notify listeners (the 3D lead map refreshes, debounced).
  const wholesaleMutations = new Set();
  const notifyWholesaleMutations = () => {
    for (const fn of wholesaleMutations) {
      try {
        fn();
      } catch {
        /* map refresh is best-effort */
      }
    }
  };
  const toWorkforceNotes = (lead) =>
    (lead?.agentNotes || []).map((n) => ({
      t: n.at,
      agent: n.agent,
      es: n.es,
      en: n.en,
    }));
  const wholesaleStore = {
    listLeads: (filter) => wsListLeads(filter),
    getLead: (id) => wsGetLead(id),
    createLead: (data) => {
      const lead = wsCreateLead(data);
      if (lead) notifyWholesaleMutations();
      return lead;
    },
    updateLead: (id, patch) => {
      const lead = wsUpdateLead(id, patch);
      if (lead) notifyWholesaleMutations();
      return lead;
    },
    moveLead: (id, status) => {
      const lead = wsMoveLead(id, status);
      if (lead) notifyWholesaleMutations();
      return lead;
    },
    deleteLead: (id) => {
      const ok = wsDeleteLead(id);
      if (ok) notifyWholesaleMutations();
      return ok;
    },
    notes: (id) => toWorkforceNotes(wsGetLead(id)),
    listBuyers: (filter) => wsListBuyers(filter),
    // AI workforce engine shape.
    getAll: () =>
      wsListLeads().map((l) => ({ ...l, notes: toWorkforceNotes(l) })),
    get: (id) => {
      const l = wsGetLead(id);
      return l ? { ...l, notes: toWorkforceNotes(l) } : null;
    },
    update: (id, patch) => {
      const p = { ...(patch || {}) };
      if (Array.isArray(p.notes)) {
        const cur = wsGetLead(id);
        const seen = new Set(
          (cur?.agentNotes || []).map((n) => `${n.at}|${n.agent}|${n.es}`),
        );
        for (const n of p.notes) {
          const key = `${n.t || n.at}|${n.agent}|${n.es}`;
          if (!seen.has(key)) {
            wsAddAgentNote(id, n.agent || 'agent', n.es || '', n.en || '');
            seen.add(key);
          }
        }
        delete p.notes;
      }
      const lead = wsUpdateLead(id, p);
      if (lead) notifyWholesaleMutations();
      return lead;
    },
    onMutate: (fn) => {
      if (typeof fn === 'function') wholesaleMutations.add(fn);
      return () => wholesaleMutations.delete(fn);
    },
  };
  // Driver-for-Dollars condition ids -> deal-engine scoring keys.
  const DRIVE_CONDITION_TO_LEAD = {
    vacant: 'vacant',
    boarded: 'boarded',
    overgrown: 'overgrown',
    'fire-damaged': 'fire',
    'roof-damage': 'roof',
    'for-sale-by-owner': 'fsbo',
    other: 'other',
  };
  // Driver for Dollars — wholesaling drive mode (GPS route + property pins).
  const drive = initDriveForDollars({
    viewer,
    streetView,
    signal,
    // Wholesale bridge: every property marked while driving enters the lead
    // pipeline automatically; the AI workforce picks it up from there.
    onPropertySaved: (property) => {
      if (!property) return;
      wholesaleStore.createLead({
        address: property.address || '',
        lat: property.lat,
        lng: property.lng,
        condition: DRIVE_CONDITION_TO_LEAD[property.condition] || 'other',
        notes: property.notes || '',
        source: 'driver',
        status: 'new',
      });
    },
  });
  defer(() => {
    drive.destroy();
    if (window.__gevDriveForDollars) delete window.__gevDriveForDollars;
  });
  debug.drive = drive;
  // Voice prefers the drive GPS fix (hands-free while driving), then map center.
  streetView.setFocusProvider(() => drive.currentFix());
  // --- Wholesale real-estate intelligence -------------------------------------
  // 3D lead map: pins color-coded by deal score (green/yellow/red).
  const leadMap = initLeadMapLayer({
    viewer,
    leadStore: wholesaleStore,
    dealEngine: wholesaleEngine,
    signal,
  });
  defer(() => {
    try {
      leadMap.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevLeadMap) delete window.__gevLeadMap;
  });
  let leadMapRefreshTimer = null;
  wholesaleStore.onMutate(() => {
    if (leadMapRefreshTimer) return; // coalesce import bursts
    leadMapRefreshTimer = setTimeout(() => {
      leadMapRefreshTimer = null;
      try {
        leadMap.refresh();
      } catch {
        /* best-effort */
      }
    }, 300);
  });
  debug.leadMap = leadMap;
  // AI agentic workforce: scout, researcher, analyst, dispositions.
  // Runs while the app is open; every output is a draft/note for review —
  // it never sends, posts, or contacts anyone.
  const workforce = createWorkforce({
    leadStore: wholesaleStore,
    dealEngine: wholesaleEngine,
    signal,
  });
  try {
    workforce.setBuyers(
      wholesaleStore.listBuyers().map((b) => ({
        name: b.name,
        maxOffer: Number(b?.buyBox?.maxPrice ?? 0) || 0,
        contact: b.contact || '',
      })),
    );
  } catch {
    /* no buyers configured yet */
  }
  window.__gevWorkforce = workforce;
  defer(() => {
    try {
      workforce.pause();
    } catch {
      /* noop */
    }
    if (window.__gevWorkforce === workforce) delete window.__gevWorkforce;
  });
  debug.workforce = workforce;
  // Mission-control dashboard: KPIs, pipeline, lead detail, CSV, buyers.
  const dashboard = initDealDashboard({
    leadStore: wholesaleStore,
    dealEngine: wholesaleEngine,
    leadMap,
    workforce,
    signal,
    parseCsv: (text) => {
      try {
        return parseWholesaleCsv(text).leads;
      } catch {
        return [];
      }
    },
  });
  defer(() => {
    try {
      dashboard.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevWholesale) delete window.__gevWholesale;
  });
  debug.wholesale = dashboard;
  // Workforce mission-control panel: agent roster + live activity feed.
  const workforcePanel = initWorkforcePanel({ workforce, signal });
  defer(() => {
    try {
      workforcePanel.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevWorkforceUI) delete window.__gevWorkforceUI;
  });
  debug.workforcePanel = workforcePanel;
  // --- Crude oil brokerage --------------------------------------------------
  // One store (localStorage `sahjony.crude.v1`) spoken in the three shapes its
  // consumers expect: the dashboard/map-layer shape, and the AI workforce
  // engine shape. Mutations notify listeners (the 3D tanker map refreshes,
  // debounced).
  const crudeMutations = new Set();
  const notifyCrudeMutations = () => {
    for (const fn of crudeMutations) {
      try {
        fn();
      } catch {
        /* map refresh is best-effort */
      }
    }
  };
  const crudeWorkforceRaw = coAsWorkforceStore();
  const crudeStore = {
    // Dashboard/map-layer shape (accepted as-is by the dashboard's adaptStore).
    listCargoes: (filter) => coListCargoes(filter),
    getCargo: (id) => coGetCargo(id),
    createCargo: (data) => {
      const cargo = coCreateCargo(data);
      if (cargo) notifyCrudeMutations();
      return cargo;
    },
    updateCargo: (id, patch) => {
      const cargo = coUpdateCargo(id, patch);
      if (cargo) notifyCrudeMutations();
      return cargo;
    },
    moveCargo: (id, status) => {
      const cargo = coMoveCargo(id, status);
      if (cargo) notifyCrudeMutations();
      return cargo;
    },
    deleteCargo: (id) => {
      const ok = coDeleteCargo(id);
      if (ok) notifyCrudeMutations();
      return ok;
    },
    addCargoNote: (id, agent, es, en) => coAddCargoNote(id, agent, es, en),
    listCounterparties: (filter) => coListCounterparties(filter),
    getCounterparty: (id) => coGetCounterparty(id),
    createCounterparty: (data) => {
      const cp = coCreateCounterparty(data);
      if (cp) notifyCrudeMutations();
      return cp;
    },
    updateCounterparty: (id, patch) => {
      const cp = coUpdateCounterparty(id, patch);
      if (cp) notifyCrudeMutations();
      return cp;
    },
    deleteCounterparty: (id) => {
      const ok = coDeleteCounterparty(id);
      if (ok) notifyCrudeMutations();
      return ok;
    },
    addCounterpartyNote: (id, agent, es, en) =>
      coAddCounterpartyNote(id, agent, es, en),
    stats: () => coStats(),
    notes: (id) => crudeWorkforceRaw.notes(id),
    onMutate: (fn) => {
      if (typeof fn === 'function') crudeMutations.add(fn);
      return () => crudeMutations.delete(fn);
    },
    // AI workforce engine shape. The engine writes notes under the `notes`
    // key; the store persists them as `agentNotes` — normalized here so the
    // dashboard/panel read the same notes the agents write.
    getAll: () =>
      crudeWorkforceRaw.getAll().map((c) => ({
        ...c,
        notes: crudeWorkforceRaw.notes(c.id),
      })),
    get: (id) => {
      const c = crudeWorkforceRaw.get(id);
      return c ? { ...c, notes: crudeWorkforceRaw.notes(id) } : null;
    },
    update: (id, patch) => {
      const p = { ...(patch || {}) };
      if (Array.isArray(p.notes)) {
        p.agentNotes = p.notes.map((n) => ({
          at: n.t ?? n.at ?? Date.now(),
          agent: n.agent || '',
          es: n.es || '',
          en: n.en || '',
        }));
        delete p.notes;
      }
      const cargo = crudeWorkforceRaw.update(id, p);
      if (cargo) notifyCrudeMutations();
      return cargo;
    },
  };
  // 3D tanker map: load/discharge pins + great-circle route arcs, colored by
  // cargo status. Renders only coordinates Juan's data supplies — never (0,0).
  const tankerMap = initTankerMapLayer({
    viewer,
    cargoStore: { listCargoes: crudeStore.listCargoes },
    cargoEngine: crudeEngine,
    signal,
  });
  defer(() => {
    try {
      tankerMap.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevTankerMap) delete window.__gevTankerMap;
  });
  let tankerMapRefreshTimer = null;
  crudeStore.onMutate(() => {
    if (tankerMapRefreshTimer) return; // coalesce import bursts
    tankerMapRefreshTimer = setTimeout(() => {
      tankerMapRefreshTimer = null;
      try {
        tankerMap.refresh();
      } catch {
        /* best-effort */
      }
    }, 300);
  });
  debug.tankerMap = tankerMap;
  // AI agentic workforce (crude): scout, researcher, analyst, dispositions.
  // Runs while the app is open; every output is a draft/note for review —
  // it never sends, posts, or contacts anyone.
  const crudeWorkforce = createCrudeWorkforce({
    cargoStore: crudeStore,
    cargoEngine: crudeEngine,
    signal,
  });
  try {
    crudeWorkforce.setBuyers(
      crudeStore.listCounterparties().filter((c) => c.role !== 'supplier'),
    );
  } catch {
    /* no counterparties configured yet */
  }
  window.__gevCrudeWorkforce = crudeWorkforce;
  defer(() => {
    try {
      crudeWorkforce.pause();
    } catch {
      /* noop */
    }
    if (window.__gevCrudeWorkforce === crudeWorkforce)
      delete window.__gevCrudeWorkforce;
  });
  debug.crudeWorkforce = crudeWorkforce;
  // Mission-control dashboard (crude): KPIs, 9-status pipeline, cargo drawer,
  // counterparty manager, CSV import/export, commission drafts.
  const crudeDashboard = initCrudeDashboard({
    cargoStore: crudeStore,
    cargoEngine: crudeEngine,
    tankerMap,
    workforce: crudeWorkforce,
    signal,
    parseCsv: parseCrudeCsv,
  });
  defer(() => {
    try {
      crudeDashboard.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevCrude) delete window.__gevCrude;
  });
  debug.crude = crudeDashboard;
  // Crude workforce mission-control panel: agent roster + live activity feed.
  const crudeWorkforcePanel = initCrudeWorkforcePanel({
    workforce: crudeWorkforce,
    signal,
  });
  defer(() => {
    try {
      crudeWorkforcePanel.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevCrudeWorkforceUI) delete window.__gevCrudeWorkforceUI;
  });
  debug.crudeWorkforcePanel = crudeWorkforcePanel;
  // --- Import/export trade --------------------------------------------------
  // One store (localStorage `sahjony.trade.v1`) spoken in the three shapes its
  // consumers expect: the dashboard/map-layer shape, and the AI workforce
  // engine shape. Mutations notify listeners (the 3D shipping-lane map
  // refreshes, debounced).
  const tradeMutations = new Set();
  const notifyTradeMutations = () => {
    for (const fn of tradeMutations) {
      try {
        fn();
      } catch {
        /* map refresh is best-effort */
      }
    }
  };
  const tradeWorkforceRaw = trAsWorkforceStore();
  const tradeStore = {
    // Dashboard/map-layer shape (accepted as-is by the dashboard's adaptStore).
    listRfqs: (filter) => trListRfqs(filter),
    getRfq: (id) => trGetRfq(id),
    createRfq: (data) => {
      const rfq = trCreateRfq(data);
      if (rfq) notifyTradeMutations();
      return rfq;
    },
    updateRfq: (id, patch) => {
      const rfq = trUpdateRfq(id, patch);
      if (rfq) notifyTradeMutations();
      return rfq;
    },
    moveRfq: (id, status) => {
      const rfq = trMoveRfq(id, status);
      if (rfq) notifyTradeMutations();
      return rfq;
    },
    deleteRfq: (id) => {
      const ok = trDeleteRfq(id);
      if (ok) notifyTradeMutations();
      return ok;
    },
    addRfqNote: (id, agent, es, en) => trAddRfqNote(id, agent, es, en),
    listSuppliers: (filter) => trListSuppliers(filter),
    getSupplier: (id) => trGetSupplier(id),
    createSupplier: (data) => {
      const supplier = trCreateSupplier(data);
      if (supplier) notifyTradeMutations();
      return supplier;
    },
    updateSupplier: (id, patch) => {
      const supplier = trUpdateSupplier(id, patch);
      if (supplier) notifyTradeMutations();
      return supplier;
    },
    deleteSupplier: (id) => {
      const ok = trDeleteSupplier(id);
      if (ok) notifyTradeMutations();
      return ok;
    },
    addSupplierNote: (id, agent, es, en) =>
      trAddSupplierNote(id, agent, es, en),
    stats: () => trStats(),
    notes: (id) => tradeWorkforceRaw.notes(id),
    onMutate: (fn) => {
      if (typeof fn === 'function') tradeMutations.add(fn);
      return () => tradeMutations.delete(fn);
    },
    // AI workforce engine shape. The engine writes notes under the `notes`
    // key; the store persists them as `agentNotes` — normalized here so the
    // dashboard/panel read the same notes the agents write.
    getAll: () =>
      tradeWorkforceRaw.getAll().map((r) => ({
        ...r,
        notes: tradeWorkforceRaw.notes(r.id),
      })),
    get: (id) => {
      const r = tradeWorkforceRaw.get(id);
      return r ? { ...r, notes: tradeWorkforceRaw.notes(id) } : null;
    },
    update: (id, patch) => {
      const p = { ...(patch || {}) };
      if (Array.isArray(p.notes)) {
        p.agentNotes = p.notes.map((n) => ({
          at: n.t ?? n.at ?? Date.now(),
          agent: n.agent || '',
          es: n.es || '',
          en: n.en || '',
        }));
        delete p.notes;
      }
      const rfq = tradeWorkforceRaw.update(id, p);
      if (rfq) notifyTradeMutations();
      return rfq;
    },
  };
  // 3D shipping-lane map: origin/destination pins + great-circle lane arcs,
  // colored by RFQ status. Renders only coordinates Juan's data supplies —
  // never (0,0).
  const shippingMap = initShippingMapLayer({
    viewer,
    rfqStore: { listRfqs: tradeStore.listRfqs },
    rfqEngine: tradeEngine,
    signal,
  });
  defer(() => {
    try {
      shippingMap.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevShippingMap) delete window.__gevShippingMap;
  });
  let shippingMapRefreshTimer = null;
  tradeStore.onMutate(() => {
    if (shippingMapRefreshTimer) return; // coalesce import bursts
    shippingMapRefreshTimer = setTimeout(() => {
      shippingMapRefreshTimer = null;
      try {
        shippingMap.refresh();
      } catch {
        /* best-effort */
      }
    }, 300);
  });
  debug.shippingMap = shippingMap;
  // AI agentic workforce (trade): supplier scout, RFQ researcher, logistics
  // analyst, deal coordinator. Runs while the app is open; every output is a
  // draft/note for review — it never sends, posts, or contacts anyone.
  const tradeWorkforce = createTradeWorkforce({
    rfqStore: tradeStore,
    rfqEngine: tradeEngine,
    signal,
  });
  try {
    tradeWorkforce.setSuppliers(tradeStore.listSuppliers());
  } catch {
    /* no suppliers configured yet */
  }
  window.__gevTradeWorkforce = tradeWorkforce;
  defer(() => {
    try {
      tradeWorkforce.pause();
    } catch {
      /* noop */
    }
    if (window.__gevTradeWorkforce === tradeWorkforce)
      delete window.__gevTradeWorkforce;
  });
  debug.tradeWorkforce = tradeWorkforce;
  // Mission-control dashboard (trade): KPIs, 6-status RFQ pipeline, RFQ
  // drawer, supplier manager, CSV import/export, commission drafts.
  const tradeDashboard = initTradeDashboard({
    rfqStore: tradeStore,
    rfqEngine: tradeEngine,
    shippingMap,
    workforce: tradeWorkforce,
    signal,
    parseCsv: parseTradeCsv,
  });
  defer(() => {
    try {
      tradeDashboard.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevTrade) delete window.__gevTrade;
  });
  debug.trade = tradeDashboard;
  // Trade workforce mission-control panel: agent roster + live activity feed.
  const tradeWorkforcePanel = initTradeWorkforcePanel({
    workforce: tradeWorkforce,
    signal,
  });
  defer(() => {
    try {
      tradeWorkforcePanel.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevTradeWorkforceUI) delete window.__gevTradeWorkforceUI;
  });
  debug.tradeWorkforcePanel = tradeWorkforcePanel;
  // --- MY CUBA CASH ---------------------------------------------------------
  // One store (localStorage `sahjony.cubacash.v1`) spoken in the three shapes
  // its consumers expect: the dashboard/map-layer shape, and the AI workforce
  // engine shape. Mutations notify listeners (the 3D corridor map refreshes,
  // debounced). The store seeds exactly the six verified providers once —
  // Western Union, Cubamax, Sendvalu, Fonmoney, Correos España, Íkualo Rem —
  // with fee models left `undisclosed`; nothing is ever invented.
  const cubacashMutations = new Set();
  const notifyCubacashMutations = () => {
    for (const fn of cubacashMutations) {
      try {
        fn();
      } catch {
        /* map refresh is best-effort */
      }
    }
  };
  const cubacashWorkforceRaw = ccAsWorkforceStore();
  const cubacashStore = {
    // Dashboard/map-layer shape (accepted as-is by the dashboard's adaptStore).
    listProviders: (filter) => ccListProviders(filter),
    getProvider: (id) => ccGetProvider(id),
    createProvider: (data) => {
      const provider = ccCreateProvider(data);
      if (provider) notifyCubacashMutations();
      return provider;
    },
    updateProvider: (id, patch) => {
      const provider = ccUpdateProvider(id, patch);
      if (provider) notifyCubacashMutations();
      return provider;
    },
    moveProvider: (id, status) => {
      const provider = ccMoveProvider(id, status);
      if (provider) notifyCubacashMutations();
      return provider;
    },
    deleteProvider: (id) => {
      const ok = ccDeleteProvider(id);
      if (ok) notifyCubacashMutations();
      return ok;
    },
    addProviderNote: (id, agent, es, en) =>
      ccAddProviderNote(id, agent, es, en),
    listCorridors: (filter) => ccListCorridors(filter),
    getCorridor: (id) => ccGetCorridor(id),
    createCorridor: (data) => {
      const corridor = ccCreateCorridor(data);
      if (corridor) notifyCubacashMutations();
      return corridor;
    },
    updateCorridor: (id, patch) => {
      const corridor = ccUpdateCorridor(id, patch);
      if (corridor) notifyCubacashMutations();
      return corridor;
    },
    deleteCorridor: (id) => {
      const ok = ccDeleteCorridor(id);
      if (ok) notifyCubacashMutations();
      return ok;
    },
    addCorridorNote: (id, agent, es, en) =>
      ccAddCorridorNote(id, agent, es, en),
    stats: () => ccStats(),
    notes: (id) => cubacashWorkforceRaw.notes(id),
    onMutate: (fn) => {
      if (typeof fn === 'function') cubacashMutations.add(fn);
      return () => cubacashMutations.delete(fn);
    },
    // AI workforce engine shape. The engine writes notes under the `notes`
    // key; the store persists them as `agentNotes` — normalized here so the
    // dashboard/panel read the same notes the agents write.
    getAll: () => cubacashWorkforceRaw.getAll(),
    get: (id) => cubacashWorkforceRaw.get(id),
    update: (id, patch) => {
      const provider = cubacashWorkforceRaw.update(id, patch);
      if (provider) notifyCubacashMutations();
      return provider;
    },
  };
  // 3D corridor map: provider coverage pins + origin/destination pins and
  // great-circle routes for corridors with real endpoints. Renders only
  // coordinates Juan's data supplies — never invented.
  const corridorMap = initCorridorMapLayer({
    viewer,
    providerStore: {
      listProviders: cubacashStore.listProviders,
      listCorridors: cubacashStore.listCorridors,
    },
    corridorEngine: cubacashEngine,
    signal,
  });
  defer(() => {
    try {
      corridorMap.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevCorridorMap) delete window.__gevCorridorMap;
  });
  let corridorMapRefreshTimer = null;
  cubacashStore.onMutate(() => {
    if (corridorMapRefreshTimer) return; // coalesce import bursts
    corridorMapRefreshTimer = setTimeout(() => {
      corridorMapRefreshTimer = null;
      try {
        corridorMap.refresh();
      } catch {
        /* best-effort */
      }
    }, 300);
  });
  debug.corridorMap = corridorMap;
  // AI agentic workforce (MY CUBA CASH): provider verifier, fee watcher,
  // corridor analyst, intake helper. Runs while the app is open; every output
  // is a draft/note for review — it never sends, posts, or contacts anyone.
  const cubacashWorkforce = createCubacashWorkforce({
    providerStore: cubacashStore,
    corridorEngine: cubacashEngine,
    signal,
  });
  window.__gevCubacashWorkforce = cubacashWorkforce;
  defer(() => {
    try {
      cubacashWorkforce.pause();
    } catch {
      /* noop */
    }
    if (window.__gevCubacashWorkforce === cubacashWorkforce)
      delete window.__gevCubacashWorkforce;
  });
  debug.cubacashWorkforce = cubacashWorkforce;
  // Mission-control dashboard (MY CUBA CASH): KPIs with honest beta stats,
  // provider pipeline, provider drawer with corridor math, corridor manager,
  // fee comparison, CSV import/export, internal comparison drafts.
  const cubacashDashboard = initCubacashDashboard({
    providerStore: cubacashStore,
    corridorEngine: cubacashEngine,
    corridorMap,
    workforce: cubacashWorkforce,
    signal,
    parseCsv: parseCubacashCsv,
  });
  defer(() => {
    try {
      cubacashDashboard.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevCubacash) delete window.__gevCubacash;
  });
  debug.cubacash = cubacashDashboard;
  // MY CUBA CASH workforce mission-control panel: agent roster + live
  // activity feed.
  const cubacashWorkforcePanel = initCubacashWorkforcePanel({
    workforce: cubacashWorkforce,
    signal,
  });
  defer(() => {
    try {
      cubacashWorkforcePanel.destroy();
    } catch {
      /* noop */
    }
    if (window.__gevCubacashWorkforceUI) delete window.__gevCubacashWorkforceUI;
  });
  debug.cubacashWorkforcePanel = cubacashWorkforcePanel;
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
      __wholesale_open: () => dashboard.toggle?.() ?? dashboard.open?.(),
      __wholesale_status: () => dashboard.toggle?.() ?? dashboard.open?.(),
      __wholesale_best: () => {
        const leads = wholesaleStore
          .listLeads()
          .filter(
            (l) =>
              l.status !== 'dead' &&
              l.status !== 'closed' &&
              (l.score ?? 0) > 0,
          )
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const top = leads[0];
        if (top) {
          try {
            leadMap.flyToLead(top.id);
          } catch {
            /* noop */
          }
          try {
            dashboard.openDrawer?.(top.id);
          } catch {
            /* noop */
          }
        } else {
          dashboard.toggle?.() ?? dashboard.open?.();
        }
      },
      __wholesale_analyze: () => {
        try {
          workforce.processOnce();
        } catch {
          /* noop */
        }
        dashboard.toggle?.() ?? dashboard.open?.();
      },
      __workforce_start: () => {
        try {
          workforce.start();
        } catch {
          /* noop */
        }
        try {
          workforcePanel.open?.();
        } catch {
          /* noop */
        }
      },
      __workforce_pause: () => {
        try {
          workforce.pause();
        } catch {
          /* noop */
        }
      },
      __crude_open: () => crudeDashboard.toggle?.() ?? crudeDashboard.open?.(),
      __crude_status: () =>
        crudeDashboard.toggle?.() ?? crudeDashboard.open?.(),
      __crude_best: () => {
        const cargoes = crudeStore
          .listCargoes()
          .filter(
            (c) =>
              c.status !== 'dead' &&
              c.status !== 'closed' &&
              crudeEngine.netPerBbl(c) > 0,
          )
          .sort((a, b) => crudeEngine.netPerBbl(b) - crudeEngine.netPerBbl(a));
        const top = cargoes[0];
        if (top) {
          try {
            tankerMap.flyToCargo(top.id);
          } catch {
            /* noop */
          }
          try {
            crudeDashboard.openDrawer?.(top.id);
          } catch {
            /* noop */
          }
        } else {
          crudeDashboard.toggle?.() ?? crudeDashboard.open?.();
        }
      },
      __crude_analyze: () => {
        try {
          crudeWorkforce.processOnce();
        } catch {
          /* noop */
        }
        crudeDashboard.toggle?.() ?? crudeDashboard.open?.();
      },
      __crude_workforce_start: () => {
        try {
          crudeWorkforce.start();
        } catch {
          /* noop */
        }
        try {
          crudeWorkforcePanel.open?.();
        } catch {
          /* noop */
        }
      },
      __crude_workforce_pause: () => {
        try {
          crudeWorkforce.pause();
        } catch {
          /* noop */
        }
      },
      __trade_open: () => tradeDashboard.toggle?.() ?? tradeDashboard.open?.(),
      __trade_status: () =>
        tradeDashboard.toggle?.() ?? tradeDashboard.open?.(),
      __trade_best: () => {
        const rfqs = tradeStore
          .listRfqs()
          .filter(
            (r) =>
              r.status !== 'lost' &&
              r.status !== 'won' &&
              tradeEngine.netMarginPct(r) > 0,
          )
          .sort(
            (a, b) => tradeEngine.netMarginPct(b) - tradeEngine.netMarginPct(a),
          );
        const top = rfqs[0];
        if (top) {
          try {
            shippingMap.flyToRfq(top.id);
          } catch {
            /* noop */
          }
          try {
            tradeDashboard.openDrawer?.(top.id);
          } catch {
            /* noop */
          }
        } else {
          tradeDashboard.toggle?.() ?? tradeDashboard.open?.();
        }
      },
      __trade_analyze: () => {
        try {
          tradeWorkforce.processOnce();
        } catch {
          /* noop */
        }
        tradeDashboard.toggle?.() ?? tradeDashboard.open?.();
      },
      __trade_workforce_start: () => {
        try {
          tradeWorkforce.start();
        } catch {
          /* noop */
        }
        try {
          tradeWorkforcePanel.open?.();
        } catch {
          /* noop */
        }
      },
      __trade_workforce_pause: () => {
        try {
          tradeWorkforce.pause();
        } catch {
          /* noop */
        }
      },
      __cubacash_open: () =>
        cubacashDashboard.toggle?.() ?? cubacashDashboard.open?.(),
      __cubacash_providers: () =>
        cubacashDashboard.toggle?.() ?? cubacashDashboard.open?.(),
      __cubacash_corridors: () =>
        cubacashDashboard.toggle?.() ?? cubacashDashboard.open?.(),
      __cubacash_status: () =>
        cubacashDashboard.toggle?.() ?? cubacashDashboard.open?.(),
      __cubacash_analyze: () => {
        try {
          cubacashWorkforce.processOnce();
        } catch {
          /* noop */
        }
        cubacashDashboard.toggle?.() ?? cubacashDashboard.open?.();
      },
      __cubacash_workforce_start: () => {
        try {
          cubacashWorkforce.start();
        } catch {
          /* noop */
        }
        try {
          cubacashWorkforcePanel.open?.();
        } catch {
          /* noop */
        }
      },
      __cubacash_workforce_pause: () => {
        try {
          cubacashWorkforce.pause();
        } catch {
          /* noop */
        }
      },
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
        if (!response.ok)
          document.getElementById('gev-voice-control')?.remove();
      },
      () => document.getElementById('gev-voice-control')?.remove(),
    );
  } catch {
    document.getElementById('gev-voice-control')?.remove();
  }
  return {
    sceneDirector,
    annotations,
    voiceCommands,
    sahjonyVoice,
    streetView,
    drive,
    leadMap,
    workforce,
    wholesale: dashboard,
    workforcePanel,
    tankerMap,
    crudeWorkforce,
    crude: crudeDashboard,
    crudeWorkforcePanel,
    shippingMap,
    tradeWorkforce,
    trade: tradeDashboard,
    tradeWorkforcePanel,
    corridorMap,
    cubacashWorkforce,
    cubacash: cubacashDashboard,
    cubacashWorkforcePanel,
  };
}
