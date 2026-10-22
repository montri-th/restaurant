import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_LOGOS,separatePins,placeBrandLogos,isSourceVisible} from '../js/pins.js';

const desktop={left:12,right:1012,top:78,bottom:658};
const repeated=(count,x=512,y=368)=>Array.from({length:count},(_,i)=>({id:`pos-${String(i).padStart(4,'0')}`,x,y}));
const markBox=p=>({left:p.x-p.spacing/2,right:p.x+p.spacing/2,top:p.y-p.spacing/2,bottom:p.y+p.spacing/2});
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function assertEveryPinPresent(input,output){
 assert.equal(output.length,input.length,'no visible observation may disappear or become an aggregate');
 assert.deepEqual(output.map(p=>p.id).sort(),input.map(p=>p.id).sort());
 assert.equal(new Set(output.map(p=>p.id)).size,input.length);
}
function assertLocalSlots(pins,bounds,maxOffset){
 for(const pin of pins){
  const box=markBox(pin);
  assert.ok(box.left>=bounds.left-1e-8&&box.right<=bounds.right+1e-8);
  assert.ok(box.top>=bounds.top-1e-8&&box.bottom<=bounds.bottom+1e-8);
  assert.ok(Math.hypot(pin.x-pin.anchorX,pin.y-pin.anchorY)<=maxOffset+1e-8,`${pin.id} must stay near its own source anchor`);
  for(const obstacle of bounds.exclusions||[])assert.equal(overlaps(box,obstacle),false);
 }
 for(let i=0;i<pins.length;i++)for(let j=i+1;j<pins.length;j++){
  const pitch=Math.min(pins[i].spacing,pins[j].spacing);
  assert.ok(Math.abs(pins[i].x-pins[j].x)+1e-8>=pitch||Math.abs(pins[i].y-pins[j].y)+1e-8>=pitch,
   `${pins[i].id} and ${pins[j].id} must remain separate local slots`);
 }
}
function assertClearLogos(points,logos,bounds,maxOffset){
 const ids=new Set(points.map(p=>p.id)),accepted=[];
 for(const [id,label]of logos){
  assert.ok(ids.has(id),'each optional logo belongs to one existing observation');
  const source=points.find(p=>p.id===id),box=label.box;
  assert.ok(Math.hypot(label.x-source.anchorX,label.y-source.anchorY)<=maxOffset+1e-8);
  assert.ok(box.left>=bounds.left&&box.right<=bounds.right&&box.top>=bounds.top&&box.bottom<=bounds.bottom);
  for(const previous of accepted)assert.equal(overlaps(box,previous),false,'logo rectangles must not overlap');
  for(const obstacle of bounds.exclusions||[])assert.equal(overlaps(box,obstacle),false,'logo must clear UI');
  for(const point of points.filter(p=>p.id!==id))assert.equal(overlaps(box,markBox(point)),false,'a logo must not conceal another observation mark');
  accepted.push(box);
 }
}
const logoPoint=(id,x,y,brandKey=id)=>({id,x,y,anchorX:x,anchorY:y,spacing:8,brandKey,hasLogo:true});

test('55 co-located observations retain separate identities within a local source-distance cap',()=>{
 const input=repeated(55),output=separatePins(input,desktop,8,{maxOffset:36,minSpacing:.5});
 assertEveryPinPresent(input,output);
 assertLocalSlots(output,desktop,36);
 assert.ok(output.every(p=>p.anchorX===512&&p.anchorY===368));
});

test('dense corner and narrow layouts reduce pitch without spreading across the viewport',()=>{
 const bounds={left:10,right:434,top:10,bottom:300,exclusions:[{left:180,right:190,top:150,bottom:250}]};
 for(const input of [repeated(562,200,220),repeated(55,11,11)]){
  const output=separatePins(input,bounds,8,{maxOffset:24,minSpacing:.125});
  assertEveryPinPresent(input,output);
  assertLocalSlots(output,bounds,24);
  assert.ok(output.every(p=>p.spacing<8));
 }
});

test('placement is deterministic and leaves frozen geographic evidence untouched',()=>{
 const input=Object.freeze(repeated(30,200,200).map(p=>Object.freeze({...p,longitude:100.54321,latitude:13.75432,geometryRole:'host_representative'})));
 const before=JSON.stringify(input),options={maxOffset:24,minSpacing:.5};
 const output=separatePins(input,desktop,8,options);
 assert.deepEqual(separatePins(input,desktop,8,options),output);
 assert.deepEqual(separatePins([...input].reverse(),desktop,8,options),output);
 assert.equal(JSON.stringify(input),before);
 for(const pin of output){assert.equal(pin.anchorX,200);assert.equal(pin.anchorY,200);assert.equal(pin.longitude,100.54321);assert.equal(pin.latitude,13.75432);assert.equal(pin.geometryRole,'host_representative');}
 assertEveryPinPresent(input,output);assertLocalSlots(output,desktop,24);
});

test('source anchors behind panels, UI or outside the usable map are not pulled into view',()=>{
 const bounds={left:5,right:995,top:5,bottom:400,exclusions:[{left:5,right:300,top:5,bottom:70}]};
 const source=[{id:'visible',x:400,y:200},{id:'under-chart',x:400,y:600},{id:'under-toolbar',x:100,y:40},{id:'off-map',x:-50,y:200}];
 const before=JSON.stringify(source),visible=source.filter(point=>isSourceVisible(point,bounds));
 assert.deepEqual(visible.map(p=>p.id),['visible']);
 const output=separatePins(visible,bounds,8,{maxOffset:24});
 assert.deepEqual(output.map(p=>p.id),['visible']);assert.equal(output[0].x,400);assert.equal(output[0].y,200);
 assert.equal(JSON.stringify(source),before);
 assert.throws(()=>separatePins([source[1]],bounds,8,{maxOffset:24,minSpacing:.5}),/too small for individual pins/);
});

test('250 and 251 sparse observations keep every mark while optional logos obey the 250 ceiling',()=>{
 const bounds={left:0,right:1800,top:0,bottom:1800};
 for(const count of [250,251]){
  const points=Array.from({length:count},(_,i)=>logoPoint(`pos-${i}`,100+(i%16)*100,100+Math.floor(i/16)*100));
  const before=JSON.stringify(points),logos=placeBrandLogos(points,bounds,{limit:999,areaFraction:1,maxOffset:50});
  assert.equal(MAX_LOGOS,250);assert.equal(logos.size,250);
  assert.equal(points.length-logos.size,count-250,'remaining observations use individual category marks');
  assertClearLogos(points,logos,bounds,50);assert.equal(JSON.stringify(points),before);
 }
});

test('diverse canonical brands get a turn before repeated branches and try alternate representatives',()=>{
 const bounds={left:0,right:1000,top:0,bottom:1000,exclusions:[{left:10,right:80,top:10,bottom:50}]};
 // The selected first representative has no legal label slot; its source itself remains unobscured.
 const points=[logoPoint('blocked-a',5,5,'canonical-a'),logoPoint('alternate-a',500,500,'canonical-a'),
  logoPoint('repeat-a',600,500,'canonical-a'),logoPoint('only-b',700,500,'canonical-b')];
 assert.equal(isSourceVisible(points[0],bounds),true);
 const logos=placeBrandLogos(points,bounds,{limit:2,areaFraction:1,maxOffset:50,selectedId:'blocked-a'});
 assert.deepEqual([...logos.keys()],['alternate-a','only-b']);
 assertClearLogos(points,logos,bounds,50);
});

test('logos clear every other point and UI, and measure their offset from the original anchor',()=>{
 const bounds={left:0,right:1000,top:0,bottom:700,exclusions:[{left:350,right:650,top:250,bottom:290}]};
 const points=[...separatePins(repeated(55,500,350),bounds,8,{maxOffset:36}).map((p,i)=>({...p,brandKey:`brand-${i}`,hasLogo:true})),
  {...logoPoint('selected',750,450),x:725,y:450}];
 const before=JSON.stringify(points),logos=placeBrandLogos(points,bounds,{areaFraction:1,maxOffset:50,selectedId:'selected'});
 assert.ok(logos.has('selected'),'a selected record gets priority when a legal logo slot exists');
 assert.ok(logos.size<points.length,'dense colocation must fall back to category marks instead of forcing all logos');
 assertClearLogos(points,logos,bounds,50);assert.equal(JSON.stringify(points),before);
 const selected=logos.get('selected');assert.ok(Math.hypot(selected.x-750,selected.y-450)<=50);
});

test('area budgets and missing logo assets never remove observation identities',()=>{
 const bounds={left:0,right:1000,top:0,bottom:700},points=[logoPoint('a',100,100),{...logoPoint('b',300,100),hasLogo:false}];
 const noLabels=placeBrandLogos(points,bounds,{areaFraction:0});assert.equal(noLabels.size,0);assert.equal(points.length,2);
 const one=placeBrandLogos(points,bounds,{areaFraction:1});assert.deepEqual([...one.keys()],['a']);
 assert.equal(separatePins([],desktop).length,0);
 assert.throws(()=>separatePins(repeated(2,50,50),{left:0,right:100,top:0,bottom:100},8,{maxOffset:0,minSpacing:.5}),/too small for individual pins/);
});
