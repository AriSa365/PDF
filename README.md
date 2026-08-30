# PDF Workbench v2

A local-first browser PDF editor built with React, Vite, PDF.js and pdf-lib. It runs locally and can be hosted on GitHub Pages.

## New in v2

- Object-based text editing for text you add
- Drag and reposition added text
- Resize text boxes
- Font family, size, bold, italic, underline, color and opacity controls
- Whiteout/erase tool for covering existing PDF text, followed by replacement text
- Signature tool: draw, type, upload, or reuse a saved signature
- Move and resize signatures
- Delete and duplicate selected objects
- Undo/redo
- Highlight and freehand drawing
- Export flattened edited PDF
- Existing page tools: rotate, extract, delete, merge PDFs, images to PDF

## Important limitation

The Whiteout tool visually erases existing PDF content by drawing an opaque rectangle over it. It does not rewrite the original PDF text stream. True Acrobat-style editing of arbitrary embedded PDF text requires a much more sophisticated PDF content engine because fonts, glyph positioning and scanned pages vary across PDFs.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

The included `.github/workflows/deploy.yml` deploys `dist` after every push to `main`. In GitHub, set **Settings → Pages → Source → GitHub Actions**.

The Vite base is relative (`./`), so the build works from a repository subpath such as `https://arisa365.github.io/PDF/`.
