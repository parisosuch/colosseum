# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Instead, report them privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (under "Advisories").
3. Fill in the details of the issue.

This opens a private advisory visible only to you and the maintainers.

Please include as much of the following as you can:

- The type of issue and the affected component (route, action, data path).
- Steps to reproduce, or a proof-of-concept.
- The impact — what an attacker could read, change, or do.
- Any suggested remediation, if you have one.

## What to expect

- We aim to acknowledge a report within a few days.
- We'll keep you updated as we investigate and work on a fix.
- Once a fix ships, we're happy to credit you in the advisory unless you prefer
  to stay anonymous.

## Supported versions

Colosseum is developed on a rolling basis; fixes land on the latest release.
Please make sure you're running the most recent version before reporting, and
upgrade (`git pull && docker compose up -d --build`) to pick up security fixes.
