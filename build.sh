#!/bin/bash
set -e

echo "Installing pnpm..."
npm install -g pnpm@latest

echo "Installing dependencies..."
pnpm install

echo "Building projects..."
pnpm run build

echo "Build complete!"
