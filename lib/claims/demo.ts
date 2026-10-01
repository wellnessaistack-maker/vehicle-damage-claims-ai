// Mock claim details for the demo cases. Names, IDs, values and contact details are made up
// (555-01xx numbers and example.com addresses are reserved for fiction).

import type { ClaimContext } from "./types.ts";

export const DEMO_CLAIMS: Record<string, ClaimContext> = {
  A: {
    claimId: "CLM-2026-10481",
    policyholder: "Maria Lopez",
    policyVehicle: { year: 2018, make: "Honda", model: "Civic", colour: "Silver", powertrain: "combustion" },
    zip: "43215",
    vehicleValueUsd: 14000,
    lossDate: "2026-09-28",
    lossDescription: "Parked on the street. Came back to find the driver's side rear door dented and scraped.",
    reportedImpactArea: "left",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
    contact: { phone: "(555) 010-0142", email: "maria.lopez@example.com", preferred: "text" },
  },
  B: {
    claimId: "CLM-2026-10482",
    policyholder: "Daniel Kim",
    policyVehicle: { year: 2019, make: "Honda", model: "Civic", colour: "Silver", powertrain: "combustion" },
    zip: "60614",
    vehicleValueUsd: 15500,
    lossDate: "2026-09-27",
    lossDescription: "Someone sideswiped my car in a parking lot. Sent a photo of the damage.",
    reportedImpactArea: "left",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
    contact: { phone: "(555) 010-0187", email: "daniel.kim@example.com", preferred: "text" },
  },
  C: {
    claimId: "CLM-2026-10483",
    policyholder: "Charles Leclerc",
    policyVehicle: { year: null, make: null, model: null, colour: null, powertrain: "unknown" },
    vehicleValueUsd: null,
    lossDate: "2026-09-26",
    lossDescription: "At the first corner at the start of the race, another car was launched into the air and landed on mine.",
    reportedImpactArea: "unknown",
    injuryReported: false,
    vehicleDrivable: false,
    priorEvidenceRequests: 0,
    contact: { phone: "(555) 010-0123", email: "charles.leclerc@example.com", preferred: "email" },
  },
  D: {
    claimId: "CLM-2026-10485",
    policyholder: "Grace Okafor",
    policyVehicle: { year: 2008, make: "Nissan", model: "Altima", colour: "White", powertrain: "combustion" },
    zip: "30307",
    vehicleValueUsd: 5500,
    lossDate: "2026-09-27",
    lossDescription: "Another car ran a red light and hit the front of my car. Towed from the scene.",
    reportedImpactArea: "front",
    injuryReported: false,
    vehicleDrivable: false,
    priorEvidenceRequests: 0,
    contact: { phone: "(555) 010-0169", email: "grace.okafor@example.com", preferred: "text" },
  },
  E: {
    claimId: "CLM-2026-10484",
    policyholder: "Tom Becker",
    policyVehicle: { year: 2019, make: "Toyota", model: "Camry", colour: "Grey", powertrain: "combustion" },
    zip: "85004",
    vehicleValueUsd: 17000,
    lossDate: "2026-09-28",
    lossDescription: "Hit a bollard pulling out of a car park. Front right corner damaged.",
    reportedImpactArea: "front",
    injuryReported: false,
    vehicleDrivable: true,
    priorEvidenceRequests: 0,
    contact: { phone: "(555) 010-0151", email: "tom.becker@example.com", preferred: "email" },
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
