# Implementation Plan — CityMETER · Restaurants 0.1

คู่กับ [implementation-plan.json](implementation-plan.json) (schema 1.4.0) · อ่าน [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) ก่อน

## 1. สถาปัตยกรรม

Static HTML/CSS/JavaScript ES modules ไม่มี framework ไม่มี build step Node ≥ 20 สำหรับ tests และสคริปต์ handoff Python 3 สำหรับ dev server และสคริปต์สร้างข้อมูล (openpyxl, Pillow) mapshaper 0.6 สำหรับขอบเขต

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm start` | http://127.0.0.1:4173/ |
| `npm test` | node --test บนข้อมูลจริง |
| `npm run handoff:manifest` | hash ทุกไฟล์ที่ track → `handoff/handoff-manifest.json` |
| `npm run handoff:bundle` | manifest + zip ส่งต่อใน `dist/` |
| `npm run verify:live` | เทียบไบต์บน GitHub Pages กับ manifest |

บริการภายนอก: MapLibre GL 5.6.2 (unpkg, pin ใน `js/vendors.js`), OpenFreeMap tiles + glyphs ข้อมูลหลักโหลดได้ภายใน 45 วินาที (`restaurants.json` ราว 8 MB, gzip ราว 2 MB) ไลบรารีเสริมมี timeout 20 วินาที

## 2. โมดูล

| ไฟล์ | หน้าที่ |
|---|---|
| `js/app.js` | ประกอบทั้งหมด: row scopes, focus modes, coverage ตามจังหวัด/เขต, panel modes + back stack, URL, map lifecycle + reinstall เมื่อเปลี่ยนธีม, camera, ลำดับการคลิกแผนที่ (x-ray → อาคาร → หมุด → จังหวัด → แขวง), legend ตาม zoom, ตัวนับ/ตาราง |
| `js/model.js` | ถอดข้อมูล (กริด → lon/lat), PROVINCES, ราคา, GROUP_SHORT, filterRows, summarize, mixOf, productionLink |
| `js/areas.js` | index แขวง/ตำบล เขต/อำเภอ จังหวัด, คำระดับ, summarizeAreas/Districts, combinedDensity |
| `js/area-insight.js` | ข้อค้นพบแรก + filterAreaRows |
| `js/scales.js` | LUT density.area / count / price, การจัดระดับ, EVID-05, ink |
| `js/cues.js` | กลุ่มประเภท → series + รูปทรง, SVG และ icon แผนที่ |
| `js/map-layers.js` | choropleth แขวง/ตำบล, hatch, เส้นเขต, ป้าย HTML |
| `js/provinces.js` | กรอบจังหวัด (count) |
| `js/pins.js` | symbol layer, จุดบริบท, หมุด HTML, โลโก้ |
| `js/buildings.js`, `js/venue-xray.js`, `js/massing.js`, `js/geometry.js`, `js/mvt.js`, `js/map-style.js`, `js/camera.js` | อาคารสถานที่, x-ray, มวลอาคาร, basemap, กล้อง (จาก Luxury Brands 0.5 ไม่เปลี่ยนตรรกะ) |
| `js/breadcrumb.js` | breadcrumb + ลิงก์ production |
| `js/profile-model.js`, `js/panel.js` | view models + HTML ของแผง + provenance |
| `js/chart-model.js`, `js/charts.js` | กราฟ HTML ไม่มี vendor |
| `js/brand-logos.js`, `js/venue-logos.js` | registry โลโก้ |
| `js/navigation.js`, `js/launch.js`, `js/vendors.js` | ไอคอน/help, launch overlay, MapLibre loader |
| `scripts/build-boundaries.py` | ขอบเขตจาก production + ใบรับ |
| `scripts/build-data.py` | ข้อมูล โลโก้ อาคาร จากชีตวิจัยและ manifest |

## 3. Selection

ตัวกรอง: `search` `group` `price` `province` `brand` · URL: + `district` `area` `areas` `view` `store` `place` `view3d` `cam` · Row scopes: scopeRows → baseRows → rows (+ ร้านของสถานที่) · Panel actions: `select-area` `select-district` `select-store` `select-venue` `select-province` `filter-brand` `back` `explore-top` `clear-focus` `open-charts` `open-table` `clear-filter` `crumb-*` `toggle-3d`

## 4. งาน (ทำแล้วในรุ่น 0.1)

| ID | งาน | ขึ้นกับ | Acceptance |
|---|---|---|---|
| P01 | ดึง snapshot ใหม่จาก API สาธารณะ และตรวจชีตวิจัยกับมัน | — | AC20 |
| P02 | ขอบเขตจาก production พร้อมใบรับ | P01 | AC20, AC11 |
| P03 | ข้อมูล โลโก้ อาคาร จากชีต | P01 | AC20 |
| P04 | model, areas, scales, cues, first Aha | P02, P03 | AC02, AC05, AC06, AC21 |
| P05 | ชั้นแผนที่ | P04 | AC03, AC06, AC12, AC15 |
| P06 | แผง breadcrumb provenance | P04 | AC07–AC11, AC24 |
| P07 | กราฟและตาราง | P04 | AC13, AC14 |
| P08 | app, URL, ธีม, มือถือ, failure paths | P05–P07 | AC01, AC04, AC16–AC19 |
| P09 | tests, LDS parity, harness | P08 | AC20, AC21 |
| P10 | เอกสาร handoff เผยแพร่ ตรวจ live | P09 | AC22, AC23 |

## 5. Acceptance criteria

| ID | สถานการณ์ | ผลที่คาด | ตรวจด้วย |
|---|---|---|---|
| AC01 | โหลดครั้งแรกผ่าน HTTP(S) | ข้อมูลและแผงพร้อมก่อนแผนที่; overlay หายเมื่อ `citymeter:ready`; ไม่มี console error | browser |
| AC02 | ข้อค้นพบเริ่มต้น | 99.7 ร้าน/ตร.กม. ใน สี่แยกมหานาค · ตลาดน้อย · สุริยวงศ์ (136 ร้าน, 1.4 ตร.กม.) ฐานเทียบ 18.0 เกณฑ์ 30 ร้าน 2 ปุ่ม; คำนวณ ไม่ใช่ค่าคงที่ | unit + browser |
| AC03 | ภาพแรก 3 มิติ | preset city (pitch 56) กรอบ 3 แขวง; สี ป้ายหมึก สัญลักษณ์เฉพาะที่นั่น ส่วนอื่นเงียบ | browser |
| AC04 | ดูทุกพื้นที่ | `?areas=all`; ทุกพื้นที่ที่มีข้อมูลมีสี ตัวเลขไม่เปลี่ยน ปุ่มเป็น “โฟกัส 3 แขวงนี้” | browser |
| AC05 | เปลี่ยนตัวกรอง | ทุกอย่างคำนวณใหม่; การเลือกเล็กเปลี่ยนเป็นโหมดจำนวนและบอกเหตุผล | unit + browser |
| AC06 | ความครอบคลุม | 273 พื้นที่ลายทแยง ไม่เป็น 0; ศูนย์ตามตัวกรองมีเส้นขอบศูนย์; legend แสดง 0/ไม่มีข้อมูลเมื่อมีจริง | unit + browser |
| AC07 | โปรไฟล์แขวง/ตำบล | ร้าน ร้าน/ตร.กม. รีวิว คะแนนเฉลี่ย ตร.กม. อันดับหรือ “ไม่จัดอันดับ” ประเภท (รูปทรง) ราคา + ไม่ระบุ รีวิวมากสุด เครือ สถานที่ provenance; กล้อง model | unit + browser |
| AC08 | โปรไฟล์เขต/อำเภอ | พื้นที่ผ่านเกณฑ์มีอันดับ ที่เหลือไม่มีอันดับ เส้นเขตเลือก เฉพาะแขวงในเขตมีสี | browser |
| AC09 | รายละเอียดร้าน | คะแนนหรือ “ไม่มีคะแนนในแหล่งข้อมูล” ราคาหรือ “ไม่ระบุราคา (ไม่ใช่ราคา 0)” เครือ/สถานที่แบบ candidate พิกัดแสดงผล + tile/grid รหัส observation ลิงก์ production; ไม่ใช้คำว่าสาขา | unit + browser |
| AC10 | สถานที่ที่มีอาคาร | เฉพาะร้านของสถานที่มีรายละเอียด อาคารสีน้ำเงินเห็นทุกมุม มุมสถาปนิกเปิด ตัวนับ/ตารางตามร้านของสถานที่ | browser |
| AC11 | Breadcrumb | 4 ระดับ กดได้ทุกระดับ ลิงก์ /D/ /S/ เปิด production พับที่ 390 px | unit + browser |
| AC12 | มุมมองประเทศ | ต่ำกว่า zoom 8.5 จังหวัด 7 แห่งมีสีระดับ count + ป้าย กดแล้วกรองจังหวัด legend เปลี่ยน | browser |
| AC13 | กราฟ | แท่งเรียง สีระดับ; matrix ช่องเท่ากัน หัวมีรูปทรง; ราคาเป็นสัดส่วนของร้านที่ระบุ; ทุก mark เปิดพื้นที่ | unit + browser |
| AC14 | ตาราง | ตามขอบเขตรายละเอียด เรียงตามรีวิว หน้าละ 25 | browser |
| AC15 | ซูมใกล้ | จาก zoom 15.5 หมุด HTML + โลโก้ ≤ 250 ในโฟกัส ลูกศรเลื่อนหมุด จุดบริบทไม่รับ focus | browser |
| AC16 | ธีม | Auto/Light/Dark ติดตั้งชั้นใหม่โดยไม่มี error สีข้อมูลเหมือนกัน | unit + browser |
| AC17 | มือถือ 390 px | การ์ด Aha บนแผนที่ sheet ≤ 64dvh ป้ายเฉพาะโฟกัส ไม่มี scroll แนวนอน | browser |
| AC18 | แผนที่ล้ม | การ์ดแจ้ง + ลองใหม่; Aha แผง กราฟ ตารางใช้ได้ | browser |
| AC19 | URL | พารามิเตอร์ทั้ง 13 ตัวกู้คืนมุมมองเดิม | browser |
| AC20 | ความถูกต้องของข้อมูล | 70,214 แถวไม่หลุด ตรง meta ใบรับขอบเขต sha256 โลโก้ | unit |
| AC21 | LDS parity | LUT classes scaleVersion series foundation map roles dataState ตรง LDS 0.9.7 | script |
| AC22 | เผยแพร่ | `npm run verify:live` ผ่านทุกไฟล์ + ตรวจด้วย Chrome desktop light/dark และจอแคบ | live |
| AC23 | attribution และชั้นซ้อน | ที่ 1440, 1180 และ 390 px attribution ของแผนที่อ่านได้ครบเหนือถาดกราฟ (ไม่อยู่ใต้ถาด legend การ์ด Aha หรือป้าย) และตารางไม่ล้นเกินขอบบนของแผนที่เมื่อเปิดกราฟอยู่ | browser (live) |
| AC24 | การเลือกที่ว่าง | แขวง/ตำบลหรือเขต/อำเภอที่เป็นลายทแยง (no_data) เปิดคำอธิบายโดยไม่มีช่องตัวเลข 0; พื้นที่ที่มีข้อมูลแต่ตัวกรองเหลือ 0 แสดงศูนย์ที่วัดได้และพาไปพื้นที่ที่ตัวกรองเดียวกันพบร้าน | unit + browser |

## 6. วิธีทำงานต่อ

1. อ่าน AGENTS.md แล้ว handoff/README.md, PRODUCT_STATEMENT.md และ brief คู่ md/json
2. `npm test` ก่อนแก้; คง row scopes, focus modes, metric/coverage contracts และ panel actions
3. แก้ทีละงาน คง INV01–INV23
4. ตรวจการคำนวณด้วยข้อมูลจริงใน tests/ (`tests/helpers.js` โหลดครั้งเดียว)
5. ดูภาษาไทยจริงที่ 390 px และ desktop ทั้งสองธีม; ใช้ harness แบบ stub tiles เมื่อ CDN/tiles ถูกบล็อก แล้วยืนยันภาพจริงบนเว็บ
6. ปรับกล้อง/ชั้นสดผ่าน `window.__citymeter` ใน console ก่อนเปลี่ยนค่าคงที่
7. เผยแพร่เฉพาะที่ได้รับอนุญาต รอ Pages build แล้ว `npm run verify:live` ก่อนรายงาน
8. สร้าง manifest/bundle จาก working tree ที่สะอาด ห้ามแก้ hash ด้วยมือ

## 7. Backlog

| ID | งาน | ผู้รับ |
|---|---|---|
| N01 | รอบอัปเดต snapshot ตามกำหนด พร้อมรายงานความต่างต่อแขวงและ archive ตามวันที่ | data engineer |
| N02 | source export ที่เจ้าของอนุญาต (source UUID, พิกัดจริง, วันที่เก็บ, type tags ทั้งหมด) แทนตำแหน่งแสดงผลและการจัดกลุ่มจาก primary type | data owner |
| N03 | ร้านต่อประชากร 1,000 คนกับ CityMETER Population บนกรอบเดียวกัน (สัญญาตัวชี้วัดใหม่ ไม่ปนกับต่อ ตร.กม.) | product + data |
| N04 | โลโก้ขนาดเว็บพร้อมบันทึก derivation (KFC 1.2 MB, The Circle Ratchaphruek 1.1 MB) | frontend |
| N05 | ตรวจ candidate เครือ/สถานที่ด้วยรายชื่อสาขาและ directory แล้วยกระดับพร้อมหลักฐาน | research |
| N06 | เทียบหมวด Café ของ production (type tags ทั้งหมด) เมื่อมี source export | data owner |
| N07 | Playwright regression ใน CI ด้วย stub tiles และ MapLibre ที่ pin | frontend |
| N08 | ป้ายพื้นที่เป็น symbol layer ของ MapLibre ที่มี collision ในตัว | frontend |
| N09 | ขยายความครอบคลุมเกิน 7 จังหวัดเมื่อแหล่งข้อมูลครอบคลุม; ระหว่างนั้นคง no_data | data owner |
| N10 | ตารางข้อมูลรายพื้นที่และ answer blocks สำหรับ Search/LLM ตาม PB v6 channel readiness | product |
| N11 | มือถือขณะเปิดแผงข้อมูล: แสดง attribution แบบย่อเหนือแผง (ตอนนี้อยู่ใต้แผงจนกด “กลับไปแผนที่”) | frontend |
