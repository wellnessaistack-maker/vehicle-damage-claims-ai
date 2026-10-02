// Getting in touch with the customer: which channel, what to say, and when to follow up.
// Messages are drafts the reviewer can edit. In production they'd go out through the
// carrier's own texting and email systems; here they are recorded in the case thread.

import type { ClaimContext } from "../claims/types.ts";
import type { Decision } from "../policy/engine.ts";

export type Channel = "text" | "email";

export function firstName(claim: ClaimContext): string | null {
  const onFile = claim.policyholder && !/not on file|unknown/i.test(claim.policyholder);
  return onFile ? claim.policyholder.split(" ")[0] : null;
}

export function channels(claim: ClaimContext): Channel[] {
  const c = claim.contact;
  return [...(c?.phone ? (["text"] as const) : []), ...(c?.email ? (["email"] as const) : [])];
}

/**
 * Photo requests go by text, because the customer answers them from their phone with the
 * camera in hand. Everything else (updates, questions) goes by email, so there's a written
 * record. Falls back to whichever is on file. The reviewer can always switch.
 */
export type Purpose = "photos" | "update";
export function defaultChannel(claim: ClaimContext, purpose: Purpose = "update"): Channel | null {
  const available = channels(claim);
  const wanted: Channel = purpose === "photos" ? "text" : "email";
  return available.includes(wanted) ? wanted : (available[0] ?? null);
}

/** "Texted Maria at (555) 010-0142" or "Emailed maria.lopez@example.com". */
export function sentVia(claim: ClaimContext, channel: Channel): string {
  const name = firstName(claim) ?? "the customer";
  return channel === "text" ? `Texted ${name} at ${claim.contact?.phone}` : `Emailed ${name} at ${claim.contact?.email}`;
}

/**
 * The update a customer gets when the reviewer decides the route. Deliberately neutral
 * on the adjuster route: it never mentions a total loss or a fraud review.
 */
const approved = (d: Decision) => {
  const e = d.requiredOutputs.estimate;
  const n = e.likelyUsd ?? e.highUsd ?? 0;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};

export function customerUpdate(d: Decision, claim: ClaimContext): string | null {
  const hi = `Hi ${firstName(claim) ?? "there"},`;
  const sign = ["", "Thanks,", "Your claims team"];
  if (d.route === "photo_estimate") {
    return [
      hi,
      "",
      `We've reviewed the photos for claim ${claim.claimId} and approved a repair estimate of ${approved(d)}. We'll email you the itemised estimate and payment details within one business day, with the next steps for booking a repair.`,
      "",
      "If the repair shop finds more damage once they start, they'll send us a supplement and we'll review it.",
      ...sign,
    ].join("\n");
  }
  if (d.route === "adjuster") {
    return [
      hi,
      "",
      `Thanks for the photos for claim ${claim.claimId}. Your claim needs a closer look, so one of our adjusters will contact you within one business day to arrange the next steps.`,
      "",
      "If you need a tow or a rental car in the meantime, just reply to this message.",
      ...sign,
    ].join("\n");
  }
  return null;
}

export function reminder(claim: ClaimContext): string {
  return [
    `Hi ${firstName(claim) ?? "there"},`,
    "",
    `A quick reminder about the photos we asked for on claim ${claim.claimId}. You can add them here: claims.example.com/upload/${claim.claimId}. Once they arrive we can move your claim forward.`,
    "",
    "Thanks,",
    "Your claims team",
  ].join("\n");
}

/** Two business days after the request. */
export function followUpDate(fromIso: string): Date {
  const d = new Date(fromIso);
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

export const shortDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export const CALL_OUTCOMES = ["Reached them", "Left a voicemail", "No answer"] as const;

/** One line for the thread, so long messages don't flood it. */
export function preview(message: string): string {
  // Drop a greeting or sign-off line only when that's all the line is.
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  const body = lines.filter((l) => !/^(Hi|Hello|Dear)\s[^.,!?]{0,40},$|^Thanks,$|^Your claims team$/.test(l)).join(" ") || lines.join(" ");
  return body.length > 160 ? body.slice(0, 157) + "..." : body;
}
