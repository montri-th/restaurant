# Implementation Plan — CityMETER · Restaurants 0.6

รุ่น 0.6.0 · 28 ตุลาคม 2569 · คู่กับ [implementation-plan.json](implementation-plan.json) (schema 1.5.0)

> **รุ่น 0.4.0 (P14, AC36–AC39):** อาคาร Land = รูปอาคาร OpenStreetMap จาก tile OpenFreeMap หลังเดียวกับที่แผนที่วาด (`scripts/build-land.py --osm`; ไม่มี footprint V4; ทะเบียนใช้เลือกหลังและใส่ส่วนอาคาร LOD2) · massing ซ่อนรูปคู่แฝดของตึก Land ด้วยจุดภายใน (`js/massing.js#ringsOverlap`) และคงตึกที่ซ้อนในขอบ LOD1 (`keepNested`) · จุดห่างขอบ ≤ 10 ม. นับเป็นในอาคารและวาดในอาคาร (`land.json → snaps`, `js/land.js#applyRowDisplay/applyOutletDisplay`) · บรรทัดแหล่งข้อมูลบรรทัดเดียวต่อหน้า (`REGISTER_RULE`, `LAND_RULE`) · layout กระชับ: มือถือ header 40 px ชิปมี pictogram แผงครึ่งจอขยายได้ (`#expand-mobile-panel`) ส่วนหัวผลิตภัณฑ์และช่องค้นหาเฉพาะภาพรวม attribution พับหลังปุ่ม (i) หมุดสาขาเงียบเล็กลงที่ซูมเมือง (`js/register-layer.js` SIZE/OPACITY)

> **รุ่น 0.6.0 (P16, AC42–AC44; เจ้าของสั่ง 28 ต.ค. 2569 22:36):** ประชากรเดียว — สาขาในทะเบียนร้านเครือ 26,819 รายการเป็นแถวของกลุ่ม “สาขาร้านเครือ” นับรวมกับร้านชีต 1 68,980 แถว = 95,799 ในทุกตัวเลขร้าน (`js/model.js#outletRows`, `#brandKey`; `js/app.js#init` รวมแถว, `scopeRestaurants`/`scopeOutlets`; `js/area-insight.js` ฐานเทียบจากแถวที่มีกรอบ; `js/panel.js` บรรทัด “ร้าน = N + M”, รายชื่อ 77 จังหวัด + “ไม่ทราบจังหวัด”, ข้อค้นพบสำหรับจังหวัดนอกความครอบคลุม; `js/register-panel.js` tile ร้านในอาคารรวม) · แถวที่ย้าย 1,234 แถวนับครั้งเดียวฝั่งทะเบียน · มุมมองทั้งประเทศมีกรอบ จำนวน ป้าย ทั้ง 77 จังหวัด (`data/provinces.geojson` 77 กรอบ จาก `scripts/build-provinces.py` + ใบรับ PROVINCE 70 ใบ) · จังหวัดนอกชุดข้อมูลร้าน: หมุดทุกระดับซูม (`registerSelection().scoped`), กล้องจับกรอบจังหวัด (`fitMap` → `provinceBounds`), คำอธิบาย “{จังหวัด} · สาขาในทะเบียน”, ไม่มีรายการ Land · tile รีวิว/คะแนนแสดง — เมื่อไม่มีแถวใดมีค่า · ข้อค้นพบแรกบนประชากร: สุริยวงศ์ · สีลม · วังใหม่ 122.0 ร้าน/ตร.กม. ฐานเทียบ 9.37 (475 กรอบ) · แทนกติกา 0.3 “ไม่บวกกับ snapshot” เฉพาะการนับและแสดงผล (บันทึกเป็นคำตัดสินเจ้าของใน AGENTS.md)
>
> **รุ่น 0.5.0 (P15, AC40–AC41; AC39 ขยายความ):** อาคารที่เลือก/โฟกัสทุกแบบใช้กล้อง 2-point perspective เสมอ ส่งเข้า x-ray และฉากบังของ massing (`js/app.js#buildingFocus`, `#focusBuildingFeatures`, `#focusTargets`, `#frameVenue` — มือถือจัดกลางเหนือแผงครึ่งจอ) กดตึก x-ray ของร้าน/สาขาเปิด host ใน Land · แผงอาคาร Land รายการเดียว “ร้านและสาขาในอาคาร” (`js/register-panel.js#inBuildingRows`) · คำอธิบายหมุดบนมือถือวัดขอบแผงจากตัวแผงเอง (`js/app.js#measureSheet`: transitionend + ResizeObserver ไม่ใช่ตัวจับเวลา) หลังพบบนเว็บจริงใน built-in browser ว่าลิงก์ลึกที่โหลดช้าทำให้คำอธิบายอยู่ใต้แผง และกฎซ่อนคำอธิบายเมื่อขยายแผงต้องชนะกฎ detail zoom (`styles.css`) · 0.4.1 แก้ตามผู้ตรวจอิสระ — จุดที่รวบเข้าอาคารบอกระยะจากขอบ ความครอบคลุมของอาคาร Land บอกบนหน้าจอ ตารางพิมพ์พิกัดต้นทาง caveat ครั้งเดียวต่อหน้า
>
> **รุ่น 0.3.4:** มือถือแสดงคำอธิบายหมุดสาขาร้านเครือทุกครั้งที่หมุดอยู่บนแผนที่
>
> **รุ่น 0.3.3 (P13, AC35):** สาขาเป็นรูปหมุด (ไม่ซ้ำรูปทรงของประเภทร้าน) · ข้อมูลทะเบียน/Land ในหน้าร้านมีวันที่ · ถาดกราฟบอกแหล่งและวันที่ · แถบปุ่มบนมือถือมีขอบจางบอกว่าเลื่อนได้
>
> **รุ่น 0.3.2 (P13, AC35):** จุดสาขาร้านเครือเป็นรูปหมุด (นอกชุดรูปทรงของประเภทร้าน) · ปุ่ม “ร้านเครือ” บนแผนที่ซ่อน/แสดงจุดสาขาทุกสาขา (`?rdots=0`) · มุมมองทะเบียนให้ชุดร้านเป็นบริบทเงียบ ไม่มีป้ายตัวเลขจังหวัดทับสาขา และแถบสถานะบอกขอบเขตของแต่ละหน่วย · หัวข้อเครือ/สถานที่ของชุดร้านนับยอดรวมจริง
>
> **รุ่น 0.3.1 (P13, AC29 ปรับ, AC32–AC34):** ร้าน 7 จังหวัดกับสาขาร้านเครืออยู่บนแผนที่เดียวกัน ไม่มี tab แยกชุดข้อมูล · มุมมองเครือ/สาขามีตึก 3 มิติ (แขวงใต้กลางจอเมื่อซูม ≥ 13.5 · สาขาเปิดพร้อมอาคาร Land) · ตัวเลขเป็นยอดรวมจริงพร้อม “แสดง n จาก N” · ส่วนทะเบียน/Land มีแหล่งและวันที่ของตัวเอง · ทะเบียนจุดขายหลายแบรนด์ไม่นับเป็นเครือ · ร้อยละเฉพาะคอลัมน์ ≥ 30 ร้าน
>
> **รุ่น 0.3 (P12, AC28–AC31):** โมดูลใหม่ `js/register.js` · `js/register-layer.js` · `js/register-panel.js` · `js/land.js` และสคริปต์ `scripts/build-chains.py` · `scripts/build-land.py` · `scripts/xlsx-dump.py`; ข้อมูลใหม่ `data/chains.json` · `data/land.json` · `data/land-buildings.geojson` โหลดหลังภาพแรก (`loadExtras` ใน `js/app.js`); panel modes เพิ่ม land · chains · chain · company · outlet; URL `?chains=1&rq=…` `?chain` `?company` `?outlet` `?land`; ลำดับสร้างข้อมูล build-data → build-chains → build-land (DATA_METHOD §11); backlog ใหม่ N15–N17 · อ่าน [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) ก่อน

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
| `js/app.js` | ประกอบทั้งหมด: row scopes, focus modes, coverage ตามจังหวัด/เขต, panel modes + back stack, URL, map lifecycle + reinstall เมื่อเปลี่ยนธีม, camera, ลำดับการคลิกแผนที่ (x-ray → อาคารของสถานที่ → หมุด → อาคารในโฟกัส → จังหวัด → แขวงทุกซูม), hover, ป้ายพื้นที่บนจอ (`refreshLabelView`), join อาคารและสีอาคารของสถานที่ (`refreshJoin`/`applyJoin`), legend ตาม zoom, ตัวนับ/ตาราง |
| `js/building-join.js` | จับจุดแสดงผลกับขอบอาคารที่วาด (ขอบเล็กสุดที่มีจุด), อาคารของสถานที่ (ข้อมูลอาคาร หรือ ≥ max(1, 20 %) ของจุด), ผลการกดอาคาร, ร้านอื่นในอาคารของสถานที่, พื้นที่โฟกัสรอบสถานที่ |
| `js/model.js` | ถอดข้อมูล (กริด → lon/lat), PROVINCES, ราคา, GROUP_SHORT, filterRows, summarize, mixOf, productionLink |
| `js/areas.js` | index แขวง/ตำบล เขต/อำเภอ จังหวัด, คำระดับ, summarizeAreas/Districts, combinedDensity, `areaLocator` (วางป้ายเท่านั้น ไม่ใช่สมาชิก) |
| `js/area-insight.js` | ข้อค้นพบแรก + filterAreaRows |
| `js/scales.js` | LUT density.area / count / price, การจัดระดับ, EVID-05, ink |
| `js/cues.js` | กลุ่มประเภท → series + รูปทรง, SVG และ icon แผนที่ |
| `js/map-layers.js` | choropleth แขวง/ตำบล, `area-hit` (เป้ากดทุกซูม) + เส้น hover, hatch, เส้นเขต, ป้าย HTML (วัดขนาดครั้งเดียว) |
| `js/provinces.js` | กรอบจังหวัด (count) |
| `js/pins.js` | symbol layer บนจุดบริบทของทั้ง selection (ส่งเมื่อเปลี่ยนตัวกรอง ไม่รับการกด), หมุด HTML, โลโก้; หมุดเกาะแผนที่ระหว่างกล้องเคลื่อนแล้วจัดใหม่เมื่อหยุด |
| `js/buildings.js` | อาคารของสถานที่ (ข้อมูลอาคาร): ระดับสถานที่ = สถานที่นั้น · มุมมองพื้นที่ = ทุกสถานที่ที่ร้านในโฟกัสอ้างถึง, hitTest |
| `js/massing.js` | มวลอาคาร quiet/focus จาก OpenFreeMap + id คงที่ต่อหลัง (`focusFeatureId`), ขอบเดิมสำหรับ join, ชั้นสีอาคารของสถานที่ (`focus-massing-venue`), hitTest; คำนวณรูปทรงหลังกล้องหยุด |
| `js/venue-xray.js`, `js/geometry.js`, `js/mvt.js`, `js/map-style.js`, `js/camera.js` | x-ray, เรขาคณิต, ถอด MVT, basemap, กล้อง (จาก Luxury Brands 0.5 ไม่เปลี่ยนตรรกะ) |
| `js/breadcrumb.js` | breadcrumb + ลิงก์ production |
| `js/profile-model.js`, `js/panel.js` | view models + HTML ของแผง (รวมแผงอาคาร วิธีจับคู่สถานที่ และร้านอื่นที่จุดตกในอาคารเดียวกัน) + provenance |
| `js/chart-model.js`, `js/charts.js` | กราฟ HTML ไม่มี vendor |
| `js/brand-logos.js`, `js/venue-logos.js` | registry โลโก้ |
| `js/navigation.js`, `js/launch.js`, `js/vendors.js` | ไอคอน/help, launch overlay, MapLibre loader |
| `scripts/build-boundaries.py` | ขอบเขตจาก production + ใบรับ |
| `scripts/build-data.py` | ข้อมูล โลโก้ อาคาร จากชีตวิจัยและ manifest + สถานที่จากท้ายชื่อร้าน (`suffix_venue_rules`) |

## 3. Selection

ตัวกรอง: `search` `group` `price` `province` `brand` · URL: + `district` `area` `areas` `view` `store` `place` `view3d` `cam` · Row scopes: scopeRows → baseRows → rows (+ ร้านของสถานที่, ร้านในอาคาร) · Panel actions: `select-area` `select-district` `select-store` `select-venue` `select-building` `select-province` `filter-brand` `back` `explore-top` `clear-focus` `open-charts` `open-table` `clear-filter` `crumb-*` `toggle-3d`

## 4. งาน (ทำแล้วในรุ่น 0.1, 0.1.1, 0.2.0 และ 0.2.1)

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
| P11 | 0.2: สถานที่จากท้ายชื่อร้าน, จับจุดกับอาคารและกดอาคาร, ย้ายไปแขวงข้าง ๆ และกล้องลื่น (เจ้าของสั่ง 23 ต.ค. 2569) | P10 | AC25, AC26, AC27, AC22 |

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
| AC25 | สถานที่จากท้ายชื่อร้าน | “KFC Gateway Bangsue” → Gateway Bangsue; Charn At The Avenue เป็นสถานที่จากชื่อร้าน 14 ร้าน ทุกจุดอยู่ในรัศมี 200 ม.; “… หน้าโลตัสศรีนครินทร์” และ “… Behind Central Bangna” ไม่มีสถานที่; แผงร้าน/สถานที่บอกวิธีจับคู่ | unit + browser |
| AC26 | อาคาร | ในพื้นที่ที่โฟกัส อาคารของสถานที่เป็นสีน้ำเงิน กดแล้วเปิดสถานที่; อาคารที่มีจุดเดียวเปิดร้าน หลายจุดเปิดแผง “ร้านที่จุดตกในอาคารนี้”; แผงสถานที่แยก “ร้านอื่นที่จุดตกในอาคารเดียวกัน”; ไม่มีข้อความ “ตั้งอยู่ใน” | unit + harness + live |
| AC27 | ย้ายไปพื้นที่ข้าง ๆ | เมื่อเปิดพื้นที่ (3D หรือ 2D ทุกซูม) กดแขวง/ตำบลถัดไปหรือป้ายของมัน (มีป้ายทุกพื้นที่บนจอ) แล้วย้ายไปในการเคลื่อนกล้องครั้งเดียว; กดจุดบริบทสีเทาแล้วไปพื้นที่นั้น (ไม่เปิดร้าน); กดในพื้นที่ที่เลือกอยู่แล้วไม่เปลี่ยนอะไร | harness + live |

## 6. วิธีทำงานต่อ

1. อ่าน AGENTS.md แล้ว handoff/README.md, PRODUCT_STATEMENT.md และ brief คู่ md/json
2. `npm test` ก่อนแก้; คง row scopes, focus modes, metric/coverage contracts และ panel actions
3. แก้ทีละงาน คง INV01–INV26
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
| N12 | แผงอาคารใน URL (ต้องมี key อาคารที่คงที่จากแหล่งขอบอาคารที่เจ้าของอนุมัติ — id ของ OSM tile เป็นรายแผ่น) | frontend + data |
| N13 | เทียบผล join กับขอบอาคารของ CityMETER production (building/detailMvt) และพิกัดต้นทางเมื่อมี N02 รายงานสัดส่วนจุดต่อประเภทอาคาร | data |
| N14 | ตรวจสถานที่จากชื่อร้าน (RX-…) และคำสะกดต่างของชื่อสถานที่ (เช่น เกตเวย์ / เกทเวย์) แล้วยกสถานที่และชื่อเรียกที่ยืนยันแล้วเข้าชีตพร้อมหลักฐาน | research |
