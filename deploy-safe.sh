#!/bin/bash
# Safe deployment script - only syncs code, not user data

SOURCE_DIR="/Users/mariashika/projects/code/obsidian-mcp-plugin"
TARGET_DIR="/Users/mariashika/Obsidian/ideaverse/.obsidian/plugins/semantic-vault-mcp"

# Sync only specific files/directories, excluding user data
rsync -av \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  --exclude 'data.json' \
  --exclude '.DS_Store' \
  "$SOURCE_DIR/main.js" \
  "$SOURCE_DIR/manifest.json" \
  "$SOURCE_DIR/styles.css" \
  "$SOURCE_DIR/dist/" \
  "$TARGET_DIR/"

echo "✅ Plugin deployed (data.json preserved)"
