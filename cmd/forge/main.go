// Command forge 是 BranchForge 的 CLI 入口。
package main

import (
	"fmt"
	"os"

	"github.com/zack/branchforge/internal/cli"
)

func main() {
	if err := cli.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "forge: "+err.Error())
		os.Exit(1)
	}
}
