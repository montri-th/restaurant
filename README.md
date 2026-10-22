# CityMETER: Restaurants

**ร้านอาหารแน่นที่สุดอยู่ตรงไหน และเป็นร้านแบบไหน** — เดโมแผนที่ 3 มิติของชุดข้อมูล Restaurants ของ CityMETER ที่อ่านร้านอาหาร 70,214 ร้านใน 7 จังหวัดเป็นความหนาแน่นระดับแขวง/ตำบล พร้อมประเภทร้าน ระดับราคา เครือร้าน และที่มาของทุกตัวเลข

- เว็บ: https://montri-th.github.io/restaurant/
- ระบบจริงของ CityMETER: https://landometer.com/v3/citymeter?d=restaurant
- รุ่น 0.1.1 · 22 ตุลาคม 2569 (0.1 + แก้จากการตรวจบนเว็บจริงวันเดียวกัน) · ข้อมูลดึงและตรวจ 22 ตุลาคม 2569

ข้อค้นพบแรก (snapshot ปัจจุบัน ไม่กรอง): **99.7 ร้าน/ตร.กม. ใน 3 แขวงที่แน่นที่สุด — สี่แยกมหานาค ตลาดน้อย สุริยวงศ์** เทียบ 18.0 ร้าน/ตร.กม. ของทั้งพื้นที่ที่มีข้อมูล (308 แขวง/ตำบล) จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย 30 ร้าน

> ชุดข้อมูล CityMETER Restaurants · แหล่ง CityMETER Restaurants API สาธารณะ · ดึงข้อมูล 22 ต.ค. 2569 · ขอบเขต แขวง/ตำบลของ CityMETER ใน 7 จังหวัด — ไม่ใช่สำมะโนร้านอาหาร คะแนนและรีวิวเป็นตัวชี้ความนิยมตามแหล่งข้อมูล ไม่ใช่ยอดขาย

## ใช้งาน

```sh
npm start   # http://127.0.0.1:4173/
npm test    # unit tests บนข้อมูลจริง (node --test)
```

เป็น static site ไม่มี build step และไม่ต้อง `npm install` (Node ≥ 20 สำหรับ tests, Python 3 สำหรับ server) แผนที่โหลด MapLibre GL 5.6.2 จาก unpkg และ tiles/glyphs จาก OpenFreeMap; basemap สร้างเองใน `js/map-style.js` กราฟไม่ใช้ไลบรารีภายนอก ถ้าแผนที่โหลดไม่ได้ ข้อค้นพบ แผง กราฟ และตารางยังใช้ได้ การเปิด `index.html` เป็นไฟล์จะพาไปเว็บสาธารณะ

## สิ่งที่สำรวจได้

- **ข้อค้นพบแรกแบบ 3 มิติ:** หน้าแรกโฟกัส 3 แขวง/ตำบลที่ร้านแน่นที่สุด (ร้าน/ตร.กม.) ส่วนอื่นของเมืองเป็นบริบทที่เงียบ — “ดูทุกพื้นที่” เปิดทุกพื้นที่เท่ากัน
- **เส้นทางพื้นที่แบบ production:** ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล ทุกระดับลิงก์ไปพื้นที่เดียวกันใน CityMETER (`/v3/citymeter/{จังหวัด}/D/{เขต}` · `/S/{แขวง}`)
- **สีพื้นที่:** ความหนาแน่น LDS `density.area` 5 ระดับเท่าช่วง (ช่วงตัวเลขในคำอธิบายแผนที่) · ลายทแยง = แหล่งข้อมูลไม่มีร้านในพื้นที่ (ไม่ใช่ศูนย์) · เมื่อซูมออกทั้งประเทศ จังหวัดที่มีข้อมูลมีกรอบและจำนวนร้าน
- **ร้าน:** 1 สัญลักษณ์ = 1 ร้าน สีและรูปทรงตามประเภทร้าน (LDS series พร้อมรูปทรงประจำ) ร้านนอกโฟกัสเป็นจุดสีเทา ซูมใกล้จะเห็นโลโก้เครือร้านและเลือกร้านด้วยเมาส์หรือคีย์บอร์ดได้
- **โปรไฟล์:** แขวง/ตำบลและเขต/อำเภอ (ร้าน ร้าน/ตร.กม. รีวิว คะแนนเฉลี่ย ประเภท ราคา รีวิวมากที่สุด เครือร้าน สถานที่ที่ชื่อร้านอ้างถึง) · ร้าน (คะแนน ราคา เครือ สถานที่ พิกัดแสดงผลและความแม่น ที่มา)
- **สถานที่:** ร้านที่ชื่ออ้างถึงศูนย์การค้าหรือสถานที่ 25 แห่งมีอาคาร 3 มิติสีน้ำเงินที่มองเห็นเสมอ (venue x-ray) และ “มุมสถาปนิก”
- **กราฟและตาราง:** ความหนาแน่น · ประเภทร้าน (matrix ช่องเท่ากัน) · ระดับราคา (เฉพาะร้านที่ระบุราคา) · ตารางร้านเรียงตามรีวิว
- **ตัวกรอง:** ค้นหา · ประเภทร้าน · ระดับราคา · จังหวัด · เครือร้าน — ทุกสถานะอยู่ใน URL (`search`, `group`, `price`, `province`, `brand`, `district`, `area`, `areas`, `view`, `store`, `place`, `view3d`, `cam`)
- **ธีม:** Auto / Light / Dark — สีข้อมูลเป็น HEX เดียวกันทั้งสองธีมตาม LDS 0.9.7

## Data and method

- หนึ่งแถว = หนึ่ง observation ของร้านใน overlay สาธารณะของ CityMETER (`data/restaurants.json`, 70,214 แถว) ตรวจกับการดึงใหม่จาก API ตรงกันทุกแถวทุก field
- ความเป็นสมาชิกพื้นที่คือรหัสแขวง/ตำบลของต้นทาง ความหนาแน่น = ร้าน ÷ ตร.กม. ของ production
- พิกัดเป็นตำแหน่งแสดงผล (MVT z10, กริด 9.55 ม.) ไม่ใช่ทางเข้าร้าน
- เครือร้าน (167) และสถานที่ (1,016) จับคู่จากชื่อร้าน — ไม่ได้ยืนยันความเป็นสาขาหรือที่ตั้งภายใน
- รายละเอียด: [DATA_METHOD.md](DATA_METHOD.md) · [docs/AREA_METHOD.md](docs/AREA_METHOD.md) · [docs/CHART_SELECTION.md](docs/CHART_SELECTION.md) · [docs/BUILD_CARD.md](docs/BUILD_CARD.md) · Product Statement: [PRODUCT_STATEMENT.md](PRODUCT_STATEMENT.md)

## โครงสร้าง

```
index.html            หน้าเดียว (header, map, chart tray, table, reading panel, help)
styles.css            layout + panel + map chrome + charts (ใช้ token จาก assets/theme.css)
navigation.css        ไอคอน nav-7, help dialog
logos.css             กล่องโลโก้เครือร้าน + สี series ของประเภทร้าน
assets/theme.css      ค่า LDS 0.9.7 ที่ใช้ (foundation, map roles, dataState, series 1–10, count 5 ระดับ, basemap tokens)
js/app.js             ประกอบทุกส่วน: selection, URL, panel modes, camera, map click
js/model.js           ถอดข้อมูล, ตัวกรอง, สรุป, ลิงก์ production
js/areas.js           index ของแขวง/ตำบล เขต/อำเภอ จังหวัด
js/area-insight.js    ข้อค้นพบแรก (3 พื้นที่แน่นที่สุด)
js/scales.js          LUT 41 ค่าของ density.area / count / price + การจัดระดับและ EVID-05
js/cues.js            ประเภทร้าน → LDS series + รูปทรงประจำ series
js/map-layers.js      choropleth แขวง/ตำบล + ป้ายบนแผนที่
js/provinces.js       กรอบจังหวัดในมุมมองประเทศ
js/pins.js            สัญลักษณ์ร้าน, จุดบริบท, หมุด HTML ที่ซูมใกล้, โลโก้
js/buildings.js · js/venue-xray.js · js/massing.js · js/geometry.js · js/mvt.js · js/map-style.js · js/camera.js
                      อาคารของสถานที่, x-ray, มวลอาคารเมือง, basemap, กล้อง (ใช้ร่วมกับ Luxury Brands)
js/profile-model.js · js/panel.js · js/chart-model.js · js/charts.js · js/breadcrumb.js
data/                 restaurants.json, areas/districts/provinces.geojson, boundary-receipts.json, logo registries, venue-buildings.geojson
scripts/              build-boundaries.py, build-data.py, build-handoff.mjs, verify-live.mjs, build-pictogram-font.py
tests/                node --test บนข้อมูลจริง
handoff/              Product Brief, Implementation Plan, Verification, JSON + schema
```

## Assets and verification

- สีทุกค่าตรง LDS 0.9.7 (`v0.9.7-owner.1`, `color-srgb-10`, SHA-256 `d3085cbc…96`) — ตรวจ 72 รายการ (LUT 41 ค่า × 3 families × 2 ธีม, classes 3/5/7/9, scaleVersion, series 1–10, foundation, map roles, dataState) บันทึกใน [handoff/VERIFICATION.md](handoff/VERIFICATION.md)
- ฟอนต์และไอคอนจาก LDS build kit (`assets/lds/build-kit/`), ไอคอน nav-7 และ pictogram 8 ตัว (Apache-2.0)
- โลโก้เครือ 155 และสถานที่ 157 ไฟล์ คงไบต์เดิม ตรวจ SHA-256 ทุกไฟล์ (`tests/logos.test.js`) — โลโก้เป็นของเจ้าของเครื่องหมายการค้า การรวบรวมไม่ใช่การได้รับอนุญาต
- ขอบเขตจาก CityMETER production (ใบรับ 581 ใบใน `data/boundary-receipts.json`); อาคาร © OpenStreetMap contributors (ODbL 1.0); basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap
- `npm run handoff:manifest` สร้าง hash ของทุกไฟล์ · `npm run verify:live` เทียบไบต์บนเว็บจริงกับ manifest

ส่งต่อให้ developer หรือ coding agent: เริ่มที่ [handoff/README.md](handoff/README.md) และอ่าน [AGENTS.md](AGENTS.md) ก่อนแก้ไข
