"""The Node downloader and Python generator read the same release policy."""
import json, pathlib
POLICY = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'data/privacy-policy.json').read_text())
def sanitize_element(element):
    result = {k:v for k,v in element.items() if k not in POLICY['elementFields']}
    if 'tags' in result:
        result['tags'] = {k:v for k,v in result['tags'].items() if k not in POLICY['tagFields']}
    return result
