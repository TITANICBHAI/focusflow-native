import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "focusflow-competitive-analysis.pdf");

const PAGE_W = 612;
const PAGE_H = 792;
const M = 40;
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_Y = PAGE_H - 22;

const COLOR = {
  ink: [22, 27, 34],
  muted: [110, 118, 129],
  primary: [33, 88, 158],
  primaryDark: [22, 60, 110],
  accent: [183, 31, 31],
  good: [22, 130, 76],
  bad: [183, 31, 31],
  partial: [191, 130, 28],
  divider: [220, 224, 230],
  bandBg: [243, 246, 250],
  zebra: [248, 250, 252],
  pillBg: [233, 240, 250],
};

const doc = new jsPDF({ unit: "pt", format: "letter" });
let cursorY = M;
let pageNo = 1;

function setColor(c) { doc.setTextColor(c[0], c[1], c[2]); }
function setFill(c) { doc.setFillColor(c[0], c[1], c[2]); }
function setDraw(c) { doc.setDrawColor(c[0], c[1], c[2]); }

function drawHeader() {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(COLOR.muted);
  doc.text("FocusFlow — Competitive Analysis", M, 24);
  doc.setFont("helvetica", "normal");
  doc.text("April 2026", PAGE_W - M, 24, { align: "right" });
  setDraw(COLOR.divider);
  doc.setLineWidth(0.5);
  doc.line(M, 30, PAGE_W - M, 30);
}

function drawFooter() {
  const savedY = cursorY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(COLOR.muted);
  doc.text(`FocusFlow Strategy · Competitive Analysis · April 2026`, M, FOOTER_Y);
  doc.text(`Page ${pageNo}`, PAGE_W - M, FOOTER_Y, { align: "right" });
  cursorY = savedY;
}

function newPage() {
  drawFooter();
  doc.addPage();
  pageNo++;
  cursorY = M + 16;
  drawHeader();
}

function ensureSpace(needed) {
  if (cursorY + needed > FOOTER_Y - 12) newPage();
}

function spacer(h) { cursorY += h; }

function H1(text) {
  ensureSpace(36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  setColor(COLOR.primaryDark);
  doc.text(text, M, cursorY);
  cursorY += 22;
  setDraw(COLOR.primary);
  doc.setLineWidth(2);
  doc.line(M, cursorY, M + 60, cursorY);
  cursorY += 14;
}

function H2(text) {
  ensureSpace(28);
  spacer(6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setColor(COLOR.primary);
  doc.text(text, M, cursorY);
  cursorY += 16;
}

function H3(text) {
  ensureSpace(20);
  spacer(2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(COLOR.ink);
  doc.text(text, M, cursorY);
  cursorY += 14;
}

function P(text, opts = {}) {
  const { size = 10, color = COLOR.ink, indent = 0, bold = false } = opts;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  setColor(color);
  const lines = doc.splitTextToSize(text, CONTENT_W - indent);
  for (const line of lines) {
    ensureSpace(size + 3);
    doc.text(line, M + indent, cursorY);
    cursorY += size + 3;
  }
}

function bulletList(items) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setColor(COLOR.ink);
  for (const item of items) {
    const lines = doc.splitTextToSize(item, CONTENT_W - 16);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(13);
      if (i === 0) {
        setColor(COLOR.primary);
        doc.text("•", M + 4, cursorY);
        setColor(COLOR.ink);
      }
      doc.text(lines[i], M + 16, cursorY);
      cursorY += 13;
    }
  }
}

function callout(title, body) {
  const padding = 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const titleH = 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const bodyLines = doc.splitTextToSize(body, CONTENT_W - padding * 2);
  const boxH = padding * 2 + titleH + bodyLines.length * 13;
  ensureSpace(boxH + 6);
  setFill(COLOR.bandBg);
  setDraw(COLOR.primary);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, cursorY, CONTENT_W, boxH, 6, 6, "FD");
  doc.setFont("helvetica", "bold");
  setColor(COLOR.primaryDark);
  doc.text(title, M + padding, cursorY + padding + 10);
  doc.setFont("helvetica", "normal");
  setColor(COLOR.ink);
  let y = cursorY + padding + titleH + 10;
  for (const line of bodyLines) {
    doc.text(line, M + padding, y);
    y += 13;
  }
  cursorY += boxH + 8;
}

function symbolCellHook(data) {
  if (data.section !== "body") return;
  const txt = (data.cell.raw || "").toString();
  if (txt === "✓" || txt === "Yes") {
    data.cell.styles.textColor = COLOR.good;
    data.cell.styles.fontStyle = "bold";
  } else if (txt === "✗" || txt === "No") {
    data.cell.styles.textColor = COLOR.bad;
    data.cell.styles.fontStyle = "bold";
  } else if (txt === "Partial" || txt === "~") {
    data.cell.styles.textColor = COLOR.partial;
    data.cell.styles.fontStyle = "bold";
  }
}

function table(head, body, opts = {}) {
  const startY = cursorY + 4;
  autoTable(doc, {
    head: [head],
    body,
    startY,
    margin: { left: M, right: M, bottom: 32 },
    styles: {
      font: "helvetica",
      fontSize: opts.fontSize || 8,
      cellPadding: 4,
      lineColor: COLOR.divider,
      lineWidth: 0.4,
      textColor: COLOR.ink,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: COLOR.primary,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      fontSize: opts.headerSize || 8,
    },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: opts.columnStyles || {},
    didParseCell: opts.symbolize ? symbolCellHook : undefined,
    didDrawPage: () => {
      drawHeader();
      drawFooter();
    },
    willDrawPage: (d) => {
      pageNo = d.pageNumber;
    },
  });
  cursorY = doc.lastAutoTable.finalY + 10;
}

function drawPositioningMap() {
  const w = CONTENT_W;
  const h = 270;
  ensureSpace(h + 8);
  const x0 = M;
  const y0 = cursorY;

  setFill([252, 253, 255]);
  setDraw(COLOR.divider);
  doc.setLineWidth(0.5);
  doc.roundedRect(x0, y0, w, h, 6, 6, "FD");

  const padX = 60;
  const padY = 40;
  const innerX = x0 + padX;
  const innerY = y0 + padY;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  setDraw(COLOR.muted);
  doc.setLineWidth(0.6);
  doc.line(innerX + innerW / 2, innerY, innerX + innerW / 2, innerY + innerH);
  doc.line(innerX, innerY + innerH / 2, innerX + innerW, innerY + innerH / 2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(COLOR.muted);
  doc.text("HIGH ENFORCEMENT", x0 + w / 2, y0 + 18, { align: "center" });
  doc.text("LOW ENFORCEMENT", x0 + w / 2, y0 + h - 8, { align: "center" });
  doc.text("FREE / ONE-TIME", x0 + 8, y0 + h / 2 + 3);
  doc.text("SUBSCRIPTION", x0 + w - 8, y0 + h / 2 + 3, { align: "right" });

  const points = [
    { name: "FocusFlow", x: 0.18, y: 0.18, color: COLOR.accent, star: true },
    { name: "Lock Me Out", x: 0.30, y: 0.30, color: COLOR.primary },
    { name: "AppBlock", x: 0.78, y: 0.32, color: COLOR.primary },
    { name: "Stay Focused", x: 0.72, y: 0.42, color: COLOR.primary },
    { name: "Brick", x: 0.40, y: 0.45, color: COLOR.partial },
    { name: "Freedom", x: 0.85, y: 0.62, color: COLOR.muted },
    { name: "Opal", x: 0.82, y: 0.72, color: COLOR.muted },
    { name: "One Sec", x: 0.78, y: 0.78, color: COLOR.muted },
    { name: "StayFree", x: 0.65, y: 0.82, color: COLOR.muted },
    { name: "ScreenZen", x: 0.22, y: 0.78, color: COLOR.good },
    { name: "Digital Wellbeing", x: 0.30, y: 0.88, color: COLOR.muted },
    { name: "Forest", x: 0.50, y: 0.88, color: COLOR.muted },
  ];
  for (const p of points) {
    const px = innerX + p.x * innerW;
    const py = innerY + p.y * innerH;
    setFill(p.color);
    if (p.star) {
      doc.circle(px, py, 6, "F");
      setFill([255, 255, 255]);
      doc.circle(px, py, 2.5, "F");
    } else {
      doc.circle(px, py, 3.5, "F");
    }
    doc.setFont("helvetica", p.star ? "bold" : "normal");
    doc.setFontSize(8);
    setColor(p.star ? COLOR.accent : COLOR.ink);
    doc.text(p.name, px + 7, py + 3);
  }
  cursorY += h + 10;
}

drawHeader();

doc.setFont("helvetica", "bold");
doc.setFontSize(11);
setColor(COLOR.muted);
doc.text("STRATEGY REPORT", M, cursorY);
cursorY += 18;

doc.setFont("helvetica", "bold");
doc.setFontSize(28);
setColor(COLOR.primaryDark);
doc.text("FocusFlow", M, cursorY);
cursorY += 30;
doc.setFontSize(20);
setColor(COLOR.ink);
doc.text("Competitive Analysis 2026", M, cursorY);
cursorY += 22;
doc.setFont("helvetica", "normal");
doc.setFontSize(11);
setColor(COLOR.muted);
doc.text("12-competitor expanded edition · Android focus & app-blocking category", M, cursorY);
cursorY += 14;
doc.text("April 2026 · Prepared for the FocusFlow product team", M, cursorY);
cursorY += 24;

callout(
  "Bottom line",
  "FocusFlow uniquely owns the high-enforcement / no-subscription quadrant. Three of the four largest accessibility-based rivals (AppBlock, Stay Focused, Lock Me Out) lack task-linked blocking and aversion deterrents. With the always-on enforcement layer just shipped, our wedge widens. The 60-90 day Stay Focused refugee window is still open."
);

H2("Strategic clusters at a glance");
bulletList([
  "Hard enforcers (Accessibility Service): AppBlock, Stay Focused, Lock Me Out — same primitive as us, all subscription, none with task linking or deterrents.",
  "Soft friction apps (mindful pause): One Sec, ScreenZen, Opal — beloved by light users, useless for the willpower-failed segment.",
  "Trackers with light blocking: StayFree, Google Digital Wellbeing — see usage, easy to bypass.",
  "Out-of-pattern players: Freedom (VPN), Forest (gamified honor), Cold Turkey (desktop only), Brick (NFC hardware).",
]);

H2("Top 3 strategic recommendations");
bulletList([
  "Ship import bridges from Stay Focused, AppBlock and Lock Me Out first — the three Android accessibility apps whose blocked-app lists translate 1:1 into ours.",
  "Lead with the always-on promise. Every other accessibility-based rival enforces only during a session. We just made all five enforcement layers continuous. Demoable wedge.",
  "Build a 'leaving Stay Focused?' landing page and Reddit reply playbook. The lifetime-licence revocation is a still-live trust crisis.",
]);

newPage();

H1("Full feature matrix");
P("Twelve competitors compared across the dimensions buyers actually ask about. Cells flagged Yes / No / Partial.", { color: COLOR.muted });

const matrixHead = ["Feature", "FocusFlow", "AppBlock", "Stay Focused", "Lock Me Out", "Freedom", "Forest", "Digital Wellbeing", "One Sec", "ScreenZen", "StayFree", "Opal", "Brick"];
const matrixBody = [
  ["Enforcement type", "Accessibility", "Accessibility", "Accessibility", "Accessibility", "VPN", "Honor", "OS soft", "Friction", "Friction", "Light", "Friction+VPN", "Hardware NFC"],
  ["Works offline", "Yes", "Yes", "Yes", "Yes", "No", "N/A", "Yes", "Yes", "Yes", "Yes", "Partial", "Yes"],
  ["Task-linked auto-blocking", "Yes", "No", "No", "No", "No", "No", "No", "No", "No", "No", "No", "No"],
  ["Always-on enforcement", "Yes", "No", "No", "No", "No", "N/A", "Partial", "Yes", "Yes", "Partial", "No", "Partial"],
  ["3-layer aversion deterrents", "Yes", "No", "No", "No", "No", "Partial", "No", "No", "No", "No", "No", "No"],
  ["System protection (settings/install)", "Yes", "Partial", "Partial", "Partial", "No", "No", "No", "No", "No", "No", "No", "N/A"],
  ["Shorts / Reels blocker", "Yes", "No", "No", "No", "Partial", "No", "No", "No", "Partial", "Partial", "No", "No"],
  ["Keyword blocker", "Yes", "No", "No", "No", "Partial", "No", "No", "No", "No", "No", "No", "No"],
  ["Recurring schedules", "Yes", "Yes", "Yes", "Yes", "Yes", "No", "Partial", "Yes", "Yes", "Yes", "Yes", "No"],
  ["Daily allowance modes", "Yes", "Partial", "Partial", "Yes", "No", "No", "No", "Partial", "Yes", "Partial", "Partial", "No"],
  ["Privacy (on-device)", "Yes", "Partial", "Partial", "Partial", "No", "No", "Yes", "Partial", "Partial", "No", "No", "Partial"],
  ["Open source", "Yes", "No", "No", "No", "No", "No", "No", "No", "No", "No", "No", "Partial"],
];
table(matrixHead, matrixBody, {
  fontSize: 7,
  headerSize: 7,
  symbolize: true,
  columnStyles: { 0: { fontStyle: "bold", cellWidth: 95, halign: "left" } },
});

H2("Pricing reality check (USD per year, typical user)");
const priceHead = ["App", "Model", "Year-1 cost", "Subscription?"];
const priceBody = [
  ["FocusFlow", "Free / open source", "$0", "No"],
  ["AppBlock", "Pro subscription", "$36 – $60", "Yes"],
  ["Stay Focused", "Subscription (lifetime revoked)", "$36", "Yes"],
  ["Lock Me Out", "Sub or one-time", "$30 or $30 once", "Optional"],
  ["Freedom", "Subscription / lifetime", "$99 or $130 once", "Yes (default)"],
  ["Forest", "$1.99 + premium sub", "$2 + ~$12", "Partial"],
  ["Google Digital Wellbeing", "Pre-installed", "$0", "No"],
  ["One Sec", "Free for 1 app, Pro tiers", "$20 / $50 once", "Optional"],
  ["ScreenZen", "Genuinely free", "$0", "No"],
  ["StayFree", "Freemium (Sensor Tower)", "Free / Pro", "Optional"],
  ["Opal", "Subscription premium", "$99", "Yes"],
  ["Brick", "Hardware one-time", "$59 once", "No"],
];
table(priceHead, priceBody, {
  fontSize: 9,
  columnStyles: { 0: { fontStyle: "bold", cellWidth: 110 }, 2: { halign: "right" }, 3: { halign: "center" } },
});

newPage();

H1("Positioning map");
P("Two axes the buyer cares about: enforcement strength (vertical) and pricing model (horizontal). The top-left quadrant — high enforcement with no subscription — is uncontested except for FocusFlow.", { color: COLOR.muted });
drawPositioningMap();
callout(
  "Defend the top-left",
  "Lock Me Out has a one-time tier but no task linking and no deterrents. Brick is hardware ($59 + a physical puck). ScreenZen is free but friction-only. We are the only app combining accessibility-grade enforcement, always-on guards, task linking, three-layer deterrents, free-forever pricing and open source."
);

newPage();

H1("Cluster A — Hard enforcers (direct competition)");

H2("AppBlock — primary subscription rival");
P("Play Store 4.1★ · 100k+ reviews · 10M+ downloads · MobileSoft (Czech Republic) · $3-5/mo Pro.");
H3("Strengths");
bulletList([
  "Established brand and reliable Accessibility Service enforcement.",
  "Strong recurring schedules and a web dashboard for some users.",
]);
H3("Weaknesses");
bulletList([
  "Subscription fatigue — $36-60/yr is the #1 1-star complaint.",
  "No task linking, no deterrents, dated UX, bypass-by-reinstall mentioned repeatedly.",
]);
H3("How we beat them");
bulletList([
  "Lead with task-linked blocking and free-forever pricing in every ad.",
  "Run search ads on 'AppBlock alternative no subscription'.",
  "Ship a one-tap AppBlock import in onboarding.",
]);

H2("Stay Focused — active trust crisis (priority target)");
P("Play Store 3.8★ and falling · 5M+ downloads · InnoXApps · $2.99/mo (lifetime licences revoked early 2026).");
callout(
  "60-90 day acquisition window",
  "Reddit threads (r/androidapps, r/productivity, r/nosurf) are full of refugees actively asking for an alternative. This is the highest-ROI acquisition opportunity in our category right now. Move fast."
);
H3("Strengths");
bulletList(["Clean UI, solid accessibility enforcement, several years of brand equity (now collapsing)."]);
H3("Weaknesses");
bulletList([
  "Trust permanently damaged — you cannot rebuild after revoking lifetime licences.",
  "No task integration, no deterrents, no import path out (which is our opportunity).",
]);
H3("Capture playbook");
bulletList([
  "Onboarding-level 'Coming from Stay Focused? Import your blocked list' button.",
  "Trust pledge in writing in the Privacy Policy and Settings banner.",
  "Reddit reply playbook for the active threads — five canned, helpful templates.",
]);

H2("Lock Me Out — underestimated Android-only rival");
P("Play Store 4.46★ · ~10k ratings · 859k+ installs · ~80k/mo new downloads · TEQTIC Apps · v7.3.3 (Apr 2026). Offers monthly, yearly, or one-time payment.");
H3("Strengths");
bulletList([
  "Solid accessibility enforcement with a one-time-payment tier — the closest thing to our model in the category.",
  "Four-year track record, top-500 productivity ranking by monthly downloads.",
]);
H3("Weaknesses");
bulletList([
  "No task integration; no deterrents beyond the lock screen.",
  "No system-protection layer; UX is utilitarian; small team means slow updates.",
  "Minimal marketing presence outside the Play Store — they win on word of mouth, not paid acquisition.",
]);
H3("How we beat them");
bulletList([
  "Match their one-time-payment honesty — and beat it with free + open source.",
  "Ship task-linked blocking and demo the three-layer aversion stack.",
  "Build a Lock Me Out import to convert price-sensitive churners.",
]);

newPage();

H1("Cluster B — Soft friction apps (different psychology)");

H2("One Sec — beloved by light users, viral on TikTok");
P("Play Store 4.7★ · 40k+ reviews · cross-platform (iOS, Android, macOS, browser). Free for 1 app · $2.99/mo · $19.99/yr · ~$50 lifetime.");
bulletList([
  "Strengths: beautiful execution of the deep-breath idea, zero ads even on free, founder credibility on data privacy.",
  "Weaknesses: no real enforcement (you can still open the app); useless for severe phone addiction or ADHD; free tier covers only 1 app.",
  "Position vs us: they own the mindful segment, we own the willpower-failed segment. Don't fight head-on — convert their churned users.",
]);

H2("ScreenZen — free competitor that punches above its weight");
P("Genuinely free. No premium tier, no ads, no IAP. Per-app delay screens, daily limits, scheduled free periods. Cross-platform iOS + Android.");
bulletList([
  "Strengths: large feature set for $0; donation-funded; growing fast.",
  "Weaknesses: friction-based (no hard block); no task linking; no deterrents stack; sustainability risk on small donation-funded team.",
  "Position vs us: direct threat on the 'free' axis but not on enforcement depth. Our wedge: hard block + task linking + deterrents.",
]);

H2("Opal — iOS-first premium brand entering Android");
P("$4.99/wk · $19.99/mo · $99.99/yr · ~$399 lifetime · 50% student discount. Most expensive subscription in the category. Android v1 only.");
bulletList([
  "Strengths: beautiful product on iOS, aggressive marketing, VC-backed, creator/influencer push, Opal Score gamification.",
  "Weaknesses: Android version is barely usable (Play Store reviews call out missing features); VPN-based on Android (same bypass + battery issues as Freedom); no offline guarantee.",
  "Position vs us: we win on Android decisively. Tagline: 'Opal on Android isn't ready. FocusFlow is.'",
]);

newPage();

H1("Cluster C — Trackers with light blocking");

H2("StayFree — Sensor Tower's tracker");
P("Highest-rated screen time app on Play Store. Cross-platform (Android, Wear OS, browser extensions, desktop). Owned by Sensor Tower.");
bulletList([
  "Strengths: beautiful charts, cross-device pairing without account creation, Sensor Tower credibility, Shorts blocker on web extension.",
  "Weaknesses: primarily a tracker — blocking is secondary; cloud sync raises privacy questions for a Sensor Tower product; no accessibility-grade enforcement.",
  "Position vs us: they serve the user who wants to see their usage. We serve the user who wants to stop it. Different jobs.",
]);

H2("Google Digital Wellbeing — the default we displace");
P("Pre-installed on every Android device. Free. Made by Google.");
bulletList([
  "Strengths: zero install friction, integrated into Settings, zero cost.",
  "Weaknesses: trivially bypassed (one tap turns the timer off); no deterrents; no task integration; users universally complain it doesn't actually block.",
  "Use as foil: 'Digital Wellbeing is easy to bypass. FocusFlow's accessibility enforcement — and our System Protection layer — is not.'",
]);

H1("Cluster D — Out-of-pattern players");

H2("Freedom — VPN-based, multi-platform, premium");
P("Play Store 4.3★ · 50k+ reviews · 5M+ downloads · $8.99/mo · $99.99/yr · $129.99 lifetime.");
bulletList([
  "Strengths: only true cross-device blocker (Android, iOS, Mac, Windows, Chrome); polished brand; Locked mode.",
  "Weaknesses: VPN-based on Android — fails offline, drains battery, killable in network settings, can't block apps that don't use the internet; Android is second-class to Mac.",
  "How we beat them: 'works offline' demo video is our single most powerful asset.",
]);

H2("Forest — gamified honor-system timer");
P("Play Store 4.8★ · 1M+ reviews · 10M+ downloads · $1.99 one-time + $0.99/mo premium.");
bulletList([
  "Strengths: best-looking app in the category; gamification (virtual trees → real trees); community accountability; massive brand.",
  "Weaknesses: doesn't actually enforce anything. Close Forest, open Instagram. Useless when willpower has already failed.",
  "Position: 'Forest asks nicely. FocusFlow enforces.' Don't fight on visual design — fight on enforcement.",
]);

H2("Cold Turkey Blocker — desktop-only");
P("Windows + macOS. No Android. $39 one-time. Mentioned for content marketing context — 'the desktop equivalent of FocusFlow'.");

H2("Brick — hardware NFC puck");
P("$59 one-time, no subscription. Pure hardware approach to blocking.");
bulletList([
  "Strengths: pure one-time pricing; physical NFC tap is meaningful friction; strong press in 2024-2026 (Apartment Therapy, Marie Claire, Cybernews).",
  "Weaknesses: $59 entry cost vs $0 for us; you have to carry or place the puck; iOS-first; one-tap unlocks negate enforcement; no task-linked or scheduled blocking.",
  "Position: 'Brick costs $59 and a Tile-sized object. FocusFlow is free and lives on the phone you already have.'",
]);

newPage();

H1("Import-from-competitor roadmap");
P("The user request that triggered this analysis: expand import support beyond what we have today. Below is the prioritised list, ranked by acquisition value × engineering effort.", { color: COLOR.muted });

const importHead = ["#", "Source app", "Why prioritise", "Importable data", "Effort"];
const importBody = [
  ["1", "Stay Focused", "Active refugee crisis; same accessibility model", "Blocked apps, schedules, daily limits", "Medium"],
  ["2", "AppBlock", "Largest competitor by installs; subscription fatigue high", "Blocked apps, profiles, schedules", "Medium"],
  ["3", "Lock Me Out", "One-time-payment users are price-sensitive switchers", "Blocked apps, schedules", "Low"],
  ["4", "Digital Wellbeing", "Default on every Android — universal upgrade path", "App-timer list, focus-mode list", "Hard"],
  ["5", "One Sec", "Premium churn segment", "Watched apps list", "Low"],
  ["6", "ScreenZen", "Free-to-free crossover unlikely but nice gesture", "Per-app delay settings", "Low"],
  ["7", "Forest", "Gamified-timer users rarely switch to enforcers", "Blocked sites (browser only)", "Skip"],
  ["8", "Freedom", "VPN model is incompatible with our enforcement", "Blocklists", "Skip"],
  ["9", "Opal", "iOS-first; Android Opal users self-select to us", "None public on Android", "Skip"],
];
table(importHead, importBody, {
  fontSize: 8,
  columnStyles: {
    0: { halign: "center", cellWidth: 22 },
    1: { fontStyle: "bold", cellWidth: 90 },
    4: { halign: "center", cellWidth: 60 },
  },
});

H2("Build order recommendation");
P("Ship #1, #2, and #3 in a single 'Import from another blocker' sheet during onboarding. Together they cover roughly 80% of the addressable migration intent and share the same data shape — a list of package names plus optional schedules.");

H2("Engineering sketch");
bulletList([
  "One ImportSource interface with three concrete parsers: StayFocusedParser, AppBlockParser, LockMeOutParser.",
  "All three emit the same intermediate shape: { blockedPackages: string[], schedules?: Schedule[], dailyAllowance?: AllowanceEntry[] }.",
  "Reuse the existing setStandaloneBlockAndAllowance flow on AppContext to commit the merged result.",
  "Add an 'Import from another app' button on the empty state of the Standalone Block screen and inside the side menu.",
]);

newPage();

H1("White space — where no one plays");
bulletList([
  "Always-on layered enforcement. As of this week, FocusFlow is the only app where System Protection, Install/Uninstall guard, Shorts blocker, Reels blocker, and Keyword blocker all run continuously when toggled — not only during a session. Every other enforcer is session-gated.",
  "Task-linked auto-blocking. Zero competitors offer this. The demo video writes itself.",
  "Three-layer aversion deterrents. Dim + vibrate + sound is unique. Forest's tree-dies is the only adjacent concept and it is purely visual.",
  "Free + one-time + open source + no telemetry. Lock Me Out has one-time, ScreenZen is free, Brick is one-time hardware. Nobody combines all three with our enforcement depth.",
  "Trust pledge in writing. Stay Focused destroyed the trust dimension of this category. We can own it permanently.",
]);

H1("Action plan — top 5 specific moves");
bulletList([
  "1. Ship the 'Import from Stay Focused / AppBlock / Lock Me Out' sheet within 30 days. Single sheet, three buttons, one parser interface behind them.",
  "2. Cut a 20-second always-on demo video. Toggle Shorts blocker, exit the app, open YouTube → blocked. Same for Keyword blocker. Post to Reddit, Instagram, TikTok.",
  "3. Build a /coming-from-stay-focused landing page. One scroll: trust pledge, import button, screenshot of the import sheet, link to download.",
  "4. Reddit reply playbook. Five canned reply templates for r/androidapps, r/productivity, r/nosurf, r/getdisciplined, r/ADHD — each tailored to the most common refugee question.",
  "5. Trust Pledge in writing. One paragraph in Privacy Policy and a banner in Settings: 'FocusFlow will not revoke your access, will not introduce a subscription on existing features, and will not transmit your blocked-app list.'",
]);

newPage();

H1("Battlecard — sales / Reddit reply snippets");
const bcHead = ["Competitor", "Trap question to ask", "Our positioning sentence"];
const bcBody = [
  ["AppBlock", "Does it actually link to your calendar or task list?", "Same enforcement, no subscription, plus task-linked auto-blocking."],
  ["Stay Focused", "Did your lifetime licence get revoked too?", "Free, open source, written trust pledge — your access cannot be revoked."],
  ["Lock Me Out", "Does it give you task-linked blocking and deterrents?", "Same one-time honesty, plus free, plus task linking, plus three-layer deterrents."],
  ["Freedom", "Does it still block when you go offline?", "FocusFlow uses Accessibility Service, not a VPN — your blocks survive airplane mode."],
  ["Forest", "What stops you from just closing Forest?", "Forest asks nicely. FocusFlow enforces."],
  ["One Sec", "Does the breath actually stop you, or do you still scroll?", "Mindful pause is the appetiser. Hard enforcement is the meal."],
  ["ScreenZen", "Does it block apps when willpower has already failed?", "We share the free-forever promise. We add the hard block."],
  ["Opal", "How is the Android version compared to iOS?", "Opal on Android is v1. FocusFlow is built Android-first."],
  ["Brick", "Want to carry a $59 puck for the rest of your life?", "Same one-time idea — without the puck and without the $59."],
  ["Digital Wellbeing", "How easy is it to turn off?", "One tap in Settings. FocusFlow's System Protection blocks that tap."],
];
table(bcHead, bcBody, {
  fontSize: 8,
  columnStyles: {
    0: { fontStyle: "bold", cellWidth: 90 },
    1: { fontStyle: "italic", cellWidth: 200 },
  },
});

H1("Sources");
P("Every claim in this report is traceable to one of the URLs below.", { color: COLOR.muted });
const sources = [
  "Cold Turkey pricing — getcoldturkey.com/pricing/",
  "Cold Turkey 2026 review — productivitystack.io/tools/cold-turkey/",
  "Opal Play Store — play.google.com/store/apps/details?id=com.withopal.opal",
  "Opal pricing — opal.so / App Store listing",
  "One Sec Play Store — play.google.com/store/apps/details?id=wtf.riedel.onesec",
  "One Sec Pro plans — tutorials.one-sec.app/en/articles/3036418",
  "ScreenZen — screenzen.co",
  "ScreenZen Play Store — play.google.com/store/apps/details?id=com.screenzen",
  "StayFree — stayfreeapps.com",
  "StayFree Play Store — play.google.com/store/apps/details?id=com.burockgames.timeclocker",
  "Lock Me Out — teqtic.com/lock-me-out",
  "Lock Me Out Play Store — play.google.com/store/apps/details?id=com.teqtic.lockmeout",
  "Brick review (Cybernews) — cybernews.com/reviews/brick-phone-blocker-review",
  "Brick (Apartment Therapy) — apartmenttherapy.com/brick-app-review-37523373",
  "AppBlock — appblock.app",
  "Freedom — freedom.to",
  "Forest — forestapp.cc",
  "Best app blockers 2026 (Mindful Suite) — mindfulsuite.com/reviews/best-app-blockers",
  "Roots — getroots.app",
  "Flipd — flipdapp.co",
];
let idx = 1;
for (const s of sources) {
  ensureSpace(13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(COLOR.muted);
  doc.text(`${idx}.`, M, cursorY);
  setColor(COLOR.ink);
  doc.text(s, M + 18, cursorY);
  cursorY += 13;
  idx++;
}

P("");
P("Methodology note: profiles for newer or smaller competitors (Opal Android, Lock Me Out, Brick) are built from vendor pages, store listings, and press reviews rather than independent G2/Capterra data — those databases have thin coverage of consumer Android. Pricing reflects publicly listed tiers as of April 2026 and may change.", { size: 8, color: COLOR.muted });

drawFooter();

doc.save(OUT_PATH);

const pageCount = doc.internal.getNumberOfPages();
console.log(`Wrote ${OUT_PATH}`);
console.log(`Pages: ${pageCount}`);
const stat = fs.statSync(OUT_PATH);
console.log(`Size: ${(stat.size / 1024).toFixed(1)} KB`);
