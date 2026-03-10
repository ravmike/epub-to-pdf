# EPUB → PDF / DOCX Converter

Client-side EPUB converter. Runs entirely in the browser — no server, no uploads.

**Live**: https://ravmike.github.io/epub-to-pdf/

## Architecture

Static browser app with:
- `index.html` — EPUB → PDF flow
- `docx.html` — EPUB → DOCX flow tuned for ElevenReader / reader-app ingestion
- `epub-core.js` — shared EPUB parsing + HTML block normalization

Core libraries:
- **JSZip** — unpack EPUB (which is a ZIP)
- **jsPDF** — generate PDF in `index.html`
- **docx@9.5.1** — generate DOCX in `docx.html`
- **Noto Sans** — Unicode font loaded from Google Fonts CDN at runtime
- Native browser download APIs for both outputs

Flows:
- `EPUB (ZIP) → parse OPF spine → extract chapter XHTML → toBlocks() → render to PDF`
- `EPUB (ZIP) → parse OPF spine → extract chapter XHTML → toBlocks() → map blocks to Word paragraphs/headings/images → pack DOCX`

## Key functions

- `parseEpub(arrayBuffer, { log })` in `epub-core.js` — unzips EPUB, reads OPF, resolves spine order, inlines manifest images as data URIs, returns `{ bookTitle, chapters }`
- `toBlocks(html)` in `epub-core.js` — parses chapter HTML into typed blocks: `{T:'h'}` (heading), `{T:'p'}` (paragraph), `{T:'br'}` (break), `{T:'hr'}`, `{T:'img'}`, `{T:'t'}` (bare text)
- PDF `writeText(...)` in `index.html` — writes wrapped text with page breaks and spacing
- DOCX `buildDoc(epub)` in `docx.html` — maps blocks to Word title / TOC / headings / paragraphs / images and returns a `Document`

## Chapter detection

Many EPUBs (especially FB2→EPUB conversions) lack semantic `<h1>`–`<h6>` tags. The converter detects chapters by:
1. Preserving semantic HTML headings when present
2. Detecting chapter-like paragraph text matching patterns like "Глава N.", "Chapter N.", "Часть", "Part", etc.

Important: spine item boundaries are not treated as chapter/page boundaries by themselves.

## PDF features

- Paragraph first-line indent (7mm)
- Empty-line breaks preserved from `<p class="empty-line"/>`
- PDF outline/bookmarks for chapter navigation
- Configurable page size, font size, margins, line height

## DOCX features

- Title paragraph from EPUB metadata
- Word TOC field near the top of the document
- EPUB headings mapped to Word `Heading 1/2/3`
- Paragraph first-line indent
- Embedded EPUB images when they resolve to supported data URIs
- Uses Word-native fonts instead of runtime webfont downloads
- No forced page breaks between spine items or headings

## Testing

Sample EPUB files go in `samples/` (gitignored). Use Playwright via conda env `epub-test`:
```bash
conda run -n epub-test python /Users/michael/.agents/skills/webapp-testing/scripts/with_server.py \
  --server "python3 -m http.server 8128 --bind 127.0.0.1" --port 8128 \
  -- python /tmp/your_playwright_check.py
```

What to verify:
- `index.html` still converts EPUB to PDF without forcing a new page for every spine item
- `docx.html` downloads a `.docx` successfully
- generated DOCX contains a TOC field, heading structure, and `word/media/` entries when source EPUB has images

## Deployment

GitHub Pages via Actions workflow (`.github/workflows/pages.yml`). Pushes to `main` auto-deploy.
