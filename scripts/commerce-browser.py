#!/usr/bin/env python3
"""Only drive scripts/commerce-browser-fixture.mjs. No Next, backend or gateway.
Run: python -I scripts/commerce-browser.py --port <fixture's fresh port>
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--port', required=True, type=int)
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('port must be from 1024 to 65535')
origin = f'http://127.0.0.1:{args.port}'
output = Path(__file__).resolve().parents[1] / 'tmp' / 'commerce-browser-fixture'
output.mkdir(parents=True, exist_ok=True)
results = {'fixture_only': True, 'origin': origin, 'runs': [], 'errors': [], 'blocked_requests': [], 'screenshots': [],
           'limitations': ['Real commerce client components, webpack transpile/hydration; no real Next routing or server.',
                           'Synthetic props, auth/address, catalogue and stock responses; no DB, reservation, payment or real account exercised.',
                           'Real component Tailwind classes compiled with explicit fixture sources; header/footer/trust/recommendations/refresh are aliases.',
                           'Fresh summary source=db is a synthetic contract response, not evidence of a database read.']}


def check(value, message):
    if not value:
        raise AssertionError(message)


def input_line(kind='case', variant=True, color=None):
    value = {'productId': f'fixture-{kind}', 'name': f'Fixture {kind}', 'image': '/fixture-photo.svg', 'price': 1299,
             'priceDisplay': '₹1,299', 'quantity': 1, 'href': f'/shop/product/fixture-{kind}'}
    if variant:
        value.update(variantId='fixture-variant-0', variantSku='FIXTURE-0', variantLabel='Phone A / Blue', subtitle='Phone A / Blue')
    if color:
        value['color'] = color
    return value


def stored_line():
    return dict(input_line(), id='fixture-case::variant:fixture-variant-0')


def screenshot(page, name):
    path = output / f'{name}.png'
    page.screenshot(path=str(path), full_page=False)
    results['screenshots'].append(str(path))


def cart(page):
    return page.evaluate('window.__commerceFixture.cart')


def bag_json(page):
    return page.evaluate('JSON.stringify(window.__commerceFixture.cart.items)')


def wait_idle(page):
    page.wait_for_function('() => window.__commerceFixture.pending===0')


def add_button(page):
    return page.locator('[data-testid="surface"] main').get_by_role('button', name=re.compile(r'^(Add to Bag|Added to Bag|Adding to Bag.*)$', re.I)).first


def choose(page, option='fixture-variant-0'):
    selector = page.get_by_label('Model / specification', exact=True)
    selector.select_option(option)
    # Wait for the selection's mount-time availability read before injecting a hold/failure.
    page.wait_for_function("() => window.__commerceFixture.requests.some(r=>r.url.startsWith('/api/catalog/availability') && decodeURIComponent(r.url).includes('" + option + "'))")
    expect(selector).to_have_value(option)
    return selector


def assert_clean(page):
    state = page.evaluate('({unexpected:window.__commerceFixture.unexpectedFetch,forms:window.__commerceFixture.formSubmits})')
    check(not state['unexpected'], f'Unexpected synthetic fetch: {state}')
    check(not state['forms'], f'Gateway form attempted: {state}')
    check(page.locator('form[action*="payu"],form[action^="https:"]').count() == 0, 'No gateway form may be created')


def pdp_explicit(page, kind, width):
    expect(page.get_by_label('Model / specification', exact=True)).to_have_value('')
    add_button(page).click()
    expect(page.get_by_role('alert').filter(has_text=re.compile('Choose', re.I))).to_be_visible()
    check(cart(page)['items'] == [], 'No default variant enters bag')
    choose(page)
    expect(page.locator('[data-testid="surface"] main')).to_contain_text(re.compile(r'₹1,299(?:\.00)?'))
    add_button(page).click()
    page.wait_for_function('() => window.__commerceFixture.cart.totalCount===1')
    expect(add_button(page)).to_contain_text(re.compile('Added', re.I))
    item = cart(page)['items'][0]
    check(item['variantId'] == 'fixture-variant-0' and item['variantLabel'] == 'Phone A / Blue' and item['price'] == 1299, 'Bag preserves selected identity, label and price')
    check(page.evaluate("window.__commerceFixture.requests.some(r=>r.url==='/api/catalog/summary?fresh=1')"), 'Add must re-read fresh catalogue')
    screenshot(page, f'{kind}-selected-{width}')


def pdp_repeat(page, kind, width):
    choose(page)
    add_button(page).click()
    page.wait_for_function('() => window.__commerceFixture.cart.totalCount===1')
    expect(add_button(page)).to_be_enabled()
    before = bag_json(page)
    add_button(page).click()
    page.wait_for_function("() => window.__commerceFixture.cart.stockNotice && /Stock not available/.test(window.__commerceFixture.cart.stockNotice)")
    check(bag_json(page) == before, 'Repeated exact variant add beyond cap cannot mutate bag')
    expect(page.get_by_role('alert').filter(has_text=re.compile('Stock not available', re.I))).to_be_visible()
    expect(page.get_by_text('Item added to your Bag!', exact=True)).not_to_be_visible()
    check(page.evaluate('window.__commerceFixture.navigation.length') == 0, 'Rejected add cannot navigate')


def pdp_price(page, kind, width):
    choose(page)
    page.evaluate('window.__commerceFixture.salePrice=99900')
    add_button(page).click()
    expect(page.get_by_role('alert').filter(has_text=re.compile('price changed', re.I))).to_be_visible()
    check(cart(page)['items'] == [], 'Price change requires review, never implicit add')
    expect(page.locator('[data-testid="surface"] main')).to_contain_text('₹999')
    screenshot(page, f'{kind}-price-review-{width}')
    add_button(page).click()
    page.wait_for_function('() => window.__commerceFixture.cart.totalCount===1')
    item = cart(page)['items'][0]
    check(item['price'] == 999 and item['regularPrice'] == 1299, 'Second explicit add accepts reviewed sale price')


def pdp_network(page, kind, width):
    choose(page)
    page.evaluate("window.__commerceFixture.failurePath='/api/catalog/summary'")
    before = bag_json(page)
    add_button(page).click()
    expect(page.get_by_role('alert').filter(has_text=re.compile('Could not verify', re.I))).to_be_visible()
    check(bag_json(page) == before, 'Network failure leaves bag unchanged')
    expect(page.get_by_text('Item added to your Bag!', exact=True)).not_to_be_visible()
    check(page.evaluate('window.__commerceFixture.navigation.length') == 0, 'Network failure cannot navigate')


def pdp_stale(page, kind, width, buy=False):
    selector = choose(page)
    path = '/api/catalog/availability' if buy else '/api/catalog/summary'
    page.evaluate('(path)=>{window.__commerceFixture.holdPath=path}', path)
    if buy:
        page.get_by_role('button', name='Buy Now', exact=True).click()
    else:
        add_button(page).click()
    page.wait_for_function('() => window.__commerceFixture.pending>0')
    selector.select_option('fixture-variant-1')
    page.evaluate('window.__commerceFixture.release()')
    wait_idle(page)
    # Drain the response and React microtasks without arbitrary sleeps.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    check(cart(page)['items'] == [], 'Changing selection while pending must not add old selection')
    check(page.evaluate('window.__commerceFixture.navigation.length') == 0, 'Changing selection while pending must not navigate to old selection')
    expect(page.get_by_text('Item added to your Bag!', exact=True)).not_to_be_visible()


def shared_demand(page, kind, width):
    first = page.evaluate('(input)=>window.__commerceFixture.add(input)', input_line('shared', False, 'Blue'))
    check(first['status'] == 'added', 'Shared pool first add succeeds')
    page.wait_for_function('() => window.__commerceFixture.cart.totalCount===1')
    before = bag_json(page)
    second = page.evaluate('(input)=>window.__commerceFixture.add(input)', input_line('shared', False, 'Black'))
    check(second['status'] == 'unavailable', 'Distinct display lines must share the same parent demand cap')
    check(bag_json(page) == before, 'Rejected shared demand leaves bag unchanged')
    requests = page.evaluate("window.__commerceFixture.requests.filter(r=>r.url.startsWith('/api/catalog/availability')).map(r=>JSON.parse(new URL(r.url,location.origin).searchParams.get('lines')))")
    check(any(len(lines) == 2 and all(line['productId'] == 'fixture-shared' for line in lines) for lines in requests), 'Actual verifier sends both display lines for shared-pool validation')


def cart_ui(page, kind, width):
    result = page.evaluate('(input)=>window.__commerceFixture.add(input)', input_line())
    check(result['status'] == 'added', 'Seed cart through real async add')
    page.goto(f'{origin}/?mode=cart')
    page.wait_for_selector('html[data-hydrated="true"]')
    expect(page.get_by_text('Phone A / Blue', exact=True)).to_be_visible()
    expect(page.locator('[data-testid="surface"]')).to_contain_text('₹1,299')
    before = bag_json(page)
    page.get_by_role('button', name='Increase quantity', exact=True).click()
    expect(page.get_by_role('alert').filter(has_text=re.compile('Stock not available', re.I))).to_be_visible()
    check(bag_json(page) == before, 'Real cart quantity control respects exact variant cap')
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'), 'Cart has no page-wide horizontal overflow')
    screenshot(page, f'cart-{width}')


def buy_again(page, kind, width):
    expect(page.get_by_role('heading', name='Buy again', exact=True)).to_be_visible()
    choose_options = page.get_by_role('link', name='Choose options', exact=True)
    expect(choose_options).to_be_visible()
    expect(choose_options).to_have_attribute('href', '/shop/product/fixture-case')
    expect(page.get_by_role('button', name='Add to bag', exact=True)).to_have_count(0)
    choose_options.click()
    check(page.evaluate('window.__commerceFixture.navigation.at(-1)') == '/shop/product/fixture-case', 'Variant reorder navigates to explicit options')
    check(cart(page)['items'] == [], 'Buy again must not auto-select a child')
    screenshot(page, f'buy-again-{width}')


def checkout_conflict(page, kind, width):
    before = bag_json(page)
    expect(page.locator('#checkout-phone')).to_have_value('9876543210')
    page.locator('#checkout-pay-now-btn').click()
    alert = page.get_by_role('alert').filter(has_text='No payment was started.')
    expect(alert).to_be_visible()
    expect(alert).to_contain_text('Phone A / Blue')
    expect(alert.get_by_role('link', name='Review bag', exact=True)).to_have_attribute('href', '/cart')
    expect(alert.get_by_role('link', name='Choose options', exact=True)).to_have_attribute('href', '/shop/product/fixture-case')
    expect(page.locator('#checkout-pay-now-btn')).to_be_disabled()
    check(bag_json(page) == before, 'selection_unavailable must preserve bag')
    body = page.evaluate('window.__commerceFixture.initiates')
    check(len(body) == 1 and body[0]['items'][0]['variantId'] == 'fixture-variant-0', 'Exactly one synthetic conflict request, exact child identity')
    check(page.evaluate('window.__commerceFixture.navigation.length') == 0, 'Conflict cannot navigate to gateway')
    alert.scroll_into_view_if_needed()
    screenshot(page, f'checkout-selection-unavailable-{width}')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    try:
        for width in [1440, 768, 390]:
            scenarios = []
            for mode in ['case', 'accessory']:
                scenarios.extend([(mode, 'explicit-selection', pdp_explicit), (mode, 'repeat-exact-demand', pdp_repeat),
                                  (mode, 'sale-price-review', pdp_price), (mode, 'network-failure', pdp_network),
                                  (mode, 'stale-add', pdp_stale),
                                  (mode, 'stale-buy-now', lambda p, k, w: pdp_stale(p, k, w, buy=True))])
            scenarios.extend([('shared', 'shared-parent-demand', shared_demand), ('case', 'real-cart', cart_ui),
                              ('buy-again', 'variant-choose-options', buy_again), ('checkout', 'selection-unavailable', checkout_conflict)])
            for mode, name, test in scenarios:
                run = {'width': width, 'mode': mode, 'name': name}
                results['runs'].append(run)
                context = browser.new_context(viewport={'width': width, 'height': 1000}, has_touch=True, service_workers='block')
                page = context.new_page()
                page.set_default_timeout(8000)
                page.on('pageerror', lambda error: results['errors'].append(str(error)))
                page.on('console', lambda message: results['errors'].append(message.text) if message.type == 'error' else None)

                def guard(route):
                    url = urlsplit(route.request.url)
                    same = f'{url.scheme}://{url.netloc}' == origin
                    static = route.request.method == 'GET' and url.path in ['/', '/fixture-browser.js', '/fixture.css', '/fixture-photo.svg', '/favicon.ico']
                    if same and static:
                        route.continue_()
                    else:
                        results['blocked_requests'].append({'url': route.request.url, 'method': route.request.method})
                        route.abort()
                context.route('**/*', guard)
                # Native submit bypasses submit events, so block it before fixture/application code runs too.
                context.add_init_script("HTMLFormElement.prototype.submit=function(){throw new Error('Browser guard blocked native form submission')}")
                if mode == 'checkout':
                    context.add_init_script('localStorage.setItem("gadzio_cart_v1",' + json.dumps(json.dumps([stored_line()])) + ')')
                try:
                    response = page.goto(f'{origin}/?mode={mode}')
                    check(response is not None and response.status == 200, 'Fixture document must respond 200')
                    expect(page.locator('meta[name="commerce-fixture"]')).to_have_attribute('content', 'synthetic-only')
                    page.wait_for_selector('html[data-hydrated="true"]')
                    test(page, mode, width)
                    assert_clean(page)
                    run['passed'] = True
                except Exception as error:
                    run['passed'] = False
                    run['failure'] = str(error)
                    run['observed'] = page.evaluate('window.__commerceFixture ? {cart:window.__commerceFixture.cart,requests:window.__commerceFixture.requests,navigation:window.__commerceFixture.navigation,unexpected:window.__commerceFixture.unexpectedFetch,forms:window.__commerceFixture.formSubmits} : null')
                    screenshot(page, f'failure-{mode}-{name}-{width}')
                finally:
                    context.close()
    finally:
        browser.close()
results['passed'] = all(run.get('passed') for run in results['runs']) and not results['errors'] and not results['blocked_requests']
results['counts'] = {'passed': sum(bool(run.get('passed')) for run in results['runs']), 'failed': sum(not run.get('passed') for run in results['runs']), 'skipped': 0}
(output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps({'passed': results['passed'], 'counts': results['counts'], 'failures': [run for run in results['runs'] if not run.get('passed')], 'errors': results['errors'], 'blocked_requests': results['blocked_requests'], 'results': str(output / 'results.json')}, indent=2))
raise SystemExit(0 if results['passed'] else 1)
