# Vehicle damage claims AI

A customer takes a photo of their damaged car. AI reads it in seconds and returns what you asked for: the make, model and colour, a short damage summary and a rough repair-cost range. The tool then uses those answers to support your reviewer's next decision: **approve the photo estimate** as a starting point, **ask the customer for the right photos**, or **send the claim to an adjuster**, with the reasons in plain language.

**The AI reads the photo, written rules check it, and a person approves or routes the claim.**

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
| Architecture and data flow | [Architecture](#architecture-and-data-flow): the prototype today, and in production |
| Why these tools | [Why these tools](#why-these-tools), and [speed, cost and model behaviour](#speed-cost-and-model-behaviour) |
| How we know it works | [Evaluation](#evaluation), the **Evaluation** page, and [when fewer claims need a person](#when-fewer-claims-need-a-person) |
| What we'd do next | [Next steps](#what-wed-do-next) |

## The product idea

You asked whether AI can read a customer's photo and help your team handle the claim. It can, and the most useful place to put those answers is the first decision a reviewer makes: can this claim be approved on the photo estimate path, or does it need something else first? Getting that decision right is where most of the value is: simple claims move faster, customers are asked for the right photos once, and complex claims reach a person before anyone writes an estimate.

"Approve" here always means approving the route and the estimate range as a starting point for the estimating team. The tool never approves a payment.

| Route | What happens |
|---|---|
| Photo estimate path | The reviewer approves the route and estimate range, and the claim goes to the estimating team as a starting point |
| Request more evidence | The reviewer sends a ready-made message saying exactly which photos to retake and why. The claim waits, then comes back when the customer replies |
| Adjuster / total loss | The claim goes to the field adjuster queue, or the total loss unit when repair may cost more than the car is worth, plus the fraud team (SIU) when a photo matches a past claim |

If the AI fails, the claim shows **Not assessed: manual triage**, which is today's normal process. It never guesses.

A few things the screen does that matter to a claims team:

- **Every reason cites what it checked:** the policy record, the claim form, what the AI saw, the code's photo checks, and the rule and setting that applied. A policy checks table compares what's on file with what the photos show, and says plainly that coverage and deductibles are not checked here.
- **Every claim ends with a named owner.** The reviewer approves, adjusts the range, changes the route, or hands the claim to a person or team with a note. They can ask a colleague for a second opinion without letting go of it.
- **Corrections go back through the rules.** Raising a $2,100 estimate to $2,800 moves the claim to an adjuster instead of quietly approving it on the fast path.
- **The inbox only holds work still to do.** Finished claims move to **Completed**, photo requests to **Waiting**.

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

To deploy your own copy, import the repo into Vercel and add `ANTHROPIC_API_KEY`, plus `ANTHROPIC_WORKSPACE_ID` if the key isn't tied to a workspace. Optional settings are in `.env.example`.

## Architecture and data flow

### The prototype today

```mermaid
flowchart LR
  rev(["Reviewer"])

  subgraph BR["Browser"]
    ui["Worklist and assessment<br/>state lives in the tab"]
  end

  subgraph VC["Vercel function · nothing stored"]
    direction LR
    prep["① Prepare photos<br/>rotate, resize"]
    checks["② Photo checks<br/>brightness, sharpness,<br/>reused photo"]
    rules["④ Routing protocol<br/>locked rules,<br/>configurable limits"]
  end

  ai["③ Claude<br/>one call per claim<br/>sees photos only"]

  rev --> ui
  ui -- "photos" --> prep --> checks --> ai --> rules
  checks -. "check results" .-> rules
  ui -. "claim and policy details" .-> rules
  rules == "route, reasons, estimate" ==> ui

  classDef person fill:#e0e7ff,stroke:#4f46e5,color:#1e1b4b,stroke-width:1.5px
  classDef screen fill:#f1f5f9,stroke:#475569,color:#0f172a,stroke-width:1.5px
  classDef code fill:#dcfce7,stroke:#16a34a,color:#052e16,stroke-width:1.5px
  classDef model fill:#ffedd5,stroke:#ea580c,color:#431407,stroke-width:1.5px
  class rev person
  class ui screen
  class prep,checks,rules code
  class ai model
  style BR fill:#f8fafc,stroke:#94a3b8,color:#334155
  style VC fill:#f8fafc,stroke:#94a3b8,color:#334155
```

Colour key: green is plain code, orange is the AI, purple is people.

1. **Prepare photos.** Fix rotation, resize and re-encode. Pasted links are fetched by a safe fetcher first.
2. **Photo checks.** Brightness, sharpness, size, black and white, and a match against past-claim photos. Plain code.
3. **AI extraction.** One Claude call per claim with all its photos, returning a fixed format: vehicle, damage items with rough costs, what the photos show, and risk signs.
4. **Routing protocol.** Written rules decide the route from the AI's facts, the photo checks and the claim details, which the AI never sees.

The design choices behind it:

- **The AI describes, the code decides.** The AI returns facts a reviewer could check by looking at the photo (is the badge visible, is this a close-up, are the airbags out). It never returns a route. The rules in [`lib/policy/protocol.ts`](lib/policy/protocol.ts) decide, and every rule has a test.
- **No reliance on the AI's confidence score.** Self-reported confidence is poorly calibrated and can't be audited. Instead the rules use pixel checks, plain-fact observations and cross-checks between them. For example, if no badge is visible, the make is blanked even if the AI named one.
- **The most cautious route wins.** Adjuster, then more evidence, then the photo estimate path. A claim that's already clearly serious isn't sent back for more photos.
- **Route and review flag are separate.** Some rules keep the route but flag the claim for a person: damage in a sensor area, a range straddling the limit, a car that doesn't match the policy.
- **One source of truth.** The protocol panel in the app is generated from the same file the engine runs, so what an estimating expert signs off can't drift from the code.

### In production

The same steps, inside the carrier's own cloud account and wired to their claims system. The shape is the same on AWS, Google Cloud or Azure, and Claude runs on AWS (Bedrock) and Google Cloud (Vertex AI), so photos don't have to leave the carrier's account.

```mermaid
flowchart TB
  cust(["Customer"])

  subgraph IN["1 · Intake"]
    direction LR
    app["Photo capture app<br/>guided views"] --> store[("Photo store<br/>encrypted, retention rules")] --> queue[["Queue<br/>absorbs storm surges"]]
  end

  subgraph AS["2 · Assessment, in the carrier's cloud account"]
    direction LR
    svc["Assessment service<br/>photo checks"] <--> ai["Claude<br/>via Bedrock or Vertex AI"]
    svc --> rules["Routing protocol<br/>versioned, owner-approved"]
    gate["Release gate<br/>changes scored on<br/>labelled claims"] -. "releases" .-> rules
  end

  subgraph RC["3 · Decision and review"]
    direction LR
    log[("Decision log<br/>every route and reason")] --> rev(["Reviewer<br/>decision written back<br/>to the claims system"])
    log -.-> mon["Monitoring<br/>overrides, cost, drift"]
  end

  cms[("Claims system<br/>policy and claim details")]

  cust --> IN
  IN -- "one message per claim" --> AS
  cms -- "policy facts" --> AS
  AS -- "route and reasons" --> RC


  classDef person fill:#e0e7ff,stroke:#4f46e5,color:#1e1b4b,stroke-width:1.5px
  classDef code fill:#dcfce7,stroke:#16a34a,color:#052e16,stroke-width:1.5px
  classDef model fill:#ffedd5,stroke:#ea580c,color:#431407,stroke-width:1.5px
  classDef data fill:#e0f2fe,stroke:#0284c7,color:#082f49,stroke-width:1.5px
  classDef ops fill:#f1f5f9,stroke:#475569,color:#0f172a,stroke-width:1.5px
  class cust,rev person
  class app,svc,rules code
  class ai model
  class store,queue,log,cms data
  class gate,mon ops
  style IN fill:#f8fafc,stroke:#94a3b8,color:#334155
  style AS fill:#f8fafc,stroke:#94a3b8,color:#334155
  style RC fill:#f8fafc,stroke:#94a3b8,color:#334155
```

Colour key: green is plain code, orange is the AI, blue is stored data, purple is people.

| Prototype | Production |
|---|---|
| No database; worklist lives in the browser | Integrated with the claims system (for example Guidewire), hand-offs written back to the claim file |
| No image storage | Photos in the carrier's storage, with retention rules and location data stripped |
| One request per claim, waiting for its answer | A queue and workers with retries and rate limits, so a hailstorm doesn't time out |
| Decision record you can download | Every decision kept in an audit log, with monitoring on latency, cost, failures and overrides |
| Versions shown on each result | Every prompt, model or rule change scored against the labelled set before release |
| Mock roles and a mock list of teams | Single sign-on, role-based access, two-person approval for protocol changes |
| Every claim approved by a person | Staged automation for narrow, low-harm cases (see [below](#when-fewer-claims-need-a-person)) |
| One demo past-claim photo | Near-duplicate search across all photos, plus a specialist check for edited or generated images |
| The AI's general price knowledge | Estimating-platform labour times and the carrier's paid-claims history |
| Single photo or folder upload | Guided capture of the required views, possibly walk-around video |

### What the AI sees, and why

The deck's flow is "photo plus claim context in, route out", and that holds for the system as a whole. The question is which part gets the claim context:

| Input | Goes to | Why |
|---|---|---|
| Photos | The AI | Reading photos is the one thing that needs AI |
| Policy vehicle (year, make, model, colour, powertrain) | The rules | The AI identifies the car blind, then the rules compare. Told "the policy says Honda Civic", it would lean towards Civic, and the mismatch check, the "don't guess" behaviour on close-ups and a basic fraud signal would quietly stop working |
| Customer's description of the loss | The rules, as the reported impact area | An independent check that the damage is where the customer said. It also keeps customer-written text away from the AI, closing a way to slip instructions in |
| Vehicle value, injury, drivable, photo requests so far | The rules | Facts, not things to interpret. Code handles them exactly, every time |

The trade-off is that the AI prices the car it *sees*, not the exact trim on the policy. In production the fix is deterministic too: decode the VIN for the exact year, trim and driver-assistance equipment, and feed that into pricing and rules.

### Why one structured AI call, not tool calls or an agent

The AI makes exactly one call per claim and returns a fixed-format answer (Claude's structured outputs, checked again in code). No tool calls, no agent loop, on purpose:

- **The steps are known in advance.** Check photos, read photos, apply rules. Letting the model decide what to do next would add latency, cost and unpredictability for no gain.
- **Every lookup and decision stays in code,** so it's auditable, testable, and the same input takes the same path every time.
- **One call is easy to measure and to fail safely:** one latency, one cost, one retry, then manual triage.

In production, lookups like the VIN, policy, labour rates or a vendor's price would still be called by our code in a fixed order. The one place a model-driven loop might earn its keep is the reviewer's "Ask" box, and even there it could only explain, never change the route.

### The routing protocol

- **Locked guardrails:** injury reported, car can't be driven, airbags deployed, structural damage, fire or flood, electric or hybrid with damage near the battery, not a road car, motorcycle or commercial vehicle, a photo matching a past claim, photos of different cars, a photo of a screen, no vehicle, car can't be identified, damage not fully in frame, poor photo quality, no visible damage, more than one car in frame.
- **Configurable settings,** within safe bounds: fast-path limit ($2,500), total-loss line (60% of vehicle value), whether sensor-area damage flags or escalates, how strict the photo checks are, how many photo requests before escalating, and the illustrative cost adjustments.

Switch the role to **Protocol owner (mock)** to change settings. The worklist re-routes instantly because only the rules re-run, not the AI. **Test against labelled cases** replays saved AI answers under the draft settings and shows which cases change route and what happens to escalation recall.

**Protocol and policy are different things.** The policy is the customer's contract: vehicle, coverage, deductible. The protocol is the carrier's claims-handling guideline: when a claim can take the fast path, when it's likely a total loss, which photos are enough. The rules read facts from the policy record but never interpret policy wording, and coverage stays in the claims system. A carrier would run a small set of protocols, picked by a plain lookup on the policy's state (total-loss thresholds are set by state law), product and vehicle type. AI could help draft a protocol from a written guideline, but a person approves it and it's scored against the labelled set before it goes live.

### The repair-cost range

The AI prices each damage item from its general knowledge of US repair costs; that's the "rough AI-generated estimate" you asked for. Code adds the items up and applies a few visible adjustments: an allowance for damage hidden behind panels, a sensor recalibration line, and a wider range when the photos show only part of the damage. Every adjustment amount is an **illustrative placeholder**.

The range's real job is showing which side of a limit a claim falls on: low end above the fast-path limit goes to an adjuster, a range straddling it stays on the fast path with a price-check flag, and a high end past the total-loss line goes to adjuster / total loss. It is never a payable amount; the reviewer approves it as a starting estimate or adjusts it, and the adjustment is recorded.

## Why these tools

| Option | Good at | Why we didn't start there |
|---|---|---|
| **Claude (what we used)** | Reads photos well, returns answers in a fixed format, runs on AWS and Google Cloud | Still has to be tested on your claims |
| GPT or Gemini | Similar capability | Untested here. Switching is a settings change |
| Estimating vendors (Tractable, CCC, Mitchell) | Pricing, from millions of paid claims | They don't show their reasoning. In production, our routing could use their price instead of ours |
| A custom-trained vision model | Pinpointing damage, cheaply | Needs lots of labelled photos and an ML team, and gives no make, model or price on its own |
| Open-source models on your servers | Photos never leave your environment | Less accurate today, and more to run |

The fixed output format is the contract and the labelled set is the referee, so the model can be swapped without touching the rules or the screen.

Around the model:

- **Vercel** hosts it: a public link with nothing to install, the API as serverless functions, and the API key in encrypted settings, never in the browser. For a carrier, the same code runs in their own cloud.
- **Next.js, React and TypeScript** keep the screen and API in one codebase, so the rules the server runs are the same code the protocol screen shows.
- **Anthropic's TypeScript SDK** makes the one AI call per claim, with structured outputs.
- **sharp** does the image work: rotation, resizing, and the brightness, sharpness and reused-photo checks.
- **zod** checks everything coming in from the browser, and checks the AI's answer against the same schema.
- **Node's built-in test runner** runs the rule, URL-safety and scoring tests.

## Speed, cost and model behaviour

Measured on the 26 labelled cases, end to end on the server (photo checks, AI call and rules):

| | Opus 5.5 (default) | Sonnet 5.5 |
|---|---|---|
| Typical time per claim | 9.7 s | 7.0 s |
| Slowest 1 in 10 | 13.0 s | 8.9 s |
| Slowest seen | 14.5 s | 10.7 s |
| Estimated cost per claim | $0.039 | $0.019 |
| Failed calls | 0 of 26 | 0 of 26 |

- **Almost all the time is the AI call.** Photo checks take a fraction of a second and the rules a few milliseconds; each claim's decision record shows the split. The levers are the model (Sonnet is about 30% faster), a shorter output format, and fewer photos per claim.
- **Ten seconds is short next to today's wait.** The alternative is a claim sitting in a queue for a person. The worklist assesses three claims at a time in the background, so a reviewer rarely waits.
- **Settings are chosen for a perception task.** Low effort, because the job is describing photos, not long reasoning. Photos are resized to 1,568 px on the long edge before the call, which keeps requests small. The call times out at 45 seconds, retries once, then goes to manual triage. If the requested model is overloaded, the API falls back to another, and the record says which model answered.
- **It's consistent, not perfectly repeatable.** The same photo gave the same route in 25 of 26 cases over four runs. The one that flipped sat right at the $2,500 limit, which is why straddling ranges are flagged.
- **Cost at scale is small next to people.** At about 4 cents a claim, 100,000 claims a year is roughly $4,000 of model spend at list prices. Billed spend during this work ran above these estimates, so treat them as a floor. The real costs are integration and expert labelling.
- **Throughput in production** comes from the queue and the provider's rate limits. Bulk jobs with no deadline, such as scoring a year of past claims, can use batch processing at a lower price.

## Evaluation

### Summary

**How would we know it's working?** Mistakes here don't cost the same, so we don't lead with accuracy. The expensive mistake is a complex claim slipping onto the fast path, so the first measure is **complex claims caught**: of the claims an expert would send to an adjuster, how many we escalated. Next is **routing agreement** with expert labels, watched alongside **needless escalations**, because too much caution erases the time savings. Then the three outputs: make, model and colour right or correctly left blank, and a damage summary that names the right area without missing or inventing damage. Behind those sit stability on re-runs, time, cost and failures. Targets are agreed with the carrier's claims and risk owners, not set by us.

**Where does it fail, and what matters most?** The costliest failure is a complex claim sent down the fast path; on our 26 test claims it caught 11 of 11, which with so few cases still means the true rate could be as low as 74%. Every mistake it made went the cautious way: asking for another photo or a person, never the fast path. Other failures: naming the wrong car confidently (it leaves make and model blank unless a badge or distinctive shape supports them), an estimate on the wrong side of a limit, sideways or poor photos, and reused or edited photos (reuse is caught, edits aren't yet). A single photo rarely shows hidden damage, which is why the rules lean cautious.

**What we'd need from the carrier.** A few hundred past claims with photos, the route each took, the final paid cost and any supplements. Two estimating experts labelling them independently; how often they agree is the ceiling to beat. Today's baseline for late escalations, supplements and reviewer minutes. And their own eligibility rules, limits, labour rates and vehicle values. Expert labelling at this scale is work Scale can supply.

**Is the repair estimate good enough, and what happens when it's wrong?** The test is scoring past claims and comparing our range with the final paid cost: how often the range contains it, and how wide the range is, since a wide enough range always looks accurate. That needs paid-claims data, and the app says so on every estimate. The mistake that matters is a range on the wrong side of the fast-path limit or the total-loss line. Near the limit, the claim is flagged for a price check; over it, it goes to an adjuster. If the estimate is too low, the shop files a supplement as it does today. It is never the amount paid.

### The detail

**Latest results** (26 cases, 11 must escalate, draft labels, September 2026). "Prompt" means the written instructions the AI works from; v1 was the first version and v2 is today's (explained below).

| | Opus 5.5, prompt v1 | Opus 5.5, prompt v2 | Sonnet 5.5, prompt v2 |
|---|---|---|---|
| Complex-case escalation recall | 11 of 11 | 11 of 11 | 11 of 11 |
| Routing agreement, exact (acceptable) | 22 (23) of 26 | 23 (25) of 26 | 24 (25) of 26 |
| Escalated when not needed | 1 of 15 | 0 of 15 | 0 of 15 |
| Didn't guess when it couldn't tell | 17 of 17 | 17 of 17 | 16 of 17 |
| Same route on every run (4 runs) | not measured | 25 of 26 | not measured |
| Repair-range coverage | needs paid-claims data | | |

**What changed from prompt v1 to v2.** After the first run we read every case the AI got wrong, changed four instructions in [`lib/extraction/prompt.ts`](lib/extraction/prompt.ts), and re-ran the same 26 cases. Both columns are scored with today's rules, so the difference between them comes from the prompt alone.

| Instruction added in v2 | What v1 got wrong | Result with v2 |
|---|---|---|
| Judge the evidence on the best photo in the set | The customer sent a wider photo after a close-up; v1 judged the claim on the close-up and asked for photos again | Fixed: goes to the photo estimate path |
| "Structural" means the frame, pillars, roof or floor are visibly bent; a crumpled bumper or fender isn't | v1 called a crushed bumper corner structural and sent it to an adjuster | Fixed: asks for a wider photo, as the expert would |
| A suspicion isn't evidence; report only risk signs you can see | Same case: v1 flagged "possible damage to underlying supports" | Fixed with the rule above |
| Photos may be sideways; read them as if upright | A clean photo uploaded sideways wasn't read properly | Partly: v2 now sees the whole car, but still can't name it on its side, so it asks for another photo. The real fix is to straighten photos in code first |

Net effect: needless escalations went from 1 to 0, and acceptable routes from 23 to 25 of 26. Exact matches only rose from 22 to 23, because one case priced right at the $2,500 limit (the Camry) landed on the other side of it on the v2 run; that instability is covered below. One more fix from that run was in code, not the prompt: the hidden-damage allowance no longer applies to side damage such as a door dent, which had pushed the demo's clean claim over the limit. It applies to both columns, so it doesn't show up as a difference between them.

- **Read the numbers with care.** 11 of 11 is still consistent with a true recall as low as about 74%. v2 was written after seeing v1's mistakes on these same cases, so its gain is flattering; with real data we'd keep a locked test set nobody tunes against. And the set is escalation-heavy, unlike a real claims mix.
- **Opus or Sonnet.** They route equally well here, and Sonnet is faster and half the price. Opus stays the default because it was more careful about not guessing, but 26 cases can't separate them. The choice should come from the carrier's own labelled claims.

The **Evaluation** page shows these results and can re-run a quick set of six cases live (or all 26). In the protocol panel, **Test against labelled cases** shows what a rule change would do before it's published. How the set was built and labelled, and what to add next, is in [`eval/README.md`](eval/README.md). Its biggest gap: few cases should take the photo estimate path, so needless escalation is hard to measure yet.

### Important failure modes

| Failure | How likely | What the prototype does |
|---|---|---|
| Complex claim sent down the fast path | Low, high impact | Locked safety rules, most cautious route wins, escalation recall measured |
| Wrong vehicle named confidently | Medium | Make and model blanked unless a badge or distinctive shape supports them; policy mismatch flagged |
| Damage missed or invented | Medium | "No damage visible" asks for photos; the reviewer approves every estimate |
| Estimate on the wrong side of a limit | Likely at the margins | Straddling ranges flagged; reviewer adjustments recorded and re-routed |
| AI error, timeout or bad output | Occasional | One retry, then manual triage with the reason |
| Reused or edited photo | Rising | Mirrored-copy check against past claims, referred to SIU; edits not yet detected |
| Instructions written into a photo | Rare | The AI never picks the route and the safety rules are fixed, so the worst case is a wrong fact the reviewer can see |
| Same photo, different answer on re-run | Likely at the margins | Measured with repeat runs; borderline ranges flagged |

## When fewer claims need a person

Today every claim gets a person's approval. That's the right place to start, not the end state. Less review should be earned one narrow slice at a time, only for actions that can't hurt the customer, with evidence gathered first and checks kept running after.

**What could be automated, and what never should be.** Only two low-harm actions are candidates: asking the customer for more photos, and sending a small photo estimate to estimating. Total loss, injury, fraud referrals, denials, reduced payments and anything the tool couldn't assess stay with a person. The protocol is already built this way: a claim that trips a locked rule can't reach the fast path. Regulation points the same way. The NAIC's model bulletin on insurers' use of AI (December 2023, adopted by roughly half of US states) expects controls that match the potential harm, Colorado's rules under SB21-169 now cover private passenger auto, and states are starting to target AI making adverse claim decisions on its own.

| Stage | The AI | People | To move on |
|---|---|---|---|
| 1. Shadow | Recommends routes on live claims; nobody acts on them | Work claims as today | Its routes compared with adjusters' decisions over a few months |
| 2. Assisted (this prototype) | Pre-fills the case and recommends a route | Approve every claim | The evidence below, on the carrier's own claims |
| 3. Automatic for one narrow slice | Sends photo requests on its own first; later, approves small photo estimates in one segment | Review a random sample, plus everything flagged | Sampled reviews keep agreeing; supplements and complaints don't rise |
| 4. Wider | One more segment at a time | Sample and monitor | Each segment passes the same checks on its own |

**How we'd know a slice is ready.** No regulator sets these numbers, so the claims and risk owners agree them up front:

- **Escalation recall, judged by its plausible low.** Zero misses only shows the true miss rate is below about 3 divided by the number of must-escalate claims. Showing under 1% takes around 300 such claims with no misses; under 0.1% takes around 3,000.
- **Routing agreement** at least as good as two experts manage with each other.
- **Stable over time:** the same answers on re-runs, holding across several months, not one test set.
- **Range coverage** at an agreed rate, and no more supplements on automated claims than on staff-handled ones.
- **Reviewer overrides** rare and falling. The prototype already records them: an adjusted range or changed route downloads as a labelled test case.

**Checks that stay on:** a random sample of automated claims still goes to a person (teams often start around 5 to 10%); one switch sends everything back to human review; every prompt, model and rule version is recorded so a bad change can be rolled back; anything unusual goes to a person, never the automatic path; and monitoring watches for claims bunching just under the limit, reused or AI-edited photos, and drift in overrides and supplements.

For scale, published figures come from vendors and would need checking against the carrier's own data: Tractable reported 90% of Admiral Seguros' photo estimates in 2021 were produced without a human appraiser, and CCC puts photo-based estimates at about a quarter of repairable US claims in 2025.

## Key assumptions and trade-offs

- **It remembers nothing.** No database, no image storage. The worklist lives in your browser tab and clears on refresh, and photos exist only in memory during an assessment. That's the simplest honest answer to "where do our customers' photos go?", at the cost of no history beyond the decision record you can download.
- **Each claim is one request that waits for its answer.** Easy to follow and measure, but it doesn't absorb bursts, so production puts a queue in front.
- **The claim details and dollar limits are made up.** Policyholders, vehicle values and claim IDs are mock data; the $2,500 limit, 60% total-loss line and cost adjustments are placeholders showing where the carrier's numbers plug in. Uploaded claims start blank; fill in details and the rules re-run instantly.
- **The photo checks are rough.** Tuned on a handful of images. Sharpness can't tell a blurry photo from a sharp close-up of a smooth door, so it only catches very soft photos and relies on the AI for blur and glare. The reused-photo check catches a mirrored copy of one demo past claim, not a rotated one.
- **Some inputs are turned away rather than half-handled.** JPEG, PNG and WebP, up to eight photos a claim. HEIC and video get a clear message saying what to send instead.
- **Vercel's limits shaped a few choices.** Requests over 4.5 MB are rejected, so the browser shrinks each photo first, which also strips location data. Requests can run 60 seconds; the AI call gives up at 45 and the claim goes to manual triage.
- **Pasted links are treated as untrusted.** The server follows only https links, refuses private and cloud-metadata addresses (checked again on every redirect), accepts only real image files, and stops at 10 MB or 8 seconds.
- **The public link costs money to use,** so the API key has a monthly spend limit, and the bulk evaluation runner needs a secret token.

## Customer data and expertise needed

- **A few hundred past claims** with photos, the route each took, the final paid cost and any supplements.
- **Two estimating experts' time** to label them independently. How often they disagree sets the realistic ceiling.
- **Today's baseline:** late escalations, supplement rates, reviewer minutes per claim, repeat customer contacts.
- **Their rules and numbers:** photo-estimate eligibility, fast-path limits, state total-loss thresholds, labour rates, vehicle values.
- **Security and compliance input** on where photos may be processed, retention, and model data terms.

## What we'd do next

1. Add the ~15 photos listed in [`eval/README.md`](eval/README.md): more body types, damage levels and real road-car escalations.
2. Have an estimating expert correct the draft labels, and add a second labeller to measure agreement.
3. Replace the illustrative cost adjustments with real labour-time data and test range coverage against paid claims.
4. Accept video (picking the sharpest frames) and HEIC.
5. A rotation-proof reused-photo check, and an edited-image check from a specialist vendor.
6. Tighten the prompt on the cases where the AI and labels disagree, and re-run the model comparison.
7. Make routes more stable near the limits, using repeat runs to find the borderline cases.

## Repository layout

```
app/                  Next.js pages and API routes (assess, ask, health, eval-cases, eval-run, client-error)
components/           Worklist, assessment panel, photo viewer, drawers, intake
demo-images/          Demo claims, one folder per claim (A, B, C, D, E)
eval/                 Labelled cases, claim details, test images, saved results
lib/extraction/       The AI call, prompt, output format and model prices
lib/policy/           Routing protocol, citations, cost range and rule engine, with tests
lib/image/            Photo quality checks and reused-photo fingerprint
lib/net/              Safe URL fetching, with tests
lib/eval/             Evaluation runner and scoring
lib/client/           Browser-side intake, worklist and error reporting
scripts/              Evaluation command and public-folder copy
```
