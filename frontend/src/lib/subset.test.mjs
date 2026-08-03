import { test, expect } from "bun:test";
import { getCaseCellKey, ltctCaseKind, SCHEMES } from "./cube.mjs";
import { loadCategoryCases } from "./blddb.js";

test("getCaseCellKey extracts cell keys for T2C, LTCT, and Parity", async () => {
  const maps = SCHEMES.speffz;

  // T2C sample: "DAM" (blddb key for DA[M])
  const t2cCell = getCaseCellKey("DAM", "t2c", maps);
  expect(t2cCell).toBe("A:D"); // directed pair A:D

  // LTCT sample: "JAE" (blddb key for CD[E], buffer C)
  const ltctCell = getCaseCellKey("JAE", "ltct", maps);
  expect(ltctCell).toBe("D:E"); // directed pair D:E (target1: D, target2: E)

  // Parity sample: "GAJA" (blddb key for Parity: e1=B, e2=C, c1=C, c2=D)
  const parityCell = getCaseCellKey("GAJA", "parity", maps);
  expect(parityCell).toBe("B:C"); // e1:c1 -> B:C
});

test("T2C dataset valid cells and holes", async () => {
  const maps = SCHEMES.speffz;
  const t2cData = await loadCategoryCases("t2c");
  const validCells = new Set();
  let t2cCasesCount = 0;

  Object.keys(t2cData).forEach((k) => {
    if (ltctCaseKind(k) !== "t2c") return;
    t2cCasesCount++;
    const ck = getCaseCellKey(k, "t2c", maps);
    if (ck) validCells.add(ck);
  });

  expect(t2cCasesCount).toBe(126);
  expect(validCells.size).toBe(63); // 63 valid cells (2 algs per cell)
});

test("LTCT dataset valid cells and holes", async () => {
  const maps = SCHEMES.speffz;
  const ltctData = await loadCategoryCases("ltct");
  const validCells = new Set();
  let ltctCasesCount = 0;

  Object.keys(ltctData).forEach((k) => {
    if (ltctCaseKind(k) !== "ltct") return;
    ltctCasesCount++;
    const ck = getCaseCellKey(k, "ltct", maps);
    if (ck) validCells.add(ck);
  });

  expect(ltctCasesCount).toBe(252);
  expect(validCells.size).toBe(252); // 252 valid cells in 24x24 square grid
});

test("Parity dataset valid cells and holes", async () => {
  const maps = SCHEMES.speffz;
  const parityData = await loadCategoryCases("parity");
  const validCells = new Set();
  let parityCasesCount = 0;

  Object.keys(parityData).forEach((k) => {
    const ck = getCaseCellKey(k, "parity", maps);
    if (ck) validCells.add(ck);
    parityCasesCount++;
  });

  expect(parityCasesCount).toBe(315);
  expect(validCells.size).toBe(8); // 8 valid cells in 24x24 square grid
});
