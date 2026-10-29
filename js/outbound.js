/**
 * Outbound searches with the context of the view (owner 2026-10-29 “google search AI mode, streetview, search ด้วย
 * context ที่ relevant กับเสียงในหัวของ user ในขณะนั้น”): each view offers the questions its users are likely holding
 * (Product Statement §2.1 triggers — expansion, leasing, analyst) pre-filled for Google's AI Mode, a Street View at
 * the point, and a Google Maps search. Pure URL builders; the targets are public URL schemes (Google Maps URLs,
 * Google Search `udm=50` = AI Mode). Nothing here is evidence: the panel labels the row “ค้นต่อ” and keeps every
 * number of the product unchanged.
 */
const q = s => encodeURIComponent(String(s || '').replace(/\s+/g, ' ').trim());

export const googleAI = query => `https://www.google.com/search?udm=50&q=${q(query)}`;
export const googleSearch = query => `https://www.google.com/search?q=${q(query)}`;
export const streetView = (lat, lng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(lat).toFixed(6)}%2C${Number(lng).toFixed(6)}`;
export const mapsSearch = query => `https://www.google.com/maps/search/?api=1&query=${q(query)}`;
export const mapsPoint = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)}%2C${Number(lng).toFixed(6)}`;

const hasPoint = c => Number.isFinite(c?.lat) && Number.isFinite(c?.lng);
const place = c => [c.area, c.district, c.province].filter(Boolean).join(' ');

/**
 * Links for a context: {kind: 'store' | 'chain' | 'area' | 'district' | 'venue' | 'company' | 'country',
 * name, brand, branch, company, area, district, province, lat, lng}. Returns [{kind, label, question, href}].
 */
export function outboundFor(c = {}) {
  const out = [];
  const ai = (label, question) => out.push({kind: 'ai', label, question, href: googleAI(question)});
  const name = c.name || c.brand || '';
  switch (c.kind) {
    case 'store': {
      const full = [c.brand, c.branch && c.branch !== c.brand ? c.branch : '', !c.brand ? c.name : ''].filter(Boolean).join(' ');
      ai('AI Mode · รีวิว เมนู เวลาเปิด', `${full} ${place(c)} รีวิว เมนู ราคา เวลาเปิด-ปิด`);
      if (hasPoint(c)) out.push({kind: 'street', label: 'Street View', question: '', href: streetView(c.lat, c.lng)});
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: hasPoint(c) ? mapsPoint(c.lat, c.lng) : mapsSearch(`${full} ${place(c)}`)});
      break;
    }
    case 'chain':
      ai('AI Mode · สาขาและข่าวล่าสุด', `${name} มีกี่สาขาในไทย สาขาใหม่ล่าสุด ข่าวการขยายสาขา`);
      ai('AI Mode · แฟรนไชส์และคู่แข่ง', `${name} แฟรนไชส์ เงื่อนไข ค่าใช้จ่าย และแบรนด์คู่แข่งที่ใกล้เคียง`);
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: mapsSearch(`${name} ${c.province || 'ประเทศไทย'}`)});
      break;
    case 'company':
      ai('AI Mode · แบรนด์ในเครือ', `${name} แบรนด์ร้านอาหารในเครือ จำนวนสาขา และแผนขยายสาขา`);
      break;
    case 'area':
    case 'district':
      ai('AI Mode · ร้านดังและราคาแถวนี้', `ร้านอาหารย่าน ${place(c)} มีร้านดังอะไรบ้าง ประเภทไหนเยอะ ราคาประมาณเท่าไร`);
      ai('AI Mode · ทำเลและค่าเช่า', `ทำเลเปิดร้านอาหาร ${place(c)} ค่าเช่าพื้นที่ร้านอาหาร และกลุ่มลูกค้า`);
      if (hasPoint(c)) out.push({kind: 'street', label: 'Street View', question: '', href: streetView(c.lat, c.lng)});
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: mapsSearch(`ร้านอาหาร ${place(c)}`)});
      break;
    case 'venue':
      ai('AI Mode · ร้านในสถานที่นี้', `ร้านอาหารใน ${name} ${c.province || ''} มีร้านอะไรบ้าง ชั้นไหน ร้านใหม่ล่าสุด`);
      ai('AI Mode · พื้นที่เช่า', `${name} พื้นที่เช่าร้านอาหาร ติดต่อฝ่ายขายพื้นที่ ค่าเช่า`);
      if (hasPoint(c)) out.push({kind: 'street', label: 'Street View', question: '', href: streetView(c.lat, c.lng)});
      out.push({kind: 'maps', label: 'Google Maps', question: '', href: hasPoint(c) ? mapsPoint(c.lat, c.lng) : mapsSearch(`${name} ${c.province || ''}`)});
      break;
    case 'country':
    default:
      ai('AI Mode · เครือร้านอาหารในไทย', `เครือร้านอาหารในประเทศไทยที่มีสาขามากที่สุด และแบรนด์ที่กำลังขยายสาขา ${c.province ? `ใน${c.province}` : ''}`);
      break;
  }
  return out;
}
