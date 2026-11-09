const {test,expect}=require('@playwright/test');
test('oversized additions move outside gap; drag and size changes settle without wall overlap and undo restores',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>{state.project.architecture.walls=[[-100,-3000,0,3000,'n','left'],[1800,-3000,1900,3000,'n','right']];state.furniture=[];state.demolished=[];syncArchitecture();renderAll();addItem(['cabinet','过宽柜',2000,600,'#aabbcc',800],900,0);});
 await expect(page.locator('#toast')).toHaveText('这里放不下啦');
 expect(await page.evaluate(()=>state.furniture.length)).toBe(1);
 expect(await page.evaluate(()=>ProjectModel.furniturePlacement(state.furniture[0],state.project.architecture).ok)).toBe(true);
 const original=await page.evaluate(()=>state.furniture[0].cx);
 await page.evaluate(()=>{const before=snap();const f=state.furniture[0];f.cx=900;f.cy=50;commit(before,true);renderAll();});
 expect(await page.evaluate(()=>ProjectModel.furniturePlacement(state.furniture[0],state.project.architecture).ok)).toBe(true);
 await page.evaluate(()=>undo());expect(await page.evaluate(()=>state.furniture[0].cx)).toBe(original);
 await page.evaluate(()=>select({kind:'furn',id:state.furniture[0].id}));await page.locator('#fW').fill('2400');await page.locator('#fW').press('Tab');
 expect(await page.evaluate(()=>ProjectModel.furniturePlacement(state.furniture[0],state.project.architecture).ok)).toBe(true);
});
