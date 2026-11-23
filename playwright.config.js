import {defineConfig} from '@playwright/test';

const port=Number(process.env.E2E_PORT||4281);
const baseURL='http://127.0.0.1:'+port;
export default defineConfig({
  testDir:'./tests/web',
  workers:1,
  retries:0,
  use:{ baseURL, locale:'ru-RU', trace:'retain-on-failure',
    launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{} },
  webServer:{
    command:'node tests/web/serve.js',
    url:baseURL+'/health/ready',
    env:{ E2E_PORT:String(port) },
    reuseExistingServer:false,
    timeout:45000,
  },
});
