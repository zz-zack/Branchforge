// Package agent 定义可替换的编码 agent 抽象,以及 Task / Result 数据类型。
// v0.1 仅实现 claude 后端,接口预留多后端(codex / aider / gemini …)。
package agent

import (
	"context"
	"time"
)

// Task 描述交给单个 agent 执行的工作单元。
type Task struct {
	Goal       string   // 任务描述,作为 agent 的 prompt
	Acceptance []string // 验收点(v0.1 仅记录,v0.2 用于自动测试)
	Model      string   // 可选,覆盖默认模型
}

// Result 是单个 variant 的执行结果。diff 统计由编排层在 agent 跑完后填充。
type Result struct {
	Variant  string        `json:"variant"`  // "a" / "b" / "c"
	Branch   string        `json:"branch"`   // forge/<slug>-a
	Worktree string        `json:"worktree"` // 工作目录
	Text     string        `json:"text"`     // agent 自述(claude 的 result 文本)
	IsError  bool          `json:"is_error"`
	CostUSD  float64       `json:"cost_usd"`
	Duration time.Duration `json:"duration_ns"`
	Added    int           `json:"added"`     // diff 新增行数
	Removed  int           `json:"removed"`   // diff 删除行数
	Files    int           `json:"files"`     // 改动文件数
	DiffPath string        `json:"diff_path"` // 完整 diff 落盘路径
	Empty    bool          `json:"empty"`     // agent 未产生任何改动
	Err      string        `json:"error,omitempty"`
}

// Agent 是可替换的编码 agent 后端。
type Agent interface {
	// Run 在 workdir(对应一个独立 worktree)内执行 task。
	// 返回的 Result 只含 agent 自身产出的字段;diff 统计由编排层补充。
	Run(ctx context.Context, task Task, workdir string) (Result, error)
	// Name 返回后端标识,用于日志与报告。
	Name() string
}
