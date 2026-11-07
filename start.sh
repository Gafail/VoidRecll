#!/bin/bash

# =============================================================================
# VoidRecll - Local Server Starter Script
# Auto-launches default browser and serves your word card app locally
# =============================================================================

SERVER_URL="http://localhost:8000"
WAIT_SECONDS=2
POLL_INTERVAL=0.5
PORT=8000

# Print header
echo "=========================================="
echo "  🎨 VoidRecll - Local Server"
echo "=========================================="
echo ""
echo "Starting local development server..."
echo ""

# Detect operating system for browser launcher
if command -v xdg-open &> /dev/null; then
    OPEN_CMD="xdg-open"
elif command -v wslnewurl &> /dev/null; then
    OPEN_CMD="wslnewurl"
elif command -v open &> /dev/null; then
    OPEN_CMD="open"
else
    OPEN_CMD=""
fi

# Start Python HTTP server in background
if command -v python3 &> /dev/null || command -v python &> /dev/null; then
    echo "🐍 Using Python 3 HTTP server on port ${PORT}..."
    python3 -m http.server ${PORT} &
    SERVER_PID=$!

    # Wait for server to be ready
    echo "⏳ Waiting ${WAIT_SECONDS}s for server to start..."
    sleep ${WAIT_SECONDS}

    # Try to open browser if available
    if [ -n "${OPEN_CMD}" ]; then
        echo "🚀 Opening ${SERVER_URL} in your default browser..."
        "${OPEN_CMD}" "${SERVER_URL}"

        # Fallback: try alternative methods if command failed
        if ! "${OPEN_CMD}" "${SERVER_URL}" &> /dev/null 2>&1; then
            echo "⚠️ Browser didn't open automatically. Copy and paste this link:"
            echo ""
            echo "   ${SERVER_URL}"
            echo ""
        fi
    else
        echo "⚠️ No browser launcher found. Open ${SERVER_URL} manually or run:"
        echo ""
        echo "   curl ${SERVER_URL}"
        echo ""
    fi

    # Keep script running and forward output to terminal
    wait ${SERVER_PID}

else
    echo "❌ Error: Python 3 is not installed on this system."
    echo ""
    echo "Please install Python 3 or use a different server:"
    echo "   - Node.js: npx serve -l ${PORT}"
    echo "   - PHP: php -S localhost:${PORT}"
fi
