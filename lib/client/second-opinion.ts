// A colleague's second opinion. In the prototype the reply is written here, from what the
// claim and the rules show, so the demo can play the round trip. In production the colleague
// answers in the case thread and the claim comes back to the reviewer's inbox.

import type { Decision } from "../policy/engine.ts";
import { usd } from "../policy/protocol.ts";
import type { CaseItem } from "./cases.ts";

/** Dana's demo reply: agrees or redirects, in a colleague's voice, and says where it should go. */
export function demoSecondOpinion(c: CaseItem, d: Decision | null): string {
  const x = c.assessment?.ok ? c.assessment.extraction : null;
  const fired = (id: string) => !!d?.reasons.some((r) => r.id === id);

  if (x?.vehicle.vehicle_class === "race_or_non_road") {
    const f1 = /formula ?(1|one)|\bf1\b/i.test(x.vehicle.identification_evidence ?? "");
    const what = f1 ? "Formula One cars" : "race cars";
    return `To my knowledge, we don't cover ${what}. A personal auto policy is for road cars, so I wouldn't send a field adjuster out for this one. I'd confirm coverage with the policy team before anyone prices it. Sending it back to you.`;
  }
  if (!d) return "The tool couldn't assess this one, so it needs a manual look. Happy to take it if you're short on time. Sending it back to you.";
  if (d.siuReferral) return "Agree. The photo matches a past claim, so this should go to the Special Investigations Unit before anyone pays it. Sending it back to you.";
  if (fired("C2")) return "Agree it's likely a total loss. I'd send it to the total loss unit for a valuation rather than a field inspection. Sending it back to you.";
  if (d.route === "adjuster") {
    const why = d.reasons[0]?.title.toLowerCase();
    return `Agree it needs an adjuster${why ? `: ${why}` : ""}. Nothing I'd change. Sending it back to you.`;
  }
  if (d.route === "more_evidence") return "Agree, I wouldn't price it from these photos. Ask the customer for the photo the tool suggests. Sending it back to you.";
  const e = d.requiredOutputs.estimate;
  const amount = e.likelyUsd ?? e.highUsd;
  return `The photos are clear${amount ? ` and ${usd(amount)} is in line with what I'd expect for this damage` : ""}. Fine to approve. Sending it back to you.`;
}
