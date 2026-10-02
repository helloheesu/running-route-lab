"""Lossless compact JSON representation of OSM's 1e-7 degree coordinates."""
from sanitize_osm import sanitize_element
def pack(raw):
    elements=[]
    for original in raw['elements']:
        e=sanitize_element(original)
        if e['type'] != 'way': elements.append(e); continue
        out={k:v for k,v in e.items() if k not in ['nodes','geometry','bounds']}
        refs=[];last=0
        for n in e['nodes']: refs.append(n-last);last=n
        coords=[];lat=lon=0
        for p in e['geometry']:
            y=round(p['lat']*10000000);x=round(p['lon']*10000000)
            coords.extend([y-lat,x-lon]);lat,lon=y,x
        out['refs']=refs;out['coords']=coords;elements.append(out)
    return {'format':2,'elements':elements}
