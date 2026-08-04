import { describe, expect, test } from "bun:test";
import {
  CUBE_COLORS,
  CORNER_LETTERS,
  EDGE_LETTERS,
  FACE_ORDER,
  MOVES,
  OPPOSITE_COLOR,
  SCHEMES,
  SOLVED,
  apply3Cycle,
  applyAlg,
  applyMove,
  blddbCode,
  caseCodeToDisplay,
  caseKeyToPositions,
  codeCharToFacelet,
  codeToSchemeLetter,
  cubeMoveToUserMove,
  cubeStateToUserState,
  faceletToPosition,
  getBaseScheme,
  getCaseCellKey,
  letterPieceId,
  ltctCaseKind,
  orientAlg,
  orientMaps,
  orientationPerm,
  relativeState,
  scramble,
  stateToFaceMap,
  userFaceToCubeFaceMap,
} from "./cube.mjs";

const FACE_MOVES = [...FACE_ORDER];
const ORIENTATIONS = CUBE_COLORS.flatMap((top) =>
  CUBE_COLORS
    .filter((front) => front !== top && front !== OPPOSITE_COLOR[top])
    .map((front) => ({ top, front })),
);

describe("facelet move engine", () => {
  test("defines a valid solved state and complete move table", () => {
    expect(SOLVED).toHaveLength(54);
    expect(stateToFaceMap(SOLVED)).toHaveLength(54);
    expect(new Set(SOLVED)).toEqual(new Set(FACE_MOVES));
    expect(Object.keys(MOVES)).toHaveLength(72);
  });

  test.each(FACE_MOVES)("%s has the expected inverse and order", (face) => {
    expect(applyAlg(SOLVED, [face, face, face, face])).toBe(SOLVED);
    expect(applyAlg(SOLVED, `${face} ${face}'`)).toBe(SOLVED);
    expect(applyAlg(SOLVED, `${face}2 ${face}2`)).toBe(SOLVED);
    expect(applyMove(SOLVED, face)).not.toBe(SOLVED);
  });

  test.each([
    ["r", "Rw"], ["l", "Lw"], ["u", "Uw"],
    ["d", "Dw"], ["f", "Fw"], ["b", "Bw"],
  ])("%s and %s wide-turn notation are aliases", (lower, wide) => {
    expect(applyMove(SOLVED, lower)).toBe(applyMove(SOLVED, wide));
    expect(applyMove(SOLVED, `${lower}'`)).toBe(applyMove(SOLVED, `${wide}'`));
    expect(applyMove(SOLVED, `${lower}2`)).toBe(applyMove(SOLVED, `${wide}2`));
  });

  test("applies strings and token arrays while ignoring unsupported tokens", () => {
    expect(applyAlg(SOLVED, " R   U  R' ")).toBe(applyAlg(SOLVED, ["R", "U", "R'"]));
    expect(applyMove(SOLVED, "nope")).toBe(SOLVED);
    expect(applyAlg(SOLVED, "R nope R'")).toBe(SOLVED);
  });

  test("generates structurally valid scrambles", () => {
    const moves = scramble(100);
    const opposite = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

    expect(moves).toHaveLength(100);
    for (let i = 0; i < moves.length; i++) {
      expect(moves[i]).toMatch(/^[URFDLB](?:'|2)?$/);
      if (i > 0) expect(moves[i][0]).not.toBe(moves[i - 1][0]);
      if (i > 1 && moves[i][0] === moves[i - 2][0]) {
        expect(moves[i - 1][0]).not.toBe(opposite[moves[i][0]]);
      }
    }
  });
});

describe("lettering schemes and case codes", () => {
  test.each(Object.entries(SCHEMES))("%s round-trips every sticker through BLDDB codes", (_, scheme) => {
    for (const letter of Object.keys(scheme.corner)) {
      const code = blddbCode(letter, "corner", scheme);
      expect(code).toMatch(/^[A-Z]$/);
      expect(codeToSchemeLetter(code, "corner", scheme)).toBe(letter.toUpperCase());
    }
    for (const letter of Object.keys(scheme.edge)) {
      const code = blddbCode(letter, "edge", scheme);
      expect(code).toMatch(/^[A-Z]$/);
      expect(codeToSchemeLetter(code, "edge", scheme)).toBe(letter.toUpperCase());
    }
  });

  test("resolves known and custom schemes safely", () => {
    expect(getBaseScheme()).toBe(SCHEMES.speffz);
    expect(getBaseScheme({ key: "chichu" })).toBe(SCHEMES.chichu);
    expect(getBaseScheme({ name: "My Speffz variant" })).toBe(SCHEMES.speffz);
    const custom = { name: "Custom", corner: {}, edge: {} };
    expect(getBaseScheme(custom)).toBe(custom);
  });

  test("handles invalid code and letter inputs without inventing mappings", () => {
    expect(blddbCode("?", "corner")).toBeNull();
    expect(codeToSchemeLetter("?", "corner")).toBe("?");
    expect(codeToSchemeLetter("*", "edge")).toBe("*");
    expect(codeCharToFacelet("?", "corner")).toBeNull();
  });

  test.each([
    ["DAM", "t2c", "AD[G]", "A:D:G"],
    ["JAE", "ltct", "CD[E]", "D:E"],
    ["GAJA", "parity", "BC\u2002CD", "B:C"],
    ["BD", "flips", "IE", null],
    ["JPR", "twists", "CSW", null],
  ])("formats %s as a %s case", (code, category, display, cell) => {
    expect(caseCodeToDisplay(code, category)).toBe(display);
    expect(getCaseCellKey(code, category)).toBe(cell);
  });

  test("rejects malformed or mismatched subset keys", () => {
    expect(getCaseCellKey("JAE", "t2c")).toBeNull();
    expect(getCaseCellKey("DAM", "ltct")).toBeNull();
    expect(getCaseCellKey("ABC", "parity")).toBeNull();
    expect(getCaseCellKey("ABCD", "unknown")).toBeNull();
  });

  test("maps code stickers to cube position names", () => {
    expect(faceletToPosition(CORNER_LETTERS.C)).toBe("UFR");
    expect(faceletToPosition(EDGE_LETTERS.a)).toBe("UB");
    expect(caseKeyToPositions("GAJA", "parity")).toEqual(["UR", "UF", "UFR", "UFL"]);
    expect(caseKeyToPositions("?", "corner")).toEqual(["?"]);
  });

  test("classifies LTCT and T2C by the first corner piece", () => {
    expect(ltctCaseKind("JAE")).toBe("ltct");
    expect(ltctCaseKind("DAM")).toBe("t2c");
  });
});

describe("piece cycles and relative state", () => {
  test.each([
    ["corner", ["C", "A", "F"], 7],
    ["edge", ["c", "a", "f"], 4],
  ])("applies a reversible pure %s three-cycle", (type, cycle, minimumChanged) => {
    const once = apply3Cycle(SOLVED, cycle, type);
    const twice = apply3Cycle(once, cycle, type);
    const thrice = apply3Cycle(twice, cycle, type);
    const changed = [...once].filter((value, index) => value !== SOLVED[index]).length;

    expect(once).not.toBe(SOLVED);
    expect(thrice).toBe(SOLVED);
    expect(changed).toBeGreaterThanOrEqual(minimumChanged);
    expect(new Set(cycle.map((letter) => letterPieceId(letter, type))).size).toBe(3);
  });

  test("matches a known corner commutator's handedness", () => {
    const commutator = applyAlg(SOLVED, "R U R' D' R U' R' D");
    expect(apply3Cycle(SOLVED, ["C", "P", "T"], "corner")).toBe(commutator);
  });

  test("computes movement relative to an arbitrary reference", () => {
    const reference = applyAlg(SOLVED, "R U F' L2 D");
    const sequence = "R U R' U' F2 D";
    const current = applyAlg(reference, sequence);

    expect(relativeState(SOLVED, current)).toBe(current);
    expect(relativeState(reference, reference)).toBe(SOLVED);
    expect(relativeState(reference, current)).toBe(applyAlg(SOLVED, sequence));
    expect(relativeState("invalid", current)).toBe(current);
  });
});

describe("cube orientation compatibility", () => {
  test("enumerates all 24 valid physical orientations", () => {
    expect(ORIENTATIONS).toHaveLength(24);
  });

  test.each(ORIENTATIONS)("keeps snapshots and moves aligned for $top/$front", (orientation) => {
    const permutation = orientationPerm(orientation);
    const faceMap = userFaceToCubeFaceMap(orientation);

    expect(permutation).toHaveLength(54);
    expect(new Set(permutation).size).toBe(54);
    expect(Object.keys(faceMap).sort()).toEqual(FACE_MOVES.slice().sort());
    expect(new Set(Object.values(faceMap))).toEqual(new Set(FACE_MOVES));
    expect(cubeStateToUserState(SOLVED, orientation)).toBe(SOLVED);

    for (const hardwareMove of ["U", "R", "F", "D", "L", "B", "R'", "F2"]) {
      const userMove = cubeMoveToUserMove(hardwareMove, orientation);
      const snapshot = cubeStateToUserState(applyMove(SOLVED, hardwareMove), orientation);
      expect(snapshot).toBe(applyMove(SOLVED, userMove));
    }
  });

  test.each(ORIENTATIONS)("orients algorithms consistently for $top/$front", (orientation) => {
    const userAlgorithm = "R U F2 L' D B";
    const hardwareAlgorithm = orientAlg(userAlgorithm, orientation);
    const hardwareState = applyAlg(SOLVED, hardwareAlgorithm);

    expect(cubeStateToUserState(hardwareState, orientation)).toBe(applyAlg(SOLVED, userAlgorithm));
  });

  test("uses identity behavior for the default and invalid orientations", () => {
    expect(orientMaps(SCHEMES.speffz, { top: "white", front: "green" })).toBe(SCHEMES.speffz);
    expect(cubeMoveToUserMove("M", { top: "white", front: "green" })).toBe("M");
    expect(cubeStateToUserState("invalid", { top: "white", front: "green" })).toBe("invalid");
    expect(orientationPerm({ top: "invalid", front: "invalid" })).toEqual([...Array(54).keys()]);
  });
});
