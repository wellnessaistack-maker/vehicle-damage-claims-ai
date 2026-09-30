"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { blankClaim, DEMO_CLAIMS, demoClaimForFolder } from "@/lib/claims/demo.ts";
import type { ClaimContext } from "@/lib/claims/types.ts";
import {
  currentDecision,
  failureNote,
  firstReviewNote,
  holderLine,
  newClaimId,
  now,
  REVIEWER,
  routeOf,
  uid,
  type CaseItem,
  type CaseOutcome,
  type ThreadEntry,
} from "@/lib/client/cases.ts";
import { loadDemoPhoto, type CasePhoto } from "@/lib/client/intake.ts";
import { reportClientError } from "@/lib/client/report.ts";
import type { Assessment } from "@/lib/pipeline.ts";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/policy/protocol.ts";

import { AssessmentPanel } from "./AssessmentPanel.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ArchitectureDrawer } from "./ArchitectureDrawer.tsx";
import { DecisionRecordDrawer } from "./DecisionRecordDrawer.tsx";
import { IntakeModal, type NewCase } from "./IntakeModal.tsx";
import { ProtocolDrawer } from "./ProtocolDrawer.tsx";
import { Viewer } from "./Viewer.tsx";
import { Worklist } from "./Worklist.tsx";

const CONCURRENCY = 3;

export const DEMO_QUEUE: { key: string; folder: string; photos: string[] }[] = [
  { key: "A", folder: "A-straightforward", photos: ["/demo/A-straightforward/demo_A_civic.jpg"] },
  { key: "B", folder: "B-insufficient-evidence", photos: ["/demo/B-insufficient-evidence/demo_B_closeup.jpg"] },
  { key: "C", folder: "C-escalation", photos: ["/demo/C-escalation/demo_C_f1.jpg"] },
  { key: "D", folder: "D-road-car-escalation", photos: ["/demo/D-road-car-escalation/demo_D_nissan.jpg"] },
  { key: "E", folder: "E-reused-photo", photos: ["/demo/E-reused-photo/demo_E_reused.jpg"] },
];

export type Role = "reviewer" | "owner";
export type SimulateMode = "none" | "timeout" | "invalid_output";

interface Health {
  apiKeyConfigured: boolean;
  model: string;
  promptVersion: string;
  protocolVersion: string;
}

export function Workspace() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [role, setRole] = useState<Role>("reviewer");
  const [simulate, setSimulate] = useState<SimulateMode>("none");
  const [drawer, setDrawer] = useState<null | "protocol" | "architecture" | "record">(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const inFlight = useRef(new Set<string>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const simulateRef = useRef(simulate);
  simulateRef.current = simulate;

  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("window", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError("promise", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const update = useCallback((id: string, fn: (c: CaseItem) => CaseItem) => {
    setCases((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  // ---- Processing queue ------------------------------------------------------
  const run = useCallback(
    async (c: CaseItem) => {
      inFlight.current.add(c.id);
      update(c.id, (x) => ({ ...x, status: "processing", requestError: undefined }));
      const sim = simulateRef.current;
      if (sim !== "none") setSimulate("none"); // one-shot
      try {
        const res = await fetch("/api/assess", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claim: c.claim,
            photos: c.photos.map((p) => (p.source === "url" && p.url && !p.base64 ? { name: p.name, url: p.url } : { name: p.name, base64: p.base64 })),
            settings: settingsRef.current,
            simulate: sim === "none" ? undefined : sim,
          }),
        });
        const body = await res.json().catch(() => ({ error: `The server returned HTTP ${res.status}.` }));
        if (!res.ok || body.error) throw new Error(body.error ?? `The server returned HTTP ${res.status}.`);
        const { fetched, ...rest } = body as Assessment & { fetched?: Record<string, string> };
        const assessment = rest as Assessment;
        update(c.id, (x) => {
          const photos = x.photos.map((p, i) =>
            fetched?.[i] ? { ...p, base64: fetched[i], dataUrl: `data:image/jpeg;base64,${fetched[i]}` } : p,
          );
          x = { ...x, photos };
          // Writing the note must never take the page down; the panel shows any problem itself.
          let text: string;
          try {
            const d = currentDecision({ ...x, assessment }, settingsRef.current);
            text = d ? firstReviewNote(d) : failureNote({ ...x, assessment });
          } catch (err) {
            reportClientError("first review note", err, x.claim.claimId);
            text = "The first-review note couldn't be written for this claim.";
          }
          const note: ThreadEntry = { id: uid("t"), kind: "note", author: "First review", text, at: now() };
          return { ...x, status: "ready", assessment, thread: [...x.thread, note] };
        });
      } catch (e) {
        // A request that never reached the AI (network, too large) still lands in manual triage.
        const message = e instanceof Error ? e.message : "The request failed.";
        const failed: Assessment = {
          ok: false,
          claimId: c.claim.claimId,
          assessedAt: now(),
          route: "manual_triage",
          routeLabel: "Not assessed: manual triage",
          failure: { kind: "api_error", message, simulated: false },
          photos: [],
          modelRequested: health?.model ?? "unknown",
          promptVersion: health?.promptVersion ?? "unknown",
          protocolVersion: health?.protocolVersion ?? "unknown",
          timings: { prepareMs: 0, modelMs: 0, rulesMs: 0, totalMs: 0 },
        };
        update(c.id, (x) => ({
          ...x,
          status: "ready",
          assessment: failed,
          requestError: message,
          thread: [...x.thread, { id: uid("t"), kind: "note", author: "First review", text: failureNote({ ...x, assessment: failed }), at: now() }],
        }));
      } finally {
        inFlight.current.delete(c.id);
      }
    },
    [update, health],
  );

  useEffect(() => {
    const free = CONCURRENCY - inFlight.current.size;
    if (free <= 0) return;
    cases
      .filter((c) => c.status === "queued" && !inFlight.current.has(c.id))
      .slice(0, free)
      .forEach((c) => void run(c));
  }, [cases, run]);

  // ---- Adding cases ------------------------------------------------------------
  const addCases = useCallback((incoming: NewCase[]) => {
    const created: CaseItem[] = incoming.map((n) => {
      const claim: ClaimContext = (n.folder && demoClaimForFolder(n.folder)) || blankClaim(newClaimId());
      const demoKey = n.folder?.split("/").pop()?.match(/^([A-Z])-/)?.[1];
      return {
        id: uid("case"),
        claim,
        photos: n.photos,
        status: "queued",
        thread: [],
        folder: n.folder,
        demoKey: demoKey && DEMO_CLAIMS[demoKey] ? demoKey : undefined,
        addedAt: now(),
      };
    });
    setCases((cs) => [...cs, ...created]);
    setSelectedId((s) => s ?? created[0]?.id ?? null);
  }, []);

  const loadDemoQueue = useCallback(async () => {
    setLoadingDemo(true);
    try {
      const loaded: NewCase[] = await Promise.all(
        DEMO_QUEUE.map(async (d) => ({ folder: d.folder, photos: await Promise.all(d.photos.map(loadDemoPhoto)) })),
      );
      addCases(loaded);
    } finally {
      setLoadingDemo(false);
    }
  }, [addCases]);

  // ---- Reviewer actions -----------------------------------------------------------
  const openCases = useMemo(() => cases.filter((c) => c.status !== "done"), [cases]);

  const advanceFrom = useCallback(
    (id: string) => {
      const order = cases.filter((c) => c.status !== "done" && c.id !== id);
      setSelectedId(order[0]?.id ?? id);
    },
    [cases],
  );

  const addThread = useCallback(
    (id: string, entry: Omit<ThreadEntry, "id" | "at">) => update(id, (c) => ({ ...c, thread: [...c.thread, { ...entry, id: uid("t"), at: now() }] })),
    [update],
  );

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const complete = useCallback(
    (id: string, outcome: Omit<CaseOutcome, "at">) => {
      const c = cases.find((x) => x.id === id);
      const next = cases.find((x) => x.status !== "done" && x.id !== id);
      const holder = holderLine({ ...outcome, at: now() });
      const where = outcome.action === "message_sent" ? "moved to Waiting on customer" : `moved to Completed${holder ? `. ${holder}` : ""}`;
      setToast(`${c?.claim.claimId ?? "Claim"} ${where}. ${next ? `Next up: ${next.claim.claimId}.` : "Inbox clear."}`);
      update(id, (c) => ({
        ...c,
        status: "done",
        outcome: { ...outcome, at: now() },
        thread: [...c.thread, { id: uid("t"), kind: "action", author: REVIEWER.name, text: outcome.summary + (outcome.reason ? ` Reason: ${outcome.reason}` : ""), at: now() }],
      }));
      advanceFrom(id);
    },
    [cases, update, advanceFrom],
  );

  const reassess = useCallback(
    (id: string, changes: Partial<Pick<CaseItem, "photos" | "claim">> = {}) => {
      update(id, (c) => ({ ...c, ...changes, status: "queued", outcome: undefined }));
      setSelectedId(id);
    },
    [update],
  );

  const addCustomerPhotos = useCallback(
    (id: string, photos: CasePhoto[]) => {
      const c = cases.find((x) => x.id === id);
      if (!c) return;
      addThread(id, { kind: "action", author: "Customer", text: `Sent ${photos.length} new photo${photos.length === 1 ? "" : "s"}.` });
      reassess(id, {
        photos: [...c.photos, ...photos],
        claim: { ...c.claim, priorEvidenceRequests: c.claim.priorEvidenceRequests + 1 },
      });
    },
    [cases, addThread, reassess],
  );

  const updateClaim = useCallback((id: string, claim: ClaimContext) => update(id, (c) => ({ ...c, claim })), [update]);

  const selected = cases.find((c) => c.id === selectedId) ?? null;
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CR</div>
          Claims first review <small>Auto physical damage</small>
        </div>
        <span className="env-chip">Prototype · mock claims · nothing is stored</span>
        {health && !health.apiKeyConfigured && <span className="chip chip-bad">AI key not configured</span>}
        {settingsChanged && (
          <button className="chip chip-warn" onClick={() => setDrawer("protocol")} style={{ cursor: "pointer" }}>
            Protocol draft in use (not published)
          </button>
        )}
        <div className="topbar-spacer" />
        <nav className="topbar-nav">
          <button onClick={() => setDrawer("protocol")}>Routing protocol</button>
          <button onClick={() => setDrawer("architecture")}>Architecture</button>
          <a href="/evaluation">Evaluation</a>
        </nav>
        <select className="role-select" value={role} onChange={(e) => setRole(e.target.value as Role)} title="Mock role, no real login">
          <option value="reviewer">Role: Reviewer</option>
          <option value="owner">Role: Protocol owner (mock)</option>
        </select>
        <div className="user">
          <div className="avatar">{REVIEWER.initials}</div>
          <div>
            {REVIEWER.name}
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{REVIEWER.role}</div>
          </div>
        </div>
      </header>

      <div className="workspace">
        <ErrorBoundary label="Worklist" className="col worklist">
        <Worklist
          cases={cases}
          settings={settings}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={() => setIntakeOpen(true)}
          onLoadDemo={loadDemoQueue}
          loadingDemo={loadingDemo}
          openCount={openCases.length}
        />
        </ErrorBoundary>
        <ErrorBoundary key={`a-${selected?.id ?? "none"}`} label="Assessment" className="col assess">
        <AssessmentPanel
          key={selected?.id ?? "none"}
          item={selected}
          settings={settings}
          routeOverride={selected ? routeOf(selected, settings) : null}
          onComplete={complete}
          onThread={addThread}
          onReassess={reassess}
          onCustomerPhotos={addCustomerPhotos}
          onOpenRecord={() => setDrawer("record")}
          onOpenProtocol={() => setDrawer("protocol")}
        />
        </ErrorBoundary>
        {/* Claim details and photos are reference material, so they sit on the right. */}
        <ErrorBoundary key={`v-${selected?.id ?? "none"}`} label="Photos and claim details" className="col viewer">
          <Viewer item={selected} settings={settings} onUpdateClaim={updateClaim} onReassess={reassess} />
        </ErrorBoundary>
      </div>

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {intakeOpen && <IntakeModal onClose={() => setIntakeOpen(false)} onAdd={(n) => { addCases(n); setIntakeOpen(false); }} />}
      {drawer === "protocol" && (
        <ProtocolDrawer
          settings={settings}
          onChange={setSettings}
          role={role}
          selected={selected}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "architecture" && (
        <ArchitectureDrawer health={health} simulate={simulate} onSimulate={setSimulate} onClose={() => setDrawer(null)} />
      )}
      {drawer === "record" && selected && <DecisionRecordDrawer item={selected} settings={settings} onClose={() => setDrawer(null)} />}
    </div>
  );
}
