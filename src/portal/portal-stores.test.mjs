import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientStore,
  publicClient,
  isClientActive,
  SERVICE_INTEREST_OPTIONS,
} from '../../server/portal/clients.js';
import {
  createShipmentStore,
  SHIPMENT_STATUSES,
} from '../../server/portal/shipments.js';

describe('portal client store', () => {
  it('creates a client with a hashed password', () => {
    const store = createClientStore();
    const client = store.create({
      companyName: 'Acme Foods',
      contactName: 'Ana',
      email: 'Ana@Example.com',
      password: 'secreto-123',
    });
    assert.ok(client.id.startsWith('cli_'));
    assert.equal(client.email, 'ana@example.com');
    assert.match(client.passwordHash, /^pbkdf2\$/);
    assert.equal(client.active, true);
  });

  it('rejects duplicate emails', () => {
    const store = createClientStore();
    store.create({ companyName: 'A', email: 'a@b.co', password: 'secreto-12' });
    assert.throws(
      () => store.create({ companyName: 'B', email: 'A@B.CO', password: 'secreto-34' }),
      /already registered/,
    );
  });

  it('publicClient strips the password hash', () => {
    const store = createClientStore();
    const client = store.create({ companyName: 'A', email: 'a@b.co', password: 'secreto-12' });
    const pub = publicClient(client);
    assert.ok(!('passwordHash' in pub));
    assert.equal(pub.companyName, 'A');
    const listed = store.list();
    assert.ok(listed.every((entry) => !('passwordHash' in entry)));
  });

  it('updates and resets passwords', () => {
    const store = createClientStore();
    const client = store.create({ companyName: 'A', email: 'a@b.co', password: 'secreto-12' });
    const before = client.passwordHash;
    store.setPassword(client.id, 'nueva-clave-99');
    assert.notEqual(store.get(client.id).passwordHash, before);
    store.update(client.id, { active: false });
    assert.equal(store.get(client.id).active, false);
  });

  it('registration creates a pending account storing the service interest', () => {
    const store = createClientStore();
    const client = store.register({
      companyName: 'Prospecto SA',
      contactName: 'Pedro',
      email: 'pedro@x.com',
      phone: '+1 305 555 0100',
      serviceInterest: 'Comprar mercancía',
      password: 'secreto-12',
    });
    assert.equal(client.status, 'pending');
    assert.equal(client.active, false);
    assert.equal(client.serviceInterest, 'Comprar mercancía');
    assert.ok(!isClientActive(client), 'pending accounts cannot authenticate');

    const pub = publicClient(client);
    assert.equal(pub.serviceInterest, 'Comprar mercancía');
    assert.equal(pub.status, 'pending');

    store.approve(client.id);
    const approved = store.get(client.id);
    assert.equal(approved.status, 'active');
    assert.ok(isClientActive(approved));

    store.reject(client.id);
    assert.equal(store.get(client.id).status, 'rejected');
    assert.ok(!isClientActive(store.get(client.id)));
  });

  it('registration requires one of the 3 allowed service interests', () => {
    const store = createClientStore();
    const base = {
      companyName: 'P',
      contactName: 'C',
      email: 'svc@x.com',
      phone: '+13055550100',
      password: 'secreto-12',
    };
    assert.throws(() => store.register({ ...base, serviceInterest: '' }), /serviceInterest/);
    assert.throws(() => store.register({ ...base, serviceInterest: 'otra cosa' }), /serviceInterest/);
    assert.throws(() => store.register({ ...base }), /serviceInterest/);
    for (const [i, option] of SERVICE_INTEREST_OPTIONS.entries()) {
      const c = store.register({ ...base, email: `svc${i}@x.com`, serviceInterest: option });
      assert.equal(c.serviceInterest, option);
    }
    assert.deepEqual([...SERVICE_INTEREST_OPTIONS], [
      'Comprar mercancía',
      'Enviar contenedor completo',
      'Enviar carga por pallet',
      'Enviar paquetería',
      'Varios servicios',
    ]);
  });

  it('owner-created accounts accept an optional service interest', () => {
    const store = createClientStore();
    const withSvc = store.create({
      companyName: 'A',
      email: 'a@b.co',
      password: 'secreto-12',
      serviceInterest: 'Enviar contenedor completo',
    });
    assert.equal(withSvc.status, 'active');
    assert.equal(withSvc.serviceInterest, 'Enviar contenedor completo');
    const without = store.create({ companyName: 'B', email: 'b@b.co', password: 'secreto-12' });
    assert.equal(without.serviceInterest, '');
    assert.throws(
      () => store.create({ companyName: 'C', email: 'c@b.co', password: 'secreto-12', serviceInterest: 'x' }),
      /serviceInterest/,
    );
    store.update(withSvc.id, { serviceInterest: 'Varios servicios' });
    assert.equal(store.get(withSvc.id).serviceInterest, 'Varios servicios');
  });
});

describe('portal shipment store', () => {
  const make = () =>
    createShipmentStore().create({
      clientId: 'cli_1',
      vesselMmsi: '244780354',
      vesselName: 'MICHIEL DE RUYTER',
      origin: 'Rotterdam',
      destination: 'Mariel',
      cargoLabel: 'Contenedor 40ft — alimentos',
      status: 'en_transito',
      eta: '2026-10-12',
    });

  it('creates a shipment with client-safe fields only', () => {
    const shipment = make();
    assert.ok(shipment.id.startsWith('shp_'));
    const keys = Object.keys(shipment).sort();
    for (const forbidden of ['supplier', 'cost', 'margin', 'spread', 'price']) {
      assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `no ${forbidden} field`);
    }
  });

  it('validates MMSI and status', () => {
    const store = createShipmentStore();
    assert.throws(
      () =>
        store.create({
          clientId: 'cli_1',
          vesselMmsi: 'abc',
          origin: 'A',
          destination: 'B',
          cargoLabel: 'C',
        }),
      /vesselMmsi/,
    );
    assert.throws(
      () =>
        store.create({
          clientId: 'cli_1',
          vesselMmsi: '12345',
          origin: 'A',
          destination: 'B',
          cargoLabel: 'C',
          status: 'volando',
        }),
      /status/,
    );
    assert.deepEqual([...SHIPMENT_STATUSES], ['pendiente', 'en_transito', 'en_puerto', 'entregado']);
  });

  it('scopes reads by client', () => {
    const store = createShipmentStore();
    const a = store.create({
      clientId: 'cli_A',
      vesselMmsi: '11111',
      origin: 'A',
      destination: 'B',
      cargoLabel: 'C',
    });
    store.create({ clientId: 'cli_B', vesselMmsi: '22222', origin: 'A', destination: 'B', cargoLabel: 'C' });
    assert.equal(store.getForClient(a.id, 'cli_A')?.id, a.id);
    assert.equal(store.getForClient(a.id, 'cli_B'), null);
    assert.equal(store.getForClient('no-existe', 'cli_A'), null);
    assert.equal(store.listForClient('cli_A').length, 1);
    assert.equal(store.listForClient('cli_B').length, 1);
  });

  it('updates whitelisted fields and deletes', () => {
    const store = createShipmentStore();
    const shipment = store.create({
      clientId: 'cli_1',
      vesselMmsi: '244780354',
      vesselName: 'MICHIEL DE RUYTER',
      origin: 'Rotterdam',
      destination: 'Mariel',
      cargoLabel: 'Contenedor 40ft — alimentos',
      status: 'en_transito',
      eta: '2026-10-12',
    });
    const updated = store.update(shipment.id, { status: 'en_puerto', eta: '2026-10-14' });
    assert.equal(updated.status, 'en_puerto');
    assert.equal(updated.eta, '2026-10-14');
    assert.throws(() => store.update(shipment.id, { status: 'perdido' }), /status/);
    assert.equal(store.delete(shipment.id), true);
    assert.equal(store.get(shipment.id), null);
  });

  it('persists across store instances', () => {
    let snapshot = null;
    const hooks = {
      load: () => snapshot,
      save: (value) => {
        snapshot = value;
      },
    };
    const a = createShipmentStore(hooks);
    const created = a.create({
      clientId: 'cli_1',
      vesselMmsi: '33333',
      origin: 'A',
      destination: 'B',
      cargoLabel: 'C',
    });
    const b = createShipmentStore(hooks);
    assert.equal(b.get(created.id)?.vesselMmsi, '33333');
  });
});
