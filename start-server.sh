#!/bin/bash

# GitHub Calendar MCP Server Wrapper
# This ensures the environment variable is properly set

# Check if GITHUB_TOKEN is provided
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable is required" >&2
    echo "Please set GITHUB_TOKEN in your Goose MCP configuration" >&2
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start the MCP server
exec node "$SCRIPT_DIR/dist/index.js"
