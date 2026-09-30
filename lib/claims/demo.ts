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
  E: {
    claimId: "CLM-2026-10484",
    policyholder: "Tom Becker",
    policyVehicle: { year: 2019, make: "Toyota", model: "Camry", colour: "Grey", powertrain: "combustion" },
    vehicleValueUsd: 17000,
    lossDate: "2026-09-28",
    lossDescription: "Hit a bollard pulling out of a car park. Front right corner damaged.",
    reportedImpactArea: "front",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
  },
};

/** Demo folders are named after their case, e.g. "A-straightforward". */
export function demoClaimForFolder(folder: string): ClaimContext | null {
  const key = folder.split("/").pop()?.match(/^([A-Z])-/)?.[1];
  return key && DEMO_CLAIMS[key] ? { ...DEMO_CLAIMS[key] } : null;
}

/** Default details for uploaded cases with no claim attached. */
export function blankClaim(claimId: string): ClaimContext {
  return {
    claimId,
    policyholder: "Not on file",
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
