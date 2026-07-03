# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/hplant6/cathode-terminal/security/advisories/new) (the repo's **Security → Report a vulnerability**). Include steps to reproduce and the impact; we'll acknowledge and work on a fix.

## Scope

Cathode Terminal runs local AI coding agents and executes shell commands on your behalf — inside WSL on Windows, or the native shell on macOS/Linux. Areas most relevant to security:

- Command execution and the agent install / setup flows.
- The scripts injected into browsed pages.
- IPC between the main and renderer processes.

## Supported versions

The latest release receives security fixes.
