# Development avatar

`alex.glb` is the **MPFB example avatar** from TalkingHead, created using Blender
and the MPFB / MakeHuman tools. The upstream author licenses this avatar under
**CC0 1.0**: https://creativecommons.org/publicdomain/zero/1.0/

- Source: https://github.com/met4citizen/TalkingHead/blob/b3e277b3b46f88e557bf28a2c5612a5b04e075c3/avatars/mpfb.glb
- License statement: https://github.com/met4citizen/TalkingHead/blob/b3e277b3b46f88e557bf28a2c5612a5b04e075c3/README.md#credits
- Retrieved: 2026-09-28
- SHA-256: `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`

This is an interim development asset, not a confirmed study stimulus. Before
collecting participant data, the study owner must choose Alex's final appearance.
Keep that appearance and animation settings consistent across AI conditions.

Set `VITE_ALEX_MODEL_URL=/avatars/your-model.glb` in `frontend/.env.local` to use
another same-origin model. It must have a TalkingHead-compatible skeleton and
Oculus viseme morph targets. Assets are served locally; the participant browser
does not fetch this model from GitHub or a CDN during a session.
