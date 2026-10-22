# Verification record — release 0.1 (2026-10-22)

ผลตรวจแยกตามระดับ ผลในเครื่องไม่ใช่หลักฐานแทนเว็บจริง ส่วน “Live” บันทึกหลังเผยแพร่บน GitHub Pages

## 1. Data reproduction (Observed fact)

ดึง overlay ของ CityMETER Restaurants API สาธารณะใหม่ทั้งชุด (22 ต.ค. 2569: 399 point-tile requests, 154 province requests, 78 area requests — ทุกคำขอ HTTP 200; 94,428 feature views → 70,214 owning-tile observations หลังตัด 24,214 มุมมองซ้ำ) แล้วเทียบกับ `data/restaurants.json` ที่สร้างจากชีตวิจัย:

| รายการ | ผล |
|---|---|
| คีย์ observation ตรงกัน | 70,214 / 70,214 |
| ความต่างของ field (ชื่อ, primary type, ราคาเริ่ม/สิ้นสุด, ระดับราคา, คะแนน, จำนวนรีวิว, รหัสแขวง/ตำบล, พิกัดแสดงผล ≤ 5×10⁻⁷°) | 0 ทุก field |
| ความต่างพิกัดสูงสุด | 0° |
| นับต่อแขวง/ตำบล (7,436) และจังหวัด (77) เทียบ aggregate ของ API | ตรงทั้งหมด (ผลของชุดตรวจต้นทาง) |

## 2. Automated (unit) — `npm test`

63/63 ผ่าน (node --test, Node 22) บนข้อมูลจริงใน repository:

- `tests/data.test.js` (7): 70,214 แถวไม่หลุด คีย์ไม่ซ้ำ; ตรง `meta.rowsByProvince`, `meta.priceBuckets`, รีวิวรวม 6,185,635, แถวมีคะแนน 53,703, มีราคา 19,999; ทุกแถวอยู่ในแขวง/ตำบลของเขตและจังหวัดตัวเอง; สูตรถอดพิกัดตรงตัวถอดของงานวิจัย; เครือ/สถานที่เป็น candidate, 3 holds ไม่มีโลโก้, 25 สถานที่มีอาคาร; ขอบเขต 581/90/7 + hash ชุดใบรับ; ความครอบคลุม 308/273
- `tests/insight.test.js` (6): snapshot ข้อค้นพบแรก (100204/101303/100403, 136 ร้าน, 99.7, ฐานเทียบ), Σ/Σ, โหมดจำนวนสำหรับการเลือกเล็ก, missing ≠ 0, สถานะ EVID-05 ของ choropleth (no_data 273, measured_zero เมื่อกรอง, กทม. 180 แขวงมีข้อมูลทุกแขวง), จังหวัดใช้ count
- `tests/scales.test.js` (7): LUT 41 ค่า anchors 0/20/40, classes 3/5/7/9, ไม่มี override ฝั่ง dark, การจัดระดับ density (ทศนิยมตามขนาด), count, ราคา, ink contrast
- `tests/views.test.js` (6): provenance ในทุกมุมมอง, missing ในหน้าร้าน, กราฟ (ผลรวม matrix, สัดส่วนราคา), breadcrumb + ลิงก์ /D/ /S/, รูปทรงประจำกลุ่ม, filter chips escape
- `tests/logos.test.js` (5): โลโก้ 155 + 157 ไฟล์ตรง sha256/ขนาด/ชนิด, ค้นด้วย id เท่านั้น, holds ไม่มีโลโก้, role caption, ไม่มีไฟล์นอก registry
- tests ที่ใช้ร่วมกับ Luxury Brands (32): geometry, massing, mvt, map-style + camera, pins (การวางหมุดและโลโก้), venue x-ray

## 3. LDS 0.9.7 parity (script, ไม่ ship)

เทียบกับ machine records ใน `Landometer-Design-System-v0.9.7.md` (Project source, 1,142,051 bytes, SHA-256 `d3085cbc0a50195f1cbf0c77b1d77c0d19b84364daf2948eb367348d65432d96` ตรงตามที่ owner amendment ระบุ): **72/72 ผ่าน**

- `density.area`, `count`, `price` × light/dark: LUT 41 ค่าตรง `js/scales.js`, classes 3/5/7/9 = LUT[round(i·40/(n−1))], scaleVersion ตรง
- `machine.tokens.dataState` noData/zero light+dark = `--data-no-data` / `--data-zero-outline`
- categorical `landometer-series-10-v8` series 01–10 fill/ink light+dark = `assets/theme.css`; ลำดับรูปทรงใน `js/cues.js` = ลำดับ cue ของ LDS
- foundation (surface, text, border) และ map roles light+dark = `assets/theme.css`
- `--scale-count-1..5` = count classes[5]; ไม่มี analytical token ถูก override ใต้ dark

**ความต่างที่พบในเอกสาร LDS (รายงาน ไม่เลือกข้างเงียบ ๆ):** analytical scale records ระบุ dark `noData #3B4849` / `zeroOutline #BAC6C0` ขณะที่ `machine.tokens.dataState` ระบุ dark `#404844` / `#93A398` และ EVID-05 treatments อ้าง `dataState` — เดโมใช้ `dataState` ตาม treatment

## 4. Rendered harness (Playwright, Chromium 141 + SwiftShader)

MapLibre 5.6.2 จาก npm package (เวอร์ชันเดียวกับที่ pin), TileJSON ของ OpenFreeMap ถูก stub ด้วย tiles ว่าง (basemap และมวลอาคารเมืองไม่แสดงใน harness — ภาพจริงตรวจใน §5) ทุกชั้นที่ผลิตภัณฑ์วาดเอง (แขวง/ตำบล, จังหวัด, สัญลักษณ์, ป้าย, อาคารสถานที่, x-ray, แผง, กราฟ, ตาราง) render จริง

24 สถานการณ์ — 1440×900, 1180×760 และ 390×844 (DPR 2), light/dark: overview, country (zoom 7.2), แขวง, เขต (dark), ร้าน, สถานที่ (desktop + mobile dark), ร้านในสถานที่ (dark), สลับธีม, ปิด 3D, URL `?store=`, ค้นหา, back ×2, กราฟสามมุมมอง, ตาราง, `?province=NBI`, `?brand=RBR-kfc`, mobile sheet, detail zoom 16.6

| ผล | ค่า |
|---|---|
| launch state | ready ทุกสถานการณ์ (≈ 0.7–1.0 วินาทีบน localhost) |
| console error / warning | 0 |
| horizontal overflow | ไม่มี (รวม 390 px) |
| ภาพแรก | preset city pitch 56, โฟกัส 100204/101303/100403, ป้าย 10 (desktop) / 3 (มือถือ) |
| แขวง / ร้าน | model pitch 60 zoom ≈ 16.1–16.5, หมุด HTML 24–33 ตัว, โลโก้ |
| สถานที่ | eye pitch 75 zoom ≈ 17.5, อาคารสีน้ำเงิน + โลโก้เครือ; มือถือที่ sheet เปิดใช้ plan |
| ประเทศ | กรอบ 7 จังหวัด สี count, legend เปลี่ยนเป็นจำนวนร้านต่อจังหวัด |

พบและแก้ระหว่างรอบนี้: expression ของ `province-selected` (zoom ใน `*`), ปุ่มมุมสถาปนิกที่ disabled แต่ดูเหมือนเปิด, การส่งจุดบริบท 70k จุดพร้อมกับ fills (หน่วงจุดบริบทครั้งแรก), ป้ายนอกโฟกัสหนักเกิน (ชิปอ่อน + จำกัดจำนวน), legend ชิดกัน, การจัดระดับความหนาแน่นสำหรับค่าน้อย, ตาราง/ตัวนับระดับสถานที่, ค้นหาแล้วแผนที่ไม่ตามผล, แท่งความหนาแน่นของการเลือกเล็ก

## 5. Live checks

บันทึกหลังเผยแพร่ (ดูส่วนถัดไปเมื่อ release เสร็จ)
