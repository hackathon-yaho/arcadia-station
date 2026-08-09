import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = process.env.ARCADIA_PORT ?? "4178";
const baseUrl = process.env.ARCADIA_URL ?? `http://127.0.0.1:${port}`;
const outputDir = path.resolve("artifacts/browser-smoke");
await mkdir(outputDir, { recursive: true });

let server;
let browser;
const safetyLimitMs = Number(process.env.ARCADIA_SMOKE_TIMEOUT_MS ?? 180_000);
const hardTimeout = setTimeout(() => {
  console.error(`Browser smoke exceeded the ${safetyLimitMs / 1000} second safety limit.`);
  server?.kill();
  process.exit(1);
}, safetyLimitMs);
const stage = (message) => console.log(`[browser-smoke] ${message}`);
const parsePosition = (value) => value?.split(",").map(Number) ?? [];
const positionDistance = (from, to) =>
  Math.hypot(...from.map((value, index) => value - (to[index] ?? value)));

/**
 * 첫 실행에서는 정거장에 진입한 직후 단계별 플레이 안내가 HUD 위에 열린다. 안내가 게임
 * 조작을 막으므로 새 브라우저 컨텍스트마다 한 번씩 건너뛴다.
 */
async function dismissTour(target) {
  const tour = target.locator(".tour-layer");
  await tour.waitFor({ state: "visible" });
  await target.locator(".tour-skip").click();
  await tour.waitFor({ state: "hidden" });
}

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new Error(`Vite did not become ready within ${timeoutMs}ms.`);
}

try {
  stage("starting isolated Vite server");
  server = spawn(
    process.execPath,
    [
      path.resolve("node_modules/vite/bin/vite.js"),
      "--host=127.0.0.1",
      `--port=${port}`,
      "--strictPort",
    ],
    {
      stdio: "ignore",
      // 이 스모크는 mock 어댑터의 UI 흐름을 검사한다. 개발자의 .env.local이
      // VITE_API_MODE=http로 잡혀 있어도 결과가 흔들리지 않게 강제한다.
      env: { ...process.env, VITE_API_MODE: "mock" },
    },
  );
  await waitForServer(baseUrl);

  stage("launching Chrome");
  browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: process.env.ARCADIA_HEADED !== "1",
    timeout: 15_000,
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
    console.error("PAGE_ERROR", error.stack ?? error.message);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".opening-overlay").waitFor({ state: "visible" });
  stage("capturing desktop opening");
  await page.screenshot({
    path: path.join(outputDir, "01-opening.png"),
    fullPage: true,
  });
  await page.locator(".primary-action").click();
  // 사건 생성 대기 화면. mock 모드에서도 단계 문구가 흐르는지 여기서 확인한다.
  stage("capturing the case preparation screen");
  await page.locator(".case-prep").waitFor({ state: "visible" });
  await page.locator(".case-prep-log li").first().waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(outputDir, "01-case-prep.png"),
    fullPage: true,
  });
  await page.locator(".hud-layer").waitFor({ state: "visible" });
  stage("waiting for the station layout");
  await page.waitForFunction(
    () => document.querySelectorAll(".scene-boot").length === 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => Boolean(document.querySelector("canvas.station-canvas")?.dataset.playerPosition),
    undefined,
    { timeout: 5_000 },
  );
  await page.waitForFunction(() => Boolean(window.__ARCADIA_QA__), undefined, {
    timeout: 5_000,
  });
  await page.waitForTimeout(2_500);

  // 첫 진입에서는 단계별 안내가 열려야 한다. 대상 요소를 짚는 하이라이트까지 확인한다.
  stage("stepping through the first-run guide tour");
  const tour = page.locator(".tour-layer");
  await tour.waitFor({ state: "visible" });
  const tourStepCount = await page.locator(".tour-dots i").count();
  const tourFirstStep = await page.locator(".tour-count").innerText();
  if (!(await page.locator(".tour-highlight").isVisible())) {
    throw new Error("Guide tour did not highlight the first target element.");
  }
  await page.screenshot({
    path: path.join(outputDir, "00-guide-tour-01.png"),
    fullPage: true,
  });
  await page.locator(".tour-next").click();
  await page.waitForFunction(
    () => document.querySelector(".tour-layer")?.getAttribute("data-tour-step") === "2",
    undefined,
    { timeout: 3_000 },
  );
  await page.locator(".tour-next").click();
  await page.waitForFunction(
    () => document.querySelector(".tour-layer")?.getAttribute("data-tour-step") === "3",
    undefined,
    { timeout: 3_000 },
  );
  const tourThirdStep = await page.locator(".tour-count").innerText();
  await page.screenshot({
    path: path.join(outputDir, "00-guide-tour-03.png"),
    fullPage: true,
  });
  await page.locator(".tour-back").click();
  await page.waitForFunction(
    () => document.querySelector(".tour-layer")?.getAttribute("data-tour-step") === "2",
    undefined,
    { timeout: 3_000 },
  );
  await dismissTour(page);

  await page.screenshot({
    path: path.join(outputDir, "02-hub.png"),
    fullPage: true,
  });

  const playerPosition = () =>
    page.locator("canvas.station-canvas").getAttribute("data-player-position");

  stage("checking continuous movement");
  const positionBeforeMovement = await playerPosition();
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await page.waitForTimeout(150);
  const positionAfterMovement = await playerPosition();
  const movementDistance = positionDistance(
    parsePosition(positionBeforeMovement),
    parsePosition(positionAfterMovement),
  );
  if (movementDistance < 0.5) {
    throw new Error(
      `Player did not move after holding W: ${positionBeforeMovement} -> ${positionAfterMovement}`,
    );
  }

  // 사령관실까지 걸어가 조사 표식에 닿는다. 근접 프롬프트가 3D의 조준선을 대신한다.
  // 허브 한가운데에는 코어 기둥이 서 있어서 직진으로는 못 간다. 실제 플레이처럼 돌아간다.
  stage("walking to the command room");
  const walk = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
  };
  await walk("d", 700);
  await walk("w", 2_200);
  await walk("a", 700);
  await walk("w", 3_200);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(outputDir, "02-zone-sign.png"),
    fullPage: true,
  });
  if (!(await page.locator(".interaction-prompt").isVisible())) {
    throw new Error("Walking into the command room did not surface an interaction prompt.");
  }

  const stablePosition = await playerPosition();

  await page.keyboard.press("Tab");
  stage("checking notebook and settings overlays");
  await page.locator(".notebook-shell").waitFor({ state: "visible" });
  // 수첩을 처음 열면 탭 다섯 개를 짚어 주는 안내가 한 번 뜬다. 안내가 조작을 막으므로 닫는다.
  await page.screenshot({
    path: path.join(outputDir, "03-notebook-guide.png"),
    fullPage: true,
  });
  await dismissTour(page);
  await page.screenshot({
    path: path.join(outputDir, "03-notebook.png"),
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await page.locator(".notebook-shell").waitFor({ state: "hidden" });

  await page.locator(".settings-trigger").click();
  await page.locator(".settings-panel").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(outputDir, "04-settings.png"),
    fullPage: true,
  });
  await page.locator(".settings-panel header button").click();
  await page.locator(".settings-panel").waitFor({ state: "hidden" });

  stage("checking suggested and free-form interrogation questions");
  await page.evaluate(() => window.__ARCADIA_QA__?.showScreen("interrogation"));
  await page.locator(".question-list > button").first().waitFor({ state: "visible" });
  const suggestedQuestionCount = await page.locator(".question-list > button").count();
  if (suggestedQuestionCount < 2) {
    throw new Error("Suggested interrogation questions were not rendered.");
  }
  const freeQuestionInput = page.locator("#free-interrogation-question");
  await page.screenshot({
    path: path.join(outputDir, "05-interrogation-questions.png"),
    fullPage: true,
  });
  await freeQuestionInput.fill("사망 추정 시각에 어디에 있었습니까?");
  await page.locator(".free-question-form button[type='submit']").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".dialogue-log .transcript-turn:last-child blockquote")
        ?.textContent?.includes("사망 추정 시각"),
    undefined,
    { timeout: 5_000 },
  );
  const freeQuestionResponse = await page
    .locator(".dialogue-log .transcript-turn:last-child blockquote")
    .innerText();

  // 한 번 오간 뒤의 선택지는 정적 질문이 아니라 서버가 준 recommendedQuestions여야 한다.
  await page.locator(".question-list > button").first().waitFor({ state: "visible" });
  const followUpLabels = await page
    .locator(".question-list > button:not(.present-evidence) span")
    .allInnerTexts();
  if (!followUpLabels.includes("그 시간에 어느 구역에 있었습니까?")) {
    throw new Error(
      `Follow-up questions did not come from the server response: ${followUpLabels.join(" | ")}`,
    );
  }

  // 답변을 받은 뒤에도 질문 목록이 그대로 있어야 한다. 별도의 "다른 질문 선택" 없이
  // 이어서 물을 수 있고, 앞선 문답은 기록에 남아야 한다.
  await page.locator(".question-list > button").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".dialogue-log .transcript-turn").length === 2,
    undefined,
    { timeout: 5_000 },
  );
  const transcriptTurnCount = await page.locator(".dialogue-log .transcript-turn").count();
  const firstTurnRetained = await page
    .locator(".dialogue-log .transcript-turn")
    .first()
    .innerText();
  if (!firstTurnRetained.includes("사망 추정 시각")) {
    throw new Error(`Earlier interrogation turn was cleared: ${firstTurnRetained}`);
  }
  await page.screenshot({
    path: path.join(outputDir, "05-interrogation-free-question.png"),
    fullPage: true,
  });

  // 문답이 쌓여도 대화 기록의 위아래가 잘리면 안 된다. 예전에는 대화 영역이 세로 가운데
  // 정렬이라 내용이 길어지면 위쪽이 화면 밖으로 밀려나고 스크롤로도 닿을 수 없었다.
  stage("checking the transcript does not clip as turns pile up");
  for (let index = 0; index < 5; index += 1) {
    const expectedTurns = 3 + index;
    await page.locator(".question-list > button").first().click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".dialogue-log .transcript-turn").length === count &&
        !document.querySelector(".dialogue-log .transcript-turn.is-pending"),
      expectedTurns,
      { timeout: 5_000 },
    );
  }
  const transcriptOverflow = await page.evaluate(() => {
    const main = document.querySelector(".interrogation-main");
    const transcript = document.querySelector(".dialogue-transcript");
    const log = document.querySelector(".dialogue-log");
    const questions = document.querySelector(".question-list");
    if (!main || !transcript || !log || !questions) return null;
    const mainRect = main.getBoundingClientRect();
    return {
      turns: document.querySelectorAll(".dialogue-log .transcript-turn").length,
      // 대화 영역이 컨테이너 위/아래로 삐져나가면 그만큼이 영구히 가려진다.
      clippedAboveBy: Math.round(mainRect.top - transcript.getBoundingClientRect().top),
      clippedBelowBy: Math.round(transcript.getBoundingClientRect().bottom - mainRect.bottom),
      // 기록 자체는 안에서 스크롤해 첫 문답까지 닿을 수 있어야 한다.
      logScrollable: log.scrollHeight > log.clientHeight,
      questionsVisible: questions.getBoundingClientRect().bottom <= mainRect.bottom + 1,
    };
  });
  if (!transcriptOverflow) throw new Error("Interrogation transcript nodes were not found.");
  if (transcriptOverflow.clippedAboveBy > 1 || transcriptOverflow.clippedBelowBy > 1) {
    throw new Error(
      `Interrogation transcript is clipped: ${JSON.stringify(transcriptOverflow)}`,
    );
  }
  if (!transcriptOverflow.questionsVisible) {
    throw new Error("Question list was pushed out of the interrogation panel.");
  }
  await page.screenshot({
    path: path.join(outputDir, "05-interrogation-long-transcript.png"),
    fullPage: true,
  });

  for (const [screen, selector, filename] of [
    ["dayReview", ".day-review-shell", "06-day-review.png"],
    ["evidence", ".evidence-grid", "06-evidence-context.png"],
    ["theory", ".theory-builder", "07-theory.png"],
    ["trial", ".trial-shell", "08-trial.png"],
    ["review", ".deduction-review", "08-deduction-review.png"],
    ["result", ".result-shell", "09-result.png"],
  ]) {
    stage(`checking ${screen} screen`);
    await page.evaluate((target) => window.__ARCADIA_QA__?.showScreen(target), screen);
    await page.locator(selector).waitFor({ state: "visible" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outputDir, filename), fullPage: true });
  }

  stage("checking recoverable interrogation and theory API failures");
  await page.goto(`${baseUrl}?mockError=interrogation`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => Boolean(window.__ARCADIA_QA__));
  await page.evaluate(() => window.__ARCADIA_QA__?.showScreen("interrogation"));
  await page.locator(".interrogation-shell .inline-api-error").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(outputDir, "10-interrogation-error.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    history.replaceState(null, "", "?mockError=theory");
    window.__ARCADIA_QA__?.showScreen("theory");
  });
  await page.locator(".theory-submit button").click();
  await page.locator(".theory-submit .inline-api-error").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(outputDir, "11-theory-error.png"),
    fullPage: true,
  });

  const canvas = page.locator("canvas.station-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox || canvasBox.width < 100 || canvasBox.height < 100) {
    throw new Error("Station canvas did not render at the expected size.");
  }

  const report = {
    url: page.url(),
    title: await page.title(),
    canvas: canvasBox,
    stacking: await page.evaluate(() => {
      const canvas = document.querySelector("canvas.station-canvas");
      const shell = document.querySelector(".game-shell");
      return {
        canvas: canvas
          ? {
              position: getComputedStyle(canvas).position,
              zIndex: getComputedStyle(canvas).zIndex,
              transform: getComputedStyle(canvas).transform,
              playerPosition: canvas.dataset.playerPosition,
            }
          : null,
        children: shell
          ? [...shell.children].map((element) => ({
              tag: element.tagName,
              className: element.className,
              position: getComputedStyle(element).position,
              zIndex: getComputedStyle(element).zIndex,
            }))
          : [],
      };
    }),
    hud: await page.locator(".hud-layer").evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        color: style.color,
        zIndex: style.zIndex,
        width: rect.width,
        height: rect.height,
        text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 180),
      };
    }),
    movement: {
      before: positionBeforeMovement,
      after: positionAfterMovement,
      distance: Number(movementDistance.toFixed(2)),
    },
    interrogation: {
      suggestedQuestionCount,
      freeQuestionResponse,
      transcriptTurnCount,
      followUpLabels,
      transcriptOverflow,
    },
    guideTour: {
      stepCount: tourStepCount,
      firstStep: tourFirstStep,
      thirdStep: tourThirdStep,
    },
    stablePosition,
    consoleErrors,
    pageErrors,
  };

  stage("checking persisted result recovery after reload");
  await page.evaluate(() => {
    history.replaceState(null, "", "/");
    window.__ARCADIA_QA__?.showScreen("result");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".result-shell").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(outputDir, "12-reloaded-result.png"),
    fullPage: true,
  });
  report.persistedResultRecovered = true;

  const errorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await errorPage.goto(`${baseUrl}?mockError=session`, { waitUntil: "domcontentloaded" });
  await errorPage.locator(".primary-action").click();
  await errorPage.locator(".opening-error").waitFor({ state: "visible" });
  await errorPage.screenshot({
    path: path.join(outputDir, "05-session-error.png"),
    fullPage: true,
  });
  report.sessionErrorText = await errorPage.locator(".opening-error").innerText();
  await errorPage.close();

  stage("checking mobile opening, station HUD, and touch controls");
  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  mobilePage.setDefaultTimeout(15_000);
  await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await mobilePage.locator(".opening-overlay").waitFor({ state: "visible" });
  await mobilePage.screenshot({
    path: path.join(outputDir, "13-mobile-opening.png"),
    fullPage: true,
  });
  await mobilePage.locator(".primary-action").click();
  await mobilePage.locator(".mobile-controls").waitFor({ state: "visible" });
  await mobilePage.locator("canvas.station-canvas").waitFor({ state: "visible" });
  await mobilePage.waitForFunction(
    () => Boolean(document.querySelector("canvas.station-canvas")?.dataset.playerPosition),
  );
  await mobilePage.waitForTimeout(2_500);
  await mobilePage.screenshot({
    path: path.join(outputDir, "13-mobile-guide-tour.png"),
    fullPage: true,
  });
  await dismissTour(mobilePage);
  await mobilePage.screenshot({
    path: path.join(outputDir, "14-mobile-hud.png"),
    fullPage: true,
  });
  report.mobile = {
    viewport: mobilePage.viewportSize(),
    controlsVisible: await mobilePage.locator(".mobile-controls").isVisible(),
    horizontalOverflow: await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  };

  // 좁은 화면의 심문은 세로로 쌓여 레이아웃 전체가 스크롤한다. 질문 목록과 직접 질문 입력이
  // 잘리지 않고 실제로 닿을 수 있어야 한다.
  stage("checking mobile interrogation layout");
  await mobilePage.evaluate(() => window.__ARCADIA_QA__?.showScreen("interrogation"));
  await mobilePage.locator(".question-list > button").first().waitFor({ state: "visible" });
  await mobilePage.locator(".free-question-form input").scrollIntoViewIfNeeded();
  report.mobile.interrogation = await mobilePage.evaluate(() => {
    const input = document.querySelector(".free-question-form input");
    const rect = input?.getBoundingClientRect();
    return {
      questionCount: document.querySelectorAll(".question-list > button").length,
      freeQuestionReachable: Boolean(
        rect && rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  await mobilePage.screenshot({
    path: path.join(outputDir, "15-mobile-interrogation.png"),
    fullPage: true,
  });
  if (!report.mobile.interrogation.freeQuestionReachable) {
    throw new Error("Mobile interrogation clipped the free question input.");
  }
  if (report.mobile.interrogation.horizontalOverflow) {
    throw new Error("Mobile interrogation overflowed horizontally.");
  }
  await mobilePage.close();

  await writeFile(
    path.join(outputDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  // 좌표를 계속 내보내고 있고, 걸어서 사령관실까지 실제로 이동했는지 본다.
  // 3D 때는 카메라 높이를 봤지만 탑다운에는 높이가 없다.
  const [finalX, finalZ] = parsePosition(stablePosition);
  const walkedNorth = Number.isFinite(finalZ) && finalZ < -18;
  if (
    !Number.isFinite(finalX) ||
    !walkedNorth ||
    consoleErrors.length ||
    pageErrors.length
  ) {
    process.exitCode = 1;
  }
} finally {
  clearTimeout(hardTimeout);
  if (browser) {
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  server?.kill();
  server?.unref();
}
