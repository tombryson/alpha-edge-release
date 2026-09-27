import { test, expect } from '@playwright/test'

test.describe('portfolio workflow surfaces', () => {
  test('loads the current application shell without the retired Exposure tab', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'POSITIONS', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PORTFOLIO', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ANALYSIS', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ALERTS', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'HISTORY', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'EXPOSURE', exact: true })).toHaveCount(0)
  })

  test('positions surface still shows grouped sleeves', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'POSITIONS', exact: true }).click()
    await expect(page.getByText(/Materials|Gold|Energy|Pharma/i).first()).toBeVisible()
  })
})
