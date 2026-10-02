# Running Route Lab — 다시, 여기로

러닝 순환 코스 알고리즘을 독립적으로 구현·비교하기 위한 **조사 문서 + 실행 가능한 웹 PoC**입니다. 출발지로 돌아오는 코스를 만들고, 전체 발견 후보에서 종합점수·고저차·신호 횡단 기준 대표를 비교합니다. 기존 알고리즘은 참고 기준이며 검증된 최적해나 정답 경로가 아닙니다.

## 빠른 실행

Node **24.x**, npm, Git이 필요합니다. 모든 명령은 저장소 루트에서 실행합니다.

```sh
npm ci
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 4190 --strictPort
```

서버가 표시한 `http://127.0.0.1:4190/`를 엽니다. **POSTECH 주변 → 지도에서 출발 확정 → 5km → 코스 찾기**로 실제 저장 지도 계산을 확인할 수 있습니다.

- 실제 입력 흐름: `http://127.0.0.1:4190/`
- 고정 UI 예시: `http://127.0.0.1:4190/?case=postech-5k&variant=B`

기본 샘플과 테스트에는 API 키·배포 계정·Python·광역 지도 다운로드가 필요하지 않습니다. 설치에는 npm 접속이 필요합니다. 앱의 **온라인 장소 검색**, **현재 위치 권한**, 광역 실행 중 **고도 수신**은 별도 외부 기능입니다.

## 무엇이 포함되어 있나요?

- `src/`: React·Leaflet UI, Worker, 기존 알고리즘, 별도 추천 계층.
- `docs/`: 조사 결과, 현재 정책·가정·한계, 알고리즘 흐름, 비교 방법.
- `public/map-data/`, `public/demo/`: 정리된 작은 포항 지도·지형과 UI 예시. 실제 지도와 시연용 수치를 혼동하지 마세요.
- `data/`: 공통 정리 규칙, 고정된 광역 자료 원본 목록/해시, 출처, 실험 입력.
- `scripts/`, `tests/`: 선택 데이터 준비, 검사, 재현 실험, 자동 테스트.

광역 지도 약 141MB와 기존 Git 이력은 포함하지 않았습니다. 샘플 범위 밖에서 계산하려면:

```sh
npm run data:regions
npm run data:check
```

완료 후 개발 서버를 다시 시작하거나 빌드합니다. 서울·경기·인천·부산·대구·울산·경북·경남의 등록 도로를 사용합니다. 지역 안이라도 보행망 연결이나 거리 조건 때문에 후보가 없을 수 있습니다. 지도 지원은 현장 통행 보증이 아닙니다.

## 읽는 순서

1. AI 실행·작업 지침: [AGENTS.md](AGENTS.md)
2. 설치·실행·문제 해결: [실행 가이드](docs/SETUP.md)
3. 정보원과 한계: [조사 지식](docs/RESEARCH.md)
4. 합의한 조건과 실험 설정: [제품 정책](docs/POLICY.md)
5. 참고 구현: [알고리즘 설명](docs/ALGORITHM.md)
6. 다른 구현과 비교: [실험 가이드](docs/EXPERIMENTS.md)
7. 대용량 자료 복원·생성: [데이터 가이드](docs/DATA.md)
8. 공개 정리 범위와 실제 검증: [공개 검토](PUBLIC-RELEASE-REVIEW.md), [검증 기록](docs/VALIDATION.md)

`npm run build`는 `dist/client/`를 만듭니다. 업로드·배포·기존 서비스 변경은 하지 않습니다. 코드의 새 공개 라이선스는 정하지 않았으며, 데이터·의존성·기기 자산의 출처와 조건은 [출처 문서](data/ATTRIBUTION.md)에 구분했습니다.

## GitHub에 올릴 때

이 저장소는 새 이력으로 시작했고 원격 저장소는 아직 연결하지 않았습니다. GitHub에서 저장소를 준비한 뒤 아래의 URL을 실제 주소로 바꾸어 사용합니다. 공개 여부와 코드 라이선스는 소유자가 결정합니다.

```sh
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

작업 폴더 전체를 웹 업로드하거나 압축하지 마세요. 준비된 지도와 캐시가 로컬에는 있어도 Git에는 제외되어 있습니다. 소스 파일만 별도 압축해야 한다면 `git archive --format=zip --output=work/running-route-lab-source.zip HEAD`를 사용합니다. 이 ZIP은 Git 이력 없이 추적 파일만 담습니다.
