# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Horsey Games is a static browser-based game collection website. No build tools, frameworks, or dependencies — just HTML, CSS, and vanilla JavaScript served as static files.

## Architecture

- `index.html` — Landing page with "Start" button
- `games.html` — Game selection grid; add a new `<a class="game-card">` linking to the game page to register a new game
- `style.css` — Shared styles (dark theme, buttons, back-link); all pages link to this
- `games/` — Each game is a self-contained HTML file with its own inline `<style>` and `<script>`, plus a `<link rel="stylesheet" href="../style.css">` for shared styles and a back-link to `../games.html`

## Adding a New Game

1. Create `games/<gamename>.html` — use `games/tictactoe.html` as a template (shared CSS import, back-link, inline game styles/logic)
2. Add a card in `games.html` inside the `.game-grid` div

## Development

Open `index.html` directly in a browser — no server required. For live reload during development, use any static file server (e.g., `npx serve .`).

## Git Workflow

GitHub repo: `danielycshi-eng/Horsey-games` (public). Always commit and push after changes. Use `export PATH="$PATH:/c/Program Files/GitHub CLI"` before `gh` commands in this environment.
