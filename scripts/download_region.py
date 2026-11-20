#!/usr/bin/env python3
"""Download a *small* bounded River Tilt OSM export in API-sized tiles.
Preserves actual OSM way geometry; never invents, generalises or skips path nodes.
Unlike live Overpass, this runs only when producing a static field-test package.
"""
import argparse
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

API = "https://api.openstreetmap.org/api/0.6/map"
HILLSIDE = (-3.95, 56.72, -3.55, 57.05)
HIGHWAYS = {"path", "footway", "pedestrian", "steps", "bridleway",
            "track", "cycleway", "service"}
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "ScotlandsSummits-RiverTilt-PathLab/1.0 (github.com/redhotzepp-code/scotlands-summits-path-lab)"
})
nodes = {}
ways = {}
calls = 0


def fetch(west, south, east, north, depth=0):
    global calls
    bbox = f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}"
    print(f"Retrieving OSM map tile: {bbox} (depth {depth})", flush=True)
    error = None
    for attempt in range(3):
        try:
            resp = SESSION.get(API, params={"bbox": bbox}, timeout=(20, 120))
            if resp.status_code == 400:
                # OSM API 400 can mean the 50,000-node bound is exceeded.
                # Only subdivide once the server actually rejects a tile.
                if depth >= 3:
                    raise RuntimeError("OSM API rejected small tile: " +
                                       resp.text[:300])
                mx, my = (west + east) / 2, (south + north) / 2
                for quadrant in ((west, south, mx, my),
                                 (mx, south, east, my),
                                 (west, my, mx, north),
                                 (mx, my, east, north)):
                    fetch(*quadrant, depth + 1)
                return
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            if root.tag != "osm":
                raise RuntimeError(f"Unexpected response root {root.tag!r}")
            break
        except (requests.RequestException, ET.ParseError) as exc:
            error = exc
            if attempt == 2:
                raise RuntimeError(f"OSM request failed for {bbox}: {error}") from error
            time.sleep(3 * (attempt + 1))
    calls += 1
    # Keep complete lines only; duplicate ways/nodes from adjacent tiles
    # are unified using their stable OSM identifiers.
    for node in root.findall("node"):
        nid = int(node.attrib["id"])
        nodes[nid] = (node.attrib["lon"], node.attrib["lat"])
    for way in root.findall("way"):
        tags = {t.attrib.get("k"): t.attrib.get("v") for t in way.findall("tag")}
        if tags.get("highway") in HIGHWAYS:
            ways[int(way.attrib["id"])] = way
    print(f"  Collected {len(nodes)} unique nodes and {len(ways)} route ways", flush=True)
    time.sleep(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="/tmp/river-tilt.osm")
    args = parser.parse_args()
    w, s, e, n = HILLSIDE
    midx, midy = (w+e)/2, (s+n)/2
    for bbox in ((w, s, midx, midy), (midx, s, e, midy),
                 (w, midy, midx, n), (midx, midy, e, n)):
        fetch(*bbox)
    root = ET.Element("osm", {"version":"0.6", "generator":"ScotlandsSummits-PathLab"})
    referenced = set()
    complete = {}
    incomplete = 0
    for wid, way in ways.items():
        refs = [int(nd.attrib["ref"]) for nd in way.findall("nd")]
        if len(refs) < 2 or not all(ref in nodes for ref in refs):
            incomplete += 1
            continue
        referenced.update(refs)
        complete[wid] = way
    for nid in sorted(referenced):
        lon, lat = nodes[nid]
        ET.SubElement(root, "node", {"id":str(nid),"lon":lon,"lat":lat})
    for wid in sorted(complete):
        root.append(complete[wid])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    print(f"Saved {len(complete)} complete mapped ways ({incomplete} incomplete skipped) "
          f"after {calls} successful bounded downloads: {output.stat().st_size} bytes",
          flush=True)
    if len(complete) < 10:
        raise SystemExit("Fail closed: fewer than 10 complete route ways")


if __name__ == "__main__":
    main()
