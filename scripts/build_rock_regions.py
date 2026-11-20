#!/usr/bin/env python3
"""Build static, source-traceable OSM rock/cliff geometry for field test regions.
Only OpenStreetMap objects tagged natural=cliff|scree|bare_rock|blockfield.
No DEM-derived inferred cliffs, rockfall risk, or invented rock polygons.
"""
import json, time, argparse, os
import xml.etree.ElementTree as ET
from pathlib import Path
import requests
REGIONS={
  'tilt':[-3.95,56.72,-3.55,57.05],
  'chlachair':[-4.66,56.79,-4.38,56.97],
  'ardair':[-4.75,56.89,-4.48,57.04]
}
TAGS={'bare_rock','scree','blockfield','cliff'}
API='https://api.openstreetmap.org/api/0.6/map'

def download(name,bounds):
    sess=requests.Session();sess.headers.update({'User-Agent':'ScotlandsSummits-RockData/1.0 (github.com/redhotzepp-code/scotlands-summits-path-lab)'})
    nodes={};ways={};count=[0]
    def fetch(b,depth=0):
        bbox=','.join(f'{x:.6f}' for x in b)
        for attempt in range(4):
            try:
                r=sess.get(API,params={'bbox':bbox},timeout=(20,120))
                if r.status_code==400:
                    if depth>=4:raise RuntimeError('Bounding box still too large: '+bbox)
                    w,s,e,n=b;mx=(w+e)/2;my=(s+n)/2
                    for sub in ([w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]):fetch(sub,depth+1)
                    return
                if r.status_code in (429,500,502,503,504):raise requests.HTTPError(f'HTTP {r.status_code}')
                r.raise_for_status()
                xml=ET.fromstring(r.content)
                break
            except (requests.RequestException,ET.ParseError) as ex:
                if attempt>=3:raise RuntimeError('OSM request failed: '+bbox) from ex
                time.sleep(4*(attempt+1))
        count[0]+=1
        for node in xml.findall('node'):
            nodes[int(node.attrib['id'])]=(float(node.attrib['lon']),float(node.attrib['lat']))
        for way in xml.findall('way'):
            tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
            if tags.get('natural') in TAGS:
                ways[int(way.attrib['id'])]=(tags,[int(x.attrib['ref']) for x in way.findall('nd')])
        print(name,bbox,'rock ways',len(ways),'nodes',len(nodes),flush=True)
        time.sleep(.75)
    w,s,e,n=bounds; mx=(w+e)/2;my=(s+n)/2
    for b in ([w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]):fetch(b)
    features=[];kinds={x:0 for x in TAGS};skipped=0
    for osmid,(tags,refs) in sorted(ways.items()):
        kind=tags['natural'];coords=[nodes[x] for x in refs if x in nodes]
        if len(coords)!=len(refs) or len(coords)<2:
            skipped+=1;continue
        polygon=(kind!='cliff' and len(coords)>=4 and coords[0]==coords[-1])
        # A polygon tag on a non-closed way is invalid as an area. Do not infer.
        if kind!='cliff' and not polygon:
            skipped+=1;continue
        geometry={'type':'Polygon','coordinates':[coords]} if polygon else {'type':'LineString','coordinates':coords}
        features.append({'type':'Feature','geometry':geometry,'properties':{
          'kind':kind,'osm_id':osmid,'osm_type':'way','source':'OpenStreetMap','name':tags.get('name','')}})
        kinds[kind]+=1
    print(name,'final',len(features),'types',kinds,'incomplete skipped',skipped,'OSM requests',count[0],flush=True)
    return {'type':'FeatureCollection','features':features},dict(area=name,bounds=bounds,counts=kinds,skipped_ways=skipped,feature_count=len(features),attribution='© OpenStreetMap contributors, ODbL',source='OSM API complete tagged ways only; no inferred cliffs')

def main():
    p=argparse.ArgumentParser();p.add_argument('--output-dir',default='site/data/rocks');p.add_argument('--region',choices=(*REGIONS,'all'),default='all');p.add_argument('--fixture',action='store_true');a=p.parse_args()
    out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True)
    targets=REGIONS if a.region=='all' else {a.region:REGIONS[a.region]}
    manifests=[]
    for name,bounds in targets.items():
        if a.fixture:
            features={'type':'FeatureCollection','features':[
              {'type':'Feature','properties':{'kind':'cliff','osm_id':1},'geometry':{'type':'LineString','coordinates':[[-4.6,56.96],[-4.61,56.97]]}},
              {'type':'Feature','properties':{'kind':'scree','osm_id':2},'geometry':{'type':'Polygon','coordinates':[[[-4.6,56.96],[-4.61,56.96],[-4.61,56.97],[-4.6,56.96]]]}}
            ]};manifest=dict(area=name,bounds=bounds,counts={'cliff':1,'scree':1},feature_count=2)
        else:
            features,manifest=download(name,bounds)
        assert features['type']=='FeatureCollection'
        for f in features['features']:
            assert f['properties']['kind'] in TAGS and f['geometry']['type'] in ('Polygon','LineString')
        (out/(name+'.geojson')).write_text(json.dumps(features,separators=(',',':')))
        manifests.append(manifest)
    (out/'manifest.json').write_text(json.dumps(manifests,indent=2))
    print('Rock dataset manifests:',json.dumps(manifests))
if __name__=='__main__':main()