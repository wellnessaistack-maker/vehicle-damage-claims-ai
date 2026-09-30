// Loads the labelled evaluation cases from eval/cases.csv and eval/claims.json.
// Server and command-line only (reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEMO_CLAIMS } from "../claims/demo.ts";
import type { ClaimContext } from "../claims/types.ts";
import { applyOverrides, labelsFromRow, parseCasesCsv, type CaseLabels } from "./metrics.ts";

export interface EvalCase {
  caseId: string;
  photos: string[];
  priorClaimPhotos: string[];
  claim: ClaimContext;
  labels: CaseLabels;
}

export function loadEvalCases(root = process.cwd(/*turbopackIgnore: true*/)): EvalCase[] {
  const rows = parseCasesCsv(readFileSync(join(/*turbopackIgnore: true*/ root, "eval/cases.csv"), "utf8"));
  const claims = JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ root, "eval/claims.json"), "utf8")) as Record<string, ClaimContext>;
  const all: Record<string, ClaimContext> = { ...DEMO_CLAIMS, ...claims };
  return rows.map((row) => {
    const base = all[row.claim];
    if (!base) throw new Error(`Unknown claim "${row.claim}" in case ${row.case_id}`);
    const split = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean);
    return {
      caseId: row.case_id,
      photos: split(row.photos),
      priorClaimPhotos: split(row.prior_claim_photos),
      claim: { ...applyOverrides(base, row.claim_overrides), claimId: `EVAL-${row.case_id}` },
      labels: labelsFromRow(row),
    };
  });
}
