---
name: scaffold-from-claude-md
description: Scaffold the gpilot project structure from CLAUDE.md
---

Read the CLAUDE.md file at the project root and scaffold the project
structure exactly as described in its "Project Layout" section.

Steps to perform:

1. Create all folders listed in Project Layout
2. Create empty index.ts placeholder files in each module folder
3. Create empty .spec.md placeholder files matching each module name
4. Create **tests**/ subfolders inside each module
5. Generate tsconfig.json with these settings:
   - strict: true
   - module: NodeNext
   - target: ES2024
   - moduleResolution: NodeNext
   - outDir: dist
   - esModuleInterop: true
6. Generate .gitignore with the entries listed in CLAUDE.md
7. Generate .env.example with the keys listed in CLAUDE.md
8. Run `npm install` for the dependencies listed in the Stack section

Do not write any actual implementation code. Only scaffold the
structure. Index.ts files should contain only a comment placeholder.
