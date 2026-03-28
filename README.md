# web-feedback-tools

Capture full-page screenshots, numbered section screenshots, and optional PDFs with Playwright for visual feedback loops.

## Install

```bash
npm install
npx playwright install chromium
```

## CLI

```bash
node ./bin/web-feedback-capture.mjs --help
```

Or, once linked or installed globally:

```bash
web-feedback-capture --help
```

## Examples

Capture a live URL:

```bash
web-feedback-capture \
  --base-url https://example.com \
  --output-dir artifacts/example-review
```

Capture a local Vite project:

```bash
web-feedback-capture \
  --project-dir . \
  --variant before
```

Capture before/after variants:

```bash
web-feedback-capture --project-dir . --output-dir artifacts/hero-tune --variant before
web-feedback-capture --project-dir . --output-dir artifacts/hero-tune --variant after --skip-build
```

Use a custom server command:

```bash
web-feedback-capture \
  --server-command "npm run dev" \
  --ready-url http://127.0.0.1:3000 \
  --base-url http://127.0.0.1:3000
```

## Output structure

```text
artifacts/web-feedback/<run-or-variant>/
  manifest.json
  pages/
    desktop/00-full.png
    tablet/00-full.png
    mobile/00-full.png
  sections/
    01-hero/
      desktop.png
      tablet.png
      mobile.png
  pdf/
    desktop/page.pdf
```

## Notes

- Section discovery defaults to `main [data-section]`.
- Use `--section-selector` to adapt to other page structures.
- Use `--variant before` and `--variant after` to keep comparison runs aligned.
