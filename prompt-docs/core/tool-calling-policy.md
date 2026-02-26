# Tool Calling Policy

**P0**  
Tags: core, tools, policy

## Global Rules

- Use only registered tools and valid parameter schemas.
- Never invent tool output or file changes.
- Command output is the only valid evidence for verification claims.

## Agent-Level Tool Whitelist

- `frontend-creator` can call:
  - `design_search`
  - `get_design_style`
  - `get_color_palette`
  - `get_typography_pair`
  - `get_component_list`
  - `project_scaffold`
  - `read`, `write`, `webfetch`
- `frontend-implementer` can call:
  - `read`, `write`, `edit`, `grep`, `glob`, `bash`

## Design Resource Call Strategy

- For broad inspiration/discovery, call `design_search` first.
- For structured design assets, use:
  - `get_design_style`
  - `get_color_palette`
  - `get_typography_pair`
  - `get_component_list`
- If a resource tool returns empty or unavailable data, explicitly report the gap and continue with fallback context.
