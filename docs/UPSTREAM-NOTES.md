# Upstream report: shared-account test data for the v3 endpoints

This is the canonical copy of the findings we intend to report upstream.
Post the comment below on **dgreif/ring PR #1749** (tsightler's v3
location/devices endpoint migration), optionally cross-linking from
**tsightler/ring-mqtt issue #1095**. All claims were verified live on this
add-on (v5.9.3-fix.2 through fix.5) between 2026-07-24 20:05–22:00 UTC.

---

## Draft comment for dgreif/ring PR #1749

I have real-world shared-account results for this PR's approach — posting
because the description notes shared locations are the main untested risk
area. TL;DR: **the v3 devices endpoint fully solves shared-account camera
enumeration where every legacy path fails, using existing token auth**, and
I have some mixed-generation gotchas that any partial migration will hit.

**Setup:** shared/secondary account (the tsightler/ring-mqtt#1095 class) on
ring-mqtt 5.9.3 (dev-branch checkout 6ffe272a) /
`@tsightler/ring-client-api` 14.3.1-beta.1. The location owner shared the
alarm plus 3 cameras with this account and raised its permission level.
Location-scoped via `locationIds`.

**Legacy generation (verified on this account, 2026-07-24):**

| Endpoint | Result |
|---|---|
| `clients_api/ring_devices` | **completely empty — every array `[]`, hubs included** (the #1095 symptom; unchanged even after the owner raised the share's permission level). Alarm discovery on this account only works via this add-on's websocket-ticket fallback synthesis. |
| `app-api clap/tickets?locationID=...` | hub assets only (`base_station_v1`); no camera assets |
| `clients_api/locations/{id}/events` | `{"events": []}` — 0 events |

**`device_info/v3/devices` (called with the existing refresh-token auth —
no OAuth/PKCE from #1750 required):** returns every device the account can
see across all shared locations, including all 3 cameras the legacy
endpoints omit (`lpd_v2` ×2, `cocoa_camera` ×1).

Observations that may affect this PR:

1. **`owned` is `false` for *every* device on a shared account — including
   base stations.** Routing camera kinds with `owned:false` into
   `authorizedDoorbots` works as this PR intends, but `owned` can't be used
   to distinguish device *types*, and on a pure shared account nothing will
   ever be `owned:true`.
2. **Observed v3 payload keys** (shared account): `id, kind, description,
   location_id, schema_id, is_sidewalk_gateway, created_at, deactivated_at,
   operation_set, encryption_group, device_resource_id, owner, device_id,
   time_zone, firmware_version, latitude, longitude, address, owned, stolen,
   ring_id, shared_at, ring_net_id, settings, features, snooze_settings,
   alerts`. Notably **absent vs legacy `CameraData`**: `battery_life`,
   `subscribed`, `subscribed_motions`, and health-related fields.
3. **Mixed-generation inconsistency** (relevant to the review note about
   remaining `devices/v1` usage): for the same v3-discovered shared-camera
   ids, legacy `clients_api/doorbots/{id}/health` returns **404 "No device
   found"**, while legacy `clients_api/doorbots/{id}/subscribe` and
   `motions_subscribe` produced no failures when called — and FCM push
   motion notifications **deliver normally (verified live and sustained:
   100+ motion events over ~2h)**. Partial migrations should expect
   per-endpoint inconsistency for shared devices on the legacy surface
   (e.g. `getHealth()` needs to tolerate 404s).
4. Downstream consumers that poll `data.subscribed` / `data.subscribed_motions`
   (ring-mqtt does) will re-subscribe endlessly for v3-sourced records unless
   those fields are filled in.
5. **Shared cameras are battery-blind under v3**: the records carry no
   `battery_life`/`battery_life_2`, and the legacy health endpoint (the other
   battery source) 404s for these ids — so integrations cannot monitor a
   shared camera's battery at all. Confirmed consequence in the field: a
   battery-powered shared camera dying simply goes silent with no observable
   signal. Worth considering a battery field (or a working health equivalent)
   in the v3 surface.

**How I'm running this today:** an interim build-time patch on ring-mqtt
5.9.3 that, when the legacy camera arrays come back empty, enumerates
`device_info/v3/devices` and injects camera-kind entries into the legacy
arrays (doorbell-kind prefixes → `authorized_doorbots`, camera-kind prefixes
incl. `cocoa_spotlight` → `stickup_cams`), with the two shims from (3)/(4).
In production since 2026-07-24; camera discovery, MQTT publication, and live
motion push delivery all confirmed. Patch:
<https://github.com/modert/ring-mqtt-ha-addon> (`patches/apply-patches.js`).

Happy to test branches of this PR against a real shared account — I
understand that's the test coverage it's been missing.

---

## Secondary note (optional) for tsightler/ring-mqtt #1095 or a discussion

Follow-up on #1095: on our shared account `clients_api/ring_devices` remains
**completely empty** (hubs included) even after the owner raised the shared
user's permission level — but `device_info/v3/devices` (the dgreif/ring#1749
endpoint) sees every shared device, cameras included, with existing token
auth. Interim fallback patch that synthesizes hubs from websocket tickets
and cameras from v3 into the legacy arrays:
<https://github.com/modert/ring-mqtt-ha-addon>. Also note for anyone
debugging this class of issue: ring-client-api's `logError` logs under the
plain `ring` debug namespace, which the add-on default `ring-*` does NOT
match — set `debug: "ring-*,ring"` to see those messages.
