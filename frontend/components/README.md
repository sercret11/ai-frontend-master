# Components

当前组件目录已精简为运行链路必需的组件集合。

## Structure

- `layout/`
  - `Sidebar`
  - `WorkspaceHeader`
- `preview/`
  - `PreviewView`
- `editor/`
  - `CodeView`
- `workflow/`
  - `RunConsole`
- `common/`
  - `MarkdownRenderer`

## Barrel Exports

- `components/index.ts`
  - `Sidebar`
  - `WorkspaceHeader`
  - `PreviewView`
  - `CodeView`
  - `RunConsole`
  - `MarkdownRenderer`
  - `FileTreeNode` (type)

## Notes

- 旧的未接入组件（设备切换器、通用错误边界、加载器、离线横幅、文件进度组件等）已移除。
- 如果后续需要恢复某类能力，建议以当前 runtime 事件流与渲染引擎为基础重新实现。
