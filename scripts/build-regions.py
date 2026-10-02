#!/usr/bin/env python3
"""Convert a Geofabrik Korea extract to versioned, app-owned OSM data tiles.
Run with Python + osmium: build-regions.py source.osm.pbf public/map-regions
Road IDs, shared node IDs and all access/crossing tags are retained; no topology is inferred.
"""
import collections, datetime, gzip, hashlib, json, math, pathlib, sys
import osmium
from pack_osm import pack
STEP = .05
source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
tiles = collections.defaultdict(list)
counts = collections.Counter()
def cell(lat, lon): return (math.floor(lat / STEP), math.floor(lon / STEP))
def is_poi(t): return t.get('shop') == 'convenience' or t.get('amenity') == 'drinking_water' or t.get('drinking_water') == 'yes'
def cells_for_geometry(geo):
    found = set()
    for a, b in zip(geo, geo[1:]):
        la, lo = cell(a['lat'], a['lon']); lb, lob = cell(b['lat'], b['lon'])
        for y in range(min(la,lb),max(la,lb)+1):
            for x in range(min(lo,lob),max(lo,lob)+1): found.add((y,x))
    return found
class Build(osmium.SimpleHandler):
    def node(self, n):
        t = dict(n.tags)
        if not (any(k in t for k in ['highway','barrier','access','foot']) or is_poi(t)): return
        if not n.location.valid(): return
        item = {'type':'node','id':n.id,'lat':n.lat,'lon':n.lon,'tags':t}
        tiles[cell(n.lat,n.lon)].append(item); counts['nodes'] += 1
    def way(self, w):
        t = dict(w.tags)
        background = t.get('leisure') == 'park' or t.get('natural') in ['water','wood'] or t.get('landuse') == 'forest' or 'waterway' in t
        if not ('highway' in t or is_poi(t) or background): return
        if len(w.nodes) < 2 or any(not n.location.valid() for n in w.nodes): return
        geo = [{'lat':n.lat,'lon':n.lon} for n in w.nodes]
        bounds = {'minlat':min(p['lat'] for p in geo),'minlon':min(p['lon'] for p in geo),'maxlat':max(p['lat'] for p in geo),'maxlon':max(p['lon'] for p in geo)}
        if background and 'highway' not in t and max(bounds['maxlat']-bounds['minlat'],bounds['maxlon']-bounds['minlon']) > .2: return
        item = {'type':'way','id':w.id,'nodes':[n.ref for n in w.nodes],'geometry':geo,'bounds':bounds,'tags':t}
        cells = cells_for_geometry(geo)
        if background or is_poi(t):
            # Area features must also be available inside their perimeter.
            a,b=cell(bounds['minlat'],bounds['minlon']),cell(bounds['maxlat'],bounds['maxlon'])
            cells.update((y,x) for y in range(a[0],b[0]+1) for x in range(a[1],b[1]+1))
        for key in cells: tiles[key].append(item)
        counts['ways'] += 1
reader = osmium.io.Reader(str(source)); header=reader.header(); timestamp=header.get('osmosis_replication_timestamp'); reader.close()
print('Source timestamp:',timestamp,flush=True)
Build().apply_file(str(source),locations=True,idx='flex_mem')
version = timestamp.replace(':','').replace('-','') if timestamp else datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
manifest={'format':2,'privacyPolicy':'public-v1','version':version+'-p2-public-v1','step':STEP,'osmTimestamp':timestamp,'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'Geofabrik South Korea / OpenStreetMap contributors','sourceUrl':'https://download.geofabrik.de/asia/south-korea.html','license':'ODbL-1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','tiles':{},'counts':dict(counts)}
for (y,x), elements in sorted(tiles.items()):
    raw=json.dumps(pack({'elements':elements}),ensure_ascii=False,separators=(',',':')).encode()
    packed=gzip.compress(raw,compresslevel=7,mtime=0)
    digest=hashlib.sha256(packed).hexdigest()[:16]
    filename=f'{y}-{x}-{digest}.json.gz'
    (output/filename).write_bytes(packed)
    manifest['tiles'][f'{y},{x}']={'file':filename,'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest()}
(output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print(json.dumps({'version':version,'tiles':len(tiles),'compressedMB':round(sum(x['bytes'] for x in manifest['tiles'].values())/1e6,2),'counts':dict(counts)}),flush=True)
