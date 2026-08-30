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

## v3 editor improvements

- Selected objects now have a dedicated drag handle above the object. Drag the handle to move text, signatures, whiteouts, or highlights without interfering with text editing.
- The font menu includes common browser/system fonts and fonts detected from the current PDF page.
- **Match PDF text**: select an added text box, click **Match PDF text**, then click existing text on the page. The app copies the nearest detected font family and approximate size.
- **Upload font** accepts `.ttf` and `.otf`. Uploaded fonts are loaded locally in the browser and embedded into exported PDFs using `@pdf-lib/fontkit`.

### Font matching limitation
PDF.js can usually identify a PDF's internal font/fallback family and text size, but browsers cannot always extract and legally/reliably reuse an embedded PDF font file. For exact exported typography, use **Upload font** with the matching TTF/OTF font that you already have. Without an uploaded font, detected/non-standard fonts are previewed with the closest browser font and exported with a standard PDF fallback.

## v3.1 Match Font fix

- Keeps the selected added-text object active while Match PDF text mode is enabled.
- Uses PDF.js text style metadata plus font objects when available.
- Cleans subset font prefixes (for example `ABCDEF+ArialMT`).
- Prefers the exact clicked text run before falling back to nearest text.
- Matches font size independent of the current zoom level.
- Added text now scales visually with PDF zoom, and its point size is used consistently when exporting.

For PDFs with embedded/subset fonts, detected family names may still be approximations in the browser. Upload the corresponding TTF/OTF file when exact exported typography is required.

## v3.3 conversion tools
- PDF → Word (.docx): extracts the PDF text into editable Word paragraphs. Complex columns/tables may require cleanup; scanned PDFs require OCR (planned).
- PDF → PowerPoint (.pptx): creates one slide per PDF page and preserves the page appearance as a slide image.
- Conversion runs locally in the browser; no server upload is required.
