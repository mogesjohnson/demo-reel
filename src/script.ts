export type StepAction = "click" | "type" | "wait" | "scroll" | "goto";

export interface Step {
  action: StepAction;
  selector?: string;
  text?: string;
  ms?: number;
  y?: number;
  url?: string;
  caption?: string;
}

export interface DemoScript {
  steps: Step[];
}

const ACTIONS: StepAction[] = ["click", "type", "wait", "scroll", "goto"];

/** Validate parsed JSON as a DemoScript. Throws an Error listing every problem. */
export function validateScript(input: unknown): DemoScript {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error('Script must be a JSON object like {"steps": [...]}');
  }
  const steps = (input as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) throw new Error('Script needs a "steps" array');
  if (steps.length === 0) throw new Error('"steps" must contain at least one step');

  steps.forEach((raw, i) => {
    const at = `steps[${i}]`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    if (!ACTIONS.includes(s.action as StepAction)) {
      errors.push(`${at}.action: must be one of ${ACTIONS.join(", ")} (got ${JSON.stringify(s.action)})`);
      return;
    }
    const str = (k: string) => typeof s[k] === "string" && (s[k] as string).length > 0;
    const num = (k: string) => typeof s[k] === "number" && Number.isFinite(s[k]);
    for (const k of ["selector", "text", "url", "caption"]) {
      if (s[k] !== undefined && typeof s[k] !== "string") errors.push(`${at}.${k}: must be a string`);
    }
    for (const k of ["ms", "y"]) {
      if (s[k] !== undefined && !num(k)) errors.push(`${at}.${k}: must be a number`);
    }
    switch (s.action) {
      case "click":
        if (!str("selector")) errors.push(`${at}: "click" needs "selector"`);
        break;
      case "type":
        if (!str("selector")) errors.push(`${at}: "type" needs "selector"`);
        if (typeof s.text !== "string") errors.push(`${at}: "type" needs "text"`);
        break;
      case "wait":
        if (!num("ms") && !str("selector")) errors.push(`${at}: "wait" needs "ms" or "selector"`);
        break;
      case "scroll":
        if (!num("y") && !str("selector")) errors.push(`${at}: "scroll" needs "y" or "selector"`);
        break;
      case "goto":
        if (!str("url")) errors.push(`${at}: "goto" needs "url"`);
        break;
    }
  });

  if (errors.length) throw new Error(`Invalid script:\n  - ${errors.join("\n  - ")}`);
  return { steps: steps as Step[] };
}
