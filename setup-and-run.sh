#!/bin/bash
# Craft Agents - One-click setup and run script
# Usage: ./setup-and-run.sh

set -e

echo "==================================="
echo "  Craft Agents - Setup & Run"
echo "==================================="
echo ""

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    echo "Bun installed successfully!"
else
    echo "Bun is already installed: $(bun --version)"
fi

echo ""
echo "Installing dependencies..."
bun install

echo ""
echo "Running tests to verify setup..."
bun test

echo ""
echo "==================================="
echo "  Setup complete!"
echo "==================================="
echo ""
echo "Starting Craft Agents..."
echo ""

bun run electron:start
