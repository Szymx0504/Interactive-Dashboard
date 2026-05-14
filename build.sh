#!/usr/bin/env bash
# Render build script — builds frontend + installs backend deps
set -e

# 1. Build frontend
cd frontend
npm install
npm run build
cd ..

# 2. Install backend dependencies
cd backend
pip install -r requirements.txt
