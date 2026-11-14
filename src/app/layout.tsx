import "./globals.css";

import { getContent, getThemeSettings } from "@/lib/content";
import { CartProvider } from "@/lib/cart/CartContext";
import { StorefrontNavProvider } from "@/components/header/StorefrontNavContext";
import type { NavLabelsOverride } from "@/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides";
import { FONT_FALLBACK, FONT_LOADERS } from "@/lib/fontLoaders";
import { resolveSiteFontName } from "@/lib/fonts";
import { safeThemeColor } from "@/lib/website/theme-rules";
import { readTrustBarContent } from "@/lib/website/trust-bar";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [settings, navOverride, trustBarOverride] = await Promise.all([
    getThemeSettings(),
    getContent<NavLabelsOverride | undefined>("apple.nav", undefined),
    readTrustBarContent(),
  ]);

  // Font family — resolved against the allow-list in src/lib/fonts.ts and
  // loaded by next/font, which self-hosts every face. Nothing here can reach
  // an external font host: the stored value only ever selects from the fixed
  // set of loaders, and an unrecognised value falls back to the default.
  const font = FONT_LOADERS[resolveSiteFontName(settings.fontFamily)];

  // CSS variable overrides — emitted only when an editor set a value, so the
  // untouched site ships byte-identical CSS. Doubled class for specificity
  // over the `.oppo-root` token block in oppo.css regardless of order.
  // Only a complete hex colour reaches the stylesheet. A stored value such as
  // `red; }` or `</style><script>…` is ignored and the coded token stands.
  const varOverrides: string[] = [];
  const primaryColor = safeThemeColor(settings.oppoPrimaryColor);
  const greenDark = safeThemeColor(settings.oppoGreenDark);
  const greenLight = safeThemeColor(settings.oppoGreenLight);
  if (primaryColor) varOverrides.push(`--oppo-green: ${primaryColor}`);
  if (greenDark) varOverrides.push(`--oppo-green-dark: ${greenDark}`);
  if (greenLight) varOverrides.push(`--oppo-green-light: ${greenLight}`);
  // Kept pointing at the self-hosted face rather than deleted: the token is set
  // here but consumed by the OPPO stylesheet, which is not in this tree.
  varOverrides.push(`--oppo-font: var(--font-site), ${FONT_FALLBACK}`);

  return (
    // `font.variable` publishes the chosen face as `--font-site`. The global
    // tokens (`--gz-font-text/display/footer` in gadzio.css, `--cp-font` in
    // cases.css and accessory-category.css) read that property, so applying it
    // here on <html> is what makes the setting reach every page.
    <html lang="en-US" className={font.variable}>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `.oppo-root.oppo-root{${varOverrides.join(";")}}`,
          }}
        />
      </head>
      <body
        // Browser extensions (e.g. ColorZilla's cz-shortcut-listen) inject
        // attributes on <body> before React hydrates, which React flags as a
        // hydration mismatch. Suppression only affects this element's
        // attributes — not its children — and is the standard mitigation.
        suppressHydrationWarning
      >
        <CartProvider>
          <StorefrontNavProvider
            navOverride={navOverride}
            trustBarOverride={trustBarOverride}
          >
            {children}
          </StorefrontNavProvider>
        </CartProvider>
      </body>
    </html>
  );
}
