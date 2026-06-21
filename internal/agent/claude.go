package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ClaudeAgent 通过 claude CLI 的 headless 模式(claude -p ... --output-format json)执行任务。
type ClaudeAgent struct {
	Bin string // claude 可执行名,默认 "claude"
}

// NewClaudeAgent 返回默认配置的 claude 后端。
func NewClaudeAgent() *ClaudeAgent { return &ClaudeAgent{Bin: "claude"} }

// Name 实现 Agent 接口。
func (c *ClaudeAgent) Name() string { return "claude" }

// claudeJSON 对应 `claude -p --output-format json` 的输出(仅取所需字段)。
type claudeJSON struct {
	Type       string  `json:"type"`
	Subtype    string  `json:"subtype"`
	Result     string  `json:"result"`
	IsError    bool    `json:"is_error"`
	TotalCost  float64 `json:"total_cost_usd"`
	DurationMS int64   `json:"duration_ms"`
	NumTurns   int     `json:"num_turns"`
	SessionID  string  `json:"session_id"`
}

// Run 在 workdir 内以 headless 模式调用 claude,并解析其 JSON 输出。
func (c *ClaudeAgent) Run(ctx context.Context, task Task, workdir string) (Result, error) {
	bin := c.Bin
	if bin == "" {
		bin = "claude"
	}
	args := []string{"-p", task.Goal, "--output-format", "json", "--dangerously-skip-permissions"}
	if task.Model != "" {
		args = append(args, "--model", task.Model)
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = workdir

	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb

	start := time.Now()
	runErr := cmd.Run()
	res := Result{Worktree: workdir, Duration: time.Since(start)}

	if raw := strings.TrimSpace(out.String()); raw != "" {
		var cj claudeJSON
		if err := json.Unmarshal([]byte(raw), &cj); err == nil {
			res.Text = cj.Result
			res.IsError = cj.IsError
			res.CostUSD = cj.TotalCost
			if cj.DurationMS > 0 {
				res.Duration = time.Duration(cj.DurationMS) * time.Millisecond
			}
		} else {
			res.Text = raw // 非 JSON 输出,原样保留便于排错
		}
	}

	if runErr != nil {
		res.IsError = true
		stderr := strings.TrimSpace(errb.String())
		if res.Text == "" {
			res.Text = stderr
		}
		res.Err = runErr.Error()
		return res, fmt.Errorf("claude run failed in %s: %w: %s", workdir, runErr, stderr)
	}
	return res, nil
}
