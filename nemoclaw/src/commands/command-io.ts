// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 5000;

interface ExecFileOptions {
  timeout?: number;
}

export async function execJsonFile<T>(
  command: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<T> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  });

  return JSON.parse(stdout) as T;
}

export async function readCommandVersion(command: string): Promise<string> {
  const { stdout } = await execFileAsync(command, ["--version"], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT_MS,
  });

  return stdout.trim();
}
