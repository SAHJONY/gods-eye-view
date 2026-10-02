/**
 * Cuba traffic panel — SAHJONY LIVE VIEW.
 *
 * Client-facing list of every Cuba-traffic vessel found in the live feed:
 * green "Rumbo a Cuba" (AIS destination = Cuban port) and gold "Ruta Cuba"
 * (known Cuba-lane fleet). Clicking a row flies the camera to that vessel,
 * so the traffic is always findable even when it sails far from Cuba.
 * Visible in every mode, including ?client=1.
 */

const PANEL_ID = 'sahjony-cuba-traffic';

function panelCss() {
  return `
    #${PANEL_ID} {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 45;
      width: 250px;
      max-height: min(46vh, 380px);
      display: flex;
      flex-direction: column;
      background: rgba(6, 18, 28, 0.92);
      border: 1px solid rgba(57, 213, 255, 0.35);
      border-radius: 10px;
      font-family: inherit;
      color: #eaf6ff;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      overflow: hidden;
    }
    #${PANEL_ID} .cuba-traffic-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #9fd8ff;
      border-bottom: 1px solid rgba(57, 213, 255, 0.18);
    }
    #${PANEL_ID} .cuba-traffic-close {
      background: none;
      border: none;
      color: #9fd8ff;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      padding: 0 0 0 8px;
    }
    #${PANEL_ID} .cuba-traffic-list {
      overflow-y: auto;
      padding: 4px;
    }
    #${PANEL_ID} .cuba-traffic-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      background: none;
      border: none;
      border-radius: 8px;
      padding: 7px 8px;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    #${PANEL_ID} .cuba-traffic-row:hover {
      background: rgba(57, 213, 255, 0.12);
    }
    #${PANEL_ID} .cuba-traffic-dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      box-shadow: 0 0 6px currentColor;
    }
    #${PANEL_ID} .cuba-traffic-name {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${PANEL_ID} .cuba-traffic-sub {
      font-size: 10px;
      color: #a9c4d8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${PANEL_ID} .cuba-traffic-empty {
      padding: 12px 10px;
      font-size: 12px;
      color: #a9c4d8;
      line-height: 1.5;
    }
    @media (max-width: 640px) {
      #${PANEL_ID} {
        top: auto;
        bottom: 110px;
        right: 8px;
        width: 210px;
        max-height: 34vh;
      }
    }
  `;
}

function removePanel() {
  document.getElementById(PANEL_ID)?.remove();
}

/**
 * Show the Cuba traffic panel.
 * @param {Array<{name: string, mmsi: string, lat: number, lon: number,
 *   css: string, badge: string, destination: string}>} vessels
 * @param {(vessel: object) => void} onSelect Called when a row is tapped.
 */
export function showCubaTrafficPanel(vessels, onSelect) {
  if (typeof document === 'undefined') return;
  removePanel();
  const styleId = `${PANEL_ID}-style`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = panelCss();
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = PANEL_ID;
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'Buques del tráfico Cuba');
  const list = (vessels || []).length
    ? `<div class="cuba-traffic-list">${vessels
        .map(
          (v, i) => `
        <button type="button" class="cuba-traffic-row" data-idx="${i}">
          <span class="cuba-traffic-dot" style="background:${v.css};color:${v.css}"></span>
          <span style="flex:1;min-width:0">
            <span class="cuba-traffic-name">${escapeHtml(v.name || 'BUQUE')}</span><br>
            <span class="cuba-traffic-sub">${escapeHtml(v.badge || '')}${v.destination ? ` · ${escapeHtml(v.destination)}` : ''}</span>
          </span>
        </button>`,
        )
        .join('')}</div>`
    : `<div class="cuba-traffic-empty">Ahora mismo ningún buque en el feed declara destino Cuba. Vuelve a revisar en unas horas.</div>`;
  el.innerHTML = `
    <div class="cuba-traffic-head">
      <span>🇨🇺 TRÁFICO CUBA · ${(vessels || []).length}</span>
      <button class="cuba-traffic-close" type="button" aria-label="Cerrar panel">×</button>
    </div>
    ${list}`;
  el
    .querySelector('.cuba-traffic-close')
    .addEventListener('click', removePanel);
  el.querySelectorAll('.cuba-traffic-row').forEach((row) => {
    row.addEventListener('click', () => {
      const vessel = vessels[Number(row.dataset.idx)];
      if (vessel && typeof onSelect === 'function') onSelect(vessel);
    });
  });
  document.body.appendChild(el);
}

export function hideCubaTrafficPanel() {
  if (typeof document === 'undefined') return;
  removePanel();
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
