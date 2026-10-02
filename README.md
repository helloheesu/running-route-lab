# Running Route Lab — 다시, 여기로

러닝 순환 코스 알고리즘을 독립적으로 구현·비교하기 위한 **조사 문서 + 실행 가능한 웹 PoC**입니다. 출발지로 돌아오는 코스를 만들고, 전체 발견 후보에서 종합점수·고저차·신호 횡단 기준 대표를 비교합니다. 기존 알고리즘은 참고 기준이며 검증된 최적해나 정답 경로가 아닙니다.

## 빠른 실행

Node **24.x**, npm, Git이 필요합니다. 저장소를 복제한 뒤 아래 순서로 실행합니다.

```sh
git clone https://github.com/helloheesu/running-route-lab.git
cd running-route-lab
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

광역 지도는 저장소에 포함하지 않으며 선택적으로 내려받습니다. 샘플 범위 밖에서 계산하려면:

```sh
npm run data:regions
npm run data:check
```

완료 후 개발 서버를 다시 시작하거나 빌드합니다. 서울·경기·인천·부산·대구·울산·경북·경남의 등록 도로를 사용합니다. 지역 안이라도 보행망 연결이나 거리 조건 때문에 후보가 없을 수 있습니다. 지도 지원은 현장 통행 보증이 아닙니다.

## 기여하기

알고리즘 개선, 버그 수정, 조사 자료 보완을 PR(Pull Request)로 제안할 수 있습니다. 큰 구조 변경이나 추천 정책 변경은 먼저 이슈를 열어 문제와 접근 방법을 공유해 주세요. 실험 중인 구현도 Draft PR로 올려 함께 검토할 수 있습니다.

### 팀원: 이 저장소에서 브랜치 만들기

쓰기 권한을 받은 콜라보레이터는 포크 없이 작업합니다. `main`에 직접 푸시하지 않고, 최신 `main`에서 작업별 브랜치를 만든 뒤 PR을 보내 주세요. 다음은 `feat/route-search`라는 예시 브랜치를 만드는 명령입니다. 작업 내용에 맞게 이름을 바꿔 사용하세요.

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/route-search
```

수정 후 변경 내용을 확인하고 필요한 파일만 커밋합니다. 아래는 README.md를 수정한 예시이며, 파일 경로와 커밋 메시지는 실제 변경에 맞게 바꿔 주세요.

```sh
git diff
git add README.md
git commit -m "변경 내용 요약"
git push -u origin feat/route-search
```

GitHub에서 **base: `main` ← compare: 작업 브랜치**로 PR을 만들고 팀원에게 리뷰를 요청합니다. 리뷰 의견을 같은 브랜치에 반영한 뒤 병합합니다.

### 외부 기여자: 포크에서 PR 보내기

쓰기 권한이 없다면 GitHub에서 이 저장소를 Fork한 뒤 **본인 포크를 복제**하고 작업 브랜치를 만듭니다. `origin`은 본인 포크로 두고, 최신 변경을 가져올 원본을 `upstream`으로 추가합니다.

```sh
git remote add upstream https://github.com/helloheesu/running-route-lab.git
git fetch upstream
git switch -c feat/route-search upstream/main
```

수정·검증·커밋 후 `git push -u origin feat/route-search`로 본인 포크에 올립니다. GitHub에서 **대상: `helloheesu/running-route-lab`의 `main` ← 출처: 본인 포크의 작업 브랜치**로 PR을 생성합니다. 팀원과 외부 기여자 모두 변경 하나의 목적이 분명한 작은 PR을 권장합니다.

### 검증과 PR 설명

코드나 데이터 처리 변경은 Node 24에서 다음 명령을 통과해야 합니다. 문서만 바꿨다면 링크·명령·설명의 정확성을 확인하고, PR에 문서 변경임을 적어 주세요.

```sh
npm test
npm run data:check
npm run build
```

PR에는 **해결하려는 문제, 변경한 동작, 확인한 결과와 남은 한계**를 적어 주세요. UI 변경은 화면과 재현 순서를, 버그 수정은 문제가 발생하던 입력과 재발을 확인하는 검사를 함께 남깁니다.

알고리즘 변경은 [실험 가이드](docs/EXPERIMENTS.md)에 따라 같은 지도·출발지·거리·통행 조건에서 기존 구현과 비교합니다. 후보 수와 추천 결과뿐 아니라 경로 연결·거리 조건·결측 처리를 확인하고, 속도를 비교할 때는 기기·실행 환경·캐시 상태·탐색량도 기록합니다. 기존 코스와 좌표가 같아야 정답인 것은 아닙니다. 참고 실험은 다음과 같이 실행할 수 있습니다.

```sh
npm run bench -- --case postech-5k --runs 3
```

이 실험은 Node 실행 결과입니다. 브라우저 Worker나 실제 iPhone 성능으로 해석하지 않습니다. 추천 기준·가중치·결측 처리 정책을 바꾸면 [제품 정책](docs/POLICY.md)과 관련 테스트도 함께 갱신해 주세요. 기준 엔진을 변경한 경우에는 [AI 작업 안내](AGENTS.md)의 출처 기록 규칙을 따릅니다.

광역 지도, 원본 추출 파일, 캐시, 설치·빌드 결과, 인증 정보와 개인 컴퓨터의 절대 경로는 커밋하지 않습니다. 지도 준비·정리 규칙은 [데이터 가이드](docs/DATA.md)를 따릅니다. 커밋할 파일을 스테이징한 뒤 `npm run check:release`로 포함 목록을 검사할 수 있습니다.

## 읽는 순서

1. 설치·실행·문제 해결: [실행 가이드](docs/SETUP.md)
2. AI와 함께 코드 수정: [AGENTS.md](AGENTS.md)
3. 정보원과 한계: [조사 지식](docs/RESEARCH.md)
4. 합의한 조건과 실험 설정: [제품 정책](docs/POLICY.md)
5. 참고 구현: [알고리즘 설명](docs/ALGORITHM.md)
6. 다른 구현과 비교: [실험 가이드](docs/EXPERIMENTS.md)
7. 대용량 자료 복원·생성: [데이터 가이드](docs/DATA.md)
8. 공개 정리 범위와 실제 검증: [공개 검토](PUBLIC-RELEASE-REVIEW.md), [검증 기록](docs/VALIDATION.md)

`npm run build`는 정적 웹 파일을 `dist/client/`에 생성합니다. 코드 라이선스는 아직 지정되지 않았으며, 데이터·의존성·기기 자산의 출처와 조건은 [출처 문서](data/ATTRIBUTION.md)에 구분했습니다.
