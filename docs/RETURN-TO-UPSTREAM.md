# Return-to-upstream runbook

This fork exists only until upstream ships shared-account support. This doc
defines when it's safe to switch back to the stock add-on and exactly how.

## Wait for the WHOLE chain, not just the PR merge

A dgreif/ring merge of PR #1749 alone is NOT enough. All four links must ship:

1. **dgreif/ring** merges the v3 endpoint migration (PR #1749) *and* addresses
   the shared-account findings we reported (getHealth 404 tolerance,
   subscribed/subscribed_motions handling) — otherwise shared accounts still
   break in smaller ways post-merge.
2. **@tsightler/ring-client-api** (the fork ring-mqtt actually uses) publishes
   a release containing it.
3. **tsightler/ring-mqtt** releases with that dependency (watch its
   CHANGELOG for v3 / shared-account mentions).
4. **tsightler/ring-mqtt-ha-addon** publishes that ring-mqtt version.

Until then this fork keeps working indefinitely — it builds from a pinned
commit and is immune to upstream churn. The main long-term forcing function
is Ring's auth migration (PR #1750, OAuth2+PKCE): if Ring ever retires the
current token auth, upgrading upstream becomes mandatory.

## The switch (est. 15 minutes)

1. **Update the stock add-on** (`03cabcc9_ring_mqtt`, kept installed/stopped
   as rollback) to the release from step 4 above. Do NOT uninstall this fork.
2. **Carry the config over** to the stock add-on: `enable_cameras: true`,
   `location_ids: [00ff925a-91f3-4dfd-b3a0-e9b94d2eace0]`, and set
   `debug: "ring-*,ring"` (the plain `ring` namespace is where
   ring-client-api errors log; the default `ring-*` hides them).
3. **Stop this fork's add-on, start the stock one.** Never run both at once
   (MQTT topic collision + two Ring sessions).
4. **Re-authenticate once** via the stock add-on's web UI (Ring login + 2FA
   on the shared account). Its old saved token will be stale; the ACTIVE
   token lives in this fork's private /data and does not transfer.
5. **Verify before walking away** (same bar we hold this fork to):
   - Alarm devices discover (base station, keypad, motion, contacts, lock)
   - All 3 shared cameras discover; motion sensors flip on real motion
   - No error/resubscribe spam in the log over ~15 minutes
   - Home Assistant: `binary_sensor.entryway_cam_motion` and the alarm
     entities are the SAME entity ids (MQTT discovery keys off the same Ring
     device ids, so entity continuity is expected — the wellness monitor in
     ha-config-sturgis should need ZERO changes; confirm rather than assume).
6. **Rollback if anything fails:** stop stock, start this fork — it keeps its
   own token and resumes immediately.

## After a verified switch

- Set the stock add-on to boot=auto / watchdog=on; set this fork to
  boot=manual (keep installed for a couple of weeks as rollback, then remove).
- Optionally remove this repo from the add-on store and delete its write
  deploy key (`/config/.ssh/gh_deploy_addon`).
- Update `ha-config-sturgis` README + memory notes to point at the stock
  add-on.

## What does NOT need to change, ever

- The wellness monitor package, dashboard, and automations in
  ha-config-sturgis — they consume entity ids, which survive the switch.
- The Ring alarm/base station itself — HA only observes it.
