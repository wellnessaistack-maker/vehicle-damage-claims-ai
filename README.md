# Vehicle damage claims AI

A prototype first-review tool for an auto insurer's claims team. A reviewer drops in photos of a damaged vehicle and gets the vehicle's make, model and colour, a short damage summary and a rough repair-cost range. The tool then recommends where the claim goes next: the **photo estimate path**, a **request for more evidence**, or an **adjuster / total loss** review, and shows the reasons in plain language.

**The AI reads the photo, written rules decide the route, and a person sees why.**

- Live prototype: see the link shared with this repo (Vercel)
- Evaluation: the **Evaluation** page in the app, and [`eval/README.md`](eval/README.md)

## What the brief asks for, and where it is

| Requirement | Where |
|---|---|
| Accept a photo by upload or URL | **+ Add claims**: a single photo, a folder per claim, or pasted links |
| Vehicle metadata: make, model, colour | Top of the assessment card, with how each was identified, or "not determinable" rather than a guess |
| Damage summary | Assessment card, one line, e.g. "Left rear door dent with scraping" |
| Rough AI-generated repair estimate | Assessment card: a range with its main drivers, never a single payable number |
| Setup instructions | [Setup](#setup) |
| Architecture and data flow | [Architecture](#architecture-and-data-flow), and the **Architecture** panel in the app |
| Why these tools | [Why these tools](#why-these-tools) |
| Evaluation approach | [Evaluation](#evaluation), the **Evaluation** page and [`eval/README.md`](eval/README.md) |
| What we'd do next | [Next steps](#what-wed-do-next-with-more-time) |

## The product idea

Before AI prices a claim, it should decide where the claim goes. Most of the value is in that first routing decision: simple claims move faster, customers are asked for the right photos once, and complex claims reach a person before anyone writes an estimate. So the prototype returns the brief's three outputs, then recommends one of three routes:

| Route | What happens |
|---|---|
| Photo estimate path | The reviewer approves the route and the estimate range as a starting point for the estimating system |
| Request more evidence | The reviewer sends a ready-made message telling the customer exactly which photos to retake and why |
| Adjuster / total loss | An adjuster takes it. Complex claims are flagged at intake, with the reason |

If the AI fails, the claim shows **Not assessed: manual triage**, which is today's normal process. It never guesses.

## Setup

Requires Node 22 or later.

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Then click **Load demo queue**, or drag in the `demo-images/` folder (each subfolder is one claim).

```bash
npm test                       # routing rules and URL safety, no API key needed
npm run eval                   # run the labelled set (needs a key), saves eval/results/latest.json
npm run eval -- --model claude-sonnet-5-5
npm run eval -- --repeat 3     # also measures whether routes stay the same on re-runs
```

### Deploying to Vercel

Import the repo into Vercel and add `ANTHROPIC_API_KEY` as an environment variable. Optionally set `CLAUDE_MODEL` (`claude-opus-5-5` by default, or `claude-sonnet-5-5`). The key is only read on the server.

## Architecture and data flow

```
Reviewer screen (browser)
  │  photos shrunk to 1600 px in the browser (fits Vercel's 4.5 MB limit, strips location data)
  │  or https links, fetched by the server
  ▼
POST /api/assess  (one serverless function; nothing is stored)
  1. Prepare photos    fix rotation, resize, re-encode
  2. Photo checks      brightness, sharpness, size, black and white, match against past-claim photos
                       (plain code, no AI)
  3. AI extraction     one Claude call per claim, all its photos, fixed output format:
                       vehicle, damage items with rough costs, what the photos show, risk signs
  4. Routing protocol  written rules decide the route, using the AI's facts, the photo checks
                       and the claim details (which the AI never sees)
  ▼
Reviewer sees the brief's outputs, the route, the reasons, and acts:
approve, adjust the range, send the customer message, assign, change the route (with a reason), comment or ask
```

A few choices worth calling out:

- **The AI describes, the code decides.** The AI returns facts a reviewer could check by looking at the photo: is the badge visible, is this a close-up, does the damage run off the edge of the frame, are the airbags out. It never returns a route. The routing protocol in [`lib/policy/protocol.ts`](lib/policy/protocol.ts) decides, and every rule has a test.
- **The AI only sees the photos.** Policy details and the customer's description go to the rules, not the model. If the model were told "the policy says Honda Civic", it would tend to say Civic, which would quietly break the "don't guess the car" check and the mismatch checks.
- **Evidence sufficiency doesn't rely on the AI's confidence.** Self-reported confidence is poorly calibrated and can't be audited. Instead three kinds of checks feed the rules: pixel checks in code, observations the AI reports as plain facts, and cross-checks between them (for example, if no badge is visible, the make is blanked even if the AI named one).
- **The most cautious route wins.** Adjuster, then more evidence, then the photo estimate path. If a claim is already clearly serious, we don't ask the customer for more photos.
- **Route and review flag are separate.** Some rules keep the route but flag the claim for a person, such as damage in a sensor area, a range that straddles the fast-path limit, or a car that doesn't match the policy.
- **One source of truth for the rules.** The protocol panel in the app is generated from the same file the engine runs, so the document an estimating expert signs off can't drift from the code.

### The routing protocol

Two tiers:

- **Locked guardrails:** injury reported, car can't be driven, airbags deployed, structural damage, fire or flood, electric or hybrid with damage near the battery, not a road car, motorcycle or commercial vehicle, a photo matching a past claim, photos of different cars, a photo of a screen, no vehicle, car can't be identified, damage not fully in frame, poor photo quality, no visible damage, more than one car in frame.
- **Configurable settings** a protocol owner can change within safe bounds: fast-path limit ($2,500), total-loss line (60% of vehicle value), whether sensor-area damage flags or escalates, how strict the photo checks are, how many times to ask for photos before escalating, and the illustrative cost adjustments.

In the app, switching the role to **Protocol owner (mock)** lets you change settings. The worklist re-routes instantly, because only the rules re-run, not the AI. **Test against labelled cases** replays the saved AI extractions from the last evaluation under the draft settings, and shows which cases change route and what happens to escalation recall.

### The repair-cost range

The AI prices each damage item it sees, from its general knowledge of typical US repair costs. That is the brief's "rough AI-generated estimate", and it is labelled that way. Code then adds the items up and applies a few visible adjustments: an allowance for damage hidden behind panels, a sensor recalibration line, and a wider range when the photos only show part of the damage. Every adjustment amount is an **illustrative placeholder**, not sourced data.

The range is shown against the fast-path limit and the total-loss line, because its real job is deciding which side of a limit a claim falls on:

- low end above the limit: adjuster
- limit inside the range: photo estimate path, flagged for a price check
- high end past the total-loss line: adjuster / total loss

It is never a payable amount. On the photo estimate path the reviewer approves it as a starting estimate or adjusts it, and an adjustment is recorded as "AI was off by X".

## Why these tools

| Option | What it's good at | Why we didn't start there |
|---|---|---|
| **Claude (what we used)** | Reads photos well, returns answers in a fixed format, runs on AWS and Google Cloud | We still have to test it on your claims |
| GPT or Gemini | Similar capability | We haven't tested them. Switching is a settings change |
| Estimating vendors (Tractable, CCC, Mitchell) | Pricing, because they've seen millions of paid claims | They don't show their reasoning. In production, our routing could use their price instead of ours |
| A custom-trained vision model | Pinpointing damage, cheaply | Needs lots of labelled photos and an ML team, and doesn't give make, model or price on its own |
| Open-source models on your servers | Photos never leave your environment | Less accurate today, and more to run |

The fixed output format is the contract and the labelled set is the referee, so the model can be swapped without touching the rules or the screen. The default is Claude Opus 5.5 at low effort; the Evaluation page compares it with Claude Sonnet 5.5 on the same cases.

Around the model:

- **Next.js on Vercel:** one repo for the screen and the API, and a shareable link with nothing to install.
- **sharp:** resizing and the pixel checks.
- **zod:** checks every request and the AI's output against the same schema that is sent to the API as the required format.
- **No database, queue or image storage**, on purpose (see below).

## Key assumptions and tradeoffs

- **Stateless.** The worklist lives in the browser tab and clears on refresh. Photos only exist in memory during a request. That keeps the prototype honest about data handling, at the cost of no history.
- **One synchronous request per claim.** Simple and easy to follow, but a burst of claims would need a queue (see production).
- **Mock claim details.** Policyholders, vehicle values and claim IDs are made up. Uploaded claims start with blank details, which you can edit in the app.
- **Illustrative numbers.** The fast-path limit, the total-loss ratio and the cost adjustments are placeholders to be replaced with the carrier's own.
- **Photo checks are tuned on very few images.** The sharpness check can't tell motion blur from a smooth close-up, so it only catches very soft photos; the AI's observation catches the rest. Glare is caught only by the AI.
- **Reused-photo check** compares against one demo "past claim" photo and catches mirrored copies, not rotated ones.
- **Accepted formats:** JPEG, PNG and WebP, up to 8 photos per claim. iPhone HEIC and video get a clear message instead.
- **Vercel limits:** requests over 4.5 MB are rejected by the platform, so photos are shrunk in the browser. The function time limit is set to 60 seconds; the AI call gives up at 45 seconds and the claim goes to manual triage.
- **Links are fetched safely:** https only, no internal, private or cloud-metadata addresses (checked when connecting and on every redirect), JPEG, PNG or WebP only, 10 MB and 8 seconds at most.
- **The public link can spend API credits.** Anyone with it can run assessments, so the key should have a spend limit. The evaluation runner is switched off on the public production deployment.

## Evaluation

**How we'd know it's working.** The costly mistake is a complex claim slipping onto the fast path, so the first measure is escalation recall: of the claims an expert would send to an adjuster, how many we escalated too. Next is routing agreement with expert labels, watched alongside how often we escalate for no reason, because too much caution eats the time savings. Then the brief's outputs: is make, model and colour right or correctly left blank, and does the damage summary name the right area without missing or inventing damage. We also track whether the route stays the same on a re-run, time and cost per case, and failures. The Evaluation page reports all of this as plain counts, with no pass or fail targets; those get agreed with the carrier's claims and risk owners.

**Where it fails, and what matters most.** A complex claim on the fast path (rare, expensive). Confidently naming the wrong car, which leads to wrong pricing and can hide fraud. Missing or inventing damage. Escalating so much that the business case disappears. Reused or edited photos: we catch simple reuse, not edits or generated images. A single photo rarely shows hidden damage, which is why the rules lean cautious.

**The repair estimate.** The real test is scoring past claims and comparing our range with the final paid cost: how often it contains the paid cost, and how wide it is, since a wide enough range always looks accurate. We can't measure that without the carrier's paid-claims data, and the app says so on every estimate. The mistake that matters most is a range on the wrong side of the fast-path limit or the total-loss line. When the estimate is too low, the shop files a supplement, as it does today; when it's near a limit, the claim gets flagged or goes to an adjuster; it is never the amount paid.

The labelled set, how to label it and the cases still to add are in [`eval/README.md`](eval/README.md). It's about 22 cases today: a check that nothing broke, not proof it works.

## Important failure modes

| Failure | How likely | What the prototype does |
|---|---|---|
| Complex claim sent down the fast path | Low, high impact | Locked safety rules, cautious-route-wins, escalation recall measured |
| Wrong vehicle named confidently | Medium | Make and model blanked unless a badge or distinctive shape supports them; policy mismatch flagged |
| Damage missed or invented | Medium | "No damage visible" asks for photos; the reviewer approves every estimate |
| Estimate on the wrong side of a limit | Likely at the margins | Straddling ranges are flagged; reviewers adjust and the adjustment is recorded |
| AI error, timeout or bad output | Occasional | One retry, then manual triage with the reason |
| Reused or edited photo | Rising | Mirrored-copy check against past claims, referred to SIU; edits not detected |
| Instructions written into a photo | Rare | The AI never picks the route and the safety rules are fixed, so the worst case is a wrong fact the reviewer can see |
| Same photo, different answer on re-run | Likely at the margins | Measured with `--repeat 3` |

## Customer data and expertise needed

- **A few hundred past claims** with photos, the route each actually took, the final paid cost and any supplements.
- **Two estimating experts' time** to label those claims independently: the right route, whether it must escalate, what photos were missing. How often they disagree sets the realistic ceiling.
- **Today's baseline:** how often claims escalate late, supplement rates, reviewer minutes per claim, repeat customer contacts.
- **Their rules and numbers:** photo-estimate eligibility, fast-path limits, state total-loss thresholds, labour rates, and vehicle values (for example from a valuation service).
- **Security and compliance** input on where photos may be processed, retention, and model data terms.

## What changes for production

| Prototype | Production |
|---|---|
| No database; worklist in the browser | Integration with the claims system (for example Guidewire) |
| No image storage | Photos in the carrier's storage, with retention rules and location data stripped |
| One synchronous request per claim | Queue and workers, retries and rate limiting, so a hailstorm doesn't time out |
| Decision record downloadable | Every decision record kept as an audit log |
| Versions shown on each result | Version registry; every prompt, model or rule change scored against the labelled set before release |
| Mock role for protocol changes | Single sign-on, role-based access, two-person approval for protocol changes |
| One demo past-claim photo | Near-duplicate index across all photos, plus a specialist tool for edited or generated images |
| AI's general price knowledge | Estimating-platform labour times and the carrier's paid-claims history |
| Latency and cost per case on screen | Monitoring and alerts on latency, cost, failure rate and reviewer override rate |
| Single photo or folder | Guided capture of the required views, and possibly walk-around video with the sharpest frames picked automatically |

## What we'd do next with more time

1. Add the ~15 photos listed in [`eval/README.md`](eval/README.md): more body types, damage levels and real road-car escalations.
2. Have an estimating expert review and correct the draft labels, and add a second labeller to measure agreement.
3. Replace the illustrative cost adjustments with real labour-time data and test range coverage against paid claims.
4. Accept video and pick the sharpest frames; accept HEIC.
5. A rotation-proof reused-photo check, and an edited-image check from a specialist vendor.
6. Tighten the prompt using the cases where the AI and the labels disagree, and re-run the model comparison.
7. Route stability: run each case several times and add rules that are robust to small changes in the AI's answer.

## Demo walkthrough (20 minutes)

1. **Load demo queue.** Four claims sort themselves into lanes. The worklist is the thing to clear by end of day.
2. **A (Civic, clear side view).** The brief's outputs first, then the range against the limits, then Photo estimate path. Approve; it moves to the next claim.
3. **B (close-up of the same door).** Doesn't guess the car. The customer message lists the retake and why. Send it, then use **Demo: attach the customer's retake**; it moves to the photo estimate path.
4. **C (race car).** Adjuster / total loss, estimate withheld, reasons listed. Ask in the case thread: "What makes this structural?"
5. **E (a flipped copy of a past claim's photo).** Matched to a past claim and referred to SIU.
6. **Decision record and routing protocol.** Model, prompt and protocol versions, every rule fired or not, raw AI output. Switch to Protocol owner, change the fast-path limit, and test against the labelled cases.
7. **Architecture panel.** Prototype vs. production, platform limits, and simulate an AI failure to show manual triage. Paste `https://169.254.169.254/` as a link to show it's blocked.
8. **Evaluation page.** The three measures from the deck, the model comparison, and what needs the carrier's data.

## Repository layout

```
app/                  Next.js pages and API routes (assess, ask, health, eval-run)
components/           Worklist, photo viewer, assessment panel, drawers, intake
demo-images/          Demo claims, one folder per claim (A, B, C, E)
eval/                 Labelled cases, claim details, test images, saved results
lib/extraction/       The AI call, prompt, output format and model prices
lib/policy/           Routing protocol, cost range and rule engine, with tests
lib/image/            Photo quality checks and reused-photo fingerprint
lib/net/              Safe URL fetching, with tests
lib/eval/             Evaluation runner and scoring
lib/client/           Browser-side intake and worklist helpers
scripts/              Evaluation command and public-folder copy
```
