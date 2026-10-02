#!/usr/bin/env python3
"""Keep Seoul/Incheon/Gyeonggi + Gyeongsang, with roads across the border.
Usage: scope-regions.py source.osm.pbf complete-pack-directory output-directory
Requires osmium and shapely. Input pack must come from the same OSM snapshot.
"""
import json, pathlib, shutil, sys
import osmium
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union

source, pack, output = map(pathlib.Path, sys.argv[1:4])
names = {'서울특별시', '인천광역시', '경기도', '경상북도', '경상남도', '대구광역시', '울산광역시', '부산광역시'}
features = []
factory = osmium.geom.GeoJSONFactory()
class Boundaries(osmium.SimpleHandler):
    def area(self, a):
        t = dict(a.tags)
        if t.get('admin_level') == '4' and t.get('name') in names:
            features.append(shape(json.loads(factory.create_multipolygon(a))))
            print('Boundary:', t['name'], flush=True)
filters = [osmium.filter.EntityFilter(osmium.osm.RELATION | osmium.osm.AREA), osmium.filter.TagFilter(('boundary', 'administrative')), osmium.filter.TagFilter(('admin_level', '4'))]
Boundaries().apply_file(str(source), filters=filters)
assert len(features) == 8, 'All eight administrative boundaries are required'
coverage = unary_union(features)
manifest = json.loads((pack / 'manifest.json').read_text())
reader = osmium.io.Reader(str(source))
assert reader.header().get('osmosis_replication_timestamp') == manifest['osmTimestamp']
reader.close()
selected = {}
output.mkdir(parents=True, exist_ok=False)
for key, tile in manifest['tiles'].items():
    y, x = map(int, key.split(',')); step = manifest['step']
    # Rectangular margin covers the largest 12 km request including rounded origin.
    # Origin eligibility remains the exact administrative polygon below.
    if coverage.intersects(box(x*step-.13, y*step-.10, (x+1)*step+.13, (y+1)*step+.10)):
        selected[key] = tile
        shutil.copyfile(pack / tile['file'], output / tile['file'])
manifest.update(version=manifest['version']+'-metro-gyeongsang', tiles=selected,
                regions=sorted(names), coverage=mapping(coverage),
                routingBorderMarginDegrees={'latitude': .10, 'longitude': .13})
manifest.pop('counts', None)  # Nationwide object counts do not describe this subset.
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
if (pack / 'README.txt').exists(): shutil.copyfile(pack / 'README.txt', output / 'README.txt')
print(json.dumps({'tiles':len(selected), 'compressedBytes':sum(t['bytes'] for t in selected.values()), 'manifestBytes':(output/'manifest.json').stat().st_size}), flush=True)
