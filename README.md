# Vehicle damage claims AI

A customer takes a photo of their damaged car. The AI reads the make, model, colour and damage, and gives a rough repair-cost range. Written rules then recommend the next step, and a reviewer makes the call: approve it for estimating, ask the customer for better photos, or send the claim to an adjuster.

- Live prototype: https://vehicle-damage-claims-ai.vercel.app
- Evaluation: the **Evaluation** page in the app, and [`eval/README.md`](eval/README.md)

## What you asked for

| You asked for | Where to find it |
|---|---|
| Accept a photo by upload or URL | **+ Add photos**: a photo, a folder per claim, or a link |
| Make, model and colour | Top of the assessment card. If it can't tell, it says so instead of guessing |
| Damage summary | Assessment card, e.g. "Left rear door dent with scraping" |
| A rough repair estimate | Assessment card: a likely range, the hours and parts behind it, and possible extras listed separately |
| Setup, architecture, tools, next steps | [Setup](#setup), [Architecture](#architecture-and-data-flow), [Why these tools](#why-these-tools), [Next steps](#what-wed-do-next) |
| Evaluation | [Evaluation](#evaluation) |

## How it works for a claims team

The tool supports the first decision a reviewer makes on a claim. Getting that right means simple claims move faster, customers are asked for the right photos the first time, and complex claims reach a person earlier.

| Route | What happens |
|---|---|
| Ready for estimating | The reviewer approves the route and range, and the claim goes to the estimating team as a starting point |
| Request more evidence | The reviewer texts or emails the customer which photos to retake, with an upload link. The claim waits until they reply |
| Adjuster / total loss | The claim goes to a field adjuster or the total loss unit, plus the fraud team (SIU) if a photo matches a past claim |

- "Approve" means approving the route and range as a starting point. The tool doesn't approve payments.
- If the AI call fails, the claim goes to **manual triage**, which is today's normal process.
- Each reason shows where it came from: the policy, the claim form, the AI, the photo checks, or a rule.
- The reviewer can adjust the range or change the route. Changes go back through the rules, and a route change needs a reason.
- Each decision is logged with the recommended route and the reviewer's route, so you can see how often they agree ([more](#tracking-overrides)).

## Setup

The prototype is live at https://vehicle-damage-claims-ai.vercel.app. Click **Load demo queue**, or drag in the `demo-images/` folder (each subfolder is one claim).

To run it locally (Node 22 or later):

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
npm test                       # routing rules and URL safety; no API key needed
npm run eval                   # re-run the labelled set; needs a key and costs money
```

To deploy your own copy, import the repo into Vercel and add `ANTHROPIC_API_KEY`. Optional settings are in `.env.example`.

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

1. **Prepare photos.** Fix rotation and resize. Links are downloaded by a safe fetcher first.
2. **Photo checks.** Plain code checks brightness, sharpness, black and white, and whether the photo matches one from a past claim.
3. **AI extraction.** One Claude call per claim. It fills in a fixed form: the vehicle, each damaged part with how bad it is and whether it needs repair or replacement, what the photos show, and any risk signs.
4. **Routing rules.** Written rules pick the route from the AI's answers, the photo checks and the claim details.

**Key design choices**

- **The AI describes, the code decides.** The AI reports facts a reviewer could check in the photo, like whether the badge is visible or the airbags are out. The rules in [`lib/policy/protocol.ts`](lib/policy/protocol.ts) pick the route, and each rule has a test.
- **The AI only sees the photos.** Policy and claim details go to the rules. If the AI were told "the policy says Honda Civic", it would likely lean that way, which would weaken the check that the car matches the policy. It also keeps customer-written text away from the AI.
- **One AI call, not an agent.** The steps are known up front, so letting the model choose them would add time, cost and unpredictability. One call is also easy to measure, retry and fall back from.
- **No confidence scores.** Models aren't reliable judges of their own confidence, so the rules use facts instead. For example, if no badge is visible, the make is left blank.
- **The most cautious route wins.** If any rule says adjuster, the claim goes to an adjuster.

**The routing rules.** Some are locked, such as injury, structural damage, deployed airbags, a reused photo, or a vehicle that isn't a normal road car. Others are settings the carrier can change within limits, like the $2,500 fast-path limit and the total-loss line (60% of vehicle value). Changing a setting re-routes the worklist straight away, because only the rules re-run. **Test against labelled cases** shows what a change would do before it's published.

**The repair estimate.** The AI describes each repair; the carrier's rate card prices it. We found the AI was consistent about *what* was damaged but not about what it cost: the same Civic photo got totals from $750–$1,800 to $1,000–$2,600 across calls. So code turns each described repair into labour and paint hours and a part, then prices them for this car and this place:

- **Where:** the claim's ZIP code picks a labour market that scales the carrier's base rate ($65/h). Maria's Columbus claim is $65/h; the same damage in San Francisco is $81/h, and in Iowa $53/h.
- **What car:** parts cost more on a luxury make or a car worth over $40,000, and less on one worth under $10,000. Electric and hybrid cars add a high-voltage safety step.

The same photo now prices at $950 to $1,300 (Columbus) on every call.

- **Each line shows its working:** what the AI saw in the photo, the hours and rates ("4.5 h body x $65 + 3.5 h paint x $110 = $678"), and the repair cost against the replacement cost, with the one priced marked. If repairing a part would cost more than replacing it, it's priced as a replacement.
- **The range covers what the photos show,** 15% either side of the most likely cost (a setting).
- **What the photos can't show is listed separately** as possible extras: damage behind the panels, parts the AI flagged for inspection, sensor recalibration. The routing rules use the cautious figure that includes them.
- **The AI's own price is kept as a cross-check,** and used for parts the rate card doesn't cover and for vehicles that aren't road cars.
- **Every hour, rate and market is a placeholder.** In production:
    - **Third-party data** gives the hours and parts: an estimating platform's labour times (CCC, Mitchell or Audatex), and parts priced for the exact car from its VIN.
    - **The carrier's data** gives the rates: labour rates by market and the deals with its partner shops.
    - **Historical paid claims** calibrate it: compare our estimates with what was finally paid, by region, vehicle and damage type, correct where we're consistently off, and set the range width so an agreed share of final costs land inside it.

  The protocol owner can change the base rates in the app, and **Edit details** can change a claim's ZIP to see the price move.

When a claim can't be priced reliably yet, the range is marked **Provisional** and doesn't affect the route.

### In production

The same steps, inside the carrier's own cloud account and connected to their claims system. Claude runs on AWS (Bedrock) and Google Cloud (Vertex AI), so photos can stay in the carrier's account.

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
| Worklist lives in the browser | Connected to the claims system (for example Guidewire), with decisions written back to the claim file |
| No image storage | Photos in the carrier's storage, with retention rules |
| One request per claim | A queue with retries and rate limits, so a spike in claims doesn't cause timeouts |
| Decision record you can download | An audit log of every decision, with monitoring on speed, cost, failures and overrides |
| Versions shown on each result | Each prompt, model or rule change tested against the labelled set before release |
| Mock roles | Single sign-on, role-based access, two-person approval for rule changes |
| Checks against one demo past-claim photo | Duplicate search across all past photos, plus a check for edited images |
| The AI's general price knowledge | Labour times from an estimating platform and the carrier's paid-claims history |
| A person approves each claim | Gradual automation for narrow, low-risk cases (see [Path to production](#path-to-production)) |

## Why these tools

| Option | Good at | Why we didn't start there |
|---|---|---|
| **Claude (what we used)** | Reads photos well, fills in a fixed format reliably, runs on AWS and Google Cloud | Still needs testing on your claims |
| GPT or Gemini | Similar capability | Not tested here. Switching would be a settings change plus a test run |
| Estimating vendors (Tractable, CCC, Mitchell) | Pricing, based on large volumes of paid claims | Their reasoning isn't visible. Our routing could use their price in production |
| A custom vision model | Locating damage, at low cost per photo | Needs many labelled photos and an ML team, and doesn't give make, model or price |
| Open-source models | Photos stay in your environment | Generally less accurate today, and more to run |

Because the output format is fixed and the labelled set checks the results, the model can be swapped without changing the rules or the screen.

- **Vercel, Next.js and TypeScript** gave us a working link quickly, with the screen and server in one codebase, so the rules shown on screen are the same code the server runs. A carrier would run the same code in their own cloud.
- **Anthropic's SDK** makes the one Claude call per claim, with structured outputs.
- **sharp** handles image prep and photo checks, **zod** validates requests and the AI's answer, and Node's test runner runs the rule tests.

## Speed and cost

Measured on the 26 labelled cases, end to end:

| | Opus 5.5 (default) | Sonnet 5.5 |
|---|---|---|
| Typical time per claim | 9.7 s | 7.0 s |
| Slowest 1 in 10 | 13.0 s | 8.9 s |
| Estimated cost per claim | $0.039 | $0.019 |
| Failed calls | 0 of 26 | 0 of 26 |

- Most of the time is the AI call. Claims are assessed in the background, three at a time, so a reviewer doesn't usually wait.
- The call times out at 45 seconds, retries once, then goes to manual triage.
- At about 4 cents a claim, 100,000 claims a year is roughly $4,000 at list prices. Our actual bill was higher than these estimates, so treat them as a lower bound. Integration and expert labelling cost more than the model.

## Evaluation

### Summary

**How would we know it's working?**

Not every mistake costs the same here, so we don't focus on overall accuracy. We focus on three things:

1. **Did it catch the complex claims?** If an expert would send a claim to an adjuster, we should too. A missed one, like a likely total loss handled as a simple repair, is costly to fix later.
2. **Did it send simple claims to a person anyway?** Some caution is expected, but the more simple claims go to a person, the less time the tool saves.
3. **Did it get the basics right?** The right make, model and colour, or left blank when it can't tell. Damage described in the right place, without missing or adding any.

We'd also track how consistent, fast and cheap it is. Once it's live, we keep measuring the same things by tracking when reviewers disagree with it. The carrier decides what counts as good enough.

**Where does it fail?**

We tested it on 26 claims. It caught 10 of the 11 complex ones. The one it missed is a cheap car whose label assumed a higher repair price than the rate card gives, so it needs an estimator to settle (see below). Its other mistakes were more cautious than needed rather than less. 11 is a small sample: the real catch rate could be as low as 62%, so we'd need more cases to be confident.

The mistakes we care most about:

- A complex claim going straight to estimating when it needed an adjuster. The locked rules are there to stop this.
- A price on the wrong side of the $2,500 limit.
- Edited photos. We catch reused photos, but not edited ones yet.

Poor or sideways photos are less of a concern, since the usual result is asking the customer for another photo.

**What would we need from the carrier?**

- A few hundred past claims: the photos, where each claim went, what was finally paid, and any supplements.
- Two estimating experts to label them separately. How often they agree with each other is the bar to beat.
- Today's numbers: how often claims are escalated late, how often shops file supplements, and how long reviewers spend on each claim.
- Their own rules: limits, labour rates and vehicle values.
- Security and compliance input on where photos can be processed and how long they're kept.

Scale can do the expert labelling.

**Is the repair estimate good enough?**

We can't tell yet. That needs their paid claims, and the app says so on every estimate. Once we have them, we'd check how often the final paid amount falls inside our range, and how wide the range is. A very wide range will usually contain the paid amount, but it isn't much help, so we keep the range to what the photos show and list the possible extras separately. The range width is a setting we'd calibrate on their paid claims.

What matters most is which side of the $2,500 limit the estimate lands on. If it's close, the claim is flagged for a price check. If it's well over, it goes to an adjuster. If our estimate is too low, the body shop files a supplement, the same as today. It's a starting point, not the amount paid.

### Results

26 labelled cases, 11 of which should go to an adjuster. The labels are our drafts and need an estimating expert's review.

| | Opus 5.5, prompt v1 | Opus 5.5, prompt v2 | Sonnet 5.5, prompt v2 |
|---|---|---|---|
| Complex claims caught | 10 of 11 | 10 of 11 | 10 of 11 |
| Matched the expert's route, exact (acceptable) | 21 (22) of 26 | 22 (24) of 26 | 22 (24) of 26 |
| Sent to a person when not needed | 1 of 15 | 0 of 15 | 0 of 15 |
| Didn't guess when it couldn't tell | 17 of 17 | 17 of 17 | 16 of 17 |
| Same route on all 4 runs | not measured | 25 of 26 (with AI pricing) | not measured |

- **Prompt v1 to v2.** After the first run we changed four instructions based on the cases it got wrong. For example, a crumpled bumper no longer counts as "structural" damage. Since v2 was tuned on these same cases, its improvement probably looks better here than it would on new ones. With real data we'd keep a separate test set nobody tunes against.
- **The rate card and the missed case.** All three columns are scored with today's rules and rate card, from the saved AI answers. Moving to the rate card changed one route: the Civic on a policy valuing the car at $2,500. The rate card prices the repair at about $1,130, which is 45% of the car's value and under the 60% total-loss line. With the AI's own price it crossed the line, which is what the draft label assumed. An estimator should decide which is right. If the carrier's threshold is lower, it's a setting.
- **Opus or Sonnet.** They routed the same here, and Sonnet is faster and half the price. 26 cases aren't enough to tell them apart; the carrier's own claims should decide.
- **The set's main gap.** Few cases should go straight to estimating, so needless escalation is hard to measure for now. [`eval/README.md`](eval/README.md) lists what to add.

### Failure modes

| Failure | How likely | What the prototype does |
|---|---|---|
| Complex claim sent straight to estimating | Low, but high impact | Locked safety rules, most cautious route wins, measured in the evaluation |
| Wrong vehicle named with confidence | Medium | Make and model left blank without a badge or distinctive shape; policy mismatch flagged |
| Damage missed or made up | Medium | "No damage visible" asks for photos; the reviewer approves each estimate |
| Estimate on the wrong side of a limit | Likely near the limit | Ranges close to the limit are flagged, very wide ones go to an adjuster |
| AI error or timeout | Occasional | One retry, then manual triage |
| Reused or edited photo | Becoming more common | Reused photos are caught and sent to SIU; edited photos aren't detected yet |
| Instructions written into a photo | Rare | The AI doesn't pick the route, so the likely worst case is a wrong fact the reviewer can see |

## Path to production

A person approves each claim today. That's the right place to start. We'd reduce review gradually, one narrow, low-risk slice at a time, with evidence first and checks still running afterwards.

| Stage | The AI | People | To move on |
|---|---|---|---|
| 1. Live comparison | Recommends routes in the background; nobody acts on them | Work claims as today | Its routes compared with adjusters' decisions for 4 to 6 weeks |
| 2. Limited pilot (this prototype) | Recommends a route for one claim segment | Approve every route | Agreed results on the carrier's own claims |
| 3. One automatic slice | Sends photo requests, later small photo estimates, without a reviewer | Review a random sample and anything flagged | Sampled reviews keep agreeing; supplements and complaints don't rise |
| 4. Expand | One more segment at a time | Sample and monitor | Each segment passes the same checks |

**What stays with a person:** total loss, injury, fraud referrals, denials, reduced payments, and anything the tool couldn't assess. The rules already work this way, and it matches where regulation is heading (the NAIC's 2023 model bulletin on insurers' use of AI expects controls in proportion to the potential harm).

**How we'd know a slice is ready,** agreed with the claims and risk owners up front:

- Complex claims caught, judged by the low end of the likely range. Showing a miss rate under 1% takes around 300 complex claims without a miss.
- Route agreement at least as good as two experts get with each other.
- Estimate ranges that contain the final paid cost at an agreed rate, and no rise in supplements.
- Reviewer overrides low and trending down.

### Tracking overrides

How often reviewers disagree with the recommendation is a direct way to measure accuracy on live claims. Each decision records the recommended route, the reviewer's route, both estimate ranges, the reason, and the rules that fired. In the prototype, **Completed** shows "Kept the recommendation on X of Y decisions" and the log downloads as a CSV. In production it would feed an override dashboard, and each changed route would become a bug fix or a new test case.

## Key assumptions and trade-offs

- **It doesn't store anything.** The worklist lives in your browser tab and photos are only held in memory. That keeps the privacy answer simple, but there's no history.
- **The claim details and dollar limits are made up.** The $2,500 limit, 60% total-loss line and cost adjustments are placeholders for the carrier's numbers.
- **The photo checks are rough.** They were tuned on a handful of images, and the reused-photo check catches a mirrored copy but not a rotated one.
- **Some inputs are turned away.** JPEG, PNG and WebP only, up to eight photos a claim. HEIC and video get a message saying what to send instead.
- **Links are treated as untrusted.** The server only follows https links to public addresses and only accepts real image files.

## What we'd do next

1. Run the evaluation on the carrier's past claims, with expert labels, and test the estimate against what was actually paid.
2. Replace the placeholder rate card with an estimating platform's labour times and the carrier's own rates, and calibrate the range width on paid claims.
3. Straighten photos in code, accept video and HEIC, and add a check for edited photos.

## Repository layout

```
app/                  Pages and API routes
components/           Worklist, assessment panel, photo viewer, intake
demo-images/          Demo claims, one folder per claim
eval/                 Labelled cases, test images, saved results
lib/extraction/       The Claude call, prompt and output format
lib/policy/           Routing rules, estimate and rule engine, with tests
lib/image/            Photo checks
lib/net/              Safe link fetching, with tests
lib/eval/             Evaluation runner and scoring
lib/client/           Browser-side worklist, customer contact and review log
```
