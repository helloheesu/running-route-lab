# 데이터 포함·제외와 복원

## 기본 사본

포항 샘플의 지도 요소 6,973개에서 불필요한 기여자 메타데이터를 제거했습니다. 연락처 태그가 있던 3개 객체도 정리합니다. 샘플의 좌표·노드/도로 ID·통행/횡단 정보·자료 출처는 유지합니다. 기본 빌드와 포항 계산에는 큰 지도가 필요하지 않습니다.

광역 원본은 수도권·경상권 2,641개 타일, 합계 141,067,492 bytes입니다. `data/regions-source.json`에는 원본 파일 목록·SHA256·크기·영역·기준일만 있습니다. 개인 연락처나 지도 객체 본문은 없습니다. 이 파일은 입력 스냅샷을 고정하는 목록이고 실행용 완성 manifest가 아닙니다.

## 권장 준비: 고정 파일 다운로드

```sh
npm run data:regions
npm run data:check
```

출처는 기록된 공개 PoC의 정적 파일입니다. 현재 계정이나 배포 권한은 필요하지 않습니다. 원본 파일이 나중에 내려가면 복원이 실패할 수 있으므로 그 경우 아래 재생성 절차를 사용합니다. 이전 파일이 없어졌다고 최신 버전을 몰래 가져오지 않습니다.

준비 도구는 최대 3개 동시 요청으로 원본 해시·크기를 확인합니다. 원본은 메모리에서 풀어 정리하고, 디스크에는 정리된 중간 타일만 `work/clean-tiles/public-v1/`에 저장합니다. 전체가 성공해야 `public/map-regions/`에 새 manifest와 파일을 반영합니다. 실패하면 이전 완성본은 유지되며 재실행이 가능합니다. 작업 중 앱을 재시작/빌드하지 말고 완료 후 진행하세요.

이미 **동일한 원본 타일 묶음**을 별도로 보유한 경우 다음 명령도 동일한 해시 검증·정리를 거칩니다.

```sh
npm run data:regions -- --from work/original-regions
```

이 디렉터리에는 `regions-source.json`에 적힌 원본 파일이 있어야 합니다. 이미 정리된 다른 버전의 타일이나 새로 생성한 파일을 넣으면 해시 불일치가 정상입니다.

## 원본 PBF에서 광역 자료 재생성

이 절차는 기본 실행에 필요하지 않습니다. Python 3.9 이상, 추가 메모리/디스크와 시간이 필요하며 원본 PBF와 전체 임시 팩은 공개하지 않습니다. 명령은 새 출력 폴더를 전제로 합니다.

```sh
python3 -m venv work/data-venv
work/data-venv/bin/python -m pip install -r scripts/requirements-data.txt
```

Geofabrik의 기록된 날짜별 South Korea PBF를 `work/source/south-korea.osm.pbf`로 내려받고 출처 문서의 체크섬을 확인합니다. 예를 들어 curl을 사용할 수 있는 환경에서는:

```sh
mkdir -p work/source
curl --fail --location https://download.geofabrik.de/asia/south-korea-260929.osm.pbf --output work/source/south-korea.osm.pbf
work/data-venv/bin/python -c "import hashlib,pathlib; p=pathlib.Path('work/source/south-korea.osm.pbf'); assert hashlib.md5(p.read_bytes()).hexdigest() == '7775afecd9ccbf3285ace3f1fa2ec7f4', 'source checksum mismatch'"
work/data-venv/bin/python scripts/build-regions.py work/source/south-korea.osm.pbf work/generated-complete
work/data-venv/bin/python scripts/scope-regions.py work/source/south-korea.osm.pbf work/generated-complete work/generated-scoped
npm run data:check -- --regions work/generated-scoped
```

검사가 성공한 후, 준비 작업이나 개발 서버가 실행 중이지 않은 상태에서 `work/generated-scoped`를 `public/map-regions`로 옮깁니다. 기존 폴더가 있으면 먼저 다른 work 경로에 보관합니다. 완료된 폴더 전체를 바꾸고 파일을 섞지 않습니다. 그 후 `npm run data:check`와 빌드를 다시 실행합니다.

Windows에서는 가상 환경의 `bin/python` 대신 `Scripts/python.exe`를 사용합니다. 위 날짜별 PBF가 더 이상 제공되지 않으면 새 날짜를 명시적으로 선택하고 checksum·기준일·실험 기록을 갱신해야 합니다. 그 결과는 원래 스냅샷과 동일한 재현이 아닙니다. 기본 포항 샘플은 저장소에서 계속 실행 가능합니다.

Python 생성기도 `data/privacy-policy.json`을 읽어 불필요한 필드/태그를 제거하고 새 SHA256을 기록합니다. 새 타일과 manifest를 함께 사용해야 합니다. 이 재생성은 OSM 도로/시설 팩을 만드는 절차이며, 광역 지형은 앱에서 필요한 Terrarium 타일을 별도로 받고 캐시합니다.

## 무엇을 왜 제거하나

- 지도 요소의 `user`, `uid`, `timestamp`, `changeset`, `version`: 편집 기여자 메타데이터. wrapper의 자료 기준일·버전은 유지합니다.
- 요소 tags의 `phone`, `contact:phone`, `email`, `contact:email`: 현재 계산에 불필요한 시설 연락처.
- `id`, way의 `nodes`/`refs`, 좌표, access/foot/oneway/crossing 태그는 제거하지 않습니다. 기여자 uid와 도로 노드 id는 다릅니다.
- 원본 해시와 정리 후 해시는 서로 다릅니다. 새 파일명·크기·manifest 버전으로 구분합니다.

필수 속성이 보존된다고 현장 정확도가 보증되지는 않습니다. 출처·데이터 조건은 [ATTRIBUTION](../data/ATTRIBUTION.md), 해석 원칙은 [RESEARCH](RESEARCH.md)를 읽으세요.
