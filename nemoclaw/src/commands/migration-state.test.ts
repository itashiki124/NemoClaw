// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSnapshotBundle,
  detectHostOpenClaw,
  type HostOpenClawState,
} from "./migration-state.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createTempHome(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "nemoclaw-migration-state-"));
  tempRoots.push(root);
  return root;
}

function createLogger(): {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
} {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function createDirectoryLink(targetPath: string, linkPath: string): void {
  symlinkSync(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function setupHostState(): { homeDir: string; externalRoot: string; hostState: HostOpenClawState } {
  const homeDir = createTempHome();
  const stateDir = path.join(homeDir, ".openclaw");
  const externalRoot = path.join(homeDir, "external-workspace");
  const nestedDir = path.join(externalRoot, "actual");

  mkdirSync(stateDir, { recursive: true });
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(path.join(nestedDir, "data.txt"), "hello");
  createDirectoryLink(nestedDir, path.join(externalRoot, "linked-dir"));

  writeFileSync(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify(
      {
        agents: {
          defaults: {
            workspace: externalRoot,
          },
          list: [
            {
              id: "alpha",
              workspace: externalRoot,
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const hostState = detectHostOpenClaw({
    HOME: homeDir,
  });

  return { homeDir, externalRoot, hostState };
}

describe("migration state", () => {
  it("deduplicates repeated external root bindings", () => {
    const { externalRoot, hostState } = setupHostState();

    expect(hostState.exists).toBe(true);
    expect(hostState.externalRoots).toHaveLength(1);
    expect(hostState.externalRoots[0]?.sourcePath).toBe(externalRoot);
    expect(hostState.externalRoots[0]?.bindings).toHaveLength(2);
    expect(hostState.externalRoots[0]?.bindings.map((binding) => binding.configPath)).toEqual([
      "agents.defaults.workspace",
      "agents.list[0].workspace",
    ]);
    expect(hostState.externalRoots[0]?.symlinkPaths).toContain("linked-dir");
  });

  it("reuses collected symlink metadata when snapshotting", () => {
    const { externalRoot, hostState } = setupHostState();

    expect(hostState.externalRoots[0]?.symlinkPaths).toContain("linked-dir");

    unlinkSync(path.join(externalRoot, "linked-dir"));

    const bundle = createSnapshotBundle(hostState, createLogger(), { persist: false });

    expect(bundle).not.toBeNull();
    expect(bundle?.manifest.externalRoots[0]?.symlinkPaths).toContain("linked-dir");

    if (bundle) {
      rmSync(bundle.snapshotDir, { recursive: true, force: true });
    }
  });
});