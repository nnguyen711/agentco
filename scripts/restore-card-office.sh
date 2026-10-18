#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTCO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPANY_DIR="${AGENTCO_COMPANY_DIR:-$AGENTCO_DIR/company}"
OFFICE_NAME="Debit and Credit Card Transformation Office"
CONFLUENCE_ARM=""
SOURCES=()

usage() {
  cat <<'EOF'
Restore the debit and credit card transformation office.

Usage:
  bash scripts/restore-card-office.sh [options]

Options:
  --dir <path>                 AgentCo company directory
  --office <name>              Office display name
  --confluence-arm <id>        Existing Atlassian MCP arm id
  --source <file>              DOCX/XLSX/PDF/text source; repeatable
  -h, --help                   Show this help
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
    --confluence-arm)
      [[ $# -ge 2 ]] || { echo "Missing value for --confluence-arm" >&2; exit 2; }
      CONFLUENCE_ARM="$2"
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

if [[ ! -f "$COMPANY_DIR/company.yaml" ]]; then
  echo "Initializing AgentCo company at $COMPANY_DIR"
  (cd "$AGENTCO_DIR" && npm run dev -- init --dir "$COMPANY_DIR")
fi

ARGS=(--dir "$COMPANY_DIR" --office "$OFFICE_NAME")
if [[ -n "$CONFLUENCE_ARM" ]]; then
  ARGS+=(--confluence-arm "$CONFLUENCE_ARM")
fi
if ((${#SOURCES[@]} > 0)); then
  ARGS+=("${SOURCES[@]}")
fi

(cd "$AGENTCO_DIR" && npm run office:card -- "${ARGS[@]}" create)
