"""Read-only Phase B smoke against the running dev app; no auth or business writes."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
base = 'http://localhost:3000'
output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=False)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') and route.request.method == 'GET' else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    response = page.goto(base + '/', wait_until='networkidle')
    assert response.status == 200
    links = page.locator('a[href*="/shop/product/"]').evaluate_all('(links) => links.map(a => a.getAttribute("href"))')
    assert links, 'No product link on home page'
    product = links[0]
    for width in [1440, 768, 390]:
        page.set_viewport_size({'width': width, 'height': 1000})
        response = page.goto(base + product, wait_until='networkidle')
        assert response.status == 200, response.status
        metrics = page.evaluate('''() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          header: !!document.querySelector('header'), footer: !!document.querySelector('footer'),
          summary: document.querySelector('meta[name="description"]')?.content ?? null })''')
        assert metrics['documentWidth'] <= width, metrics
        assert metrics['header'] and metrics['footer'], metrics
        assert page.locator('h1').inner_text().strip()
        page.screenshot(path=str(output / f'product-{width}.png'), full_page=True)
        results.append({'route': product, 'status': response.status, 'heading': page.locator('h1').inner_text(), **metrics})
    response = page.goto(base + '/store-admin/products/new', wait_until='networkidle')
    assert '/store-admin/login' in page.url, 'Protected workflow unexpectedly public'
    results.append({'route': '/store-admin/products/new', 'result': 'session guard redirects to login; workflow not authenticated or exercised'})
    assert not errors, errors
    browser.close()
(output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps({'results': results, 'pageErrors': errors, 'limitations': 'Existing product read-only smoke only. No sectioned-content fixture, authenticated wizard, option-price writes, payment or notification exercised.'}, indent=2))
