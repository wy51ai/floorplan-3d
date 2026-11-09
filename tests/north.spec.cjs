const {test,expect}=require('@playwright/test');
const errors=[];
test.beforeEach(async({page})=>{
  errors.length=0;page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('/');await expect(page.locator('#projectNav')).toBeVisible();
});
async function configure(page,angle,mode){
  await page.locator('#panel [name=northAngle]').selectOption(String(angle));
  await page.locator('#panel [name=northMode]').selectOption(mode);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#panel .p-error')).toHaveText('');
}
test('north configuration rotates the plan or compass and survives undo/reload',async({page})=>{
  const original=await page.evaluate(()=>JSON.stringify(state.project.architecture));
  await expect(page.locator('#panel [name=northMode]')).toHaveValue('plan');
  await configure(page,90,'plan');
  await expect(page.locator('#gPlanContent')).toHaveAttribute('transform',/^rotate\(-90 /);
  await expect(page.locator('#gNorth')).toHaveAttribute('transform',/rotate\(0\)/);
  const check=await page.evaluate(()=>{
    const point={x:ROOMS[0].at[0],y:ROOMS[0].at[1]}, p=svg.createSVGPoint();p.x=point.x;p.y=point.y;
    const screen=p.matrixTransform(document.querySelector('#gPlanContent').getScreenCTM());
    const roundTrip=toMM({clientX:screen.x,clientY:screen.y});
    return {dx:roundTrip.x-point.x,dy:roundTrip.y-point.y,bounds:planViewBounds(),original:{...BOUNDS}};
  });
  expect(check.dx).toBeCloseTo(0,2);expect(check.dy).toBeCloseTo(0,2);
  expect(check.bounds.w).toBeCloseTo(check.original.h);expect(check.bounds.h).toBeCloseTo(check.original.w);
  expect(await page.evaluate(()=>JSON.stringify(state.project.architecture))).toBe(original);
  await configure(page,90,'compass');
  await expect(page.locator('#gPlanContent')).toHaveAttribute('transform',/^rotate\(0 /);
  await expect(page.locator('#gNorth')).toHaveAttribute('transform',/rotate\(90\)/);
  await page.locator('#undo').click();
  await expect(page.locator('#gPlanContent')).toHaveAttribute('transform',/^rotate\(-90 /);
  await page.locator('#redo').click();await page.reload();
  await expect(page.locator('#panel [name=northMode]')).toHaveValue('compass');
  await expect(page.locator('#panel [name=northAngle]')).toHaveValue('90');
  await configure(page,270,'plan');
  await page.screenshot({path:'tests/artifacts/north-plan-270.png'});
  expect(errors).toEqual([]);
});

test('rotated plan keeps drawing coordinates accurate',async({page})=>{
  await configure(page,90,'plan');
  await page.locator('[data-action=draw-wall]').click();
  const targets=await page.evaluate(()=>{
    const group=document.querySelector('#gPlanContent'), center={x:BOUNDS.x+BOUNDS.w/2,y:BOUNDS.y+BOUNDS.h/2};
    const a={x:Math.round(center.x/10)*10,y:Math.round(center.y/10)*10}, b={x:a.x+600,y:a.y+200};
    return {rect:[a.x,a.y,b.x,b.y],screen:[a,b].map(q=>{const p=svg.createSVGPoint();p.x=q.x;p.y=q.y;const s=p.matrixTransform(group.getScreenCTM());return {x:s.x,y:s.y};})};
  });
  for(const p of targets.screen)await page.mouse.click(p.x,p.y);
  expect(await page.evaluate(()=>state.project.architecture.walls.at(-1).slice(0,4))).toEqual(targets.rect);
  expect(errors).toEqual([]);
});

test('3D rotates model with fixed sunlight and compass mode retains original model',async({page})=>{
  await page.waitForFunction(()=>!!window.View3D);
  await page.locator('[data-view="3d"]').click();
  await expect(page.locator('#stage')).toHaveClass(/is3d/);
  await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});
  const baseline=await page.evaluate(()=>View3D.sunInfo());
  const label=page.locator('.rlabel').first();const before=await label.getAttribute('style');
  await configure(page,90,'plan');
  await expect.poll(()=>label.getAttribute('style')).not.toBe(before);
  expect(await page.evaluate(()=>View3D.sunInfo())).toEqual(baseline);
  expect(await page.evaluate(()=>View3D.northBasis().deg)).toBe(0);
  await page.screenshot({path:'tests/artifacts/north-3d-plan-90.png'});
  await configure(page,90,'compass');
  expect(await page.evaluate(()=>View3D.northBasis().deg)).toBe(90);
  const rotatedSun=await page.evaluate(()=>View3D.sunInfo());
  expect(rotatedSun.position).not.toEqual(baseline.position);
  expect(rotatedSun.label).toBe(baseline.label);
  await page.locator('[data-view="2d"]').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});
  expect(errors).toEqual([]);
});
