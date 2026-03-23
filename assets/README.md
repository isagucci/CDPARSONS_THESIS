# Questionnaire images

Images are loaded from these folders (same format for all three):

- **images_brazil/** — Brazil (tropical). Filenames match `file` in `data/results_brazil_superflat.json` (e.g. `A-GD1.jpg`).
- **images_egypt/** — Egypt (arid). Filenames match `file` in `data/results_egypt.json` (e.g. `B-GD1.jpg`).
- **images_finland/** — Finland (polar). Filenames match `file` in `data/results_finland.json` (e.g. `E-GD1.jpeg`).

Paths used by the app: `assets/images_brazil/`, `assets/images_egypt/`, `assets/images_finland/`.

## Results buffer (questionnaire → results)

- Place your loading GIF at **`assets/buffer.gif`** (shown for 4× loop duration before navigating to results).
- If your file has another name (e.g. `buffer gif.gif`), either rename it or change `BUFFER_GIF_URL` in `scripts/questionnaire.js`.
- Tune **`BUFFER_GIF_LOOP_DURATION_MS`** in `questionnaire.js` to match one full play of your GIF (total wait = that value × 4).
