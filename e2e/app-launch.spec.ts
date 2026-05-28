import { test, expect } from './fixtures'

test.describe('App Launch', () => {
  test('should launch the application', async ({ app }) => {
    const windowCount = app.windows().length
    expect(windowCount).toBeGreaterThanOrEqual(1)
  })

  test('should display the main window', async ({ window }) => {
    const title = await window.title()
    expect(title).toBeTruthy()
  })

  test('should have correct app title', async ({ window }) => {
    const title = await window.title()
    expect(title).toContain('AweeClaw')
  })
})

test.describe('Window Controls', () => {
  test('should be resizable', async ({ window }) => {
    const size = window.viewportSize()
    expect(size).toBeTruthy()
    expect(size!.width).toBeGreaterThan(0)
    expect(size!.height).toBeGreaterThan(0)
  })
})
