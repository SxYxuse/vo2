#!/usr/bin/env bash
# Waits until the page answers taps and shows its data, as e2e's settle() does: React hydrated
# (taps before it are lost), the network idle, no skeleton and no Loading status.
# Optionally waits for a Playwright locator first, e.g. a heading the next screen shows:
#   scripts/settle.sh "getByRole('heading', { name: 'Long run', level: 1 })"
source "$(dirname "$0")/env.sh"
wait_for=${1:-}
wait_js=""
[ -n "$wait_for" ] && wait_js="await page.${wait_for}.first().waitFor({ timeout: 30000 });"
"$VO2_SCRIPTS/pw.sh" --raw run-code "async page => {
  ${wait_js}
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.locator('[data-slot=skeleton]').first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.getByRole('status', { name: 'Loading' }).first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  return page.url();
}"
