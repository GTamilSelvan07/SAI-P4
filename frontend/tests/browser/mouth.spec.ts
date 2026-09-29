import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("mouth-state", { body: JSON.stringify(await page.evaluate(() => window.mouthTest?.diagnostics())), contentType: "application/json" });
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/sessions/mouth-test/**", (route) => {
    const seconds = Number(new URL(route.request().url()).searchParams.get("seconds"));
    const pcm = Buffer.alloc(Math.round(24000 * seconds) * 2);
    for (let i = 0; i < pcm.length / 2; i++) {
      const t = (i / 24000) % 3;
      const amplitude = (t >= 0.4 && t < 1.2) || (t >= 1.8 && t < 2.4) ? 7000 : 0;
      pcm.writeInt16LE(Math.round(amplitude * Math.sin(i * 2 * Math.PI * 220 / 24000)), i * 2);
    }
    return route.fulfill({ contentType: "application/octet-stream", body: pcm });
  });
  await page.goto("/tests/browser/mouth.html");
  await page.waitForFunction(() => !!window.mouthTest, undefined, { timeout: 25000 });
  await page.getByRole("button", { name: "Enable test audio" }).click();
});

test("untimed audio visibly opens the real model mouth and closes through silence and completion", async ({ page }) => {
  await page.evaluate(() => window.mouthTest.play(null));
  await expect.poll(() => page.evaluate(() => window.mouthTest.events), { timeout: 10000 }).toEqual(["start", "end"]);
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeLessThan(0.01);
  const samples = await page.evaluate(() => window.mouthTest.samples);
  const during = (from: number, to: number) => samples.filter((s) => s.time >= from && s.time < to).map((s) => s.opening);
  expect(during(0.6, 1.1).length).toBeGreaterThan(0);
  expect(Math.max(...during(0.6, 1.1))).toBeGreaterThan(0.2);
  expect(during(1.4, 1.7).length).toBeGreaterThan(0);
  expect(Math.max(...during(1.4, 1.7))).toBeLessThan(0.01);
  expect(Math.max(...during(2, 2.3))).toBeGreaterThan(0.2);
  const images = await page.evaluate(() => window.mouthTest.images);
  for (const [name, data] of Object.entries(images)) {
    await writeFile(`../.local/avatar-mouth-${name}.png`, Buffer.from(data.split(",")[1], "base64"));
  }
});

for (const kind of ["visemes", "words"] as const) {
  test(`timed ${kind} still deform the model and release the mouth on completion`, async ({ page }) => {
    await page.evaluate((kind) => window.mouthTest.play({
      words: ["Hello", "Alex"], wtimes: [400, 1800], wdurations: [700, 550],
      ...(kind === "visemes" ? { visemes: ["aa", "O"], vtimes: [400, 1800], vdurations: [600, 500] }
        : { visemes: [], vtimes: [], vdurations: [] }),
    }), kind);
    await expect.poll(() => page.evaluate(() => window.mouthTest.events), { timeout: 10000 }).toEqual(["start", "end"]);
    expect(await page.evaluate(() => Math.max(...window.mouthTest.samples.map((s) => s.opening)))).toBeGreaterThan(0.1);
    await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeLessThan(0.01);
  });
}

test("stopping an open mouth resets it and the next untimed utterance animates normally", async ({ page }) => {
  await page.evaluate(() => window.mouthTest.play(null, 20));
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeGreaterThan(0.2);
  await page.evaluate(() => window.mouthTest.stop());
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.mouthTest.events)).toEqual(["start", "end"]);
  await page.evaluate(() => window.mouthTest.play(null));
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeGreaterThan(0.2);
  await expect.poll(() => page.evaluate(() => window.mouthTest.events)).toEqual(["start", "end"]);
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeLessThan(0.01);
});

test("replays an optional backend-built speech frame and animates the real recording", async ({ page }) => {
  const fixturePath = process.env.AVATAR_SPEECH_FIXTURE;
  test.skip(!fixturePath, "Set AVATAR_SPEECH_FIXTURE to a locally exported alex_speaking JSON frame.");
  const frame = JSON.parse(await readFile(fixturePath!, "utf8"));
  expect(frame.type).toBe("alex_speaking");
  // Exercise the frame's actual WAV fallback without depending on a running
  // study session or persisting a research utterance in the browser test suite.
  await page.route("**/api/sessions/**", (route) => route.fulfill({ status: 404 }));
  await page.evaluate((speech) => window.mouthTest.playSpeech(speech), frame.data);
  await expect.poll(() => page.evaluate(() => window.mouthTest.events), { timeout: 20000 }).toEqual(["start", "end"]);
  expect(await page.evaluate(() => Math.max(...window.mouthTest.samples.map((s) => s.opening)))).toBeGreaterThan(0.1);
  await expect.poll(() => page.evaluate(() => window.mouthTest.opening())).toBeLessThan(0.01);
});
