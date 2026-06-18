#!/bin/bash
set -e

echo "→ Killing stale Metro / ngrok / Expo processes..."
pkill -f "metro" 2>/dev/null || true
pkill -f "expo start" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
lsof -ti :8081 | xargs kill -9 2>/dev/null || true
lsof -ti :4040 | xargs kill -9 2>/dev/null || true
sleep 1

echo "→ Clearing Metro cache..."
rm -rf /tmp/metro-* "$TMPDIR/metro-*" 2>/dev/null || true
rm -rf "$HOME/Library/Caches/com.facebook.ReactNativeBuild" 2>/dev/null || true

echo "→ Clearing Expo cache..."
rm -rf .expo 2>/dev/null || true

echo "→ Starting Expo with tunnel..."
npx expo start --tunnel --clear
