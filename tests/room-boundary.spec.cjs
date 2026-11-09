const {test,expect}=require('@playwright/test');
const poly=[[800,0],[2400,0],[2400,2400],[0,2400],[0,800],[800,800]];
const errors=[];
test.beforeEach(async({page})=>{
  errors.length=0;page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#projectNav')).toBeVisible();
  await page.evaluate(poly=>{
    state.project.custom=true;state.furniture=[];state.project.architecture={walls:[],windows:[],doors:[],slides:[],rooms:[{id:'bath',name:'卫生间',poly,at:[1300,1300]}]};
    state.rooms={bath:{name:'卫生间',mat:'tile600'}};renderAll();fitView();
    ProjectUI.focusTarget('bath');fitView();
    // Zoom in to the room, like the user's screenshot.
    view.s=.15;const q=planViewPoint({x:1200,y:1200});view.x0=q.x-svg.clientWidth/2/view.s;view.y0=q.y-svg.clientHeight/2/view.s;applyView();
  },poly);
});
async function dragBoundary(page,kind,index,dx,dy,cancel=false){
  const q=await page.evaluate(({kind,index,dx,dy})=>{
    const poly=getRoom('bath').poly,a=poly[index],b=poly[(index+1)%poly.length];
    const start=kind==='edge'?[(a[0]+b[0])/2,(a[1]+b[1])/2]:a;
    const project=([x,y])=>{const p=svg.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(document.querySelector('#gPlanContent').getScreenCTM());return {x:q.x,y:q.y};};
    return {start:project(start),end:project([start[0]+dx,start[1]+dy])};
  },{kind,index,dx,dy});
  await page.mouse.move(q.start.x,q.start.y);await page.mouse.down();await page.mouse.move(q.end.x,q.end.y,{steps:5});
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
test('bathroom notch has real handles and its short edge can be edited and undone',async({page})=>{
  await expect(page.locator('#gSel rect[data-handle=room-vertex]')).toHaveCount(6);
  await expect(page.locator('#gSel [data-handle=room-nw]')).toHaveCount(0);
  await dragBoundary(page,'edge',4,0,200);
  expect(await page.evaluate(()=>getRoom('bath').poly)).toEqual([[800,0],[2400,0],[2400,2400],[0,2400],[0,1000],[800,1000]]);
  await page.locator('#undo').click();expect(await page.evaluate(()=>getRoom('bath').poly)).toEqual(poly);
  await page.locator('#redo').click();await page.reload();expect(await page.evaluate(()=>getRoom('bath').poly[5])).toEqual([800,1000]);
  expect(errors).toEqual([]);
});
test('concave corner adjusts both short edges and Escape restores the original outline',async({page})=>{
  await dragBoundary(page,'vertex',5,200,100,true);
  expect(await page.evaluate(()=>getRoom('bath').poly)).toEqual(poly);
  await dragBoundary(page,'vertex',5,200,100);
  expect(await page.evaluate(()=>getRoom('bath').poly)).toEqual([[1000,0],[2400,0],[2400,2400],[0,2400],[0,900],[1000,900]]);
  await page.screenshot({path:'tests/artifacts/bathroom-notch-handles.png'});
  expect(errors).toEqual([]);
});
test('local edge dragging follows rotated plan coordinates',async({page})=>{
  await page.evaluate(()=>{state.project.northAngle=90;state.project.northMode='plan';renderAll();view.s=.15;const q=planViewPoint({x:1200,y:1200});view.x0=q.x-svg.clientWidth/2/view.s;view.y0=q.y-svg.clientHeight/2/view.s;applyView();});
  await dragBoundary(page,'edge',5,200,0);
  expect(await page.evaluate(()=>getRoom('bath').poly)).toEqual([[1000,0],[2400,0],[2400,2400],[0,2400],[0,800],[1000,800]]);
  expect(errors).toEqual([]);
});
