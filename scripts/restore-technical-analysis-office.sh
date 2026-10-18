#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTCO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPANY_DIR="${AGENTCO_COMPANY_DIR:-$AGENTCO_DIR/company}"
OFFICE_NAME="Technical Analysis Office"
ATLASSIAN_ARM=""
CONFLUENCE_ARM=""
JIRA_ARM=""
SOURCES=()

usage() {
  cat <<'EOF'
Restore the technical analysis office.

Usage:
  bash scripts/restore-technical-analysis-office.sh [options]

Options:
  --dir <path>                    AgentCo company directory
  --office <name>                 Office display name
  --atlassian-arm <id>            Existing Atlassian MCP arm for Confluence and Jira
  --confluence-arm <id>           Existing MCP arm for Confluence
  --jira-arm <id>                 Existing MCP arm for Jira
  --source <file>                 BRD/FRS/DOCX/XLSX/PDF/text source; repeatable
  -h, --help                      Show this help
EOF
}

while (($# > 0)); do
  case "$1" in
    --dir)
      [[ $# -ge 2 ]] || { echo "Missing value for --dir" >&2; exit 2; }
      COMPANY_DIR="$2"
      shift 2
      ;;
    --office)
      [[ $# -ge 2 ]] || { echo "Missing value for --office" >&2; exit 2; }
      OFFICE_NAME="$2"
      shift 2
      ;;
    --atlassian-arm)
      [[ $# -ge 2 ]] || { echo "Missing value for --atlassian-arm" >&2; exit 2; }
      ATLASSIAN_ARM="$2"
      shift 2
      ;;
    --confluence-arm)
      [[ $# -ge 2 ]] || { echo "Missing value for --confluence-arm" >&2; exit 2; }
      CONFLUENCE_ARM="$2"
      shift 2
      ;;
    --jira-arm)
      [[ $# -ge 2 ]] || { echo "Missing value for --jira-arm" >&2; exit 2; }
      JIRA_ARM="$2"
      shift 2
      ;;
    --source)
      [[ $# -ge 2 ]] || { echo "Missing value for --source" >&2; exit 2; }
      SOURCES+=(--source "$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$ATLASSIAN_ARM" ]]; then
  [[ -z "$CONFLUENCE_ARM" ]] && CONFLUENCE_ARM="$ATLASSIAN_ARM"
  [[ -z "$JIRA_ARM" ]] && JIRA_ARM="$ATLASSIAN_ARM"
fi

if [[ ! -f "$COMPANY_DIR/company.yaml" ]]; then
  echo "Initializing AgentCo company at $COMPANY_DIR"
  (cd "$AGENTCO_DIR" && npm run dev -- init --dir "$COMPANY_DIR")
fi

ARGS=(--dir "$COMPANY_DIR" --office "$OFFICE_NAME")
if [[ -n "$CONFLUENCE_ARM" ]]; then
  ARGS+=(--confluence-arm "$CONFLUENCE_ARM")
fi
if [[ -n "$JIRA_ARM" ]]; then
  ARGS+=(--jira-arm "$JIRA_ARM")
fi
if ((${#SOURCES[@]} > 0)); then
  ARGS+=("${SOURCES[@]}")
fi

(cd "$AGENTCO_DIR" && npm run office:technical -- "${ARGS[@]}" create)
