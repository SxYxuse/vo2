# Production, staging, previews and logs

Everything runs on this VPS, under Dokploy (Docker Swarm), in the Dokploy project **VO2**. Prod, staging, every PR preview and their databases are containers you can reach from here with `docker`. Facts below were checked against the running setup on 2026-11-09; the ones marked _unverified_ were not.

## Safety

These rules hold for prod, staging and previews alike.

- **Read-only by default.** `docker ps`, `docker inspect`, `docker logs`, `\l`, `\dt`, `SELECT count(*)` and the `SELECT`s you need are fine.
- **Writes need the developer's explicit confirmation, every time:** `INSERT`/`UPDATE`/`DELETE`, DDL, `db:migrate` pointed at a deployed database, restarting or recreating a container, changing a Dokploy setting or environment variable, and deleting an athlete in the app.
- **A preview is staging.** Every preview uses staging's database and Strava app, so anything you do on a preview happens on staging and every other preview too.
- **Exports of athlete data** need the same confirmation. Keep them in your scratchpad, never in the worktree, and delete them when done.
- **Secrets:** `docker inspect` prints every environment variable with its value. List names only (`docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1`), and keep passwords, tokens and connection strings out of docs, PRs, commits and replies.

## Where things run

Swarm container names are `<appName>.1.<task id>`; find one with `docker ps --filter name=<appName>`.

|                    | Prod                                            | Staging                                      | PR previews                                                                                 |
| ------------------ | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| URL                | https://vo2.melvyn.be                           | https://stg.vo2.melvyn.be                    | `https://preview-…-<id>.preview.vo2.melvyn.be`, posted on the PR by Dokploy                 |
| Dokploy            | environment `production`, app `Web`             | environment `staging`, app `Web`             | previews of the staging app                                                                 |
| App container      | `app-parse-digital-array-16bbqr`                | `app-hack-open-source-array-6q5oau`          | `preview-app-hack-open-source-array-6q5oau-<id>`                                            |
| Deploys            | a release tag (`.github/workflows/release.yml`) | every push to `main`                         | every push to a PR labelled `preview`, at most 3 at once (`.agents/skills/preview-deploy/`) |
| Database container | `postgres-synthesize-digital-hard-drive-mf6y3a` | `postgres-transmit-multi-byte-matrix-pquq7s` | staging's                                                                                   |
| `APP_ENV`          | `production`                                    | `staging`                                    | `preview`                                                                                   |
| Strava app         | its own                                         | shared with previews                         | staging's                                                                                   |
| Logs               | Loki                                            | Loki                                         | `docker logs` only                                                                          |

**What's in prod:** the latest release tag (`gh release list -L 1`). Staging runs `origin/main`.

**Databases:** database `vo`, user `vo`, port 5432 on the Docker network only, not published on the host. Read one with `docker exec <container> psql -U vo -d vo -c '\dt'`.

Not part of any deployment:

- `vo2-postgres` (host port 55432) is the local dev Postgres every checkout shares (see AGENTS.md).
- `vo2-database-4usk1q` (host port 15432) and `vo2-database-sgmfhm` (host port 15433) hold leftover VO2 tables in database `postgres`. No app points at them and Dokploy doesn't manage them. Leave them alone; what they were is _unverified_.

## Strava apps

Prod has its own Strava app; staging and every preview share a second one (their client IDs differ). Deleting an athlete on staging or any preview revokes their Strava access for staging and all previews.

Strava allows one push subscription per app (ADR 0034, whose note on previews predates the split apps), so only one deployment on the staging app receives webhook events. Which one it points at is _unverified_: checking needs a call to Strava.

`vp run strava:subscribe` refuses to run while `STRAVA_MOCK` is set, which every worktree's `.env` does. Run it with the deployment's environment and `STRAVA_MOCK=` (empty); with `STRAVA_MOCK=1`, `--mock` subscribes the mock on purpose.

## Preview environment variables

Read from the running preview container on 2026-11-09 (Dokploy stores them encrypted):

- `APP_ENV=preview`, so previews get their blue tile and PWA chrome.
- `NODE_ENV=production`, and `BETTER_AUTH_URL` is the preview's own URL.
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, the Strava variables and `STRAVA_WEBHOOK_SECRET` are staging's.
- No `LOKI_HOST`, so preview logs go to the console: read them with `docker logs <preview container>`.

## Logs

Prod and staging send request logs to Loki only; their `docker logs` shows just startup and migration output, which helps when a deploy fails to boot. Browse them in Grafana at https://logs.vo2.melvyn.be (the developer's login; data source **Loki**).

Labels: `app="vo2"`, `environment` (`production` or `staging`), `level`, `method`, `path`, `requestId`, `userId`. For example:

```logql
{app="vo2", environment="production", level="error"}
{app="vo2", requestId="<id>"}
```

Loki isn't published on the host and its container has no shell, so from here query it through the Grafana container, read-only:

```bash
q=$(jq -rn --arg q '{app="vo2", environment="production", level="error"}' '$q|@uri')
docker exec vo2-observability-slpmav-vo2-grafana-1 \
  wget -qO- "http://vo2-loki:3100/loki/api/v1/query_range?query=$q&since=24h&limit=50"
```

## Sharing a dev server with the developer

The developer's browser is not on this VPS, so a `localhost` link doesn't open for them. They reach the VPS over Tailscale at `my-vps.tailec2b6d.ts.net` (`tailscale status --json | jq -r .Self.DNSName`). Three things stand in the way: the dev server listens on 127.0.0.1 only, Vite rejects host names it doesn't know, and sign-in redirects to `BETTER_AUTH_URL`. Start it like this, which overrides `.env` without editing it. Bind the Tailscale address, never a bare `--host`: this VPS has no firewall, so that would put the mock sign-in on its public IP.

```bash
PORT=$(grep '^PORT=' .env | cut -d= -f2)
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ts.net \
BETTER_AUTH_URL=http://my-vps.tailec2b6d.ts.net:$PORT STRAVA_MOCK=1 vp dev --host "$(tailscale ip -4)"
```

Then share `http://my-vps.tailec2b6d.ts.net:<PORT>/`.
