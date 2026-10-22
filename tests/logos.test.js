import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, load, readJSON, readBytes, sha256} from './helpers.js';
import {configureBrandLogos, getBrandLogo, brandLogoMarkup} from '../js/brand-logos.js';
import {configureVenueLogos, getVenueLogo, venueLogoMarkup, ROLE_LABELS} from '../js/venue-logos.js';

for (const [name, registry, folder] of [['brand', 'data/brand-logos.json', 'assets/brand-logos/'], ['venue', 'data/venue-logos.json', 'assets/venue-logos/']]) {
  test(`${name} logo files keep their registered bytes (sha256, size) and type`, () => {
    const r = readJSON(registry);
    assert.ok(r.assets.length > 0);
    for (const a of r.assets) {
      assert.ok(a.file.startsWith(folder), a.file);
      assert.ok(existsSync(join(ROOT, a.file)), `${a.file} exists`);
      const bytes = readBytes(a.file);
      assert.equal(bytes.length, a.bytes, `${a.file} size`);
      assert.equal(sha256(bytes), a.sha256, `${a.file} sha256`);
      assert.ok(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mime));
      assert.match(a.background, /^#[0-9A-F]{6}$/i);
      assert.ok(a.width > 0 && a.height > 0);
    }
  });
}

test('brand registry: lookup by brand id only; identity holds get no logo; markup is decorative by default', () => {
  const {data} = load();
  const status = configureBrandLogos(readJSON('data/brand-logos.json'));
  assert.equal(status.complete, true);
  assert.equal(status.assets, 155);
  const withLogo = data.brands.filter(b => getBrandLogo(b));
  assert.ok(withLogo.length >= 150);
  for (const b of data.brands.filter(x => x.hold)) assert.equal(getBrandLogo(b), null);
  assert.equal(getBrandLogo({id: 'RBR-not-a-brand', name: 'KFC'}), null, 'never matched by name');
  const html = brandLogoMarkup(withLogo[0], {size: 'sm'});
  assert.match(html, /class="brand-logo brand-logo-sm"/);
  assert.match(html, /alt=""/);
  assert.match(brandLogoMarkup(withLogo[0], {decorative: false}), /alt="โลโก้ /);
  assert.equal(configureBrandLogos({assets: [{key: 'BL-xyz', file: '../x.svg'}]}).complete, false, 'a bad catalog never throws and loads nothing');
});

test('venue registry: role captions say what a shared or parent mark stands for', () => {
  const {data} = load();
  const status = configureVenueLogos(readJSON('data/venue-logos.json'));
  assert.equal(status.complete, true);
  assert.equal(status.assets, 157);
  const linked = data.venues.filter(v => getVenueLogo(v));
  assert.ok(linked.length > 100);
  for (const v of linked) {
    const logo = getVenueLogo(v);
    assert.ok(logo.role in ROLE_LABELS, `${v.name}: ${logo.role}`);
    if (logo.role !== 'venue_specific') assert.ok(logo.roleLabel, `${v.name}: shared/parent mark carries a caption`);
  }
  assert.match(venueLogoMarkup(linked[0], {size: 'md'}), /class="venue-logo venue-logo-md"/);
});

test('logo folders hold no file the registries do not list', async () => {
  const {readdirSync} = await import('node:fs');
  for (const [registry, folder] of [['data/brand-logos.json', 'assets/brand-logos'], ['data/venue-logos.json', 'assets/venue-logos']]) {
    const listed = new Set(readJSON(registry).assets.map(a => a.file.split('/').pop()));
    for (const f of readdirSync(join(ROOT, folder))) assert.ok(listed.has(f), `${folder}/${f} is registered`);
  }
});
