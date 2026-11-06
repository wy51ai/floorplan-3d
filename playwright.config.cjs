const { defineConfig } = require('@playwright/test');
const { existsSync } = require('node:fs');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
module.exports=defineConfig({
  testDir:'./tests',testMatch:'*.spec.cjs',timeout:60000,workers:1,
  webServer:{command:'python3 -m http.server 8000 --bind 127.0.0.1',url:'http://127.0.0.1:8000',reuseExistingServer:true},
  use:{baseURL:'http://127.0.0.1:8000',headless:true,
    launchOptions:{...(existsSync(chrome)?{executablePath:chrome}:{}),args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},screenshot:'only-on-failure'},
  reporter:'list'
});
