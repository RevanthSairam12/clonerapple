"""Read-only app smoke. No checkout/payment/account mutations or external requests."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=False)
base = "http://127.0.0.1:3100"
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    # Do not load third-party assets, telemetry or providers during smoke.
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page = context.new_page()
    for width in [1440, 768, 390]:
        page.set_viewport_size({"width": width, "height": 1000})
        for name, route in [("cart", "/cart"), ("bag", "/bag"), ("result", "/order/success?txnid=UNAUTHORIZED-PHASE-A")]:
            response = page.goto(base + route, wait_until="networkidle")
            page.screenshot(path=str(output / f"{name}-{width}.png"), full_page=True)
            metrics = page.evaluate("""() => ({width:innerWidth, documentWidth:document.documentElement.scrollWidth, header:!!document.querySelector('header'), footer:!!document.querySelector('footer')})""")
            heading = page.locator("h1").all_text_contents()
            body = page.locator("body").inner_text()
            assert response.status == 200, (route, response.status)
            assert metrics["documentWidth"] <= width, (route, metrics)
            assert metrics["footer"], (route, "missing footer")
            if name == "result":
                assert "Order status unavailable" in body
                assert "Order successful" not in body
                page.get_by_role("link", name="Continue shopping", exact=True).click()
                page.wait_for_url(base + "/", wait_until="networkidle")
                assert page.locator("body").inner_text().strip(), "Shopping action opened blank page"
            results.append({"route": name, "viewport": width, "status": response.status, "heading": heading, **metrics})
    page.goto(base + "/checkout", wait_until="networkidle")
    assert "/auth" in page.url, "Guest-off checkout guard did not redirect"
    results.append({"route": "checkout", "guestGuard": "redirected to auth; no bypass or business writes"})
    browser.close()
(output / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results, indent=2))
