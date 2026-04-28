import { getDb } from './firestore.mjs';

const DOC = () => getDb().collection('otp_cache').doc('hapoalim');
const OTP_URL_PATTERN = /\/ng-portals\/auth|\/AUTHENTICATE\/.*OTP|sms|one.?time/i;

export async function clearPendingOtp() {
  await DOC().delete();
}

export async function pollForOtp(timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const doc = await DOC().get();
    if (doc.exists && doc.data()?.code) {
      const code = doc.data().code;
      await DOC().delete();
      return code;
    }
  }
  return null;
}

// Runs a background watcher alongside scraper.scrape().
// When the OTP page is detected, notifies via Telegram and waits for /otp command.
export function startOtpWatcher(browser) {
  let stopped = false;
  let handled = false;

  const loop = async () => {
    await clearPendingOtp();
    while (!stopped) {
      try {
        const pages = await browser.pages();
        for (const page of pages) {
          if (handled) break;
          const url = page.url();
          if (!OTP_URL_PATTERN.test(url)) continue;

          // URL matches — wait 3s to let normal auth redirects pass through
          await new Promise(r => setTimeout(r, 3000));
          if (stopped || handled) break;

          // Still on auth page — check if OTP input is actually visible
          const hasOtpInput = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
            return inputs.some(el => el.offsetParent !== null); // at least one visible input
          }).catch(() => false);

          if (!hasOtpInput) continue; // normal redirect — no OTP form

          handled = true;
          console.log(`[hapoalim-otp] OTP page confirmed: ${url}`);

          const { getBot } = await import('./notifier.mjs');
          const { TELEGRAM_CHAT_ID } = await import('./config.mjs');
          await getBot().sendMessage(TELEGRAM_CHAT_ID,
            '📱 <b>פועלים מבקש קוד SMS</b>\nשלח: <code>/otp [קוד]</code>',
            { parse_mode: 'HTML' }
          );

          const otp = await pollForOtp(5 * 60 * 1000);
          if (!otp) {
            console.warn('[hapoalim-otp] OTP timeout — no code received within 5 min');
            return;
          }
          if (stopped) return;

          // Screenshot for debugging
          try {
            await page.screenshot({ path: '/tmp/hapoalim-otp-page.png' });
            console.log('[hapoalim-otp] Screenshot saved to /tmp/hapoalim-otp-page.png');
          } catch (_) {}

          // Log page title and all inputs
          try {
            const title = await page.title();
            console.log(`[hapoalim-otp] Page title: "${title}"`);
            const inputInfo = await page.evaluate(() =>
              Array.from(document.querySelectorAll('input')).map(el => ({
                type: el.type, id: el.id, name: el.name,
                placeholder: el.placeholder, maxlength: el.maxLength,
                className: el.className, visible: el.offsetParent !== null,
              }))
            );
            console.log('[hapoalim-otp] Inputs on page:', JSON.stringify(inputInfo, null, 2));
            const buttonInfo = await page.evaluate(() =>
              Array.from(document.querySelectorAll('button')).map(el => ({
                type: el.type, id: el.id, text: el.innerText?.trim(),
                className: el.className, visible: el.offsetParent !== null,
              }))
            );
            console.log('[hapoalim-otp] Buttons on page:', JSON.stringify(buttonInfo, null, 2));
          } catch (e) {
            console.warn('[hapoalim-otp] Could not inspect page:', e.message);
          }

          console.log('[hapoalim-otp] OTP received, entering into page...');
          try {
            // Inspect page before entry so we know exactly what's there
            const pageState = await page.evaluate(() => {
              const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'))
                .map((el, i) => ({ i, type: el.type, id: el.id, name: el.name, maxlength: el.maxLength, placeholder: el.placeholder, value: el.value ? '***' : '', visible: el.offsetParent !== null }));
              const otpBtn = document.querySelector('.btn-red_1') ||
                Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'המשך');
              return {
                url: window.location.href,
                inputs,
                otpBtnFound: !!otpBtn,
                otpBtnText: otpBtn?.innerText?.trim(),
                otpBtnClass: otpBtn?.className,
              };
            });
            console.log('[hapoalim-otp] Page state before entry:', JSON.stringify(pageState));

            // Fill OTP via evaluate.
            // Hapoalim OTP page has: inputs[0]=userCode, inputs[1]=password, inputs[2..N]=one digit per OTP box.
            const filled = await page.evaluate((otpCode) => {
              const otpBtn = document.querySelector('.btn-red_1') ||
                Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'המשך');
              if (!otpBtn) return { ok: false, reason: 'no OTP button found' };

              // OTP inputs: visible inputs with no id (skip userCode/password which have ids)
              const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'))
                .filter(el => el.offsetParent !== null);
              const otpInputs = allInputs.filter(el => el.id === '' && el.name === '');

              if (otpInputs.length === 0) return { ok: false, reason: 'no OTP digit inputs found' };

              const digits = otpCode.split('');
              digits.forEach((digit, i) => {
                const input = otpInputs[i];
                if (!input) return;
                input.focus();
                input.value = digit;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              });

              return { ok: true, otpInputCount: otpInputs.length, digitsEntered: digits.length };
            }, otp);

            console.log('[hapoalim-otp] Fill result:', JSON.stringify(filled));

            if (filled.ok) {
              // Small pause for Angular to register the input change
              await new Promise(r => setTimeout(r, 500));
              // Click the OTP submit button
              const otpBtn = await page.$('.btn-red_1') ||
                (await page.$x('//button[normalize-space()="המשך"]'))[0];
              if (otpBtn) {
                await otpBtn.click();
                console.log('[hapoalim-otp] Clicked OTP submit (המשך)');
                // Check URL after a moment
                await new Promise(r => setTimeout(r, 2000));
                const urlAfter = page.url();
                console.log(`[hapoalim-otp] URL after submit: ${urlAfter}`);
              } else {
                console.warn('[hapoalim-otp] Could not click submit — button not found via Puppeteer');
              }
            }
          } catch (e) {
            console.warn('[hapoalim-otp] Error entering OTP:', e.message);
          }
        }
      } catch (_) {}
      if (!stopped && !handled) await new Promise(r => setTimeout(r, 3000));
      else if (handled) break;
    }
  };

  loop(); // intentionally not awaited — runs alongside scraper.scrape()
  return { stop: () => { stopped = true; } };
}
