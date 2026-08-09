import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NewPayloadVariable,
  PayloadVariable,
} from "../models/payload-variable.model";
import { VariablesService } from "./variables.service";

const SAMPLE_ID = "44444444-4444-4444-4444-444444444444";

function sampleNewVariable(): NewPayloadVariable {
  return {
    name: "tempC",
    generator: { kind: "randomFloat", min: 18, max: 24, decimals: 1 },
  };
}

function sampleVariable(
  overrides: Partial<PayloadVariable> = {},
): PayloadVariable {
  return {
    id: SAMPLE_ID,
    ...sampleNewVariable(),
    created_at: "2026-08-09T00:00:00Z",
    ...overrides,
  };
}

describe("VariablesService", () => {
  afterEach(() => {
    clearMocks();
  });

  it("lists variables via the list_payload_variables command", async () => {
    const variables = [sampleVariable()];
    mockIPC((cmd) => {
      if (cmd === "list_payload_variables") return variables;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new VariablesService().list()).resolves.toEqual(variables);
  });

  it("gets a single variable via the get_payload_variable command", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "get_payload_variable") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return sampleVariable();
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new VariablesService().get(SAMPLE_ID)).resolves.toEqual(
      sampleVariable(),
    );
  });

  it("creates via create_payload_variable with a camelCase argument key", async () => {
    // The arg name is half of the IPC contract - Rust's `new_variable`
    // parameter only binds to `newVariable`.
    mockIPC((cmd, args) => {
      if (cmd === "create_payload_variable") {
        expect(args).toEqual({ newVariable: sampleNewVariable() });
        return sampleVariable();
      }
      if (cmd === "list_payload_variables") return [sampleVariable()];
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new VariablesService().create(sampleNewVariable()),
    ).resolves.toEqual(sampleVariable());
  });

  it("updates via update_payload_variable", async () => {
    const update = { name: "tempF", generator: { kind: "uuid" } as const };
    mockIPC((cmd, args) => {
      if (cmd === "update_payload_variable") {
        expect(args).toEqual({ id: SAMPLE_ID, update });
        return sampleVariable({ name: "tempF" });
      }
      if (cmd === "list_payload_variables") return [];
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new VariablesService().update(SAMPLE_ID, update),
    ).resolves.toEqual(sampleVariable({ name: "tempF" }));
  });

  it("deletes via delete_payload_variable", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "delete_payload_variable") {
        expect(args).toEqual({ id: SAMPLE_ID });
        return null;
      }
      if (cmd === "list_payload_variables") return [];
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(
      new VariablesService().delete(SAMPLE_ID),
    ).resolves.toBeUndefined();
  });
});

describe("VariablesService cache", () => {
  afterEach(() => {
    clearMocks();
  });

  it("is empty before the first load", () => {
    expect(new VariablesService().variables()).toEqual([]);
  });

  it("populates the signal on load", async () => {
    mockIPC(() => [sampleVariable()]);
    const service = new VariablesService();

    await service.load();

    expect(service.variables()).toEqual([sampleVariable()]);
  });

  it("only calls out once for concurrent loads", async () => {
    const handler = vi.fn(() => [sampleVariable()]);
    mockIPC(handler);
    const service = new VariablesService();

    await Promise.all([service.load(), service.load(), service.load()]);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cache after a mutation, so the panel sees the change", async () => {
    let stored: PayloadVariable[] = [];
    mockIPC((cmd) => {
      if (cmd === "create_payload_variable") {
        stored = [sampleVariable()];
        return stored[0];
      }
      if (cmd === "list_payload_variables") return stored;
      throw new Error(`unexpected command: ${cmd}`);
    });
    const service = new VariablesService();
    await service.load();
    expect(service.variables()).toEqual([]);

    await service.create(sampleNewVariable());

    expect(service.variables()).toEqual([sampleVariable()]);
  });

  it("does not cache a failed load, so a retry can succeed", async () => {
    let shouldFail = true;
    mockIPC(() => {
      if (shouldFail) throw new Error("database is locked");
      return [sampleVariable()];
    });
    const service = new VariablesService();

    await expect(service.load()).rejects.toThrow();
    shouldFail = false;

    await service.load();
    expect(service.variables()).toEqual([sampleVariable()]);
  });

  it("exposes value kinds by name for placeholder-aware JSON validation", async () => {
    mockIPC(() => [
      sampleVariable(),
      sampleVariable({
        id: "other",
        name: "deviceId",
        generator: { kind: "fixedText", value: "dev-42" },
      }),
      sampleVariable({
        id: "iso",
        name: "isoDate",
        generator: { kind: "timestamp", format: "iso8601" },
      }),
      sampleVariable({
        id: "ms",
        name: "millis",
        generator: { kind: "timestamp", format: "unixMillis" },
      }),
    ]);
    const service = new VariablesService();

    await service.load();

    expect([...service.valueKinds()]).toEqual([
      ["tempC", "number"],
      ["deviceId", "string"],
      ["isoDate", "string"],
      ["millis", "number"],
    ]);
  });
});
