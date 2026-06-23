# eCourts Browser-Fetch Protocol (reverse-engineered 2026-06-23)

Live reconnaissance of `https://services.ecourts.gov.in/ecourtindia_v6/`. Verified
with a Playwright PoC against a real case (`MHAU010000012020` — District &
Sessions Court, Aurangabad).

## Why browser automation (not raw HTTP)

Raw `httpx`/curl **cannot** complete the captcha→search handshake: the portal
sets a **rotating `JSESSION` cookie on every response** plus `SERVICES_SESSID`,
and routes requests across backends with non-shared session state. A stateless
HTTP client's captcha submission always returns `{"errormsg":"Invalid Captcha"}`
even with a correctly-solved captcha. A real browser (persistent
connection/affinity) passes — **confirmed**: the PoC got `status:1` with real
case data. So the production fetcher must drive a real browser (Playwright/Chromium).

## Confirmed flow

1. **Session + captcha**
   - GET landing → sets `SERVICES_SESSID` (PHP session, path `/ecourtindia_v6`) and a rotating `JSESSION`.
   - Captcha: securimage `<img id="captcha_image">` from `/vendor/securimage/securimage_show.php?<cachebust>` (215×80 PNG). csrf-magic is **disabled** (commented out).

2. **CNR search** (`js/searchByCNR.js` → `funViewCinoHistory()`)
   - Fill `#cino` (CNR must be exactly **16 chars**) and `#fcaptcha_code` (solved captcha).
   - POST `/?p=cnr_status/searchByCNR/` body: `cino=<CNR>&fcaptcha_code=<captcha>&ajax_req=true&app_token=<token>` (`app_token` is empty on first call; rotates via response).
   - **Response JSON keys:** `status` (1 = success), `casetype_list` (case-details HTML incl. an `order_table` with `viewBusiness(...)` links), `div_captcha`.
   - Failure: `{"errormsg":"Invalid Captcha... ", "div_captcha": "<refreshed captcha>", "historytable":""}` → re-read the refreshed captcha and retry (budget: `ECOURTS_CAPTCHA_MAX_ATTEMPTS`).

3. **Order / judgment detail** (`viewBusiness(...)`)
   - Each order/business row calls `viewBusiness('4','19','<businessDate|"">','<CNR>','1','<disposalFlag>','<date>','3','<establishment>','cnr','0')`. The disposal/judgment entry is flagged `Disposed`.
   - POST (same session, **no extra captcha**) → `{"status":..,"data_list":"<HTML order/business text>"}`.
   - For `MHAU010000012020`, the disposal `data_list` carried the **judgment/order text inline** (Daily Status, court, judge, CNR, proceedings) — directly usable for RAG, no PDF download needed.

4. **Order PDFs** (separate, where present)
   - Some cases expose downloadable order/judgment PDFs in `casetype_list`'s order section (display-pdf-style links) — **not** yet exercised; may require an additional captcha. Map this when building, per case.

## Production build notes
- Drive a real browser (Playwright + Chromium) in the worker; solve the securimage captcha with Document AI (`CAPTCHA_SOLVER_PROVIDER=documentai`) or local Tesseract; retry on `errormsg: Invalid Captcha`.
- Keep the existing guards: per-request throttle, stop-window, daily cap, and redaction before persist/translate.
- Prefer the inline `data_list` judgment text; fall back to order-PDF download only where text isn't present.
- Heavy: adds Chromium to the Python worker image (size/latency) — size instances accordingly.

PoC reference: throwaway scripts were used under `/tmp/ecpoc/` (Playwright + system Chrome, answer-file captcha handshake).
