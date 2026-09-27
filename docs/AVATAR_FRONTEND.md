# Alex's participant avatar

The participant room uses TalkingHead 1.7.0 to render Alex and animate the
**audio and timing data already produced by the backend's HeadTTS service**.
Synthesis remains server-side so P1 and P2 receive the same utterance and the
backend retains its recording and latency measurements. The browser does not
connect directly to HeadTTS, download a TTS model, or regenerate speech.

## Run and configure

Use the backend on `feat/avatar-for-alex` (the contract introduced through
`16aa9ac`) or a descendant. Follow [SETUP.md](SETUP.md) for the backend and
HeadTTS sidecar, including the `af_heart` voice. The frontend works with the
older base64 WAV field too, but precise lip-sync needs backend timing data.

```bash
cd frontend
npm ci
npm run dev
```

The normal Vite configuration proxies `/api` and `/ws` to the backend over
HTTPS. Start the backend with the project's certificates when using that
configuration. Open a participant session link, e.g. `/session/1_C2/P1`.
Click **Enable Alex’s audio** if the browser blocks autoplay. Ordinary page
interaction also attempts to unlock audio.

The bundled development model is a local CC0 MPFB example. See
[`frontend/public/avatars/README.md`](../frontend/public/avatars/README.md) for
its source, license and checksum. It is about 35 MiB and is **not a confirmed
study avatar**. To replace it, put an embedded, self-contained GLB with a
TalkingHead-compatible skeleton and Oculus viseme morph targets under
`frontend/public/avatars/`, then set this in `frontend/.env.local`:

```dotenv
VITE_ALEX_MODEL_URL=/avatars/your-model.glb
```

Restart Vite or rebuild after changing the environment value. Models must be
served from the application origin. The renderer, English lip-sync module and
avatar are served locally; no CDN request is required during participant use.

## Playback contract and behavior

`alex_speaking.data` carries `text`, `utterance_id`, `audio_url`, `audio`,
`audio_sample_rate`, `lipsync` and the existing intervention metadata.

- `audio_url`: preferred same-origin raw PCM16 little-endian, mono. The frontend
  converts samples using **the frame's rate**, preserving 16/22.05/24 kHz audio.
- `audio`: base64 WAV fallback for missing/expired/failing PCM endpoints,
  including a 10-second HTTP timeout. Browser WAV decoding reads its own rate.
- `lipsync`: word and optional Oculus viseme arrays in milliseconds. Valid word
  timings can derive visemes using the bundled English module. Empty/invalid
  viseme arrays are omitted so TalkingHead can take that path.
- Missing or invalid timing data retains audio with a neutral mouth. Timing is
  never invented from captions, which may differ from a backend failsafe clip.
- The player queues utterances in arrival order and ignores recently seen IDs.
  Only one source produces audible output. TalkingHead animates a muted copy
  on the same AudioContext, with automatic speech gestures/pre-roll disabled.
- `avatar_speech_started` is sent after the audible source starts on a running
  context. `avatar_speech_ended` follows its `onended` callback or an explicit
  stop. Both carry `utterance_id` and a diagnostic `client_ts` in epoch seconds.
  Caption-only messages, failed playback and blocked autoplay emit no onset.
- C0 hides the avatar and rejects speech, including stray frames. Session end,
  emergency stop and component/session teardown cancel active/pending speech.
  Reconnect does not replay old speech automatically.
- Model fetch failure, load timeout or unavailable WebGL leaves audio and
  captions usable. A loading failure must not prevent the participant hearing
  valid speech. The researcher dashboard retains its existing audio monitor.

## Implementation boundaries

| File under `frontend/src/` | Responsibility |
| --- | --- |
| `avatar/speech.ts` | HeadTTS frame types, timing validation, PCM/WAV loading |
| `avatar/SpeechPlayer.ts` | FIFO, autoplay, cancellation, deduplication, playback callbacks |
| `avatar/talkingHead.ts` | Pinned library adapter, English module, model and resource lifecycle |
| `hooks/useAlexSpeech.ts` | React lifecycle, playback state and WebSocket markers |
| `components/shared/AlexAvatar.tsx` | Lazy renderer, status, model fallback and enable-audio control |
| `components/DiscussionRoom/DiscussionRoom.tsx` | Participant frame routing and C0/session guards |

The published 1.7.0 package owns its AudioContext. Its newer upstream README
also describes APIs that are not in that release. The adapter exposes its
actual context to the player, uses an AudioBuffer rather than relying on
per-call PCM-rate options, and statically bundles the English processor.
Keep the library pinned until this integration is retested against an upgrade.

Presentation is neutral across AI conditions. Reduced-motion preferences
remove ambient tracks while retaining speech articulation; the pinned library
still introduces some subtle facial variation. No emotional or condition-driven
gestures are added. The canvas is not composited into existing camera recordings.

## Verification

```bash
cd frontend
npm test
npm run typecheck
npm run build
npx playwright install chromium   # once per required browser version
npm run test:browser
```

Unit tests check PCM rates/endianness, metadata handling, fetch fallback,
timeout/cancellation, queue ordering, playback markers and renderer failures.
Browser tests run the real participant UI and local model with synthetic audio
and mocked REST/WebSocket responses. An isolated Vite server on port 5178 has
no backend proxy; tests deny media capture and create no research sessions.
Screenshots/traces are written to the ignored `.local/` directory.

These tests do not establish voice quality, physical audio-output latency,
perceptual lip-sync accuracy, cross-device synchronization or study outcomes.
Start markers are browser source-start notifications, not calibrated
speaker-output timestamps. Hardware output buffering, main-thread scheduling
and network transit remain part of the timing error. WebSocket sends while
disconnected are not replayed, to avoid false delayed onset records.

Before study use, verify the selected avatar, real HeadTTS/`af_heart` output,
matching failsafe sidecars, both participant devices, headphones/speakers,
autoplay, and backend event/LSL logs. Backend handover decisions about previous
pilot voice/bandwidth and failsafe caption mismatches remain with the backend
owner and study lead.
