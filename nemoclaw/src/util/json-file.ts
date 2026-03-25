// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ensuredDirectories = new Set<string>();

export function ensureDirectory(path: string): void {
  if (ensuredDirectories.has(path)) {
    return;
  }

  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }

  ensuredDirectories.add(path);
}

export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDirectory(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function deleteFileIfExists(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}