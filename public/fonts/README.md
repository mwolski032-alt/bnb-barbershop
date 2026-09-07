# Sitka Heading

The app uses `"Sitka Heading", Sitka, Georgia, serif` globally via `--font-app`.
No distributable Sitka font is included in this repository. Do not copy a system font
or download a substitute without a suitable web-embedding licence.

When licensed webfonts are supplied, put them here and add these declarations before
`:root` in `app/theme.css` (adjust filenames to the actual supplied files):

```css
@font-face {
  font-family: "Sitka Heading";
  src: url("/fonts/sitka-heading-regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Sitka Heading";
  src: url("/fonts/sitka-heading-bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

Keep the declarations disabled until the files exist. Current Android/iOS devices
without Sitka use Georgia or the platform serif fallback; no missing font requests
or external font downloads are made.
