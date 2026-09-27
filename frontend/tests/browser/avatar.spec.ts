import { test, expect } from "@playwright/test";
import type { Page, WebSocketRoute } from "@playwright/test";

// Deterministic tones are test audio, not measured HeadTTS output.
function pcm(rate = 24000, seconds = 0.5) {
  const bytes = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(Math.round(1500 * Math.sin(i * 2 * Math.PI * 220 / rate)), i * 2);
  return bytes;
}

function wav(rate = 16000) {
  const audio = pcm(rate);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + audio.length, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]).toString("base64");
}

async function room(page: Page, condition = "C2", role = "P1") {
  const messages: { type: string; data: { utterance_id?: string } }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("[Alex] Animation")) errors.push(message.text());
  });
  page.on("dialog", (dialog) => dialog.dismiss());
  // Do not capture real camera/microphone or create research recording artifacts.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Test capture disabled", "NotAllowedError"); };
  });
  const status = {
    session_id: "avatar-test", session_started: true, session_ended: false,
    condition, current_block: 0, total_blocks: 1, task_id: "avatar_test",
    phase: "open_discussion", phase_remaining: 720, phase_elapsed: 0,
    phase_paused: false, mic_p1: "open", mic_p2: "open",
    participant_audio_capture_role: "both", livekit_participant_audio_enabled: false,
    remote_participant_audio_enabled: false,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status")) return route.fulfill({ json: status });
    if (path.includes("/task/")) return route.fulfill({ json: {
      title: "Avatar integration check", description: "Controlled frontend fixture.",
      shared_info: ["Compare the options together."], unique_info: [], persona: "Participant",
      candidates: [{ id: "A", name: "Option A" }, { id: "B", name: "Option B" }],
    } });
    if (path.endsWith(".pcm")) return route.fulfill({ contentType: "application/octet-stream", body: pcm() });
    return route.fulfill({ status: 503, json: { detail: "Service isolated by avatar test" } });
  });
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(new RegExp(`/ws/avatar-test/${role}$`), (ws) => {
    socket = ws;
    ws.onMessage((message) => messages.push(JSON.parse(String(message))));
    ws.send(JSON.stringify({ type: "session_status", data: status }));
  });
  await page.routeWebSocket(/\/ws\/(audio|video)\//, () => {});
  await page.goto(`/session/avatar-test/${role}`);
  await expect(page.getByText("Compare the options together.")).toBeVisible();
  await expect(page.getByText("Disconnected — reconnecting...")).toHaveCount(0);
  const send = (type: string, data: object) => socket!.send(JSON.stringify({ type, data }));
  const speak = (id: string, extra: object = {}) => send("alex_speaking", {
    text: `Test utterance ${id}`, utterance_id: id, condition,
    audio_url: `/api/sessions/avatar-test/utterances/${id}.pcm`, audio_sample_rate: 24000,
    lipsync: { words: ["Test"], wtimes: [0], wdurations: [450], visemes: ["aa"], vtimes: [0], vdurations: [450] },
    ...extra,
  });
  return { messages, errors, speak, send };
}

const avatar = (page: Page) => page.getByRole("region", { name: "Alex, AI facilitator" });
const events = (messages: { type: string; data: { utterance_id?: string } }[]) =>
  messages.filter((m) => m.type.startsWith("avatar_speech_")).map((m) => `${m.type}:${m.data.utterance_id}`);

test("renders local 3D model and plays ordered HeadTTS-shaped speech with real completion", async ({ page }) => {
  const { messages, errors, speak, send } = await room(page);
  await expect(avatar(page).locator("canvas")).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("Getting Alex ready…")).toHaveCount(0, { timeout: 25000 });
  await expect(page.getByText("Alex is available by voice and captions")).toHaveCount(0);
  await avatar(page).click();
  await page.screenshot({ path: "../.local/avatar-ready.png", fullPage: true });
  speak("11111111"); speak("22222222"); speak("11111111");
  await expect.poll(() => events(messages)).toEqual([
    "avatar_speech_started:11111111", "avatar_speech_ended:11111111",
    "avatar_speech_started:22222222", "avatar_speech_ended:22222222",
  ]);
  await expect(avatar(page).getByText("Listening", { exact: true })).toBeVisible();
  speak("77777777", {
    lipsync: { words: ["Test"], wtimes: [0], wdurations: [450], visemes: [], vtimes: [], vdurations: [] },
  });
  await expect.poll(() => events(messages).slice(-2)).toEqual(["avatar_speech_started:77777777", "avatar_speech_ended:77777777"]);
  send("session_ended", {});
  await expect(avatar(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("failed model retains untimed WAV fallback for P2", async ({ page }) => {
  await page.route("**/avatars/alex.glb", (route) => route.fulfill({ status: 404 }));
  const { messages, errors, speak } = await room(page, "C3", "P2");
  await expect(page.getByText("Alex is available by voice and captions")).toBeVisible();
  await avatar(page).click();
  await page.route("**/*.pcm", (route) => route.fulfill({ status: 404 }));
  speak("33333333", { audio: wav(), lipsync: null });
  await expect.poll(() => events(messages)).toEqual(["avatar_speech_started:33333333", "avatar_speech_ended:33333333"]);
  expect(errors).toEqual([]);
});

test("WebGL unavailable still plays PCM; emergency stop ends once and clears queued speech", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl2") return null;
      return original.call(this, type as "2d", ...args);
    } as typeof original;
  });
  const { messages, errors, speak, send } = await room(page);
  await expect(page.getByText("Alex is available by voice and captions")).toBeVisible();
  await avatar(page).click();
  await page.route("**/*.pcm", (route) => route.fulfill({ body: pcm(24000, 20), contentType: "application/octet-stream" }));
  speak("44444444"); speak("55555555");
  await expect.poll(() => events(messages)).toEqual(["avatar_speech_started:44444444"]);
  send("emergency_stop", {});
  await expect.poll(() => events(messages)).toEqual(["avatar_speech_started:44444444", "avatar_speech_ended:44444444"]);
  speak("88888888"); // Late frame after stop must remain suppressed.
  await expect(avatar(page)).toHaveCount(0);
  expect(events(messages)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("C0 does not load an avatar or play stray speech frames", async ({ page }) => {
  const modelRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/avatars/")) modelRequests.push(request.url()); });
  const { messages, speak } = await room(page, "C0");
  speak("66666666", { condition: "C2" });
  await expect(avatar(page)).toHaveCount(0);
  await expect(page.getByText("Test utterance 66666666", { exact: true })).toHaveCount(0);
  expect(modelRequests).toEqual([]);
  expect(events(messages)).toEqual([]);
});


test("suspended browser audio waits for Enable audio before reporting onset", async ({ page }) => {
  // Headless Chromium may bypass site-engagement autoplay policy. Suspend a
  // real AudioContext explicitly so this check is deterministic across hosts.
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        void this.suspend();
      }
    };
  });
  await page.route("**/avatars/alex.glb", (route) => route.fulfill({ status: 404 }));
  const { messages, errors, speak } = await room(page);
  await expect(page.getByText("Alex is available by voice and captions")).toBeVisible();
  speak("99999999", { lipsync: null });
  await expect(page.getByRole("button", { name: "Enable Alex’s audio" })).toBeVisible();
  expect(events(messages)).toEqual([]);
  await page.getByRole("button", { name: "Enable Alex’s audio" }).click();
  await expect.poll(() => events(messages)).toEqual(["avatar_speech_started:99999999", "avatar_speech_ended:99999999"]);
  expect(errors).toEqual([]);
});
