const {test,expect}=require('@playwright/test');
test('Ask model and connection check accept reasoning model through compatible gateway',async({page})=>{
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/mock-ai/chat/completions',async route=>{
    const body=route.request().postDataJSON();requests.push(body);
    const unsupported=Object.hasOwn(body,'temperature')||Object.hasOwn(body,'max_tokens');
    await route.fulfill({status:unsupported?400:200,contentType:'application/json',body:JSON.stringify(unsupported
      ?{error:{message:"litellm.UnsupportedParamsError: gpt-5.6-sol doesn't support temperature=0.5 while reasoning is active"}}
      :{choices:[{message:{content:body.messages.at(-1).content==='ping'?'ok':'建议先确认通道净宽，再调整家具位置。'},finish_reason:'stop'}]})});
  });
  await page.goto('/');await expect(page.locator('#projectNav')).toBeVisible();
  await page.evaluate(()=>AiConfig.save({provider:'openai',baseUrl:location.origin+'/mock-ai',model:'gpt-5.6-sol',apiKey:'test-only'}));
  await page.locator('#projectNav [data-workspace=layout]').click();
  await page.locator('#aiOpen').click();await page.locator('#aiInput').fill('客厅怎么布置？');
  await page.locator('#aiAskLlm').click();
  await expect(page.locator('#aiChatLog')).toContainText('建议先确认通道净宽');
  expect((await page.evaluate(()=>AiClient.testConnection(AiConfig.load()))).ok).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests.map(r=>r.max_completion_tokens)).toEqual([8192,4096]);
  expect(requests.every(r=>r.model==='gpt-5.6-sol'&&!Object.hasOwn(r,'temperature')&&!Object.hasOwn(r,'reasoning_effort'))).toBe(true);
  expect(errors).toEqual([]);
});
