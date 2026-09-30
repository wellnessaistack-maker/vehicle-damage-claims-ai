// Claim details that arrive with the photos. In the prototype these are mocked;
// in production they come from first notice of loss and the policy system.

export type ImpactArea = "front" | "rear" | "left" | "right" | "unknown";

export interface ClaimContext {
  claimId: string;
  policyholder: string;
  policyVehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    colour: string | null;
    powertrain: "combustion" | "hybrid" | "electric" | "unknown";
  };
  /** Mock actual cash value. Illustrative only. */
  vehicleValueUsd: number | null;
  lossDate: string;
  lossDescription: string;
  /** Where the customer said the car was hit, from the claim form. */
  reportedImpactArea: ImpactArea;
  injuryReported: boolean;
  /** null when the customer didn't say. */
  vehicleDrivable: boolean | null;
  /** How many times we have already asked this customer for more photos. */
  priorEvidenceRequests: number;
  /** How to reach the customer. Used by the reviewer's screen only; never sent to the AI. */
  contact?: CustomerContact;
}

export interface CustomerContact {
  phone: string | null;
  email: string | null;
  preferred: "text" | "email";
}

/** Measured by code from the pixels. No AI involved. */
export interface PhotoMetrics {
  name: string;
  width: number;
  height: number;
  /** Mean brightness, 0 to 255. */
  brightness: number;
  /** Edge sharpness of the sharpest regions (Laplacian variance); higher is sharper. */
  sharpness: number;
  /** Share of pixels that are near-white, 0 to 1. */
  clippedHighlights: number;
  greyscale: boolean;
  /** Claim ID of a past claim this photo closely matches, if any. */
  nearDuplicateOf: string | null;
}
