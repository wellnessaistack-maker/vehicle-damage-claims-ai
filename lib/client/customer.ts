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

export function defaultChannel(claim: ClaimContext): Channel | null {
  const available = channels(claim);
  const preferred = claim.contact?.preferred;
  return preferred && available.includes(preferred) ? preferred : (available[0] ?? null);
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
export function customerUpdate(d: Decision, claim: ClaimContext): string | null {
  const hi = `Hi ${firstName(claim) ?? "there"},`;
  const sign = ["", "Thanks,", "Your claims team"];
  if (d.route === "photo_estimate") {
    return [
      hi,
      "",
      `Thanks for the photos for claim ${claim.claimId}. They show us what we need, so your claim is now with our estimating team. You'll get your repair estimate within one business day, with the next steps for booking a repair.`,
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
