# Data

- **Image-level CSV** — Source dataset lives in `data/` with a name like **image_level_id.csv** or **image_level_tags.csv**. One row per image; fields include `image_file`, `image_path`, `climate`, `atmosphere`, `product_type`, `object_association`, `avg_sat_pct`, `avg_val_pct`, `neutral_ratio_pct`, `dominant_hue_bucket`, `dominant_temp_bin`, etc.
- **image_metadata.json** — Generated from that CSV. The questionnaire loads this JSON only (it does not read the CSV at runtime).

To regenerate the JSON after editing the CSV:

```bash
node scripts/convertImageMetadata.js
```

The script looks for `image_level_id.csv` first, then `image_level_tags.csv`. Run from the project root.
