/*
 * Reads VO2's deployments from the Dokploy API. Its commands are read-only.
 *
 *   bun scripts/dokploy.ts check                          is the API key valid? Run this first.
 *   bun scripts/dokploy.ts deploys <target> [--limit 5]   recent deployments, newest first
 *   bun scripts/dokploy.ts logs <deploymentId> [--tail 200]   a deployment's build log
 *   bun scripts/dokploy.ts wait <target> [--commit <sha>] [--timeout 900]
 *
 * <target> is prod, staging, or pr-<number> (that PR's preview).
 *
 * `wait` polls until the deployment of one commit finishes, then exits 0 when it is done and 1
 * when it failed or the timeout passed. The commit defaults to the PR's head (pr-<n>),
 * origin/main (staging), or the latest release tag (prod). It sleeps inside its own process, so
 * an agent whose shell blocks `sleep` runs it in the background and waits for it to exit.
 *
 * The URL and key come from DOKPLOY_URL and DOKPLOY_API_TOKEN, or else from ~/.config/dokploy/url
 * and ~/.config/dokploy/token. The key is never printed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const CONFIG_DIR = join(homedir(), ".config/dokploy");
const TOKEN_FILE = join(CONFIG_DIR, "token");

// Dokploy API keys expire (the developer keeps them short-lived), so a 401 is the normal way an
// agent learns the key ran out. These steps get a new one without the key passing through chat.
const RENEWAL = `To renew the Dokploy API key:
  1. Ask the developer for a new key with the request_secret tool (delivery "file"). Point them
     at <Dokploy URL>/dashboard/settings/profile, section "API/CLI Keys", with the URL from
     ~/.config/dokploy/url. Never ask for the key in chat.
  2. Store it: mkdir -p -m 700 ~/.config/dokploy && install -m 600 "<file request_secret returned>" ${TOKEN_FILE}
     then delete the file request_secret wrote.
  3. Verify: bun scripts/dokploy.ts check`;

type Deployment = {
  deploymentId: string;
  title: string;
  description: string | null;
  status: "idle" | "running" | "done" | "error" | "cancelled";
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type Preview = {
  previewDeploymentId: string;
  appName: string;
  pullRequestNumber: string;
  pullRequestURL: string;
  pullRequestTitle: string;
  previewStatus: string;
  createdAt: string;
};

function readSetting(variable: string, file: string) {
  const fromEnv = process.env[variable]?.trim();
  if (fromEnv) return fromEnv;
  const path = join(CONFIG_DIR, file);
  if (!existsSync(path)) return undefined;
  if (file === "token" && (statSync(path).mode & 0o077) !== 0)
    stop(`${path} is readable by other users. Run: chmod 600 ${path}`);
  return readFileSync(path, "utf8").trim() || undefined;
}

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

function settings() {
  const url = readSetting("DOKPLOY_URL", "url");
  if (!url) stop(`No Dokploy URL: set DOKPLOY_URL or write it to ${join(CONFIG_DIR, "url")}.`);
  const token = readSetting("DOKPLOY_API_TOKEN", "token");
  if (!token)
    stop(`No Dokploy API key: set DOKPLOY_API_TOKEN or write ${TOKEN_FILE}.\n\n${RENEWAL}`);
  return { url: url.replace(/\/$/, ""), token };
}

export async function dokploy<T>(endpoint: string, body?: object): Promise<T> {
  const { url, token } = settings();
  const response = await fetch(`${url}/api/${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: { "x-api-key": token, "content-type": "application/json" },
    body: body && JSON.stringify(body),
    // A hung request would otherwise outlast `wait --timeout`.
    signal: AbortSignal.timeout(30_000),
  }).catch((error: Error) =>
    stop(`Cannot reach the Dokploy URL (DOKPLOY_URL or ~/.config/dokploy/url): ${error.message}`),
  );
  if (response.status === 401)
    stop(`Dokploy rejected the API key (401): it expired or was deleted.\n\n${RENEWAL}`);
  if (!response.ok)
    stop(`Dokploy ${endpoint} failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  return (await response.json()) as T;
}

/** The Web app of the VO2 project's `production` or `staging` environment. */
async function webAppId(environment: "production" | "staging") {
  type Project = {
    name: string;
    environments: { name: string; applications: { name: string; applicationId: string }[] }[];
  };
  const projects = await dokploy<Project[]>("project.all");
  const app = projects
    .find((project) => project.name === "VO2")
    ?.environments.find((env) => env.name === environment)
    ?.applications.find((application) => application.name === "Web");
  if (!app) stop(`No Web app in the VO2 project's ${environment} environment.`);
  return app.applicationId;
}

/** Previews only exist on the staging app (see docs/agents/production.md). */
export async function listPreviews() {
  const staging = await webAppId("staging");
  return dokploy<Preview[]>(`previewDeployment.all?applicationId=${staging}`);
}

export const REPO = "SxYxuse/vo2";
const TARGET = /^(prod|staging|pr-\d+)$/;

async function deployments(target: string): Promise<Deployment[]> {
  if (target === "prod" || target === "staging") {
    const app = await webAppId(target === "prod" ? "production" : "staging");
    return dokploy(`deployment.all?applicationId=${app}`);
  }
  const pr = target.slice("pr-".length);
  const preview = (await listPreviews()).find((p) => p.pullRequestNumber === pr);
  if (!preview) return [];
  return dokploy(`deployment.allByType?type=previewDeployment&id=${preview.previewDeploymentId}`);
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function defaultCommit(target: string) {
  if (target === "staging") {
    git("fetch", "--quiet", "origin", "main");
    return git("rev-parse", "origin/main");
  }
  if (target === "prod") {
    git("fetch", "--quiet", "--tags", "origin");
    const tag = execFileSync(
      "gh",
      ["release", "view", "-R", REPO, "--json", "tagName", "-q", ".tagName"],
      {
        encoding: "utf8",
      },
    ).trim();
    return git("rev-list", "-n", "1", tag);
  }
  const pr = target.slice("pr-".length);
  return execFileSync(
    "gh",
    ["pr", "view", pr, "-R", REPO, "--json", "headRefOid", "-q", ".headRefOid"],
    {
      encoding: "utf8",
    },
  ).trim();
}

/** Dokploy writes the commit into the description: "Commit: <sha>", or "Hash: <sha>" on previews. */
function commitOf(deployment: Deployment) {
  return /\b([0-9a-f]{40})\b/.exec(deployment.description ?? "")?.[1];
}

function line(deployment: Deployment) {
  const title = deployment.title.split("\n")[0];
  const commit = commitOf(deployment)?.slice(0, 7) ?? "-------";
  const error = deployment.errorMessage ? `  ${deployment.errorMessage}` : "";
  return `${deployment.status.padEnd(9)} ${deployment.createdAt}  ${commit}  ${deployment.deploymentId}  ${title}${error}`;
}

async function wait(target: string, commit: string, timeoutSeconds: number) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  console.log(`Waiting up to ${timeoutSeconds}s for ${target} to deploy ${commit.slice(0, 7)}…`);
  let last = "";
  while (Date.now() < deadline) {
    const deployment = (await deployments(target)).find((d) => commitOf(d) === commit);
    const status = deployment ? line(deployment) : "not started";
    if (status !== last) console.log(status);
    last = status;
    if (deployment?.status === "done") return;
    if (deployment && ["error", "cancelled"].includes(deployment.status))
      stop(
        `Deployment failed. Read its log: bun scripts/dokploy.ts logs ${deployment.deploymentId}`,
      );
    await sleep(Math.max(0, Math.min(15_000, deadline - Date.now())));
  }
  stop(`Timed out after ${timeoutSeconds}s; last seen: ${last}`);
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: "string", default: "5" },
      tail: { type: "string", default: "200" },
      commit: { type: "string" },
      timeout: { type: "string", default: "900" },
    },
  });
  const [command, argument] = positionals;
  const timeout = Number(values.timeout);
  if (["deploys", "wait"].includes(command ?? "") && argument && !TARGET.test(argument))
    stop(`Unknown target "${argument}": use prod, staging, or pr-<number>.`);
  for (const option of ["limit", "tail", "timeout"] as const)
    if (!(Number(values[option]) > 0)) stop(`--${option} must be a positive number.`);

  if (command === "check") {
    await dokploy("project.all");
    console.log("Dokploy API key OK.");
  } else if (command === "deploys" && argument) {
    const list = (await deployments(argument)).slice(0, Number(values.limit));
    console.log(list.length ? list.map(line).join("\n") : `No deployments for ${argument}.`);
  } else if (command === "logs" && argument) {
    console.log(
      await dokploy<string>(`deployment.readLogs?deploymentId=${argument}&tail=${values.tail}`),
    );
  } else if (command === "wait" && argument) {
    await wait(argument, values.commit ?? defaultCommit(argument), timeout);
  } else {
    stop(
      "Usage: bun scripts/dokploy.ts check | deploys <target> | logs <deploymentId> | wait <target>",
    );
  }
}
