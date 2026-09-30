# Vehicle damage claims AI

A prototype claims intake tool for an auto insurer. A reviewer drops in photos of a damaged vehicle and gets the vehicle's make, model and colour, a short damage summary and a rough repair-cost range. The tool then recommends where the claim should go next: the photo estimate path, a request for more photos, or an adjuster.

**The AI reads the photo, written rules decide the route, and a person sees why.**

> Work in progress. The routing rules and tests are in place; the screens and the AI call are being built next.

## What the brief asks for, and where it is

| Requirement | Where |
|---|---|
| Accept a photo by upload or URL | Intake panel (upload a photo, a folder, or paste a URL) |
| Vehicle metadata: make, model, colour | Top of the assessment card, with how each was identified |
| Damage summary | Assessment card, one line, e.g. "Left rear door dent with scraping" |
| Rough AI-generated repair estimate | Assessment card, a range with its main drivers, never a single payable number |
| Setup instructions | [Setup](#setup) |
| Architecture and data flow | Coming with the screens |
| Why these tools | Coming with the screens |
| What we'd do next | Coming with the screens |
| Evaluation approach | [`eval/README.md`](eval/README.md), plus an Evaluation page in the app |

## How routing works

The AI fills in a fixed set of facts about the photos: the vehicle, each damaged area, what the photo shows and any risk signs. It never picks the route. The routing protocol in [`lib/policy/protocol.ts`](lib/policy/protocol.ts) does that, and the same file drives the protocol panel in the app.

The protocol has two tiers:

- **Locked guardrails** for safety, scope, photo integrity and evidence. Examples: injury reported, airbags deployed, signs of structural damage, not a road car, a photo that matches a past claim, a close-up where the car can't be identified.
- **Configurable settings** a protocol owner can change within safe bounds, such as the fast-path limit ($2,500), the total-loss line (60% of vehicle value) and how strict the photo checks are. All amounts are illustrative placeholders.

When more than one rule applies, the most cautious route wins: adjuster, then more evidence, then the photo estimate path. Some rules don't change the route but flag the claim for a person to check, such as damage in a sensor area or a car that doesn't match the policy.

## Setup

Requires Node 22 or later.

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Run the routing rule tests (no AI calls, no API key needed):

```bash
npm test
```

## Repository layout

```
demo-images/        Demo cases, one folder per claim (A, B, C)
eval/               Labelled test cases and images
lib/extraction/     The fixed format the AI must return
lib/policy/         Routing protocol, cost range and the rule engine, with tests
lib/image/          Photo quality checks measured from the pixels
lib/claims/         Claim details and mock demo claims
```
