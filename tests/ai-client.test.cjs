const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../js/ai-client.js'),'utf8');
const config={provider:'openai',baseUrl:'https://example.invalid/v1',apiKey:'test-key',model:'gpt-5.6-sol'};
const success={choices:[{message:{content:'ok'},finish_reason:'stop'}]};
function client(responses=[{status:200,data:success}]){
  const calls=[];
  const window={AiConfig:{load:()=>config}};
  vm.runInNewContext(source,{window,fetch:async(url,options)=>{
    calls.push({url,...options,body:options.body?JSON.parse(options.body):null});
    const r=responses.shift();assert.ok(r,'unexpected retry');if(r.error)throw r.error;
    return {ok:r.status>=200&&r.status<300,status:r.status,text:async()=>JSON.stringify(r.data)};
  }});
  return {api:window.AiClient,calls};
}
const messages=[{role:'user',content:'帮我调整布置'}];
test('reported GPT model omits incompatible temperature and uses completion token budget',async()=>{
  const {api,calls}=client();await api.chatCompletions({messages,temperature:.5,max_tokens:8192});
  assert.deepEqual(calls[0].body,{model:'gpt-5.6-sol',messages,max_completion_tokens:8192});
  assert.equal(calls.length,1);
});
test('all models use provider sampling defaults unless explicitly requested',async()=>{
  const {api,calls}=client();await api.chatCompletions({config:{...config,model:'deepseek-chat'},messages,max_tokens:600});
  assert.deepEqual(calls[0].body,{model:'deepseek-chat',messages,max_tokens:600});
});
test('ordinary model keeps explicit temperature and explicit reasoning none is preserved',async()=>{
  const {api,calls}=client([{status:200,data:success},{status:200,data:success}]);
  await api.chatCompletions({config:{...config,model:'gpt-4o-mini'},messages,temperature:.5,max_tokens:600});
  await api.chatCompletions({messages,temperature:.5,reasoning_effort:'none',max_completion_tokens:2048});
  assert.equal(calls[0].body.temperature,.5);assert.equal(calls[0].body.max_tokens,600);
  assert.equal(calls[1].body.temperature,.5);assert.equal(calls[1].body.reasoning_effort,'none');
  assert.equal(calls[1].body.max_completion_tokens,2048);
});
test('gateway alias retries only rejected temperature and token parameter without disabling reasoning',async()=>{
  const {api,calls}=client([
    {status:400,data:{error:{message:"litellm.UnsupportedParamsError: custom-reasoner doesn't support temperature=0.5 while reasoning is active. Only temperature=1 is supported unless reasoning_effort resolves to 'none'"}}},
    {status:400,data:{error:{message:"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}}},
    {status:200,data:success},
  ]);
  const signal={};const r=await api.chatCompletions({config:{...config,model:'custom-reasoner'},messages,temperature:.5,max_tokens:4096,signal});
  assert.equal(r.content,'ok');assert.equal(calls.length,3);
  assert.ok(!Object.hasOwn(calls[1].body,'temperature'));
  assert.deepEqual(calls[2].body,{model:'custom-reasoner',messages,max_completion_tokens:4096});
  assert.ok(calls.every(c=>c.signal===signal));
});
test('unrelated HTTP errors and aborts are not retried',async()=>{
  for(const status of [400,401,429,500]){
    const {api,calls}=client([{status,data:{error:{message:'unrelated failure'}}}]);
    await assert.rejects(api.chatCompletions({messages}),e=>e.code==='http_'+status);assert.equal(calls.length,1);
  }
  const error=Object.assign(new Error('cancelled'),{name:'AbortError'});const {api,calls}=client([{error}]);
  await assert.rejects(api.chatCompletions({messages}),e=>e===error);assert.equal(calls.length,1);
});
test('repeated parameter rejection terminates after the parameter has been removed',async()=>{
  const error={status:400,data:{error:{message:'Unsupported parameter temperature'}}};
  const {api,calls}=client([error,error]);
  await assert.rejects(api.chatCompletions({config:{...config,model:'alias'},messages,temperature:.5}),e=>e.code==='http_400');
  assert.equal(calls.length,2);
});
test('connection test reserves reasoning output tokens and preserves short ordinary checks',async()=>{
  const {api,calls}=client([{status:200,data:success},{status:200,data:success}]);
  assert.equal((await api.testConnection(config)).ok,true);
  assert.equal((await api.testConnection({...config,model:'deepseek-chat'})).ok,true);
  assert.equal(calls[0].body.max_completion_tokens,4096);assert.equal(calls[1].body.max_tokens,8);
  assert.ok(calls.every(c=>!Object.hasOwn(c.body,'temperature')));
});
test('model override and provider prefix determine parameter compatibility',async()=>{
  const {api,calls}=client();await api.chatCompletions({config:{...config,model:'gpt-4o-mini'},model:'openai/gpt-5.6-sol',messages,temperature:.5,max_tokens:4000});
  assert.equal(calls[0].body.max_completion_tokens,4000);assert.ok(!Object.hasOwn(calls[0].body,'temperature'));
});
test('reasoning that exhausts the token budget reports actionable error, not false success',async()=>{
  const {api}=client([{status:200,data:{choices:[{message:{content:''},finish_reason:'length'}]}}]);
  await assert.rejects(api.testConnection(config),e=>e.code==='token_limit'&&/token/.test(e.message));
});
