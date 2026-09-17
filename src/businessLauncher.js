/**
 * Business launcher for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Juan's requirement: every business module gets its own independent,
 * separate full screen — the cramped floating panels over the 3D globe are
 * unusable on his phone. Each business now has a standalone full-screen app
 * (public/<module>/index.html) sharing the same localStorage key as its
 * in-app dashboard panel, so data is seamless both ways.
 *
 * This launcher is one floating button (🏢) that opens a full-screen,
 * phone-first menu with five big one-tap bilingual buttons — one per
 * business — each opening its standalone screen. No Cesium dependency;
 * the DOM double used in tests works fine.
 *
 * HUB ARCHITECTURE (Juan's standing rule): the main screen IS the hub.
 * The launcher overlay is therefore the DEFAULT entry view — it opens
 * automatically on load (reversible via the `autoOpen` option). A
 * clearly-labeled "🌐 Globe / Globo" card at the top of the overlay
 * dismisses the hub and reveals the 3D globe; the floating 🏢 button
 * re-opens the hub from the globe at any time. Nothing business-specific
 * lives on the hub except the launcher cards.
 */

export const BUSINESSES = Object.freeze([
  {
    id: 'wholesale',
    icon: '🏠',
    screen: '/wholesale/index.html',
    es: 'Bienes raíces mayoristas',
    en: 'Wholesale Real Estate',
    esDesc: 'Leads de vendedores y compradores en efectivo',
    enDesc: 'Seller leads and cash buyers',
  },
  {
    id: 'crude',
    icon: '🛢️',
    screen: '/crude/index.html',
    es: 'Corretaje de crudo',
    en: 'Crude Oil Brokerage',
    esDesc: 'Cargas, contrapartes y economía del negocio',
    enDesc: 'Cargo deals, counterparties and deal economics',
  },
  {
    id: 'insurance',
    icon: '🛡️',
    screen: '/insurance/index.html',
    es: 'Centro de seguros',
    en: 'Insurance Command Center',
    esDesc: 'Pólizas, reclamos, abogados y cotizaciones',
    enDesc: 'Policies, claims, attorneys and quotes',
  },
  {
    id: 'trade',
    icon: '🌐',
    screen: '/import-export/index.html',
    es: 'Comercio import/export',
    en: 'Import/Export Trade',
    esDesc: 'RFQs, proveedores y márgenes',
    enDesc: 'RFQs, suppliers and margins',
  },
  {
    id: 'cubacash',
    icon: '💸',
    screen: '/cubacash/index.html',
    es: 'MY CUBA CASH',
    en: 'MY CUBA CASH',
    esDesc: 'Corredores de remesas y proveedores',
    enDesc: 'Remittance corridors and providers',
  },
]);

const LANG_KEY = 'sahjony.gev.lang';

/** The globe card: dismisses the hub overlay, revealing the 3D globe.
 *  Kept OUT of BUSINESSES so the business roster stays exactly five. */
export const GLOBE_CARD = Object.freeze({
  id: 'globe',
  icon: '🌐',
  es: 'Globo',
  en: 'Globe',
  esDesc: 'Ver el globo 3D de GEV',
  enDesc: 'View the GEV 3D globe',
});

/**
 * UNIFIED ECOSYSTEM (standing rule, Juan 2026-09-17): all apps and systems
 * work together as one. The hub deep-links out to every app; the businesses
 * stay operationally separate behind the scenes. Single front door: Sofia
 * on WhatsApp +1 281-662-8581. These are user-tapped navigation links only —
 * the launcher makes no external calls by itself.
 */
export const EXTERNAL_APPS = Object.freeze([
  {
    id: 'app-sahjony',
    icon: '🏭',
    url: 'https://www.sahjony.com',
    es: 'SAHJONY.com',
    en: 'SAHJONY.com',
    esDesc: 'Comercio import/export',
    enDesc: 'Import/export trade',
  },
  {
    id: 'app-cubacash',
    icon: '💵',
    url: 'https://www.mycubacash.com',
    es: 'MyCubaCash.com',
    en: 'MyCubaCash.com',
    esDesc: 'Envíos de dinero a Cuba',
    enDesc: 'Money transfers to Cuba',
  },
  {
    id: 'app-new850',
    icon: '📄',
    url: 'https://www.new850.com',
    es: 'New850.com',
    en: 'New850.com',
    esDesc: 'Reparación de crédito',
    enDesc: 'Credit repair',
  },
  {
    id: 'app-carsales',
    icon: '🚗',
    url: 'https://muse.ai/s/car-sales-machine-lxh5xvxa5xdixyzp',
    es: 'Venta de carros',
    en: 'Car sales',
    esDesc: 'Máquina de venta de carros',
    enDesc: 'Car sales machine',
  },
]);

/**
 * Single front door, everywhere: Sofia on WhatsApp +1 281-662-8581.
 * Rendered as the last card of the hub's ecosystem section.
 */
export const SOFIA_WHATSAPP = Object.freeze({
  id: 'sofia-whatsapp',
  icon: '💬',
  url: 'https://wa.me/12816628581',
  es: 'Sofia por WhatsApp',
  en: 'Sofia on WhatsApp',
  esDesc: 'Puerta única: +1 281-662-8581',
  enDesc: 'Single front door: +1 281-662-8581',
});

const LAUNCHER_CSS = `
#gev-bizlauncher-btn{position:fixed;z-index:70;left:14px;bottom:14px;width:64px;height:64px;min-width:64px;min-height:64px;border-radius:50%;background:#0c2a3d;border:2px solid #38bdf8;color:#fff;font-size:30px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
#gev-bizlauncher-btn:active{transform:scale(.94)}
#gev-bizlauncher-overlay{position:fixed;inset:0;z-index:80;background:rgba(8,11,18,.97);display:none;overflow-y:auto;font-family:inherit;color:#eef2f7}
#gev-bizlauncher-overlay.open{display:block}
#gev-bizlauncher-overlay .bl-head{position:sticky;top:0;background:#0b1220;border-bottom:1px solid #334155;padding:14px 16px;display:flex;align-items:center;gap:10px}
#gev-bizlauncher-overlay .bl-title{font-size:20px;font-weight:800;flex:1}
#gev-bizlauncher-overlay .bl-lang{min-height:48px;min-width:64px;border-radius:12px;border:2px solid #334155;background:#1e293b;color:#f1f5f9;font-size:16px;font-weight:800;cursor:pointer}
#gev-bizlauncher-overlay .bl-lang.on{border-color:#38bdf8;background:#0c2a3d}
#gev-bizlauncher-overlay .bl-close{min-width:48px;min-height:48px;border-radius:12px;border:2px solid #334155;background:#1e293b;color:#fff;font-size:20px;cursor:pointer}
#gev-bizlauncher-overlay .bl-list{padding:14px 16px 40px;display:flex;flex-direction:column;gap:12px;max-width:640px;margin:0 auto}
#gev-bizlauncher-overlay .bl-biz{display:flex;gap:14px;align-items:center;width:100%;min-height:84px;border-radius:18px;border:2px solid #334155;background:#1e293b;color:#f1f5f9;cursor:pointer;padding:14px 16px;text-align:left;font-family:inherit}
#gev-bizlauncher-overlay .bl-biz:active{border-color:#38bdf8;background:#0c2a3d}
#gev-bizlauncher-overlay .bl-section{font-size:15px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7dd3fc;padding:14px 4px 2px}
#gev-bizlauncher-overlay a.bl-biz{text-decoration:none}
#gev-bizlauncher-overlay .bl-globe{border-color:#38bdf8;background:#0c2a3d}
#gev-bizlauncher-overlay .bl-globe .bl-go{color:#7dd3fc}
#gev-bizlauncher-overlay .bl-icon{font-size:38px;flex:0 0 auto}
#gev-bizlauncher-overlay .bl-name{font-size:19px;font-weight:800;line-height:1.25}
#gev-bizlauncher-overlay .bl-desc{font-size:14px;color:#94a3b8;margin-top:4px;line-height:1.35}
#gev-bizlauncher-overlay .bl-go{margin-left:auto;font-size:24px;color:#38bdf8;flex:0 0 auto}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-bizlauncher-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-bizlauncher-styles';
  style.textContent = LAUNCHER_CSS;
  document.head.appendChild(style);
}

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

function writeLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Open a business screen in a new tab; fall back to same-tab navigation. */
export function openBusinessScreen(screen) {
  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(screen, '_blank', 'noopener');
      return screen;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = screen;
      return screen;
    }
  } catch {
    /* noop */
  }
  return screen;
}

/**
 * initBusinessLauncher({ signal, autoOpen }) → handle { open, close, toggle, destroy, setLang, getLang }
 * Floating 🏢 button + full-screen bilingual business menu. No Cesium.
 *
 * Hub architecture: `autoOpen` (default true) opens the overlay as the
 * default entry view right after build. Pass `autoOpen: false` to keep the
 * old behavior (launcher closed until the 🏢 button is tapped). The
 * "🌐 Globe / Globo" card dismisses the overlay to reveal the globe.
 */
export function initBusinessLauncher({ signal = null, autoOpen = true } = {}) {
  injectStyles();
  let lang = readLang();
  let overlay = null;
  let fab = null;
  let destroyed = false;
  signal?.addEventListener?.('abort', () => destroy(), { once: true });

  const t = (es, en) => (lang === 'es' ? es : en);

  function render() {
    if (!overlay || destroyed) return;
    const head = overlay.querySelector('.bl-head');
    if (head) {
      head.querySelector('.bl-title').textContent = t('Negocios', 'Businesses');
      const [esBtn, enBtn] = head.querySelectorAll('.bl-lang');
      if (esBtn) {
        esBtn.textContent = 'ES';
        esBtn.classList.toggle('on', lang === 'es');
      }
      if (enBtn) {
        enBtn.textContent = 'EN';
        enBtn.classList.toggle('on', lang === 'en');
      }
    }
    const list = overlay.querySelector('.bl-list');
    if (list) {
      list.innerHTML = '';
      // Globe card first: dismisses the hub, revealing the 3D globe.
      list.appendChild(makeCard(GLOBE_CARD, () => closeOverlay()));
      for (const b of BUSINESSES) {
        list.appendChild(
          makeCard(b, () => openBusinessScreen(b.screen)),
        );
      }
      // UNIFIED ECOSYSTEM: deep-links out to every app + the single front
      // door (Sofia on WhatsApp). User-tapped navigation only.
      const section = document.createElement('div');
      section.className = 'bl-section';
      section.textContent = t('Apps y sitios', 'Apps & sites');
      list.appendChild(section);
      for (const a of EXTERNAL_APPS) {
        list.appendChild(makeLinkCard(a));
      }
      list.appendChild(makeLinkCard(SOFIA_WHATSAPP));
    }
    if (fab) fab.setAttribute('aria-label', t('Negocios', 'Businesses'));
  }

  function makeCard(b, onClick) {
    const btn = document.createElement('button');
    btn.className = 'bl-biz' + (b.id === 'globe' ? ' bl-globe' : '');
    btn.type = 'button';
    btn.setAttribute('data-biz', b.id);
    const icon = document.createElement('span');
    icon.className = 'bl-icon';
    icon.textContent = b.icon;
    const txt = document.createElement('span');
    const name = document.createElement('div');
    name.className = 'bl-name';
    name.textContent = lang === 'es' ? b.es : b.en;
    const desc = document.createElement('div');
    desc.className = 'bl-desc';
    desc.textContent = lang === 'es' ? b.esDesc : b.enDesc;
    txt.appendChild(name);
    txt.appendChild(desc);
    const go = document.createElement('span');
    go.className = 'bl-go';
    go.textContent = b.id === 'globe' ? '✕' : '›';
    btn.appendChild(icon);
    btn.appendChild(txt);
    btn.appendChild(go);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function makeLinkCard(a) {
    const link = document.createElement('a');
    link.className = 'bl-biz';
    link.setAttribute('data-app', a.id);
    link.setAttribute('href', a.url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    const icon = document.createElement('span');
    icon.className = 'bl-icon';
    icon.textContent = a.icon;
    const txt = document.createElement('span');
    const name = document.createElement('div');
    name.className = 'bl-name';
    name.textContent = lang === 'es' ? a.es : a.en;
    const desc = document.createElement('div');
    desc.className = 'bl-desc';
    desc.textContent = lang === 'es' ? a.esDesc : a.enDesc;
    txt.appendChild(name);
    txt.appendChild(desc);
    const go = document.createElement('span');
    go.className = 'bl-go';
    go.textContent = '↗';
    link.appendChild(icon);
    link.appendChild(txt);
    link.appendChild(go);
    return link;
  }

  function build() {
    if (typeof document === 'undefined') return;
    fab = document.createElement('button');
    fab.id = 'gev-bizlauncher-btn';
    fab.type = 'button';
    fab.textContent = '🏢';
    fab.addEventListener('click', () => toggle());
    document.body.appendChild(fab);

    overlay = document.createElement('div');
    overlay.id = 'gev-bizlauncher-overlay';
    const head = document.createElement('div');
    head.className = 'bl-head';
    const title = document.createElement('div');
    title.className = 'bl-title';
    const esBtn = document.createElement('button');
    esBtn.className = 'bl-lang';
    esBtn.type = 'button';
    esBtn.addEventListener('click', () => setLang('es'));
    const enBtn = document.createElement('button');
    enBtn.className = 'bl-lang';
    enBtn.type = 'button';
    enBtn.addEventListener('click', () => setLang('en'));
    const close = document.createElement('button');
    close.className = 'bl-close';
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => closeOverlay());
    head.appendChild(title);
    head.appendChild(esBtn);
    head.appendChild(enBtn);
    head.appendChild(close);
    const list = document.createElement('div');
    list.className = 'bl-list';
    overlay.appendChild(head);
    overlay.appendChild(list);
    document.body.appendChild(overlay);
    render();
  }

  function openOverlay() {
    if (overlay && !destroyed) overlay.classList.add('open');
  }
  function closeOverlay() {
    if (overlay && !destroyed) overlay.classList.remove('open');
  }
  function toggle() {
    if (!overlay || destroyed) return;
    overlay.classList.contains('open') ? closeOverlay() : openOverlay();
  }
  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    writeLang(lang);
    render();
  }
  function destroy() {
    destroyed = true;
    try {
      fab?.remove();
    } catch {
      /* noop */
    }
    try {
      overlay?.remove();
    } catch {
      /* noop */
    }
    fab = null;
    overlay = null;
  }

  build();
  // Hub architecture: the launcher overlay IS the default entry view.
  if (autoOpen) openOverlay();
  return {
    open: openOverlay,
    close: closeOverlay,
    toggle,
    destroy,
    setLang,
    getLang: () => lang,
    openBusinessScreen,
  };
}
