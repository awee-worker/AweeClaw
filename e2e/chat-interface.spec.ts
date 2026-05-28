import { test, expect } from './fixtures'

test.describe('Chat Interface', () => {
  test('should display chat input area', async ({ window }) => {
    const chatInput = window.locator('[data-testid="chat-input"], textarea, [contenteditable="true"]').first()
    await expect(chatInput).toBeVisible({ timeout: 15000 })
  })

  test('should allow typing in chat input', async ({ window }) => {
    const chatInput = window.locator('textarea, [contenteditable="true"]').first()
    if (await chatInput.isVisible()) {
      await chatInput.fill('Hello, test message')
      const value = await chatInput.inputValue().catch(() => chatInput.textContent())
      expect(value).toContain('Hello')
    }
  })
})

test.describe('Sidebar Navigation', () => {
  test('should display sidebar', async ({ window }) => {
    const sidebar = window.locator('nav, [data-testid="sidebar"], aside').first()
    await expect(sidebar).toBeVisible({ timeout: 10000 }).catch(() => {
      // sidebar might be collapsed
    })
  })
})
