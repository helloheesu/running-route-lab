# Data attribution and snapshot

- Road data: © OpenStreetMap contributors, [copyright and attribution](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Included Pohang sample: OSM snapshot `2026-09-23T03:56:16Z`, downloaded `2026-09-23T03:57:38Z`. Original public query/endpoint and bounding box are retained in the data wrapper as historical provenance, not a live download dependency.
- Optional regions: Geofabrik South Korea snapshot `2026-09-29T20:22:51Z`, dated source [south-korea-260929.osm.pbf](https://download.geofabrik.de/asia/south-korea-260929.osm.pbf); previously verified published MD5 `7775afecd9ccbf3285ace3f1fa2ec7f4`. Tile SHA256 values in `regions-source.json` identify the exact input tiles.
- Terrain: [Mapzen / Tilezen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/); [format](https://github.com/tilezen/joerd/blob/master/docs/formats.md), [source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Included terrain was fetched 2026-09-29; its source URLs/hashes and attribution are retained in `public/map-data/terrain.json`.
- Terrain grid spacing is about 31m in the sample. Stored decimal precision is not vertical accuracy; source survey date is unknown.
- Derived OSM data remain subject to the source database terms. Privacy cleanup removes unneeded object editor metadata and facility contact tags, not source attribution or OSM object identifiers.
- Demo route geometries were generated from the saved graph. Their elevation/signal/facility/score values are intentionally synthetic UI examples, not field observations.

This file does not grant a new license to application code or third-party assets. Package licenses remain with their dependencies. Device artwork/runtime came from the original mobile prototype scaffold; no additional redistribution rights are asserted here. The repository deliberately does not add a project-wide license.
