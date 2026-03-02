#!/bin/bash
# Generate or update CHANGELOG.md from git history.
#
# Usage:
#   bash scripts/changelog.sh                  # Full changelog from all tags
#   bash scripts/changelog.sh v0.2.0..HEAD     # Specific range only (stdout)
#
# Categorizes commits by conventional-commit prefix:
#   feat → New Features, fix → Bug Fixes, docs → Documentation,
#   refactor → Refactoring, chore → Maintenance, others → Other
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

categorize() {
  local msg="$1"
  case "$msg" in
    feat:*|feat\(*) echo "NEW_FEATURES" ;;
    fix:*|fix\(*)   echo "BUG_FIXES" ;;
    docs:*|docs\(*) echo "DOCUMENTATION" ;;
    refactor:*|refactor\(*) echo "REFACTORING" ;;
    chore:*|chore\(*) echo "MAINTENANCE" ;;
    release:*) echo "SKIP" ;;
    *) echo "OTHER" ;;
  esac
}

strip_prefix() {
  echo "$1" | sed -E 's/^(feat|fix|docs|refactor|chore)(\([^)]*\))?:\s*//'
}

format_section() {
  local title="$1"
  shift
  if [ $# -gt 0 ]; then
    echo ""
    echo "### $title"
    echo ""
    for item in "$@"; do
      echo "- $item"
    done
  fi
}

generate_range() {
  local range="$1"
  local tag_name="$2"
  local tag_date="$3"

  local features=() fixes=() docs=() refactors=() maintenance=() other=()

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local cat
    cat=$(categorize "$line")
    local clean
    clean=$(strip_prefix "$line")

    case "$cat" in
      NEW_FEATURES) features+=("$clean") ;;
      BUG_FIXES)    fixes+=("$clean") ;;
      DOCUMENTATION) docs+=("$clean") ;;
      REFACTORING)  refactors+=("$clean") ;;
      MAINTENANCE)  maintenance+=("$clean") ;;
      SKIP) ;;
      *) other+=("$clean") ;;
    esac
  done < <(git log "$range" --pretty=format:"%s" --no-merges)

  local total=$(( ${#features[@]} + ${#fixes[@]} + ${#docs[@]} + ${#refactors[@]} + ${#maintenance[@]} + ${#other[@]} ))
  [ "$total" -eq 0 ] && return

  echo "## $tag_name ($tag_date)"
  format_section "New Features" "${features[@]}"
  format_section "Bug Fixes" "${fixes[@]}"
  format_section "Documentation" "${docs[@]}"
  format_section "Refactoring" "${refactors[@]}"
  format_section "Maintenance" "${maintenance[@]}"
  format_section "Other" "${other[@]}"
  echo ""
}

# Single range mode (stdout only)
if [ -n "$1" ]; then
  generate_range "$1" "Unreleased" "$(date +%Y-%m-%d)"
  exit 0
fi

# Full changelog mode — regenerate CHANGELOG.md from all tags
tags=($(git tag -l 'v*' --sort=version:refname))
output="# Changelog\n\nAll notable changes to claude-alive.\n"

# Unreleased section (latest tag..HEAD)
if [ ${#tags[@]} -gt 0 ]; then
  latest="${tags[${#tags[@]}-1]}"
  unreleased_count=$(git rev-list "$latest..HEAD" --count --no-merges)
  if [ "$unreleased_count" -gt 0 ]; then
    output+=$'\n'
    output+=$(generate_range "$latest..HEAD" "Unreleased" "$(date +%Y-%m-%d)")
    output+=$'\n'
  fi
fi

# Tagged releases (newest first)
for (( i=${#tags[@]}-1; i>=0; i-- )); do
  tag="${tags[$i]}"
  tag_date=$(git log -1 --format="%as" "$tag")

  if [ $i -gt 0 ]; then
    prev="${tags[$((i-1))]}"
    range="$prev..$tag"
  else
    range="$tag"
  fi

  section=$(generate_range "$range" "$tag" "$tag_date")
  if [ -n "$section" ]; then
    output+=$'\n'"$section"
  fi
done

echo -e "$output" > "$ROOT/CHANGELOG.md"
echo "Generated CHANGELOG.md ($(wc -l < "$ROOT/CHANGELOG.md") lines)"
