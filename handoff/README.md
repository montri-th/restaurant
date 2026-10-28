# เริ่มงานต่อ — CityMETER Restaurants

รุ่นส่งต่อ 0.3.0 · 28 ตุลาคม 2569 · ร้านดึงและตรวจ 22 ตุลาคม 2569 · ทะเบียนร้านเครือตรวจ 25–28 ตุลาคม · Land join 28 ตุลาคม 2569

ชุดนี้ส่งต่อให้ developer หรือ coding agent พัฒนาต่อจาก repository ที่ใช้งานจริง หลักของรุ่นนี้คือ **เห็นเมือง 3 มิติที่โฟกัส 3 แขวง/ตำบลที่ร้านอาหารแน่นที่สุดก่อน (ร้าน/ตร.กม.) แสดงรายละเอียดเฉพาะส่วนที่โฟกัส ส่วนอื่นเงียบ และบอกความครอบคลุมของข้อมูลบนแผนที่** โดยคงสัญญากล้อง basemap มวลอาคาร และ venue x-ray ของ CityMETER · Luxury Brands 0.5 รุ่น 0.2 เพิ่มสถานที่จากท้ายชื่อร้าน การจับจุดของร้านกับอาคาร 3 มิติ (กดอาคารได้) และการย้ายไปแขวง/ตำบลข้าง ๆ ด้วยการกดบนแผนที่ รุ่น 0.3 เพิ่มทะเบียนร้านเครือทั่วประเทศ (มุมมองแยก คนละหน่วย) อาคารในทะเบียน Land (ในอาคารเทียบรอบอาคาร) และส่วนอาคาร LOD2 จากชุดเดียวกับเว็บ shoppingcenter

Live: [Restaurants](https://montri-th.github.io/restaurant/) · Source: [GitHub](https://github.com/montri-th/restaurant) · ระบบจริง: [CityMETER Restaurant](https://landometer.com/v3/citymeter?d=restaurant)

## อ่านตามลำดับนี้

| คนอ่าน | เครื่องอ่าน | ใช้ทำอะไร |
|---|---|---|
| [../PRODUCT_STATEMENT.md](../PRODUCT_STATEMENT.md) | [product-statement.json](product-statement.json) | Winning strategy: Who / What / Which / How, quality bar, ป้ายหลักฐาน, hypotheses — อ่านก่อนเปลี่ยนสิ่งที่หน้าแรกบอก |
| [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) | [product-brief.json](product-brief.json) | row scopes + focus modes, first Aha, สัญญาตัวชี้วัด ความครอบคลุม รูปทรงประเภท แผนที่ focus/quiet, breadcrumb, แผงหกโหมด, สัญญาจับคู่สถานที่ อาคาร และการกด, กราฟ, invariants INV01–INV32, registerContract, landJoinContract, lodContract |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | [implementation-plan.json](implementation-plan.json) | โมดูล งาน P01–P12 acceptance AC01–AC31 backlog N01–N17 วิธีทำงานต่อ |
| [VERIFICATION.md](VERIFICATION.md) | `handoff-manifest.json` (ใน bundle) | ผลตรวจแยกระดับ (unit / LDS parity / rendered / live) และ hash ของทุกไฟล์ |
| README นี้ | [handoff.schema.json](handoff.schema.json) | สัญญาโครงสร้างของ JSON (schema 1.5.0) |

`product-statement.json`, `product-brief.json` และ `implementation-plan.json` แก้คู่กับ Markdown ส่วน `handoff-manifest.json` สร้างด้วย `npm run handoff:manifest` เท่านั้น ไม่ถูก track ใน git ห้ามแก้ hash ด้วยมือ

บริบทข้อมูล: [DATA_METHOD.md](../DATA_METHOD.md) · [docs/AREA_METHOD.md](../docs/AREA_METHOD.md) · [docs/CHART_SELECTION.md](../docs/CHART_SELECTION.md) · [docs/BUILD_CARD.md](../docs/BUILD_CARD.md)

## เปิดในเครื่อง

```sh
npm start      # http://127.0.0.1:4173/
npm test       # unit tests บนข้อมูลจริง
```

เป็น static site ไม่มี build step ไม่ต้อง `npm install` ต้องมี Node ≥ 20 และ Python 3 แผนที่ต้องเข้าถึง unpkg.com (MapLibre) และ tiles.openfreemap.org (tiles + glyphs) กราฟไม่ใช้ไลบรารีภายนอก ถ้าเครื่องทดสอบถูกบล็อก ใช้ harness แบบ stub tiles ตาม VERIFICATION การเปิด `index.html` เป็นไฟล์โดยตรงจะพาไปเว็บสาธารณะ

สร้างข้อมูลใหม่ต้องใช้อินพุตภายใน (xlsx ของชีตวิจัย, manifest โลโก้, โฟลเดอร์โลโก้, geometry responses) ซึ่งไม่อยู่ใน repository — ดู DATA_METHOD §11

## สิ่งที่ห้ามทำหล่น

- ขอบเขตข้อมูลสามชั้น: `scopeRows` ขับข้อค้นพบ choropleth กราฟ และอันดับในโปรไฟล์; `rows` ขับสัญลักษณ์ที่มีรายละเอียด ตัวนับ และตาราง; ระดับสถานที่ใช้ร้านที่ชื่ออ้างถึงสถานที่
- ความเป็นสมาชิกพื้นที่ = รหัสแขวง/ตำบลของต้นทาง ห้าม point-in-polygon บนพิกัดแสดงผล ห้ามจับด้วยชื่อ
- ความหนาแน่น = ร้าน ÷ ตร.กม. ของ production; หลายพื้นที่ใช้ Σ/Σ; ไม่จัดอันดับพื้นที่ที่มีน้อยกว่า 30 ร้าน; การเลือกเล็กเปลี่ยนเป็นจำนวนและบอกเหตุผล
- ความครอบคลุม: ไม่มีข้อมูล (ลายทแยง) ≠ ศูนย์ที่วัดได้ (เส้นขอบศูนย์) ≠ ไม่วาด (จังหวัดนอกขอบเขต); missing ไม่เป็น 0
- 3D first Aha: หน้าแรกคือ preset `city` ที่โฟกัส 3 แขวงอัตโนมัติ; ออกได้ด้วย “ดูทุกพื้นที่” (`?areas=all`) หรือปุ่ม 3D และตัวเลขต้องไม่เปลี่ยน
- focus + quiet: สี สัญลักษณ์ประเภท โลโก้ มวลอาคารมุมโค้ง เฉพาะส่วนที่โฟกัส ส่วนอื่นเป็นเส้นขอบ ป้ายอ่อน จุดสีเทาที่ไม่รับ focus
- ประเภทร้านผูก series ด้วย id พร้อมรูปทรงประจำ series (DATAVIZ-05) ห้ามใช้สีอย่างเดียว
- เครือร้าน/สถานที่เป็น candidate จากชื่อ: “ร้านอื่นที่ชื่อตรงกับ…”, “ชื่อร้านอ้างถึงสถานที่นี้”, “ชื่อร้านลงท้ายด้วยชื่อสถานที่นี้”, “สถานที่จากชื่อร้าน” ห้ามใช้ “สาขา” หรือ “ตั้งอยู่ใน”; คำว่า หน้า/ข้าง/near/behind ก่อนชื่อสถานที่ไม่ใช่สถานที่ของร้าน
- การจับจุดกับอาคารเป็นผลตอนแสดงผล: “จุดตกในอาคาร” + ความละเอียดราว 9.55 ม. ไม่เปลี่ยนแถวหรือจำนวนของสถานที่และไม่เปลี่ยนตัวเลขของพื้นที่
- การกดแผนที่ตามลำดับ x-ray → อาคารของสถานที่ → หมุด → อาคารในโฟกัส → จังหวัด → แขวง/ตำบล (`area-hit` ทุกซูม); จุดบริบทสีเทาไม่ใช่เป้ากด; กดในพื้นที่ที่เลือกอยู่ไม่เปลี่ยนอะไร
- ความลื่น: การเลือกไม่ส่งจุดบริบทซ้ำ มวลอาคารคำนวณหลังกล้องหยุด หมุด HTML เกาะแผนที่ระหว่างเคลื่อน — อย่าเพิ่มงานหนักใน handler ของ `move`
- breadcrumb ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล ด้วยรหัสและลิงก์ลึกของ production; สถานที่ไม่อยู่ใต้แขวง; ร้านไม่ใช่ crumb
- provenance (dataset · source · date · boundary) ท้ายทุกมุมมองของแผง
- กล้อง basemap มวลอาคาร venue x-ray ตามสัญญาเดิมของ Luxury Brands: ห้ามเรียงชั้น host/massing/x-ray ใหม่โดยไม่ตั้งใจ; pitch ≤ 90 − fov/2 − 3
- หนึ่งสัญลักษณ์ต่อหนึ่ง observation ไม่ cluster; โลโก้ ≤ 250 เฉพาะ zoom ≥ 15.5 ในโฟกัส; โลโก้คงไบต์เดิม
- LDS 0.9.7 tokens เท่านั้น สีข้อมูลเหมือนกันสองธีม; nav-7 FILL 0 / wght 300; ไม่มี decorative bracket หรือ colored left rail; focus ring มองเห็น; reduced motion
- ข้อมูลหลักต้องใช้ได้เมื่อแผนที่ไม่พร้อม; มี loading/slow/error/retry
- ออกรุ่นใหม่: เปลี่ยน cache tag `?v=` ทุกจุดใน `index.html` (entry + import map ของทุกโมดูล) พร้อม `package.json` version และ `productVersion` ใน handoff JSON — `tests/release.test.js` ตรวจให้; โมดูลใหม่ต้องเพิ่มใน import map
- attribution ของแผนที่ (OpenStreetMap, OpenMapTiles/OpenFreeMap, CityMETER) ต้องอ่านได้เหนือถาดกราฟ: กฎ CSS ของ control ต้อง scope ใต้ `.map-panel` เพราะ CSS ของ MapLibre โหลดทีหลัง และ `--attrib-height` ดัน legend/การ์ด Aha บนมือถือขึ้นเหนือมัน

## เริ่มด้วยงานหนึ่งชิ้น

```text
อ่าน AGENTS.md, PRODUCT_STATEMENT.md, handoff/PRODUCT_BRIEF.md และ handoff/product-brief.json
ทำเฉพาะงาน Nxx ใน handoff/IMPLEMENTATION_PLAN.md
ตรวจ source และสถานะจริงก่อนแก้ อย่าถือว่าทำเสร็จแล้ว
คง row scopes, focus modes, สัญญาตัวชี้วัดและความครอบคลุม, membership ตามรหัสต้นทาง, breadcrumb, LDS tokens และรูปทรงประเภท
เพิ่มหรือปรับ tests ใน tests/ สำหรับพฤติกรรมที่เปลี่ยน แล้วตรวจ browser ที่ 390 และ 1280 ทั้งสองธีม
ส่งรายการไฟล์ที่แก้ ผลตรวจที่ทำจริง และประเด็นที่ยังไม่ยืนยัน
อย่าเปลี่ยนสูตร metric เกณฑ์ 30 ร้าน taxonomy หรือสีข้อมูลเงียบ ๆ และอย่ารายงานว่าเผยแพร่แล้วจากผลในเครื่อง (ใช้ npm run verify:live)
```

## ตรวจความครบก่อนรับช่วง

1. `RELEASE_RECEIPT.json` ใน bundle ระบุ commit ที่เผยแพร่ ให้ `git checkout <commit>` แล้วเทียบ `handoff/handoff-manifest.json` กับไฟล์จริง (`npm run handoff:manifest` ต้องให้ hash เดิมบน working tree ที่สะอาด)
2. `npm test` ต้องผ่านทั้งหมด
3. `npm run verify:live` ต้องผ่านทุกไฟล์ที่เผยแพร่ (ผลตอนส่งมอบอยู่ใน `evidence/live-attestation.json` ของ bundle)
4. เปิด 390 px และ desktop ทั้งสองธีม ไล่ flow: 3D first Aha → ดูทุกพื้นที่ → แขวง (model) → กดแขวงข้าง ๆ → กดอาคารสีน้ำเงิน/อาคารที่มีร้าน → เขต → ร้าน → สถานที่ (มุมสถาปนิก, อาคารสีน้ำเงิน) → ปุ่ม 3D (แผนผัง) → ซูมออกทั้งประเทศ (กรอบจังหวัด) → กราฟสามมุมมอง → ตาราง → help

ชุดส่งต่อเผยแพร่เฉพาะ source/data/assets ที่อยู่ใน repository และบทสรุปประยุกต์ ไม่แนบชีตวิจัยภายใน private Drive/Sheet URLs credentials หรือ LDS/token library ทั้งชุด
