"use client";

import { useEffect, useRef, useState } from "react";

/* ── geometry data ────────────────────────────────────────────────────────
 * Both the mark (outline + five cells) and the wordmark glyphs are drawn in
 * tenths of a viewBox unit and scaled back with scale(0.1), so every number
 * in a path can be written as an integer. See AnimatedLogo's module doc
 * below for why.
 */
const OUTLINE_D =
  "M663.65 1.4344C598.183 9.0344 538.717 41.3011 508.183 85.9677L503.65 92.5011L471.383 92.6344C446.717 92.7677 436.183 93.3011 426.983 95.0344C359.25 108.101 301.25 146.368 270.183 198.768L264.85 207.568L248.583 208.368C195.917 210.901 137.117 242.234 91.9167 291.834C52.3167 335.301 22.85 389.301 9.51671 442.634C-4.48329 499.301 -3.01663 555.834 13.7834 604.368C39.1167 677.301 101.65 735.701 176.983 756.634C239.517 773.968 302.583 767.968 356.45 739.434L369.917 732.234L373.783 734.901C381.517 740.101 401.383 749.568 412.983 753.434C469.117 772.101 534.317 767.834 586.05 741.834L599.917 734.901L609.517 739.968C627.517 749.701 650.317 757.301 675.65 762.101C693.25 765.434 736.583 766.101 756.05 763.434C781.25 759.834 811.383 750.768 828.85 741.434L833.383 739.034L843.383 744.101C867.383 756.368 891.517 762.368 920.983 763.434C952.583 764.634 979.117 759.034 1007.12 744.901L1018.72 739.034L1036.18 747.968C1064.98 762.501 1089.92 769.434 1122.72 771.968C1174.85 775.968 1225.38 762.768 1268.32 733.968C1317.92 700.768 1349.78 653.701 1362.58 594.368C1366.85 574.368 1366.85 533.568 1362.58 513.301C1356.58 485.034 1346.98 461.968 1332.18 439.701C1322.58 425.168 1301.25 402.768 1287.65 392.768L1278.98 386.368L1278.85 366.101C1278.85 349.968 1278.18 343.701 1275.78 334.101C1267.25 299.968 1252.85 275.701 1225.78 249.701C1191.78 216.901 1146.45 196.768 1099.38 193.568C1085.78 192.634 1064.45 193.434 1053.38 195.168L1048.32 195.968L1044.98 188.368C1036.72 169.034 1015.65 143.301 996.45 128.768C966.983 106.634 927.25 94.3677 890.983 96.5011C882.983 96.9011 874.183 97.5677 871.65 98.1011C866.983 98.7677 866.983 98.7677 862.317 89.7011C848.717 63.1677 821.65 37.5677 790.983 22.2344C755.517 4.50107 706.45 -3.49893 663.65 1.4344ZM733.117 34.5011C768.183 41.5677 793.383 54.6344 815.65 77.1677C828.983 90.6344 838.583 106.101 844.317 123.168C847.383 131.968 848.717 134.501 850.317 133.834C851.383 133.434 857.383 131.834 863.65 130.234C880.183 126.101 913.917 126.101 930.983 130.368C947.25 134.368 969.65 145.701 982.983 156.368C1002.98 172.501 1019.25 197.834 1025.25 221.701L1028.05 232.901L1038.18 229.701C1092.58 212.368 1159.92 228.901 1205.25 270.634C1223.38 287.168 1239.92 314.101 1245.92 336.634C1249.12 349.168 1249.25 382.234 1246.05 393.701L1243.92 401.301L1250.05 404.768C1281.25 422.368 1304.18 445.968 1318.32 475.168C1331.12 501.568 1336.18 523.834 1336.05 553.301C1336.05 574.368 1333.92 589.034 1328.18 607.701C1313.65 655.434 1278.18 697.434 1233.12 720.501C1205.12 734.768 1180.32 741.168 1147.65 742.234C1100.58 743.968 1060.05 732.101 1027.38 707.034L1019.65 701.168L1009.12 708.634C981.383 728.101 946.983 737.034 913.383 733.434C905.117 732.501 892.717 730.368 886.05 728.501C872.05 724.768 849.783 714.501 840.45 707.301L834.183 702.634L828.317 706.634C820.183 712.234 800.717 721.701 790.317 725.034C731.25 744.368 657.65 736.768 612.983 707.034C606.05 702.368 599.65 698.901 598.717 699.168C597.783 699.568 593.383 702.234 589.117 705.168C528.85 746.101 433.383 744.234 378.717 701.034L370.583 694.634L360.45 701.834C329.917 723.701 289.117 735.968 247.117 735.968C209.383 735.834 178.45 728.768 146.183 712.501C87.1167 682.901 46.05 627.701 34.1834 561.701C29.1167 533.968 30.05 493.168 36.45 461.301C57.5167 356.901 141.117 260.768 227.917 241.034C240.317 238.234 264.183 237.168 278.717 238.634L285.117 239.301L287.517 232.634C294.183 213.834 305.917 196.634 324.05 179.034C351.117 152.901 384.317 135.701 425.65 126.368C443.25 122.501 483.65 121.568 500.983 124.634C507.917 125.968 515.25 127.301 517.117 127.568C520.183 128.101 520.85 127.568 522.85 122.368C532.983 96.7677 560.45 69.5677 592.583 53.4344C616.183 41.7011 635.383 36.1011 669.65 31.4344C679.917 29.9677 720.85 31.9677 733.117 34.5011Z";

const CELL_DS = [
  "M658.184 75.3009C624.05 81.7009 592.317 98.9009 577.65 118.768C562.584 139.168 561.517 161.701 574.45 181.968C582.317 194.368 590.317 211.968 593.65 224.101C600.317 249.301 600.984 272.101 596.317 313.968C593.65 337.568 593.117 394.101 595.517 412.634C598.05 432.901 604.184 454.501 613.65 476.634C627.917 510.501 632.05 528.501 632.05 557.968C632.05 577.301 630.717 588.234 624.717 614.634C619.917 635.701 620.184 643.034 625.784 653.434C633.65 667.701 653.384 680.768 675.784 686.501C708.717 694.901 752.984 692.768 780.584 681.568C820.317 665.434 843.784 624.634 844.05 571.301C844.317 543.701 839.25 527.834 826.184 513.968C813.917 500.901 801.917 495.301 778.45 491.301C763.25 488.634 756.984 485.701 752.85 479.034C741.384 460.634 756.85 358.368 787.784 246.634C801.65 196.368 803.65 188.368 804.984 177.568C807.384 156.501 802.184 135.034 790.984 118.501C777.384 98.6343 756.584 85.0343 727.65 77.1676C714.317 73.4343 673.517 72.3676 658.184 75.3009Z",
  "M444.717 168.634C379.117 177.968 328.983 218.101 328.983 261.168C328.983 273.701 332.983 284.368 344.05 301.034C355.383 318.234 362.317 332.634 367.117 348.634C370.317 359.301 370.717 362.901 370.85 380.634C370.983 393.568 370.05 406.768 368.45 417.968C365.383 439.968 365.25 463.834 368.317 477.968C370.85 489.968 377.117 506.901 384.05 520.634C398.983 550.368 402.717 573.968 398.45 611.034C395.383 637.434 395.783 642.234 402.05 653.701C414.183 676.101 452.717 691.034 492.85 688.901C560.85 685.434 601.517 645.434 609.25 574.101C610.45 562.768 610.45 556.634 609.117 546.368C605.517 517.834 597.383 501.834 580.717 490.634C562.717 478.634 538.983 478.501 502.183 489.968C484.45 495.568 478.983 495.434 473.783 489.168C465.117 478.901 469.917 465.034 484.317 459.434C487.25 458.368 498.317 455.568 508.983 453.168C532.45 448.101 545.517 443.034 554.05 435.301C578.85 413.034 573.25 365.168 544.85 356.768C532.05 352.901 517.65 354.234 493.25 361.568C476.717 366.368 469.25 366.234 463.783 360.768C460.85 357.701 460.317 356.101 460.317 349.434C460.317 335.834 466.317 331.834 495.783 325.968C528.183 319.434 541.517 313.834 553.783 301.834C566.983 289.034 575.517 265.168 573.65 246.101C570.183 209.434 543.783 181.434 503.25 171.301C486.45 167.034 462.85 165.968 444.717 168.634Z",
  "M880.317 171.968C862.85 175.168 850.317 181.568 839.917 192.501C825.917 207.301 817.25 234.901 804.45 304.634C787.917 394.768 786.45 428.501 797.917 449.434C802.317 457.568 807.783 462.368 820.317 468.768C825.383 471.434 833.25 476.234 837.783 479.434C867.783 500.634 877.65 546.368 864.05 601.701C857.25 629.701 855.783 639.834 857.117 647.834C857.917 651.968 859.917 657.701 861.65 660.768C871.517 677.701 897.517 689.301 925.65 689.301C966.317 689.301 995.383 669.568 1007.92 633.301C1017.25 606.101 1023.65 551.568 1019.78 531.434C1014.85 505.034 996.85 487.434 970.983 483.834C950.183 480.901 946.317 479.834 941.517 475.701C932.05 467.434 931.117 454.101 936.983 415.434C942.317 380.634 950.85 351.034 968.583 305.968C980.45 276.101 983.65 264.234 983.65 251.434C983.65 241.434 980.05 225.834 975.783 217.434C965.783 197.968 945.783 181.568 922.983 174.368C913.783 171.434 890.583 170.101 880.317 171.968Z",
  "M1061.78 267.434C1011.65 276.501 975.917 319.968 973.383 375.168C971.917 405.168 978.717 427.168 997.25 452.368C1010.72 470.634 1039.65 492.634 1068.05 506.501C1075.52 510.101 1089.38 516.768 1098.85 521.301C1108.32 525.834 1118.32 531.701 1120.98 534.101C1131.12 543.301 1133.25 554.501 1126.32 561.568C1122.58 565.301 1121.65 565.568 1115.52 565.034C1110.98 564.501 1104.18 561.968 1093.92 556.768C1080.18 549.701 1078.18 549.168 1070.05 549.168C1050.18 549.168 1043.65 558.634 1037.78 596.768C1031.25 638.368 1039.38 661.301 1066.98 679.834C1085.38 692.101 1106.58 698.368 1133.65 699.568C1209.38 702.768 1276.05 652.501 1290.85 581.301C1294.32 563.968 1294.85 551.301 1292.45 535.034C1289.92 518.234 1287.52 510.234 1280.32 495.968C1273.38 482.234 1268.58 475.434 1258.32 465.434C1236.05 443.434 1211.25 433.301 1167.65 428.101C1155.52 426.634 1142.85 424.901 1139.38 424.101C1119.92 419.701 1108.98 411.434 1108.98 401.168C1108.98 394.234 1110.58 391.434 1115.65 389.301C1121.25 386.901 1128.05 388.368 1141.12 394.634C1153.78 400.634 1164.45 403.168 1172.32 401.834C1194.32 398.234 1207.65 377.434 1203.65 352.634C1194.98 298.368 1124.72 256.101 1061.78 267.434Z",
  "M237.783 284.768C208.05 290.634 177.117 309.034 150.317 336.768C76.1832 413.568 53.9166 523.434 95.9166 604.368C117.517 645.968 158.45 677.568 204.317 688.501C273.25 704.768 341.383 678.501 366.983 625.968C376.717 605.834 380.317 578.768 375.783 559.968C371.25 541.301 359.25 524.768 344.85 517.168C340.05 514.501 336.983 513.968 327.517 513.968H316.05L296.45 523.834C278.583 532.768 275.917 533.834 267.25 534.368C253.65 535.168 244.717 531.568 235.783 521.968C227.25 512.501 224.45 504.368 225.25 491.434C226.45 474.101 236.45 459.701 252.717 452.234C259.383 449.168 262.717 448.768 281.65 447.834C304.317 446.768 307.25 446.234 317.65 440.901C340.583 429.434 353.117 395.568 347.117 361.568C343.25 339.568 334.05 322.368 317.783 306.901C296.45 286.634 267.917 278.768 237.783 284.768Z",
];

const GLYPHS: { name: string; d: string }[] = [
  { name: "E", d: "M411.917 846.901L412.317 884.634L433.517 885.034C445.25 885.168 455.25 884.901 455.783 884.368C456.317 883.701 456.983 880.234 457.25 876.634L457.65 869.968L442.717 869.568L427.65 869.168V861.301V853.301H441.783H455.783L455.383 846.234L454.983 839.301L441.383 838.901L427.65 838.501V831.301V823.968H442.317H456.983V816.634V809.301H434.317H411.65L411.917 846.901Z" },
  { name: "D", d: "M491.917 846.768L492.317 884.635H508.983C528.85 884.501 536.983 882.235 544.583 874.768C552.183 867.435 554.85 861.035 555.383 848.368C555.783 838.901 555.517 836.501 552.583 830.368C548.583 821.701 543.517 816.501 535.65 812.768C530.717 810.635 526.183 809.968 510.583 809.568L491.65 809.035L491.917 846.768ZM529.25 827.568C535.783 831.301 538.983 837.835 538.983 847.301C538.983 861.968 531.25 869.301 515.783 869.301H507.65V846.501V823.568L516.317 824.235C521.117 824.635 526.717 826.101 529.25 827.568Z" },
  { name: "I", d: "M588.583 810.101C586.85 811.834 587.517 881.968 589.25 883.701C590.983 885.434 600.717 885.834 603.383 884.234C604.583 883.301 604.983 874.901 604.717 846.501L604.317 809.968L596.983 809.568C592.85 809.301 589.117 809.568 588.583 810.101Z" },
  { name: "T", d: "M636.583 810.235C636.05 810.635 635.65 813.968 635.65 817.568V823.968H646.317H656.983L657.25 854.235L657.65 884.635H664.983H672.317L672.717 854.235L672.983 823.968H683.65H694.317V816.635V809.301H665.917C650.183 809.301 636.983 809.701 636.583 810.235Z" },
  { name: "I2", d: "M725.917 816.234C724.983 825.968 724.85 879.968 725.783 882.901C726.317 884.768 727.917 885.301 733.65 885.301C740.05 885.301 740.983 884.901 741.65 882.234C742.05 880.634 742.183 863.701 742.05 844.634L741.65 809.968L734.183 809.568L726.583 809.168L725.917 816.234Z" },
  { name: "O", d: "M804.583 809.301C781.65 815.034 768.85 838.768 776.983 860.501C782.983 876.501 796.05 885.568 812.983 885.568C846.85 885.568 863.917 846.634 841.65 820.234C834.45 811.568 816.583 806.368 804.583 809.301ZM825.917 827.701C831.517 831.701 834.317 838.234 834.317 847.701C834.317 861.034 826.183 869.834 813.917 869.834C800.183 869.834 791.65 861.301 791.65 847.434C791.65 837.701 795.517 830.234 802.45 826.368C808.583 823.034 820.317 823.701 825.917 827.701Z" },
  { name: "N", d: "M884.983 809.568C884.983 809.834 884.85 826.368 884.583 846.368C884.317 873.568 884.583 883.168 885.783 884.101C886.717 884.901 890.05 885.301 893.25 885.034L898.983 884.634L899.65 860.901L900.317 837.034L907.25 845.568C942.85 888.901 939.517 885.434 944.85 885.034L949.65 884.634L950.05 846.901L950.317 809.301H942.983H935.65V831.968C935.65 852.901 934.583 859.168 932.317 851.968C931.917 850.501 930.983 849.301 930.45 849.301C929.917 849.301 922.05 840.234 912.983 829.301L896.45 809.301H890.717C887.517 809.301 884.983 809.434 884.983 809.568Z" },
];

/* ── shared math types ───────────────────────────────────────────────── */
type Pt = [number, number];
type Ring = Pt[];

interface Glyph {
  name: string;
  subs: Ring[];
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface Letter {
  el: SVGPathElement;
  glyph: Glyph;
  seedRadius: number;
  current: Ring[];
  flat: Float32Array;
  wave?: IndexWave;
  nrm?: Float32Array;
  amp?: Float32Array;
  out?: Float32Array;
}

interface PhaseTable {
  s: Float32Array;
  c: Float32Array;
  ct: number;
  st: number;
}

interface IndexWave {
  N: number;
  a: PhaseTable;
  b: PhaseTable;
}

interface FieldWaveCfg {
  amp: number;
  seed: number;
  speed?: number;
  rough?: [number, number, number];
  ink?: number;
  field: { cx: number; cy: number; hx: number; hy: number };
}

interface FieldWave {
  N: number;
  n: number;
  rings: number;
  cfg: FieldWaveCfg;
  dir: Float32Array;
  main: [PhaseTable, PhaseTable];
  rough: [PhaseTable, PhaseTable, PhaseTable];
  ink: [PhaseTable, PhaseTable];
}

interface Tween {
  dur: number;
  delay: number;
  ease: (t: number) => number;
  onUpdate: (t: number) => void;
  resolve: () => void;
  start: number | null;
}

interface CellAnim {
  grow: number;
  draw: (time: number) => void;
}

interface CellState {
  el: SVGPathElement;
  midX: number;
  stretchK: number;
  anim: CellAnim;
}

const NS = "http://www.w3.org/2000/svg";
const SAMPLES = 180; // points sampled per subpath
const MAX_SUBS = 2; // O and D have a counter; everything else is one ring

const splitSubpaths = (d: string): string[] => d.match(/M[^Mm]*/g) || [d];

const signedArea = (pts: Ring): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

// Same winding for every ring, or the interpolation folds the shape inside out.
const normalizeWinding = (pts: Ring): Ring => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);

const centroid = (pts: Ring): Pt => {
  let x = 0,
    y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

// Rotate the ring so point 0 sits nearest to the target's point 0.
function alignRotation(src: Ring, dst: Ring): Ring {
  let best = 0,
    bestDist = Infinity;
  for (let k = 0; k < src.length; k++) {
    let sum = 0;
    for (let i = 0; i < src.length; i += 6) {
      const s = src[(i + k) % src.length];
      const t = dst[i];
      sum += (s[0] - t[0]) ** 2 + (s[1] - t[1]) ** 2;
      if (sum > bestDist) break;
    }
    if (sum < bestDist) {
      bestDist = sum;
      best = k;
    }
  }
  return src.slice(best).concat(src.slice(0, best));
}

// Missing rings become a zero-size ring at the reference ring's centre, so a
// counter (the hole in O or D) opens out of a point instead of popping in.
function padSubs(subs: Ring[], reference: Ring[]): Ring[] {
  const out = subs.slice();
  for (let i = out.length; i < MAX_SUBS; i++) {
    const [x, y] = centroid(reference[i] || reference[reference.length - 1]);
    out.push(new Array(SAMPLES).fill(0).map((): Pt => [x, y]));
  }
  return out.slice(0, MAX_SUBS);
}

function ring(cx: number, cy: number, r: number, n = SAMPLES): Ring {
  const pts: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/* ── flat geometry ────────────────────────────────────────────────────
 * Contours are built as arrays of [x, y] pairs and then frozen into a flat
 * Float32Array of interleaved x,y for everything that runs per frame — the
 * pair form allocates on every frame otherwise, and the minor GCs that buys
 * are precisely the dropped frames that read as stutter.
 */
const flatten = (subs: Ring[], dest?: Float32Array): Float32Array => {
  const rings = subs.length,
    n = subs[0].length;
  const xy = dest || new Float32Array(rings * n * 2);
  for (let r = 0, k = 0; r < rings; r++)
    for (let i = 0; i < n; i++) {
      xy[k++] = subs[r][i][0];
      xy[k++] = subs[r][i][1];
    }
  return xy;
};

// Outward unit normal at every point, from the chord between its neighbours.
// A degenerate ring (a counter waiting to open) has no tangent, so it gets a
// zero normal and simply stays put.
function normalsInto(xy: Float32Array, n: number, rings: number, out: Float32Array): void {
  for (let r = 0; r < rings; r++) {
    const o = r * n * 2;
    for (let i = 0; i < n; i++) {
      const a = o + (i ? i - 1 : n - 1) * 2;
      const c = o + (i + 1 < n ? i + 1 : 0) * 2;
      const b = o + i * 2;
      const tx = xy[c] - xy[a],
        ty = xy[c + 1] - xy[a + 1];
      const m = Math.hypot(tx, ty);
      out[b] = m ? ty / m : 0;
      out[b + 1] = m ? -tx / m : 0;
    }
  }
}

// Push every point along its own direction by its own wave value.
function applyWave(pos: Float32Array, dir: Float32Array, wave: Float32Array, out: Float32Array): void {
  for (let j = 0, k = 0; k < out.length; j++, k += 2) {
    out[k] = pos[k] + dir[k] * wave[j];
    out[k + 1] = pos[k + 1] + dir[k + 1] * wave[j];
  }
}

/* ── membrane wiggle ──────────────────────────────────────────────────
 * Each contour point is pushed along its own outward normal by a few slow
 * waves. Every harmonic is a whole number of cycles per ring, so the wave
 * meets itself at the seam and there is no kink where the path closes.
 *
 * A point's own phase is fixed the moment the contour is sampled, so each
 * point stores sin/cos of its phase once, and a frame is just
 *     sin(phase + wt) = sin(phase)·cos(wt) + cos(phase)·sin(wt)
 * — four multiplies instead of a sine call.
 */
const TAU = Math.PI * 2;
const WIGGLE = {
  // In viewBox units. The blobs are 200-500 across, so this is ~1% of size.
  cell: 10,
  border: 10,
  word: 0, // the wordmark is crisp type; wobbling it reads as bad rendering
};

// sin and cos of one harmonic's fixed phase, tabulated over every point.
const phaseTable = (N: number, phaseAt: (j: number) => number): PhaseTable => {
  const s = new Float32Array(N),
    c = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const a = phaseAt(j);
    s[j] = Math.sin(a);
    c[j] = Math.cos(a);
  }
  return { s, c, ct: 1, st: 0 };
};
// One harmonic evaluated at this frame's time: sin(phase ± wt), by addition.
const at = (h: PhaseTable, j: number): number => h.s[j] * h.ct + h.c[j] * h.st;
const spin = (h: PhaseTable, wt: number): PhaseTable => {
  h.ct = Math.cos(wt);
  h.st = Math.sin(wt);
  return h;
};

// The blobs' and the wordmark's wave: phase runs with the point's index
// around the ring, so it travels with the contour wherever the contour goes.
function indexWave(n: number, rings: number, seed: number): IndexWave {
  const N = n * rings;
  const u = (j: number) => (j % n) / n;
  return {
    N,
    // The ring index detunes a counter from the contour that encloses it.
    a: phaseTable(N, (j) => TAU * 3 * u(j) + seed),
    b: phaseTable(N, (j) => TAU * 5 * u(j) + seed * 1.7 + Math.floor(j / n)),
  };
}

function indexWaveAt(w: IndexWave, amp: number, time: number, out: Float32Array): void {
  const k = amp * 0.62;
  if (!k) {
    out.fill(0);
    return;
  }
  const a = spin(w.a, 1.05 * time),
    b = spin(w.b, -0.72 * time);
  for (let j = 0; j < out.length; j++) out[j] = k * (at(a, j) + 0.55 * at(b, j));
}

// The wave that runs the border band. Phase and direction both come from
// position, never from the contour, which is what keeps the band's weight
// from pumping and carries the scallop cusps along rigidly instead of
// sharpening them. The angle is normalised by the bbox so a wide cloud gets
// evenly spread bumps rather than a crowd of them at its left and right ends.
function fieldWave(xy: Float32Array, n: number, rings: number, cfg: FieldWaveCfg): FieldWave {
  const N = n * rings;
  const { cx, cy, hx, hy } = cfg.field;
  const dir = new Float32Array(N * 2),
    th = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const dx = xy[j * 2] - cx,
      dy = xy[j * 2 + 1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    dir[j * 2] = dx / L;
    dir[j * 2 + 1] = dy / L;
    th[j] = Math.atan2(dy / hy, dx / hx);
  }
  const P = (h: number, off: number) => phaseTable(N, (j) => h * th[j] + off);
  return {
    N,
    n,
    rings,
    cfg,
    dir,
    main: [P(3, cfg.seed), P(5, cfg.seed * 1.7)],
    // Fine harmonics that barely drift: they read as an unevenly drawn edge
    // rather than as motion, which is what stops the shape looking machined.
    rough: [P(13, cfg.seed * 2.3), P(23, cfg.seed * 3.7), P(37, cfg.seed * 5.1)],
    // Only the hole takes these, so the band's weight swells and thins along
    // its length the way an inked line does.
    ink: [P(4, cfg.seed * 1.3), P(7, 1.9)],
  };
}

function fieldWaveAt(w: FieldWave, time: number, out: Float32Array): void {
  const cfg = w.cfg,
    k = cfg.speed || 1;
  const A = cfg.amp * 0.62,
    R = cfg.rough || [0, 0, 0],
    ink = cfg.ink || 0;
  const m0 = spin(w.main[0], 1.05 * k * time),
    m1 = spin(w.main[1], -0.72 * k * time);
  const g0 = spin(w.rough[0], 0.16 * time),
    g1 = spin(w.rough[1], -0.11 * time),
    g2 = spin(w.rough[2], 0.09 * time);
  const k0 = spin(w.ink[0], 0.2 * time),
    k1 = spin(w.ink[1], -0.13 * time);
  for (let r = 0; r < w.rings; r++) {
    const hi = (r + 1) * w.n;
    const inked = r > 0 ? ink : 0;
    for (let j = r * w.n; j < hi; j++) {
      let d = A * (at(m0, j) + 0.55 * at(m1, j)) + R[0] * at(g0, j) + R[1] * at(g1, j) + R[2] * at(g2, j);
      if (inked) d += inked * (0.55 + 0.6 * at(k0, j) + 0.4 * at(k1, j));
      out[j] = d;
    }
  }
}

/* ── path writers ─────────────────────────────────────────────────────
 * Every number goes out as a whole number of tenths and the SVG carries a
 * scale(0.1) to put them back — integers hit V8's small-integer path to
 * string, roughly four times faster than toFixed on the ~7,500 numbers a
 * frame this writes.
 */
const SUBUNIT = 10;
const q = (v: number) => Math.round(v * SUBUNIT);

// Uniform Catmull-Rom through the sampled ring, written as one C and then S
// shorthands — the control point S reflects is exactly the one uniform
// Catmull-Rom asks for at the next point, so this is the same curve in two
// thirds of the characters.
function smoothPath(xy: Float32Array, n: number, rings: number): string {
  let d = "";
  for (let r = 0; r < rings; r++) {
    const o = r * n * 2;
    d += `M${q(xy[o])} ${q(xy[o + 1])}`;
    for (let i = 0; i < n; i++) {
      const p1 = o + i * 2;
      const p2 = o + (i + 1 < n ? i + 1 : 0) * 2;
      const p3 = o + (i + 2 < n ? i + 2 : i + 2 - n) * 2;
      const c2x = xy[p2] - (xy[p3] - xy[p1]) / 6;
      const c2y = xy[p2 + 1] - (xy[p3 + 1] - xy[p1 + 1]) / 6;
      if (i === 0) {
        const p0 = o + (n - 1) * 2;
        d += `C${q(xy[p1] + (xy[p2] - xy[p0]) / 6)} ${q(xy[p1 + 1] + (xy[p2 + 1] - xy[p0 + 1]) / 6)} `;
      } else {
        d += "S";
      }
      d += `${q(c2x)} ${q(c2y)} ${q(xy[p2])} ${q(xy[p2 + 1])}`;
    }
    d += "Z";
  }
  return d;
}

// Straight segments for the wordmark: it is real type, and Catmull-Rom would
// round the corners off E, T and N.
function linePath(xy: Float32Array, n: number, rings: number): string {
  let d = "";
  for (let r = 0; r < rings; r++) {
    const o = r * n * 2;
    d += `M${q(xy[o])} ${q(xy[o + 1])}`;
    for (let i = 1; i < n; i++) d += `L${q(xy[o + i * 2])} ${q(xy[o + i * 2 + 1])}`;
    d += "Z";
  }
  return d;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Expo is what buys "fast but smooth" on an arrival: most of the distance
// goes in the first third, then it glides in. No overshoot, no visible stop.
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// The idle morph is two legs — letterform to cell, cell to the next
// letterform — and the eye reads them as one gesture, so both position AND
// direction have to carry across the join, or it reads as a cut right where
// the shape is smallest. So this is one Hermite spline per point through
// three keyframes (letterA, dot, letterB), with a single shared tangent at
// the dot, which is what makes the direction agree, not just the speed.
const CELL_IN = 380,
  CELL_OUT = 520;

// The cells' landing bounce, as squash and stretch. (1-t)^2 forces the ring
// to zero at the end, so the tween lands flat with no snap; three quarters
// of a cycle gives one stretch and one small squat back.
const BOUNCE_W = Math.PI * 2 * 0.75;
const bounce = (t: number) => (t >= 1 ? 0 : ((1 - t) * (1 - t) * Math.sin(BOUNCE_W * t)) / 0.524);
// Peak stretch in viewBox units, not as a percentage of the blob, so tall
// and short blobs bounce the same visible amount.
const BOUNCE_UNITS = 34;
// A cell's tween runs as a dot, then snaps open, then bounces — sequential,
// not simultaneous, or the bounce peak lands underneath the still-inflating
// blob and is invisible.
const DOT_HOLD = 0.14; // sitting as a dot
const OPEN_END = 0.42; // grown to full size; the bounce starts here

// The wordmark's scale range. Small on purpose — a big scale-up reads as a
// pop, and this one is meant to settle in.
const WORD_FROM = 0.86;

const CELL_SAMPLES = 160;
const DOT_R = 8; // viewBox units — about 5px at the size this renders at
const BORDER_SAMPLES = 520;

// Major pentatonic, rising: five pops in a row want to go somewhere.
const POP_PITCH = [1, 1.125, 1.25, 1.5, 1.6875];

export interface AnimatedLogoProps {
  /** Play the intro on mount. Read once, at mount. Default true. */
  autoPlay?: boolean;
  /** Start with the idle letter-morph loop running. Read once, at mount. Default false. */
  loop?: boolean;
  /** Show the Replay / Morph loop / Sound buttons. Default true. */
  controls?: boolean;
  /** Any valid CSS color. Default the mark's own near-black. */
  background?: string;
  className?: string;
}

/**
 * The EDITION mark: five blobs unfurl from dots into the CELLS silhouette,
 * the outline band fades up, and the wordmark settles in — all driven by an
 * imperative per-frame engine (path data is rewritten every frame, which is
 * too hot a path for React state). The engine itself is a straight port of
 * the standalone logo-morph.html build; only the DOM lookups changed, from
 * global ids to refs, so the component is safe to mount more than once.
 */
export default function AnimatedLogo({ autoPlay = true, loop = false, controls = true, background = "#08080a", className }: AnimatedLogoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGGElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const wordGroupRef = useRef<SVGGElement>(null);
  const engineRef = useRef<{ replay: () => void; toggleLoop: () => void; toggleSound: () => void } | null>(null);

  // Read once, at mount: the engine below is imperative and doesn't react
  // to prop changes, so these only need their initial value. useState's
  // lazy initializer (rather than a ref read during render) is what keeps
  // that read out of the render path.
  const [autoPlayInit] = useState(autoPlay);
  const [loopInit] = useState(loop);

  const [loopOn, setLoopOn] = useState(loopInit);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    if (!markRef.current || !outlineRef.current || !wordGroupRef.current) return;
    // Non-null asserted: the guard above proves it at this line, but TS
    // narrowing doesn't reach into the closures defined below, which read
    // these same bindings well after the check.
    const markEl = markRef.current!;
    const outlineEl = outlineRef.current!;
    const wordGroupEl = wordGroupRef.current!;

    let disposed = false;

    /* ---------- path sampling ---------- */
    const measurer = document.createElementNS(NS, "svg") as SVGSVGElement;
    measurer.setAttribute("width", "0");
    measurer.setAttribute("height", "0");
    measurer.style.cssText = "position:absolute;left:-9999px;visibility:hidden";
    document.body.appendChild(measurer);
    const probe = document.createElementNS(NS, "path") as SVGPathElement;
    measurer.appendChild(probe);

    function sample(d: string, n: number): Ring {
      probe.setAttribute("d", d);
      const len = probe.getTotalLength();
      const pts: Ring = [];
      for (let i = 0; i < n; i++) {
        const p = probe.getPointAtLength((len * i) / n);
        pts.push([p.x, p.y]);
      }
      return pts;
    }

    function makeGlyph(def: { name: string; d: string }): Glyph {
      const subs = splitSubpaths(def.d).map((s) => normalizeWinding(sample(s, SAMPLES)));
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const s of subs)
        for (const [x, y] of s) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      const cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2;
      const local = subs
        .map((s) => s.map(([x, y]): Pt => [x - cx, y - cy]))
        .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      return { name: def.name, subs: local, cx, cy, w: maxX - minX, h: maxY - minY };
    }

    /* ---------- tween runner ---------- */
    const active = new Set<Tween>();
    let generation = 0;
    const wigglers: { draw: (t: number) => void }[] = [];
    let wiggleT = 0;
    let rafId = 0;

    function stepWiggle(now: number) {
      wiggleT = now / 1000;
      for (const w of wigglers) w.draw(wiggleT);
    }

    function tick(now: number) {
      if (disposed) return;
      for (const tw of active) {
        if (tw.start === null) tw.start = now + tw.delay;
        const t = (now - tw.start) / tw.dur;
        if (t < 0) continue;
        if (t >= 1) {
          tw.onUpdate(1);
          active.delete(tw);
          tw.resolve();
        } else tw.onUpdate(tw.ease(t));
      }
      stepWiggle(now);
      if (!disposed) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    const tween = (dur: number, onUpdate: (t: number) => void, opts: { delay?: number; ease?: (t: number) => number } = {}): Promise<void> =>
      new Promise((resolve) => {
        active.add({ dur, delay: opts.delay ?? 0, ease: opts.ease ?? easeInOutCubic, onUpdate, resolve, start: null });
      });

    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    /* ---------- sound ---------- */
    let audio: AudioContext | null = null;
    let soundOnInternal = true;

    async function unlockAudio(): Promise<AudioContext | null> {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      if (!audio) audio = new Ctx();
      if (audio.state === "suspended") {
        try {
          await audio.resume();
        } catch {
          /* blocked until a user gesture; later calls retry */
        }
      }
      return audio;
    }

    // A wet "blop": pitch sweeps up more than two octaves in 60ms, a lowpass
    // keeps the harmonics off it, and the decay is long relative to the
    // attack so it reads as coming out of liquid rather than a beep.
    function blop(when: number, pitch = 1, level = 0.26) {
      if (!audio || !soundOnInternal) return;
      const t = Math.max(audio.currentTime, when);
      const osc = audio.createOscillator();
      const lp = audio.createBiquadFilter();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(760 * pitch, t + 0.06);
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1600 * pitch, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(lp).connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }

    /* ---------- build the wordmark ---------- */
    const glyphs = GLYPHS.map(makeGlyph);

    function cellRings(letter: Letter): Ring[] {
      return padSubs([ring(0, 0, letter.seedRadius)], letter.glyph.subs);
    }

    const render = (l: Letter) => {
      if (!l.wave || !l.nrm || !l.amp || !l.out) {
        l.el.setAttribute("d", linePath(l.flat, SAMPLES, MAX_SUBS));
        return;
      }
      normalsInto(l.flat, SAMPLES, MAX_SUBS, l.nrm);
      indexWaveAt(l.wave, WIGGLE.word, wiggleT, l.amp);
      applyWave(l.flat, l.nrm, l.amp, l.out);
      l.el.setAttribute("d", linePath(l.out, SAMPLES, MAX_SUBS));
    };

    const letters: Letter[] = glyphs.map((g, i) => {
      const el = document.createElementNS(NS, "path") as SVGPathElement;
      el.setAttribute("class", "letter");
      el.setAttribute("fill-rule", "evenodd");
      el.setAttribute("transform", `translate(${g.cx * SUBUNIT} ${g.cy * SUBUNIT})`);
      wordGroupEl.appendChild(el);
      const l: Letter = {
        el,
        glyph: g,
        seedRadius: Math.max(g.w, g.h) * 0.42,
        current: [],
        flat: new Float32Array(0),
      };
      l.current = cellRings(l);
      l.flat = flatten(l.current);
      if (WIGGLE.word) {
        l.wave = indexWave(SAMPLES, MAX_SUBS, i * 1.9);
        l.nrm = new Float32Array(l.flat.length);
        l.amp = new Float32Array(l.wave.N);
        l.out = new Float32Array(l.flat.length);
      }
      return l;
    });

    if (WIGGLE.word) letters.forEach((l) => wigglers.push({ draw: () => render(l) }));

    const pose = (l: Letter, s = 1) =>
      l.el.setAttribute("transform", `translate(${l.glyph.cx * SUBUNIT} ${l.glyph.cy * SUBUNIT}) scale(${s})`);

    const alignedPad = (target: Ring[], from: Ring[]) => padSubs(target, from).map((s, k) => alignRotation(s, from[k]));

    function hermiteInto(p0: Float32Array, m0: Float32Array, p1: Float32Array, m1: Float32Array, s: number, out: Float32Array) {
      const s2 = s * s,
        s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1,
        h10 = s3 - 2 * s2 + s;
      const h01 = -2 * s3 + 3 * s2,
        h11 = s3 - s2;
      for (let k = 0; k < out.length; k++) out[k] = h00 * p0[k] + h10 * m0[k] + h01 * p1[k] + h11 * m1[k];
    }

    function morphViaCell(letter: Letter, targetSubs: Ring[], delay: number): Promise<void> {
      const A = letter.current;
      const D = alignedPad(cellRings(letter), A);
      const B = alignedPad(targetSubs, D);
      const a = flatten(A),
        d = flatten(D),
        b = flatten(B);
      const zero = new Float32Array(a.length);
      const v = new Float32Array(a.length);
      for (let k = 0; k < v.length; k++) v[k] = 0.5 * ((d[k] - a[k]) / CELL_IN + (b[k] - d[k]) / CELL_OUT);
      const mIn = new Float32Array(a.length),
        mOut = new Float32Array(a.length);
      for (let k = 0; k < v.length; k++) {
        mIn[k] = v[k] * CELL_IN;
        mOut[k] = v[k] * CELL_OUT;
      }
      const total = CELL_IN + CELL_OUT;
      const cur = letter.flat;
      return tween(
        total,
        (t) => {
          const ms = t * total;
          if (ms <= CELL_IN) hermiteInto(a, zero, d, mIn, ms / CELL_IN, cur);
          else hermiteInto(d, mOut, b, zero, (ms - CELL_IN) / CELL_OUT, cur);
          render(letter);
        },
        { delay, ease: (t) => t },
      ).then(() => {
        letter.current = B;
        cur.set(b);
      });
    }

    /* ---------- the timeline ---------- */
    // In React 18 Strict Mode, effects run twice in dev, and the code below
    // rewrites its own source paths' `d` attributes every frame — so a
    // second invocation must not sample whatever the first one already left
    // behind. Restoring the pristine artwork here makes setup idempotent
    // regardless of how many times the effect re-runs.
    outlineEl.setAttribute("d", OUTLINE_D);
    const cellEls = [...markEl.querySelectorAll<SVGPathElement>(".cell")];
    cellEls.forEach((el, i) => el.setAttribute("d", CELL_DS[i]));
    // Source order in the artwork is arbitrary. The blobs spell CELLS, so
    // they arrive in reading order: left edge to right edge.
    const cellStates: CellState[] = cellEls.map((el) => {
      const b = el.getBBox();
      return { el, midX: b.x + b.width / 2, stretchK: BOUNCE_UNITS / (b.height / 2), anim: { grow: 1, draw: () => {} } };
    });
    const cellsPop = cellStates.slice().sort((a, b) => a.midX - b.midX);

    cellStates.forEach((c, i) => {
      const subs = splitSubpaths(c.el.getAttribute("d") || "").map((s) => sample(s, CELL_SAMPLES));
      const rings = subs.length,
        N = CELL_SAMPLES * rings;
      const base = flatten(subs);
      const [gx, gy] = centroid(subs[0]);
      const dot = new Float32Array(N * 2);
      for (let j = 0; j < N; j++) {
        const dx = base[j * 2] - gx,
          dy = base[j * 2 + 1] - gy,
          L = Math.hypot(dx, dy) || 1;
        dot[j * 2] = gx + (dx / L) * DOT_R;
        dot[j * 2 + 1] = gy + (dy / L) * DOT_R;
      }
      const baseNrm = new Float32Array(N * 2);
      normalsInto(base, CELL_SAMPLES, rings, baseNrm);
      const pos = new Float32Array(N * 2),
        nrm = new Float32Array(N * 2);
      const out = new Float32Array(N * 2),
        amp = new Float32Array(N);
      const wave = indexWave(CELL_SAMPLES, rings, i * 2.4 + 0.7);
      const a: CellAnim = { grow: 1, draw: () => {} };
      a.draw = (time: number) => {
        const g = a.grow;
        let p = base,
          nv = baseNrm;
        if (g !== 1) {
          for (let k = 0; k < pos.length; k++) pos[k] = dot[k] + (base[k] - dot[k]) * g;
          normalsInto(pos, CELL_SAMPLES, rings, nrm);
          p = pos;
          nv = nrm;
        }
        indexWaveAt(wave, WIGGLE.cell * Math.min(1, g), time, amp);
        applyWave(p, nv, amp, out);
        c.el.setAttribute("d", smoothPath(out, CELL_SAMPLES, rings));
      };
      c.anim = a;
      wigglers.push(a);
      a.draw(0);
    });

    // The band goes live too: two contours (outer + inner), redrawn every
    // frame, with enough points to carry the finest harmonic (37 cycles
    // round the cloud) without aliasing.
    const outlineSubs = splitSubpaths(outlineEl.getAttribute("d") || "").map((s) => sample(s, BORDER_SAMPLES));
    const outlineRings = outlineSubs.length;
    const outlineFlat = flatten(outlineSubs);
    const oBox = outlineEl.getBBox();
    const borderWig: FieldWaveCfg = {
      amp: WIGGLE.border,
      seed: 5.1,
      speed: 0.8, // a shape this wide reads as frantic at the blobs' tempo
      rough: [1.8, 1, 0.4], // 13, 23 and 37 cycles round the cloud — the grain
      ink: 2, // how much the band's weight varies along its length
      field: { cx: oBox.x + oBox.width / 2, cy: oBox.y + oBox.height / 2, hx: oBox.width / 2, hy: oBox.height / 2 },
    };
    const borderWave = fieldWave(outlineFlat, BORDER_SAMPLES, outlineRings, borderWig);
    const borderOut = new Float32Array(outlineFlat.length);
    const borderAmp = new Float32Array(borderWave.N);
    function drawBorder(time: number) {
      fieldWaveAt(borderWave, time, borderAmp);
      applyWave(outlineFlat, borderWave.dir, borderAmp, borderOut);
      outlineEl.setAttribute("d", smoothPath(borderOut, BORDER_SAMPLES, outlineRings));
    }
    if (WIGGLE.border) {
      wigglers.push({ draw: drawBorder });
      drawBorder(0);
    }

    function reset() {
      generation++;
      active.clear();
      outlineEl.style.opacity = "0";
      cellStates.forEach((c) => {
        c.el.style.opacity = "0";
        c.el.style.transform = "";
        c.anim.grow = 0;
        c.anim.draw(wiggleT);
      });
      // The wordmark starts as finished letterforms — it is shown, not spawned.
      letters.forEach((l) => {
        l.current = padSubs(l.glyph.subs, l.glyph.subs);
        flatten(l.current, l.flat);
        l.el.style.opacity = "0";
        pose(l, WORD_FROM);
        render(l);
      });
    }

    async function play() {
      reset();
      const gen = generation;
      const alive = () => gen === generation && !disposed;

      const T = {
        cellAt: 60,
        cellStep: 120,
        cellDur: 560,
        borderAt: 900,
        borderDur: 620,
        wordAt: 900,
        wordStep: 70,
        wordDur: 780,
      };
      const cellsEnd = T.cellAt + (cellStates.length - 1) * T.cellStep + T.cellDur;

      // Pops go on the audio clock, not off rAF: frame timing isn't
      // accurate enough to hold five evenly spaced sounds.
      if (audio && audio.state === "running" && soundOnInternal) {
        const base = audio.currentTime + 0.03;
        cellsPop.forEach((c, i) => {
          const at = (T.cellAt + i * T.cellStep + DOT_HOLD * T.cellDur) / 1000;
          blop(base + at, POP_PITCH[i]);
        });
      }

      // 1. each cell-letter appears as a dot and unfurls into its shape.
      cellsPop.forEach((c, i) => {
        let posed = "";
        tween(
          T.cellDur,
          (t) => {
            if (c.el.style.opacity !== "1") c.el.style.opacity = "1";
            c.anim.grow = easeOutExpo(clamp01((t - DOT_HOLD) / (OPEN_END - DOT_HOLD)));
            const b = bounce(clamp01((t - OPEN_END) / (1 - OPEN_END))) * c.stretchK;
            const tf = b ? `scale(${1 - b * 0.45}, ${1 + b})` : "";
            if (tf !== posed) c.el.style.transform = posed = tf;
          },
          { delay: T.cellAt + i * T.cellStep, ease: (t) => t },
        );
      });

      // 2. the band fades up in place, whole and at full size.
      tween(T.borderDur, (t) => { outlineEl.style.opacity = String(easeInOutCubic(t)); }, { delay: T.borderAt, ease: (t) => t });

      // 3. EDITION alongside the band, slower than everything before it.
      letters.forEach((l, i) => {
        tween(
          T.wordDur,
          (t) => {
            const k = easeInOutCubic(t);
            l.el.style.opacity = String(k);
            pose(l, WORD_FROM + (1 - WORD_FROM) * k);
          },
          { delay: T.wordAt + i * T.wordStep, ease: (t) => t },
        );
      });

      const introEnd = Math.max(cellsEnd, T.borderAt + T.borderDur, T.wordAt + (letters.length - 1) * T.wordStep + T.wordDur);
      await wait(introEnd);
      if (!alive()) return;

      // 4. idle: dissolve back to cells, re-form as the neighbouring letter.
      while (alive() && loopOnRef.current) {
        await wait(1500);
        if (!alive() || !loopOnRef.current) return;
        await Promise.all(letters.map((l, i) => morphViaCell(l, glyphs[(i + 1) % glyphs.length].subs, i * 45)));
        if (!alive()) return;
        await wait(500);
        if (!alive()) return;
        await Promise.all(letters.map((l, i) => morphViaCell(l, l.glyph.subs, i * 45)));
      }
    }

    // loopOn is read inside the async play() loop above; a ref keeps that
    // read live without re-running the whole effect when the toggle fires.
    const loopOnRef = { current: loopInit };

    engineRef.current = {
      replay: () => {
        void unlockAudio().then(() => play());
      },
      toggleLoop: () => {
        loopOnRef.current = !loopOnRef.current;
        setLoopOn(loopOnRef.current);
        if (loopOnRef.current) void unlockAudio().then(() => play());
      },
      toggleSound: () => {
        soundOnInternal = !soundOnInternal;
        setSoundOn(soundOnInternal);
        if (soundOnInternal) void unlockAudio().then(() => blop(0, POP_PITCH[2]));
      },
    };

    const onPointerDown = () => void unlockAudio();
    const onKeyDown = () => void unlockAudio();
    window.addEventListener("pointerdown", onPointerDown, { once: true });
    window.addEventListener("keydown", onKeyDown, { once: true });

    if (autoPlayInit) void play();

    return () => {
      disposed = true;
      generation++;
      active.clear();
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      measurer.remove();
      if (audio) void audio.close().catch(() => {});
      engineRef.current = null;
    };
    // Engine is imperative and self-contained; autoPlayInit/loopInit are
    // captured once via refs on purpose, and the setters above never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className={`edition-logo-morph${className ? ` ${className}` : ""}`}
      style={{ "--bg": background } as React.CSSProperties}
    >
      <style>{`
        .edition-logo-morph {
          /* --bg comes from the background prop, set as an inline style. */
          --ink: #ffffff;
          --dim: #6b6b74;
          position: relative;
          width: 100%;
          height: 100%;
          background: var(--bg);
          color: var(--ink);
          font: 400 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 40px;
          overflow: hidden;
        }
        .edition-logo-morph * { box-sizing: border-box; }
        .edition-logo-morph .glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(60% 55% at 50% 45%, rgba(255,255,255,.07), transparent 70%);
          pointer-events: none;
        }
        .edition-logo-morph .stage {
          width: min(78vw, 900px);
          position: relative;
          will-change: transform;
        }
        .edition-logo-morph svg { width: 100%; height: auto; display: block; overflow: visible; }
        .edition-logo-morph .outline { fill: var(--ink); opacity: 0; }
        .edition-logo-morph .cell {
          fill: var(--ink);
          transform-box: fill-box;
          transform-origin: 50% 50%;
          opacity: 0;
        }
        .edition-logo-morph .letter { fill: var(--ink); }
        .edition-logo-morph .controls { display: flex; gap: 8px; align-items: center; z-index: 2; }
        .edition-logo-morph button {
          background: transparent;
          border: 1px solid #2a2a30;
          color: var(--dim);
          font: inherit;
          letter-spacing: .08em;
          text-transform: uppercase;
          padding: 9px 16px;
          border-radius: 999px;
          cursor: pointer;
          transition: color .2s, border-color .2s;
        }
        .edition-logo-morph button:hover { color: var(--ink); border-color: #52525c; }
        .edition-logo-morph button[aria-pressed="true"] { color: var(--ink); border-color: var(--ink); }
      `}</style>

      <div className="glow" />

      <div className="stage">
        <svg viewBox="0 0 1366 886" xmlns={NS} aria-label="Edition">
          <g ref={markRef} transform="scale(0.1)">
            <path ref={outlineRef} className="outline" d={OUTLINE_D} />
            {CELL_DS.map((d, i) => (
              <path key={i} className="cell" d={d} />
            ))}
          </g>
          <g ref={wordGroupRef} transform="scale(0.1)" />
        </svg>
      </div>

      {controls && (
        <div className="controls">
          <button type="button" onClick={() => engineRef.current?.replay()}>
            Replay
          </button>
          <button type="button" aria-pressed={loopOn} onClick={() => engineRef.current?.toggleLoop()}>
            Morph loop
          </button>
          <button type="button" aria-pressed={soundOn} onClick={() => engineRef.current?.toggleSound()}>
            Sound
          </button>
        </div>
      )}
    </div>
  );
}
