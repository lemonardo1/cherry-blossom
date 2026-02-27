# Cherry Atlas KR

OSM + Overpass 기반 대한민국 벚꽃 지도 풀스택 스타터입니다.

## Node Runtime

- Recommended: Node `20+`
- `.nvmrc` included (`20`)

## Docker

```bash
docker build -t cherry-blossom-map:local .
docker run --rm -p 8080:8080 cherry-blossom-map:local
```

서버: `http://127.0.0.1:8080`

참고:
- 컨테이너는 `HOST=0.0.0.0`, `PORT=8080` 기준으로 실행됩니다.
- JSON DB(`data/*.json`)는 컨테이너 내부 파일시스템을 사용합니다(재시작 시 비영속).

## GCP (Cloud Run 준비)

`cloudbuild.yaml`을 사용해 빌드+배포:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=asia-northeast3,_REPO=cherry-blossom,_SERVICE=cherry-blossom-map,_IMAGE=cherry-blossom-map
```

수동 이미지 빌드/푸시:

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/REPO/cherry-blossom-map:latest
```

Cloud Run 배포:

```bash
gcloud run deploy cherry-blossom-map \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPO/cherry-blossom-map:latest \
  --region REGION \
  --platform managed \
  --allow-unauthenticated
```

## Stack

- Frontend: Vanilla JS + Leaflet (`/public`)
- Backend: Node.js built-in HTTP server (entry: `/server.js`, modules: `/src`)
- Storage: JSON 파일 DB
  - 사용자: `/data/users.json`
  - 개인 저장 스팟: `/data/spots.json`
  - 사용자 제보: `/data/reports.json`
  - Overpass 캐시: `/data/overpass-cache.json`
  - 서빙 카탈로그 스냅샷: `/data/places.json`
  - 추천 데이터: `/data/cherry-curated.json`

## Backend Structure

- `src/server.js`: 서버 부트스트랩
- `src/routes/api/index.js`: API 라우팅 조합
- `src/routes/api/auth.js`: 인증 API
- `src/routes/api/spots.js`: 스팟 API
- `src/routes/api/reports.js`: 사용자 제보 API
- `src/routes/api/osm.js`: OSM 프록시 API
- `src/routes/api/health.js`: 헬스체크 API
- `src/routes/static.js`: 정적 파일 서빙
- `src/services/cherry.js`: 벚꽃 데이터 집계
- `src/services/overpass.js`: Overpass 쿼리/캐시
- `src/lib/*`: 공통 유틸(HTTP, 인증, 파일 DB)

## Services

- `src/services/cherry.js`
  - 역할: OSM + 추천(`cherry-curated.json`) + 승인 제보(`reports.json`)를 합쳐 지도용 요소 생성
  - 입력: `bboxRaw`, `readJson/writeJson`, 파일 경로, Overpass 엔드포인트 목록
  - 출력: `{ elements, meta }` (`overpass/curated/community/total/cached/overpassError`)
  - 부가 동작: 조회 결과를 `places.json`에 bbox 키별 스냅샷으로 저장
- `src/services/overpass.js`
  - 역할: Overpass 쿼리 생성, bbox 파싱, 중복 제거, 원격 조회
  - 주요 함수: `buildKoreaAreaQuery`, `buildBboxQuery`, `parseBbox`, `fetchOverpass`, `dedupeElements`
  - 동작: 다중 엔드포인트 재시도

## Serving Strategy

- `/api/osm/cherry`는 자체 DB를 우선 사용해 서빙합니다.
  - Overpass 결과는 `overpass-cache.json`에 bbox 키 단위로 TTL 저장 (`bbox: 5분`, `korea: 30분`)
  - Overpass 장애 시 만료된 캐시(stale)라도 있으면 폴백 서빙
  - 사용자 제보는 `reports.json` 중 `status=approved`만 합쳐서 노출
  - 최종 머지 결과는 `places.json`에 스냅샷으로 저장

## API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/osm/cherry?bbox=minLon,minLat,maxLon,maxLat`
- `GET /api/spots?mine=1`
- `POST /api/spots`
- `DELETE /api/spots/:id`
- `GET /api/reports?mine=1`
- `POST /api/reports`
- `PATCH /api/reports/:id` (`status`: `pending|approved|rejected`)

## Next Upgrade

- JSON 파일 DB -> PostgreSQL(+Prisma) 교체
- 세션 메모리 저장 -> Redis 세션/JWT 전환
- 사용자 권한/프로필 고도화
- Overpass 캐시를 Redis 기반으로 확장
