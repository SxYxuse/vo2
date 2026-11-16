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
