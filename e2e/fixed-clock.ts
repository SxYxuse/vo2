// Preloaded into the server (`bun --preload`): starts the clock at E2E_NOW and lets it tick, so
// token expiry and "x minutes ago" still behave while the dates stay the same on every run.

const offset = Date.parse(process.env.E2E_NOW ?? "") - Date.now();
if (Number.isNaN(offset)) throw new Error("E2E_NOW must be an ISO date");

const RealDate = Date;

class ShiftedDate extends RealDate {
  constructor(...args: [] | ConstructorParameters<typeof Date>) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }

  static override now() {
    return RealDate.now() + offset;
  }
}

globalThis.Date = ShiftedDate as DateConstructor;
