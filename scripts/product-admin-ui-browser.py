#!/usr/bin/env python3
"""Drive the test-only loopback fixture, never an authenticated Next deployment.
Run with python -I scripts/product-admin-ui-browser.py --port 43127.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=43127)
parser.add_argument('--output', default='tmp/product-admin-ui-20261103')
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('port must be between 1024 and 65535')
origin = f'http://127.0.0.1:{args.port}'
root = Path(__file__).resolve().parents[1]
output = (root / args.output).resolve()
if not output.is_relative_to(root / 'tmp') or output == root / 'tmp':
    parser.error('output must be under tmp')
output.mkdir(parents=True, exist_ok=True)
if (output / 'results.json').exists():
    parser.error('output already contains results; choose a fresh evidence directory')
results = {'fixture_only': True, 'origin': origin, 'runs': [], 'errors': [], 'external_requests': [], 'screenshots': [],
           'limitations': ['Synthetic props and mocked data/auth imports; not authenticated Next integration.',
                           'Real admin stylesheet with basic fixture-only layout utilities; not a full Tailwind production build.',
                           'Save is intercepted in client memory; no backend, DB, payments or notifications exercised.']}


def check(value, message):
    if not value:
        raise AssertionError(message)


def help_summary(page, label):
    return page.locator(f'summary[aria-label="Help for {label}"]').first


def help_test(page, label, interaction='pointer'):
    before = page.evaluate('''() => JSON.stringify({controls:[...document.querySelectorAll('input,select,textarea')].map(el => [el.value,el.checked]), fixture:window.__fixture, draft:document.querySelector('[aria-label="Save product"] > .sa-hint')?.textContent})''')
    summary = help_summary(page, label)
    expect(summary).to_be_visible()
    details = summary.locator('..')
    if details.get_attribute('open') is not None:
        summary.click()
    if interaction == 'keyboard':
        summary.focus()
        summary.press('Enter')
    elif interaction == 'touch':
        summary.tap()
    else:
        summary.click()
    expect(details).to_have_attribute('open', '')
    expect(details.locator('.sa-product-help-copy')).to_be_visible()
    text = details.locator('.sa-product-help-copy').inner_text().strip()
    check(len(text) > 20, f'Help must contain real explanation: {label}')
    if interaction == 'keyboard':
        summary.press('Space')
    elif interaction == 'touch':
        summary.tap()
    else:
        summary.click()
    expect(details).not_to_have_attribute('open', '')
    after = page.evaluate('''() => JSON.stringify({controls:[...document.querySelectorAll('input,select,textarea')].map(el => [el.value,el.checked]), fixture:window.__fixture, draft:document.querySelector('[aria-label="Save product"] > .sa-hint')?.textContent})''')
    check(before == after, f'Help must not change controls, draft state, fetches or router: {label}')


def no_dirty(page):
    expect(page.locator('[aria-label="Save product"] > .sa-hint')).to_have_text('All six sections save together.')
    check(page.evaluate('window.__fixture.saves.length') == 0, 'Help/navigation must not save')


def overflow(page, require_table=False):
    report = page.evaluate('''() => ({
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      tables: [...document.querySelectorAll('.sa-table-wrap')].map(el => ({width: el.clientWidth, scrollWidth: el.scrollWidth, overflow: getComputedStyle(el).overflowX})),
      stray: [...document.querySelectorAll('main *')].filter(el => {
        if(el.closest('.sa-table-wrap') || !el.getClientRects().length) return false;
        const r=el.getBoundingClientRect(); return r.right>innerWidth+2 || r.left < -2;
      }).map(el => ({tag:el.tagName, cls:el.className})).slice(0,8)
    })''')
    check(report['pageWidth'] <= report['viewport'] + 2, f'Page must not scroll horizontally: {report}')
    check(not report['stray'], f'Only table regions may overflow: {report}')
    for table in report['tables']:
        check(table['overflow'] in ('auto', 'scroll'), f'Table must own its overflow: {table}')
    if require_table:
        check(any(t['scrollWidth'] > t['width'] for t in report['tables']), 'Narrow table must scroll within wrapper')
        table = page.locator('.sa-table-wrap').first
        table.evaluate('(el) => { el.scrollLeft=100; }')
        check(table.evaluate('(el) => el.scrollLeft') > 0, 'User table scrolling available')
        table.evaluate('(el) => { el.scrollLeft=0; }')
    return report


def screenshot(page, name, target=None):
    filename = f'{name}.png'
    if target:
        target.screenshot(path=str(output / filename))
    else:
        page.screenshot(path=str(output / filename), full_page=False)
    results['screenshots'].append(filename)


def hint_contrast(page, selector):
    samples = page.locator(selector).evaluate_all(r'''elements => {
      const rgba = value => {
        const channels = value.match(/[\d.]+/g).map(Number);
        return channels.length === 3 ? [...channels, 1] : channels;
      };
      const over = (foreground, background) => foreground.slice(0, 3).map((channel, index) =>
        channel * foreground[3] + background[index] * (1 - foreground[3]));
      const luminance = channels => channels.map(channel => {
        const value = channel / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      }).reduce((value, channel, index) => value + channel * [.2126, .7152, .0722][index], 0);
      return elements.filter(element => element.getClientRects().length &&
        getComputedStyle(element).visibility === 'visible').map(element => {
        const ancestors = [];
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
        let background = [255, 255, 255];
        for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background);
        const colour = getComputedStyle(element).color;
        const foreground = over(rgba(colour), background);
        const light = luminance(foreground), dark = luminance(background);
        return {text: element.textContent.trim().slice(0, 120), foreground: colour,
          background: background.map(Math.round), ratio: (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05)};
      });
    }''')
    check(bool(samples), f'Expected visible shared-reference instructions: {selector}')
    check(all(sample['ratio'] >= 4.5 for sample in samples), f'Help text needs at least 4.5:1 contrast: {samples}')
    return samples


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    try:
        for width in [1440, 768, 390]:
            context = browser.new_context(viewport={'width': width, 'height': 1000}, has_touch=True, device_scale_factor=1)
            page = context.new_page()
            page.on('pageerror', lambda error: results['errors'].append(str(error)))
            page.on('console', lambda msg: results['errors'].append(msg.text) if msg.type == 'error' else None)

            def guard(route):
                request_origin = urlsplit(route.request.url)
                if f'{request_origin.scheme}://{request_origin.netloc}' != origin:
                    results['external_requests'].append(route.request.url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)

            def visit(mode, suffix=''):
                response = page.goto(f'{origin}/?mode={mode}{suffix}')
                check(response is not None and response.status == 200, f'Fixture GET {mode} failed')
                page.wait_for_selector('html[data-hydrated="true"]')
                integrity = page.evaluate('''() => {
                  const nodes=[...document.querySelectorAll('[id]')], ids=nodes.map(el=>el.id);
                  return {duplicates:ids.filter((id,index)=>ids.indexOf(id)!==index),
                    missingDescriptions:[...document.querySelectorAll('[aria-describedby]')].flatMap(el=>el.getAttribute('aria-describedby').split(/\\s+/).filter(id=>!document.getElementById(id))),
                    nestedHelp:[...document.querySelectorAll('.sa-product-help')].filter(el=>el.parentElement.closest('label,a,button,summary,p')).length};
                }''')
                check(not integrity['duplicates'], f'IDs must be unique: {integrity}')
                check(not integrity['missingDescriptions'], f'Description ID references must resolve: {integrity}')
                check(integrity['nestedHelp'] == 0, f'Help must not nest in labels/links/buttons/summaries/paragraphs: {integrity}')

            run = {'width': width, 'checks': [], 'overflow': {}, 'contrast': {}}
            results['runs'].append(run)
            try:
                visit('add')
                expect(page.get_by_role('navigation', name='Product setup progress').get_by_role('button')).to_have_count(6)
                expect(page.locator('progress')).to_have_attribute('value', '1')
                help_test(page, 'Product name', 'keyboard')
                help_test(page, 'Category', 'touch')
                no_dirty(page)
                run['checks'].append('Add: six hydrated setup steps; keyboard/touch help causes no dirty state')
                page.get_by_label('Product name', exact=True).fill('Fixture created case')
                page.get_by_text('Advanced: optional product type and detail fields', exact=True).click()
                page.get_by_role('combobox', name='Product type', exact=True).select_option('fixture-case')
                page.get_by_label('Case material (required to publish)', exact=True).fill('Silicone')
                page.get_by_role('button', name='Continue', exact=True).click()
                expect(page.locator('#product-step-1')).to_be_visible()
                page.get_by_role('button', name='Add photo', exact=True).click()
                page.get_by_label('Image URL', exact=True).fill('/fixture-photo.svg')
                page.get_by_label('Photo description (alt text)', exact=True).fill('Synthetic case')
                page.get_by_role('button', name='Continue', exact=True).click()
                page.get_by_label('Product price ₹', exact=True).fill('499.00')
                page.get_by_label('Option values', exact=True).fill('Blue, Black')
                page.get_by_role('button', name='Generate options', exact=True).click()
                preview = page.get_by_role('group', name='Review physical combinations', exact=True)
                expect(preview.get_by_role('checkbox')).to_have_count(2)
                check(preview.get_by_role('checkbox').evaluate_all('(els)=>els.every(el=>!el.checked)'), 'Preview combinations start unselected')
                expect(page.get_by_label('In stock for Blue', exact=True)).to_have_count(0)
                for candidate in preview.get_by_role('checkbox').all():
                    candidate.check()
                page.get_by_role('button', name='Add selected combinations', exact=True).click()
                expect(page.get_by_label('In stock for Blue', exact=True)).to_be_visible()
                page.get_by_role('button', name='Continue', exact=True).click()
                expect(page.locator('#product-step-3')).to_be_visible()
                page.get_by_role('button', name='Continue', exact=True).click()
                for button in ['Add text section', 'Add bullet list', 'Add specifications', 'Add questions & answers']:
                    page.get_by_role('button', name=button, exact=True).click()
                page.get_by_label('Short description', exact=True).fill('Fixture-only draft summary')
                expect(page.locator('#product-step-4')).to_contain_text('Questions & answers')
                page.get_by_role('button', name='Continue', exact=True).click()
                page.get_by_role('button', name='Save as draft', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='All sections saved.')).to_be_visible()
                payload = page.evaluate('window.__fixture.saves[0]')
                check(payload['product']['name'] == 'Fixture created case', 'Actual form edits saved in memory')
                check(len(payload['options']) == 2 and len(payload['descriptionSections']) == 4, 'Options and all description types included')
                check(payload['product']['isActive'] is False, 'Add remains draft')
                run['checks'].append('Add: user completed all six steps, generated two options, four description types, memory-only draft save')
                screenshot(page, f'add-review-{width}')
                run['overflow']['add'] = overflow(page)

                visit('add-owner')
                page.get_by_label('Product name', exact=True).fill('Owner reviewed model case')
                page.get_by_role('button', name='Add specifications section', exact=True).click()
                page.get_by_label('Label', exact=True).fill('Material')
                page.get_by_label('Value', exact=True).fill('Verified silicone')
                page.get_by_text('Add New Model', exact=True).click()
                page.get_by_role('combobox', name='Device brand', exact=True).select_option('fixture-device-brand')
                page.get_by_label('Device model name', exact=True).fill('Owner new phone')
                page.get_by_label('Device model name', exact=True).press('Enter')
                expect(page.locator('#product-step-0')).to_be_visible()
                check(page.evaluate('window.__fixture.requests.length') == 0, 'Enter must not create or submit the product')
                page.get_by_role('button', name='2. Photos', exact=True).click()
                page.get_by_role('button', name='1. Basics', exact=True).click()
                expect(page.get_by_label('Device model name', exact=True)).to_have_value('Owner new phone')
                page.get_by_role('button', name='Create device model', exact=True).click()
                expect(page.get_by_label('Device model name', exact=True)).to_have_value('')
                expect(page.get_by_role('switch', name='Compatible devices active', exact=True)).not_to_be_checked()
                page.get_by_role('switch', name='Compatible devices active', exact=True).check()
                page.get_by_role('combobox', name='Add compatible device', exact=True).select_option('fixture-created-1')
                page.get_by_role('button', name='3. Price and options', exact=True).click()
                page.get_by_label('Product price ₹', exact=True).fill('499.00')
                page.get_by_label('Option values', exact=True).fill('Blue, Black')
                page.get_by_role('checkbox', name='Create an option for each selected compatible device', exact=True).check()
                page.get_by_role('button', name='Generate options', exact=True).click()
                preview = page.get_by_role('group', name='Review physical combinations', exact=True)
                check(preview.get_by_role('checkbox').evaluate_all('(els)=>els.every(el=>!el.checked)'), 'Model preview is opt-in')
                preview.get_by_role('checkbox').first.check()
                page.get_by_role('button', name='Add selected combinations', exact=True).click()
                page.get_by_role('button', name='4. Stock', exact=True).click()
                page.get_by_role('checkbox', name='Use these options at checkout with their own stock counts', exact=True).check()
                page.get_by_role('combobox', name='Stock source', exact=True).select_option('receipt')
                page.get_by_role('checkbox', name='I confirm these are new units, not units already counted in parent stock.', exact=True).check()
                page.get_by_label('Stock count for Owner new phone / Blue', exact=True).fill('3')
                page.get_by_label('Stock note (optional)', exact=True).fill('Receive three verified physical blue cases')
                page.get_by_role('button', name='5. Description', exact=True).click()
                expect(page.locator('#product-step-4').get_by_label('Value', exact=True)).to_have_value('Verified silicone')
                page.get_by_role('button', name='6. Review and publish', exact=True).click()
                page.get_by_role('checkbox', name='Publish in the storefront', exact=True).check()
                page.get_by_role('button', name='Create and publish', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='All sections saved.')).to_be_visible()
                payload = page.evaluate('window.__fixture.saves[0]')
                check(payload['product']['isActive'] and payload['metadata']['productTypeId'] is None, 'Ordinary publish needs no global type setup')
                check(len(payload['options']) == 1 and payload['options'][0]['deviceModelId'] == 'fixture-created-1', 'Only explicitly reviewed physical model combination is submitted')
                check(payload['options'][0]['stock']['onHand'] == 3 and payload['options'][0]['stock']['reason'] == 'receipt', 'Confirmed receipt records exact new units')
                check(payload['activateVariantInventory']['allocations'] == [], 'New receipts are not also parent transfers')
                run['checks'].append('Owner create: Enter isolation and wizard input retention; explicit compatibility; shared specs; one reviewed model combination; confirmed receipt and untyped publish payload')
                screenshot(page, f'owner-create-publish-{width}')

                visit('edit')
                nav = page.get_by_role('navigation', name='Product sections')
                expect(nav.get_by_role('link')).to_have_count(6)
                expect(page.locator('section[id^="product-step-"]')).to_have_count(6)
                for index in range(6):
                    nav.locator(f'a[href="#product-step-{index}"]').click()
                    check(page.evaluate('location.hash') == f'#product-step-{index}', 'Edit anchors must navigate actual sections')
                checkbox = page.get_by_role('switch', name='Limit my stock', exact=True).first
                before = checkbox.is_checked()
                # The disclosure is a sibling of the label, never a child of it.
                stock_help = help_summary(page, 'Limit my stock')
                check(stock_help.evaluate('(el) => !el.closest("label")'), 'Help must not be nested inside checkbox label')
                help_test(page, 'Limit my stock', 'touch')
                check(checkbox.is_checked() == before, 'Help must not toggle stock checkbox')
                help_test(page, 'Product name', 'pointer')
                advanced = page.get_by_text('Advanced: optional product type and detail fields', exact=True)
                if advanced.locator('..').get_attribute('open') is None:
                    advanced.click()
                help_test(page, 'Product type', 'keyboard')
                no_dirty(page)
                check(page.get_by_label('Price for Blue', exact=True).get_attribute('readonly') is not None, 'Saved option prices remain read-only')
                expect(page.get_by_label('Stock count for Blue', exact=True)).to_have_value('12')
                stock_table = page.locator('#product-step-3 .sa-table-wrap')
                expect(stock_table).to_contain_text('Held in checkouts')
                expect(stock_table.locator('tbody tr').first).to_contain_text('10')
                run['overflow']['edit'] = overflow(page, width == 390)
                run['checks'].append('Edit: six actual anchors, saved option identity/price locks, held=2/available=10 stock, checkbox-help isolation/no dirty')
                page.locator('#product-step-2').scroll_into_view_if_needed()
                screenshot(page, f'edit-options-{width}')
                page.locator('#product-step-3').scroll_into_view_if_needed()
                screenshot(page, f'edit-stock-{width}')
                page.locator('#product-step-4').scroll_into_view_if_needed()
                screenshot(page, f'edit-description-{width}')
                page.get_by_role('checkbox', name='Publish in the storefront', exact=True).scroll_into_view_if_needed()
                page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
                unobscured = page.get_by_role('checkbox', name='Publish in the storefront', exact=True).evaluate('''el => { const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return hit===el || el.contains(hit); }''')
                check(unobscured, 'Last publication control remains reachable above sticky save footer')
                help_test(page, 'Publish in the storefront', 'touch')
                save_help = help_summary(page, 'Save changes')
                save_help.click()
                save_copy = save_help.locator('..').locator('.sa-product-help-copy')
                expect(save_copy).to_be_visible()
                bounds = save_copy.bounding_box()
                check(bounds and bounds['y'] >= 0 and bounds['y'] + bounds['height'] <= 1002, 'Expanded sticky save help stays inside viewport')
                screenshot(page, f'edit-save-help-{width}')
                save_help.click()
                no_dirty(page)
                run['checks'].append('Sticky footer: final publication control reachable; expanded save help unobscured and wholly in viewport')
                page.get_by_label('Product name', exact=True).fill('Fixture protective case updated')
                page.get_by_label('Case material (required to publish)', exact=True).fill('Recycled silicone')
                page.get_by_label('Stock count for Blue', exact=True).fill('14')
                page.get_by_role('button', name='Reorder Highlights', exact=True).focus()
                page.get_by_role('button', name='Reorder Highlights', exact=True).press('Alt+ArrowUp')
                expect(page.get_by_role('status').filter(has_text='Highlights moved to position 1.')).to_be_visible()
                page.get_by_role('button', name='Save changes', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='All sections saved.')).to_be_visible()
                payload = page.evaluate('window.__fixture.saves[0]')
                check(payload['metadata']['attributeValues']['fixture-material'] == 'Recycled silicone', 'Actual metadata change recorded')
                check(payload['options'][0]['stock']['onHand'] == 14, 'Stock change recorded')
                check(payload['descriptionSections'][0]['id'] == 'fixture-bullets', 'Keyboard description reorder recorded')
                check(payload['options'][0]['id'] == 'fixture-option-0', 'Saved option identity retained')
                check(payload['expectedRevision'] == 0, 'Existing save carries the loaded catalog revision')
                check(page.evaluate('window.__fixture.refreshes') == 1, 'Router adapter observes post-save refresh')
                run['checks'].append('Edit: controlled metadata/stock edits, keyboard description reorder, memory-only save and router observation')

                visit('edit-owner')
                page.get_by_label('Product name', exact=True).fill('Owner draft name retained')
                basics = page.locator('#product-step-0')
                basics.get_by_label('Value', exact=True).fill('Owner verified specification')
                page.get_by_label('Photo description (alt text)', exact=True).fill('Owner draft photo retained')
                page.get_by_text('Add New Model', exact=True).click()
                page.get_by_role('combobox', name='Device brand', exact=True).select_option('fixture-device-brand')
                page.get_by_label('Device model name', exact=True).fill('Phone C')
                page.get_by_role('button', name='Create device model', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='saved')).not_to_have_count(0)
                expect(page.get_by_role('combobox', name='Add compatible device', exact=True).locator('option[value="fixture-created-1"]')).to_have_count(1)
                expect(page.get_by_label('Product name', exact=True)).to_have_value('Owner draft name retained')
                expect(basics.get_by_label('Value', exact=True)).to_have_value('Owner verified specification')
                expect(page.get_by_label('Photo description (alt text)', exact=True)).to_have_value('Owner draft photo retained')
                selected = page.locator('[aria-label="Selected compatible devices"]')
                expect(selected.get_by_role('checkbox')).to_have_count(1)
                expect(selected).not_to_contain_text('Phone C')
                check(page.evaluate('window.__fixture.saves.length') == 0, 'Inline create never saves the product')
                check(page.evaluate('window.__fixture.refreshes') == 0, 'Inline create never refreshes the product route')
                posted = page.evaluate('window.__fixture.requests.find(r=>r.method==="POST").body')
                check(sorted(posted) == ['brandId', 'name'], 'Inline create sends only name/parent, never management fields, client identity or association')
                screenshot(page, f'inline-model-owner-{width}')
                run['overflow']['inline'] = overflow(page)
                run['checks'].append('Owner inline model POST + GET reload preserves name/photo/specs and old selected devices; new model remains unselected')
                page.evaluate('window.__fixture.reloadFailure=true')
                page.get_by_label('Device model name', exact=True).fill('Phone D')
                page.get_by_role('button', name='Create device model', exact=True).click()
                expect(page.get_by_role('alert').filter(has_text='saved')).to_be_visible()
                expect(page.get_by_label('Device model name', exact=True)).to_have_value('')
                check(page.evaluate('window.__fixture.requests.filter(r=>r.method==="POST").length') == 2, 'Reload failure never repeats create')
                run['checks'].append('Successful model creation followed by failed reference reload is warning, not false creation failure or retry')

                visit('shared-owner')
                expect(page.locator('#product-step-3')).to_contain_text('Shared product stock')
                expect(page.get_by_label('In stock', exact=True)).to_have_value('20')
                page.get_by_role('combobox', name='Add compatible device', exact=True).select_option('fixture-phone-1')
                expect(page.locator('#product-step-3')).to_contain_text('Shared product stock')
                page.get_by_role('button', name='Save changes', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='All sections saved.')).to_be_visible()
                payload = page.evaluate('window.__fixture.saves[0]')
                check(payload['options'] == [] and len(payload['metadata']['deviceModelIds']) == 2, 'Compatibility does not create combinations or variant stock')
                check('activateVariantInventory' not in payload, 'Shared-stock mode never switches implicitly')
                screenshot(page, f'shared-stock-{width}')
                run['checks'].append('Multiple compatible devices keep one shared parent stock pool and never auto-create variants')

                visit('edit-owner')
                page.once('dialog', lambda dialog: dialog.accept())
                page.get_by_role('button', name='Archive and replace', exact=True).first.click()
                expect(page.get_by_label('Active Blue', exact=True).nth(1)).not_to_be_checked()
                expect(page.get_by_label('In stock for Blue', exact=True).nth(1)).to_have_value('0')
                expect(page.get_by_label('Limit stock for Blue', exact=True).nth(1)).to_be_checked()
                expect(page.get_by_label('In stock for Blue', exact=True).nth(1)).to_be_disabled()
                page.get_by_label('Active Blue', exact=True).nth(1).check()
                expect(page.get_by_label('In stock for Blue', exact=True).nth(1)).to_be_enabled()
                page.get_by_label('In stock for Blue', exact=True).nth(1).fill('4')
                page.get_by_text('Advanced option details', exact=True).click()
                page.get_by_role('checkbox', name='Confirm new stock received for Blue replacement', exact=True).check()
                page.get_by_role('button', name='Save changes', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='All sections saved.')).to_be_visible()
                payload = page.evaluate('window.__fixture.saves[0]')
                replacement = [o for o in payload['options'] if o.get('replacesVariantId')][0]
                check(replacement['replacesVariantId'] == 'fixture-option-0' and replacement['isActive'], 'Explicit activation stages replacement of exact saved identity')
                check(replacement['stock']['onHand'] == 4 and replacement['stock']['trackInventory'], 'Replacement uses explicit new count, not source units or unlimited stock')
                check(replacement.get('price') is None and replacement.get('pricePaiseOverride') is None, 'No inherited option price write')
                screenshot(page, f'replacement-{width}')
                run['checks'].append('Archive/replace begins inactive, tracked and zero; explicit activation/count save retains source identity and no price/stock copy')

                visit('edit')
                expect(page.get_by_text('Add New Model', exact=True)).to_have_count(1)
                expect(page.get_by_text('Add device brand first (owner only)', exact=True)).to_have_count(0)
                page.get_by_label('Product name', exact=True).fill('Admin draft retained')
                page.get_by_text('Add shared colour (reference only)', exact=True).click()
                page.get_by_label('Colour name', exact=True).fill('Admin Blue')
                page.get_by_label('Hex colour (#RRGGBB)', exact=True).fill('#123abc')
                page.get_by_label('Colour name', exact=True).press('Enter')
                check(page.evaluate('window.__fixture.requests.length') == 0, 'Inline colour Enter must not submit product')
                page.get_by_role('button', name='Create colour', exact=True).click()
                expect(page.get_by_label('Colour name', exact=True)).to_have_value('')
                expect(page.get_by_label('Product name', exact=True)).to_have_value('Admin draft retained')
                check(page.evaluate('window.__fixture.saves.length') == 0, 'Admin inline colour never saves product')
                check(page.evaluate('window.__fixture.refreshes') == 0, 'Admin inline colour never refreshes product')
                colour_request = page.evaluate('window.__fixture.requests.find(r=>r.method==="POST")')
                check(colour_request['url'].endswith('/colours/inline') and sorted(colour_request['body']) == ['hex', 'name'], 'Admin colour create is narrow and create-only')
                screenshot(page, f'inline-colour-admin-{width}')
                run['overflow']['inline-colour'] = overflow(page)
                run['checks'].append('Admin model/colour create available; brand creation hidden; inline colour Enter isolation and draft preservation')
                page.get_by_label('Product name', exact=True).fill('Conflict draft retained')
                page.evaluate('window.__fixture.conflict=true')
                page.get_by_role('button', name='Save changes', exact=True).click()
                expect(page.get_by_role('alert').filter(has_text='Fixture revision conflict')).to_be_visible()
                expect(page.get_by_label('Product name', exact=True)).to_have_value('Conflict draft retained')
                expect(page.get_by_role('button', name='Save changes', exact=True)).to_be_disabled()
                check(page.evaluate('window.__fixture.saves.length') == 1, 'Conflict never retries save')
                check(page.evaluate('window.__fixture.refreshes') == 0, 'Conflict never refreshes away draft')
                screenshot(page, f'conflict-{width}')
                run['checks'].append('Admin create-only capability excludes brands; expectedRevision conflict retains draft and blocks repeated saves')

                visit('models-owner')
                run['contrast']['model-references'] = hint_contrast(page, '.sa-reference-manager .sa-hint')
                page.get_by_text('Import, preview and downloads', exact=True).click()
                expect(page.get_by_text('Maximum 2,000 data records', exact=False)).to_be_visible()
                run['contrast']['model-import'] = hint_contrast(page, '.sa-shared-list .sa-hint')
                with page.expect_download() as model_template_info:
                    page.get_by_role('button', name='Download header-only template', exact=True).click()
                model_template_path = output / f'model-template-{width}.csv'
                model_template_info.value.save_as(model_template_path)
                check(model_template_path.read_bytes() == b'brand,model,sort_order,active\r\n', 'Model template has headers only')
                page.get_by_role('combobox', name='Brand for model-only lines (optional)', exact=True).select_option('fixture-device-brand')
                page.get_by_role('textbox', name='Shared-list input', exact=True).fill('Model for browser')
                page.get_by_role('button', name='Preview shared list', exact=True).click()
                page.get_by_role('button', name='Confirm valid new rows', exact=True).click()
                expect(page.get_by_role('button', name='Edit Model for browser', exact=True)).to_be_visible()
                page.get_by_label('UTF-8 CSV file', exact=True).set_input_files({
                    'name': 'models.csv', 'mimeType': 'text/csv',
                    'buffer': b'brand,model,sort_order,active\r\nExample devices,CSV imported model,2,yes\r\n',
                })
                expect(page.get_by_role('combobox', name='Input format', exact=True)).to_have_value('csv')
                page.get_by_role('button', name='Preview shared list', exact=True).click()
                expect(page.get_by_text('Row 2: New', exact=True)).to_be_visible()
                page.get_by_role('button', name='Confirm valid new rows', exact=True).click()
                expect(page.get_by_role('button', name='Edit CSV imported model', exact=True)).to_be_visible()
                with page.expect_download() as model_export_info:
                    page.get_by_role('button', name='Export shared list CSV', exact=True).click()
                model_export_path = output / f'model-export-{width}.csv'
                model_export_info.value.save_as(model_export_path)
                check('CSV imported model,2,yes' in model_export_path.read_text(encoding='utf-8'), 'Export includes imported display order and status')
                run['overflow']['shared-models'] = overflow(page)
                screenshot(page, f'shared-models-{width}')
                run['checks'].append('Owner model paste with selected brand; real UTF-8 file upload, CSV preview/confirm, header-only template and export downloads')
                visit('models-viewer')
                expect(page.get_by_text('Import, preview and downloads', exact=True)).to_have_count(0)
                expect(page.get_by_role('button', name='View products using Phone A', exact=True)).to_have_count(0)

                visit('colours-owner')
                page.get_by_text('Import, preview and downloads', exact=True).click()
                shared_input = page.get_by_role('textbox', name='Shared-list input', exact=True)
                shared_input_id = shared_input.get_attribute('id')
                check(bool(shared_input_id), 'Shared input has a stable explicit control ID')
                for shared_text in ['Blue #123ABC', 'Blu #123ABD', '', 'Blue #123ABC']:
                    shared_input.fill(shared_text)
                    expect(shared_input).to_have_value(shared_text)
                    expect(shared_input).to_have_attribute('id', shared_input_id)
                    expect(shared_input).to_have_accessible_name('Shared-list input')
                    expect(shared_input).to_have_accessible_description('Enter or upload the list, then preview it before confirming new rows.')
                run['checks'].append('Shared textarea keeps the exact accessible name, linked instructions and ID after repeated typing, clearing and rerendering')
                expect(page.get_by_role('button', name='Confirm valid new rows', exact=True)).to_have_count(0)
                page.get_by_role('button', name='Preview shared list', exact=True).click()
                expect(page.get_by_text('Preview — not yet saved', exact=True)).to_be_visible()
                check(page.evaluate('window.__fixture.requests.filter(r=>r.url.endsWith("/apply")).length') == 0, 'Preview must not apply')
                page.get_by_role('button', name='Confirm valid new rows', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='Created 1')).to_be_visible()
                page.get_by_role('button', name='Preview shared list', exact=True).click()
                expect(page.get_by_text('Row 1: Already in the list', exact=True)).to_be_visible()
                page.get_by_role('button', name='Confirm valid new rows', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='No catalogue changes')).to_be_visible()
                page.get_by_label('Shared-list input', exact=True).fill('Blu #123ABD')
                page.get_by_role('button', name='Preview shared list', exact=True).click()
                ack = page.get_by_role('checkbox', name='I reviewed row 1', exact=False)
                expect(ack).to_be_visible()
                expect(page.get_by_role('button', name='Confirm valid new rows', exact=True)).to_be_disabled()
                ack.check()
                expect(page.get_by_role('button', name='Confirm valid new rows', exact=True)).to_be_enabled()
                screenshot(page, f'shared-colour-preview-{width}')
                run['overflow']['shared-preview'] = overflow(page)
                with page.expect_download() as colour_errors_info:
                    page.get_by_role('button', name='Download invalid / near-match report', exact=True).click()
                colour_errors_path = output / f'colour-errors-{width}.csv'
                colour_errors_info.value.save_as(colour_errors_path)
                check('near,Blu' in colour_errors_path.read_text(encoding='utf-8'), 'Near-match CSV report includes the reviewed row')
                page.get_by_role('button', name='View products using Blue', exact=True).click()
                expect(page.get_by_role('region', name='Products using Blue', exact=True)).to_contain_text('Fixture protective case')
                expect(page.get_by_role('button', name='Confirm deactivation', exact=True)).to_have_count(0)
                check(page.evaluate('window.__fixture.requests.filter(r=>r.method==="PUT").length') == 0, 'Viewing uses never changes a shared reference')
                page.get_by_role('button', name='Close product uses', exact=True).click()
                expect(shared_input).to_have_value('Blu #123ABD')
                run['checks'].append('Colour error CSV and direct product-use review preserve import input and perform no management write')
                page.get_by_role('button', name='Edit Blue', exact=True).click()
                run['contrast']['colour-edit-and-import'] = hint_contrast(page, '.sa-shared-list .sa-hint')
                run['checks'].append('Rendered model and colour instructions meet 4.5:1 contrast on actual card/page backgrounds')
                page.get_by_role('checkbox', name='Active', exact=True).uncheck()
                page.get_by_role('button', name='Save shared reference', exact=True).click()
                expect(page.get_by_role('region', name='Confirm deactivation')).to_contain_text('Fixture protective case')
                check(page.evaluate('window.__fixture.requests.filter(r=>r.method==="PUT").length') == 0, 'Deactivation must wait for explicit confirmation')
                page.get_by_role('button', name='Confirm deactivation', exact=True).click()
                check(page.evaluate('window.__fixture.requests.find(r=>r.method==="PUT").body.confirmDeactivation') is True, 'Explicit deactivation flag sent')
                run['checks'].append('Shared owner preview/token confirmation, repeat no-op, near acknowledgment and named-use deactivation warning')
                visit('colours-viewer')
                expect(page.get_by_text('Import, preview and downloads', exact=True)).to_have_count(0)
                run['checks'].append('Viewer shared list omits all management controls')

                visit('viewer')
                expect(page.get_by_text('You have view-only access.', exact=False)).to_be_visible()
                expect(page.get_by_label('Product name', exact=True)).to_be_disabled()
                expect(page.get_by_role('button', name='Save changes', exact=True)).to_have_count(0)
                expect(page.get_by_text('Add New Model', exact=True)).to_have_count(0)
                help_test(page, 'Product name', 'keyboard')
                help_test(page, 'Limit my stock', 'touch')
                help_test(page, 'Short description', 'pointer')
                no_dirty(page)
                run['overflow']['viewer'] = overflow(page)
                page.locator('#product-step-0').scroll_into_view_if_needed()
                help_summary(page, 'Product name').click()
                screenshot(page, f'viewer-help-{width}')
                run['checks'].append('Viewer: disabled real controls, no save button, help works by keyboard/pointer/touch inside disabled fieldset')

                visit('list')
                expect(page.get_by_role('heading', name='Products', exact=True)).to_be_visible()
                expect(page.get_by_role('link', name='New product', exact=True)).to_have_count(1)
                expect(page.get_by_role('link', name='2 options • Edit colours and models', exact=True)).to_have_attribute('href', '/store-admin/products/fixture-case-blue#product-step-2')
                expect(page.get_by_role('link', name='Set stock', exact=True).first).to_have_attribute('href', '/store-admin/products/fixture-case-blue#product-step-3')
                help_test(page, 'Stock', 'keyboard')
                run['overflow']['list'] = overflow(page, width == 390)
                screenshot(page, f'products-list-{width}')
                page.get_by_role('link', name='Set stock', exact=True).first.click()
                check(page.evaluate('window.__fixture.router.at(-1)') == '/store-admin/products/fixture-case-blue#product-step-3', 'List stock link uses real target')
                visit('list', '&review=compatibility')
                expect(page.locator('tbody tr')).to_have_count(1)
                expect(page.locator('tbody')).to_contain_text('Fixture unlimited case')
                visit('list', '&review=needed')
                expect(page.locator('tbody tr')).to_have_count(1)
                visit('list-viewer')
                expect(page.get_by_role('link', name='New product', exact=True)).to_have_count(0)
                expect(page.get_by_role('link', name='Set stock', exact=True)).to_have_count(0)
                expect(page.get_by_role('link', name='2 options • View colours and models', exact=True)).to_have_count(1)
                help_test(page, 'Stock', 'touch')
                check(page.evaluate('window.__fixture.unexpectedFetch.length') == 0, 'No unmocked fetch')
                run['checks'].append('Actual transpiled async Products Page: mocked imports, links/filtering, viewer presentation, table-only overflow')
                run['passed'] = True
            except Exception as error:
                run['passed'] = False
                run['failure'] = str(error)
                screenshot(page, f'failure-{width}')
            finally:
                context.close()
    finally:
        browser.close()
results['passed'] = all(run.get('passed') for run in results['runs']) and not results['errors'] and not results['external_requests']
(output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps({'passed': results['passed'], 'runs': [{'width': run['width'], 'passed': run['passed'], 'failure': run.get('failure')} for run in results['runs']], 'console_errors': results['errors'], 'external_requests': results['external_requests'], 'results': str(output / 'results.json')}, indent=2))
raise SystemExit(0 if results['passed'] else 1)
