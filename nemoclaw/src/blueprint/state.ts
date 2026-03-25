// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../util/json-file.js";

const STATE_DIR = join(process.env.HOME ?? "/tmp", ".nemoclaw", "state");

export interface NemoClawState {
  lastRunId: string | null;
  lastAction: string | null;
  blueprintVersion: string | null;
  sandboxName: string | null;
  migrationSnapshot: string | null;
  hostBackupPath: string | null;
  createdAt: string | null;
  updatedAt: string;
}

function statePath(): string {
  return join(STATE_DIR, "nemoclaw.json");
}

function blankState(): NemoClawState {
  return {
    lastRunId: null,
    lastAction: null,
    blueprintVersion: null,
    sandboxName: null,
    migrationSnapshot: null,
    hostBackupPath: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function loadState(): NemoClawState {
  return (readJsonFile(statePath()) as NemoClawState | null) ?? blankState();
}

export function saveState(state: NemoClawState): void {
  state.updatedAt = new Date().toISOString();
  if (!state.createdAt) state.createdAt = state.updatedAt;
  writeJsonFile(statePath(), state);
}

export function clearState(): void {
  writeJsonFile(statePath(), blankState());
}
