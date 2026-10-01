// Validates claim details and settings arriving from the browser.

import { z } from "zod";

export const claimSchema = z.object({
  claimId: z.string().min(1).max(64),
  policyholder: z.string().max(120),
  policyVehicle: z.object({
    year: z.number().int().min(1950).max(2100).nullable(),
    make: z.string().max(60).nullable(),
    model: z.string().max(60).nullable(),
    colour: z.string().max(40).nullable(),
    powertrain: z.enum(["combustion", "hybrid", "electric", "unknown"]),
  }),
  zip: z.string().max(10).nullable().optional(),
  vehicleValueUsd: z.number().min(0).max(5_000_000).nullable(),
  lossDate: z.string().max(20),
  lossDescription: z.string().max(1000),
  reportedImpactArea: z.enum(["front", "rear", "left", "right", "unknown"]),
  injuryReported: z.boolean(),
  vehicleDrivable: z.boolean().nullable(),
  priorEvidenceRequests: z.number().int().min(0).max(10),
  contact: z
    .object({
      phone: z.string().max(40).nullable(),
      email: z.string().max(120).nullable(),
      preferred: z.enum(["text", "email"]),
    })
    .optional(),
});
