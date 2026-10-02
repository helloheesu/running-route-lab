# 현재 구현을 읽는 순서

웹 UI를 재현하지 않고 알고리즘만 실험해도 됩니다. 코드 위치는 현재 참고 구현의 안내이며 다른 언어·자료구조를 제한하지 않습니다.

```text
출발지·목표 거리·통행 조건
  → 주변 지도 준비 / 정리된 파일 검증
  → OSM 공유 노드 ID로 보행 그래프 구성
  → 100m 안의 길로 출발점 보정
  → 5가지 탐색 전략 × 2가지 방향 변형으로 후보 생성
  → 동일 순서 좌표 후보 중복 제거, 전체 후보와 출처 유지
  → 고도·횡단·시설·장점 및 거리/연장 보정 평가
  → 전체 후보의 기준별 우승 선정, 같은 ID 추천 이유 통합
  → UI 카드와 지도
```

## 핵심 모듈

- `src/engine/routing.js`: buildGraph, snapStart, shortestTree, generateRoutes, mergeExploration. 공유 노드·통행 태그로 방향 그래프를 만들고, 비용을 달리한 최단경로 탐색과 방향별 목적지 표본에서 왕복/돌아오는 경로를 구성합니다. 완전 탐색이 아닌 제한된 휴리스틱입니다.
- `src/engine/route-evidence.js`, `elevation.js`: 등록된 장점과 지형 추정. 정보가 없는 항목을 나쁜 조건으로 바꾸지 않습니다.
- `src/engine/route-comparison.js`, `route-clustering.js`: 거리·포함 관계·유사성. 점수 보정과 화면용 묶음을 구분합니다.
- `src/live-adapter.js`: 후보를 제품 형식으로 바꾸고 신호 통과 횟수를 따로 계산합니다. 기존 엔진 점수를 바꾸지 않습니다.
- `src/domain.ts`: 세 기준 추천, 동률/중복 처리, 지도 표현. Route와 Recommendation이 제품 입력/출력의 기준입니다.
- `src/poc-worker.js`: 두 변형×다섯 전략 실행과 취소/진행 상태. 메인 화면이 아닌 Worker에서 탐색합니다.
- `src/region-data.ts`: 필요한 주변 타일 병합, 캐시, 지형 수신. 광역 파일이 없으면 샘플 외 실행을 안내합니다.

## 최소 실험 호출

```js
const graph = buildGraph(raw, bbox, terrain);
const batches = [];
for (let variant = 0; variant < 2; variant++) {
  for (const profile of EXPLORATION_STRATEGIES) {
    batches.push({
      ...generateRoutes(graph, {point, distance, avoidSteps: true, profile, variant, collect: true}),
      strategy: profile, variant,
    });
  }
}
const result = mergeExploration(batches, {point, distance, avoidSteps: true});
const routes = adaptLiveRoutes(result.routes, graph);
const {cards, pending} = recommend(routes);
```

실행 가능한 전체 예시는 `scripts/benchmark.mjs`에 있습니다. 입력 좌표는 `[위도, 경도]`, 거리는 m입니다. 원본 후보 ID는 순위가 아닙니다. 핵심 모듈의 복사 출처와 해시는 source-provenance.json에 남겨두었습니다.

새 구현은 위 함수를 그대로 따를 필요가 없습니다. 비교 시 입력·제한·결측 정책을 동일하게 하고, 출력에는 적어도 경로 좌표, 실제 거리, 후보 식별자, 평가 가능한 지표와 결측 상태를 남기세요. 평가 정책까지 바꾸면 별도 실험으로 표시합니다.
