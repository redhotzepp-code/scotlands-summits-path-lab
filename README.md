# Scotland's Summits — River Tilt Path Lab R1

**Target field-test date: Wednesday, 2 December 2026.**

This is a **separate browser prototype to verify reliable path visibility** around River Tilt, Tarf Hotel, Càrn a' Chlamain and Blair Atholl. It does **not** modify RC18.117 or replace RC18.118 R7.7's topographic Map Lab. It does not yet provide an offline Android map.

## Why this exists

The previous browser Map Lab omitted paths at wider zooms because its normal vector tiles generalised path data and its live Overpass enrichment frequently failed. This version builds a **real static GeoJSON dataset** from the Geofabrik Scotland OpenStreetMap extract and serves the file with the web page. During normal map use, **no live Overpass request occurs**. There is one access tier: every available footpath, stalkers' path (where mapped as a general path), cycleway, estate track and service track becomes eligible around the 1 km scale. Lines get stronger as you zoom in.

The River Tilt test bounds are longitude -3.95 to -3.55, latitude 56.72 to 57.05. It is an area prototype only; do not assume coverage elsewhere in Scotland.

## GitHub Pages launch

The repository owner `redhotzepp-code` is already connected to ChatGPT's GitHub tools, but **no repositories are visible yet**. Create one empty repository called `scotlands-summits-path-lab` at https://github.com/new. A public repo is normally the simplest way to use GitHub Pages; note that its files and public map are accessible to others, though this bundle contains no personal logs or GPX records.

Next, either:

1. Come back to ChatGPT and say **"GitHub repository created: redhotzepp-code/scotlands-summits-path-lab"**. GitHub App access to the new repo may also need enabling. ChatGPT can then upload these files through the connected repository tools. Do not upload a ZIP as one repository file.
2. Or upload **the contents** of this ZIP, preserving the `.github/workflows/build-and-publish.yml` path, using Git or GitHub's browser upload.

In **Repository Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source. The included workflow is triggered on push to `main`, downloads the Geofabrik Scotland extract, clips it to River Tilt, validates that at least 10 real mapped path segments exist, and publishes the `site` folder. Check **Actions → Build River Tilt path data and publish Path Lab** for success and the resulting Pages URL. Do not treat the website as test-ready if the Action fails or the viewer reports `not_built`.

Git-based upload (if using a computer):

```bash
git init -b main
git add .
git commit -m "River Tilt static path map prototype"
git remote add origin https://github.com/redhotzepp-code/scotlands-summits-path-lab.git
git push -u origin main
```

## Contents

- `site/index.html`, `site/app.js`, `site/style.css`: single-map, mobile-friendly Path Lab. Online OpenFreeMap basemap and optional Mapterhorn hillshade; all route geometry comes from our static local `data/paths.geojson` file.
- `site/data/paths.geojson`: **deliberately empty** until actual source processing succeeds. Never made-up paths.
- `site/data/manifest.json`: explicitly reports `not_built` until the actual data is produced.
- `scripts/build_paths.py`: extracts verified paths from the real OSM extract using `osmium` + Shapely, retaining mapped route class, surface and access tags where available.
- `scripts/verify_paths.py`: geographic-extent and non-empty-data QA gate.
- `.github/workflows/build-and-publish.yml`: GitHub Actions repeatable build and Pages deployment.
- `tests/sample.osm`: **synthetic unit-test fixture only** — never published as field data.

## Test checklist for 2 December 2026

1. On your Samsung in Chrome, confirm the Path Lab page shows `mapped path segments ready` and a nonzero route count.
2. Open Càrn a' Chlamain and Tarf Hotel; check mapped paths are shown from the map's **1 km** scale rather than appearing only at 300 m.
3. Zoom progressively to 500 m and 300 m; route linework should become clearer without whole routes popping in late (except paths not included in the source).
4. Pan continuously for 20–30 seconds, pinch zoom and change location. The map must remain responsive.
5. Check paths and estate tracks against your existing OS mapping and the ground. Report specific missing routes: not every OS Explorer path exists in OSM.
6. Check that OSM data is attributed and that route restrictions are not presented as guarantees of access.

## Accuracy / safety / licensing

All route geometries originate from OpenStreetMap, downloaded via Geofabrik, and are credited to **© OpenStreetMap contributors — ODbL 1.0**: https://www.openstreetmap.org/copyright . Redistributed OSM-derived databases may trigger share-alike and other ODbL obligations; review licensing before wider release. Maps do not guarantee rights of access, path condition, or safe river crossings. Do not use the online prototype as the sole navigation tool.

The browser prototype is **not fully offline**: its path GeoJSON is self-hosted and free of runtime Overpass dependence, but base tiles/hillshade and the renderer still need an internet connection. A proper Android offline archive is a separate integration stage.

## Local conversion (alternative to GitHub Actions)

If you already have a suitably clipped `.osm.pbf` file:

```bash
pip install osmium shapely
python scripts/build_paths.py --input river-tilt.osm.pbf --output-dir site/data --min-paths 10
python scripts/verify_paths.py site/data/paths.geojson site/data/manifest.json
python -m http.server 8000 --directory site
```

Then browse to http://localhost:8000. Opening `index.html` directly from the file system won't load the GeoJSON due to browser file-origin security restrictions.