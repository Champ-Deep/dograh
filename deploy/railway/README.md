# Champ-Voice Railway test stack

Railway project: `Champ-Voice`

Region: Southeast Asia, Railway's closest available region to India.

## Services

| Railway service | Role | Public endpoint | Persistent storage |
| --- | --- | --- | --- |
| `api` | FastAPI web process, `./scripts/run_web.sh` | `https://api-production-5dcdd.up.railway.app` | None |
| `arq-worker` | Post-call processing and webhooks, `./scripts/run_arq_worker.sh` | None | None |
| `ui` | Next.js standalone server | `https://ui-production-7916.up.railway.app` | None |
| `Postgres` | Railway PostgreSQL with the `vector` extension verified | None | `/var/lib/postgresql/data` |
| `Redis` | Railway Redis with password authentication | None | `/data` |
| `Bucket` | MinIO S3-compatible storage from Railway's MinIO template | `https://bucket-production-6e95.up.railway.app` | `/data` |
| `Console` | MinIO console paired with `Bucket` | `https://console-production-b4b4.up.railway.app` | None |

`Bucket` replaces the initial direct `quay.io/minio/minio` attempt, which did not start successfully on Railway. It is a persistent MinIO deployment and is the storage service actually configured for Dograh. The application creates the `voice-audio` bucket on startup.

The API and UI use public Railway domains. API, worker, Postgres, Redis, and Bucket use Railway private DNS for service-to-service traffic where supported.

## Application variables

Never put values in this file. Set production values with `railway variable set --service <service> ...`.

| Service | Variables set for this stack |
| --- | --- |
| `api` | `BACKEND_API_ENDPOINT`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, `ENABLE_ARI_MANAGER`, `ENABLE_AWS_S3`, `ENABLE_CAMPAIGN_ORCHESTRATOR`, `ENABLE_COTURN`, `ENABLE_SIGNUP`, `ENABLE_TELEMETRY`, `ENVIRONMENT`, `FASTAPI_WORKERS`, `FORWARDED_ALLOW_IPS`, `LOG_LEVEL`, `MINIO_ACCESS_KEY`, `MINIO_BUCKET`, `MINIO_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_SECRET_KEY`, `MINIO_SECURE`, `OSS_JWT_SECRET`, `PORT`, `PUBLIC_BASE_URL`, `PUBLIC_HOST`, `RAILWAY_DOCKERFILE_PATH`, `REDIS_URL`, `TELEPHONY_WS_TOKEN_SECRET`, `UI_APP_URL` |
| `arq-worker` | `BACKEND_API_ENDPOINT`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, `ENABLE_ARI_MANAGER`, `ENABLE_AWS_S3`, `ENABLE_CAMPAIGN_ORCHESTRATOR`, `ENABLE_COTURN`, `ENABLE_SIGNUP`, `ENABLE_TELEMETRY`, `ENVIRONMENT`, `FASTAPI_WORKERS`, `FORWARDED_ALLOW_IPS`, `LOG_LEVEL`, `MINIO_ACCESS_KEY`, `MINIO_BUCKET`, `MINIO_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_SECRET_KEY`, `MINIO_SECURE`, `OSS_JWT_SECRET`, `PUBLIC_BASE_URL`, `PUBLIC_HOST`, `RAILWAY_DOCKERFILE_PATH`, `REDIS_URL`, `TELEPHONY_WS_TOKEN_SECRET`, `UI_APP_URL` |
| `ui` | `BACKEND_URL`, `ENABLE_TELEMETRY`, `HOSTNAME`, `NEXT_PUBLIC_BACKEND_URL`, `NODE_ENV`, `PORT`, `RAILWAY_DOCKERFILE_PATH` |
| `Bucket` | `MINIO_BROWSER_REDIRECT_URL`, `MINIO_PRIVATE_ENDPOINT`, `MINIO_PRIVATE_HOST`, `MINIO_PRIVATE_PORT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_PUBLIC_HOST`, `MINIO_PUBLIC_PORT`, `MINIO_ROOT_PASSWORD`, `MINIO_ROOT_USER`, `PORT` |
| `Postgres` | Railway template variables including `DATABASE_URL`, `PGDATABASE`, `PGHOST`, `PGPASSWORD`, `PGPORT`, `PGUSER` |
| `Redis` | Railway template variables including `REDIS_PASSWORD`, `REDIS_URL`, `REDISHOST`, `REDISPORT`, `REDISUSER` |

`DATABASE_URL` must use the `postgresql+asyncpg://` scheme. `REDIS_URL` includes the Redis password. `OSS_JWT_SECRET` and `TELEPHONY_WS_TOKEN_SECRET` are generated secrets. Do not copy secrets into git, logs, tickets, or documentation.

## Build and deployment

Both Dockerfiles build from the repository root because the API Dockerfile copies `api/`, `scripts/`, `docs/`, and the `pipecat/` submodule. `RAILWAY_DOCKERFILE_PATH` selects `api/Dockerfile` or `ui/Dockerfile`.

Railway application services are deployed from a checkout of `Champ-Deep/dograh`, branch `feat/personaplex-realtime`. They are intentionally disconnected from Railway GitHub triggers because Railway's GitHub build checkout does not initialize git submodules. Deploy this fork from a checkout with Pipecat initialized:

```bash
git submodule update --init pipecat
railway up --detach --service api
railway up --detach --service arq-worker
railway up --detach --service ui
```

Run migrations before an API rollout or after an Alembic revision:

```bash
railway ssh -s arq-worker 'cd /app && ./scripts/run_migrate.sh'
railway up --detach --service api
```

Check progress and health:

```bash
railway status
railway logs --service api --latest -n 100
curl -sS https://api-production-5dcdd.up.railway.app/api/v1/health
curl -sIL https://ui-production-7916.up.railway.app
```

## Add campaign orchestrator

Create another application service from the same repository and set the same backend variables as `arq-worker`. Configure its start command to:

```text
./scripts/run_campaign_orchestrator.sh
```

Do not enable `ENABLE_CAMPAIGN_ORCHESTRATOR` on `api` when this dedicated service exists.

## Known limits and costs

Railway does not provide UDP for a self-hosted TURN server. This stack does not deploy coturn or nginx. Browser WebRTC calls can fail through restrictive NATs. Twilio or Telnyx media WebSocket phone calls remain the intended test path.

The deployed services, two database volumes, and the MinIO volume incur Railway usage charges. Delete the test project when it is no longer needed.
