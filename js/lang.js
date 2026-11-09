/**
 * Restaurants · page language (citymeter-shell, js/shell/i18n.js). js/app.js imports this module first, so an English
 * page is translated before anything renders. The words are in js/lang-en.js. Names come from the data's own English
 * and are never translated here (demo-platform-review §5.8): provinces and subdistricts from production base info,
 * districts and the subdistricts production leaves without English from OpenGISData-Thailand (DOPA-credited,
 * data/districts.geojson and data/areas.geojson metadata.englishNames), the food-type groups from groups[].en, a Land
 * host from its nameEn; chains are named in English by the data. A restaurant's, an outlet's or a venue's Thai name
 * stays as its source writes it (keepThai), and so do the register's addresses and research notes.
 */
import {LANG, registerDictionary, registerNames, keepThai, startTranslation} from './shell/i18n.js';
import {entryParts} from './model.js';
import RESTAURANT_EN from './lang-en.js';

const THAI = /[ก-ฺเ-๎]/;

if (LANG === 'en') {
  registerDictionary(RESTAURANT_EN);
  startTranslation();
  // The English is a draft until reviewed (demo-platform-review §5.8): the help dialog says so.
  const note = () => {
    const intro = document.querySelector('.usage-dialog .help-intro');
    if (!intro || document.getElementById('draft-english-note')) return;
    const p = document.createElement('p');
    p.id = 'draft-english-note';
    p.className = 'help-intro';
    p.textContent = 'English is a draft translation from the Thai. Restaurant, branch and venue names stay as their sources write them, and so does a place name with no English in the data. The product statement is in Thai.';
    intro.after(p);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', note, {once: true}); else note();
}

/** A name map that leaves a Thai name with two different English names Thai (no guess between them). */
function nameBook() {
  const english = new Map(), thai = new Set();
  const add = (th, en) => {
    if (!th || !THAI.test(th)) return;
    if (!en || THAI.test(en)) { thai.add(th); return; }
    const seen = english.get(th);
    if (seen === undefined) english.set(th, en); else if (seen !== en) english.set(th, null);
  };
  const done = () => {
    const pairs = [];
    for (const [th, en] of english) { if (en) pairs.push([th, en]); else thai.add(th); }
    registerNames(pairs);
    keepThai([...thai].filter(th => !english.get(th)));
  };
  return {add, keep: v => { if (v && THAI.test(v)) thai.add(v); }, done};
}

/** Register the English the data carries. index = js/areas.js buildAreaIndex, data = js/model.js decodeDataset. */
export function registerDataNames({index, data}) {
  if (LANG !== 'en') return;
  const labels = {};
  for (const g of data?.groups || []) if (g.th && g.en) labels[g.th] = g.en;
  registerDictionary({exact: labels});
  const book = nameBook();
  for (const p of index?.provinces || []) { book.add(p.name, p.nameEn); book.add(`จังหวัด${p.name}`, p.nameEn); }
  const bangkok = (index?.provinces || []).find(p => p.id === 'BKK')?.nameEn;
  book.add('กรุงเทพฯ', bangkok); book.add('กรุงเทพ', bangkok);
  // Districts first, then subdistricts: a bare name shared by both reads as the subdistrict (the bare names on the page
  // are subdistricts: ranks, labels, the first finding); with its word (เขต/อำเภอ, แขวง/ตำบล) each reads as itself.
  const plain = new Map();
  for (const d of index?.districts || []) { book.add(`${d.province === 'BKK' ? 'เขต' : 'อำเภอ'}${d.name}`, d.nameEn); plain.set(d.name, d.nameEn); }
  for (const a of index?.areas || []) { book.add(`${a.province === 'BKK' ? 'แขวง' : 'ตำบล'}${a.name}`, a.nameEn); plain.set(a.name, a.nameEn); }
  const sub = new Map();
  for (const a of index?.areas || []) { const s = sub.get(a.name); sub.set(a.name, s === undefined ? a.nameEn || '' : s === (a.nameEn || '') ? s : null); }
  for (const [th, en] of plain) { const s = sub.get(th); if (s === null) { book.keep(th); continue; } book.add(th, s !== undefined ? s : en); }
  // As the sources write them: restaurant and venue names (a venue with an English name reads it already), and the part
  // of a restaurant's name after its chain (“สาขาเซ็นทรัล บางนา”), which lists show on its own (js/model.js#entryParts).
  for (const r of data?.rows || []) { book.keep(r.name); book.keep(entryParts(r).secondary); }
  for (const r of data?.moved || []) book.keep(r.name);
  for (const v of data?.venues || []) book.keep(v.name);
  book.done();
  // A chain in a place is the tab title of a chain page (“After You ประเทศไทย”, js/app.js#updateCrumbs): the place is
  // the last crumb's label, so only those labels read as places here.
  const places = new Set(['ประเทศไทย']);
  for (const p of index?.provinces || []) places.add(p.name);
  for (const d of index?.districts || []) places.add(`${d.province === 'BKK' ? 'เขต' : 'อำเภอ'}${d.name}`);
  for (const a of index?.areas || []) places.add(`${a.province === 'BKK' ? 'แขวง' : 'ตำบล'}${a.name}`);
  registerDictionary({patterns: [[/^([^\u0E00-\u0E7F]+) ([\u0E00-\u0E7F].*)$/, (m, t) => (places.has(m[2]) ? `${m[1]} in ${t.name(m[2])}` : null)]]});
}

/** The chain register and the Land join load after the first paint: their names, once they arrive. */
export function registerExtraNames({register, land}) {
  if (LANG !== 'en') return;
  const book = nameBook();
  for (const p of register?.provinces || []) { book.add(p.th, p.en); }
  // An outlet reads as its chain and its own name (map pins, the tab title): “Swensen's สเวนเซ่นส์ เซ็นทรัล บางนา ชั้น 5”.
  for (const o of register?.outlets || []) {
    book.keep(o.name); book.keep(o.address);
    const brand = o.brand?.name || '';
    if (brand && o.name && o.name !== brand) book.keep(`${brand} ${o.name}`);
  }
  for (const c of register?.companies || []) book.keep(c.name);
  for (const b of register?.brands || []) book.keep(b.name);
  for (const h of land?.hosts || []) book.add(h.name, h.nameEn);
  book.done();
}

/** On an English page the line under an English place heading is its Thai name, marked as Thai and left alone. */
export const thaiSubName = (thai, english) => (LANG === 'en' && english && !THAI.test(english) ? thai : '');
