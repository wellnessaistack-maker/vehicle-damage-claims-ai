// Mock claim details for the demo cases. Names, IDs and values are made up.

import type { ClaimContext } from "./types.ts";

export const DEMO_CLAIMS: Record<string, ClaimContext> = {
  A: {
    claimId: "CLM-2026-10481",
    policyholder: "Maria Lopez",
    policyVehicle: { year: 2018, make: "Honda", model: "Civic", colour: "Silver", powertrain: "combustion" },
    vehicleValueUsd: 14000,
    lossDate: "2026-09-28",
    lossDescription: "Parked on the street. Came back to find the driver's side rear door dented and scraped.",
    reportedImpactArea: "left",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
  },
  B: {
    claimId: "CLM-2026-10482",
    policyholder: "Daniel Kim",
    policyVehicle: { year: 2019, make: "Honda", model: "Civic", colour: "Silver", powertrain: "combustion" },
    vehicleValueUsd: 15500,
    lossDate: "2026-09-27",
    lossDescription: "Someone sideswiped my car in a parking lot. Sent a photo of the damage.",
    reportedImpactArea: "left",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
  },
  C: {
    claimId: "CLM-2026-10483",
    policyholder: "Priya Shah",
    policyVehicle: { year: null, make: null, model: null, colour: null, powertrain: "unknown" },
    vehicleValueUsd: null,
    lossDate: "2026-09-26",
    lossDescription: "Multi-car collision at the start of a race. Car went airborne over another car.",
    reportedImpactArea: "unknown",
    injuryReported: false,
    vehicleDrivable: false,
    priorEvidenceRequests: 0,
  },
};

/** Default details for uploaded cases with no claim attached. */
export function blankClaim(claimId: string): ClaimContext {
  return {
    claimId,
    policyholder: "Unknown policyholder",
    policyVehicle: { year: null, make: null, model: null, colour: null, powertrain: "unknown" },
    vehicleValueUsd: null,
    lossDate: new Date().toISOString().slice(0, 10),
    lossDescription: "Not provided",
    reportedImpactArea: "unknown",
    injuryReported: false,
    vehicleDrivable: null,
    priorEvidenceRequests: 0,
  };
}
