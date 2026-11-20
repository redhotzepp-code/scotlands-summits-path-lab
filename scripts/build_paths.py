#!/usr/bin/env python3
"""Convert a bounded OSM XML/PBF region to a real, offline-source GeoJSON route layer.
No invented geometry. An empty extraction fails instead of shipping a blank map.
"""
import argparse
import datetime as dt
import json
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from shapely.geometry import LineString, box

HIGHWAYS = {'path','footway','pedestrian','steps','bridleway','track','cycleway','service'}
BBOX = (-3.95, 56.72, -3.55, 57.05)  # west, south, east, north: Blair Atholl to Tarf/Hills
EXCLUDED_ACCESS = {'private', 'no'}


def classify(tags):
    highway = tags.get('highway', '')
    if highway in ('cycleway',):
        return 'cycle'
    if highway in ('track',):
        return 'estate'
    if highway in ('service',):
        return 'service'
    return 'foot'


def detect_access(tags):
    if tags.get('access') in EXCLUDED_ACCESS or tags.get('foot') in EXCLUDED_ACCESS:
        return 'restricted'
    return 'unknown'  # No claim of rights of way or guaranteed passability.


def line_sections(coords, region):
    if len(coords) < 2:
        return []
    try:
        geom = LineString(coords).intersection(region)
    except Exception:
        return []
    if geom.is_empty:
        return []
    geoms = [geom] if geom.geom_type == 'LineString' else list(getattr(geom,'geoms', []))
    result = []
    for g in geoms:
        if g.geom_type == 'LineString' and len(g.coords) >= 2 and g.length > 0.000002:
            g = g.simplify(0.000004, preserve_topology=True)
            result.append([[round(lon,7), round(lat,7)] for lon,lat in g.coords])
    return result


class Collector:
    def __init__(self, bbox):
        self.region = box(*bbox)
        self.features = []
        self.counts = Counter()
        self.ids = set()

    def consume(self, identifier, tags, coordinates):
        if tags.get('highway') not in HIGHWAYS:
            return
        if identifier in self.ids:
            return
        self.ids.add(identifier)
        props = {
            'class': classify(tags),
            'highway': tags['highway'],
            'name': tags.get('name',''),
            'surface': tags.get('surface',''),
            'tracktype': tags.get('tracktype',''),
            'access_info': detect_access(tags),
            'osm_id': identifier,
        }
        for ix,coords in enumerate(line_sections(coordinates, self.region)):
            self.features.append({'type':'Feature','properties':props,
               'geometry':{'type':'LineString','coordinates':coords}})
            self.counts[props['class']] += 1


def from_pbf(path, collector):
    try:
        import osmium
    except ImportError as e:
        raise RuntimeError('Install pyosmium using `pip install osmium`') from e
    class Handler(osmium.SimpleHandler):
        def way(self, way):
            if way.tags.get('highway') not in HIGHWAYS:
                return
            try:
                nodes = list(way.nodes)
                if any(not n.location.valid() for n in nodes):
                    return  # Do not join across missing OSM nodes.
                coordinates = [(float(n.lon), float(n.lat)) for n in nodes]
            except Exception:
                return
            tags = {tag.k: tag.v for tag in way.tags}
            collector.consume(int(way.id),tags,coordinates)
    Handler().apply_file(str(path), locations=True)


def xml_import(path, collector):
    # Simplify XML small-test support: minuscule exports only, avoid streaming issues.
    root = ET.parse(path).getroot()
    nodes={int(n.attrib['id']):(float(n.attrib['lon']),float(n.attrib['lat']))
           for n in root.findall('node')}
    for way in root.findall('way'):
        tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
        coords=[nodes[int(n.attrib['ref'])] for n in way.findall('nd') if int(n.attrib['ref']) in nodes]
        collector.consume(int(way.attrib['id']),tags,coords)


def main():
    ap=argparse.ArgumentParser(description='Build geographically verified River Tilt paths from OSM.')
    ap.add_argument('--input',required=True)
    ap.add_argument('--output-dir',default='site/data')
    ap.add_argument('--min-paths',type=int,default=10)
    ap.add_argument('--bbox',default=','.join(map(str,BBOX)))
    args=ap.parse_args()
    bbox=tuple(float(p) for p in args.bbox.split(','))
    if len(bbox)!=4 or bbox[0]>=bbox[2] or bbox[1]>=bbox[3]:
        raise SystemExit('Invalid bbox')
    source=Path(args.input)
    if not source.is_file(): raise SystemExit(f'Input missing: {source}')
    collector=Collector(bbox)
    if source.suffix=='.pbf': from_pbf(source,collector)
    elif source.suffix=='.osm' or source.suffix=='.xml': xml_import(source,collector)
    else: raise SystemExit('Use .osm.pbf, .osm or .xml source')
    count=len(collector.features)
    if count<args.min_paths:
        raise SystemExit(f'FAIL CLOSED: only {count} mapped route segments (< {args.min_paths}); not publishing empty map')
    out=Path(args.output_dir)
    out.mkdir(parents=True,exist_ok=True)
    fc={'type':'FeatureCollection','features':collector.features}
    data_path=out/'paths.geojson'
    data_path.write_text(json.dumps(fc,ensure_ascii=False,separators=(',',':')))
    manifest={
      'status':'ready','routes':count,'classes':dict(sorted(collector.counts.items())),
      'bbox':list(bbox),'date_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
      'source':'Geofabrik Scotland OSM extract (OpenStreetMap contributors, ODbL)',
      'source_url':'https://download.geofabrik.de/europe/united-kingdom/scotland.html',
      'license':'https://www.openstreetmap.org/copyright',
      'notices':['Unmapped paths may exist','Routes do not guarantee access or passability']
    }
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(f'VALIDATED: {count} georeferenced route segments -> {data_path}, {data_path.stat().st_size/1024:.1f} KiB')
    print('Classes: '+str(dict(collector.counts)))

if __name__=='__main__':main()