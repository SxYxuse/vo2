import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specUrl = "https://developers.strava.com/swagger/swagger.json";
const swaggerPath = resolve(root, "src/integrations/strava/spec/swagger.json");

async function main() {
  await mkdir(dirname(swaggerPath), { recursive: true });
  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Strava spec (${response.status})`);
  }
  await writeFile(swaggerPath, await response.text());
  console.log(`Wrote ${swaggerPath}`);
  console.log(
    "Convert + generate with:\n" +
      "  vp dlx swagger2openapi --patch --warnOnly src/integrations/strava/spec/swagger.json -o src/integrations/strava/openapi.json\n" +
      "  vp run generate:strava-sdk",
  );
}

await main();
