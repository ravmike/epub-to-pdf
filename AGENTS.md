# EPUB → DOCX Converter

Client-side EPUB converter. Runs entirely in the browser — no server, no uploads.

**Live**: https://ravmike.github.io/epub-to-docx/

## Architecture

Static browser app with:
- `index.html` — primary EPUB → DOCX GitHub Pages entrypoint
- `docx.html` — legacy alias that redirects to `index.html`
- `epub-core.js` — shared EPUB parsing + HTML block normalization

Core libraries:
- **JSZip** — unpack EPUB (which is a ZIP)
- **docx@9.5.1** — generate DOCX in-browser
- Native browser download APIs for output

Flow:
- `EPUB (ZIP) → parse OPF spine → extract chapter XHTML → toBlocks() → map blocks to Word paragraphs/headings/images → pack DOCX`

## Key functions

- `parseEpub(arrayBuffer, { log })` in `epub-core.js` — unzips EPUB, reads OPF, resolves spine order, inlines manifest images as data URIs, returns `{ bookTitle, chapters }`
- `toBlocks(html)` in `epub-core.js` — parses chapter HTML into typed blocks: `{T:'h'}` (heading), `{T:'p'}` (paragraph), `{T:'br'}` (break), `{T:'hr'}`, `{T:'img'}`, `{T:'t'}` (bare text)
- DOCX `buildDoc(epub)` in `index.html` — maps blocks to Word title / headings / paragraphs / images and returns a `Document`

## Chapter detection

Many EPUBs (especially FB2→EPUB conversions) lack semantic `<h1>`–`<h6>` tags. The converter detects chapters by:
1. Preserving semantic HTML headings when present
2. Detecting chapter-like paragraph text matching patterns like "Глава N.", "Chapter N.", "Часть", "Part", etc.

Important: spine item boundaries are not treated as chapter/page boundaries by themselves.

## DOCX features

- Title paragraph from EPUB metadata
- EPUB headings mapped to Word `Heading 1/2/3`
- Paragraph first-line indent
- Embedded EPUB images when they resolve to supported data URIs
- Uses Word-native fonts instead of runtime webfont downloads
- No forced page breaks between spine items or headings
- No explicit Word TOC field; navigation is expected to come from real heading styles in Word / ElevenReader

## Testing

Sample EPUB files go in `samples/` (gitignored). Use Playwright via conda env `epub-test`:
```bash
conda run -n epub-test python /Users/michael/.agents/skills/webapp-testing/scripts/with_server.py \
  --server "python3 -m http.server 8128 --bind 127.0.0.1" --port 8128 \
  -- python /tmp/your_playwright_check.py
```

Preferred real-world regression set:
- `samples/_alex_barcelona-mirnij_voin.epub`
- `samples/piter_uotts-lozhnaya_slepota-1488914040.epub`

What to verify in browser:
- `index.html` downloads a `.docx` successfully
- `docx.html` redirects to `index.html`

What to verify by inspecting the generated `.docx` as a ZIP:
- `word/document.xml` exists and does not contain a `TOC` field instruction
- expected chapter / section titles are emitted inside `Heading1` / `Heading2` / `Heading3` paragraphs
- headings are real paragraph styles, not just bold body text
- numeric note labels are not promoted to headings
- decorative separators such as `* * *` are not promoted to headings
- `word/media/` entries exist when source EPUB contains supported images

Useful pattern:
1. Export DOCX in Playwright from `index.html`
2. Save the download to `/tmp/...`
3. Open it with Python `zipfile`
4. Inspect `word/document.xml` and `word/styles.xml`

Recent heading-semantic checks were run with a script shaped like:
```bash
conda run -n epub-test python /Users/michael/.agents/skills/webapp-testing/scripts/with_server.py \
  --server "python3 -m http.server 8133 --bind 127.0.0.1" --port 8133 \
  -- python /tmp/epub_docx_test/test_headings_docx.py
```

## Commit / Push Rules

- Do not commit `.DS_Store`, sample outputs, or ad-hoc files from `/tmp`
- Stage only files relevant to the task; leave unrelated local changes untouched
- Before committing DOCX changes, run at least one real browser export from `samples/` and inspect the resulting `.docx` internals
- If the task affects heading detection or navigation, verification must include checks inside `word/document.xml`, not only UI/download success
- Use a normal commit, not `--amend`, unless the user explicitly asks for amend
- Push only when the user explicitly asks to push
- Default deploy path is `origin main`; pushing to `main` triggers GitHub Pages deployment

## Deployment

GitHub Pages via Actions workflow (`.github/workflows/pages.yml`). Pushes to `main` auto-deploy.
