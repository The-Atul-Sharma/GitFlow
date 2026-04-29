# gpilot

CLI tool that automates git workflow — commit messages, PR creation,
PR descriptions, and PR reviews — using configurable AI providers.

## Stack

- Node.js 24, TypeScript (strict, ESM modules)
- Vitest for tests
- enquirer + chalk for CLI UI
- keytar for OS keychain secrets
- zod for runtime validation

## Project Layout

The repository must follow this structure:

gpilot/
.gitignore
.env.example
CLAUDE.md
package.json
tsconfig.json
specs/
architecture.spec.md
src/
cli/
index.ts
modules/
commitGenerator/
index.ts
commitGenerator.spec.md
**tests**/
prCreator/
index.ts
prCreator.spec.md
**tests**/
prDescription/
index.ts
prDescription.spec.md
**tests**/
prReviewer/
index.ts
prReviewer.spec.md
**tests**/
commentFixer/
index.ts
commentFixer.spec.md
**tests**/
core/
ai/
index.ts
ai.spec.md
git/
index.ts
git.spec.md
secrets/
index.ts
secrets.spec.md
confirmation/
index.ts
confirmation.spec.md
platforms/
github/
index.ts
github.spec.md
azureDevops/
index.ts
azureDevops.spec.md

## Required files content

### .gitignore must contain

node*modules/, dist/, .env, .env.local, .env.*, !.env.example,
.DS*Store, *.log, .claude/

### .env.example must contain (empty values)

ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN,
AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT

## Conventions

- Named exports only, no default exports
- Files: camelCase.ts, folders: camelCase
- Every module has a matching .spec.md
  ...
