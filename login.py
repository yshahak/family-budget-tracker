import os
import sys
import time
import logging
from pathlib import Path
from dotenv import dotenv_values
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

LOGIN_URL = "https://digital.isracard.co.il/personalarea/login"
FIXED_PASSWORD_BUTTON_TEXT = "כניסה עם סיסמה קבועה"


def load_creds() -> dict:
    env_path = Path(__file__).parent / ".env"
    log.info(f"Loading credentials from {env_path}")
    creds = dotenv_values(env_path)
    required = ["id", "digits", "pass"]
    for key in required:
        if key not in creds or not creds[key]:
            raise ValueError(f"Missing required .env field: {key}")
    log.info(f"Credentials loaded — id={creds['id']}, digits={creds['digits']}, pass=***")
    return creds


def screenshot(page, name: str):
    path = Path(__file__).parent / f"debug_{name}.png"
    page.screenshot(path=str(path))
    log.debug(f"Screenshot saved: {path}")


def login(creds: dict, headless: bool = False):
    with sync_playwright() as p:
        log.info("Launching Chromium browser")
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="he-IL",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )

        context.on("request", lambda req: log.debug(f"  --> {req.method} {req.url[:120]}"))
        context.on("response", lambda res: log.debug(f"  <-- {res.status} {res.url[:120]}"))

        page = context.new_page()
        page.on("console", lambda msg: log.debug(f"[browser console] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: log.error(f"[browser error] {err}"))

        log.info(f"Navigating to {LOGIN_URL}")
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30_000)
        log.info(f"Page title: {page.title()}")
        screenshot(page, "01_initial_load")

        # Click "כניסה עם סיסמה קבועה" to switch to fixed-password login
        log.info(f"Looking for fixed-password login button: '{FIXED_PASSWORD_BUTTON_TEXT}'")
        try:
            fixed_pw_btn = page.get_by_text(FIXED_PASSWORD_BUTTON_TEXT, exact=False).first
            log.info(f"Found button, clicking it")
            fixed_pw_btn.click()
            page.wait_for_load_state("networkidle", timeout=10_000)
        except PlaywrightTimeoutError:
            log.warning("No fixed-password button found or click timed out — may already be on that form")
        screenshot(page, "02_after_fixed_pw_click")
        log.info(f"Page title after click: {page.title()}")

        # Ensure "תעודת זהות" radio is selected (it's the default, but let's be sure)
        log.info("Selecting 'תעודת זהות' (ID) radio button")
        try:
            id_radio = page.locator("input[type='radio']").first
            if not id_radio.is_checked():
                id_radio.click()
                log.info("Clicked ID radio button")
            else:
                log.info("ID radio already selected")
        except Exception as e:
            log.warning(f"Could not interact with radio button: {e}")

        # Fill in ID number
        log.info("Filling in ID number")
        try:
            id_field = page.locator("input[placeholder*='זהות'], input[name*='id'], input[id*='id']").first
            log.debug(f"ID field locator found, filling with value")
            id_field.fill(creds["id"])
            log.info("ID number filled")
        except Exception as e:
            log.error(f"Failed to fill ID field: {e}")
            screenshot(page, "03_id_fill_error")
            raise

        screenshot(page, "03_after_id_fill")

        # Fill in last 6 digits of card
        log.info("Filling in last 6 card digits")
        try:
            digits_field = page.locator(
                "input[placeholder*='ספרות'], input[name*='digit'], input[id*='digit']"
            ).first
            digits_field.fill(creds["digits"])
            log.info("Card digits filled")
        except Exception as e:
            log.error(f"Failed to fill digits field: {e}")
            screenshot(page, "04_digits_fill_error")
            raise

        screenshot(page, "04_after_digits_fill")

        # Fill in password
        log.info("Filling in password")
        try:
            pass_field = page.locator(
                "input[type='password'], input[placeholder*='סיסמה'], input[name*='pass']"
            ).first
            pass_field.fill(creds["pass"])
            log.info("Password filled")
        except Exception as e:
            log.error(f"Failed to fill password field: {e}")
            screenshot(page, "05_pass_fill_error")
            raise

        screenshot(page, "05_after_pass_fill")

        # Submit
        log.info("Submitting login form")
        try:
            submit_btn = page.locator("button[type='submit'], input[type='submit']").first
            log.debug("Found submit button, clicking")
            submit_btn.click()
        except Exception as e:
            log.warning(f"Could not find submit button by type, trying Enter key: {e}")
            pass_field.press("Enter")

        log.info("Waiting for navigation after submit...")
        try:
            page.wait_for_load_state("networkidle", timeout=20_000)
        except PlaywrightTimeoutError:
            log.warning("Timed out waiting for networkidle after submit")

        screenshot(page, "06_after_submit")
        log.info(f"Post-submit URL: {page.url}")
        log.info(f"Post-submit title: {page.title()}")

        # Check if login succeeded
        current_url = page.url
        if "login" in current_url.lower():
            log.error("Still on login page — login likely failed")
            # Log any visible error messages
            try:
                errors = page.locator(".error, .alert, [class*='error'], [class*='Error']").all_text_contents()
                if errors:
                    log.error(f"Error messages on page: {errors}")
            except Exception:
                pass
            log.info("Dumping page HTML for diagnosis:")
            log.debug(page.content()[:3000])
        else:
            log.info(f"Login appears successful! Landed on: {current_url}")

        input("Press Enter to close the browser...")
        browser.close()


if __name__ == "__main__":
    creds = load_creds()
    login(creds, headless=False)