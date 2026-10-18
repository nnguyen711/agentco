#!/usr/bin/env node
/**
 * Creates a domain office for debit and credit card transformation work.
 *
 * The script is deliberately data-first: employees, skills, the baseline card
 * model, and the deterministic impact report are stored as ordinary office
 * files that the AgentCo UI and workers can inspect.
 *
 * Usage:
 *   npm run office:card -- --dir ./company create
 *   npm run office:card -- --dir ./company --source ./docs/cards.docx create
 *   npm run office:card -- --dir ./company analyze --request "Add instant virtual card issuance"
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { Company } from '../src/core/company.js';
import type { Office } from '../src/core/office.js';
import { writeNodeFile, type KnowledgeNode, type NodeType } from '../src/knowledge/node.js';

interface Options {
  action: 'create' | 'analyze';
  dir: string;
  office: string;
  request?: string;
  requestFile?: string;
  confluenceArm?: string;
  sources: string[];
}

interface Flow {
  id: string;
  label: string;
  stage: string;
  keywords: string[];
  systems: string[];
  controls: string[];
  depends_on: string[];
  outputs: string[];
}

interface CardFunction {
  id: string;
  label: string;
  flow_ids: string[];
  keywords: string[];
  systems: string[];
  change_surfaces: string[];
}

interface CardDomainModel {
  version: 1;
  domain: string;
  status: 'baseline_requires_validation';
  assumptions: string[];
  entities: Array<{ id: string; label: string; key_fields: string[] }>;
  systems: Array<{ id: string; label: string; responsibility: string }>; 
  flows: Flow[];
  functions: CardFunction[];
  analysis_rules: string[];
  change_categories: string[];
}

interface SourceRecord {
  input: string;
  stored_name?: string;
  extension?: string;
  status: 'loaded' | 'rejected';
  reason?: string;
}

const OFFICE_NAME = 'Debit and Credit Card Transformation Office';
const MODEL_FILE = 'artifacts/card-domain-model.yaml';
const SOURCE_FILE = 'artifacts/card-source-inventory.yaml';

const FLOWS: Flow[] = [
  {
    id: 'customer-intake',
    label: 'Customer intake and request capture',
    stage: 'front-office',
    keywords: ['customer', 'application', 'request', 'channel', 'branch', 'mobile', 'web'],
    systems: ['channel-platform', 'crm', 'customer-profile'],
    controls: ['consent', 'data-quality', 'access-control'],
    depends_on: [],
    outputs: ['application-record', 'consent-record'],
  },
  {
    id: 'eligibility-and-application',
    label: 'Eligibility, KYC, and application validation',
    stage: 'origination',
    keywords: ['eligibility', 'kyc', 'aml', 'identity', 'income', 'application', 'screening'],
    systems: ['customer-profile', 'kyc-service', 'decision-engine'],
    controls: ['kyc', 'aml', 'sanctions-screening', 'policy-versioning'],
    depends_on: ['customer-intake'],
    outputs: ['validated-application', 'eligibility-decision'],
  },
  {
    id: 'decision-and-account-opening',
    label: 'Credit decision and card account opening',
    stage: 'origination',
    keywords: ['credit', 'underwriting', 'limit', 'scoring', 'decision', 'account', 'approval', 'issuance', 'issue', 'instant', 'virtual', 'digital'],
    systems: ['decision-engine', 'card-management-system', 'core-banking'],
    controls: ['credit-policy', 'maker-checker', 'audit-trail'],
    depends_on: ['eligibility-and-application'],
    outputs: ['card-account', 'approved-limit', 'pricing-plan'],
  },
  {
    id: 'card-production-and-personalization',
    label: 'Card production, personalization, and secure key handling',
    stage: 'fulfillment',
    keywords: ['production', 'personalization', 'plastic', 'chip', 'emboss', 'hsm', 'key'],
    systems: ['card-management-system', 'card-personalization-bureau', 'hsm'],
    controls: ['pci-card-production', 'key-ceremony', 'dual-control'],
    depends_on: ['decision-and-account-opening'],
    outputs: ['personalized-card', 'shipment-request'],
  },
  {
    id: 'delivery-and-activation',
    label: 'Delivery, receipt, activation, and PIN setup',
    stage: 'fulfillment',
    keywords: ['delivery', 'courier', 'receipt', 'activation', 'pin', 'first-use'],
    systems: ['card-management-system', 'courier', 'notification-platform'],
    controls: ['delivery-verification', 'pin-security', 'customer-authentication'],
    depends_on: ['card-production-and-personalization'],
    outputs: ['active-card', 'activation-event'],
  },
  {
    id: 'transaction-authorization',
    label: 'Transaction authorization and real-time fraud controls',
    stage: 'transaction',
    keywords: ['purchase', 'authorization', 'decline', 'approve', 'fraud', 'pos', 'ecommerce', 'atm'],
    systems: ['card-network', 'authorization-switch', 'fraud-engine', 'core-banking'],
    controls: ['real-time-risk', 'velocity-limits', 'strong-customer-authentication'],
    depends_on: ['delivery-and-activation'],
    outputs: ['authorization-response', 'hold', 'fraud-alert'],
  },
  {
    id: 'clearing-and-settlement',
    label: 'Clearing, settlement, posting, and reconciliation',
    stage: 'transaction',
    keywords: ['clearing', 'settlement', 'posting', 'interchange', 'reconciliation', 'scheme', 'batch'],
    systems: ['card-network', 'settlement-platform', 'core-banking', 'general-ledger'],
    controls: ['four-eyes', 'nostro-reconciliation', 'financial-close'],
    depends_on: ['transaction-authorization'],
    outputs: ['posted-transaction', 'settlement-entry', 'reconciliation-break'],
  },
  {
    id: 'dispute-and-chargeback',
    label: 'Dispute, chargeback, representment, and recovery',
    stage: 'servicing',
    keywords: ['dispute', 'chargeback', 'representment', 'fraud-claim', 'refund', 'retrieval'],
    systems: ['case-management', 'card-network', 'core-banking', 'document-store'],
    controls: ['scheme-deadlines', 'evidence-retention', 'customer-complaint'],
    depends_on: ['clearing-and-settlement'],
    outputs: ['case', 'temporary-credit', 'final-disposition'],
  },
  {
    id: 'servicing-and-lifecycle',
    label: 'Servicing, replacement, blocking, fees, and lifecycle events',
    stage: 'servicing',
    keywords: ['block', 'unblock', 'replace', 'renew', 'expire', 'fee', 'interest', 'limit-change', 'service'],
    systems: ['card-management-system', 'crm', 'billing-engine', 'notification-platform'],
    controls: ['customer-authentication', 'fee-disclosure', 'operational-approval'],
    depends_on: ['delivery-and-activation'],
    outputs: ['card-status-change', 'replacement-order', 'fee-entry'],
  },
  {
    id: 'closure-and-retention',
    label: 'Closure, write-off, retention, and regulatory reporting',
    stage: 'end-of-life',
    keywords: ['close', 'cancel', 'write-off', 'retention', 'archive', 'reporting', 'regulatory'],
    systems: ['card-management-system', 'core-banking', 'general-ledger', 'regulatory-reporting'],
    controls: ['records-retention', 'privacy', 'regulatory-reporting', 'reconciliation'],
    depends_on: ['servicing-and-lifecycle', 'dispute-and-chargeback'],
    outputs: ['closed-account', 'retained-record', 'regulatory-report'],
  },
];

const FUNCTIONS: CardFunction[] = [
  { id: 'customer-onboarding', label: 'Customer onboarding and KYC', flow_ids: ['customer-intake', 'eligibility-and-application'], keywords: ['onboarding', 'kyc', 'identity', 'customer'], systems: ['customer-profile', 'kyc-service'], change_surfaces: ['journey', 'data-contract', 'controls', 'test-cases'] },
  { id: 'credit-underwriting', label: 'Credit underwriting and limit management', flow_ids: ['eligibility-and-application', 'decision-and-account-opening'], keywords: ['credit', 'underwriting', 'limit', 'score', 'risk'], systems: ['decision-engine', 'card-management-system'], change_surfaces: ['policy', 'decision-rules', 'pricing', 'model-monitoring'] },
  { id: 'card-account-master', label: 'Card account and card status master data', flow_ids: ['decision-and-account-opening', 'servicing-and-lifecycle', 'closure-and-retention'], keywords: ['account', 'card', 'status', 'product', 'replacement', 'renewal', 'issuance', 'virtual', 'digital'], systems: ['card-management-system', 'core-banking'], change_surfaces: ['state-machine', 'api', 'data-migration', 'operations'] },
  { id: 'card-production', label: 'Card production and personalization', flow_ids: ['card-production-and-personalization'], keywords: ['production', 'personalization', 'plastic', 'chip', 'hsm', 'key'], systems: ['card-personalization-bureau', 'hsm'], change_surfaces: ['vendor-interface', 'security', 'fulfillment', 'reconciliation'] },
  { id: 'activation-and-pin', label: 'Activation and PIN lifecycle', flow_ids: ['delivery-and-activation', 'servicing-and-lifecycle'], keywords: ['activation', 'pin', 'receipt', 'delivery'], systems: ['card-management-system', 'notification-platform'], change_surfaces: ['authentication', 'state-machine', 'customer-notification', 'support'] },
  { id: 'authorization-and-fraud', label: 'Authorization, fraud, and transaction controls', flow_ids: ['transaction-authorization'], keywords: ['authorization', 'transaction', 'fraud', 'decline', 'pos', 'atm', 'ecommerce'], systems: ['authorization-switch', 'fraud-engine', 'card-network'], change_surfaces: ['latency', 'rules', 'routing', 'monitoring', 'customer-messaging'] },
  { id: 'clearing-settlement-accounting', label: 'Clearing, settlement, and debit-credit accounting', flow_ids: ['clearing-and-settlement'], keywords: ['clearing', 'settlement', 'interchange', 'posting', 'reconciliation', 'accounting'], systems: ['settlement-platform', 'general-ledger', 'core-banking'], change_surfaces: ['batch', 'journal-mapping', 'reconciliation', 'finance-controls'] },
  { id: 'dispute-operations', label: 'Dispute and chargeback operations', flow_ids: ['dispute-and-chargeback'], keywords: ['dispute', 'chargeback', 'representment', 'refund', 'evidence'], systems: ['case-management', 'document-store', 'card-network'], change_surfaces: ['case-state-machine', 'sla', 'evidence', 'customer-communication'] },
  { id: 'fees-interest', label: 'Fees, interest, and billing', flow_ids: ['servicing-and-lifecycle', 'clearing-and-settlement'], keywords: ['fee', 'interest', 'billing', 'statement', 'pricing'], systems: ['billing-engine', 'core-banking', 'general-ledger'], change_surfaces: ['pricing', 'calculation', 'disclosure', 'accounting'] },
  { id: 'reporting-and-retention', label: 'Reporting, privacy, and record retention', flow_ids: ['closure-and-retention', 'dispute-and-chargeback'], keywords: ['reporting', 'regulatory', 'privacy', 'retention', 'archive'], systems: ['regulatory-reporting', 'document-store', 'general-ledger'], change_surfaces: ['data-lineage', 'retention', 'access', 'control-evidence'] },
];

const ROLES = [
  {
    id: 'card-knowledge-librarian',
    displayName: 'Card Knowledge Librarian',
    avatar: 'L',
    tier: 'standard',
    pitch: 'Reads Confluence pages and Word/Excel evidence, records source lineage, and turns documents into searchable card-domain knowledge.',
    goodAt: ['Confluence page reading through an approved connector', 'DOCX and XLSX evidence extraction', 'source cataloguing', 'terminology normalization'],
    notFor: ['inventing policy when evidence is missing', 'approving production changes'],
    skill: `You are the evidence librarian for a debit and credit card transformation office.

Read Confluence pages through the approved connected service when available. Read DOCX and XLSX from the office library using the extracted text copies and preserve the original file name, page, sheet, row, or cell when citing evidence. Never treat a document summary as authoritative without a source reference.

For every finding, separate facts, assumptions, conflicts, and open questions. Normalize synonyms such as card account, PAN, token, authorization, clearing, settlement, dispute, chargeback, debit, and credit without erasing the source wording. Build a compact glossary and link each term to the relevant flow and function.

If a connector or file is unavailable, report the missing evidence and continue with clearly labelled assumptions.`,
  },
  {
    id: 'card-process-architect',
    displayName: 'Card Process Architect',
    avatar: 'P',
    tier: 'deep',
    pitch: 'Maps end-to-end debit and credit card journeys, state transitions, system handoffs, controls, and process dependencies.',
    goodAt: ['card lifecycle mapping', 'BPMN-like flow decomposition', 'system and control mapping', 'process gap analysis'],
    notFor: ['changing source documents', 'making unsupported regulatory claims'],
    skill: `You are the process architect for debit and credit cards.

Maintain the canonical lifecycle from customer intake through eligibility, decision, account opening, production, delivery, activation, authorization, clearing, settlement, disputes, servicing, closure, and reporting. For each flow, identify trigger, actor, preconditions, state changes, systems, data objects, controls, exceptions, SLAs, and outputs.

Treat debit and credit as related but distinct variants. Flag where a debit flow depends on deposit-account availability and authorization balance, while a credit flow depends on credit limit, billing, interest, and repayment. Never collapse those differences into one generic flow.

When evidence conflicts, preserve both versions, identify the decision owner, and create a validation question instead of silently choosing one.`,
  },
  {
    id: 'card-impact-analyst',
    displayName: 'Card Impact Analyst',
    avatar: 'I',
    tier: 'deep',
    pitch: 'Evaluates a new requirement against the card flow graph and returns affected journeys, functions, systems, controls, data, tests, and decisions.',
    goodAt: ['impact analysis', 'dependency tracing', 'change-surface identification', 'analysis planning'],
    notFor: ['estimating delivery dates without evidence', 'declaring a change safe without control review'],
    skill: `You are the impact analyst for a debit and credit card domain model.

Start with the requirement intent, affected product variant, channel, lifecycle state, transaction type, and timing. Match explicit terms to the canonical flow graph, then traverse upstream prerequisites and downstream consumers. Distinguish direct impact from dependency impact and possible impact.

Your report must contain: impacted flows; affected functions; systems and interfaces; data and state changes; accounting and reconciliation consequences; controls and compliance review; operational and customer journeys; test scenarios; source evidence; assumptions; and unanswered questions.

Use this order: clarify, locate, trace, assess, validate, recommend. Do not jump from a keyword to a solution. If the model has no matching evidence, say that the result is a screening hypothesis and ask for the missing source or process owner.`,
  },
  {
    id: 'card-product-owner',
    displayName: 'Card Product Owner',
    avatar: 'O',
    tier: 'standard',
    pitch: 'Clarifies card product requirements, customer outcomes, variants, acceptance criteria, and prioritization across debit and credit products.',
    goodAt: ['requirement discovery', 'product rules', 'customer journeys', 'acceptance criteria'],
    notFor: ['technical design approval', 'replacing risk or finance sign-off'],
    skill: `You are the card product owner.

Clarify whether a request applies to debit, credit, prepaid, virtual, physical, supplementary, or corporate cards. Capture customer segment, channel, geography, lifecycle state, transaction type, limits, fees, billing, notifications, and expected outcome. Convert ambiguity into explicit questions and acceptance criteria.

Keep business intent separate from implementation choice. Mark any requirement that can alter customer disclosure, authorization behavior, posting, fees, interest, dispute rights, or regulatory reporting as cross-functional.`,
  },
  {
    id: 'card-risk-controls-reviewer',
    displayName: 'Card Risk and Controls Reviewer',
    avatar: 'R',
    tier: 'standard',
    pitch: 'Reviews fraud, KYC/AML, PCI, authentication, scheme, privacy, accounting, and operational control consequences of card changes.',
    goodAt: ['control mapping', 'risk scenarios', 'audit evidence', 'segregation of duties'],
    notFor: ['waiving a control because a change is small', 'giving legal advice without a cited policy'],
    skill: `You are the risk and controls reviewer for card change analysis.

Review KYC and AML, customer authentication, fraud controls, PCI-sensitive handling, key management, scheme obligations, privacy, access control, maker-checker, reconciliation, complaints, and records retention. Map each control to the affected step and identify control owner, evidence, frequency, and failure response.

Separate policy evidence from general industry practice. Escalate any unresolved conflict to the named policy or compliance owner. Include negative paths: decline, timeout, duplicate, reversal, partial settlement, fraud claim, lost card, failed delivery, and reconciliation break.`,
  },
];

function model(): CardDomainModel {
  return {
    version: 1,
    domain: 'Debit and credit card transformation',
    status: 'baseline_requires_validation',
    assumptions: [
      'This is a reusable baseline model, not a bank-specific operating procedure.',
      'Actual policies, scheme rules, product variants, system names, and ownership must be validated from source evidence.',
      'Debit and credit share lifecycle stages but diverge in funding, limits, billing, interest, and repayment behavior.',
    ],
    entities: [
      { id: 'customer', label: 'Customer', key_fields: ['customer_id', 'segment', 'consents', 'risk_profile'] },
      { id: 'card-account', label: 'Card account', key_fields: ['account_id', 'product', 'status', 'limit_or_balance', 'billing_cycle'] },
      { id: 'card', label: 'Card instrument', key_fields: ['pan_token', 'card_type', 'status', 'expiry', 'wallet_tokens'] },
      { id: 'transaction', label: 'Card transaction', key_fields: ['transaction_id', 'amount', 'currency', 'merchant', 'authorization_state', 'posting_state'] },
      { id: 'case', label: 'Dispute or service case', key_fields: ['case_id', 'reason', 'sla', 'evidence', 'disposition'] },
      { id: 'journal-entry', label: 'Accounting entry', key_fields: ['entry_id', 'debit_account', 'credit_account', 'amount', 'posting_date', 'reconciliation_status'] },
    ],
    systems: [
      { id: 'channel-platform', label: 'Channel platform', responsibility: 'Captures applications and service requests.' },
      { id: 'card-management-system', label: 'Card management system', responsibility: 'Owns card product, card status, lifecycle, and card-account operations.' },
      { id: 'authorization-switch', label: 'Authorization switch', responsibility: 'Routes and responds to real-time transaction authorization.' },
      { id: 'card-network', label: 'Card network', responsibility: 'Carries authorization, clearing, settlement, and scheme dispute messages.' },
      { id: 'core-banking', label: 'Core banking', responsibility: 'Holds deposit or lending balances and customer financial postings.' },
      { id: 'general-ledger', label: 'General ledger', responsibility: 'Receives controlled accounting entries and reconciliation status.' },
      { id: 'fraud-engine', label: 'Fraud engine', responsibility: 'Scores transactions and raises risk actions.' },
      { id: 'decision-engine', label: 'Decision engine', responsibility: 'Evaluates eligibility, underwriting, and credit policy.' },
    ],
    flows: FLOWS,
    functions: FUNCTIONS,
    analysis_rules: [
      'Direct impact: the requirement explicitly names a flow, function, system, state, product, or control.',
      'Dependency impact: an upstream prerequisite or downstream consumer is connected to a directly impacted node.',
      'Possible impact: the term is ambiguous or evidence is missing; return a validation question instead of asserting scope.',
      'Always inspect customer journey, operational journey, system interface, data/state, accounting/reconciliation, controls, and tests.',
      'Never mark a change complete until source evidence and owner sign-off are attached.',
    ],
    change_categories: ['customer-journey', 'process-and-state', 'system-and-interface', 'data-and-privacy', 'risk-and-controls', 'accounting-and-reconciliation', 'operations', 'testing-and-monitoring', 'reporting-and-retention'],
  };
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string[]>();
  let action: Options['action'] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === 'create' || arg === 'analyze') {
      action = arg;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i++;
    const list = values.get(key) ?? [];
    list.push(next);
    values.set(key, list);
  }
  const first = (key: string, fallback = '') => values.get(key)?.[0] ?? fallback;
  const dir = path.resolve(first('dir', process.env['AGENTCO_COMPANY_DIR'] ?? path.join(process.cwd(), 'company')));
  const sources = values.get('source') ?? [];
  return {
    action: action ?? 'create',
    dir,
    office: first('office', OFFICE_NAME),
    request: first('request') || undefined,
    requestFile: first('request-file') || undefined,
    confluenceArm: first('confluence-arm') || undefined,
    sources: sources.map((source) => path.resolve(source)),
  };
}

function writeRole(officeDir: string, role: (typeof ROLES)[number], confluenceArm?: string): void {
  const roleFile = path.join(officeDir, 'roles', `${role.id}.yaml`);
  const roleData = {
    id: role.id,
    version: 1,
    display_name: role.displayName,
    avatar: role.avatar,
    pitch: role.pitch,
    good_at: role.goodAt,
    not_for: role.notFor,
    skill_level: 'medium',
    skills: { medium: `skills/${role.id}.md` },
    tools: [],
    mcp: role.id === 'card-knowledge-librarian' && confluenceArm ? [confluenceArm] : [],
    connectors: [],
    secrets: [],
    model_tier: role.tier,
    use_preset: false,
    budget: { max_turns: role.tier === 'deep' ? 10 : 15, max_usd: role.tier === 'deep' ? 10 : 5, knowledge_pack: 3000 },
  };
  fs.writeFileSync(roleFile, YAML.stringify(roleData, { lineWidth: 0 }), 'utf8');
  fs.writeFileSync(path.join(officeDir, 'skills', `${role.id}.md`), role.skill.trim() + '\n', 'utf8');
}

function makeNode(officeDir: string, id: string, type: NodeType, title: string, tags: string[], body: string, source?: string): void {
  const node: KnowledgeNode = {
    id,
    type,
    title,
    tags,
    links: [],
    scope: 'shared',
    author: 'card-office-bootstrap',
    confidence: 0.55,
    hits: 0,
    pinned: true,
    supersedes: [],
    updated: new Date().toISOString().slice(0, 10),
    ...(source ? { source } : {}),
    body: body.trim(),
    tokens: 0,
    file: `knowledge/shared/card/${id}.md`,
  };
  writeNodeFile(officeDir, node);
}

function writeKnowledge(officeDir: string, domain: CardDomainModel): void {
  makeNode(officeDir, 'card-domain-baseline', 'reference', 'Debit and credit card domain baseline', ['card', 'debit', 'credit', 'lifecycle'], `The office starts with a baseline only. Validate every product rule, system name, control, and owner against bank evidence before treating it as authoritative.

Entities: ${domain.entities.map((entity) => entity.label).join(', ')}.

Canonical flow order:
${domain.flows.map((flow, index) => `${index + 1}. ${flow.label} (${flow.id})`).join('\n')}

The baseline intentionally keeps debit and credit together at lifecycle level and separates funding, limits, billing, interest, and repayment questions for analysis.`);

  for (const flow of domain.flows) {
    makeNode(officeDir, `flow-${flow.id}`, 'playbook', flow.label, ['card-flow', flow.stage, ...flow.keywords], `Flow id: ${flow.id}

Purpose: ${flow.label}.

Systems: ${flow.systems.join(', ')}.
Controls to validate: ${flow.controls.join(', ')}.
Inputs and outputs: ${flow.outputs.join(', ')}.
Upstream dependencies: ${flow.depends_on.length ? flow.depends_on.join(', ') : 'none'}.

Analysis rule: when a requirement touches this flow, inspect the trigger, actor, preconditions, state changes, handoffs, exceptions, SLA, customer communication, evidence, and downstream reconciliation.`);
  }

  makeNode(officeDir, 'card-impact-analysis-method', 'playbook', 'Card requirement impact analysis method', ['impact-analysis', 'change', 'traceability'], `For each new request:

1. Clarify product variant: debit, credit, prepaid, virtual, physical, supplementary, or corporate.
2. Clarify channel, customer segment, geography, lifecycle state, transaction type, and timing.
3. Locate direct matches in the card flow and function graph.
4. Trace upstream prerequisites and downstream consumers.
5. Assess nine change categories: customer journey; process and state; system and interface; data and privacy; risk and controls; accounting and reconciliation; operations; testing and monitoring; reporting and retention.
6. Attach source evidence from Confluence, DOCX, XLSX, policies, scheme material, and system contracts.
7. Return direct impact, dependency impact, possible impact, owners, decisions, and unanswered questions.

A keyword match is a screening signal, not a final scope decision. Missing evidence must remain visible.`);

  makeNode(officeDir, 'card-source-evidence-rules', 'policy', 'Card source evidence rules', ['evidence', 'confluence', 'docx', 'xlsx'], `Source handling rules:

- Confluence: cite page title, URL, space, version or updated date, and the exact section.
- DOCX: cite file name, heading, paragraph, and table when applicable.
- XLSX: cite file name, sheet, header row, and cell or row range.
- Preserve conflicting versions instead of overwriting one with another.
- Separate fact, assumption, interpretation, and decision.
- Never copy secrets, PAN, PIN, CVV, authentication data, or production credentials into knowledge notes.
- Mask customer and transaction identifiers in working artifacts.`);
}

function writeAssistantContext(officeDir: string): void {
  fs.writeFileSync(path.join(officeDir, 'charter.md'), `This office maps and improves debit and credit card journeys. It is evidence-led, separates product intent from implementation, and keeps debit and credit differences explicit. Every change analysis must trace customer impact, process state, system handoffs, data, controls, accounting, operations, testing, and regulatory reporting. Baseline knowledge is a hypothesis until validated against bank-owned sources.\n`, 'utf8');
  fs.writeFileSync(path.join(officeDir, 'skills', 'assistant.md'), `Route document evidence to the librarian, lifecycle and system mapping to the process architect, requirement ambiguity to the product owner, impact tracing to the impact analyst, and control questions to the risk reviewer. For a new request, ask for the product variant and locate the request in the card flow before assigning implementation work. Keep source evidence, assumptions, and decisions visibly separate.\n`, 'utf8');
}

function writeLayoutModel(officeDir: string, domain: CardDomainModel): void {
  const artifact = {
    ...domain,
    generated_by: 'create-card-office.ts',
    generated_at: new Date().toISOString(),
    graph: {
      nodes: domain.flows.map((flow) => ({ id: flow.id, kind: 'flow', label: flow.label })),
      edges: domain.flows.flatMap((flow) => flow.depends_on.map((dependency) => ({ from: dependency, to: flow.id }))),
    },
  };
  fs.mkdirSync(path.join(officeDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(officeDir, 'artifacts', 'card-domain-model.yaml'), YAML.stringify(artifact, { lineWidth: 0 }), 'utf8');
}

function loadSources(office: Office, sources: string[]): SourceRecord[] {
  if (sources.length === 0) return [];
  const records: SourceRecord[] = [];
  const maxBytes = Math.round(office.loaded.company.library.max_file_mb * 1024 * 1024);
  for (const source of sources) {
    try {
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error('source is not a file');
      const storedName = path.basename(source);
      office.addDocument(storedName, fs.readFileSync(source), { replace: true, maxBytes });
      records.push({ input: source, stored_name: storedName, extension: path.extname(storedName).slice(1).toLowerCase(), status: 'loaded' });
    } catch (err) {
      records.push({ input: source, status: 'rejected', reason: err instanceof Error ? err.message : String(err) });
    }
  }
  fs.writeFileSync(path.join(office.loaded.dir, SOURCE_FILE), YAML.stringify({ generated_at: new Date().toISOString(), sources: records }, { lineWidth: 0 }), 'utf8');
  return records;
}

function tokensOf(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').split(/\s+/).filter((token) => token.length > 2));
}

function analyze(domain: CardDomainModel, request: string): Record<string, unknown> {
  const requestTokens = tokensOf(request);
  const score = (keywords: string[]) => keywords.reduce((sum, keyword) => sum + (requestTokens.has(keyword) ? 1 : 0), 0);
  const directFlows = domain.flows.filter((flow) => score(flow.keywords) > 0);
  const directFunctions = domain.functions.filter((fn) => score(fn.keywords) > 0);
  const flowIds = new Set(directFlows.map((flow) => flow.id));
  for (const fn of directFunctions) for (const flowId of fn.flow_ids) flowIds.add(flowId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const flow of domain.flows) {
      if (!flowIds.has(flow.id)) continue;
      for (const dependency of flow.depends_on) {
        if (!flowIds.has(dependency)) {
          flowIds.add(dependency);
          changed = true;
        }
      }
    }
  }
  const impactedFlows = domain.flows.filter((flow) => flowIds.has(flow.id));
  const impactedFunctions = domain.functions.filter((fn) => fn.flow_ids.some((flowId) => flowIds.has(flowId)));
  const systems = [...new Set(impactedFlows.flatMap((flow) => flow.systems).concat(impactedFunctions.flatMap((fn) => fn.systems)))].sort();
  const controls = [...new Set(impactedFlows.flatMap((flow) => flow.controls))].sort();
  const changeSurfaces = [...new Set(impactedFunctions.flatMap((fn) => fn.change_surfaces))].sort();
  const questions = [
    'Which product variant is affected: debit, credit, prepaid, virtual, physical, supplementary, or corporate?',
    'Which channel, customer segment, geography, and lifecycle state are in scope?',
    'Does the request change authorization, posting, fees, interest, billing, settlement, dispute, or reporting?',
    'Which bank-owned source and process owner confirm the current behavior?',
  ];
  return {
    generated_at: new Date().toISOString(),
    request,
    confidence: directFlows.length || directFunctions.length ? 'screening' : 'unmatched_needs_clarification',
    direct_matches: {
      flows: directFlows.map((flow) => ({ id: flow.id, label: flow.label, keyword_score: score(flow.keywords) })),
      functions: directFunctions.map((fn) => ({ id: fn.id, label: fn.label, keyword_score: score(fn.keywords) })),
    },
    impacted_flows: impactedFlows.map((flow) => ({ id: flow.id, label: flow.label, impact: directFlows.includes(flow) ? 'direct_or_keyword' : 'dependency' })),
    impacted_functions: impactedFunctions.map((fn) => ({ id: fn.id, label: fn.label, flow_ids: fn.flow_ids })),
    systems,
    controls_to_review: controls,
    change_surfaces: changeSurfaces,
    analysis_plan: ['Clarify product and lifecycle scope', 'Validate current state from evidence', 'Trace upstream and downstream dependencies', 'Review controls and accounting', 'Define negative-path and regression tests', 'Obtain owner decisions and record assumptions'],
    questions,
    source_policy: 'Attach Confluence, DOCX, XLSX, policy, scheme, and system-contract evidence before implementation approval.',
  };
}

function requireCompany(dir: string): Company {
  if (!fs.existsSync(path.join(dir, 'company.yaml'))) {
    throw new Error(`No company.yaml at ${dir}. Run agentco init --dir "${dir}" first.`);
  }
  return Company.open(dir);
}

function createOffice(options: Options): void {
  const company = requireCompany(options.dir);
  if (options.confluenceArm && !(options.confluenceArm in company.config.mcpServers)) {
    throw new Error(`MCP server "${options.confluenceArm}" is not declared in company.yaml.`);
  }
  const existing = company.list().find((entry) => entry.name === options.office);
  const office = existing ? company.get(existing.id) : company.createOffice({ name: options.office });
  if (existing) console.log(`Using existing office: ${office.id}`);
  for (const role of ROLES) {
    if (!office.loaded.roles.has(role.id)) office.addAgent({ id: role.id, display_name: role.displayName, pitch: role.pitch, tier: role.tier });
    writeRole(office.loaded.dir, role, options.confluenceArm);
  }
  writeAssistantContext(office.loaded.dir);
  const domain = model();
  writeKnowledge(office.loaded.dir, domain);
  writeLayoutModel(office.loaded.dir, domain);
  office.reload();
  const sourceRecords = loadSources(office, options.sources);
  console.log(JSON.stringify({ office: office.id, directory: office.loaded.dir, employees: ROLES.map((role) => role.id), flows: domain.flows.length, functions: domain.functions.length, sources: sourceRecords }, null, 2));
}

function analyzeRequest(options: Options): void {
  const company = requireCompany(options.dir);
  const entry = company.list().find((item) => item.name === options.office);
  if (!entry) throw new Error(`Office not found: ${options.office}. Run the create action first.`);
  const office = company.get(entry.id);
  const request = options.request ?? (options.requestFile ? fs.readFileSync(path.resolve(options.requestFile), 'utf8').trim() : '');
  if (!request) throw new Error('Provide --request "..." or --request-file <path>.');
  const modelFile = path.join(office.loaded.dir, 'artifacts', 'card-domain-model.yaml');
  if (!fs.existsSync(modelFile)) throw new Error(`Missing ${modelFile}. Run the create action first.`);
  const domain = YAML.parse(fs.readFileSync(modelFile, 'utf8')) as CardDomainModel;
  const report = analyze(domain, request);
  const output = path.join(office.loaded.dir, 'artifacts', `impact-assessment-${Date.now()}.yaml`);
  fs.writeFileSync(output, YAML.stringify(report, { lineWidth: 0 }), 'utf8');
  console.log(JSON.stringify({ office: office.id, report: output, ...report }, null, 2));
}

const options = parseOptions(process.argv.slice(2));
try {
  if (options.action === 'create') createOffice(options);
  else analyzeRequest(options);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
