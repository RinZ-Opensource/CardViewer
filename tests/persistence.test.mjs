import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const {
  loadStoredRecord,
  parseStoredRecord,
  readLocalStorage,
  writeLocalStorage,
  writeLocalStorageJson,
} = await importTypeScriptModule("src/persistence.ts");

test("parseStoredRecord keeps compatible fields and rejects schema mismatches", () => {
  const fallback = () => ({
    title: "default",
    enabled: false,
    count: 3,
    mode: "a",
  });
  const raw = JSON.stringify({
    title: "saved",
    enabled: true,
    count: "3",
    mode: "unsupported",
    unknown: "ignored",
  });

  assert.deepEqual(
    parseStoredRecord(raw, fallback, { allowedValues: { mode: ["a", "b"] } }),
    {
      title: "saved",
      enabled: true,
      count: 3,
      mode: "a",
    },
  );
});

test("parseStoredRecord falls back for malformed or non-object JSON", () => {
  const fallback = () => ({ text: "safe", active: false });

  assert.deepEqual(parseStoredRecord("{broken", fallback), fallback());
  assert.deepEqual(parseStoredRecord("null", fallback), fallback());
  assert.deepEqual(parseStoredRecord("[]", fallback), fallback());
  assert.deepEqual(parseStoredRecord('"text"', fallback), fallback());
});

test("storage helpers contain denied reads and quota-exceeded writes", () => {
  const deniedStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };

  assert.equal(readLocalStorage("key", deniedStorage), null);
  assert.equal(writeLocalStorage("key", "value", deniedStorage), false);
  assert.equal(writeLocalStorageJson("key", { value: true }, deniedStorage), false);
  assert.deepEqual(
    loadStoredRecord("key", () => ({ value: "fallback" }), {}, deniedStorage),
    { value: "fallback" },
  );
});

test("writeLocalStorageJson contains serialization errors", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const writes = [];
  const storage = {
    getItem() {
      return null;
    },
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  assert.equal(writeLocalStorageJson("key", cyclic, storage), false);
  assert.equal(writeLocalStorageJson("key", undefined, storage), false);
  assert.deepEqual(writes, []);
});
