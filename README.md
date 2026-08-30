# PDF Workbench

A local-first PDF web app built with React, Vite, PDF.js and pdf-lib. It can run locally or be deployed as a static site on GitHub Pages.

## Included now

- Open local PDFs in the browser
- Multi-page PDF viewing
- Page navigation and zoom
- Search text across pages
- Highlight rectangles
- Freehand drawing
- Add text
- Export annotations into a new PDF
- Rotate a page
- Extract a page
- Delete a page
- Merge multiple PDFs
- Convert JPG/PNG images into a PDF
- Responsive desktop/mobile UI
- GitHub Pages deployment workflow
- PWA manifest for install-like browser use

All core operations are client-side. The app does not require a backend to use these tools.

## Run locally

Install Node.js 20+ or 22+, then:

```bash
npm install
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`.

Production test:

```bash
npm run build
npm run preview
```

## Put it on GitHub Pages

1. Create a new GitHub repository.
2. Upload/push all files in this folder to the repository's `main` branch.
3. In GitHub go to **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. Push to `main` again if necessary. The included `.github/workflows/deploy.yml` builds and publishes the app.

`vite.config.js` uses `base: './'`, so the build works from a GitHub project subdirectory without hard-coding a repository name.

## Privacy model

Opening/editing/merging PDFs is local to the browser. This makes the app appropriate for private local use and static GitHub hosting. Never add analytics, cloud upload, or AI APIs for sensitive documents without intentionally designing the privacy controls.

## Features to add next for an Acrobat-like tool

The web architecture can be extended with:

- Page thumbnails and drag-to-reorder pages
- Real text-selection-based highlighting
- Sticky notes/comments
- Signature drawing/stamps
- Form filling
- Redaction with permanent flattening
- Split by ranges
- Better compression/optimization
- OCR with Tesseract.js
- Scanning from mobile camera
- IndexedDB document library/recent files
- Offline service worker caching
- Optional AI chat/summarization (requires an API/backend; do not expose API keys in GitHub Pages)

### Browser limitation

True editing of existing PDF text/images at the level of Adobe Acrobat is substantially harder than overlay editing. `pdf-lib` can add/modify PDF objects, but it is not a complete Acrobat-style content editor. For advanced content editing, a commercial web PDF SDK is the most reliable option.
