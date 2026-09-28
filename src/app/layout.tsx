import "./globals.css";

import { getThemeSettings } from "@/lib/content";

const DEFAULT_FONT = "Inter";

/** Fallback stack used when an editor picks a custom Google font. */
const FONT_FALLBACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getThemeSettings();

  // Font family — a custom value swaps the Google Fonts stylesheet and the
  // body/OPPO font stacks; unset or "Inter" keeps the original link exactly.
  const rawFont = settings.fontFamily?.trim() ?? "";
  const fontFamily = rawFont.replace(/['"]/g, "");
  const useCustomFont = fontFamily.length > 0 && fontFamily !== DEFAULT_FONT;

  // CSS variable overrides — emitted only when an editor set a value, so the
  // untouched site ships byte-identical CSS. Doubled class for specificity
  // over the `.oppo-root` token block in oppo.css regardless of order.
  const varOverrides: string[] = [];
  if (settings.oppoPrimaryColor) varOverrides.push(`--oppo-green: ${settings.oppoPrimaryColor}`);
  if (settings.oppoGreenDark) varOverrides.push(`--oppo-green-dark: ${settings.oppoGreenDark}`);
  if (settings.oppoGreenLight) varOverrides.push(`--oppo-green-light: ${settings.oppoGreenLight}`);
  if (useCustomFont) varOverrides.push(`--oppo-font: '${fontFamily}', ${FONT_FALLBACK}`);

  const googleFontHref = useCustomFont
    ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily).replaceAll("%20", "+")}:wght@300;400;500;600;700;800;900&display=swap`
    : "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap";

  return (
    <html lang="en-US">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href={googleFontHref}
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Mona+Sans:ital,wght@0,200..900;1,200..900&display=swap"
          rel="stylesheet"
        />
        {varOverrides.length > 0 && (
          <style
            dangerouslySetInnerHTML={{
              __html: `.oppo-root.oppo-root{${varOverrides.join(";")}}`,
            }}
          />
        )}
      </head>
      <body
        // Browser extensions (e.g. ColorZilla's cz-shortcut-listen) inject
        // attributes on <body> before React hydrates, which React flags as a
        // hydration mismatch. Suppression only affects this element's
        // attributes — not its children — and is the standard mitigation.
        suppressHydrationWarning
        style={
          useCustomFont
            ? { fontFamily: `'${fontFamily}', ${FONT_FALLBACK}` }
            : undefined
        }
      >
        {children}
      </body>
    </html>
  );
}
