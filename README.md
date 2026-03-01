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
- PostgreSQL은 외부 연결(`DATABASE_URL`)을 사용합니다.
- `PUBLIC_BASE_URL`를 설정하면 `robots.txt`, `sitemap.xml`, `api-discovery.json`의 기준 URL로 사용됩니다.

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
- Storage: PostgreSQL + JSON seed files
  - DB 테이블: `users`, `spots`, `reports`, `internal_cherry_spots`, `overpass_cache_entries`, `place_snapshots`
  - 파일 입력(마이그레이션용): `/data/*.json`
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
- `src/lib/*`: 공통 유틸(HTTP, 인증, PostgreSQL)

## Services

- `src/services/cherry.js`
  - 역할: OSM + 추천(`cherry-curated.json`) + 내부DB(`internal_cherry_spots`) + 승인 제보(DB `reports`)를 합쳐 지도용 요소 생성
  - 입력: `bboxRaw`, DB 접근 함수, 파일 경로, Overpass 엔드포인트 목록
  - 출력: `{ elements, meta }` (`overpass/curated/internal/community/total/cached/overpassError`)
  - 부가 동작: 조회 결과를 DB `place_snapshots`에 bbox 키별 스냅샷 저장
- `src/services/overpass.js`
  - 역할: Overpass 쿼리 생성, bbox 파싱, 중복 제거, 원격 조회
  - 주요 함수: `buildKoreaAreaQuery`, `buildBboxQuery`, `parseBbox`, `fetchOverpass`, `dedupeElements`
  - 동작: 다중 엔드포인트 재시도

## Serving Strategy

- `/api/osm/cherry`는 자체 DB를 우선 사용해 서빙합니다.
  - Overpass 결과는 DB `overpass_cache_entries`에 bbox 키 단위로 저장
  - 머지 결과는 DB `place_snapshots`에 저장하고, 짧은 TTL 내 재조회 시 snapshot에서 즉시 응답
  - 캐시 정책: `stale-while-revalidate`
  - fresh TTL: `bbox 5분`, `korea 30분`
  - stale TTL: `bbox 24시간`, `korea 7일`
  - fresh 만료 후 stale 구간이면 즉시 stale 응답 후 백그라운드 재검증
  - 동일 키 동시 요청은 in-flight dedupe로 Overpass 중복 호출 방지
  - 사용자 제보는 DB `reports` 중 `status=approved`만 합쳐서 노출
  - 최종 머지 결과는 DB `place_snapshots`에 스냅샷으로 저장

## PostgreSQL Setup

- 환경 변수 설정
  - `DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db>`
  - 선택(Overpass 캐시 튜닝)
    - `OVERPASS_BBOX_KEY_PRECISION=2` (0~6, 기본 2)
    - `OVERPASS_TTL_BBOX_MS=300000` (기본 5분)
    - `OVERPASS_STALE_TTL_BBOX_MS=86400000` (기본 24시간)
    - `OVERPASS_TTL_KOREA_MS=1800000` (기본 30분)
    - `OVERPASS_STALE_TTL_KOREA_MS=604800000` (기본 7일)
    - `OVERPASS_SNAPSHOT_TTL_MS=60000` (기본 60초, `place_snapshots` 응답 캐시 TTL)
  - 선택(Overpass 로그)
    - `OVERPASS_LOG_ENABLED=true` (기본 true)
    - `OVERPASS_LOG_DETAIL=true` (기본 true, false면 핵심 로그만)
- JSON -> PostgreSQL 마이그레이션

```bash
npm run db:migrate:json
```

- CSV -> PostgreSQL 대량 적재(추천/내부 스팟)

```bash
# 헤더 예시: id,name,lat,lon,region,memo,status
npm run db:import:csv -- --file ./data/cherry-extra.csv --mode curated
npm run db:import:csv -- --file ./data/cherry-extra.csv --mode internal
npm run db:import:csv -- --file ./data/cherry-extra.csv --mode curated --dry-run true
```

- 개발 서버 실행

```bash
npm run dev
```

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
- `GET /api/admin/cherry-spots?status=active|inactive|all` (admin)
- `POST /api/admin/cherry-spots` (admin)
- `PATCH /api/admin/cherry-spots/:id` (admin)
- `DELETE /api/admin/cherry-spots/:id` (admin, soft delete)

## Admin Bootstrap

- 최초 가입 사용자 1명은 자동으로 `admin` role이 됩니다.
- 이후 가입 사용자는 기본 `user` role로 생성됩니다.

## Next Upgrade

- 세션 저장소(PostgreSQL) -> Redis 세션/JWT 전환
- 사용자 권한/프로필 고도화
- Overpass 캐시를 Redis 기반으로 확장
