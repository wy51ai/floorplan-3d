const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const errors=[];
test.beforeEach(async({page})=>{errors.length=0;page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.locator('#projectNav')).toBeVisible();});
const nav=async(p,k)=>p.locator(`[data-workspace="${k}"]`).click();
const act=async(p,k)=>p.locator(`[data-action="${k}"]`).first().click();
const field=(p,k)=>p.locator(`#panel [name="${k}"]`);
async function blankRoom(p){await act(p,'blank');await act(p,'new-room');await field(p,'name').fill('实测卧室');await field(p,'width').fill('3600');await field(p,'depth').fill('4200');await p.getByRole('button',{name:'生成房间与墙体'}).click();await expect(p.locator('#gRooms polygon.room')).toHaveCount(1);}
async function saveForm(p){await p.getByRole('button',{name:'保存修改',exact:true}).click();await expect(p.locator('#panel .p-error')).toHaveText('');}
async function deviceAndPoint(p){await nav(p,'services');await act(p,'new-device');await field(p,'name').fill('卧室电动窗帘');await field(p,'need').fill('早上自动打开窗帘');await field(p,'model').fill('现场产品安装图待复核');await saveForm(p);await act(p,'generate');await act(p,'back');await p.locator('[data-type=point][data-action=edit]').first().click();await field(p,'z').fill('2400');await field(p,'circuit').fill('照明 C1，待电工确认');await saveForm(p);}
test('real room → device → point → checks → version → print → full restore',async({page})=>{
  await blankRoom(page);await field(page,'source').fill('卷尺实测 2026-11-06');await field(page,'verified').check();await saveForm(page);
  await deviceAndPoint(page);await expect(page.locator('#gServices [data-point]')).toHaveCount(1);
  await nav(page,'checks');await expect(page.locator('#panel')).not.toContainText('卧室电动窗帘缺少电源预留');
  await nav(page,'delivery');await field(page,'versionName').fill('卧室水电 V1');await field(page,'versionNote').fill('窗帘电源高度已录入');await act(page,'version');
  await expect(page.locator('#panel')).toContainText('卧室水电 V1');
  const popupPromise=page.waitForEvent('popup');await act(page,'print');const popup=await popupPromise;await expect(popup.locator('body')).toContainText('2400 mm');await expect(popup.locator('svg')).toBeVisible();await popup.close();
  const downloadPromise=page.waitForEvent('download');await act(page,'backup');const download=await downloadPromise;const data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));expect(data.project.points[0].z).toBe(2400);expect(data.project.versions).toHaveLength(1);expect(data.project.architecture.rooms).toHaveLength(1);
  await nav(page,'services');await page.locator('[data-type=point][data-action=edit]').first().click();await field(page,'z').fill('1800');await saveForm(page);await page.reload();await expect(page.locator('#projectNav')).toBeVisible();expect(await page.evaluate(()=>state.project.points[0].z)).toBe(1800);
  await page.locator('#fileIn').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect.poll(()=>page.evaluate(()=>state.project.points[0].z)).toBe(2400);
  await page.locator('#undo').click();expect(await page.evaluate(()=>state.project.points[0].z)).toBe(1800);await page.locator('#redo').click();expect(await page.evaluate(()=>state.project.points[0].z)).toBe(2400);
  await nav(page,'delivery');await field(page,'versionName').fill('另存版');await act(page,'version');await page.locator('[data-action=restore-version]').last().click();expect(await page.evaluate(()=>state.project.versions.length)).toBe(2);
  expect(errors).toEqual([]);await page.screenshot({path:'tests/artifacts/delivery.png',fullPage:true});
});
test('wall editing, drawing, undo and old furniture editing survive custom geometry',async({page})=>{
  await blankRoom(page);await act(page,'back');
  await page.evaluate(()=>ProjectUI.focusTarget(state.project.architecture.walls[0][5]));await field(page,'kind').selectOption('n');await field(page,'source').fill('现场复量及结构资料核对');await field(page,'verified').check();await saveForm(page);
  const wall=await page.evaluate(()=>state.project.architecture.walls[0][5]);await page.evaluate(id=>toggleWall(id),wall);expect(await page.evaluate(()=>state.demolished.length)).toBe(1);
  await nav(page,'layout');await expect(page.locator('#panel')).toContainText('拆除墙体');await page.locator('#undo').click();expect(await page.evaluate(()=>state.demolished.length)).toBe(0);
  await page.evaluate(()=>addItem(LIB[0].items[0],1800,1800));await expect(page.locator('#gFurn [data-fid]')).toHaveCount(1);await page.reload();await nav(page,'layout');await expect(page.locator('#gFurn [data-fid]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('invalid imports preserve state, draft heights and frozen versions remain explicit',async({page})=>{
  const before=await page.evaluate(()=>JSON.stringify(state));await page.locator('#fileIn').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"furniture":[],"project":{"height":-1}}')});await expect(page.locator('#toast')).toContainText('导入失败');expect(await page.evaluate(()=>JSON.stringify(state))).toBe(before);
  await nav(page,'services');await act(page,'new-device');await act(page,'generate');await nav(page,'checks');await expect(page.locator('#panel')).toContainText('未填写安装高度');expect(errors).toEqual([]);
});
test('underlay upload, calibration and photo evidence are included in backups',async({page})=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=','base64');
  await page.locator('#underlayFile').setInputFiles({name:'plan.png',mimeType:'image/png',buffer:png});await expect(page.locator('#gUnderlay image')).toHaveCount(1);
  const width=await page.evaluate(()=>state.project.underlay.width);await field(page,'distance').fill('2000');await act(page,'calibrate');const box=await page.locator('#plan').boundingBox();await page.mouse.click(box.x+100,box.y+100);await page.mouse.click(box.x+300,box.y+100);expect(await page.evaluate(()=>state.project.underlay.width)).not.toBe(width);
  await nav(page,'delivery');await act(page,'new-issue');await field(page,'title').fill('窗帘电源复核');await field(page,'note').fill('现场高度复量 2400 mm');await saveForm(page);await page.locator('#issuePhoto').setInputFiles({name:'site.png',mimeType:'image/png',buffer:png});await expect(page.locator('.p-photo')).toBeVisible();await page.reload();expect(await page.evaluate(()=>state.project.issues[0].photo.startsWith('data:image/jpeg'))).toBe(true);expect(errors).toEqual([]);
});
test('custom architecture and point heights render in actual WebGL',async({page})=>{
  await blankRoom(page);await deviceAndPoint(page);await page.waitForFunction(()=>!!window.View3D);await page.locator('[data-view="3d"]').click();await expect(page.locator('#stage')).toHaveClass(/is3d/,{timeout:30000});await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});await expect(page.locator('#view3d canvas')).toBeVisible();await expect(page.locator('.rlabel').filter({hasText:'P001'})).toHaveCount(1);await expect(page.locator('#roomList')).toContainText('实测卧室');const label=page.locator('.rlabel').filter({hasText:'P001'});const transform=await label.getAttribute('style');await field(page,'z').fill('1800');await saveForm(page);await expect.poll(()=>label.getAttribute('style')).not.toBe(transform);await page.screenshot({path:'tests/artifacts/custom-3d.png'});await page.locator('[data-cut="1.2"]').click();await page.locator('[data-view="2d"]').click();await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});expect(errors).toEqual([]);
});
test('mobile workspace is reachable without horizontal page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await nav(page,'services');await expect(page.locator('#panel [data-action=new-device]')).toBeVisible();await act(page,'new-device');await expect(field(page,'name')).toBeVisible();await field(page,'name').fill('移动端设备');await saveForm(page);await page.screenshot({path:'tests/artifacts/mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('point movement reopens installed status and missing wall links stay visible',async({page})=>{
  await blankRoom(page);await deviceAndPoint(page);await field(page,'status').selectOption('installed');await saveForm(page);await field(page,'x').fill('2300');await saveForm(page);await expect(field(page,'status')).toHaveValue('planned');await expect(field(page,'note')).toHaveValue(/位置已修改/);
  const wall=await page.evaluate(()=>state.project.architecture.walls[0][5]);await field(page,'wallId').selectOption(wall);await saveForm(page);await nav(page,'site');await page.evaluate(id=>ProjectUI.focusTarget(id),wall);await act(page,'delete');await nav(page,'checks');await expect(page.locator('#panel')).toContainText('关联墙体已移除');expect(errors).toEqual([]);
});
test('editable windows, doors and sliding doors round trip with undo',async({page})=>{
  await blankRoom(page);await act(page,'back');await act(page,'new-window');await field(page,'sill').fill('1100');await field(page,'head').fill('2500');await field(page,'source').fill('现场复测');await field(page,'verified').check();await saveForm(page);expect(await page.evaluate(()=>Object.values(state.project.windowInfo)[0].sill)).toBe(1100);await act(page,'back');await act(page,'new-slide');await field(page,'name').fill('阳台推拉门');await field(page,'x0').fill('1000');await field(page,'x1').fill('2800');await saveForm(page);await page.locator('#undo').click();expect(await page.evaluate(()=>state.project.architecture.slides[0].name)).toBe('推拉门');await page.locator('#redo').click();expect(await page.evaluate(()=>state.project.architecture.slides[0].name)).toBe('阳台推拉门');await page.reload();expect(await page.evaluate(()=>state.project.architecture.slides[0].rect)).toEqual([1000,0,2800,200]);expect(errors).toEqual([]);
});
test('draw a wall on plan and place a point with pointer, preserving exact project geometry',async({page})=>{
  await blankRoom(page);await act(page,'back');const count=await page.evaluate(()=>state.project.architecture.walls.length);await act(page,'draw-wall');const box=await page.locator('#plan').boundingBox();await page.mouse.click(box.x+100,box.y+100);await page.mouse.click(box.x+200,box.y+120);expect(await page.evaluate(()=>state.project.architecture.walls.length)).toBe(count+1);await expect(field(page,'kind')).toHaveValue('u');await page.evaluate(()=>toggleWall(state.project.architecture.walls.at(-1)[5]));expect(await page.evaluate(()=>state.demolished.length)).toBe(0);
  await nav(page,'services');await act(page,'new-point');await page.mouse.click(box.x+250,box.y+200);await expect(field(page,'z')).toHaveValue('');expect(await page.evaluate(()=>state.project.points.length)).toBe(1);expect(errors).toEqual([]);
});
test('furniture selection switches to layout and invalid dimensions cannot poison persistence',async({page})=>{
  const count=await page.locator('#gFurn [data-fid]').count();await page.evaluate(()=>select({kind:'furn',id:state.furniture[0].id}));await expect(page.locator('[data-workspace=layout]')).toHaveAttribute('aria-selected','true');await expect(page.locator('#fW')).toBeVisible();const w=await page.evaluate(()=>state.furniture[0].w);await page.locator('#fW').fill('999999');await page.locator('#fW').press('Tab');expect(await page.evaluate(()=>state.furniture[0].w)).toBe(w);await expect(page.locator('#toast')).toContainText('修改未保存');await page.reload();await expect(page.locator('#gFurn [data-fid]')).toHaveCount(count);expect(errors).toEqual([]);
});
