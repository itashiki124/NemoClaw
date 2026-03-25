// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { join, posix as pathPosix } from "node:path";
import type { PluginLogger, NemoClawConfig } from "../index.js";
import { loadState, saveState } from "../blueprint/state.js";
import { runBlueprintDeployment } from "./blueprint-workflow.js";
import {
  cleanupSnapshotBundle,
  createArchiveFromDirectory,
  createSnapshotBundle,
  detectHostOpenClaw,
  type HostOpenClawState,
  type SnapshotBundle,
} from "./migration-state.js";

export { detectHostOpenClaw, type HostOpenClawState } from "./migration-state.js";

const SANDBOX_ARCHIVE_DIR = "/sandbox/.nemoclaw/migration/archives";

type ResolvedHostState = HostOpenClawState & {
  stateDir: string;
};

export interface MigrateOptions {
  dryRun: boolean;
  profile: string;
  skipBackup: boolean;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
}

export async function cliMigrate(opts: MigrateOptions): Promise<void> {
  const { dryRun, profile, skipBackup, logger, pluginConfig } = opts;

  logger.info("NemoClaw migrate: moving host OpenClaw into OpenShell sandbox");

  logger.info("Detecting host OpenClaw installation...");
  const hostState = detectHostOpenClaw();

  if (!hostState.exists || !hostState.stateDir) {
    logger.error("No OpenClaw installation found for the current host environment.");
    logger.info("Use 'openclaw nemoclaw launch' for a fresh install.");
    return;
  }

  const resolvedHostState: ResolvedHostState = {
    ...hostState,
    stateDir: hostState.stateDir,
  };

  logHostStateDetails(logger, resolvedHostState);
  for (const warning of resolvedHostState.warnings) {
    logger.warn(warning);
  }
  if (resolvedHostState.errors.length > 0) {
    for (const error of resolvedHostState.errors) {
      logger.error(error);
    }
    logger.error("Refusing to migrate until all external OpenClaw roots can be resolved.");
    return;
  }

  if (dryRun) {
    logDryRunPlan(logger, resolvedHostState);
    return;
  }

  const deployment = await runBlueprintDeployment({
    profile,
    logger,
    pluginConfig,
    checkCompatibility: false,
    messages: {
      verify: "Verifying blueprint...",
      plan: "Planning migration...",
      apply: "Provisioning OpenShell sandbox...",
      failurePrefix: "Migration",
    },
  });
  if (!deployment) {
    return;
  }

  logger.info("Creating migration snapshot...");
  const bundle = createSnapshotBundle(resolvedHostState, logger, { persist: !skipBackup });
  if (!bundle) {
    return;
  }
  logger.info(`Snapshot saved to ${bundle.snapshotDir}`);

  try {
    logger.info("Packaging OpenClaw state for sandbox import...");
    await buildMigrationArchives(bundle);

    logger.info("Syncing migration bundle into sandbox...");
    syncSnapshotBundleIntoSandbox(bundle, pluginConfig.sandboxName);

    logger.info("Verifying sandbox migration...");
    verifySandboxMigration(bundle.manifest, pluginConfig.sandboxName);

    saveState({
      ...loadState(),
      lastRunId: deployment.applyResult.runId,
      lastAction: "migrate",
      blueprintVersion: deployment.blueprint.version,
      sandboxName: pluginConfig.sandboxName,
      migrationSnapshot: skipBackup ? null : bundle.snapshotDir,
      hostBackupPath: skipBackup ? null : bundle.snapshotDir,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Migration sync failed: ${msg}`);
    logger.info("Your host installation is unchanged. Resolve the error and rerun migrate.");
    return;
  } finally {
    cleanupSnapshotBundle(bundle);
  }

  logMigrationCompletion(logger, pluginConfig.sandboxName, skipBackup);
}

async function buildMigrationArchives(bundle: SnapshotBundle): Promise<void> {
  await createArchiveFromDirectory(bundle.preparedStateDir, stateArchivePath(bundle));
  for (const root of bundle.manifest.externalRoots) {
    await createArchiveFromDirectory(join(bundle.snapshotDir, root.snapshotRelativePath), rootArchivePath(bundle, root.id));
  }
}

function syncSnapshotBundleIntoSandbox(bundle: SnapshotBundle, sandboxName: string): void {
  execSandboxCommand(sandboxName, ["sh", "-lc", `mkdir -p ${shellQuote(SANDBOX_ARCHIVE_DIR)}`]);

  syncArchive(sandboxName, "state.tar", stateArchivePath(bundle), "/sandbox/.openclaw");
  for (const root of bundle.manifest.externalRoots) {
    syncArchive(
      sandboxName,
      `${root.id}.tar`,
      rootArchivePath(bundle, root.id),
      root.sandboxPath,
    );
  }
}

function syncArchive(sandboxName: string, archiveName: string, archivePath: string, destinationDir: string): void {
  const sandboxArchivePath = pathPosix.join(SANDBOX_ARCHIVE_DIR, archiveName);
  execFileSync("openshell", ["sandbox", "cp", archivePath, `${sandboxName}:${sandboxArchivePath}`], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const extractCommand = [
    "sh",
    "-lc",
    `mkdir -p ${shellQuote(destinationDir)} && tar -xf ${shellQuote(sandboxArchivePath)} -C ${shellQuote(
      destinationDir,
    )}`,
  ];
  execSandboxCommand(sandboxName, extractCommand);
}

function verifySandboxMigration(
  manifest: SnapshotBundle["manifest"],
  sandboxName: string,
): void {
  const verification = {
    stateDir: "/sandbox/.openclaw",
    configPath: "/sandbox/.openclaw/openclaw.json",
    roots: manifest.externalRoots.map((root) => ({
      id: root.id,
      sandboxPath: root.sandboxPath,
      bindings: root.bindings.map((binding) => ({
        path: binding.configPath,
        value: root.sandboxPath,
      })),
      symlinkPaths: root.symlinkPaths,
    })),
  };

  const script = `
const fs = require("node:fs");
const verification = ${JSON.stringify(verification)};
if (!fs.existsSync(verification.stateDir)) {
  throw new Error(\`Missing migrated state dir: \${verification.stateDir}\`);
}
const config = JSON.parse(fs.readFileSync(verification.configPath, "utf-8"));
const get = (obj, path) => path.match(/[^.[\\]]+/g).reduce((value, token) => value?.[Number.isInteger(Number(token)) ? Number(token) : token], obj);
for (const root of verification.roots) {
  if (!fs.existsSync(root.sandboxPath)) {
    throw new Error(\`Missing migrated root: \${root.sandboxPath}\`);
  }
  for (const binding of root.bindings) {
    const actual = get(config, binding.path);
    if (actual !== binding.value) {
      throw new Error(\`Config path \${binding.path} expected \${binding.value} but found \${actual}\`);
    }
  }
  for (const relativePath of root.symlinkPaths) {
    const targetPath = relativePath === "." ? root.sandboxPath : require("node:path").join(root.sandboxPath, relativePath);
    const stat = fs.lstatSync(targetPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(\`Expected symlink after migration: \${targetPath}\`);
    }
  }
}
`;

  execSandboxCommand(sandboxName, ["node", "-e", script]);
}

function execSandboxCommand(sandboxName: string, args: string[]): void {
  try {
    execFileSync("openshell", ["sandbox", "connect", sandboxName, "--", ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const stderr =
      err &&
      typeof err === "object" &&
      "stderr" in err &&
      typeof (err as { stderr?: unknown }).stderr === "string"
        ? (err as { stderr: string }).stderr.trim()
        : "";
    throw new Error(stderr || String(err));
  }
}

function stateArchivePath(bundle: SnapshotBundle): string {
  return join(bundle.archivesDir, "state.tar");
}

function rootArchivePath(bundle: SnapshotBundle, rootId: string): string {
  return join(bundle.archivesDir, `${rootId}.tar`);
}

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

function logLines(logger: PluginLogger, lines: string[]): void {
  for (const line of lines) {
    logger.info(line);
  }
}

function logHostStateDetails(logger: PluginLogger, hostState: ResolvedHostState): void {
  const lines = [`Resolved state dir: ${hostState.stateDir}`];
  const optionalPaths = [
    ["Config", hostState.configPath],
    ["Workspace", hostState.workspaceDir],
    ["Extensions", hostState.extensionsDir],
    ["Skills", hostState.skillsDir],
    ["Hooks", hostState.hooksDir],
  ] as const;

  for (const [label, pathValue] of optionalPaths) {
    if (pathValue) {
      lines.push(`  ${label}: ${pathValue}`);
    }
  }

  for (const root of hostState.externalRoots) {
    lines.push(`  External ${root.kind}: ${root.sourcePath} -> ${root.sandboxPath}`);
  }

  logLines(logger, lines);
}

function logDryRunPlan(logger: PluginLogger, hostState: ResolvedHostState): void {
  const lines = ["", "[Dry run] Would perform the following:", `  1. Snapshot state dir: ${hostState.stateDir}`];

  if (hostState.configPath && hostState.hasExternalConfig) {
    lines.push(`  2. Capture external config file: ${hostState.configPath}`);
  }

  if (hostState.externalRoots.length > 0) {
    lines.push("  3. Capture external OpenClaw roots and rewrite config paths for the sandbox:");
    for (const root of hostState.externalRoots) {
      lines.push(`     - ${root.sourcePath} -> ${root.sandboxPath}`);
    }
    lines.push("  4. Package state and external roots as tar archives to preserve symlinks");
    lines.push("  5. Copy archives into the OpenShell sandbox and verify the migrated paths");
  } else {
    lines.push("  3. Package state dir as a tar archive to preserve symlinks");
    lines.push("  4. Copy the state archive into the OpenShell sandbox and verify the config");
  }

  lines.push("  6. Leave the host installation untouched and keep a rollback snapshot");
  logLines(logger, lines);
}

function logMigrationCompletion(
  logger: PluginLogger,
  sandboxName: string,
  skipBackup: boolean,
): void {
  const lines = [
    "",
    "Migration complete. OpenClaw is now running inside OpenShell.",
    `Sandbox: ${sandboxName}`,
    "",
    "Next steps:",
    "  openclaw nemoclaw connect    # Enter the sandbox",
    "  openclaw nemoclaw status     # Verify everything is healthy",
    "  openshell term               # Monitor sandbox activity",
    "",
    "To rollback to your host installation:",
    skipBackup
      ? "  Re-run migrate without --skip-backup to keep a rollback snapshot."
      : "  openclaw nemoclaw eject",
  ];

  logLines(logger, lines);
}
