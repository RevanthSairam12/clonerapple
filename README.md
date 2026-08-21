# apple.com homepage clone

A standalone Next.js 16 app that reproduces the apple.com homepage — layout, typography,
assets and interactions — measured against the live page.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build && npm run start    # production
npm run typecheck                 # tsc --noEmit
```

Requires Node 20.9+.

## What's inside

```
src/app/
  page.tsx            route + metadata
  layout.tsx          html/body shell
  globals.css         tailwind + the clone's stylesheet
  apple-clone.css     design tokens, SF Pro @font-face, and the rules
                      utilities can't express (dot pills, scrims, hairlines)
src/components/sites/www-apple-com-736d3707/root-8a5edab2/
  AppleHomePage.tsx   page shell; owns banner state and content offset
  LocaleBanner.tsx    fixed dismissible banner
  GlobalNav.tsx       fixed bar, click-driven flyouts, search, mobile drawer
  NavFlyoutGroups.tsx / NavSearchPanel.tsx
  HeroSection.tsx     3 full-bleed tiles (+ HeroInlineMedia video stage)
  PromoSection.tsx    6 tiles, 1 → 2 columns
  TileCard.tsx        shared tile
  EndlessEntertainmentGallery.tsx   two synced carousels
  GlobalFooter.tsx    footnotes, directory (accordion on mobile), legal row
  ArtDirectedPicture.tsx
  icons.tsx           13 icon components
  data/               nav, tiles, gallery, footer, locale-banner content
public/sites/www-apple-com-736d3707/root-8a5edab2/
  images/ videos/ fonts/ seo/     256 files
```

## Behaviour notes

- **Breakpoints** 735 / 834 / 1069 px (Tailwind variants `am:` `anav:` `al:`).
- **Nav flyouts open on click**, not hover — that's what the live page does.
- **Gallery** auto-advances every 4.16 s with a 1 s slide; dots jump, the round
  control pauses.
- **Locale banner** offsets the fixed nav; dismissing it lifts the page content.
- Images use plain `<picture>` + `<source media>` rather than `next/image`, because
  the design art-directs a different crop per breakpoint (and per viewport height
  for the hero) — something `next/image` can't express.

## Assets

All imagery, video, wordmarks and the SF Pro font files were downloaded from
apple.com and remain **© Apple Inc.** They're included here so the page renders
exactly like the original. This project is a personal/educational reproduction —
it isn't affiliated with or endorsed by Apple, and the assets aren't licensed for
redistribution or commercial use. Swap them for your own before publishing
anything.

Outbound links still point at apple.com, so clicking a CTA navigates off-site.
