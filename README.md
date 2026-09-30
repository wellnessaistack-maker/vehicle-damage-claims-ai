# Vehicle damage claims AI

A prototype first-review tool for an auto insurer's claims team. A reviewer drops in photos of a damaged vehicle and gets the vehicle's make, model and colour, a short damage summary and a rough repair-cost range. The tool then recommends where the claim goes next: the **photo estimate path**, a **request for more evidence**, or an **adjuster / total loss** review, and shows the reasons in plain language.

**The AI reads the photo, written rules decide the route, and a person sees why.**

- Live prototype: https://vehicle-damage-claims-ai.vercel.app
- Evaluation: the **Evaluation** page in the app, and [`eval/README.md`](eval/README.md)

## What you asked for

| You asked for | Where to find it |
|---|---|
| Accept a photo by upload or URL | **+ Add claims**: a single photo, a folder per claim, or pasted links |
| Make, model and colour | Top of the assessment card, with how each was identified, or "not determinable" rather than a guess |
| Damage summary | Assessment card, one line, e.g. "Left rear door dent with scraping" |
| A rough AI-generated repair estimate | Assessment card: a range with its main drivers, never a single payable number |
| How to run it | [Setup](#setup) |
| Architecture and data flow | [Architecture](#architecture-and-data-flow), and the **Architecture** panel in the app |
| Why these tools | [Why these tools](#why-these-tools) |
| How we know it works | [Evaluation](#evaluation), the **Evaluation** page and [`eval/README.md`](eval/README.md), plus [when fewer claims need a person](#when-fewer-claims-need-a-person) |
| What we'd do next | [Next steps](#what-wed-do-next-with-more-time) |

## The product idea

Before AI prices a claim, it should decide where the claim goes. Most of the value is in that first routing decision: simple claims move faster, customers are asked for the right photos once, and complex claims reach a person before anyone writes an estimate. So the prototype returns the three things you asked for (make, model and colour, a damage summary, and a rough repair estimate), then recommends one of three routes:

| Route | What happens |
|---|---|
| Photo estimate path | The reviewer approves the route and the estimate range, and the claim goes to the estimating team as a starting point |
| Request more evidence | The reviewer sends a ready-made message telling the customer exactly which photos to retake and why. The claim waits, then comes back when they reply |
| Adjuster / total loss | The claim goes to the field adjuster queue, or the total loss unit when repair may cost more than the car is worth, plus the fraud team (SIU) when a photo matches a past claim. Complex claims are flagged at intake, with the reason |

If the AI fails, the claim shows **Not assessed: manual triage**, which is today's normal process. It never guesses.

Every claim ends with a named owner. The reviewer can approve, adjust the range, change the route, or hand the claim to a person or team with a note, and can ask a colleague for a second opinion without letting go of it. An adjusted range goes back through the same rules, so raising a $2,100 estimate to $2,800 moves the claim to an adjuster rather than quietly approving it on the fast path. A claim leaves the inbox only once a final action is taken; finished claims sit under **Completed** and photo requests under **Waiting**.

Every reason on screen says what it checked: the policy record, the claim form, what the AI saw in the photo, the code's photo checks, and the protocol rule and setting that applied. A **Policy and claim checks** table compares what's on file with what the photos show, even when nothing fires. It also says plainly that coverage and deductibles are not checked by this tool.

## Setup

The prototype is live at https://vehicle-damage-claims-ai.vercel.app, so there's nothing to install to try it. Click **Load demo queue**, or drag in the `demo-images/` folder (each subfolder is one claim).

To run it locally (Node 22 or later):

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
npm test                       # routing rules and URL safety; no API key needed
npm run eval                   # re-run the labelled set; needs a key and costs money
```

To deploy your own copy, import the repo into Vercel and add `ANTHROPIC_API_KEY` as an environment variable, plus `ANTHROPIC_WORKSPACE_ID` if the key isn't tied to a workspace. The optional settings are listed in `.env.example`.

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
Reviewer sees the vehicle, damage summary and estimate, the route, the reasons, and acts:
approve, adjust the range, send the customer message, assign, change the route (with a reason), comment or ask
```

A few choices worth calling out:

- **The AI describes, the code decides.** The AI returns facts a reviewer could check by looking at the photo: is the badge visible, is this a close-up, does the damage run off the edge of the frame, are the airbags out. It never returns a route. The routing protocol in [`lib/policy/protocol.ts`](lib/policy/protocol.ts) decides, and every rule has a test.
- **The AI only sees the photos; the claim details go to the rules.** See [What the AI sees, and why](#what-the-ai-sees-and-why).
- **Evidence sufficiency doesn't rely on the AI's confidence.** Self-reported confidence is poorly calibrated and can't be audited. Instead three kinds of checks feed the rules: pixel checks in code, observations the AI reports as plain facts, and cross-checks between them (for example, if no badge is visible, the make is blanked even if the AI named one).
- **The most cautious route wins.** Adjuster, then more evidence, then the photo estimate path. If a claim is already clearly serious, we don't ask the customer for more photos.
- **Route and review flag are separate.** Some rules keep the route but flag the claim for a person, such as damage in a sensor area, a range that straddles the fast-path limit, or a car that doesn't match the policy.
- **One source of truth for the rules.** The protocol panel in the app is generated from the same file the engine runs, so the document an estimating expert signs off can't drift from the code.

### What the AI sees, and why

The deck's flow is "photo plus claim context in, route out", and that's still true for the system as a whole. The choice is *which part* gets the claim context:

| Input | Goes to | Why |
|---|---|---|
| Photos | The AI | Reading photos is the one thing that needs AI |
| Policy vehicle (year, make, model, colour, powertrain) | The rules | The AI identifies the car blind, then the rules compare its answer with the policy. If the AI were told "the policy says Honda Civic", it would lean towards saying Civic, and the mismatch check, the "don't guess the car" behaviour on close-ups and a basic fraud signal would all quietly stop working |
| Customer's description of the loss | The rules (as the structured impact area) | Same reason: an independent check that the damage is where the customer said. It also keeps customer-written text away from the model, which removes a way to slip instructions into the AI |
| Vehicle value, injury, drivable, photo requests so far | The rules | These are facts, not things to interpret. Code handles them exactly and the same way every time |

The trade-off: the AI prices the car it *sees*, not the exact trim on the policy. That barely matters in the prototype, because when the car can't be identified the estimate is withheld anyway. In production the better answer is deterministic too: decode the VIN to get the exact year, trim and driver-assistance equipment, and feed that into pricing and into rules such as "this car has front radar, so recalibration applies". A second, optional AI check could compare the customer's free-text description with the photos, kept separate from the identification step so it can't bias it.

### Why one structured AI call, not tool calls or an agent

The AI makes exactly one call per claim and returns a fixed-format answer (Claude's structured outputs, checked again in code). It doesn't use tool calls and it isn't an agent. That's deliberate:

- **The steps are known in advance.** Check photos, read photos, apply rules. Nothing needs the model to decide what to do next, so letting it would add latency, cost and unpredictability for no gain.
- **The model extracts; the code decides.** With tools, the model would choose when to look things up or act. Here every lookup and every decision is ordinary code, so it's auditable and testable, and the same input takes the same path every time.
- **One call is easy to measure and to fail safely.** One latency number, one cost number, one retry, then manual triage.

Where tools would come in for production: looking up the VIN, the policy, labour rates or a vendor's price. Those would still be called by our code in a fixed order, not chosen by the model. The one place a model-driven loop might earn its keep is the reviewer's "Ask" box, for example letting the assistant pull up the policy wording, and even there it could only explain, never change the route.

### The routing protocol

Two tiers:

- **Locked guardrails:** injury reported, car can't be driven, airbags deployed, structural damage, fire or flood, electric or hybrid with damage near the battery, not a road car, motorcycle or commercial vehicle, a photo matching a past claim, photos of different cars, a photo of a screen, no vehicle, car can't be identified, damage not fully in frame, poor photo quality, no visible damage, more than one car in frame.
- **Configurable settings** a protocol owner can change within safe bounds: fast-path limit ($2,500), total-loss line (60% of vehicle value), whether sensor-area damage flags or escalates, how strict the photo checks are, how many times to ask for photos before escalating, and the illustrative cost adjustments.

In the app, switching the role to **Protocol owner (mock)** lets you change settings. The worklist re-routes instantly, because only the rules re-run, not the AI. **Test against labelled cases** replays the saved AI extractions from the last evaluation under the draft settings, and shows which cases change route and what happens to escalation recall.

### The repair-cost range

The AI prices each damage item it sees, from its general knowledge of typical US repair costs. That is the "rough AI-generated estimate" you asked for, and it is labelled that way. Code then adds the items up and applies a few visible adjustments: an allowance for damage hidden behind panels, a sensor recalibration line, and a wider range when the photos only show part of the damage. Every adjustment amount is an **illustrative placeholder**, not sourced data.

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

The fixed output format is the contract and the labelled set is the referee, so the model can be swapped without touching the rules or the screen. The default is Claude Opus 5.5 at low effort; the Evaluation page compares it with Claude Sonnet 5.5 on the same cases (see [Latest results](#evaluation)).

Around the model:

- **Vercel** hosts it. A push to GitHub gives a public link the panel can open with nothing to install, the API runs as serverless functions next to the page, and the API key sits in Vercel's encrypted settings, never in the browser. The price is Vercel's limits on request size and run time, covered in the next section. For a carrier, the same code would run in their own cloud instead.
- **Next.js, React and TypeScript** keep the screen and the API in one codebase, so the routing rules the server runs are the same code the protocol screen shows and re-runs.
- **Anthropic's TypeScript SDK** makes the one AI call per claim, using structured outputs so the answer comes back in the required format.
- **sharp** does the image work: fixing rotation, resizing and the pixel checks for brightness, sharpness and reused photos.
- **zod** checks everything coming in from the browser, and checks the AI's answer against the same schema the API is asked to follow.
- **Node's built-in test runner** runs the rule, URL-safety and scoring tests, with no extra test framework.
- **GitHub** holds the code; changes go in through pull requests.

That's the whole list. There's no database, queue or image store, on purpose.

## Key assumptions and trade-offs

**It remembers nothing.** There's no database and no image storage. The worklist lives in your browser tab and disappears on refresh, and photos only exist in memory while a claim is being assessed. That's deliberate: it's the simplest honest answer to "where do our customers' photos go?" The cost is that there's no history and no audit trail beyond the decision record you can download.

**Each claim is one request that waits for its answer.** That's easy to follow and easy to measure (about ten seconds a claim), but it doesn't absorb bursts. After a hailstorm a carrier can get thousands of claims in an hour, so production would put a queue in front of the AI call.

**The claim details and dollar limits are made up.** Policyholders, vehicle values and claim IDs are mock data. The $2,500 fast-path limit, the 60% total-loss line and the cost adjustments are placeholders. The point is to show where those numbers plug in, not to suggest what they should be. Claims you upload start with blank details; fill them in and the rules re-run instantly.

**The photo checks are rough.** They were tuned on a handful of images. The sharpness check can't tell a blurry photo from a sharp close-up of a smooth door, so it only catches very soft photos and relies on the AI to spot blur. Glare is caught only by the AI. The reused-photo check compares against a single demo "past claim"; it catches a mirrored copy but not a rotated one.

**Some inputs are turned away rather than half-handled.** It accepts JPEG, PNG and WebP, up to eight photos a claim. iPhone HEIC files and videos get a clear message saying what to send instead. Supporting both is on the next-steps list.

**Vercel's limits shaped a few choices.** Vercel rejects requests over 4.5 MB, and phone photos are often bigger than that, so the browser shrinks each photo before sending it, which also strips location data. Each request can run for 60 seconds; the AI call gives up after 45, and when it does the claim goes to manual triage instead of hanging.

**Pasted links are treated as untrusted.** A link could point at something inside our own network rather than at a photo. So the server only follows https links, refuses private and cloud-metadata addresses (checked again on every redirect), accepts only real image files, and stops at 10 MB or 8 seconds.

**The public link costs money to use.** Anyone with it can run assessments on the API key, so the key has a monthly spend limit. The bulk evaluation runner needs a secret token and is off without one.

## Evaluation

**How we'd know it's working.** The costly mistake is a complex claim slipping onto the fast path, so the first measure is escalation recall: of the claims an expert would send to an adjuster, how many we escalated too. Next is routing agreement with expert labels, watched alongside how often we escalate for no reason, because too much caution eats the time savings. Then the three outputs: is make, model and colour right or correctly left blank, and does the damage summary name the right area without missing or inventing damage. We also track whether the route stays the same on a re-run, time and cost per case, and failures. The Evaluation page reports all of this as plain counts, with no pass or fail targets; those get agreed with the carrier's claims and risk owners.

**Where it fails, and what matters most.** A complex claim on the fast path (rare, expensive). Confidently naming the wrong car, which leads to wrong pricing and can hide fraud. Missing or inventing damage. Escalating so much that the business case disappears. Reused or edited photos: we catch simple reuse, not edits or generated images. A single photo rarely shows hidden damage, which is why the rules lean cautious.

**The repair estimate.** The real test is scoring past claims and comparing our range with the final paid cost: how often it contains the paid cost, and how wide it is, since a wide enough range always looks accurate. We can't measure that without the carrier's paid-claims data, and the app says so on every estimate. The mistake that matters most is a range on the wrong side of the fast-path limit or the total-loss line. When the estimate is too low, the shop files a supplement, as it does today; when it's near a limit, the claim gets flagged or goes to an adjuster; it is never the amount paid.

**What we need from the customer.** A few hundred past claims with photos, the route each took, the final paid cost and any supplements; time from two estimating experts to label them; today's baseline for late escalations, supplements and reviewer minutes; and their eligibility rules, labour rates and vehicle values. (More detail in [Customer data and expertise needed](#customer-data-and-expertise-needed).)

**Latest results** (26 cases, draft labels, September 2026). The first run on prompt v1 surfaced four problems: a customer's wider retake was judged on the close-up, a sideways photo wasn't recognised, a crumpled bumper was called structural, and a door dent got a hidden-damage allowance that pushed it over the limit. Prompt v2 and a narrower allowance fixed three of the four; the sideways photo is still missed.

| | Opus 5.5, prompt v1 | Opus 5.5, prompt v2 | Sonnet 5.5, prompt v2 |
|---|---|---|---|
| Complex-case escalation recall | 11 of 11 | 11 of 11 | 11 of 11 |
| Routing agreement, exact (acceptable) | 22 (23) of 26 | 23 (25) of 26 | 24 (25) of 26 |
| Escalated when not needed | 1 of 15 | 0 of 15 | 0 of 15 |
| Didn't guess when it couldn't tell | 17 of 17 | 17 of 17 | 16 of 17 |
| Median time per case | 9.6 s | 9.7 s | 7.0 s |
| Estimated cost per case | $0.038 | $0.039 | $0.019 |
| Same route on every run (4 runs each) | not measured | 25 of 26 | not measured |
| Repair-range coverage | not measurable without paid-claims data | | |

The one unstable case is the Camry front corner: its range sits right at the $2,500 limit, so it went to an adjuster once and the photo estimate path three times. That's the expected weak spot, and the reason ranges that straddle the limit are flagged for a price check.

Read these numbers with care. With only 11 must-escalate cases, 11 of 11 is still consistent with a true recall as low as about 74%. Prompt v2 was written after looking at v1's mistakes on these same cases, so its gain is flattering; with the customer's data we'd keep a locked test set that nobody tunes against. And the set is escalation-heavy (11 of 26), unlike a real claims mix, so real results would be reported by segment and weighted to the actual mix.

On this set the two models route equally well, and Sonnet is faster and half the price. The prototype keeps Opus as the default because it was more careful about not guessing and kept the demo's clean claim under the fast-path limit, but 26 cases can't separate them with any confidence. The cost figures are estimates from token counts and list prices. Actual billed spend during this work came out noticeably higher than the estimates, so treat them as a floor and size the real figure from the provider's billing, not from these numbers. Either way the choice between models should come from the customer's own labelled claims.

**After the historical test.** Following the deck's phases, the system would first run silently alongside adjusters on live claims, with its routes compared to theirs before it routes anything. In production we'd watch how often reviewers override the route, supplements on fast-path claims compared with staff-inspected ones, and drift in the photos coming in.

**Showing it in the demo.** The **Evaluation** page shows the saved run and the model comparison, and **Run the labelled set now** re-runs a quick set of six cases (one per route) live through the same route the worklist uses, or all 26 if ticked, with the measures updating as results arrive. In the routing protocol panel, **Test against labelled cases** shows what a rule change would do to escalation recall before it's published.

The labelled set is 26 cases, 11 of which must escalate: the demo claims, edits of two source photos (dark, blurred, compressed, glare, rotated, mirrored, cropped, black and white), four real road-car escalations (frontal crush, flood, a van crushed by a wall, a car into a tree), and "same photo, different claim details" cases such as an injury or a wrong description. How to label it and what to add next are in [`eval/README.md`](eval/README.md). The biggest gap is that only a couple of cases should take the photo estimate path, so we can't yet say much about escalating too often.

## When fewer claims need a person

Today every claim gets a person's approval. That's the right place to start, not the end state. Less human review should be earned one narrow slice at a time, only for actions that can't hurt the customer, with the evidence gathered first and the checks kept running afterwards.

**What could be automated, and what never should be.** Only the two low-harm actions are candidates: asking the customer for more photos, and sending a small photo estimate to estimating. Anything adverse or high-stakes stays with a person: total loss, injury, fraud referrals, denials or reduced payments, and anything the tool couldn't assess. The protocol is already built this way. The safety rules are locked, and a claim that trips one can't reach the fast path. Regulation points the same way. The NAIC's model bulletin on insurers' use of AI (December 2023, adopted by roughly half of US states) expects controls that match the potential harm to consumers and how much people are involved. Colorado's rules under SB21-169 now cover private passenger auto. And states are starting to target AI making adverse claim decisions on its own: a 2026 Florida bill to stop AI being the sole basis for denying or reducing a claim passed the House but not the Senate.

**The stages.**

| Stage | The AI | People | To move on |
|---|---|---|---|
| 1. Shadow | Recommends routes on live claims; nobody acts on them | Work claims as today | Its routes compared with adjusters' decisions over a few months |
| 2. Assisted (this prototype) | Pre-fills the case and recommends a route | Approve every claim | The evidence below, on the carrier's own claims |
| 3. Automatic for one narrow slice | Sends photo requests on its own first; later, approves small photo estimates in one segment | Review a random sample, plus everything flagged | Sampled reviews keep agreeing; supplements and complaints don't rise |
| 4. Wider | One more segment at a time | Sample and monitor | Each segment passes the same checks on its own |

A first photo-estimate slice would be deliberately narrow: well under the fast-path limit, one common vehicle type, no review flags, policy verified, no recent claims on the car.

**How we'd know a slice is ready.** No regulator sets these numbers, so the claims and risk owners agree them up front, as the deck says. What they'd look at:

- **Escalation recall, judged by its plausible low.** Zero misses in a set of must-escalate claims only shows the true miss rate is below about 3 divided by the set size. Showing under 1% takes around 300 must-escalate claims with no misses; under 0.1% takes around 3,000. That's why 11 of 11 on our test set proves little on its own.
- **Routing agreement** at least as good as two experts manage with each other on the same claims.
- **Stability over time:** the same answer on repeat runs, and results that hold across several months in a row, not one test set.
- **Range coverage:** the final paid cost lands inside the range at an agreed rate, and supplements on automated claims are no higher than on staff-handled ones.
- **Reviewer overrides** in stage 2 that are rare and falling for that segment. The prototype already records them: an adjusted range or changed route downloads as a labelled test case.

**Checks that stay on after automation.**

- A random sample of automated claims still goes to a person (teams often start around 5 to 10% and lower it as evidence builds), plus every claim in a new segment's first weeks.
- One switch sends everything back to human review, and every prompt, model and rule version is recorded, so a bad change can be rolled back.
- When in doubt, a person: poor photos, a route that changes on a re-run, or anything unusual never goes down the automatic path.
- Watch for people aiming at the fast path once they know it exists: claims bunching just under the limit, reused or AI-edited photos (insurers are reporting more of these), photos with missing metadata.
- Watch for drift: the photos coming in, override rates and supplements, checked on a schedule against thresholds set in advance.

For a sense of scale, the published figures come from vendors and industry reports and would need checking against the carrier's own data. Tractable reported that 90% of Admiral Seguros' photo estimates in 2021 were produced without a human appraiser. CCC's 2026 Crash Course puts photo-based estimates at about a quarter of repairable US claims in 2025.

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
| Mock list of people and teams to hand off to | The carrier's own queues and directory, with hand-offs written back to the claim file |
| Every claim approved by a person | Staged automation for narrow, low-harm slices, as described [above](#when-fewer-claims-need-a-person) |
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

## Repository layout

```
app/                  Next.js pages and API routes (assess, ask, health, eval-cases, eval-run)
components/           Worklist, photo viewer, assessment panel, drawers, intake
demo-images/          Demo claims, one folder per claim (A, B, C, D, E)
eval/                 Labelled cases, claim details, test images, saved results
lib/extraction/       The AI call, prompt, output format and model prices
lib/policy/           Routing protocol, cost range and rule engine, with tests
lib/image/            Photo quality checks and reused-photo fingerprint
lib/net/              Safe URL fetching, with tests
lib/eval/             Evaluation runner and scoring
lib/client/           Browser-side intake and worklist helpers
scripts/              Evaluation command and public-folder copy
```
