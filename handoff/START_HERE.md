# CityMETER Restaurants — Developer Handoff

รุ่นเผยแพร่ 0.12.0 · 9 พ.ย. 2569 (ทะเบียนร้านเครืออ่านชีต 9 พ.ย. · Land join 9 พ.ย.) · ก่อนหน้า 0.8.0 · 3 พ.ย. 2569 · ร้านดึงและตรวจ 22 ต.ค. 2569 · ทะเบียนร้านเครือตรวจ 25–31 ต.ค. อ่านกลับเติมพิกัดและโลโก้ 30 ต.ค. · จัดกลุ่มร้าน 2 พ.ย. (ขึ้นเว็บเฉพาะขนาดเครือและช่วงราคา) · Land join 3 พ.ย. 2569 (รุ่นก่อน 0.7.1 · 30 ต.ค. 2569)

รุ่นนี้ (0.12.0 · 9 พ.ย. 2569): ทะเบียนร้านเครือฉบับอ่านชีต 9 พ.ย. (27,954 สาขา 982 เครือ 22,710 มีพิกัด; ชุดต้นทางและวันที่ใน `data/release.json`) ประชากร 96,934 ข้อค้นพบแรก สีลม · ตลาดยอด · สุริยวงศ์ 172.0 ร้าน/ตร.กม. ฐานเทียบ 9.9 (476 กรอบ) · ระบบตรวจทะเบียนทุกคืนเปิด draft pull request (`AGENTS.md` “Register sync”, `DATA_METHOD.md` §11.1) · ก่อนหน้า (0.8.0): ฉบับ 3 พ.ย. 27,527 สาขา 22,547 มีพิกัด ประชากร 96,507 ข้อค้นพบแรก 169.4 · ช่วงราคา 6 ระดับจากราคาที่แหล่งระบุ และขนาดเครือ 5 ระดับ (จำนวนแถวตามแหล่งข้อมูล ไม่ใช่คำตัดสิน) · ประเภทอาหาร รูปแบบร้าน โอกาส ป้ายพิเศษ ราคาที่อนุมาน และมุมมองคู่แข่งยังไม่ขึ้นเว็บจนกว่าจะผ่านการสุ่มตรวจ 1,550 แถว

เริ่มอ่าน `source/handoff/README.md` จากนั้น Product Statement (`source/PRODUCT_STATEMENT.md` + `source/handoff/product-statement.json`), Product Brief และ Implementation Plan ในโฟลเดอร์ `source/handoff` ทั้ง `.md` และ `.json` ใช้คู่กัน

เข้าโฟลเดอร์ `source` แล้วรัน `npm test` และ `npm start` เปิด http://127.0.0.1:4173/

ชุดนี้มี source code (ES modules มีคอมเมนต์สัญญาทุกโมดูล), datasets, assets ที่ตรวจ hash แล้ว, unit tests บนข้อมูลจริง, JSON Schema 1.5.0, acceptance criteria AC01–AC58, สคริปต์สร้างข้อมูล/ขอบเขต/manifest/bundle และตรวจ live bytes อ่าน `source/AGENTS.md` ก่อนแก้ไข

เว็บจริง: https://montri-th.github.io/restaurant/
Repository: https://github.com/montri-th/restaurant

`RELEASE_RECEIPT.json` ผูกชุดส่งต่อกับ commit ผล GitHub Pages และ live attestation ส่วน `evidence/` เป็นหลักฐานหน้าจอและผลเทียบ hash ของไฟล์บนเว็บ แยกจาก source ที่ commit แล้ว
