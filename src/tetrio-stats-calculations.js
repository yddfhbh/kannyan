export function calculateTetrioStats(input = {}) {
  const apm = toFiniteNumber(input.apm);
  const pps = toFiniteNumber(input.pps);
  const vs = toFiniteNumber(input.vs);
  const apl = firstFiniteNumber(input.apl, calculateApl(apm, pps, vs));
  const dspm = firstFiniteNumber(input.dspm, calculateDspm(apm, vs));
  const lpm = firstFiniteNumber(input.lpm, calculateLpm(pps, dspm));
  const app = firstFiniteNumber(input.app, calculateApp(apm, pps));
  const dsSecond = firstFiniteNumber(input.dsSecond, input.dssecond, calculateDsSecond(apm, vs));
  const dsPiece = firstFiniteNumber(input.dsPiece, input.dspiece, calculateDsPiece(dsSecond, pps));
  const appDsPiece = firstFiniteNumber(
    input.appDsPiece,
    input.appdspiece,
    sumFinite(app, dsPiece),
  );
  const vsApm = firstFiniteNumber(input.vsApm, input.vsapm, safeDivide(vs, apm));
  const vsPps = firstFiniteNumber(input.vsPps, input.vspps, safeDivide(vs, pps));
  const cheeseIndex = firstFiniteNumber(input.cheeseIndex, calculateCheeseIndex(app, dsPiece, vsApm));
  const garbageEffi = firstFiniteNumber(
    input.garbageEffi,
    input.garbageeffi,
    calculateGarbageEffi(input.attack, input.downstack, input.pieces),
    multiplyFinite(multiplyFinite(app, dsSecond), safeDivide(2, pps)),
  );
  const area = firstFiniteNumber(input.area, calculateArea({
    apm,
    pps,
    vs,
    app,
    dsSecond,
    dsPiece,
    garbageEffi,
  }));
  const weightedApp = firstFiniteNumber(input.weightedApp, calculateWeightedApp(app, cheeseIndex));
  const statRank = firstFiniteNumber(input.statRank, input.statrank, calculateStatRank(area));
  const styleArea = firstFiniteNumber(input.styleArea, input.srarea, calculateStyleArea({
    pps,
    app,
    dsPiece,
  }));
  const styleStatRank = Math.max(
    firstFiniteNumber(input.styleStatRank, input.srstatrank, calculateStatRank(styleArea)) ?? 0.001,
    0.001,
  );
  const estimatedTrBase = firstFiniteNumber(
    input.ntemp,
    input.estimateBase,
    calculateEstimatedTrBase({ apm, pps, vs }),
  );
  const estimatedGlicko = firstFiniteNumber(
    input.estimatedGlicko,
    input.estimatedglicko,
    calculateCurrentEstimatedGlicko(estimatedTrBase),
  );
  const estimatedTr = firstFiniteNumber(input.estimatedTr, calculateEstimatedTr({
    ntemp: estimatedTrBase,
    rd: firstFiniteNumber(input.rd, input.RD, input.estimatedTrRd),
    wins: firstFiniteNumber(input.wins, input.gamesWon, input.gameswon),
  }));
  const normalized = calculateNormalizedStats({
    apm,
    pps,
    vs,
    app,
    dsSecond,
    dsPiece,
    garbageEffi,
    vsPps,
    vsApm,
    area: styleArea,
    statRank: styleStatRank,
  });
  const playstyle = calculatePlaystyle(normalized);

  return {
    apm,
    pps,
    vs,
    apl,
    dspm,
    lpm,
    app,
    dsSecond,
    dsPiece,
    appDsPiece,
    vsApm,
    vsPps,
    cheeseIndex,
    garbageEffi,
    area,
    weightedApp,
    estimatedGlicko,
    estimatedTr,
    statRank,
    styleArea,
    styleStatRank,
    normalized,
    playstyle,
  };
}

export function calculateApl(apm, pps, vs) {
  return safeDivide(
    toFiniteNumber(apm),
    sumFinite(
      multiplyFinite(24, toFiniteNumber(pps)),
      multiplyFinite(0.54, toFiniteNumber(vs)),
      multiplyFinite(-0.9, toFiniteNumber(apm)),
    ),
  );
}

export function calculateDspm(apm, vs) {
  return sumFinite(
    multiplyFinite(toFiniteNumber(vs), 0.6),
    multiplyFinite(toFiniteNumber(apm), -1),
  );
}

export function calculateLpm(pps, dspm) {
  return sumFinite(
    multiplyFinite(toFiniteNumber(pps), 24),
    multiplyFinite(toFiniteNumber(dspm), 0.9),
  );
}

export function calculateApp(apm, pps) {
  return safeDivide(toFiniteNumber(apm), multiplyFinite(toFiniteNumber(pps), 60));
}

export function calculateDsSecond(apm, vs) {
  return subtractFinite(
    safeDivide(toFiniteNumber(vs), 100),
    safeDivide(toFiniteNumber(apm), 60),
  );
}

export function calculateDsPiece(dsSecond, pps) {
  return safeDivide(toFiniteNumber(dsSecond), toFiniteNumber(pps));
}

export function calculateCheeseIndex(app, dsPiece, vsApm) {
  return sumFinite(
    multiplyFinite(toFiniteNumber(dsPiece), 150),
    multiplyFinite(subtractFinite(toFiniteNumber(vsApm), 2), 50),
    multiplyFinite(subtractFinite(0.6, toFiniteNumber(app)), 125),
  );
}

export function calculateGarbageEffi(attack, downstack, pieces) {
  const normalizedPieces = toFiniteNumber(pieces);
  return safeDivide(
    multiplyFinite(toFiniteNumber(attack), toFiniteNumber(downstack)),
    Number.isFinite(normalizedPieces) ? normalizedPieces ** 2 : null,
  );
}

export function calculateArea(stats) {
  return sumFinite(
    toFiniteNumber(stats.apm),
    multiplyFinite(toFiniteNumber(stats.pps), 45),
    multiplyFinite(toFiniteNumber(stats.vs), 0.444),
    multiplyFinite(toFiniteNumber(stats.app), 185),
    multiplyFinite(toFiniteNumber(stats.dsSecond), 175),
    multiplyFinite(toFiniteNumber(stats.dsPiece), 450),
    multiplyFinite(toFiniteNumber(stats.garbageEffi), 315),
  );
}

export function calculateStyleArea(stats) {
  return sumFinite(
    multiplyFinite(toFiniteNumber(stats.pps), 135),
    multiplyFinite(toFiniteNumber(stats.app), 290),
    multiplyFinite(toFiniteNumber(stats.dsPiece), 700),
  );
}

export function calculateWeightedApp(app, cheeseIndex) {
  const normalizedApp = toFiniteNumber(app);
  const normalizedCheeseIndex = toFiniteNumber(cheeseIndex);
  if (!Number.isFinite(normalizedApp) || !Number.isFinite(normalizedCheeseIndex)) {
    return null;
  }

  return normalizedApp - 5 * Math.tan(toRadians((normalizedCheeseIndex / -30) + 1));
}

export function calculateEstimatedTr(stats = {}) {
  const estimatedTrBase = firstFiniteNumber(
    stats.ntemp,
    stats.estimateBase,
    calculateEstimatedTrBase(stats),
  );

  if (!Number.isFinite(estimatedTrBase)) {
    return null;
  }

  const estimatedGlicko = calculateCurrentEstimatedGlicko(estimatedTrBase);
  return calculateTetraRating(
    estimatedGlicko,
    firstFiniteNumber(stats.rd, stats.RD, 60),
    firstFiniteNumber(stats.wins, stats.gamesWon, stats.gameswon, 18),
  );
}

export function calculateSeasonOneEstimatedTr(stats) {
  const pps = toFiniteNumber(stats.pps);
  const app = toFiniteNumber(stats.app);
  const dsPiece = toFiniteNumber(stats.dsPiece);
  const vsApm = toFiniteNumber(stats.vsApm);

  if (![pps, app, dsPiece, vsApm].every(Number.isFinite)) {
    return null;
  }

  const estimateBase = pps * (150 + ((vsApm - 1.66) * 35)) + app * 290 + dsPiece * 700;
  const estimatedGlicko = calculateEstimatedGlicko(estimateBase);
  return calculateSeasonOneTr(estimatedGlicko);
}

export function calculateEstimatedGlicko(estimateBase) {
  const normalizedEstimateBase = toFiniteNumber(estimateBase);
  if (!Number.isFinite(normalizedEstimateBase)) {
    return null;
  }

  return (0.000013 * normalizedEstimateBase ** 3)
    - (0.0196 * normalizedEstimateBase ** 2)
    + (12.645 * normalizedEstimateBase)
    - 1005.4;
}

export function calculateSeasonOneTr(glicko) {
  const normalizedGlicko = toFiniteNumber(glicko);
  if (!Number.isFinite(normalizedGlicko)) {
    return null;
  }

  const denominator = Math.sqrt(
    (3 * Math.log(10) ** 2) * 60 ** 2
    + 2500 * ((64 * Math.PI ** 2) + (147 * Math.log(10) ** 2)),
  );
  const exponent = ((1500 - normalizedGlicko) * Math.PI) / denominator;

  return 25000 / (1 + 10 ** exponent);
}

export function calculateTetraRating(glicko, rd = 60, wins = 18) {
  const normalizedGlicko = toFiniteNumber(glicko);
  const normalizedRd = toFiniteNumber(rd);
  const normalizedWins = toFiniteNumber(wins);

  if (![normalizedGlicko, normalizedRd, normalizedWins].every(Number.isFinite)) {
    return null;
  }

  const falloff = Math.min(1, 0.5 + 0.5 * (normalizedWins / 18));
  const deviation = 1 + (60 - normalizedRd) / 1500;
  const earlyCurve = 1.56;
  const lateCurve = 0.86;
  const earlyExponent = 0.87646605;
  const lateExponent = 0.25;

  return (22000 / ((1 + Math.E ** (-deviation * earlyCurve * ((normalizedGlicko - 1500) / 500))) ** (1 / (earlyExponent * falloff))))
    + (3000 / ((1 + Math.E ** (-deviation * lateCurve * ((normalizedGlicko - 2000) / 500))) ** (1 / (lateExponent * falloff ** 2))));
}

function calculateEstimatedTrBase(stats) {
  const apm = toFiniteNumber(stats.apm);
  const pps = toFiniteNumber(stats.pps);
  const vs = toFiniteNumber(stats.vs);
  const app = calculateApp(apm, pps);
  const dsPiece = calculateDsPiece(calculateDsSecond(apm, vs), pps);

  return withFiniteInputs([apm, pps, vs, app, dsPiece], () => {
    if (apm === 0) {
      return null;
    }

    return pps * (150 + ((vs / apm - 1.66) * 35)) + app * 290 + dsPiece * 700;
  });
}

function calculateCurrentEstimatedGlicko(estimateBase) {
  const estimatedGlicko = calculateEstimatedGlicko(estimateBase);
  return Number.isFinite(estimatedGlicko)
    ? estimatedGlicko * 0.9211 - 49.086
    : null;
}

export function calculateStatRank(area) {
  const normalizedArea = toFiniteNumber(area);
  if (!Number.isFinite(normalizedArea)) {
    return null;
  }

  return 11.2 * Math.atan((normalizedArea - 93) / 130) + 1;
}

export function calculateNormalizedStats(stats) {
  const area = toFiniteNumber(stats.area);
  const statRank = toFiniteNumber(stats.statRank);
  if (!Number.isFinite(area) || area === 0 || !Number.isFinite(statRank)) {
    return createEmptyNormalizedStats();
  }

  return {
    apm: offsetNormalizedStat(normalizeApm(stats.apm, area, statRank)),
    pps: offsetNormalizedStat(normalizePps(stats.pps, area, statRank)),
    vs: offsetNormalizedStat(normalizeVs(stats.vs, area, statRank)),
    app: offsetNormalizedStat(normalizeApp(stats.app, statRank)),
    dsSecond: offsetNormalizedStat(normalizeDsSecond(stats.dsSecond, statRank)),
    dsPiece: offsetNormalizedStat(normalizeDsPiece(stats.dsPiece, statRank)),
    garbageEffi: offsetNormalizedStat(normalizeGarbageEffi(stats.garbageEffi, statRank)),
    vsPps: offsetNormalizedStat(normalizeVsPps(stats.vsPps, statRank)),
    vsApm: offsetNormalizedStat(normalizeVsApm(stats.vsApm, statRank)),
  };
}

export function calculatePlaystyle(normalizedStats) {
  const normalized = normalizedStats ?? createEmptyNormalizedStats();
  const apm = toFiniteNumber(normalized.apm);
  const pps = toFiniteNumber(normalized.pps);
  const app = toFiniteNumber(normalized.app);
  const dsPiece = toFiniteNumber(normalized.dsPiece);
  const garbageEffi = toFiniteNumber(normalized.garbageEffi);
  const vsApm = toFiniteNumber(normalized.vsApm);

  return {
    opener: withFiniteInputs([apm, pps, vsApm, app, dsPiece], () =>
      ((apm + pps * 0.75 + vsApm * -10 + app * 0.75 + dsPiece * -0.25) / 3.5) + 0.5
    ),
    plonk: withFiniteInputs([garbageEffi, app, dsPiece, pps], () =>
      ((garbageEffi + app + dsPiece * 0.75 + pps * -1) / 2.73) + 0.5
    ),
    stride: withFiniteInputs([apm, pps, app, dsPiece], () =>
      (apm * -0.25 + pps + app * -2 + dsPiece * -0.5) * 0.79 + 0.5
    ),
    infiniteDs: withFiniteInputs([dsPiece, app, apm, vsApm, pps], () =>
      (dsPiece + app * -0.75 + apm * 0.5 + vsApm * 1.5 + pps * 0.5) * 0.9 + 0.5
    ),
  };
}

export function normalizeApm(apm, area, statRank) {
  return safeDivide(
    safeDivide(toFiniteNumber(apm), toFiniteNumber(area)),
    (0.069 * 1.0017 ** ((toFiniteNumber(statRank) ** 5) / 4700)) + toFiniteNumber(statRank) / 360,
  );
}

export function normalizePps(pps, area, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    safeDivide(toFiniteNumber(pps), toFiniteNumber(area)),
    (0.0084264 * (2.14 ** (-2 * (normalizedStatRank / 2.7 + 1.03))))
      - normalizedStatRank / 5750
      + 0.0067,
  );
}

export function normalizeVs(vs, area, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    safeDivide(toFiniteNumber(vs), toFiniteNumber(area)),
    (0.1333 * 1.0021 ** (((normalizedStatRank ** 7) * (normalizedStatRank / 16.5)) / 1400000))
      + normalizedStatRank / 133,
  );
}

export function normalizeApp(app, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(app),
    (0.1368803292 * 1.0024 ** ((normalizedStatRank ** 5) / 2800)) + normalizedStatRank / 54,
  );
}

export function normalizeDsSecond(dsSecond, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(dsSecond),
    (0.01436466667 * 4.1 ** ((normalizedStatRank - 9.6) / 2.9))
      + normalizedStatRank / 140
      + 0.01,
  );
}

export function normalizeDsPiece(dsPiece, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(dsPiece),
    (0.02136327583 * 14 ** ((normalizedStatRank - 14.75) / 3.9))
      + normalizedStatRank / 152
      + 0.022,
  );
}

export function normalizeGarbageEffi(garbageEffi, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(garbageEffi),
    normalizedStatRank / 350 + 0.005948424455 * 3.8 ** ((normalizedStatRank - 6.1) / 4) + 0.006,
  );
}

export function normalizeVsPps(vsPps, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(vsPps),
    2.7 * normalizedStatRank + 1.88 ** (normalizedStatRank - 11) + 15.243605,
  );
}

export function normalizeVsApm(vsApm, statRank) {
  const normalizedStatRank = toFiniteNumber(statRank);
  return safeDivide(
    toFiniteNumber(vsApm),
    -(((normalizedStatRank - 16) / 36) ** 2) + 2.133,
  );
}

function createEmptyNormalizedStats() {
  return {
    apm: null,
    pps: null,
    vs: null,
    app: null,
    dsSecond: null,
    dsPiece: null,
    garbageEffi: null,
    vsPps: null,
    vsApm: null,
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function safeDivide(numerator, denominator) {
  const normalizedNumerator = toFiniteNumber(numerator);
  const normalizedDenominator = toFiniteNumber(denominator);
  if (
    !Number.isFinite(normalizedNumerator)
    || !Number.isFinite(normalizedDenominator)
    || normalizedDenominator === 0
  ) {
    return null;
  }

  return normalizedNumerator / normalizedDenominator;
}

function sumFinite(...values) {
  let sum = 0;

  for (const value of values) {
    const number = toFiniteNumber(value);
    if (!Number.isFinite(number)) {
      return null;
    }

    sum += number;
  }

  return sum;
}

function subtractFinite(left, right) {
  const normalizedLeft = toFiniteNumber(left);
  const normalizedRight = toFiniteNumber(right);
  if (!Number.isFinite(normalizedLeft) || !Number.isFinite(normalizedRight)) {
    return null;
  }

  return normalizedLeft - normalizedRight;
}

function multiplyFinite(left, right) {
  const normalizedLeft = toFiniteNumber(left);
  const normalizedRight = toFiniteNumber(right);
  if (!Number.isFinite(normalizedLeft) || !Number.isFinite(normalizedRight)) {
    return null;
  }

  return normalizedLeft * normalizedRight;
}

function offsetNormalizedStat(value) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number) ? number - 1 : null;
}

function toRadians(degrees) {
  const number = toFiniteNumber(degrees);
  return Number.isFinite(number) ? (number * Math.PI) / 180 : null;
}

function withFiniteInputs(values, callback) {
  if (!values.every(Number.isFinite)) {
    return null;
  }

  const result = callback();
  return Number.isFinite(result) ? result : null;
}
