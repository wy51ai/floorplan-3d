const {test,expect}=require('@playwright/test');
const path=require('node:path');
const errors=[];
test.beforeEach(async({page})=>{
  errors.length=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto('/');
  await expect(page.locator('#projectNav')).toBeVisible();
});

test('upload user floorplan, preview recognition, apply editable rooms',async({page})=>{
  test.setTimeout(180000);
  await page.locator('[data-action=recognize]').click();
  await expect(page.locator('#recogModal')).toBeVisible();
  await page.locator('#recogFile').setInputFiles(path.join(__dirname,'fixtures/user-floorplan.png'));
  await expect(page.locator('#recogTitle')).toHaveText('核对识别结果',{timeout:120000});
  const summary=await page.locator('.recog-side p').first().innerText();
  expect(summary).toMatch(/\d+\s*个房间/);
  const rooms=Number((summary.match(/(\d+)\s*个房间/)||[])[1]);
  expect(rooms).toBeGreaterThanOrEqual(6);
  await page.locator('[data-recog=apply]').click();
  await expect(page.locator('#recogModal')).toBeHidden({timeout:10000});
  await expect.poll(()=>page.evaluate(()=>state.project.custom)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>state.project.architecture.rooms.length)).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#gRooms polygon.room')).toHaveCount(await page.evaluate(()=>state.project.architecture.rooms.length));
  await expect(page.locator('#gUnderlay image')).toHaveCount(1);
  await page.locator('[data-view="3d"]').click();
  await expect(page.locator('#stage')).toHaveClass(/is3d/,{timeout:30000});
  await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});
  await page.screenshot({path:'tests/artifacts/recognition-applied-3d.png'});
  await page.locator('[data-view="2d"]').click();
  expect(errors).toEqual([]);
});

test('recognition modal cancel leaves current project intact',async({page})=>{
  const before=await page.evaluate(()=>JSON.stringify(state.project.architecture.rooms.map(r=>r.id)));
  await page.locator('[data-action=recognize]').click();
  await page.locator('[data-recog=close]').first().click();
  await expect(page.locator('#recogModal')).toBeHidden();
  expect(await page.evaluate(()=>JSON.stringify(state.project.architecture.rooms.map(r=>r.id)))).toBe(before);
  expect(errors).toEqual([]);
});


test('source floorplan keeps kitchen intact and solid balcony partition',async({page})=>{
  const checked=await page.evaluate(async()=>{
    const image=await FloorplanRecognitionService.loadImageBitmap('tests/fixtures/user-floorplan.png');
    const prepared=FloorplanRecognitionService.toCanvas(image);
    const r=await FloorplanRecognitionService.detectAsync(prepared.imageData);
    const built=FloorplanRecognition.toArchitecture(r,10);
    const covers=(r,x,y)=>r[0]<=x&&r[2]>x&&r[1]<=y&&r[3]>y;
    const cuts=[...built.architecture.windows,...built.architecture.doors.map(d=>d.rect),...built.architecture.slides.map(d=>d.rect)];
    return {
      roomCount:r.rooms.length,
      kitchen:r.rooms.filter(room=>FloorplanRecognition.contains(328,220,room.poly)&&FloorplanRecognition.contains(440,220,room.poly)).length,
      fakeKitchenWall:r.walls.some(w=>covers(w.rect,365,220)),
      fakeBalconyDoor:r.openings.some(o=>covers(o.rect,660,830)),
      overlaps:built.architecture.walls.some(w=>cuts.some(c=>Math.min(w[2],c[2])>Math.max(w[0],c[0])&&Math.min(w[3],c[3])>Math.max(w[1],c[1])))
    };
  });
  expect(checked).toEqual({roomCount:7,kitchen:1,fakeKitchenWall:false,fakeBalconyDoor:false,overlaps:false});
});
