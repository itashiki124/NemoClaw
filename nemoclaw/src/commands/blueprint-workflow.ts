// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { NemoClawConfig, PluginLogger } from "../index.js";
import { execBlueprint, type BlueprintRunResult } from "../blueprint/exec.js";
import { resolveBlueprint, type ResolvedBlueprint } from "../blueprint/resolve.js";
import { checkCompatibility, verifyBlueprintDigest } from "../blueprint/verify.js";
import { readCommandVersion } from "./command-io.js";

export interface BlueprintDeploymentMessages {
  verify: string;
  plan: string;
  apply: string;
  failurePrefix: string;
}

export interface BlueprintDeploymentOptions {
  profile: string;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
  messages: BlueprintDeploymentMessages;
  checkCompatibility: boolean;
}

export interface BlueprintDeploymentResult {
  blueprint: ResolvedBlueprint;
  applyResult: BlueprintRunResult;
}

export async function runBlueprintDeployment(
  options: BlueprintDeploymentOptions,
): Promise<BlueprintDeploymentResult | null> {
  const { profile, logger, pluginConfig, messages, checkCompatibility: shouldCheckCompatibility } =
    options;

  logger.info("Resolving blueprint...");
  const blueprint = await resolveBlueprint(pluginConfig);

  logger.info(messages.verify);
  const verification = verifyBlueprintDigest(blueprint.localPath, blueprint.manifest);
  if (!verification.valid) {
    logger.error(`Blueprint verification failed: ${verification.errors.join(", ")}`);
    return null;
  }

  if (shouldCheckCompatibility) {
    const [openshellVersion, openclawVersion] = await Promise.all([
      getCommandVersion("openshell"),
      getCommandVersion("openclaw"),
    ]);
    const compatibilityErrors = checkCompatibility(
      blueprint.manifest,
      openshellVersion,
      openclawVersion,
    );
    if (compatibilityErrors.length > 0) {
      logger.error(`Compatibility check failed:\n  ${compatibilityErrors.join("\n  ")}`);
      return null;
    }
  }

  logger.info(messages.plan);
  const planResult = await execBlueprint(
    {
      blueprintPath: blueprint.localPath,
      action: "plan",
      profile,
      jsonOutput: true,
    },
    logger,
  );

  if (!planResult.success) {
    logger.error(`${messages.failurePrefix} plan failed: ${planResult.output}`);
    return null;
  }

  logger.info(messages.apply);
  const applyResult = await execBlueprint(
    {
      blueprintPath: blueprint.localPath,
      action: "apply",
      profile,
      planPath: planResult.runId,
      jsonOutput: true,
    },
    logger,
  );

  if (!applyResult.success) {
    logger.error(`${messages.failurePrefix} apply failed: ${applyResult.output}`);
    return null;
  }

  return { blueprint, applyResult };
}

async function getCommandVersion(command: string): Promise<string> {
  try {
    return await readCommandVersion(command);
  } catch {
    return "0.0.0";
  }
}