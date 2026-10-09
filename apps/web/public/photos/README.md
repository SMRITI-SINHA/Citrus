# CITRUS photo library

Genuine CITRUS photography only, downloaded on 9 Oct 2026 from citrusclothing.in (collection pages, banners, store-launch gallery) and the CITRUS Instagram account. Nothing here is drawn, generated or stock.

- `g/`: one garment per file (shirt, polo/tee or trouser), cropped to 3:4 from a CITRUS look photo. `src/lib/photos.ts` lists each with its garment type, colour and source URL. The app picks the shot of the same garment type with the nearest colour and shows a swatch when the colour is not an exact match.
- `look/`: the full collection photos, self-hosted copies of citrusclothing.in/all-collections.html.
- `brand/`: store front, store interiors and campaign banners.

Per-SKU product photos from WFX/Ginesys override all of this through `/photos/manifest.json` (`"STYLE|Colour": url`).
