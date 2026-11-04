import { describe, expect, it } from "vitest";
import { circuitIssues, linearPath, parseCircuit, type Circuit } from "./circuit.js";
import { decide, EngineError, resume, startCircuit, submissionProblems, type Directory, type EngineState, type SubmissionDirectory } from "./engine.js";

const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";
const ROLE_C = "33333333-3333-4333-8333-333333333333";

/** membre → président → trésorier, le circuit de départ de l'association pilote. */
function circuit(overrides: Partial<Circuit> = {}, exempt = true): Circuit {
  return {
    schemaVersion: 1,
    allowSelfProcessing: false,
    nodes: [
      { id: "start", type: "START", label: "Dépôt", approvers: [], requesterExempt: true },
      { id: "president", type: "APPROVAL", label: "Accord du président", approvers: [{ kind: "ROLE", id: ROLE_A }], requesterExempt: exempt },
      { id: "treasurer", type: "PROCESSING", label: "Remboursement", approvers: [{ kind: "ROLE", id: ROLE_B }], requesterExempt: false },
      { id: "end", type: "END", label: "Fin", approvers: [], requesterExempt: true },
    ],
    edges: [
      { from: "start", to: "president" },
      { from: "president", to: "treasurer" },
      { from: "treasurer", to: "end" },
    ],
    ...overrides,
  };
}

/** Annuaire de test : pour chaque nœud, les personnes désignées. */
function directory(map: Record<string, string[]>): SubmissionDirectory {
  return {
    isDesignated: (node, userId) => (map[node.id] ?? []).includes(userId),
    hasOtherDesignated: (node, userId) => (map[node.id] ?? []).some((u) => u !== userId),
  };
}

const people = { claire: "claire", paul: "paul", tess: "tess", lea: "lea" };
// Claire est présidente, Paul président adjoint (même étape), Tess trésorière, Léa membre simple.
const dir = directory({ president: [people.claire, people.paul], treasurer: [people.tess] });

const running = (currentNodeId: string): EngineState => ({ status: "RUNNING", currentNodeId, returnedFromNodeId: null });

describe("circuit", () => {
  it("lit un circuit valide et suit son chemin", () => {
    const { circuit: parsed, issues } = parseCircuit(circuit());
    expect(issues).toEqual([]);
    expect(linearPath(parsed!)).toEqual(["start", "president", "treasurer", "end"]);
    expect(circuitIssues(parsed!, { complete: true })).toEqual([]);
  });

  it("refuse explicitement les types réservés (conditions, parallèle)", () => {
    const raw = circuit();
    const { circuit: parsed, issues } = parseCircuit({ ...raw, nodes: [...raw.nodes, { id: "if", type: "CONDITION", label: "Seuil", approvers: [], requesterExempt: true }] });
    expect(parsed).toBeNull();
    expect(issues[0]).toMatchObject({ nodeId: "if", code: "NODE_TYPE_UNAVAILABLE" });
    expect(issues[0]!.message).toContain("pas encore prises en charge");
  });

  it("refuse une désignation inconnue et un champ inattendu", () => {
    const raw = circuit();
    expect(parseCircuit({ ...raw, nodes: [{ ...raw.nodes[0]!, approvers: [{ kind: "TEAM", id: ROLE_A }] }, ...raw.nodes.slice(1)] }).circuit).toBeNull();
    expect(parseCircuit({ ...raw, script: "alert(1)" }).circuit).toBeNull();
  });

  it("impose les règles de la première version", () => {
    const base = circuit();
    const noProcessing = { ...base, nodes: base.nodes.filter((n) => n.id !== "treasurer"), edges: [{ from: "start", to: "president" }, { from: "president", to: "end" }] };
    expect(circuitIssues(noProcessing, { complete: false }).map((i) => i.code)).toContain("PROCESSING_COUNT");

    const branch = { ...base, edges: [...base.edges, { from: "president", to: "end" }] };
    expect(circuitIssues(branch, { complete: false }).map((i) => i.code)).toContain("NOT_LINEAR");

    const approval = (id: string, after: string) => ({ id, type: "APPROVAL" as const, label: id, approvers: [{ kind: "USER" as const, id: ROLE_C }], requesterExempt: true, after });
    const many = [approval("a1", "president"), approval("a2", "a1"), approval("a3", "a2")];
    const tooMany: Circuit = {
      ...base,
      nodes: [...base.nodes.slice(0, 2), ...many.map(({ after: _after, ...n }) => n), ...base.nodes.slice(2)],
      edges: [
        { from: "start", to: "president" },
        { from: "president", to: "a1" },
        { from: "a1", to: "a2" },
        { from: "a2", to: "a3" },
        { from: "a3", to: "treasurer" },
        { from: "treasurer", to: "end" },
      ],
    };
    expect(circuitIssues(tooMany, { complete: false }).map((i) => i.code)).toContain("TOO_MANY_APPROVALS");

    const wrongOrder = {
      ...base,
      nodes: base.nodes,
      edges: [
        { from: "start", to: "treasurer" },
        { from: "treasurer", to: "president" },
        { from: "president", to: "end" },
      ],
    };
    expect(circuitIssues(wrongOrder, { complete: false }).map((i) => i.code)).toContain("WRONG_ORDER");
  });

  it("tolère un brouillon sans personne désignée mais pas à l'activation", () => {
    const base = circuit();
    const empty = { ...base, nodes: base.nodes.map((n) => (n.id === "president" ? { ...n, approvers: [] } : n)) };
    expect(circuitIssues(empty, { complete: false })).toEqual([]);
    expect(circuitIssues(empty, { complete: true })).toMatchObject([{ nodeId: "president", code: "NO_APPROVERS" }]);
  });
});

describe("startCircuit", () => {
  it("attend l'accord du président quand le demandeur est un simple membre", () => {
    const { state, decisions } = startCircuit(circuit(), people.lea, dir);
    expect(state).toEqual(running("president"));
    expect(decisions).toEqual([]);
  });

  it("valide d'office l'étape du président quand le président fait la demande, en l'enregistrant", () => {
    const { state, decisions } = startCircuit(circuit(), people.claire, dir);
    expect(state).toEqual(running("treasurer"));
    expect(decisions).toEqual([{ nodeId: "president", outcome: "AUTO_APPROVED", actorId: people.claire, message: expect.stringContaining("d'office") }]);
  });

  it("n'ôte que les étapes du demandeur : la trésorière qui demande passe par le président", () => {
    const { state, decisions } = startCircuit(circuit(), people.tess, dir);
    expect(state).toEqual(running("president"));
    expect(decisions).toEqual([]);
  });

  it("ne dispense pas quand l'option est décochée", () => {
    expect(startCircuit(circuit({}, false), people.claire, dir).state).toEqual(running("president"));
  });

  it("ne saute jamais le traitement, même si le demandeur y est désigné", () => {
    const own = directory({ president: [people.claire], treasurer: [people.claire] });
    expect(startCircuit(circuit(), people.claire, own).state).toEqual(running("treasurer"));
  });
});

describe("submissionProblems", () => {
  it("ne signale rien quand chaque étape a quelqu'un d'autre", () => {
    expect(submissionProblems(circuit(), people.lea, dir)).toEqual([]);
  });

  it("signale l'étape que le demandeur est seul à pouvoir décider (dispense décochée)", () => {
    const alone = directory({ president: [people.claire], treasurer: [people.tess] });
    const problems = submissionProblems(circuit({}, false), people.claire, alone);
    expect(problems).toMatchObject([{ nodeId: "president", code: "NO_VALIDATOR" }]);
    expect(problems[0]!.message).toContain("Accord du président");
  });

  it("ne signale pas l'étape dont le demandeur est dispensé", () => {
    const alone = directory({ president: [people.claire], treasurer: [people.tess] });
    expect(submissionProblems(circuit(), people.claire, alone)).toEqual([]);
  });

  it("signale un traitement que seul le demandeur peut faire, sauf si c'est autorisé", () => {
    const solo = directory({ president: [people.claire], treasurer: [people.tess] });
    expect(submissionProblems(circuit(), people.tess, solo)).toMatchObject([{ nodeId: "treasurer", code: "NO_PROCESSOR" }]);
    expect(submissionProblems(circuit({ allowSelfProcessing: true }), people.tess, solo)).toEqual([]);
  });
});

describe("decide", () => {
  it("accepte puis rembourse : la demande se termine", () => {
    const approved = decide(circuit(), running("president"), people.lea, { type: "APPROVE", actorId: people.paul }, dir);
    expect(approved.state).toEqual(running("treasurer"));
    expect(approved.decisions).toMatchObject([{ nodeId: "president", outcome: "APPROVED", actorId: people.paul }]);
    const done = decide(circuit(), approved.state, people.lea, { type: "PROCESS", actorId: people.tess }, dir);
    expect(done.state).toEqual({ status: "COMPLETED", currentNodeId: null, returnedFromNodeId: null });
    expect(done.decisions).toMatchObject([{ nodeId: "treasurer", outcome: "PROCESSED" }]);
  });

  it("valide d'office l'étape suivante quand le demandeur y est habilité (trésorière qui demande, président qui accepte)", () => {
    const base = circuit();
    const withTreasurerStep: Circuit = {
      ...base,
      nodes: [
        base.nodes[0]!,
        base.nodes[1]!,
        { id: "bureau", type: "APPROVAL", label: "Accord du bureau", approvers: [{ kind: "ROLE", id: ROLE_C }], requesterExempt: true },
        base.nodes[2]!,
        base.nodes[3]!,
      ],
      edges: [
        { from: "start", to: "president" },
        { from: "president", to: "bureau" },
        { from: "bureau", to: "treasurer" },
        { from: "treasurer", to: "end" },
      ],
    };
    const d = directory({ president: [people.claire], bureau: [people.tess], treasurer: [people.paul] });
    const approved = decide(withTreasurerStep, running("president"), people.tess, { type: "APPROVE", actorId: people.claire }, d);
    expect(approved.decisions.map((x) => x.outcome)).toEqual(["APPROVED", "AUTO_APPROVED"]);
    expect(approved.state).toEqual(running("treasurer"));
  });

  it("refuse l'accord d'une personne non désignée", () => {
    expect(() => decide(circuit(), running("president"), people.lea, { type: "APPROVE", actorId: people.tess }, dir)).toThrowError(
      expect.objectContaining({ code: "NOT_DESIGNATED" }),
    );
  });

  it("empêche de valider sa propre demande quand la dispense est décochée", () => {
    const c = circuit({}, false);
    expect(() => decide(c, running("president"), people.claire, { type: "APPROVE", actorId: people.claire }, dir)).toThrowError(expect.objectContaining({ code: "SELF_APPROVAL" }));
  });

  it("empêche de traiter sa propre demande par défaut, et l'autorise avec le réglage", () => {
    const own = directory({ president: [people.claire], treasurer: [people.tess] });
    expect(() => decide(circuit(), running("treasurer"), people.tess, { type: "PROCESS", actorId: people.tess }, own)).toThrowError(expect.objectContaining({ code: "SELF_PROCESSING" }));
    const allowed = decide(circuit({ allowSelfProcessing: true }), running("treasurer"), people.tess, { type: "PROCESS", actorId: people.tess }, own);
    expect(allowed.state.status).toBe("COMPLETED");
  });

  it("exige un message pour refuser et pour renvoyer", () => {
    expect(() => decide(circuit(), running("president"), people.lea, { type: "REFUSE", actorId: people.claire, message: " " }, dir)).toThrowError(expect.objectContaining({ code: "MESSAGE_REQUIRED" }));
    expect(() => decide(circuit(), running("president"), people.lea, { type: "RETURN", actorId: people.claire, message: "ok" }, dir)).toThrowError(expect.objectContaining({ code: "MESSAGE_REQUIRED" }));
    const refused = decide(circuit(), running("president"), people.lea, { type: "REFUSE", actorId: people.claire, message: "Hors budget cette année" }, dir);
    expect(refused.state.status).toBe("REFUSED");
    expect(refused.decisions[0]).toMatchObject({ outcome: "REFUSED", message: "Hors budget cette année" });
  });

  it("ne refuse pas au traitement mais renvoie pour correction", () => {
    expect(() => decide(circuit(), running("treasurer"), people.lea, { type: "REFUSE", actorId: people.tess, message: "Non merci" }, dir)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_DECISION" }));
    const returned = decide(circuit(), running("treasurer"), people.lea, { type: "RETURN", actorId: people.tess, message: "Le justificatif est illisible" }, dir);
    expect(returned.state).toEqual({ status: "RETURNED", currentNodeId: "treasurer", returnedFromNodeId: "treasurer" });
  });

  it("ne traite pas à une étape de validation ni n'accepte à celle de traitement", () => {
    expect(() => decide(circuit(), running("president"), people.lea, { type: "PROCESS", actorId: people.claire }, dir)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_DECISION" }));
    expect(() => decide(circuit(), running("treasurer"), people.lea, { type: "APPROVE", actorId: people.tess }, dir)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_DECISION" }));
  });

  it("n'accepte plus aucune décision sur une demande terminée", () => {
    const done: EngineState = { status: "COMPLETED", currentNodeId: null, returnedFromNodeId: null };
    expect(() => decide(circuit(), done, people.lea, { type: "APPROVE", actorId: people.claire }, dir)).toThrowError(expect.objectContaining({ code: "NOT_ACTIVE" }));
  });

  it("laisse seul le demandeur annuler, avec un motif", () => {
    expect(() => decide(circuit(), running("president"), people.lea, { type: "CANCEL", actorId: people.claire, message: "Plus utile" }, dir)).toThrowError(expect.objectContaining({ code: "NOT_REQUESTER" }));
    expect(() => decide(circuit(), running("president"), people.lea, { type: "CANCEL", actorId: people.lea }, dir)).toThrowError(expect.objectContaining({ code: "MESSAGE_REQUIRED" }));
    const cancelled = decide(circuit(), running("president"), people.lea, { type: "CANCEL", actorId: people.lea, message: "Je renonce" }, dir);
    expect(cancelled.state.status).toBe("CANCELLED");
  });

  it("n'accepte aucune décision d'étape tant que la demande attend une correction", () => {
    const returned: EngineState = { status: "RETURNED", currentNodeId: "president", returnedFromNodeId: "president" };
    expect(() => decide(circuit(), returned, people.lea, { type: "APPROVE", actorId: people.claire }, dir)).toThrowError(expect.objectContaining({ code: "NOT_CURRENT_STEP" }));
    // Le demandeur peut cependant l'annuler.
    expect(decide(circuit(), returned, people.lea, { type: "CANCEL", actorId: people.lea, message: "Finalement non" }, dir).state.status).toBe("CANCELLED");
  });
});

describe("resume", () => {
  const returned: EngineState = { status: "RETURNED", currentNodeId: "treasurer", returnedFromNodeId: "treasurer" };

  it("reprend à l'étape qui avait renvoyé la demande", () => {
    expect(resume(circuit(), returned, people.lea, dir, { restartFromFirst: false }).state).toEqual(running("treasurer"));
  });

  it("repart de la première étape si le montant, la date ou le projet ont changé", () => {
    const restarted = resume(circuit(), returned, people.lea, dir, { restartFromFirst: true });
    expect(restarted.state).toEqual(running("president"));
  });

  it("revalide d'office au redémarrage les étapes du demandeur", () => {
    const restarted = resume(circuit(), returned, people.claire, dir, { restartFromFirst: true });
    expect(restarted.state).toEqual(running("treasurer"));
    expect(restarted.decisions[0]).toMatchObject({ outcome: "AUTO_APPROVED", nodeId: "president" });
  });

  it("refuse de reprendre une demande qui n'a pas été renvoyée", () => {
    expect(() => resume(circuit(), running("president"), people.lea, dir, { restartFromFirst: false })).toThrowError(EngineError);
  });
});
