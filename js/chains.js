/**
 * One chain index across both sheets (0.7.0, owner 2026-10-29 “เลิกแยกร้านทะเบียนร้านเครือ … search / filter /
 * คำนวณ / aggregate รวมกันทั้งสองตาราง”).
 *
 * A chain is keyed the way js/model.js#brandKey keys a row: the register brand id when the sheet-1 name candidate
 * links to one (01_BRANDS.national_brand_ids), else the candidate's own id; a register brand without a candidate
 * keys itself. The brand filter, the chain chips, the brand page and the table all read this one list, so a
 * chain's count is its restaurants (sheet 1) plus its outlets (the register) — and a brand that exists in one
 * sheet only is still one chain. Logos come from the registries by id only (never by name).
 */
import {brandKey} from './model.js';
import {getBrandLogo} from './brand-logos.js';

/**
 * rows: the population (sheet-1 rows + outlets); brands: sheet-1 candidates; register: the decoded register or null.
 * Returns {list (count desc), byKey, keyOf(row), total}.
 */
export function buildChainIndex({rows = [], brands = [], register = null} = {}) {
  const byKey = new Map();
  const entry = (key, seed) => { let e = byKey.get(key); if (!e) { e = {key, name: '', register: null, candidates: [], rows: 0, outlets: 0, count: 0, withPoint: 0, provinces: new Set(), registry: false, company: null, logoBrand: null}; byKey.set(key, e); } Object.assign(e, seed); return e; };
  for (const b of register?.brands || []) entry(b.id, {name: b.name, register: b, registry: Boolean(b.registry), company: b.companyRecord || null});
  for (const c of brands) {
    const key = c.national?.[0] || c.id;
    const e = entry(key, {});
    e.candidates.push(c);
    if (!e.name) e.name = c.name;
  }
  for (const r of rows) {
    const k = brandKey(r);
    if (!k) continue;
    const e = byKey.get(k);
    if (!e) continue;
    if (r.kind === 'outlet') e.outlets++; else e.rows++;
    if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) e.withPoint++;
    if (r.province) e.provinces.add(r.province);
  }
  for (const e of byKey.values()) {
    e.count = e.rows + e.outlets;
    // The logo of the register brand first (the national identity), else the candidate's.
    e.logoBrand = [e.register, ...e.candidates].find(b => b && getBrandLogo(b)) || null;
    // The name the user reads: the candidate's (as the sheet writes it) when it exists, else the register's.
    e.name = e.candidates[0]?.name || e.register?.name || e.name;
    e.provinceCount = e.provinces.size;
  }
  const list = [...byKey.values()].filter(e => e.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'));
  return {list, byKey, total: list.length, keyOf: brandKey};
}

/** Chains present in rows, most rows first (restaurants and outlets together), with the index's names and logos. */
export function chainsOf(rows, index, limit = 12) {
  const m = new Map();
  for (const r of rows) {
    const k = brandKey(r);
    if (!k) continue;
    const e = m.get(k) || {key: k, chain: index?.byKey.get(k) || null, brand: r.brand, brands: [], count: 0, rows: 0, outlets: 0};
    e.count++; if (r.kind === 'outlet') e.outlets++; else e.rows++;
    if (!e.brands.includes(r.brand)) e.brands.push(r.brand);
    m.set(k, e);
  }
  const all = [...m.values()].sort((a, b) => b.count - a.count || (a.chain?.name || a.brand?.name || '').localeCompare(b.chain?.name || b.brand?.name || '', 'th'));
  const list = all.slice(0, limit);
  list.total = all.length;
  return list;
}

/** Display name and logo brand of a chain entry (or of a row's brand when the index lacks it). */
export const chainLabel = c => c?.chain?.name || c?.name || c?.brand?.name || '';
export const chainLogoBrand = c => c?.chain?.logoBrand || c?.logoBrand || [...(c?.brands || []), c?.brand].find(b => b && getBrandLogo(b)) || null;
