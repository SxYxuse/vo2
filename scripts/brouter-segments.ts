import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/*
 * Downloads the BRouter map tiles (5° × 5° each, 50 to 300 MB) covering the given places into
 * the folder docker-compose mounts into vo2-brouter. Run by `vp run routing:up`, which covers
 * mock Strava's Paris rides; pass more places to route elsewhere:
 *
 *   bun scripts/brouter-segments.ts 50.85,4.35 45.9,6.1
 *
 * BRouter rebuilds the tiles from OpenStreetMap weekly; delete a tile to fetch a fresh one.
 */

const SEGMENTS_URL = "https://brouter.de/brouter/segments4";
const MOCK_HOME = "48.8584,2.2945";
const target = join(homedir(), ".cache", "vo2", "brouter", "segments4");

function tileName(lat: number, lng: number) {
  const lng5 = Math.floor(lng / 5) * 5;
  const lat5 = Math.floor(lat / 5) * 5;
  return `${lng5 < 0 ? `W${-lng5}` : `E${lng5}`}_${lat5 < 0 ? `S${-lat5}` : `N${lat5}`}.rd5`;
}

const places = process.argv.slice(2);
const tiles = new Set(
  (places.length ? places : [MOCK_HOME]).map((place) => {
    const [lat, lng] = place.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Expected lat,lng such as ${MOCK_HOME}, got "${place}"`);
    }
    return tileName(lat!, lng!);
  }),
);

mkdirSync(target, { recursive: true });
for (const tile of tiles) {
  const file = join(target, tile);
  if (existsSync(file)) {
    console.log(`${tile} already downloaded`);
    continue;
  }
  console.log(`Downloading ${tile}…`);
  const response = await fetch(`${SEGMENTS_URL}/${tile}`);
  if (!response.ok || !response.body) {
    throw new Error(`${tile}: brouter.de answered ${response.status}`);
  }
  // A partial file would look like a tile to BRouter, so it is renamed only once complete.
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(`${file}.part`),
  );
  renameSync(`${file}.part`, file);
  console.log(`${tile} saved to ${target}`);
}
