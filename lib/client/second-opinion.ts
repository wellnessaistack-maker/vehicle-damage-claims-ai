// A colleague's second opinion. In the prototype the reply is written here, from what the
// claim and the rules show, so the demo can play the round trip. In production the colleague
// answers in the case thread and the claim comes back to the reviewer's inbox.

import type { Decision } from "../policy/engine.ts";
import { usd } from "../policy/protocol.ts";
import type { CaseItem } from "./cases.ts";

/** The demo reply from whoever was asked: agrees or redirects, in their voice, and says where it should go. */
export function demoSecondOpinion(c: CaseItem, d: Decision | null, from = "dana"): string {
  const x = c.assessment?.ok ? c.assessment.extraction : null;
  const fired = (id: string) => !!d?.reasons.some((r) => r.id === id);
  const back = "Sending it back to you.";
  const totalLossUnit = from === "total_loss";

  if (x?.vehicle.vehicle_class === "race_or_non_road") {
    const f1 = /formula ?(1|one)|\bf1\b/i.test(x.vehicle.identification_evidence ?? "");
    const what = f1 ? "Formula One cars" : "race cars";
    return totalLossUnit
      ? `To my knowledge, we don't cover ${what}, so there's nothing for us to value here. A personal auto policy is for road cars. I'd confirm coverage with the policy team before anyone prices it. ${back}`
      : `To my knowledge, we don't cover ${what}. A personal auto policy is for road cars, so I wouldn't send a field adjuster out for this one. I'd confirm coverage with the policy team before anyone prices it. ${back}`;
  }
  if (!d) return `The tool couldn't assess this one, so it needs a manual look. ${back}`;
  if (d.siuReferral) return `Agree. The photo matches a past claim, so this should go to the Special Investigations Unit before anyone pays it. ${back}`;
  if (fired("C2"))
    return totalLossUnit
      ? `Agree it's likely a total loss. Hand it to us and we'll value it, rather than sending a field adjuster out. ${back}`
      : `Agree it's likely a total loss. I'd send it to the total loss unit for a valuation rather than a field inspection. ${back}`;
  if (totalLossUnit) return `This doesn't look like a total loss to us: the repair isn't close to what the car is worth. Keep it on its current route. ${back}`;
  if (d.route === "adjuster") {
    const why = d.reasons[0]?.title.toLowerCase();
    return `Agree it needs an adjuster${why ? `: ${why}` : ""}. Nothing I'd change. ${back}`;
  }
  if (d.route === "more_evidence") return `Agree, I wouldn't price it from these photos. Ask the customer for the photo the tool suggests. ${back}`;
  const e = d.requiredOutputs.estimate;
  const amount = e.likelyUsd ?? e.highUsd;
  return `The photos are clear${amount ? ` and ${usd(amount)} is in line with what I'd expect for this damage` : ""}. Fine to approve. ${back}`;
}
