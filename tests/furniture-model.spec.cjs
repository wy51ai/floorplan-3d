const {test,expect}=require('@playwright/test');
const model={version:1,parts:[
{name:'桌面',shape:'box',position:[.5,.95,.5],size:[1,.1,1],color:'#b88c62'},
{name:'桌腿左',shape:'cylinder',position:[.1,.45,.5],size:[.1,.9,.15],color:'#444444'},
{name:'桌腿右',shape:'cylinder',position:[.9,.45,.5],size:[.1,.9,.15],color:'#444444'}]};
test('AI model is previewed, saved, placed in 2D/3D and survives project round trip',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/mock-ai/chat/completions',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify({name:'AI 部件桌',type:'table',unit:'mm',length:1600,width:800,height:750,evidence:'桌面与两条腿，尺寸为估算',estimated:true,model})},finish_reason:'stop'}]}}));
 await page.goto('/');await page.evaluate(()=>{AiConfig.save({apiKey:'test',baseUrl:location.origin+'/mock-ai'});FurnitureLibrary.add();});
 await page.locator('#catalogImages').setInputFiles('tests/fixtures/user-floorplan.png');
 await expect(page.locator('#catalogPreviews img')).toHaveCount(1);await page.locator('#catalogRecognize').click();
 await expect(page.locator('#catalogModelInfo')).toContainText('3 个部件');await expect(page.locator('#catalogModelPreview svg')).toBeVisible();
 const before=await page.locator('#catalogModelPreview').innerHTML();await page.locator('#catalogModelAngle').fill('90');expect(await page.locator('#catalogModelPreview').innerHTML()).not.toBe(before);
 await page.locator('#catalogH').fill('800');await expect(page.locator('#catalogModelInfo')).toContainText('1600 × 800 × 800 mm');
 await page.screenshot({path:'/tmp/ai-furniture-model-preview.png'});
 await page.locator('#catalogSave').click();await page.locator('#catalogClose').click();await page.reload();
 await page.evaluate(()=>addItem(LIB.flatMap(c=>c.items).find(i=>i[1]==='AI 部件桌'),7600,8950));
 expect(await page.evaluate(()=>state.furniture.at(-1).model.parts.length)).toBe(3);
 await expect(page.locator('#gFurn .furn').last().locator('ellipse')).toHaveCount(2);
 expect(await page.evaluate(()=>ProjectModel.normalize(JSON.parse(JSON.stringify(state)),PROJECT_TEMPLATE).furniture.at(-1).model.parts.length)).toBe(3);
 await page.waitForFunction(()=>!!window.View3D);await page.locator('[data-view="3d"]').click();await expect(page.locator('#stage')).toHaveClass(/is3d/,{timeout:30000});await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});await expect(page.locator('#view3d canvas')).toBeVisible();
 expect(errors).toEqual([]);
});
test('bad generated geometry preserves dimensions and explains fallback',async({page})=>{
 await page.goto('/');const r=await page.evaluate(()=>FurnitureCatalog.parseResult(JSON.stringify({unit:'mm',length:1000,width:500,height:800,model:{version:1,parts:[{shape:'script'}]}})));
 expect(r.w).toBe(1000);expect(r.model).toBe(null);expect(r.modelWarning).toContain('未通过校验');
});
