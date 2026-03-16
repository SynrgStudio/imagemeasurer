# ImageMeasurer OSS

Open-source static web app to measure distances on an image from one known reference length.

## Features

- 100% frontend (plain HTML, CSS, JavaScript)
- No backend
- No database
- No cookies
- No tracking
- One-button calibration flow
- Editable lines with hover handles
- Temporary drag magnifier toggle
- CSV/TXT export
- Dark/light mode (default: dark)
- Works on desktop and mobile
- Ready for GitHub Pages

## How to use

1. Upload an image.
2. Enter known value and unit (for example `25 cm`).
3. Click `Apply known length`.
4. Draw the first line on the known segment (reference).
5. Draw as many extra lines as you want to measure.
6. Hover lines to reveal handles and adjust endpoints if needed.
7. Export results with `Export CSV` or `Export TXT`.

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. Go to `Settings > Pages`.
3. Under `Build and deployment`, choose:
   - `Source: Deploy from a branch`
   - `Branch: main (root)`
4. Save and wait for the public URL.

## Local development

You can open `index.html` directly, or run a tiny local server.

Example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## License

MIT
