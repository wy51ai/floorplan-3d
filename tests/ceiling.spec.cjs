const {test,expect}=require('@playwright/test');
test('ceiling layer isolates fixtures, edits height, preserves curtains and wall AC through reload and 3D',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('#ceilingView').click();await expect(page.locator('body')).toHaveClass(/ceiling-mode/);
 await expect(page.locator('#lib')).toContainText('挂式空调');
 await page.evaluate(()=>{addItem(CEILING_LIB[0].items[0],7600,8950);addItem(CEILING_LIB[0].items[4],7600,9000);addItem(CEILING_LIB[0].items[5],7600,9000);});
 expect(await page.evaluate(()=>state.furniture.filter(f=>f.layer==='ceiling').length)).toBe(3);
 await expect(page.locator('#gFurn [data-fid]')).toHaveCount(3);
 await page.locator('#fDrop').fill('250');await page.locator('#fDrop').press('Tab');
 expect(await page.evaluate(()=>state.furniture.at(-1).ceilingDrop)).toBe(250);
 await page.locator('[data-view="2d"]').click();await expect(page.locator('body')).not.toHaveClass(/ceiling-mode/);
 expect(await page.locator('#gFurn [data-fid]').count()).toBeGreaterThan(3);
 await page.reload();expect(await page.evaluate(()=>state.furniture.filter(f=>f.layer==='ceiling').length)).toBe(3);
 await page.waitForFunction(()=>!!window.View3D);await page.locator('[data-view="3d"]').click();await expect(page.locator('#stage')).toHaveClass(/is3d/,{timeout:30000});await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:30000});await expect(page.locator('#view3d canvas')).toBeVisible();
 expect(errors).toEqual([]);
});
