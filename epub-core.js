function getZip() {
  if (!globalThis.JSZip) throw new Error('JSZip is not loaded');
  return globalThis.JSZip;
}

function normalizePath(path) {
  const parts = String(path || '')
    .replace(/\\/g, '/')
    .split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirname(path) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx + 1);
}

function resolvePath(baseDir, href) {
  if (!href) return '';
  if (/^(data:|https?:|mailto:|#)/i.test(href)) return href;
  return normalizePath((baseDir || '') + href);
}

function baseName(path) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

export async function parseEpub(buf, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const JSZip = getZip();
  const zip = await JSZip.loadAsync(buf);
  log('EPUB opened');

  const cxml = await zip.file('META-INF/container.xml')?.async('text');
  if (!cxml) throw new Error('Invalid EPUB: no container.xml');

  const parser = new DOMParser();
  const cdoc = parser.parseFromString(cxml, 'application/xml');
  const opfPath = cdoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('No rootfile in container.xml');

  const normOpfPath = normalizePath(opfPath);
  const opfDir = dirname(normOpfPath);
  log('OPF: ' + normOpfPath);

  const opfXml = await zip.file(normOpfPath)?.async('text');
  if (!opfXml) throw new Error('Cannot read OPF');

  const opfDoc = parser.parseFromString(opfXml, 'application/xml');
  const titleEl = opfDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]
    || opfDoc.querySelector('metadata title');
  const bookTitle = titleEl?.textContent?.trim() || 'Untitled';
  log('Title: ' + bookTitle);

  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach((item) => {
    const id = item.getAttribute('id');
    if (!id) return;
    manifest[id] = {
      href: item.getAttribute('href') || '',
      mt: item.getAttribute('media-type') || '',
    };
  });

  const spine = [];
  opfDoc.querySelectorAll('spine itemref').forEach((itemRef) => {
    const idref = itemRef.getAttribute('idref');
    if (idref && manifest[idref]) spine.push(manifest[idref]);
  });
  log(`Spine: ${spine.length} items`);
  if (!spine.length) throw new Error('Empty spine');

  const imgs = new Map();
  for (const entry of Object.values(manifest)) {
    if (!entry.mt.startsWith('image/')) continue;
    const fullPath = resolvePath(opfDir, entry.href);
    const file = zip.file(fullPath) || zip.file(entry.href);
    if (!file) continue;
    try {
      const b64 = await file.async('base64');
      const uri = `data:${entry.mt};base64,${b64}`;
      imgs.set(fullPath, uri);
      imgs.set(normalizePath(entry.href), uri);
      imgs.set(baseName(entry.href), uri);
    } catch (_) {
      log('Failed to decode image: ' + entry.href);
    }
  }

  const chapters = [];
  for (const item of spine) {
    const fullPath = resolvePath(opfDir, item.href);
    const file = zip.file(fullPath) || zip.file(item.href);
    if (!file) {
      log('Missing: ' + item.href);
      continue;
    }

    let html = await file.async('text');
    const htmlDir = dirname(fullPath);
    html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, a, src, b) => {
      const resolved = resolvePath(htmlDir, src);
      const clean = normalizePath(src);
      return a + (imgs.get(resolved) || imgs.get(clean) || imgs.get(baseName(src)) || src) + b;
    });

    chapters.push({ href: item.href, html });
  }

  log(`${chapters.length} chapters in correct order`);
  return { bookTitle, chapters };
}

export function toBlocks(html) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const div = document.createElement('div');
  div.innerHTML = match ? match[1] : html;
  const out = [];

  function isChapterTitle(node) {
    const text = node.textContent.trim();
    if (text.length < 2 || text.length > 200) return false;
    return /^(глава|chapter|часть|part|книга|book|раздел|section|пролог|эпилог|prologue|epilogue)\b/i.test(text);
  }

  (function walk(node) {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) out.push({ T: 't', text });
      return;
    }

    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'svg', 'nav'].includes(tag)) return;

    if (/^h[1-6]$/.test(tag)) {
      const text = node.textContent.trim();
      if (text) out.push({ T: 'h', lv: Number(tag[1]), text });
      return;
    }

    if (tag === 'br') {
      out.push({ T: 'br' });
      return;
    }

    if (tag === 'hr') {
      out.push({ T: 'hr' });
      return;
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('data:image')) out.push({ T: 'img', src });
      return;
    }

    if (tag === 'p') {
      let imageCount = 0;
      node.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image')) {
          out.push({ T: 'img', src });
          imageCount += 1;
        }
      });

      const text = node.textContent.trim();
      if (node.classList.contains('empty-line') || (!text && imageCount === 0)) {
        out.push({ T: 'br' });
        return;
      }
      if (!text) return;

      if (isChapterTitle(node)) {
        out.push({ T: 'h', lv: 1, text });
        return;
      }

      const segments = [];
      (function walkParagraph(paragraphNode) {
        if (paragraphNode.nodeType === 3) {
          segments.push(paragraphNode.textContent.replace(/\s+/g, ' '));
          return;
        }
        if (paragraphNode.nodeType !== 1) return;
        if (paragraphNode.tagName === 'BR') {
          segments.push('\n');
          return;
        }
        for (const child of paragraphNode.childNodes) walkParagraph(child);
      }(node));

      const parts = segments.join('').split('\n');
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i].trim();
        if (part) out.push({ T: 'p', text: part });
        if (i < parts.length - 1) out.push({ T: 'br' });
      }
      return;
    }

    if (['blockquote', 'li', 'figcaption', 'td', 'th', 'dt', 'dd', 'address', 'pre'].includes(tag)) {
      node.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:image')) out.push({ T: 'img', src });
      });
      const text = node.textContent.trim();
      if (text) out.push({ T: 'p', text: (tag === 'li' ? '• ' : '') + text });
      return;
    }

    for (const child of node.childNodes) walk(child);
  }(div));

  return out;
}
