import { test as base, expect } from '@playwright/test'
import { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import path from 'path'

type ElectronTestFixtures = {
  app: ElectronApplication
  window: Page
}

export const test = base.extend<ElectronTestFixtures>({
  app: async ({}, use) => {
    const appPath = path.join(__dirname, '..')
    const app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })
    await use(app)
    await app.close()
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect }
