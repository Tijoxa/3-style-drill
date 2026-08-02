"""MCP browser automation script for hint auto-close verification.

Usage: call run(page) from an async Playwright context. This contains the same
steps executed through the mcp_browser_automation tool.
"""

import re


async def run(page):
    async def solved_count():
        text = await page.locator('[data-testid="hud-solved"]').inner_text()
        nums = re.findall(r"\d+", text)
        if not nums:
            raise Exception(f"Could not parse solved count from hud-solved text: {text!r}")
        return int(nums[-1])

    async def wait_for_solved(expected):
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

    try:
        await page.set_viewport_size({"width": 1920, "height": 1080})
        await page.wait_for_load_state("domcontentloaded")
        print("Page loaded for hint auto-close verification")
        await page.evaluate("localStorage.clear()")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="hint-btn"]', timeout=10000)
        await page.wait_for_function("() => window.__trainer && !!window.__trainer.getTarget()", timeout=5000)
        print("Trainer ready with current target")

        before_a = await solved_count()
        print(f"Path A initial solved count: {before_a}")
        await page.keyboard.press("Space")
        await page.wait_for_function(
            """() => document.querySelector('[data-testid="recognition-timer"]')?.getAttribute('data-timer-state') === 'running'""",
            timeout=3000,
        )
        print("Path A timer started with first Space")
        await page.locator('[data-testid="hint-btn"]').click()
        await page.locator('[data-testid="hint-modal"]').wait_for(state="visible", timeout=3000)
        print("Path A hint modal opened")
        await page.keyboard.press("Space")
        await page.locator('[data-testid="hint-modal"]').wait_for(state="detached", timeout=3000)
        await wait_for_solved(before_a + 1)
        after_a = await solved_count()
        print(f"PASS A: Space while hint modal open closed modal and solved count incremented to {after_a}")

        await page.wait_for_timeout(250)
        before_b = await solved_count()
        print(f"Path B initial solved count: {before_b}")
        await page.locator('[data-testid="hint-btn"]').click()
        await page.locator('[data-testid="hint-modal"]').wait_for(state="visible", timeout=3000)
        print("Path B hint modal opened")
        await page.evaluate("window.__trainer.solveCurrent()")
        await page.locator('[data-testid="hint-modal"]').wait_for(state="detached", timeout=3000)
        await wait_for_solved(before_b + 1)
        after_b = await solved_count()
        print(f"PASS B: window.__trainer.solveCurrent() closed modal and solved count incremented to {after_b}")

        error_text = await page.evaluate("""() => {
        const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
        return errorElements.map(el => el.textContent).join(", ");
        }""")
        if error_text:
            print(f"Found error message: {error_text}")
        else:
            print("No error messages found on the page")

    except Exception as e:
        print(f"FAIL: hint auto-close verification failed: {e}")
        error_text = await page.evaluate("""() => {
        const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
        return errorElements.map(el => el.textContent).join(", ");
        }""")
        if error_text:
            print(f"Found error message: {error_text}")
        else:
            print("No error messages found on the page")
        raise