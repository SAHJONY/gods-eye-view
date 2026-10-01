/**
 * Floating Cuba-traffic legend — SAHJONY LIVE VIEW.
 *
 * Small client-facing card explaining the two Cuba vessel colors.
 * Mounted once by the vessels layer runtime; visible in every mode
 * (including ?client=1) and dismissible with the × button.
 */
import { CUBA_LEGEND_ROWS } from '../data/cubaVessels.js';

const LEGEND_ID = 'sahjony-cuba-legend';

function legendCss() {
  return `
    #${LEGEND_ID} {
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 40;
      max-width: 230px;
      background: rgba(6, 18, 28, 0.88);
      border: 1px solid rgba(57, 213, 255, 0.35);
      border-radius: 10px;
      padding: 8px 10px 9px;
      font-family: inherit;
      color: #eaf6ff;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    }
    #${LEGEND_ID} .cuba-legend-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #9fd8ff;
      margin-bottom: 6px;
    }
    #${LEGEND_ID} .cuba-legend-close {
      background: none;
      border: none;
      color: #9fd8ff;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      padding: 0 0 0 8px;
    }
    #${LEGEND_ID} .cuba-legend-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 5px;
    }
    #${LEGEND_ID} .cuba-legend-dot {
      flex: 0 0 auto;
      width: 11px;
      height: 11px;
      margin-top: 2px;
      border-radius: 50%;
      box-shadow: 0 0 6px currentColor;
    }
    #${LEGEND_ID} .cuba-legend-title {
      font-size: 12px;
      font-weight: 600;
      line-height: 1.25;
    }
    #${LEGEND_ID} .cuba-legend-detail {
      font-size: 10.5px;
      color: #a9c4d8;
      line-height: 1.3;
    }
    @media (max-width: 640px) {
      #${LEGEND_ID} {
        left: 8px;
        bottom: 8px;
        max-width: 196px;
        padding: 7px 8px 8px;
      }
    }
  `;
}

/**
 * Mount the floating legend once. Safe to call repeatedly.
 */
export function mountCubaLegend() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(LEGEND_ID)) return;
  const style = document.createElement('style');
  style.id = `${LEGEND_ID}-style`;
  style.textContent = legendCss();
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = LEGEND_ID;
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'Leyenda de tráfico a Cuba');
  const rows = CUBA_LEGEND_ROWS.map(
    (row) => `
      <div class="cuba-legend-row">
        <span class="cuba-legend-dot" style="background:${row.css};color:${row.css}"></span>
        <span>
          <span class="cuba-legend-title">${row.title}</span><br>
          <span class="cuba-legend-detail">${row.detail}</span>
        </span>
      </div>`,
  ).join('');
  el.innerHTML = `
    <div class="cuba-legend-head">
      <span>🇨🇺 TRÁFICO CUBA</span>
      <button class="cuba-legend-close" type="button" aria-label="Cerrar leyenda">×</button>
    </div>
    ${rows}`;
  el
    .querySelector('.cuba-legend-close')
    .addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}
