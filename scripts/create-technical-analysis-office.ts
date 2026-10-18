#!/usr/bin/env node
/**
 * Creates and runs a technical analysis office for BRD/FRS to Jira delivery.
 *
 * The office separates evidence reading, requirements analysis, solution design,
 * story writing, and Jira publication. Analysis never publishes automatically;
 * the publish action is an explicit second step.
 *
 * Usage:
 *   npm run office:technical -- --dir ./company create
 *   npm run office:technical -- --dir ./company --source ./docs/BRD.docx analyze --request "..."
 *   npm run office:technical -- --dir ./company publish
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { Company } from '../src/core/company.js';
import type { Office } from '../src/core/office.js';
import { writeNodeFile, type KnowledgeNode, type NodeType } from '../src/knowledge/node.js';

interface Options {
  action: 'create' | 'analyze' | 'publish';
  dir: string;
  office: string;
  request?: string;
  requestFile?: string;
  atlassianArm?: string;
  confluenceArm?: string;
  jiraArm?: string;
  sources: string[];
}

interface SourceRecord {
  input: string;
  stored_name?: string;
  extension?: string;
  status: 'loaded' | 'rejected';
  reason?: string;
}

interface WorkflowStep {
  id: string;
  label: string;
  owner: string;
  output: string;
}

interface TechnicalAnalysisModel {
  version: 1;
  domain: string;
  status: 'baseline_requires_validation';
  workflow: WorkflowStep[];
  epic_fields: string[];
  story_fields: string[];
  acceptance_criteria_format: string;
  source_evidence_rules: string[];
  publish_rules: string[];
}

const OFFICE_NAME = 'Technical Analysis Office';
const MODEL_FILE = 'artifacts/technical-analysis-model.yaml';
const SOURCE_FILE = 'artifacts/technical-source-inventory.yaml';

const ROLES = [
  {
    id: 'technical-document-librarian',
    displayName: 'Technical Document Librarian',
    avatar: 'L',
    tier: 'standard',
    pitch: 'Reads BRD, FRS, and Confluence evidence, preserving exact source lineage for every requirement.',
    goodAt: ['BRD and FRS evidence extraction', 'Confluence page reading', 'source lineage', 'conflict detection'],
    notFor: ['inventing requirements', 'publishing Jira issues', 'approving implementation choices'],
    skill: `You are the evidence librarian for a technical analysis office.

Read the exact BRD and FRS files named in the task from the office document cabinet. When the approved Atlassian connection is available, read the relevant Confluence pages and preserve page title, URL, space, version, updated date, and exact section. Use the original document when extracted text is insufficient.

For every fact, record its source reference. Separate facts, assumptions, conflicts, decisions, and unanswered questions. Never silently choose between conflicting versions. Do not invent a requirement to fill a gap, and never copy credentials, secrets, customer identifiers, or payment data into an artifact.

    Return a concise evidence index that the requirements analyst can trace back to the source. Write it to the exact output path supplied in the task brief. Never invent a root path under artifacts/ or write outside the office.`,
  },
  {
    id: 'technical-requirements-analyst',
    displayName: 'Technical Requirements Analyst',
    avatar: 'A',
    tier: 'deep',
    pitch: 'Converts source evidence into scoped epics, requirements, dependencies, assumptions, and traceable user stories.',
    goodAt: ['requirements decomposition', 'scope boundaries', 'business rules', 'traceability'],
    notFor: ['guessing missing behavior', 'writing production code', 'publishing without review'],
    skill: `You are the requirements analyst for a technical delivery office.

Read the librarian evidence and the source documents before making a proposal. Identify the business outcome, actors, system boundaries, in-scope behavior, out-of-scope behavior, business rules, non-functional requirements, dependencies, risks, assumptions, and decisions required from an owner.

Decompose the request into one coherent epic and implementation-sized user stories. Every story must point to source evidence or be explicitly marked as an assumption. Keep unresolved ambiguity as an open question instead of converting it into a made-up acceptance criterion.

    A story is ready only when its value, scope, acceptance criteria, dependencies, source references, and open questions are visible. Write the requirements map to the exact output path supplied in the task brief. Never invent a root path under artifacts/ or write outside the office.`,
  },
  {
    id: 'solution-architect',
    displayName: 'Solution Architect',
    avatar: 'S',
    tier: 'deep',
    pitch: 'Maps systems, interfaces, data, security, migration, observability, and technical dependencies behind each story.',
    goodAt: ['system context', 'API and event contracts', 'data impact', 'non-functional design'],
    notFor: ['overriding product intent', 'closing an unresolved policy question', 'claiming a design is approved'],
    skill: `You are the solution architect for a technical analysis office.

For each proposed story, identify the affected systems, interfaces, data objects, state transitions, permissions, failure modes, observability, migration or rollout needs, and test environments. Distinguish confirmed architecture from a proposal. Use source citations for existing behavior and label design assumptions explicitly.

    Call out dependency order and cross-team ownership. Include negative paths, idempotency, retries, auditability, privacy, security, and operational support where relevant. Do not turn a missing technical decision into a silent default. Write the technical impact map to the exact output path supplied in the task brief. Never invent a root path under artifacts/ or write outside the office.`,
  },
  {
    id: 'user-story-engineer',
    displayName: 'User Story Engineer',
    avatar: 'U',
    tier: 'standard',
    pitch: 'Writes Jira-ready epics and user stories with clear scope, Given/When/Then acceptance criteria, and traceability.',
    goodAt: ['epic framing', 'user story slicing', 'acceptance criteria', 'definition of ready'],
    notFor: ['fabricating source references', 'duplicating existing Jira work', 'publishing issues'],
    skill: `You are the user story engineer.

Create one Jira epic for the coherent outcome and slice it into independently understandable user stories. Each story must include: title; user/value statement; description; acceptance criteria in Given/When/Then form; priority; labels; dependencies; affected systems; source references; assumptions; open questions; and a definition-of-done checklist.

    Acceptance criteria must be observable and testable. Cover success, validation failure, authorization failure, timeout or retry, duplicate request, audit evidence, and operational visibility when applicable. Avoid technical task lists disguised as user stories. Do not create Jira issues yourself; produce the structured backlog draft for review. Write it to the exact output path supplied in the task brief. Never invent a root path under artifacts/ or write outside the office.`,
  },
  {
    id: 'jira-delivery-manager',
    displayName: 'Jira Delivery Manager',
    avatar: 'J',
    tier: 'standard',
    pitch: 'Validates the backlog draft and creates the approved epic and stories in Jira with parent links and a publish receipt.',
    goodAt: ['Jira issue creation', 'parent-child linking', 'duplicate checks', 'publish receipts'],
    notFor: ['changing approved scope silently', 'publishing an unreviewed draft', 'claiming success without Jira evidence'],
    skill: `You are the Jira delivery manager.

    Only act on the explicit publish action. Read the approved technical backlog from the task input path produced by the user story engineer in this same plan. Never search for or depend on a root artifact or a result from an earlier run. Validate that it has one epic and complete stories, and identify missing evidence or unresolved approval gates before using the Jira MCP connection. Check for likely duplicate issues using the available Jira search capability.

    Create the epic first, then create stories with the epic parent or the project's supported parent field. Preserve labels, priority, acceptance criteria, dependencies, source references, and owners. Never invent a Jira key or URL. Record the exact Jira response, created keys, URLs, skipped items, and failures in a publish receipt at the exact output path supplied in the task brief. If a tool call fails, report the failure and do not claim partial success as complete.`,
  },
];

function model(): TechnicalAnalysisModel {
  return {
    version: 1,
    domain: 'BRD and FRS technical analysis to Jira delivery',
    status: 'baseline_requires_validation',
    workflow: [
      { id: 'read-evidence', label: 'Read BRD, FRS, and Confluence evidence', owner: 'technical-document-librarian', output: 'evidence index' },
      { id: 'analyze-requirements', label: 'Analyze scope, rules, dependencies, and gaps', owner: 'technical-requirements-analyst', output: 'requirements map' },
      { id: 'design-impact', label: 'Map systems, data, interfaces, and controls', owner: 'solution-architect', output: 'technical impact map' },
      { id: 'write-backlog', label: 'Write one epic and Jira-ready user stories', owner: 'user-story-engineer', output: 'technical backlog draft' },
      { id: 'publish-jira', label: 'Publish the approved draft to Jira', owner: 'jira-delivery-manager', output: 'Jira publish receipt' },
    ],
    epic_fields: ['summary', 'goal', 'description', 'scope', 'out_of_scope', 'source_references', 'risks', 'dependencies', 'open_questions'],
    story_fields: ['summary', 'as_a', 'i_want', 'so_that', 'description', 'acceptance_criteria', 'priority', 'labels', 'dependencies', 'affected_systems', 'source_references', 'assumptions', 'open_questions', 'definition_of_done'],
    acceptance_criteria_format: 'Given/When/Then, with observable outcomes and negative paths where relevant',
    source_evidence_rules: [
      'Every requirement and acceptance criterion must cite a BRD, FRS, or Confluence source, or be labelled as an assumption.',
      'Preserve conflicting source versions and escalate the decision owner.',
      'Separate facts, interpretations, proposals, and decisions.',
      'Never copy secrets, credentials, payment data, or customer identifiers into Jira.',
    ],
    publish_rules: [
      'Analysis does not publish to Jira.',
      'Publishing requires the explicit publish action and an approved backlog draft.',
      'Create the epic before child stories and preserve parent links.',
      'Record Jira keys, URLs, skipped items, and failures in a receipt.',
    ],
  };
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string[]>();
  let action: Options['action'] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === 'create' || arg === 'analyze' || arg === 'publish') {
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
  const atlassianArm = first('atlassian-arm') || undefined;
  return {
    action: action ?? 'create',
    dir,
    office: first('office', OFFICE_NAME),
    request: first('request') || undefined,
    requestFile: first('request-file') || undefined,
    atlassianArm,
    confluenceArm: first('confluence-arm') || atlassianArm,
    jiraArm: first('jira-arm') || atlassianArm,
    sources: (values.get('source') ?? []).map((source) => path.resolve(source)),
  };
}

function writeRole(officeDir: string, role: (typeof ROLES)[number], existing?: { mcp: string[]; secrets: string[] }): void {
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
    mcp: existing?.mcp ?? [],
    connectors: [],
    secrets: existing?.secrets ?? [],
    model_tier: role.tier,
    use_preset: false,
    budget: { max_turns: role.tier === 'deep' ? 12 : 15, max_usd: role.tier === 'deep' ? 12 : 5, knowledge_pack: 3500 },
  };
  fs.writeFileSync(roleFile, YAML.stringify(roleData, { lineWidth: 0 }), 'utf8');
  fs.writeFileSync(path.join(officeDir, 'skills', `${role.id}.md`), role.skill.trim() + '\n', 'utf8');
}

function makeNode(officeDir: string, id: string, type: NodeType, title: string, tags: string[], body: string): void {
  const node: KnowledgeNode = {
    id,
    type,
    title,
    tags,
    links: [],
    scope: 'shared',
    author: 'technical-analysis-office-bootstrap',
    confidence: 0.75,
    hits: 0,
    pinned: true,
    supersedes: [],
    updated: new Date().toISOString().slice(0, 10),
    source: 'technical-analysis-office-baseline',
    body: body.trim(),
    tokens: 0,
    file: `knowledge/shared/technical-analysis/${id}.md`,
  };
  writeNodeFile(officeDir, node);
}

function writeKnowledge(officeDir: string): void {
  makeNode(officeDir, 'technical-analysis-workflow', 'playbook', 'Technical analysis workflow', ['brd', 'frs', 'requirements', 'jira'], `Use the workflow in order: read evidence, analyze requirements, map technical impact, write the backlog draft, review the approval gate, and publish the approved draft to Jira.

A document is the source of truth for existing behavior. Knowledge notes are a routing aid, not a replacement for BRD, FRS, or Confluence evidence.`);
  makeNode(officeDir, 'technical-backlog-contract', 'reference', 'Epic and user story contract', ['epic', 'user-story', 'acceptance-criteria'], `The epic states one coherent outcome, scope, exclusions, dependencies, risks, decisions, and evidence. Each story states actor and value, observable acceptance criteria, dependencies, affected systems, source references, assumptions, open questions, and definition of done.

Acceptance criteria use Given/When/Then and include failure paths whenever the behavior can fail, retry, duplicate, or require authorization.`);
  makeNode(officeDir, 'technical-source-traceability', 'policy', 'Technical source traceability policy', ['brd', 'frs', 'confluence', 'evidence'], `Every proposed requirement must point to a source section or be labelled as an assumption. Preserve conflicting versions and escalate the owner. Keep facts, interpretations, proposals, and decisions separate.

Never put secrets, credentials, PAN, PIN, CVV, or customer identifiers into knowledge notes, artifacts, or Jira.`);
  makeNode(officeDir, 'jira-publish-safety', 'policy', 'Jira publishing safety', ['jira', 'approval', 'audit'], `Analysis produces a draft and does not publish. Publishing is a separate explicit action. Validate the draft, check likely duplicates, create the epic before child stories, preserve parent links, and write a receipt with actual Jira keys and URLs. Never fabricate a successful Jira response.`);
}

function writeAssistantContext(officeDir: string): void {
  fs.writeFileSync(path.join(officeDir, 'charter.md'), `This office turns BRD, FRS, and approved Confluence evidence into traceable Jira delivery. It separates evidence, requirements, technical impact, story writing, and publication. Analysis is a draft-producing activity; Jira publication requires an explicit second action and a verifiable receipt.\n`, 'utf8');
  fs.writeFileSync(path.join(officeDir, 'skills', 'assistant.md'), `Route source reading to the technical document librarian, scope and requirement decisions to the requirements analyst, system and data impact to the solution architect, backlog shaping to the user story engineer, and Jira publication to the delivery manager. Require source references, expose assumptions and open questions, and never publish an unapproved draft.\n`, 'utf8');
}

function writeModel(officeDir: string): void {
  fs.mkdirSync(path.join(officeDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(officeDir, MODEL_FILE), YAML.stringify({ ...model(), generated_by: 'create-technical-analysis-office.ts', generated_at: new Date().toISOString() }, { lineWidth: 0 }), 'utf8');
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

function requireCompany(dir: string): Company {
  if (!fs.existsSync(path.join(dir, 'company.yaml'))) {
    throw new Error(`No company.yaml at ${dir}. Run agentco init --dir "${dir}" first.`);
  }
  return Company.open(dir);
}

function officeFor(company: Company, name: string): Office {
  const entry = company.list().find((item) => item.name === name);
  if (!entry) throw new Error(`Office not found: ${name}. Run the create action first.`);
  return company.get(entry.id);
}

function createOffice(options: Options): void {
  const company = requireCompany(options.dir);
  const armIds = [options.confluenceArm, options.jiraArm].filter((id): id is string => Boolean(id));
  for (const arm of new Set(armIds)) {
    if (!(arm in company.config.mcpServers)) throw new Error(`MCP server "${arm}" is not declared in company.yaml.`);
  }
  const existing = company.list().find((entry) => entry.name === options.office);
  const office = existing ? company.get(existing.id) : company.createOffice({ name: options.office });
  if (existing) console.log(`Using existing office: ${office.id}`);
  for (const role of ROLES) {
    if (!office.loaded.roles.has(role.id)) office.addAgent({ id: role.id, display_name: role.displayName, pitch: role.pitch, tier: role.tier });
    const current = office.loaded.roles.get(role.id);
    writeRole(office.loaded.dir, role, current ? { mcp: [...current.mcp], secrets: [...current.secrets] } : undefined);
  }
  writeAssistantContext(office.loaded.dir);
  writeKnowledge(office.loaded.dir);
  writeModel(office.loaded.dir);
  office.reload();

  const grants = new Map<string, string[]>();
  if (options.confluenceArm) grants.set(options.confluenceArm, ['technical-document-librarian']);
  if (options.jiraArm) grants.set(options.jiraArm, [...(grants.get(options.jiraArm) ?? []), 'jira-delivery-manager']);
  for (const [arm, roleIds] of grants) office.grantArm(arm, [...new Set(roleIds)]);
  office.reload();

  console.log(JSON.stringify({
    office: office.id,
    directory: office.loaded.dir,
    employees: ROLES.map((role) => role.id),
    workflow: model().workflow.map((step) => step.id),
    mcp: { confluence: options.confluenceArm ?? null, jira: options.jiraArm ?? null },
  }, null, 2));
}

function requestText(options: Options): string {
  const request = options.request ?? (options.requestFile ? fs.readFileSync(path.resolve(options.requestFile), 'utf8').trim() : '');
  if (!request) throw new Error('Provide --request "..." or --request-file <path>.');
  return request;
}

function analysisPrompt(request: string): string {
  return `Perform a technical analysis from the BRD, FRS, and Confluence evidence available to this office.

Request:
${request}

Read every named document and the relevant connected Confluence pages. Run the full workflow: evidence index, requirements decomposition, solution impact, and Jira-ready backlog design. Produce exactly one epic and a set of independently deliverable user stories. Every story needs a user/value statement, Given/When/Then acceptance criteria, priority, dependencies, affected systems, source references, assumptions, open questions, and definition of done.

Write the structured draft as a task output named technical-backlog.yaml. Use the exact output path supplied in the task brief; never hard-code root artifacts/technical-backlog.yaml. Include status: draft_requires_review and approved_for_publish: false. Do not create or update Jira issues during analysis. If evidence is missing or conflicting, keep the gap visible instead of guessing.`;
}

function publishPrompt(extra: string): string {
  return `Analyze the source evidence and publish the approved technical backlog to Jira.

Read the BRD, FRS, and relevant Confluence evidence available to this office. Because this is an explicit publish action, run one multi-step plan: index evidence, analyze requirements, map technical impact, write one epic and the user stories, then pass that draft through a task input to the Jira delivery manager. Do not read a root artifact or a result from an earlier run.

Before publishing, validate the draft, check for likely duplicate Jira issues, and stop if mandatory evidence or approval is missing. Create one epic first, then create each approved user story with the correct parent link. Preserve summaries, descriptions, Given/When/Then acceptance criteria, priority, labels, dependencies, systems, and source references. Do not invent keys or URLs. Write the technical backlog and Jira publish receipt to the exact task output paths supplied in the plan; never hard-code a root artifacts path. If Jira rejects a call, report the exact failure and do not claim complete publication.

${extra || 'No additional publish note was provided.'}`;
}

function requireJiraArm(office: Office, requested?: string): void {
  const role = office.loaded.roles.get('jira-delivery-manager');
  if (!role) throw new Error('The Jira delivery manager role is missing. Run the create action first.');
  if (role.mcp.length === 0) {
    throw new Error('No Jira MCP arm is wired to the Jira delivery manager. Recreate with --jira-arm or --atlassian-arm.');
  }
  if (requested && !role.mcp.includes(requested)) {
    throw new Error(`Jira arm "${requested}" is not wired to the Jira delivery manager.`);
  }
}

async function runAction(options: Options): Promise<void> {
  const company = requireCompany(options.dir);
  const office = officeFor(company, options.office);
  if (options.action === 'publish') requireJiraArm(office, options.jiraArm);
  const sources = loadSources(office, options.sources);
  const prompt = options.action === 'analyze' ? analysisPrompt(requestText(options)) : publishPrompt(options.request ?? '');
  const result = await office.run(prompt);
  console.log(JSON.stringify({ office: office.id, action: options.action, sources, report: result.report, usage: result.usage }, null, 2));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === 'create') createOffice(options);
  else await runAction(options);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
