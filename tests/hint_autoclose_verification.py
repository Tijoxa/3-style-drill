"""Focused Playwright verification for hint modal auto-close on solve.

Bug under test: when the Hint panel is open, solving the current case should
close [data-testid=hint-modal] immediately and increment [data-testid=hud-solved].
"""

import asyncio
import re

from playwright.async_api import async_playwright


URL = "https://algo-spaced-repeat.preview.emergentagent.com"


async def solved_count(page):
    text = await page.locator('[data-testid="hud-solved"]').inner_text()
    nums = re.findall(r"\d+", text)
    if not nums:
        raise AssertionError(f"Could not parse solved count from: {text!r}")
    return int(nums[-1])


async def wait_for_solved(page, expected):
    await page.wait_for_function(
        """(expected) => {
            const el = document.querySelector('[data-testid="hud-solved"]');
            if (!el) return false;
            const nums = (el.textContent || '').match(/\d+/g);
            return nums && Number(nums[nums.length - 1]) === expected;
        }""",
        arg=expected,
        timeout=3000,
    )


async def wait_for_modal_closed(page):
    await page.locator('[data-testid="hint-modal"]').wait_for(state="detached", timeout=3000)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})

        try:
            await page.goto(URL, wait_until="domcontentloaded")
            await page.evaluate("localStorage.clear()")
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_selector('[data-testid="hint-btn"]', timeout=10000)
            await page.wait_for_function("() => window.__trainer && !!window.__trainer.getTarget()", timeout=5000)

            # A) Manual no-cube Space solve while Hint is open.
            before_a = await solved_count(page)
            await page.keyboard.press("Space")
            await page.wait_for_function(
                "() => document.querySelector('[data-testid=" + '"recognition-timer"' + "]')?.getAttribute('data-timer-state') === 'running'",
                timeout=3000,
            )
            await page.locator('[data-testid="hint-btn"]').click()
            await page.locator('[data-testid="hint-modal"]').wait_for(state="visible", timeout=3000)
            await page.keyboard.press("Space")
            await wait_for_modal_closed(page)
            await wait_for_solved(page, before_a + 1)
            print("PASS A: Space while hint modal open solved the running case, closed hint-modal, and incremented hud-solved")

            # B) Programmatic cube-state solve while Hint is open.
            await page.wait_for_timeout(250)
            before_b = await solved_count(page)
            await page.locator('[data-testid="hint-btn"]').click()
            await page.locator('[data-testid="hint-modal"]').wait_for(state="visible", timeout=3000)
            await page.evaluate("window.__trainer.solveCurrent()")
            await wait_for_modal_closed(page)
            await wait_for_solved(page, before_b + 1)
            print("PASS B: window.__trainer.solveCurrent() closed hint-modal and incremented hud-solved")

        finally:
            error_text = await page.evaluate("""() => {
                const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
                return errorElements.map(el => el.textContent).join(', ');
            }""")
            if error_text:
                print(f"Found error message: {error_text}")
            else:
                print("No error messages found on the page")
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())