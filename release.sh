#!/bin/bash
set -e

# Release script for Obsidian MCP Plugin
# Usage: ./release.sh [patch|minor|major|<version>]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    # Check for uncommitted changes
    if [[ -n $(git status --porcelain) ]]; then
        error "You have uncommitted changes. Please commit or stash them first."
    fi
    
    # Check current branch
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$BRANCH" != "main" ]]; then
        error "You must be on the 'main' branch to release. Current branch: $BRANCH"
    fi
    
    # Check for required tools
    command -v npm >/dev/null 2>&1 || error "npm is not installed"
    command -v jq >/dev/null 2>&1 || error "jq is not installed (brew install jq)"
    command -v gh >/dev/null 2>&1 || error "GitHub CLI is not installed (brew install gh)"
    
    success "Prerequisites check passed"
}

# Get version bump type
get_version_bump() {
    local current_version=$(jq -r '.version' package.json)
    local bump_type=$1
    
    if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        # Explicit version provided
        echo "$bump_type"
        return
    fi
    
    # Parse current version
    IFS='.' read -r major minor patch <<< "$current_version"
    
    case "$bump_type" in
        major)
            echo "$((major + 1)).0.0"
            ;;
        minor)
            echo "${major}.$((minor + 1)).0"
            ;;
        patch|"")
            echo "${major}.${minor}.$((patch + 1))"
            ;;
        *)
            error "Invalid version bump type: $bump_type. Use 'major', 'minor', 'patch', or specify version (e.g., 1.2.3)"
            ;;
    esac
}

# Update version in files
update_version() {
    local new_version=$1
    
    info "Updating version to $new_version..."
    
    # Update package.json
    jq ".version = \"$new_version\"" package.json > package.json.tmp
    mv package.json.tmp package.json
    
    # Run sync-version script to update manifest.json and version.ts
    npm run sync-version
    
    success "Version updated in package.json, manifest.json, and version.ts"
}

# Run tests and build
run_tests_and_build() {
    info "Running tests..."
    npm run test || error "Tests failed"
    success "Tests passed"
    
    info "Running linter..."
    npm run lint || error "Linting failed"
    success "Linting passed"
    
    info "Building plugin..."
    npm run build || error "Build failed"
    success "Build successful"
}

# Create git tag and commit
create_git_release() {
    local version=$1
    
    info "Creating git commit and tag..."
    
    git add package.json manifest.json src/version.ts
    git commit -m "chore: release v${version}"
    git tag -a "v${version}" -m "Release v${version}"
    
    success "Git commit and tag created"
}

# Push to GitHub
push_to_github() {
    local version=$1
    
    info "Pushing to GitHub..."
    git push origin main
    git push origin "v${version}"
    success "Pushed to GitHub"
}

# Create GitHub release
create_github_release() {
    local version=$1
    
    info "Creating GitHub release..."
    
    # Extract changelog for this version if it exists
    NOTES="## Release v${version}

### Installation via BRAT
1. Install the BRAT plugin if you haven't already
2. Command palette → \"BRAT: Add a beta plugin for testing\"
3. Enter: \`marianna-b/obsidian-mcp-plugin\`
4. Enable the plugin in Community Plugins"
    
    gh release create "v${version}" \
        --title "v${version}" \
        --notes "$NOTES" \
        --generate-notes \
        main.js \
        manifest.json \
        styles.css || true
    
    success "GitHub release created"
}

# Main release process
main() {
    local bump_type=${1:-patch}
    
    echo "=========================================="
    echo "  Obsidian MCP Plugin Release Script"
    echo "=========================================="
    echo ""
    
    # Check prerequisites
    check_prerequisites
    
    # Get current and new versions
    local current_version=$(jq -r '.version' package.json)
    local new_version=$(get_version_bump "$bump_type")
    
    echo ""
    info "Current version: $current_version"
    info "New version: $new_version"
    echo ""
    
    # Confirm with user
    read -p "Proceed with release? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Release cancelled"
    fi
    
    # Update version
    update_version "$new_version"
    
    # Run tests and build
    run_tests_and_build
    
    # Create git release
    create_git_release "$new_version"
    
    # Push to GitHub
    push_to_github "$new_version"
    
    # Create GitHub release
    create_github_release "$new_version"
    
    echo ""
    success "Release v${new_version} completed successfully!"
    echo ""
    info "Next steps:"
    echo "  1. Update CHANGELOG.md with release notes"
    echo "  2. Test the release via BRAT"
    echo "  3. Monitor for any issues"
}

# Run main
main "$@"
