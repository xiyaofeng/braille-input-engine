import type { UIApi } from "./keyboard-ui-boundaries.js";

export const editableLayouts = [
  "light",
  "ui-shadow",
  "target-shadow",
  "both-shadow",
] as const;
export type EditableLayout = (typeof editableLayouts)[number];
export function setupEditableFocus(
  api: UIApi,
  layout: EditableLayout,
  activation: "focus" | "manual" | "always" = "focus",
  kind: "input" | "textarea" = "textarea",
  grouped = true,
) {
  const shell = document.createElement("section"),
    host = document.createElement("div");
  shell.append(host);
  document.body.append(shell);
  const root = host.attachShadow({ mode: "open" });
  const target = document.createElement(kind),
    mount = document.createElement("section"),
    outside = document.createElement("button");
  // The nonmember shares the shadow host with legitimate group members.
  root.append(outside);
  (layout === "target-shadow" || layout === "both-shadow"
    ? root
    : shell
  ).append(target);
  (layout === "ui-shadow" || layout === "both-shadow" ? root : shell).append(
    mount,
  );
  target.value = "LR";
  const deliveries: string[] = [],
    edits: string[] = [];
  const c = api.createBrailleController({
    onOutput: (_a, d) => deliveries.push(d),
  });
  const group = api.createActivationGroup(document);
  const editable = api.attachBrailleEditable(c, target, {
    activation,
    ...(grouped ? { activationGroup: group } : {}),
  });
  if (activation === "manual") editable.activate();
  const ui = api.createDefaultBrailleUI(c, mount, { activationGroup: group });
  for (const type of ["beforeinput", "input"])
    target.addEventListener(type, (e) => edits.push(e.type));
  target.focus();
  target.setSelectionRange(1, 1);
  const seed = () => {
    c.dispatch({ type: "dot-down", dot: 1, inputId: "seed", source: "api" });
    c.dispatch({ type: "dot-up", dot: 1, inputId: "seed", source: "api" });
  };
  const button = (part: string) =>
    mount.querySelector<HTMLButtonElement>(`[part="${part}-button"]`)!;
  const snapshot = () => ({
    text: target.value,
    deliveries: [...deliveries],
    edits: [...edits],
    pending: c.getState().pendingDots,
    retry: c.getState().awaitingRetry,
  });
  return {
    c,
    target,
    outside,
    editable,
    group,
    button,
    seed,
    snapshot,
    dispose() {
      ui.detach();
      editable.detach();
      group.destroy();
      c.destroy();
      shell.remove();
    },
  };
}

export function editableFocusCases(api: UIApi) {
  let count = 0;
  const failures: string[] = [];
  const scenarios = [
    "direct",
    "commit",
    "retry",
    "outside",
    "readonly",
    "disabled",
    "blur-beforeinput",
    "readonly-beforeinput",
    "detach-beforeinput",
    "cancel-beforeinput",
    "detach",
    "group-destroy",
  ] as const;
  for (const layout of editableLayouts)
    for (const kind of ["input", "textarea"] as const)
      for (const scenario of scenarios) {
        const p = setupEditableFocus(api, layout, "focus", kind);
        try {
          p.seed();
          if (scenario === "retry") {
            p.outside.focus();
            p.c.commitPending();
            if (
              JSON.stringify(p.snapshot()) !==
              JSON.stringify({
                text: "LR",
                deliveries: ["rejected"],
                edits: [],
                pending: [1],
                retry: true,
              })
            )
              throw new Error("retry precondition");
            p.target.focus();
            p.button("retry").focus();
            p.button("retry").click();
          } else {
            if (scenario === "commit") p.button("commit").focus();
            if (scenario === "outside") p.outside.focus();
            if (scenario === "readonly") p.target.readOnly = true;
            if (scenario === "disabled") p.target.disabled = true;
            if (scenario === "detach") p.editable.detach();
            if (scenario === "group-destroy") p.group.destroy();
            p.target.addEventListener(
              "beforeinput",
              (e) => {
                if (scenario === "blur-beforeinput") p.outside.focus();
                if (scenario === "readonly-beforeinput")
                  p.target.readOnly = true;
                if (scenario === "detach-beforeinput") p.editable.detach();
                if (scenario === "cancel-beforeinput") e.preventDefault();
              },
              { once: true },
            );
            if (scenario === "commit") p.button("commit").click();
            else p.c.commitPending();
          }
          const accepted = ["direct", "commit", "retry"].includes(scenario);
          const conflicted = [
            "blur-beforeinput",
            "readonly-beforeinput",
            "detach-beforeinput",
          ].includes(scenario);
          const delivery = accepted
            ? "accepted"
            : conflicted
              ? "conflicted"
              : scenario === "detach"
                ? "unhandled"
                : "rejected";
          const terminal = accepted || conflicted || scenario === "detach";
          const expected = {
            text: accepted ? "L⠁R" : "LR",
            deliveries:
              scenario === "retry"
                ? ["rejected", "accepted"]
                : scenario === "detach"
                  ? []
                  : [delivery],
            edits: accepted
              ? ["beforeinput", "input"]
              : conflicted || scenario === "cancel-beforeinput"
                ? ["beforeinput"]
                : [],
            pending: terminal ? [] : [1],
            retry: !terminal,
          };
          if (JSON.stringify(p.snapshot()) !== JSON.stringify(expected))
            throw new Error(JSON.stringify({ actual: p.snapshot(), expected }));
        } catch (e) {
          failures.push(`${layout}/${kind}/${scenario}: ${String(e)}`);
        } finally {
          p.dispose();
          count++;
        }
      }
  // Focus-only attachments must work without a group as well.
  for (const layout of editableLayouts) {
    const p = setupEditableFocus(api, layout, "focus", "textarea", false);
    try {
      p.seed();
      p.c.commitPending();
      if (p.snapshot().text !== "L⠁R")
        throw new Error("ungrouped direct write");
    } catch (e) {
      failures.push(`${layout}/ungrouped: ${String(e)}`);
    } finally {
      p.dispose();
      count++;
    }
  }
  return { count, failures };
}
