/**
 * SAHJONY · GOD'S EYE VIEW — Trade desk live-deal seeds
 * -----------------------------------------------------------------------
 * Seeds the worldwide trade desk pipeline (`sahjony.trade.v1`) with the
 * three LIVE deals on record. Every fact below is grounded in the
 * 2026-09-16/17 operations log — no invented suppliers, buyers, prices,
 * or shipments. Fields that are unknown stay EMPTY (0 / ''), never
 * guessed.
 *
 * SAHJONY acts as a fee/spread BROKER on all three — never the buyer,
 * zero capital at risk. All copy uses broker/intermediary positioning.
 *
 * Desk boundary: these three seeds carry an explicit `desk: 'trade'`
 * (Juan's instruction — the worldwide desk keeps them; the Cuba desk's
 * `sahjony.cuba.v1` pipeline stays separate).
 *
 * seedLiveDeals() is idempotent: records are deduped by RFQ ref and by
 * supplier name+country, so re-running never duplicates.
 */

export const LIVE_DEAL_REFS = Object.freeze([
  'DEAL-2026-RD01',
  'DEAL-2026-TNJ01',
  'DEAL-2026-V942-01',
]);

const BROKER_ES =
  'SAHJONY actúa como bróker/intermediario por comisión — nunca es el comprador final y no arriesga capital.';
const BROKER_EN =
  'SAHJONY acts as broker/intermediary for a fee — never the end buyer, zero capital at risk.';

function note(es, en) {
  return { agent: 'trade-deals-seed', es, en };
}

/**
 * The three live deals. `sourceDate` is day-precision only (the real event
 * date); `source` names where the fact was verified.
 */
export function liveDealSeeds() {
  return [
    {
      ref: 'DEAL-2026-RD01',
      product: 'Arroz pilado + diésel nacionalizado',
      status: 'contacted',
      quantity: 0,
      unitCost: 0,
      sellUnitPrice: 0,
      freight: 0,
      duties: 0,
      otherCosts: 0,
      commissionPct: 0,
      incoterms: '',
      originPort: '',
      destinationPort: '',
      supplierId: '',
      buyerId: '',
      liveDeal: true,
      desk: 'trade',
      sourceDate: '2026-09-17',
      source:
        'Juan sent the Spanish WhatsApp inquiry himself 2026-09-17 (SAHJONY drafted it; he pasted and sent it).',
      notes: '',
      agentNotes: [
        note(
          `Consulta enviada por Juan por WhatsApp el 2026-09-17 (mensaje redactado por SAHJONY, enviado por él). ` +
            `Pide precio de arroz pilado (1 y 2 contenedores) y precio de diésel nacionalizado (por IBC y por contenedor), ` +
            `más disponibilidad y tiempo de entrega. Mercancía ya en Cuba lista para nacionalizar. ` +
            `ESTADO: esperando respuesta de precios del vendedor. Vendedor sin nombre en el registro — no se inventa. ` +
            BROKER_ES,
          `Inquiry sent by Juan via WhatsApp on 2026-09-17 (message drafted by SAHJONY, sent by him). ` +
            `Asks pricing for milled rice (1 and 2 containers) and nationalized diesel (per IBC and per container), ` +
            `plus availability and delivery time. Goods already in Cuba ready to nationalize. ` +
            `STATUS: awaiting the seller's price reply. Seller unnamed on record — nothing invented. ` +
            BROKER_EN,
        ),
      ],
    },
    {
      ref: 'DEAL-2026-TNJ01',
      product: 'Soda ash',
      status: 'quoting',
      quantity: 210,
      unitCost: 265,
      sellUnitPrice: 0,
      freight: 0,
      duties: 0,
      otherCosts: 0,
      commissionPct: 0,
      incoterms: 'FOB',
      originPort: 'Qingdao',
      destinationPort: '',
      supplierId: '',
      buyerId: '',
      liveDeal: true,
      desk: 'trade',
      sourceDate: '2026-09-16',
      source:
        'TNJ Chemical counteroffer confirmed in writing 2026-09-16 (Katharine Xu, sales19@tnjchem.com).',
      notes: '',
      agentNotes: [
        note(
          `Contraoferta de TNJ Chemical confirmada por escrito el 2026-09-16 (Katharine Xu, sales19@tnjchem.com): ` +
            `210 TM (10×20ft) a USD 265/TM FOB Qingdao por vía marítima, pago con carta de crédito. ` +
            `TNJ no puede suministrar los 500 TM/mes completos (capacidad al máximo). ` +
            `El 2026-09-17 Juan envió respuesta: pide cronograma para capacidad de 500 TM/mes, especificaciones/empaque, ` +
            `tiempo de producción, fecha más temprana de embarque, vigencia de la cotización y términos LC del embarque de prueba. ` +
            `La respuesta de Katharine del 17-sep llegó vacía — solicitud de reenvío redactada y en cola, NO enviada. ` +
            `ESTADO: esperando su respuesta. Precio de venta al comprador y comisión aún sin definir. ` +
            BROKER_ES,
          `TNJ Chemical counteroffer confirmed in writing on 2026-09-16 (Katharine Xu, sales19@tnjchem.com): ` +
            `210 MT (10×20ft) at USD 265/MT FOB Qingdao by sea, LC payment. ` +
            `TNJ cannot supply the full 500 MT/month (capacity maxed). ` +
            `On 2026-09-17 Juan replied asking: timeline for 500 MT/month capacity, product specs/packaging, ` +
            `production lead time, earliest shipment date, quote validity, and LC terms for the trial shipment. ` +
            `Katharine's Sep-17 reply arrived empty — resend request drafted and queued, NOT sent. ` +
            `STATUS: awaiting her reply. Buyer sell price and commission still undefined. ` +
            BROKER_EN,
        ),
      ],
    },
    {
      ref: 'DEAL-2026-V942-01',
      product: 'Siemens V94.2 gas turbine power plant (TY-1940, 445 MW, 2006, 50 Hz)',
      status: 'contacted',
      quantity: 1,
      unitCost: 37500000,
      sellUnitPrice: 0,
      freight: 0,
      duties: 0,
      otherCosts: 0,
      commissionPct: 0,
      incoterms: 'EXW',
      originPort: '',
      destinationPort: '',
      supplierId: '',
      buyerId: '',
      liveDeal: true,
      desk: 'trade',
      sourceDate: '2026-09-17',
      source:
        'American Plant & Equipment email body read directly 2026-09-17 (PDF extraction failed; terms verified from the email body).',
      notes: '',
      agentNotes: [
        note(
          `Oferta de American Plant & Equipment (TY-1940 Siemens V94.2, 445 MW: 2×139 MW turbinas de gas + 158 MW vapor; ` +
            `año 2006, 50 Hz): USD 37,500,000 EXW, pago total por transferencia con la orden, vigencia de 4 días calendario, ` +
            `primero en llegar / sujeto a venta previa. Términos verificados del cuerpo del correo del vendedor (el PDF no se pudo extraer). ` +
            `Inspección requiere datos de la empresa + carta de intención. ` +
            `ESTADO: cotización del vendedor en archivo; sin comprador todavía — pendiente decisión de Juan sobre la LOI. ` +
            `Respaldo: listados USP&E (USP009718 220 MW usado, USP010205 420/436 MW) y listado Machinio EE. UU.; ReFlowX eliminó sus unidades V94.2. ` +
            `Precio de venta y comisión sin definir. ` +
            BROKER_ES,
          `American Plant & Equipment offer (TY-1940 Siemens V94.2, 445 MW: 2×139 MW gas turbines + 158 MW steam; ` +
            `2006, 50 Hz): USD 37,500,000 EXW, full payment by wire with order, 4-calendar-day validity, ` +
            `first-come / subject to prior sale. Terms verified from the seller's email body (PDF extraction failed). ` +
            `Inspection requires company details + letter of intent. ` +
            `STATUS: seller quote on file; no buyer yet — awaiting Juan's LOI decision. ` +
            `Backups: USP&E listings (USP009718 220 MW used, USP010205 420/436 MW) and a US Machinio listing; ReFlowX delisted its V94.2 units. ` +
            `Sell price and commission undefined. ` +
            BROKER_EN,
        ),
      ],
    },
  ];
}

/** Real counterparties on record for the live deals. No invented contacts. */
export function liveCounterpartySeeds() {
  return [
    {
      name: 'TNJ Chemical',
      type: 'trader',
      role: 'supplier',
      country: 'China',
      contact: { name: 'Katharine Xu', phone: '', email: 'sales19@tnjchem.com' },
      verification: 'in-review',
      notes: '',
      agentNotes: [
        note(
          'Contraparte real del trato de soda ash (DEAL-2026-TNJ01). Contacto verificado en el hilo del RFQ 2026-09-16/17. Sin teléfono en el registro.',
          'Real counterparty for the soda ash deal (DEAL-2026-TNJ01). Contact verified in the RFQ thread 2026-09-16/17. No phone on record.',
        ),
      ],
    },
    {
      name: 'American Plant & Equipment',
      type: 'trader',
      role: 'supplier',
      country: 'United States',
      contact: { name: '', phone: '', email: '' },
      verification: 'unverified',
      notes: '',
      agentNotes: [
        note(
          'Vendedor de la planta Siemens V94.2 (DEAL-2026-V942-01). Oferta recibida por correo 2026-09-17. Contacto individual no verificado en el registro — no se inventa.',
          'Seller of the Siemens V94.2 plant (DEAL-2026-V942-01). Offer received by email 2026-09-17. Individual contact not verified on record — nothing invented.',
        ),
      ],
    },
  ];
}

/**
 * seedLiveDeals({ listRfqs, createRfq, listSuppliers, createSupplier })
 * Idempotent: skips RFQs whose ref already exists and suppliers whose
 * name+country already exist. Links DEAL-2026-TNJ01 → TNJ Chemical and
 * DEAL-2026-V942-01 → American Plant & Equipment when the records exist.
 * Returns { rfqs, suppliers, createdRfqs, createdSuppliers }.
 * Never throws on a hostile store — returns what it managed.
 */
export function seedLiveDeals(store = {}) {
  const result = { rfqs: [], suppliers: [], createdRfqs: 0, createdSuppliers: 0 };
  const safe = (fn, fallback) => {
    try {
      const v = fn();
      return v === undefined || v === null ? fallback : v;
    } catch {
      return fallback;
    }
  };
  const listRfqs = () => safe(() => store.listRfqs(), []);
  const listSuppliers = () => safe(() => store.listSuppliers(), []);

  // Counterparties first (deals link to them by id).
  for (const seed of liveCounterpartySeeds()) {
    const existing = listSuppliers().find(
      (s) =>
        s &&
        String(s.name || '').trim().toLowerCase() ===
          seed.name.toLowerCase() &&
        String(s.country || '').trim().toLowerCase() ===
          seed.country.toLowerCase(),
    );
    if (existing) {
      result.suppliers.push(existing);
      continue;
    }
    const created = safe(() => store.createSupplier(seed), null);
    if (created) {
      result.suppliers.push(created);
      result.createdSuppliers += 1;
    }
  }
  const supplierIdByName = (name) => {
    const found = result.suppliers.find(
      (s) => s && String(s.name || '').toLowerCase() === name.toLowerCase(),
    );
    return found ? found.id : '';
  };

  for (const seed of liveDealSeeds()) {
    const existing = listRfqs().find(
      (r) => r && String(r.ref || '').trim() === seed.ref,
    );
    if (existing) {
      result.rfqs.push(existing);
      continue;
    }
    const data = { ...seed };
    if (seed.ref === 'DEAL-2026-TNJ01') {
      data.supplierId = supplierIdByName('TNJ Chemical');
    }
    if (seed.ref === 'DEAL-2026-V942-01') {
      data.supplierId = supplierIdByName('American Plant & Equipment');
    }
    // agentNotes carry ISO `at` stamps set by the store; seed notes are
    // passed through and normalized there.
    const created = safe(() => store.createRfq(data), null);
    if (created) {
      result.rfqs.push(created);
      result.createdRfqs += 1;
    }
  }
  return result;
}

/** Next-action line per live deal (bilingual), for the dashboard. */
export function liveDealNextAction(ref, lang = 'es') {
  const map = {
    'DEAL-2026-RD01': {
      es: 'Esperando precios del vendedor — preparar seguimiento si no responde.',
      en: "Awaiting the seller's pricing — prepare a follow-up if no reply.",
    },
    'DEAL-2026-TNJ01': {
      es: 'Esperando respuesta de Katharine Xu — solicitud de reenvío en cola (no enviada).',
      en: "Awaiting Katharine Xu's reply — resend request queued (not sent).",
    },
    'DEAL-2026-V942-01': {
      es: 'Sin comprador — pendiente decisión de Juan sobre la LOI; verificar vigencia de la oferta.',
      en: "No buyer yet — awaiting Juan's LOI decision; re-check offer validity.",
    },
  };
  const entry = map[ref];
  if (!entry) return '';
  return lang === 'en' ? entry.en : entry.es;
}
