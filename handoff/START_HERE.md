# CityMETER Restaurants — Developer Handoff

รุ่นเผยแพร่ 0.2.0 · 23 ต.ค. 2569 · ข้อมูลดึงและตรวจ 22 ต.ค. 2569

เริ่มอ่าน `source/handoff/README.md` จากนั้น Product Statement (`source/PRODUCT_STATEMENT.md` + `source/handoff/product-statement.json`), Product Brief และ Implementation Plan ในโฟลเดอร์ `source/handoff` ทั้ง `.md` และ `.json` ใช้คู่กัน

เข้าโฟลเดอร์ `source` แล้วรัน `npm test` และ `npm start` เปิด http://127.0.0.1:4173/

ชุดนี้มี source code (ES modules มีคอมเมนต์สัญญาทุกโมดูล), datasets, assets ที่ตรวจ hash แล้ว, unit tests บนข้อมูลจริง, JSON Schema 1.4.0, acceptance criteria AC01–AC27, สคริปต์สร้างข้อมูล/ขอบเขต/manifest/bundle และตรวจ live bytes อ่าน `source/AGENTS.md` ก่อนแก้ไข

เว็บจริง: https://montri-th.github.io/restaurant/
Repository: https://github.com/montri-th/restaurant

`RELEASE_RECEIPT.json` ผูกชุดส่งต่อกับ commit ผล GitHub Pages และ live attestation ส่วน `evidence/` เป็นหลักฐานหน้าจอและผลเทียบ hash ของไฟล์บนเว็บ แยกจาก source ที่ commit แล้ว
