#!/usr/bin/env python3
"""Capture the one-page owner guide screenshots from the test-only fixture.

The fixture renders the real store-admin components and stylesheet with sample
data. It never contacts Next, a database or an auth service, so the images are
component previews, not authenticated production captures. The guide says so.

Run with python -I scripts/phase6-guide-screenshots.py --port 43131
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=43131)
parser.add_argument('--output', default='docs/images/phase6')
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('port must be between 1024 and 65535')

root = Path(__file__).resolve().parents[1]
origin = f'http://127.0.0.1:{args.port}'
output = (root / args.output).resolve()
if not output.is_relative_to(root / 'docs' / 'images'):
    parser.error('output must be under docs/images')
output.mkdir(parents=True, exist_ok=True)

taken = []


def wait_for_fixture(timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f'{origin}/?mode=edit', timeout=5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(2)
    raise SystemExit(f'fixture at {origin} did not become ready')


wait_for_fixture()


def visit(page, mode):
    response = page.goto(f'{origin}/?mode={mode}')
    if response is None or response.status != 200:
        raise AssertionError(f'fixture GET {mode} failed')
    page.wait_for_selector('html[data-hydrated="true"]', timeout=90000)
    # The save bar is sticky at the bottom of the viewport. In a full-element
    # capture it paints over the middle of the table, so hold it in normal flow.
    page.add_style_tag(content='[aria-label="Save product"]{position:static!important;box-shadow:none!important}')


def shot(page, name, locator=None):
    path = output / f'{name}.png'
    if locator is not None:
        locator.scroll_into_view_if_needed()
        locator.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=False)
    if path.stat().st_size < 5_000:
        raise AssertionError(f'{name}.png looks empty ({path.stat().st_size} bytes)')
    taken.append(name)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    try:
        # Wide enough for the nine-column options table to fit without the
        # horizontal scroll the wrap would otherwise apply inside a capture.
        context = browser.new_context(viewport={'width': 1680, 'height': 1100}, device_scale_factor=1)
        page = context.new_page()

        def guard(route):
            target = urlsplit(route.request.url)
            if f'{target.scheme}://{target.netloc}' != origin:
                route.abort()
            else:
                route.continue_()

        context.route('**/*', guard)

        # 01/02/05 come from the product editor fixture.
        visit(page, 'edit')
        options = page.locator('#product-step-2')
        expect(options).to_be_visible()

        # 05 first, at the real layout: dropping the sidebar later would let the
        # section nav overlap the heading in this shot.
        stock = page.locator('#product-step-3')
        expect(stock).to_be_visible()
        stock.scroll_into_view_if_needed()
        shot(page, '05-stock', stock)

        # The editor's own sidebar takes 234px of the content row; drop it and the
        # fixture's width cap for the table shots so the nine-column table fits at
        # its real column widths instead of scrolling inside its wrap.
        page.add_style_tag(content=(
            '.fixture-main{max-width:none!important}'
            '[class~="lg:grid"]{display:block!important}'
            'nav[aria-label="Product sections"]{display:none!important}'
        ))

        # 01: the options table itself: caption, headers, rows, history. Clip to
        # the scroll wrap's width so the empty band past the last column is not
        # included; the wrap scrolls, so the table box can be wider than it paints.
        table = page.locator('#product-step-2 table.sa-table').last
        expect(table).to_be_visible()

        def document_box(locator):
            return locator.evaluate("""node => {
                const rect = node.getBoundingClientRect();
                return {x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height};
            }""")

        table_box = document_box(table)
        wrap_box = document_box(page.locator('#product-step-2 .sa-table-wrap').last)
        page.screenshot(path=str(output / '01-options-table.png'), full_page=True, clip={
            'x': max(0, wrap_box['x']),
            'y': max(0, table_box['y']),
            'width': min(table_box['width'], wrap_box['width']),
            'height': table_box['height'],
        })
        if (output / '01-options-table.png').stat().st_size < 5_000:
            raise AssertionError('01-options-table.png looks empty')
        taken.append('01-options-table')

        # 02: Sell by, SKU pattern and Add missing rows, clipped from the heading
        # down to the button so the region is what the guide talks about.
        page.locator('#product-step-2').evaluate('node => node.scrollIntoView({block: "start"})')
        heading = page.get_by_role('heading', name='Options, price and stock', exact=True)
        add = page.get_by_role('button', name='Add missing rows', exact=True)
        expect(heading).to_be_visible()
        expect(add).to_be_visible()
        top = heading.bounding_box()
        bottom = add.bounding_box()
        section = options.bounding_box()
        clip = {
            'x': max(0, section['x'] + 8),
            'y': max(0, top['y'] - 12),
            'width': min(section['width'] - 16, 1500),
            'height': (bottom['y'] + bottom['height']) - top['y'] + 24,
        }
        page.screenshot(path=str(output / '02-sell-by.png'), clip=clip)
        if (output / '02-sell-by.png').stat().st_size < 5_000:
            raise AssertionError('02-sell-by.png looks empty')
        taken.append('02-sell-by')

        # 03: the owner model import as CSV, reviewed before confirming. The third
        # row is a near-match so the review line the guide describes is visible.
        visit(page, 'models-owner')
        page.get_by_text('Import, preview and downloads', exact=True).click()
        page.get_by_label('Input format').select_option('csv')
        page.get_by_role('textbox', name='Shared-list input', exact=True).fill('\n'.join([
            'brand,model,sort_order,active',
            'Example devices,iPhone 16,1,true',
            'Example devices,iPhone 16 Pro,2,true',
            'Example devices,iphone16 pro,3,true',
        ]))
        page.get_by_role('button', name='Preview shared list', exact=True).click()
        expect(page.get_by_text('Preview — not yet saved', exact=True)).to_be_visible()
        panel = page.locator('.sa-shared-list').first
        expect(panel).to_be_visible()
        shot(page, '03-model-import', panel)

        # 04: paste colours, preview them, keep the preview visible.
        visit(page, 'colours-owner')
        page.get_by_text('Import, preview and downloads', exact=True).click()
        page.get_by_role('textbox', name='Shared-list input', exact=True).fill(
            'Red #FF3B30\nBlack #1D1D1F\nBlue #0071E3'
        )
        page.get_by_role('button', name='Preview shared list', exact=True).click()
        expect(page.get_by_text('Preview — not yet saved', exact=True)).to_be_visible()
        shot(page, '04-colour-paste', page.locator('.sa-shared-list').first)

        context.close()
    finally:
        browser.close()

print(json.dumps({'screenshots': taken, 'output': str(output)}, indent=2))
