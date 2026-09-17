/**
 * Hub-architecture contract tests for the standalone business screens.
 *
 * Juan's standing rule: EVERY business gets its own separate full screen,
 * and every business screen carries an easy, always-visible back-to-hub
 * navigation. These tests read the static public/* screen files and assert
 * the contract without a browser:
 *
 *   - element id="gev-back-hub", href="/"
 *   - ES label "‹ Volver" / EN label "‹ Back" (wired through setLang/render)
 *   - min-height:52px, sticky, always visible (inside the sticky header)
 *   - voice entry: id="gev-voice-btn" → /?voice=1&biz=<id>
 *   - module deck: map card (#gev-map-deck) + AI workforce card
 *     (#gev-workforce-deck) on the four pipeline screens
 *   - phone rules: no :hover-only CSS, viewport meta, no horizontal scroll,
 *     bilingual (ES/EN) labels for the new chrome
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SCREENS = [
  { id: 'wholesale', dir: 'wholesale', deck: true },
  { id: 'crude', dir: 'crude', deck: true },
  { id: 'trade', dir: 'import-export', deck: true },
  { id: 'cubacash', dir: 'cubacash', deck: true },
  { id: 'insurance', dir: 'insurance', deck: false },
];

function readScreen(dir) {
  return readFileSync(
    new URL(`../public/${dir}/index.html`, import.meta.url),
    'utf8',
  );
}

for (const { id, dir, deck } of SCREENS) {
  test(`${id}: back-to-hub button contract`, () => {
    const html = readScreen(dir);
    assert.ok(html.includes('id="gev-back-hub"'), 'has #gev-back-hub');
    assert.ok(
      html.includes('id="gev-back-hub" href="/"') ||
        /id="gev-back-hub"[^>]*href="\/"/.test(html),
      '#gev-back-hub links to the hub (/)',
    );
    // Static markup carries the Spanish label; render()/setLang swaps it.
    assert.ok(html.includes('id="gev-back-hub-label"'), 'label span exists');
    assert.ok(html.includes('>Volver</span>'), 'static ES label ‹ Volver');
    assert.ok(
      html.includes('backhub:"Volver"') && html.includes('backhub:"Back"'),
      'ES/EN backhub i18n keys',
    );
    assert.ok(
      /#gev-back-hub\{[^}]*min-height:52px/.test(html),
      '#gev-back-hub min-height:52px',
    );
    assert.ok(
      /#gev-back-hub-bar\{[^}]*position:sticky/.test(html),
      'back-hub bar is sticky (always visible)',
    );
    // The bar lives inside the sticky <header> so it never scrolls away.
    const headerIdx = html.indexOf('<header>');
    const barIdx = html.indexOf('id="gev-back-hub-bar"');
    const headerEnd = html.indexOf('</header>');
    assert.ok(
      headerIdx >= 0 && barIdx > headerIdx && barIdx < headerEnd,
      'back-hub bar is inside the sticky header',
    );
  });

  test(`${id}: voice-controls entry returns to the hub commander`, () => {
    const html = readScreen(dir);
    assert.ok(html.includes('id="gev-voice-btn"'), 'has #gev-voice-btn');
    assert.ok(
      html.includes(`/?voice=1&amp;biz=${id}`) ||
        html.includes(`/?voice=1&biz=${id}`),
      `voice button deep-links to /?voice=1&biz=${id}`,
    );
    assert.ok(
      html.includes('voicelink:"Voz"') && html.includes('voicelink:"Voice"'),
      'ES/EN voice i18n keys',
    );
    assert.ok(
      /#gev-voice-btn\{[^}]*min-height:52px/.test(html),
      '#gev-voice-btn min-height:52px',
    );
  });

  if (deck) {
    test(`${id}: module deck surfaces map + AI workforce`, () => {
      const html = readScreen(dir);
      assert.ok(html.includes('id="gev-map-deck"'), 'map deck card');
      assert.ok(
        html.includes('id="gev-workforce-deck"'),
        'AI workforce deck card',
      );
      assert.ok(html.includes('deckmap:"Mapa"'), 'ES map label');
      assert.ok(html.includes('deckmap:"Map"'), 'EN map label');
      assert.ok(html.includes('deckwf:"Fuerza IA"'), 'ES workforce label');
      assert.ok(html.includes('deckwf:"AI workforce"'), 'EN workforce label');
    });
  }

  test(`${id}: 360px phone audit`, () => {
    const html = readScreen(dir);
    assert.ok(
      html.includes('name="viewport"'),
      'viewport meta present',
    );
    assert.ok(
      /overflow-x:\s*hidden/.test(html),
      'no horizontal scroll (overflow-x hidden)',
    );
    assert.ok(!html.includes(':hover'), 'no hover-only CSS');
    assert.ok(
      html.includes('max-width:100%') ||
        !/(?<!max-)width:\s*[4-9]\d\dpx/.test(html),
      'no fixed widths that break a 360px viewport',
    );
  });
}

test('hub honors the ?voice=1&biz= deep link (tools.js)', () => {
  const src = readFileSync(
    new URL('./app/tools.js', import.meta.url),
    'utf8',
  );
  assert.ok(src.includes("qp.get('voice') === '1'"), 'voice param checked');
  for (const [biz, phrase] of [
    ['wholesale', 'abre wholesale'],
    ['crude', 'abre crudo'],
    ['insurance', 'abre seguros'],
    ['trade', 'abre comercio'],
    ['cubacash', 'abre cuba cash'],
  ]) {
    assert.ok(
      src.includes(`${biz}: '${phrase}'`),
      `biz phrase mapped: ${biz} → "${phrase}"`,
    );
  }
  assert.ok(
    src.includes('sahjonyVoice.execute(phrase)'),
    'business context opened via voice intent',
  );
  assert.ok(src.includes('sahjonyVoice.start()'), 'commander starts');
  assert.ok(
    src.includes('autoOpen: true'),
    'hub overlay is the default entry view',
  );
});
