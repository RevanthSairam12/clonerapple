#!/usr/bin/env python3
"""Drive only scripts/catalog-workspace-fixture.mjs; run using python -I."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=43128)
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('port must be 1024 through 65535')
origin = f'http://127.0.0.1:{args.port}'
output = Path(__file__).resolve().parents[1] / 'tmp' / 'catalog-workspace-20261103'
output.mkdir(parents=True, exist_ok=True)
results = {'fixture_only': True, 'runs': [], 'errors': [], 'external_requests': [], 'screenshots': [],
           'limitations': ['Synthetic props and memory-only fetch responses, not authenticated Next or database integration.',
                           'Real admin stylesheet with minimal host utilities, not a production Tailwind build.',
                           'Shared reference writes and starter setup responses are recorded, never persisted.']}


def check(value, message):
    if not value:
        raise AssertionError(message)


def screenshot(page, name):
    destination = output / f'{name}.png'
    page.screenshot(path=str(destination), full_page=False)
    results['screenshots'].append(str(destination))


def requests(page, suffix):
    return page.evaluate('(suffix) => window.__catalogFixture.requests.filter(r => r.url.endsWith(suffix))', suffix)


def overflow(page):
    report = page.evaluate('''() => ({viewport:innerWidth, width:document.documentElement.scrollWidth,
        tables:[...document.querySelectorAll('.sa-table-wrap')].filter(el=>el.getClientRects().length).map(el=>({width:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflowX}))})''')
    check(report['width'] <= report['viewport'] + 2, f'Page overflow must be contained: {report}')
    for table in report['tables']:
        check(table['overflow'] in ('auto', 'scroll'), f'Table owns overflow: {table}')
    return report


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    try:
        for width in [1440, 390]:
            context = browser.new_context(viewport={'width': width, 'height': 1000}, has_touch=True)
            page = context.new_page()
            page.on('pageerror', lambda error: results['errors'].append(str(error)))
            page.on('console', lambda msg: results['errors'].append(msg.text) if msg.type == 'error' else None)

            def guard(route):
                parsed = urlsplit(route.request.url)
                if f'{parsed.scheme}://{parsed.netloc}' != origin:
                    results['external_requests'].append(route.request.url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)

            def visit(query=''):
                response = page.goto(f'{origin}/?{query}')
                check(response.status == 200, 'Fixture serves HTTP 200')
                page.wait_for_selector('html[data-hydrated="true"]')

            run = {'width': width, 'checks': []}
            results['runs'].append(run)
            try:
                visit('section=types&category=fixture-cases')
                tabs = page.get_by_role('tablist', name='Catalogue data sections')
                types = page.locator('#catalog-panel-types')
                expect(types).to_be_visible()
                expect(types.get_by_role('combobox', name='Category filter', exact=True)).to_have_value('fixture-cases')
                types.get_by_role('textbox', name='Name', exact=True).fill('Unsaved workspace reference')
                page.get_by_role('tab', name='Compatible devices', exact=True).click()
                expect(page.locator('#catalog-panel-devices')).to_be_visible()
                page.get_by_role('tab', name='Product types', exact=True).click()
                expect(types.get_by_role('textbox', name='Name', exact=True)).to_have_value('Unsaved workspace reference')
                tab = page.get_by_role('tab', name='Product types', exact=True)
                tab.focus()
                tab.press('ArrowRight')
                expect(page.get_by_role('tab', name='Detail fields', exact=True)).to_be_focused()
                expect(page.locator('#catalog-panel-details')).to_be_visible()
                page.keyboard.press('End')
                expect(page.get_by_role('tab', name='Other references', exact=True)).to_be_focused()
                page.keyboard.press('Home')
                expect(tab).to_be_focused()
                expect(types.get_by_role('textbox', name='Name', exact=True)).to_have_value('Unsaved workspace reference')
                check(page.evaluate('window.__catalogFixture.requests.length') == 0, 'Tab navigation must never save')
                run['checks'].append('Mounted type draft retained across pointer and keyboard tabs; arrow/Home/End roving focus; category deep link')
                run['types_overflow'] = overflow(page)
                screenshot(page, f'workspace-types-{width}')

                types.get_by_role('searchbox', name='Search product types', exact=True).fill('no-such-type')
                expect(types.get_by_text('No references match these filters.', exact=False)).to_be_visible()
                types.get_by_role('searchbox', name='Search product types', exact=True).fill('')
                types.get_by_role('combobox', name='Status', exact=True).select_option('inactive')
                expect(types.locator('tbody')).to_contain_text('Fixture retired type')
                expect(types.get_by_role('cell', name='Fixture case', exact=True)).to_have_count(0)
                types.get_by_role('combobox', name='Status', exact=True).select_option('all')
                page.once('dialog', lambda dialog: dialog.dismiss())
                types.get_by_role('button', name='New / reset', exact=True).click()
                expect(types.get_by_role('textbox', name='Name', exact=True)).to_have_value('Unsaved workspace reference')
                page.once('dialog', lambda dialog: dialog.accept())
                types.get_by_role('button', name='New / reset', exact=True).click()
                expect(types.get_by_role('textbox', name='Name', exact=True)).to_have_value('')
                types.get_by_role('button', name='Edit', exact=True).first.click()
                expect(types.get_by_role('combobox', name='Category', exact=True)).to_be_disabled()
                types.get_by_role('textbox', name='Name', exact=True).fill('Fixture renamed in memory')
                types.get_by_role('button', name='Save reference', exact=True).click()
                expect(types.get_by_role('status')).to_contain_text('Reference saved')
                check(requests(page, '/metadata/types')[0]['method'] == 'PUT', 'Reference save records only mocked PUT')
                run['checks'].append('Manager search/status filters, cancelled reset retains edits, accepted reset clears, category identity locked, memory-only save')

                page.get_by_role('tab', name='Compatible devices', exact=True).click()
                expect(page.locator('#catalog-panel-devices')).to_contain_text('Device brand is inactive')
                run['devices_overflow'] = overflow(page)
                screenshot(page, f'workspace-devices-{width}')

                starter = page.get_by_role('region', name='Suggested catalogue setup')
                starter.get_by_role('button', name='Preview starter setup', exact=True).click()
                starter.get_by_role('checkbox', name='Protective Case', exact=True).check()
                starter.get_by_role('button', name='Review selected setup', exact=True).click()
                expect(starter.get_by_role('heading', name='Review before creating references', exact=True)).to_be_visible()
                check(len(requests(page, '/setup/preview')) == 1 and not requests(page, '/setup/apply'), 'Preview is read-only mocked request')
                screenshot(page, f'workspace-preview-{width}')
                starter.get_by_role('button', name='Cancel preview', exact=True).click()
                expect(starter.get_by_role('button', name='Confirm reference setup', exact=True)).to_have_count(0)
                check(not requests(page, '/setup/apply'), 'Cancel never applies')
                starter.get_by_role('button', name='Review selected setup', exact=True).click()
                starter.get_by_role('button', name='Confirm reference setup', exact=True).click()
                expect(starter.get_by_role('status')).to_contain_text('No products or devices changed')
                apply = requests(page, '/setup/apply')
                check(len(apply) == 1 and apply[0]['body']['fingerprint'] == 'a' * 64, 'Explicit confirm sends preview fingerprint')
                run['checks'].append('Starter selects group, previews exact synthetic changes, cancels without apply, explicit confirmation sends fingerprint')

                visit('scenario=conflict')
                starter = page.get_by_role('region', name='Suggested catalogue setup')
                starter.get_by_role('button', name='Preview starter setup', exact=True).click()
                starter.get_by_role('checkbox', name='Protective Case', exact=True).check()
                starter.get_by_role('button', name='Review selected setup', exact=True).click()
                expect(starter.get_by_role('button', name='Confirm reference setup', exact=True)).to_be_disabled()
                check(not requests(page, '/setup/apply'), 'Conflict cannot apply')
                visit('scenario=stale')
                starter = page.get_by_role('region', name='Suggested catalogue setup')
                starter.get_by_role('button', name='Preview starter setup', exact=True).click()
                starter.get_by_role('checkbox', name='Protective Case', exact=True).check()
                starter.get_by_role('button', name='Review selected setup', exact=True).click()
                starter.get_by_role('button', name='Confirm reference setup', exact=True).click()
                expect(starter.get_by_role('alert')).to_contain_text('preview is stale')
                expect(starter.get_by_role('button', name='Confirm reference setup', exact=True)).to_have_count(0)
                run['checks'].append('Conflict disables confirm; stale apply error clears preview and requires review again')

                visit('mode=viewer&section=details')
                expect(page.locator('#catalog-panel-details')).to_be_visible()
                expect(page.get_by_role('button', name='Save reference', exact=True)).to_have_count(0)
                expect(page.get_by_role('button', name='Preview starter setup', exact=True)).to_have_count(0)
                run['checks'].append('Viewer deep link permits inspection without edit/setup actions')

                visit('mode=product')
                page.get_by_label('Product name', exact=True).fill('Unsaved product survives new tabs')
                page.get_by_text('Advanced: optional product type and detail fields', exact=True).click()
                for label, section in [('Manage product types (new tab)', 'types'), ('Manage device brands and models (new tab)', 'devices'), ('Manage type detail fields (new tab)', 'details')]:
                    link = page.get_by_role('link', name=label, exact=True)
                    expect(link).to_have_attribute('target', '_blank')
                    expect(link).to_have_attribute('rel', 'noopener noreferrer')
                    with page.expect_popup() as popup_info:
                        link.click()
                    popup = popup_info.value
                    popup.wait_for_selector('html[data-hydrated="true"]')
                    expect(popup.locator(f'#catalog-panel-{section}')).to_be_visible()
                    check(popup.evaluate('window.opener === null'), 'New tab has no opener')
                    popup.close()
                    expect(page.get_by_label('Product name', exact=True)).to_have_value('Unsaved product survives new tabs')
                page.get_by_role('button', name='Reload catalogue choices', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='Catalogue choices reloaded')).to_be_visible()
                expect(page.get_by_label('Product name', exact=True)).to_have_value('Unsaved product survives new tabs')
                check(page.evaluate('window.__catalogFixture.refreshes') == 0, 'Choice reload does not refresh route')
                check(page.evaluate('window.__catalogFixture.unexpectedFetch.length') == 0, 'No unexpected fetches')
                run['checks'].append('Real product links open correct workspace panels without discarding draft; noopener; memory-only reload retains product edits')
            except Exception as error:
                results['errors'].append(f'{width}px: {error}')
                screenshot(page, f'failure-{width}')
            finally:
                context.close()
    finally:
        browser.close()
        (output / 'browser-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
check(not results['errors'] and not results['external_requests'], 'Fixture browser validation failed; inspect browser-results.json')
