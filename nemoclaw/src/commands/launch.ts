// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { PluginLogger, NemoClawConfig } from "../index.js";
import { loadState, saveState } from "../blueprint/state.js";
import { detectHostOpenClaw } from "./migrate.js";
import { runBlueprintDeployment } from "./blueprint-workflow.js";

export interface LaunchOptions {
  force: boolean;
  profile: string;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
}

export async function cliLaunch(opts: LaunchOptions): Promise<void> {
  const { force, profile, logger, pluginConfig } = opts;

  logger.info("NemoClaw launch: setting up OpenClaw inside OpenShell");

  // Check if there's an existing host OpenClaw installation
  const hostState = detectHostOpenClaw();

  if (!hostState.exists && !force) {
    logger.info("");
    logger.info("No existing OpenClaw installation detected on this host.");
    logger.info("");
    logger.info("For net-new users, the recommended path is OpenShell-native setup:");
    logger.info("");
    logger.info("  openshell sandbox create --from openclaw --name openclaw");
    logger.info("  openshell sandbox connect openclaw");
    logger.info("");
    logger.info(
      "This avoids installing OpenClaw on the host only to redeploy it inside OpenShell.",
    );
    logger.info("");
    logger.info("To proceed with NemoClaw-driven bootstrap anyway, use --force.");
    return;
  }

  if (hostState.exists && !force) {
    logger.info(
      "Existing OpenClaw installation detected. Consider using 'openclaw nemoclaw migrate' instead.",
    );
    logger.info(
      "Use --force to proceed with a fresh launch (existing config will not be migrated).",
    );
    return;
  }

  const deployment = await runBlueprintDeployment({
    profile,
    logger,
    pluginConfig,
    checkCompatibility: true,
    messages: {
      verify: "Verifying blueprint integrity...",
      plan: "Planning deployment...",
      apply: "Deploying OpenClaw sandbox...",
      failurePrefix: "Blueprint",
    },
  });
  if (!deployment) {
    return;
  }

  // Save state
  saveState({
    ...loadState(),
    lastRunId: deployment.applyResult.runId,
    lastAction: "launch",
    blueprintVersion: deployment.blueprint.version,
    sandboxName: pluginConfig.sandboxName,
  });

  logger.info("");
  logger.info("OpenClaw is now running inside OpenShell.");
  logger.info(`Sandbox: ${pluginConfig.sandboxName}`);
  logger.info("");
  logger.info("Next steps:");
  logger.info("  openclaw nemoclaw connect    # Enter the sandbox");
  logger.info("  openclaw nemoclaw status     # Check health");
  logger.info("  openshell term               # Monitor network egress");
}
