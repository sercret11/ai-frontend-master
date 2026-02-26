# 风格与完成标准
- 代码风格: UTF-8、LF、2 空格缩进（见 .editorconfig）。
- 后端 ESLint 重点: TypeScript 规则，禁止未使用变量；`any`在部分文件被降级或关闭。
- 前端 ESLint 重点: react-hooks 推荐规则、react-refresh only-export-components。
- 完成任务前建议:
  1) 运行 `npm run test`（至少关键路径测试）
  2) 运行 `npm run build` 验证前后端可构建
  3) 联调 `npm run dev` 验证 SSE 流和工具可视化
  4) 检查前端聊天链路: 消息流、toolCall/toolResult、filesCount/sessionId 回传
