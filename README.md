![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt-ha-addon/master/logo.png)

![aarch64-shield](https://img.shields.io/badge/aarch64-yes-green.svg)
![amd64-shield](https://img.shields.io/badge/amd64-yes-green.svg)
![armhf-shield](https://img.shields.io/badge/armhf-yes-green.svg)
![armv7-shield](https://img.shields.io/badge/armv7-yes-green.svg)

# ⚠️ This fork: Shared Account Fix

This is a fork of [tsightler/ring-mqtt-ha-addon](https://github.com/tsightler/ring-mqtt-ha-addon) carrying an interim fix for shared/secondary Ring accounts whose `clients_api/ring_devices` endpoint returns a completely empty device directory, causing the stock add-on to log `No devices found for location ID …` even though the account has full access to the location's devices. When that happens, the patched build probes each location's websocket ticket endpoint for hub assets so alarm and smart lighting discovery proceed normally over the websocket. See [tsightler/ring-mqtt#1095](https://github.com/tsightler/ring-mqtt/issues/1095) and `patches/apply-patches.js` for details. The corresponding upstream fix for ring-client-api lives on the [`shared-account-discovery-fallback`](https://github.com/modert/ring/tree/shared-account-discovery-fallback) branch.

**Install:** Settings → Add-ons → Add-on Store → ⋮ → Repositories → add `https://github.com/modert/ring-mqtt-ha-addon`, then install "Ring-MQTT with Video Streaming (Shared Account Fix)". The add-on builds locally on first install (a few minutes).

Differences from upstream:
- Runs a pinned ring-mqtt dev checkout with the shared-account discovery patch baked in (the `branch` option is removed so the patch cannot be bypassed at runtime)
- Optional `token_import` config option (password field): paste a Ring refresh token to skip the interactive web UI login on first start; it seeds the state file once and can then be cleared
- **Shared cameras are discovered too** (since v5.9.3-fix.4): when the legacy
  camera arrays come back empty, the patch enumerates the newer
  `device_info/v3/devices` endpoint (see [dgreif/ring PR #1749](https://github.com/dgreif/ring/pull/1749))
  and synthesizes the shared cameras into the legacy device arrays — motion
  events, dings, and snapshots then flow normally. Known cosmetic gap:
  battery-powered shared cameras show no battery level (v3 records carry no
  `battery_life`). See `docs/UPSTREAM-NOTES.md` for the full findings.
- Log visibility: ring-client-api logs under the plain `ring` debug
  namespace; the add-on `debug` option should be `ring-*,ring` (not just
  `ring-*`) to see the patch's `[camera-diag]`/`[v3-camera]`/fallback lines.

Upstream README follows.

---

# About
This add-on provides users of Home Assistant OS or Home Assistant Supervised an easy method to install and run the [ring-mqtt](https://github.com/tsightler/ring-mqtt) project which allows various devices sold by Ring LLC to integrate easily with Home Assistant via the open MQTT protocol.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or to play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](https://github.com/tsightler/ring-mqtt/wiki#supported-devices-and-features) for more information on current capabilities.

**!!!! Important note regarding camera support !!!!**    
The ring-mqtt project does not turn Ring cameras into 24x7/continuous streaming CCTV cameras.  Ring cameras are designed to work with Ring cloud servers for on-demand streaming based on detected events (motion/ding) or interactive viewing, even when using ring-mqtt, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment, this includes use with NVR tools like Frigate, Zoneminder or others and there are significant functional side effects to doing so, most notably loss of motion/ding events while streaming (Ring cameras only send alerts when they are not actively streaming/recording).  While you are of course welcome to use this project however you like, questions about use of such tools, or issues opened about these tools, will be locked and deleted.

## Support
If you need help with this addon please use the [discussions section](https://github.com/tsightler/ring-mqtt/discussions) on the main [ring-mqtt project](https://github.com/tsightler/ring-mqtt).

## Quick Install
This is a Home Assistant addon and must be added to the native Home Assistant add-on store, this project has nothing to do with HACS and attempts to add this repository to HACS will fail.  The Home Assistant add-on store is only available when running Home Assistant Supervised installed via either Home Assistant OS or manually.  If you are running Home Assistant Core via Docker or manual install into a Python virtual environment then there is no support for the addon store but you can still run the [ring-mqtt](https://github.com/tsightler/ring-mqtt) project directly to get the same capabilities.

**This add-on requires a working MQTT broker.  Configuring Home Assistant MQTT support is outside of the scope of this document but the standard Home Assistant Mosquitto integration along with the Mosquitto MQTT add-on is the recommended configuration.**

To install this addon follow these steps:

1) Navigate to the add-on store in the Home Assistant UI (**Supervisor** in the left menu, then **Add-on Store** on the top tab)
2) Select the three vertical dots in the upper right-hand corner and select repositories
3) In the **Manage add-on repositories** screen enter the URL for this projects Github page (https://github.com/tsightler/ring-mqtt-ha-addon) and click add
4) After adding the repository scroll to the bottom of the list of addons or use seach to find the addon
5) Select the addon and click the **Install**
6) Proceed to the [configuration documentation](DOCS.md)

Please refer to the [ring-mqtt project wiki](https://github.com/tsightler/ring-mqtt/wiki) for complete documentation on the various features and configuration options.
