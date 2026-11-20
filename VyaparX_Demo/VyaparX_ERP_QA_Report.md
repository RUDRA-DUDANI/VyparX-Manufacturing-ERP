# VyaparX customer demo — QA and recording readiness

## Results

| Check | Status | Evidence / result |
|---|---|---|
| Repository code access | VERIFIED | Workspace source is accessible. |
| Django configuration check | VERIFIED | `python -m django check --settings=vyaparx_backend.settings` returned “System check identified no issues”. |
| Django startup instructions | FAILED | `source/backend/manage.py` is absent, so the README's manage.py invocation cannot run as written. |
| Python dependency compatibility | RISK | Check passed, but Google API/Firestore libraries warn that Python 3.10.11 is unsupported. |
| Firebase configuration | VERIFIED (local only) | The settings supply Firebase Web config defaults, and `source/secrets/fds.json` exists with a project ID matching the configured Firebase project. Secret contents were not printed or copied into this report. |
| Firebase / Firestore connectivity | NOT VERIFIED | A read-only exact-name lookup for the user-specified Radhe Polymers demo company stayed pending for 90 seconds and was stopped. It returned no company data. |
| Dedicated synthetic demo tenant | NOT VERIFIED | The named company has not been confirmed in Firestore; no records were read or changed. |
| Local application server | NOT TESTED | No listener was present on the expected local web/API ports during inspection. |
| Browser/computer control | BLOCKED | `@oai/sky` could not connect to the native pipe. The prescribed retry and runtime reset both returned the same error. |
| Screen recording / MP4 export | BLOCKED | `ffmpeg` and OBS are not installed/on PATH; no video-generation or recording tool is available in the connected tools. |
| Real business workflows | NOT TESTED | Without authenticated demo access and screen control, no records were created, approved, received, produced, dispatched, or paid. |
| MP4, synchronized SRT, final narration, chapters | NOT PRODUCED | These must match the actual recorded UI and verified transaction; producing them now would imply actions that were not performed. |

## Required to finish the requested video

1. Confirm that the Firebase project/service-account available locally is an isolated demo environment and authorize a read-only Firestore lookup for the specifically named demo company. Do not send passwords, tokens, or service-account files in chat.
2. A working authenticated demo browser session that can be observed by a functioning screen-control/recording setup. The current computer-use helper is unavailable.
3. A screen recorder or supported video-capture tool capable of capturing the real application at 1920×1080 or higher. 4K export can only be claimed after an actual 3840×2160 capture/export is available.

No production business records were changed. No UI actions were submitted.
