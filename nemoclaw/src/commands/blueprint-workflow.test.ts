// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NemoClawConfig, PluginLogger } from "../index.js";

vi.mock("../blueprint/resolve.js", () => ({
  resolveBlueprint: vi.fn(),
}));

vi.mock("../blueprint/verify.js", () => ({
  verifyBlueprintDigest: vi.fn(),
  checkCompatibility: vi.fn(),
}));

vi.mock("../blueprint/exec.js", () => ({
  execBlueprint: vi.fn(),
}));

vi.mock("./command-io.js", () => ({
  readCommandVersion: vi.fn(),
}));

const { runBlueprintDeployment } = await import("./blueprint-workflow.js");
const { resolveBlueprint } = await import("../blueprint/resolve.js");
const { verifyBlueprintDigest, checkCompatibility } = await import("../blueprint/verify.js");
const { execBlueprint } = await import("../blueprint/exec.js");
const { readCommandVersion } = await import("./command-io.js");

const pluginConfig: NemoClawConfig = {
  blueprintVersion: "latest",
  blueprintRegistry: "ghcr.io/nvidia/nemoclaw-blueprint",
  sandboxName: "openclaw",
  inferenceProvider: "nvidia",
};

function createLogger(): { lines: string[]; logger: PluginLogger } {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      info: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(`WARN: ${message}`),
      error: (message: string) => lines.push(`ERROR: ${message}`),
      debug: () => {},
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveBlueprint).mockResolvedValue({
    version: "1.2.3",
    localPath: "/tmp/blueprint",
    manifest: {
      version: "1.2.3",
      minOpenShellVersion: "1.0.0",
      minOpenClawVersion: "1.0.0",
      profiles: ["default"],
      digest: "abc123",
    },
    cached: true,
  });
  vi.mocked(verifyBlueprintDigest).mockReturnValue({
    valid: true,
    expectedDigest: "abc123",
    actualDigest: "abc123",
    errors: [],
  });
  vi.mocked(checkCompatibility).mockReturnValue([]);
  vi.mocked(readCommandVersion).mockResolvedValue("1.2.3");
  vi.mocked(execBlueprint)
    .mockResolvedValueOnce({
      success: true,
      runId: "plan-123",
      action: "plan",
      output: "ok",
      exitCode: 0,
    })
    .mockResolvedValueOnce({
      success: true,
      runId: "apply-456",
      action: "apply",
      output: "ok",
      exitCode: 0,
    });
});

describe("runBlueprintDeployment", () => {
  it("runs resolve, verify, plan, and apply in order", async () => {
    const { logger } = createLogger();

    const result = await runBlueprintDeployment({
      profile: "default",
      logger,
      pluginConfig,
      checkCompatibility: false,
      messages: {
        verify: "Verifying blueprint...",
        plan: "Planning deployment...",
        apply: "Applying deployment...",
        failurePrefix: "Blueprint",
      },
    });

    expect(result?.blueprint.version).toBe("1.2.3");
    expect(result?.applyResult.runId).toBe("apply-456");
    expect(execBlueprint).toHaveBeenNthCalledWith(
      1,
      {
        blueprintPath: "/tmp/blueprint",
        action: "plan",
        profile: "default",
        jsonOutput: true,
      },
      logger,
    );
    expect(execBlueprint).toHaveBeenNthCalledWith(
      2,
      {
        blueprintPath: "/tmp/blueprint",
        action: "apply",
        profile: "default",
        planPath: "plan-123",
        jsonOutput: true,
      },
      logger,
    );
  });

  it("runs compatibility checks when requested", async () => {
    const { logger } = createLogger();

    await runBlueprintDeployment({
      profile: "default",
      logger,
      pluginConfig,
      checkCompatibility: true,
      messages: {
        verify: "Verifying blueprint integrity...",
        plan: "Planning deployment...",
        apply: "Applying deployment...",
        failurePrefix: "Blueprint",
      },
    });

    expect(readCommandVersion).toHaveBeenCalledTimes(2);
    expect(checkCompatibility).toHaveBeenCalledTimes(1);
  });

  it("stops before apply when plan fails", async () => {
    const { lines, logger } = createLogger();
    vi.mocked(execBlueprint).mockReset();
    vi.mocked(execBlueprint).mockResolvedValue({
      success: false,
      runId: "plan-123",
      action: "plan",
      output: "plan failed",
      exitCode: 1,
    });

    const result = await runBlueprintDeployment({
      profile: "default",
      logger,
      pluginConfig,
      checkCompatibility: false,
      messages: {
        verify: "Verifying blueprint...",
        plan: "Planning deployment...",
        apply: "Applying deployment...",
        failurePrefix: "Blueprint",
      },
    });

    expect(result).toBeNull();
    expect(execBlueprint).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("ERROR: Blueprint plan failed: plan failed");
  });
});