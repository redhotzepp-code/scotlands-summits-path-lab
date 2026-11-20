#!/usr/bin/env python3
"""Small mechanical QA gate. Never publish placeholder or invented paths."""
import json,sys
from pathlib import Path
fc=json.loads(Path(sys.argv[1]).read_text())
man=json.loads(Path(sys.argv[2]).read_text())
assert man['status']=='ready'
assert fc['type']=='FeatureCollection'
assert len(fc['features']) == man['routes'] >= 1
bbox=man['bbox']
for f in fc['features']:
    assert f['properties']['class'] in ('foot','cycle','estate','service')
    assert f['geometry']['type']=='LineString'
    assert len(f['geometry']['coordinates']) >= 2
    for x,y in f['geometry']['coordinates']:
        assert bbox[0]-1e-6 <= x <= bbox[2]+1e-6, (x,bbox)
        assert bbox[1]-1e-6 <= y <= bbox[3]+1e-6, (y,bbox)
print('PASS: data is nonempty, properly typed and within River Tilt bounds.')