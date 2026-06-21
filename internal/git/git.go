// Package git 用 os/exec 调用系统 git,封装 BranchForge 编排所需的最小操作集。
// 选用系统 git 而非 go-git:worktree / merge / 冲突处理用系统 git 最可靠。
package git

import (
	"bufio"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// run 在 dir 目录执行 git 子命令,返回去除首尾空白的 stdout。
func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return strings.TrimSpace(out.String()), nil
}

// IsRepo 判断 dir 是否位于某个 git 工作树内。
func IsRepo(dir string) bool {
	out, err := run(dir, "rev-parse", "--is-inside-work-tree")
	return err == nil && out == "true"
}

// RepoRoot 返回 dir 所在仓库的顶层目录绝对路径。
func RepoRoot(dir string) (string, error) {
	return run(dir, "rev-parse", "--show-toplevel")
}

// CurrentBranch 返回当前检出的分支名。
func CurrentBranch(dir string) (string, error) {
	return run(dir, "rev-parse", "--abbrev-ref", "HEAD")
}

// IsClean 报告工作区是否干净(没有未提交的改动)。
func IsClean(dir string) (bool, error) {
	out, err := run(dir, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return out == "", nil
}

// WorktreeAdd 以 base 为起点新建分支 branch,并将其检出到 path。
func WorktreeAdd(repo, path, branch, base string) error {
	_, err := run(repo, "worktree", "add", "-b", branch, path, base)
	return err
}

// WorktreeRemove 强制移除 path 处的 worktree。
func WorktreeRemove(repo, path string) error {
	_, err := run(repo, "worktree", "remove", "--force", path)
	return err
}

// Worktree 描述一个已注册的 worktree。
type Worktree struct {
	Path   string
	Branch string
	Head   string
}

// WorktreeList 解析 `git worktree list --porcelain` 列出全部 worktree。
func WorktreeList(repo string) ([]Worktree, error) {
	out, err := run(repo, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	var res []Worktree
	var cur Worktree
	flush := func() {
		if cur.Path != "" {
			res = append(res, cur)
			cur = Worktree{}
		}
	}
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "worktree "):
			flush()
			cur.Path = strings.TrimPrefix(line, "worktree ")
		case strings.HasPrefix(line, "HEAD "):
			cur.Head = strings.TrimPrefix(line, "HEAD ")
		case strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		}
	}
	flush()
	return res, nil
}

// CommitAll 暂存全部改动并提交;若没有任何改动,则 changed=false 且不创建提交。
func CommitAll(dir, msg string) (changed bool, err error) {
	if _, err = run(dir, "add", "-A"); err != nil {
		return false, err
	}
	clean, err := IsClean(dir)
	if err != nil {
		return false, err
	}
	if clean {
		return false, nil
	}
	if _, err = run(dir, "commit", "-m", msg); err != nil {
		return false, err
	}
	return true, nil
}

// Numstat 汇总 dir 相对 base 的新增/删除行数与改动文件数。
// 二进制文件在 numstat 中以 "-" 表示行数,计入文件数但不计行数。
func Numstat(dir, base string) (added, removed, files int, err error) {
	out, err := run(dir, "diff", "--numstat", base)
	if err != nil {
		return 0, 0, 0, err
	}
	if out == "" {
		return 0, 0, 0, nil
	}
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 {
			continue
		}
		files++
		if a, e := strconv.Atoi(fields[0]); e == nil {
			added += a
		}
		if r, e := strconv.Atoi(fields[1]); e == nil {
			removed += r
		}
	}
	return added, removed, files, nil
}

// DiffText 返回 dir 相对 base 的完整 unified diff。
func DiffText(dir, base string) (string, error) {
	return run(dir, "diff", base)
}

// Checkout 将 repo 切换到指定分支。
func Checkout(repo, branch string) error {
	_, err := run(repo, "checkout", branch)
	return err
}

// Merge 以 --no-ff 方式合并 branch。发生冲突时返回冲突文件列表与错误。
func Merge(repo, branch string) (conflicts []string, err error) {
	if _, err = run(repo, "merge", "--no-ff", branch); err != nil {
		if out, lsErr := run(repo, "diff", "--name-only", "--diff-filter=U"); lsErr == nil && out != "" {
			conflicts = strings.Split(out, "\n")
		}
		return conflicts, err
	}
	return nil, nil
}

// BranchExists 判断本地是否存在该分支。
func BranchExists(repo, branch string) bool {
	_, err := run(repo, "rev-parse", "--verify", "refs/heads/"+branch)
	return err == nil
}

// BranchDelete 强制删除本地分支。
func BranchDelete(repo, branch string) error {
	_, err := run(repo, "branch", "-D", branch)
	return err
}
