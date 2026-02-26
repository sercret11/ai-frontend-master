# Testing Log

- Date: 2026-02-21
- Executor: Codex

## Executed

1. `npm run build`
- Result: PASS
- Summary: root build succeeded, including `shared-types`, `backend`, `frontend`.

2. `npm --prefix backend run test -- --run`
- Result: FAIL (expected baseline)
- Summary: no backend test files found by vitest.

## Additional Testing (2026-02-21)

3. `npm --prefix backend run build`
- Result: PASS
- Summary: backend compiles after `project_scaffold` and project-type inference refactor.

4. `npm --prefix frontend run build`
- Result: PASS
- Summary: frontend compiles after static server migration and ProjectCompiler path fix.

5. `docker compose up -d --build frontend`
- Result: PASS
- Summary: frontend service healthy on port `5190` with COOP/COEP headers enabled.

6. `docker compose up -d --build backend`
- Result: PASS
- Summary: backend service healthy on port `3001`.

7. Playwright MCP closed-loop tests (all in new sessions)
- Prompt: `请生成一个企业级项目管理平台 Web 应用。`
- Result: PASS (`files=7`, preview loaded, session `c0a89d54-2b01-4e68-97e6-fc08fcb13903`)

- Prompt: `请生成一个连锁零售运营管理小程序。`
- Result: PASS (`files=5`, preview loaded, session `94299e0b-6756-4cf6-9c7d-aa2ee28a8965`)

- Prompt: `请生成一个跨端医疗随访管理 App。`
- Result: PASS (`files=3`, preview loaded, session `98a14404-5165-46c6-b4d5-948afbaf433b`)

8. DB consistency checks
- Result: PASS
- Summary: `sessions/messages/files` entries matched each Playwright test case.
