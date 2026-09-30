"use client";

import type { SimulateMode } from "./Workspace.tsx";

export function ArchitectureDrawer(props: {
  health: { apiKeyConfigured: boolean; model: string; promptVersion: string; protocolVersion: string } | null;
  simulate: SimulateMode;
  onSimulate: (m: SimulateMode) => void;
  onClose: () => void;
}) {
  const { health } = props;
  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Architecture</h2>
            <div className="sub">The AI reads the photo, written rules decide the route, and a person sees why.</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <section>
            <div className="section-label">How one claim flows through</div>
            <div className="arch">
              <div className="arch-box">
                <b>1. Reviewer screen</b>
                Photos or a link, plus claim details. Photos are shrunk in the browser.
              </div>
              <div className="arch-arrow">→</div>
              <div className="arch-box">
                <b>2. Photo checks</b>
                Code measures brightness, sharpness, size and colour, and compares against past claims. No AI.
              </div>
              <div className="arch-arrow">→</div>
              <div className="arch-box">
                <b>3. AI reads the photos</b>
                One call per claim. Returns fixed-format facts: vehicle, damage items with rough costs, what the photo shows, risk signs.
              </div>
              <div className="arch-arrow">→</div>
              <div className="arch-box">
                <b>4. Routing protocol</b>
                Written, tested rules pick the route and list their reasons. Uses the claim details the AI never sees.
              </div>
              <div className="arch-arrow">→</div>
              <div className="arch-box">
                <b>5. Reviewer decides</b>
                Approve, change the route with a reason, message the customer, or ask a question.
              </div>
            </div>
            <div className="note">
              Everything from step 2 to 4 runs in one serverless function on Vercel. The API key stays on the server. The AI sees only the photos, not the policy details, so it can&apos;t be steered by what the policy says and the mismatch checks stay independent.
            </div>
          </section>

          <section>
            <div className="section-label">Prototype today vs. production</div>
            <table className="t">
              <thead>
                <tr>
                  <th>Prototype</th>
                  <th>Production</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>No database.</b> The worklist lives in the browser tab and clears on refresh.
                  </td>
                  <td>Worklist and decisions come from the claims system (for example Guidewire) through an integration.</td>
                </tr>
                <tr>
                  <td>
                    <b>No image storage.</b> Photos exist only in memory during a request.
                  </td>
                  <td>Photos stay in the carrier&apos;s own storage, with retention rules, and location data stripped.</td>
                </tr>
                <tr>
                  <td>One request per claim, waiting for the answer.</td>
                  <td>A queue and background workers, so bursts (a hailstorm) don&apos;t time out, with retries and rate limiting.</td>
                </tr>
                <tr>
                  <td>The decision record can be downloaded.</td>
                  <td>Every decision record is kept as an audit log: inputs, AI output, rules fired, versions, reviewer action.</td>
                </tr>
                <tr>
                  <td>Prompt and protocol versions shown on each result.</td>
                  <td>A version registry, and every change scored against the labelled set before release.</td>
                </tr>
                <tr>
                  <td>Mock claim details and a mock protocol-owner role.</td>
                  <td>Real policy data, single sign-on, role-based access and two-person approval for protocol changes.</td>
                </tr>
                <tr>
                  <td>Reused-photo check against a single demo photo.</td>
                  <td>An index across every photo the carrier holds, plus a specialist tool for edited or generated images.</td>
                </tr>
                <tr>
                  <td>Latency and cost shown per claim.</td>
                  <td>Monitoring and alerts on latency, cost, failure rate and how often reviewers override the route.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <div className="section-label">Why these tools</div>
            <table className="t">
              <thead>
                <tr>
                  <th>Option</th>
                  <th>What it&apos;s good at</th>
                  <th>Why we didn&apos;t start there</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Claude (what we used)</b>
                  </td>
                  <td>Reads photos well, returns answers in a fixed format, runs on AWS and Google Cloud</td>
                  <td>We still have to test it on your claims</td>
                </tr>
                <tr>
                  <td>GPT or Gemini</td>
                  <td>Similar capability</td>
                  <td>We haven&apos;t tested them. Switching is a settings change</td>
                </tr>
                <tr>
                  <td>Estimating vendors (Tractable, CCC, Mitchell)</td>
                  <td>Pricing, because they&apos;ve seen millions of paid claims</td>
                  <td>They don&apos;t show their reasoning. In production, our routing could use their price instead of ours</td>
                </tr>
                <tr>
                  <td>A custom-trained vision model</td>
                  <td>Pinpointing damage, cheaply</td>
                  <td>Needs lots of labelled photos and an ML team, and doesn&apos;t give make, model or price on its own</td>
                </tr>
                <tr>
                  <td>Open-source models on your servers</td>
                  <td>Photos never leave your environment</td>
                  <td>Less accurate today, and more to run</td>
                </tr>
              </tbody>
            </table>
            <div className="note">
              The fixed output format is the contract and the labelled set is the referee, so the model can be swapped without touching the rules or the screen. Next.js on Vercel gives a shareable link with nothing to install. sharp handles the photo checks; zod checks every input and the AI&apos;s output.
            </div>
          </section>

          <section>
            <div className="section-label">Platform limits that shape the design</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <b>4.5 MB request limit on Vercel.</b> Phone photos are often 4 to 12 MB, so the browser shrinks them to 1600 px before upload. That also strips location data.
              </li>
              <li>
                <b>Function time limit.</b> Set to 60 seconds; the AI call times out at 45 seconds and the claim goes to manual triage if it does.
              </li>
              <li>
                <b>Links are fetched safely.</b> https only, no internal or cloud-metadata addresses (checked at connect time and on every redirect), JPEG, PNG or WebP only, 10 MB and 8 seconds at most.
              </li>
              <li>
                <b>iPhone HEIC and video</b> aren&apos;t accepted yet, with a clear message saying what to send instead.
              </li>
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Engineering controls</h3>
              <span className="sub">For the demo</span>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>API key on server</dt>
                <dd>{health ? (health.apiKeyConfigured ? "Configured (never sent to the browser)" : "Not configured") : "Unknown"}</dd>
                <dt>Model</dt>
                <dd className="mono">{health?.model ?? "unknown"}</dd>
                <dt>Prompt version</dt>
                <dd className="mono">{health?.promptVersion ?? "unknown"}</dd>
                <dt>Protocol version</dt>
                <dd className="mono">{health?.protocolVersion ?? "unknown"}</dd>
              </dl>
              <div style={{ marginTop: 12 }}>
                <div className="section-label">Simulate an AI failure on the next claim assessed</div>
                <div className="seg">
                  {(
                    [
                      ["none", "Off"],
                      ["timeout", "Timeout"],
                      ["invalid_output", "Bad output"],
                    ] as [SimulateMode, string][]
                  ).map(([m, label]) => (
                    <button key={m} className={props.simulate === m ? "on" : ""} onClick={() => props.onSimulate(m)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  Then add a claim or use Retry on one. It lands in manual triage with the reason, instead of guessing.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
