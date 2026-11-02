# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: nav-menu-visibility.spec.ts >> 自定义菜单弹窗 >> 切到「菜单显示」渲染穿梭框两栏
- Location: e2e/nav-menu-visibility.spec.ts:63:7

# Error details

```
Error: electron.launch: Process failed to launch!
Call log:
  - <launching> /Volumes/MacData/Ai/aweeclaw/aweeclaw-client/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -r /Volumes/MacData/Ai/aweeclaw/aweeclaw-client/node_modules/playwright-core/lib/server/electron/loader.js --inspect=0 --remote-debugging-port=0 /Volumes/MacData/Ai/aweeclaw/aweeclaw-client
  - <launched> pid=98294
  - [pid=98294][err] Debugger listening on ws://127.0.0.1:52850/27214c13-4995-45a5-a921-5a214e9577ce
  - [pid=98294][err] For help, see: https://nodejs.org/en/docs/inspector
  - <ws connecting> ws://127.0.0.1:52850/27214c13-4995-45a5-a921-5a214e9577ce
  - [pid=98294][err] Debugger attached.
  - <ws connected> ws://127.0.0.1:52850/27214c13-4995-45a5-a921-5a214e9577ce
  - [pid=98294][out] 14:51:38.545 M  INFO   SECURITY   [Security] Scenario policy set: dev-assistant
  - [pid=98294][out] 14:51:38.556 M  INFO   SECURITY   [Security] Scenario policy set: data-analyst
  - [pid=98294][out] 14:51:38.556 M  INFO   SECURITY   [Security] Scenario policy set: creative-writer
  - [pid=98294][out] 14:51:38.556 M  INFO   SECURITY   [Security] Scenario policy set: general-assistant
  - [pid=98294][out] 14:51:38.556 M  INFO   SECURITY   [Security] Scenario policy set: store-diagnosis
  - [pid=98294][out] 14:51:38.556 M  INFO   SECURITY   [Security] Scenario policy set: scenario-builder
  - [pid=98294][out] 14:51:38.557 M  INFO   SECURITY   [Security] AweeClaw builtin scenario policies initialized
  - [pid=98294] <kill>
  - [pid=98294] <will force kill>
  - [pid=98294] exception while trying to kill process: Error: kill EPERM
  - <ws disconnected> ws://127.0.0.1:52850/27214c13-4995-45a5-a921-5a214e9577ce code=1006 reason=
  - [pid=98294] <process did exit: exitCode=0, signal=null>
  - [pid=98294] starting temporary directories cleanup
  - [pid=98294] finished temporary directories cleanup

```

# Test source

```ts
  1  | import { test as base, expect } from '@playwright/test'
  2  | import { ElectronApplication, Page } from 'playwright'
  3  | import { _electron as electron } from 'playwright'
  4  | import path from 'path'
  5  | 
  6  | type ElectronTestFixtures = {
  7  |   app: ElectronApplication
  8  |   window: Page
  9  | }
  10 | 
  11 | export const test = base.extend<ElectronTestFixtures>({
  12 |   app: async ({}, use) => {
  13 |     const appPath = path.join(__dirname, '..')
> 14 |     const app = await electron.launch({
     |                 ^ Error: electron.launch: Process failed to launch!
  15 |       args: [appPath],
  16 |       env: {
  17 |         ...process.env,
  18 |         NODE_ENV: 'test',
  19 |       },
  20 |     })
  21 |     await use(app)
  22 |     await app.close()
  23 |   },
  24 |   window: async ({ app }, use) => {
  25 |     const window = await app.firstWindow()
  26 |     await window.waitForLoadState('domcontentloaded')
  27 |     await use(window)
  28 |   },
  29 | })
  30 | 
  31 | export { expect }
  32 | 
```