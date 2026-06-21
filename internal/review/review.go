// Package review 聚合各 variant 的结果,生成 run.json 与 report.md,
// 并可选地再调用一次 agent 产出「推荐分支 + 理由」。
package review

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zack/branchforge/internal/agent"
)

const maxDiffLines = 400 // 喂给评审 agent 的单份 diff 上限,控制 token

// RunMeta 是一次 run 的持久化元数据,写入 run.json。
type RunMeta struct {
	Slug      string         `json:"slug"`
	Task      string         `json:"task"`
	Base      string         `json:"base"`
	CreatedAt string         `json:"created_at"`
	Results   []agent.Result `json:"results"`
}

// Generate 写出 run.json 与 report.md。reviewer 非 nil 时,在报告顶部附加 LLM 推荐。
func Generate(ctx context.Context, runDir, slug, task, base string, results []agent.Result, reviewer agent.Agent, model string, createdAt time.Time) (reportPath string, err error) {
	meta := RunMeta{Slug: slug, Task: task, Base: base, CreatedAt: createdAt.Format(time.RFC3339), Results: results}
	if data, e := json.MarshalIndent(meta, "", "  "); e == nil {
		_ = os.WriteFile(filepath.Join(runDir, "run.json"), data, 0o644)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# BranchForge 对比报告\n\n")
	fmt.Fprintf(&b, "**任务**: %s\n\n", task)
	fmt.Fprintf(&b, "**Base**: `%s`  ·  **生成时间**: %s\n\n", base, createdAt.Format("2006-01-02 15:04:05"))

	// LLM 推荐(置顶)。
	if reviewer != nil {
		b.WriteString("## 推荐\n\n")
		if rec, rerr := recommend(ctx, reviewer, model, task, results); rerr != nil {
			fmt.Fprintf(&b, "_LLM 推荐生成失败: %v_\n\n", rerr)
		} else {
			fmt.Fprintf(&b, "%s\n\n", strings.TrimSpace(rec))
		}
	}

	// 客观数据表。
	b.WriteString("## 各分支对比\n\n")
	b.WriteString("| Variant | 分支 | +行 | -行 | 文件 | 成本(USD) | 耗时 | 状态 |\n")
	b.WriteString("|---|---|---:|---:|---:|---:|---|---|\n")
	for _, r := range results {
		fmt.Fprintf(&b, "| %s | `%s` | %d | %d | %d | %.4f | %s | %s |\n",
			r.Variant, r.Branch, r.Added, r.Removed, r.Files, r.CostUSD,
			r.Duration.Round(time.Second), statusOf(r))
	}
	b.WriteString("\n")

	// 各 variant 自述。
	for _, r := range results {
		fmt.Fprintf(&b, "### Variant %s — `%s`\n\n", r.Variant, r.Branch)
		if r.Err != "" {
			fmt.Fprintf(&b, "> 错误: %s\n\n", r.Err)
		}
		if r.Text != "" {
			fmt.Fprintf(&b, "%s\n\n", strings.TrimSpace(r.Text))
		}
		if r.DiffPath != "" {
			fmt.Fprintf(&b, "完整 diff: `%s`\n\n", r.DiffPath)
		}
	}

	reportPath = filepath.Join(runDir, "report.md")
	if err = os.WriteFile(reportPath, []byte(b.String()), 0o644); err != nil {
		return "", err
	}
	return reportPath, nil
}

func statusOf(r agent.Result) string {
	switch {
	case r.IsError:
		return "✗ 失败"
	case r.Empty:
		return "○ 无改动"
	default:
		return "✓ 完成"
	}
}

// recommend 构造对比 prompt,在临时隔离目录中调用评审 agent(避免污染主仓库)。
func recommend(ctx context.Context, reviewer agent.Agent, model, task string, results []agent.Result) (string, error) {
	var p strings.Builder
	fmt.Fprintf(&p, "你是资深技术评审。以下是针对同一任务的 %d 个并行实现方案,请对比后给出推荐。\n\n", len(results))
	fmt.Fprintf(&p, "任务: %s\n\n", task)
	for _, r := range results {
		fmt.Fprintf(&p, "## 方案 %s (分支 %s)\n", r.Variant, r.Branch)
		fmt.Fprintf(&p, "统计: +%d -%d, %d 个文件改动。\n", r.Added, r.Removed, r.Files)
		if r.Empty {
			p.WriteString("该方案未产生任何改动。\n\n")
			continue
		}
		if r.Text != "" {
			fmt.Fprintf(&p, "实现者自述: %s\n", truncateLines(r.Text, 30))
		}
		fmt.Fprintf(&p, "diff(可能截断):\n```diff\n%s\n```\n\n", truncateLines(readFile(r.DiffPath), maxDiffLines))
	}
	p.WriteString("请输出:1) 推荐哪个方案(Variant 字母);2) 1-3 条理由;3) 各方案的简短优缺点。用中文,简洁。")

	tmp, err := os.MkdirTemp("", "forge-review-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)

	res, err := reviewer.Run(ctx, agent.Task{Goal: p.String(), Model: model}, tmp)
	if err != nil {
		return "", err
	}
	return res.Text, nil
}

func truncateLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= n {
		return s
	}
	return strings.Join(lines[:n], "\n") + fmt.Sprintf("\n... (省略 %d 行)", len(lines)-n)
}

func readFile(path string) string {
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}
