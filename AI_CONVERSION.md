# Editable PDF conversion

Version 3.4 no longer converts PDF pages to screenshots for Word or PowerPoint.

## Smart Local mode
Uses PDF.js to extract individual text glyphs/runs with coordinates, font metadata, size, style and reading order. It reconstructs lines and paragraphs locally in the browser.

- Word: real editable paragraphs/headings/lists.
- PowerPoint: real editable text boxes positioned according to the original PDF page.
- No external service and no API key.

## Local AI mode (optional)
The app can send only reconstructed text-block metadata to a local Ollama server for semantic classification and reading-order refinement. The PDF remains on your machine.

1. Install Ollama.
2. Pull a model, e.g. `ollama pull qwen2.5:7b` (or type any installed model name in the app).
3. Allow the browser origin to access Ollama if needed. For local Vite use, set `OLLAMA_ORIGINS=http://localhost:5173` before starting Ollama. For GitHub Pages, add the exact Pages origin.
4. Choose **Local AI (Ollama)** in Smart Convert.

## Current limitation
Text is fully editable. Vector drawings, charts, photos, and complex tables are not yet reconstructed as native Word/PPT objects. The next stage is visual-object extraction and table reconstruction.
