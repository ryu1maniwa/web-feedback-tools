---
name: web-feedback
description: Use this skill to capture full-page screenshots, numbered section screenshots, and PDFs from web pages with Playwright, then run visual feedback loops over hierarchy, spacing, copy density, and responsive behavior. Works for local apps, staging URLs, and before/after comparisons.
---

# Web Feedback

Use this skill when the user wants to visually review or improve a web page.

## Primary command

```bash
web-feedback-capture --base-url https://example.com
```

## Common modes

Local project with built-in preview:

```bash
web-feedback-capture --project-dir . --variant before
```

Already-running app:

```bash
web-feedback-capture --base-url http://127.0.0.1:3000 --variant after
```

Custom server command:

```bash
web-feedback-capture \
  --server-command "npm run dev" \
  --ready-url http://127.0.0.1:3000 \
  --base-url http://127.0.0.1:3000
```

## Outputs

- `pages/<viewport>/00-full.png`
- `sections/<index-name>/<viewport>.png`
- `pdf/desktop/page.pdf`
- `manifest.json`

## Review loop

1. Capture a `before` variant.
2. Inspect full-page and section artifacts.
3. Assume there are issues. Treat review as a bug hunt, not a confirmation pass.
4. Look for overlap, overflow, uneven spacing, weak hierarchy, low contrast, edge collisions, repeated-card misalignment, and stale placeholder copy.
5. Patch the target page.
6. Capture an `after` variant.
7. Re-check the same sections plus the relevant full-page screenshots. One fix can create another issue nearby.
8. If the first pass finds no issues, review again more critically before concluding.
