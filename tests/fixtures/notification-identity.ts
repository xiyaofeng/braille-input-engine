import type * as Core from "../../src/index.js";

export function notificationIdentityCases(api: typeof Core) {
  const failures: string[] = [];
  for (const channel of ["State", "Output", "Diagnostic"] as const) {
    const calls: string[] = [];
    const f = () => {
      calls.push("f");
    };
    const g = () => {
      calls.push("g");
    };
    const c = api.createBrailleController({
      [channel === "State"
        ? "onStateChange"
        : channel === "Output"
          ? "onOutput"
          : "onDiagnostic"]: f,
    });
    const subscribe = (fn: () => void) => c[`subscribe${channel}`](fn);
    const fire = () => {
      calls.length = 0;
      if (channel === "State") {
        c.dispatch({ type: "dot-down", dot: 1, inputId: "one", source: "api" });
        c.dispatch({ type: "dot-up", dot: 1, inputId: "one", source: "api" });
      } else if (channel === "Output")
        c.dispatch({ type: "space-request", source: "api" });
      else {
        c.dispatch({ type: "dot-down", dot: 1, inputId: "one", source: "api" });
        c.dispatch({ type: "dot-down", dot: 2, inputId: "one", source: "api" });
      }
    };
    const check = (expected: string[], label: string) => {
      // State emits twice, once for down and once for up; both snapshots use the same order.
      const sequence =
        channel === "State" ? [...expected, ...expected] : expected;
      if (String(calls) !== String(sequence))
        failures.push(`${channel}:${label}:${calls.join(",")}`);
    };
    subscribe(g);
    const first = subscribe(f),
      second = subscribe(f);
    first();
    first();
    fire();
    check(["f", "g", "f"], "one duplicate removed");
    second();
    fire();
    check(["f", "g"], "constructor retained");
    c.destroy();

    const d = api.createBrailleController();
    const sub = (fn: () => void) => d[`subscribe${channel}`](fn);
    let armed = false,
      edited = false;
    let disposeLater = () => {};
    sub(() => {
      if (!armed) return;
      calls.push("edit");
      if (!edited) {
        edited = true;
        disposeLater();
        sub(() => {
          if (armed) calls.push("new");
        });
      }
      throw new Error("isolated observer");
    });
    disposeLater = sub(() => {
      if (armed) calls.push("later");
    });
    let ordinal = 0;
    const trigger = () => {
      if (channel === "State")
        d.dispatch({
          type: "dot-down",
          dot: 1,
          inputId: `s:${ordinal++}`,
          source: "api",
        });
      else if (channel === "Output")
        d.dispatch({ type: "space-request", source: "api" });
      else {
        d.dispatch({ type: "dot-down", dot: 1, inputId: "d", source: "api" });
        d.dispatch({ type: "dot-down", dot: 2, inputId: "d", source: "api" });
      }
    };
    armed = true;
    calls.length = 0;
    trigger();
    const expected =
      channel === "State" ? ["edit", "new", "later"] : ["edit", "later"];
    if (String(calls) !== String(expected))
      failures.push(`${channel}:snapshot:${calls.join(",")}`);
    calls.length = 0;
    trigger();
    if (String(calls) !== "edit,new")
      failures.push(`${channel}:next:${calls.join(",")}`);
    armed = false;
    d.destroy();
  }
  return failures;
}
