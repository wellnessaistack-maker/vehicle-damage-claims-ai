# Evaluation set

A small labelled set for checking that nothing broke, not a statistical proof. The real numbers come from the carrier's own historical claims.

## Files

- `cases.csv` has one row per test case. A case can have several photos (separated by `;`) and can change claim details with `claim_overrides` (for example `injuryReported=true`).
- `claims.json` has claim details used by the test cases. Cases can also use the demo claims `A`, `B` and `C`.
- `images/` holds the test photos. Most are edits or crops of two source photos, so they test robustness more than coverage.

## Columns

| Column | Meaning |
|---|---|
| `expected_route` | The route an expert would pick: `photo_estimate`, `more_evidence` or `adjuster` |
| `acceptable_routes` | Routes we'd accept for a genuinely borderline case |
| `must_escalate` | `yes` if missing this would be a costly mistake. Used for escalation recall |
| `expected_flags` | Rule IDs that should fire, such as `R3` |
| `expected_make`, `expected_model`, `expected_colour` | `CANT_TELL` means the right answer is not to guess |
| `expected_cost_band` | Rough band: `under_1000`, `1000_2500`, `2500_to_total_loss`, `total_loss`, `unsure` or `n/a`. Author labels, not an estimator's |
| `label_status` | Every label here is a draft by the author and needs review by an estimating expert |

## How to label a case

Two people label each case on their own, then compare and settle disagreements. Keep a note of how often they disagreed at first: that's the realistic ceiling for how often the system can agree with an expert.

1. **Route.** Would you let this go down the photo estimate path, ask the customer for more photos, or hand it to an adjuster? If two answers are both reasonable, put both in `acceptable_routes`.
2. **Must escalate.** Would it be a costly mistake if this went down the fast path? Think structural damage, injury, total loss or possible fraud.
3. **Vehicle.** Only fill in what you could defend from the photo. If you'd be guessing, write `CANT_TELL`.
4. **Cost band.** A rough band is enough. Write `unsure` rather than guessing.
5. **Flags.** Any review flags that should fire (see the routing protocol in the app).

## Still to add

About 15 photos with different cars and damage levels. Sourcing notes: record the licence and link for every image, and mark generated images as synthetic.

| Case | Vehicle | Damage | Expected route |
|---|---|---|---|
| Rear bumper scuff | Compact hatchback, red | Paint only | Photo estimate |
| Rear-quarter dent | Mid-size SUV, white | Single panel | Photo estimate |
| Tailgate dent | Pickup, black | Single panel | Photo estimate |
| Sliding-door scrape | Minivan, silver | Single panel | Photo estimate |
| Minor-looking bumper damage | EV or luxury sedan | Sensor area, expensive parts | Adjuster |
| Front-corner damage | Economy sedan, around 2008, low value | Moderate | Adjuster / total loss |
| Door and fender | Mid-size sedan | Two panels, near the limit | Either |
| Frontal crush, airbags out | Sedan | Severe | Adjuster |
| Rollover | SUV | Roof crush | Adjuster |
| Side impact | Any | Pillar pushed in | Adjuster |
| Flood or fire | Any | Waterline or burn | Adjuster |
| Windscreen crack | Sedan | At the camera | Photo estimate with review flag |
| Motorcycle | Motorcycle | Fairing and levers | Adjuster |
| Commercial van | Van | Rear door dent | Adjuster |
| Undamaged car | Any | None | Request more evidence |

The biggest gap: we can't measure whether the cost range contains the final paid cost without the carrier's paid-claims data.
