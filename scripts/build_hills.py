#!/usr/bin/env python3
"""Build named hill-point labels from georeferenced OSM data.
Only documented OSM 'ele' heights are displayed; missing values stay absent.
"""
import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

BBOX=(-3.95,56.72,-3.55,57.05)
HEIGHT=re.compile(r'^\s*(\d+(?:\.\d+)?)\s*(?:m|metres?)?\s*$',re.I)

def valid_height(value):
    if not value:
        return None
    match=HEIGHT.fullmatch(value)
    if not match:
        return None
    height=round(float(match.group(1)))
    return height if 1<=height<=2000 else None

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',required=True)
    p.add_argument('--output',required=True)
    args=p.parse_args()
    root=ET.parse(args.input).getroot()
    features=[]
    seen=set()
    for node in root.findall('node'):
        tags={tag.get('k'):tag.get('v') for tag in node.findall('tag')}
        if tags.get('natural') not in ('peak','hill') or not tags.get('name'):
            continue
        osm_id=node.get('id')
        if osm_id in seen:
            continue
        seen.add(osm_id)
        lon,lat=float(node.get('lon')),float(node.get('lat'))
        if not (BBOX[0]<=lon<=BBOX[2] and BBOX[1]<=lat<=BBOX[3]):
            continue
        props={'name':tags['name'],'natural':tags['natural'],'osm_id':osm_id}
        height=valid_height(tags.get('ele'))
        if height is not None:
            props['ele']=height
        features.append({'type':'Feature','properties':props,
            'geometry':{'type':'Point','coordinates':[lon,lat]}})
    out=Path(args.output)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'type':'FeatureCollection','features':features},
                              ensure_ascii=False,separators=(',',':')))
    with_h=sum('ele' in f['properties'] for f in features)
    print(f'NAMED HILLS: {len(features)} OSM peak/hill points; '
          f'{with_h} have recorded elevations, {len(features)-with_h} name-only. '
          'No approximated elevations.')
    if not features and 'sample' not in args.input:
        raise SystemExit('No named hill nodes found in real export: check OSM extraction')

if __name__=='__main__':
    main()
