# Cherry Atlas KR

OSM + Overpass 기반 대한민국 벚꽃 지도 풀스택 스타터입니다.

## Node Runtime

- Recommended: Node `20+`
- `.nvmrc` included (`20`)

## Run

```bash
cd /Users/mediology/cherry-blossom
npm run dev
# or
npm start
```

서버: `http://127.0.0.1:3000`

## Stack

- Frontend: Vanilla JS + Leaflet (`/public`)
- Backend: Node.js built-in HTTP server (`/server.js`)
- Storage: JSON 파일 DB (`/data/users.json`, `/data/spots.json`, `/data/cherry-curated.json`)

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

## Next Upgrade

- JSON 파일 DB -> PostgreSQL(+Prisma) 교체
- 세션 메모리 저장 -> Redis 세션/JWT 전환
- 사용자 권한/프로필 고도화
- Overpass 캐시를 Redis 기반으로 확장
