# Creator vs Implementer Routing

**P0**  
Tags: core, routing, mode

## Deterministic Routing Rules

`ModeRouter` computes a score from user input and selects mode by threshold:

- `mode = implementer` when `score >= 50`
- `mode = creator` when `score < 50`

Current scoring signals:

- `wordCountScore`: 0 / 5 / 10 / 20 (by input length buckets)
- `prdScore`: +25
- `figmaScore`: +15
- `techStackScore`: +15
- `styleReferenceScore`: +10
- `detailedRequirementsScore`: +10
- `businessContextScore`: +5
- `implementationIntentScore`: +35

`implementationIntent` is triggered by coding/执行导向表达，例如：

- implement / fix / debug / refactor / test
- 实现 / 修改 / 修复 / 重构 / 调试 / 测试

## Precedence Rules

- If request explicitly sets `mode`, use it directly.
- If request explicitly sets `agentId` and that agent exists, lock mode to the agent mode.
- Otherwise use smart routing result from `ModeRouter`.
- Keep session route continuity unless user input or explicit agent changes it.

## Diagnostics Contract

Routing diagnostics should include:

- `mode`, `score`, `confidence`
- `details.*` scores including `implementationIntentScore`
- `version`, `language`, `techSignals`
