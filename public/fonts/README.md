# Fonts

Self-hosted, SIL Open Font License 1.1. No external font requests are made.

- **Fraunces** (headings) - variable weight 400-700, `fraunces-latin` and `fraunces-latin-ext` (Polish letters). Source: Google Fonts.
- **Geist** (interface, buttons, prices, times) - variable weight 100-900, `geist-latin` and `geist-latin-ext`. Source: Vercel / Google Fonts.

The `@font-face` declarations live in `app/theme.css`; the four files are preloaded in `app/layout.tsx`.
Tokens: `--font-display` (headings), `--font-ui` (interface), `--font-app` (default, = `--font-ui`).
