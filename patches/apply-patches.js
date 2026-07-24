#!/usr/bin/env node
// Applies the shared-account device-discovery fix to the installed
// @tsightler/ring-client-api package (compiled lib).
//
// Problem: some shared/secondary Ring accounts receive a completely empty
// device directory from the legacy clients_api/ring_devices endpoint even
// though the account has full access to the location's devices (the Ring
// web/mobile apps use newer APIs and show everything). ring-client-api derives
// the camera list AND the hasHubs/hasAlarmBaseStation flags exclusively from
// that endpoint, so an empty response means the alarm websocket is never even
// attempted and no devices are found.  See:
//   https://github.com/tsightler/ring-mqtt/issues/1095
//
// Fix 1 (fix.1): when ring_devices returns a completely empty directory, probe
// each location's websocket ticket endpoint (app-api clap/tickets) for hub
// assets and synthesize minimal base-station/beams-bridge entries so alarm and
// smart lighting discovery proceeds over the websocket exactly as it would
// have with a working ring_devices response.
//
// Fix 2 (fix.2, diagnostic): after the owner shared cameras with this account
// and raised its permission level, ring_devices began returning hubs again but
// the camera arrays (doorbots/authorized_doorbots/stickup_cams) remain empty.
// Upstream's forward path (dgreif/ring PR #1749, device_info/v3 endpoints) is
// unmerged and untested for shared accounts. Before writing a camera-synthesis
// fallback we need to know which enumeration path can still see the cameras'
// real doorbot ids, so this block logs (read-only, never throws):
//   - the ring_devices array counts,
//   - the full clap/tickets asset list (kind/doorbotId) per location -- its
//     AssetKind union includes camera kinds (e.g. floodlight_v2), so camera
//     assets may already be present and silently ignored,
//   - the distinct doorbot_ids seen in clients_api/locations/{id}/events --
//     event history carries real camera ids independent of ring_devices.
//
// This script is run from npm postinstall and is idempotent. It fails the
// install loudly if the expected code anchors are missing (e.g. after a
// ring-client-api version bump) so the patch can never be silently skipped.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const target = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'node_modules', '@tsightler', 'ring-client-api', 'lib', 'api.js'
);
const cameraTarget = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'node_modules', '@tsightler', 'ring-client-api', 'lib', 'ring-camera.js'
);

const MARKER = 'Shared-account fallback';
const DIAG_MARKER = 'Shared-account camera diagnostic';
const V3_MARKER = 'Shared-account v3 camera synthesis';

const FALLBACK_BLOCK = `        // ${MARKER}: some shared/secondary accounts receive a completely
        // empty directory from clients_api/ring_devices even though the account has
        // full access to the location's devices via the app-api websocket
        // (https://github.com/tsightler/ring-mqtt/issues/1095). When that happens,
        // probe each location's websocket ticket for hub assets and synthesize
        // minimal hub entries so alarm/smart-lighting discovery can proceed.
        if (!doorbots.length &&
            !chimes.length &&
            !authorizedDoorbots.length &&
            !stickupCams.length &&
            !baseStations.length &&
            !beamBridges.length &&
            !otherDevices.length) {
            try {
                const rawLocations = await this.fetchRawLocations(), { locationIds } = this.options, probeLocations = Array.isArray(locationIds)
                    ? rawLocations.filter((l) => locationIds.includes(l.location_id))
                    : rawLocations;
                logError(\`ring_devices returned an empty device directory for this account. Probing \${probeLocations.length} location(s) for hub assets via websocket tickets (shared-account fallback)\`);
                await Promise.all(probeLocations.map(async (location) => {
                    try {
                        const { assets } = await this.restClient.request({
                            url: appApi(\`clap/tickets?locationID=\${location.location_id}&enableExtendedEmergencyCellUsage=true&requestedTransport=ws\`),
                        });
                        for (const asset of assets || []) {
                            const syntheticHub = {
                                id: asset.doorbotId,
                                location_id: location.location_id,
                                kind: asset.kind,
                                description: \`\${asset.kind} (discovered via websocket asset probe)\`,
                            };
                            if (String(asset.kind).startsWith('beams_bridge')) {
                                beamBridges.push(syntheticHub);
                            }
                            else {
                                baseStations.push(syntheticHub);
                            }
                        }
                        if (assets?.length) {
                            logError(\`Websocket asset probe found \${assets.length} hub(s) for location \${location.location_id}\`);
                        }
                    }
                    catch (e) {
                        logError(\`Websocket asset probe failed for location \${location.location_id}: \${e.message}\`);
                    }
                }));
            }
            catch (e) {
                logError(\`Websocket asset probe failed: \${e.message}\`);
            }
        }
`;

const V3_CAMERA_BLOCK = `        // ${V3_MARKER} (fix.4): the legacy API generation cannot see this
        // shared account's cameras at all (proven by the fix.2/fix.3 diagnostics:
        // ring_devices camera arrays empty, tickets carry only the hub, events
        // history empty) but device_info/v3/devices -- the endpoint the unmerged
        // upstream v3 migration (dgreif/ring PR #1749) adopts -- lists them with
        // owned:false. When every legacy camera array is empty, enumerate v3 and
        // route camera-kind entries into the legacy arrays: doorbell kinds into
        // authorizedDoorbots (=> isDoorbot true downstream), other camera kinds
        // into stickupCams. Entries flow into allCameras (built in the return
        // below), RingCamera construction, motion/ding subscription, FCM push,
        // and ring-mqtt discovery exactly as legacy entries would. v3 records
        // carry settings/alerts/features/owner/etc., hydrating near-complete
        // camera data. Respects options.locationIds; skips deactivated devices.
        if (!doorbots.length && !authorizedDoorbots.length && !stickupCams.length) {
            try {
                // Poll-safe: fetchRingDevices re-runs every ~20s when camera
                // status polling is active (ring-mqtt enables it whenever
                // enable_cameras is on), so the v3 result is cached for 10
                // minutes and reused; synthesized-device log lines are emitted
                // only when the device set actually changes.
                const v3sNow = Date.now();
                let v3sCache = globalThis.__ringV3CameraCache;
                if (!v3sCache || (v3sNow - v3sCache.ts) > 600000) {
                    const v3sResponse = await this.restClient.request({
                        url: 'https://api.ring.com/device_info/v3/devices',
                    });
                    const v3sAll0 = Array.isArray(v3sResponse) ? v3sResponse
                        : ((v3sResponse && (v3sResponse.devices || v3sResponse.data)) || []);
                    const v3sAll = Array.isArray(v3sAll0) ? v3sAll0 : [];
                    const { locationIds: v3sLocationIds } = this.options;
                    const v3sDoorbellPrefixes = ['doorbot', 'doorbell', 'lpd_', 'jbox_', 'cocoa_doorbell'];
                    const v3sCamPrefixes = ['stickup_cam', 'hp_cam', 'spotlight', 'floodlight', 'cocoa_camera', 'cocoa_floodlight', 'cocoa_spotlight'];
                    const v3sEntries = [];
                    for (const v3sDevice of v3sAll) {
                        const v3sKind = String(v3sDevice.kind || '');
                        if (v3sDevice.deactivated_at) {
                            continue;
                        }
                        if (Array.isArray(v3sLocationIds) && !v3sLocationIds.includes(v3sDevice.location_id)) {
                            continue;
                        }
                        if (v3sDoorbellPrefixes.some((p) => v3sKind.startsWith(p))) {
                            v3sEntries.push({ bucket: 'authorizedDoorbots', device: v3sDevice });
                        }
                        else if (v3sCamPrefixes.some((p) => v3sKind.startsWith(p))) {
                            v3sEntries.push({ bucket: 'stickupCams', device: v3sDevice });
                        }
                    }
                    const v3sIds = v3sEntries.map((x) => String(x.device.id)).sort().join(',');
                    if (!v3sCache || v3sCache.ids !== v3sIds) {
                        for (const v3sEntry of v3sEntries) {
                            logError(\`[v3-camera] synthesized shared \${v3sEntry.bucket === 'authorizedDoorbots' ? 'doorbell' : 'camera'} from v3: \${v3sEntry.device.description} (id \${v3sEntry.device.id}, kind \${v3sEntry.device.kind})\`);
                        }
                        if (!v3sEntries.length) {
                            logError('[v3-camera] v3 returned no camera-kind devices for the configured location(s)');
                        }
                    }
                    v3sCache = { ts: v3sNow, ids: v3sIds, entries: v3sEntries };
                    globalThis.__ringV3CameraCache = v3sCache;
                }
                for (const v3sEntry of v3sCache.entries) {
                    if (v3sEntry.bucket === 'authorizedDoorbots') {
                        authorizedDoorbots.push(v3sEntry.device);
                    }
                    else {
                        stickupCams.push(v3sEntry.device);
                    }
                }
            }
            catch (e) {
                logError(\`[v3-camera] synthesis failed: \${e.message}\`);
            }
        }
`;

const DIAG_BLOCK = `        // ${DIAG_MARKER} (fix.2): log every enumeration path that could
        // reveal a shared camera's real doorbot id. Read-only; wrapped so it can
        // never break discovery. Runs ONCE per process (fetchRingDevices is
        // re-invoked by status polling, so an unguarded probe would hit the Ring
        // API and spam the log indefinitely). Remove once the synthesis fix lands.
        try {
            if (globalThis.__ringCameraDiagRan) {
                throw { __diagSkip: true, message: 'camera-diag already ran this process' };
            }
            globalThis.__ringCameraDiagRan = true;
            logError(\`[camera-diag] ring_devices arrays (post-fallback): doorbots=\${doorbots.length} chimes=\${chimes.length} authorized_doorbots=\${authorizedDoorbots.length} stickup_cams=\${stickupCams.length} base_stations=\${baseStations.length} beams_bridges=\${beamBridges.length} other=\${otherDevices.length}\`);
            const diagRawLocations = await this.fetchRawLocations(), { locationIds: diagLocationIds } = this.options, diagLocations = Array.isArray(diagLocationIds)
                ? diagRawLocations.filter((l) => diagLocationIds.includes(l.location_id))
                : diagRawLocations;
            for (const diagLocation of diagLocations) {
                try {
                    const { assets } = await this.restClient.request({
                        url: appApi(\`clap/tickets?locationID=\${diagLocation.location_id}&enableExtendedEmergencyCellUsage=true&requestedTransport=ws\`),
                    });
                    logError(\`[camera-diag] clap/tickets assets for \${diagLocation.location_id}: \` +
                        JSON.stringify((assets || []).map((a) => ({ kind: a.kind, doorbotId: a.doorbotId, status: a.status, onBattery: a.onBattery }))));
                }
                catch (e) {
                    logError(\`[camera-diag] clap/tickets probe failed for \${diagLocation.location_id}: \${e.message}\`);
                }
                try {
                    const eventsResponse = await this.restClient.request({
                        url: clientApi(\`locations/\${diagLocation.location_id}/events\`),
                    });
                    const diagEvents = (eventsResponse && eventsResponse.events) || [];
                    const diagByDevice = {};
                    for (const ev of diagEvents) {
                        const devId = (ev.doorbot_id !== undefined && ev.doorbot_id !== null)
                            ? ev.doorbot_id
                            : (ev.doorbot && ev.doorbot.id);
                        if (devId === undefined || devId === null) {
                            continue;
                        }
                        const devKey = String(devId);
                        if (!diagByDevice[devKey]) {
                            diagByDevice[devKey] = { doorbot_id: devId, description: ev.doorbot && ev.doorbot.description, kinds: [], events: 0 };
                        }
                        if (ev.kind && !diagByDevice[devKey].kinds.includes(ev.kind)) {
                            diagByDevice[devKey].kinds.push(ev.kind);
                        }
                        diagByDevice[devKey].events++;
                    }
                    logError(\`[camera-diag] locations/\${diagLocation.location_id}/events: \${diagEvents.length} event(s); devices seen: \` + JSON.stringify(Object.values(diagByDevice)));
                }
                catch (e) {
                    logError(\`[camera-diag] locations/{id}/events probe failed for \${diagLocation.location_id}: \${e.message}\`);
                }
            }
            // fix.3: all legacy-generation paths returned nothing for cameras
            // (ring_devices camera arrays empty, tickets carry only the hub,
            // events history empty). Probe the NEW v3 endpoints from unmerged
            // dgreif/ring PR #1749 -- device_info/v3/devices is a flat array of
            // every device the account can see, with an 'owned' flag that is
            // false for shared cameras. Read-only; response shape is logged
            // (incl. first entry's key list) because the v3 payload is known to
            // differ from the legacy shape and this is our first live look.
            try {
                const v3Response = await this.restClient.request({
                    url: 'https://api.ring.com/device_info/v3/devices',
                });
                const v3Devices = Array.isArray(v3Response) ? v3Response
                    : ((v3Response && (v3Response.devices || v3Response.data)) || []);
                const v3List = Array.isArray(v3Devices) ? v3Devices : [];
                const v3Summary = v3List.map((d) => ({
                    id: d.id !== undefined ? d.id : d.doorbot_id,
                    kind: d.kind,
                    description: d.description !== undefined ? d.description : d.name,
                    owned: d.owned,
                    location_id: d.location_id,
                }));
                logError(\`[camera-diag] device_info/v3/devices (\${v3List.length} device(s)): \` + JSON.stringify(v3Summary).slice(0, 1800));
                if (v3List.length) {
                    logError(\`[camera-diag] v3 first entry keys: \` + JSON.stringify(Object.keys(v3List[0] || {})));
                }
            }
            catch (e) {
                logError(\`[camera-diag] device_info/v3/devices probe failed: \${e.message}\`);
            }
            try {
                const v3Locations = await this.restClient.request({
                    url: 'https://api.ring.com/location_info/v3/locations',
                });
                logError(\`[camera-diag] location_info/v3/locations: \` + JSON.stringify(v3Locations).slice(0, 800));
            }
            catch (e) {
                logError(\`[camera-diag] location_info/v3/locations probe failed: \${e.message}\`);
            }
        }
        catch (e) {
            if (!e.__diagSkip) {
                logError(\`[camera-diag] diagnostic failed: \${e.message}\`);
            }
        }
`;

// npm install (not ci) resolves ^14.3.1-beta.1, whose api.js imports WITHOUT
// deviceApi; the out-of-sync lockfile's beta.0 imports WITH it. Accept both so
// the build survives either resolution; anything else still fails loudly.
const IMPORT_VARIANTS = [
    {
        anchor: 'import { clientApi, RingRestClient } from "./rest-client.js";',
        patched: 'import { appApi, clientApi, RingRestClient } from "./rest-client.js";',
    },
    {
        anchor: 'import { clientApi, deviceApi, RingRestClient } from "./rest-client.js";',
        patched: 'import { appApi, clientApi, deviceApi, RingRestClient } from "./rest-client.js";',
    },
];

const RETURN_ANCHOR = '        return {\n            doorbots,\n            chimes,\n            authorizedDoorbots,';

let src = fs.readFileSync(target, 'utf8');

if (src.includes(MARKER) && src.includes(V3_MARKER) && src.includes(DIAG_MARKER)) {
    console.log('[apply-patches] shared-account fix + v3 camera synthesis + diagnostic already applied, nothing to do');
    process.exit(0);
}

if (src.includes(MARKER) || src.includes(V3_MARKER) || src.includes(DIAG_MARKER)) {
    console.error('[apply-patches] ERROR: target is partially patched (unexpected).');
    console.error('[apply-patches] This build should start from a pristine npm install. Aborting.');
    process.exit(1);
}

const importVariant = IMPORT_VARIANTS.find((v) => src.includes(v.anchor));

if (!importVariant || !src.includes(RETURN_ANCHOR)) {
    console.error('[apply-patches] ERROR: expected code anchors not found in ' + target);
    console.error('[apply-patches] The @tsightler/ring-client-api version has likely changed.');
    console.error('[apply-patches] Review the patch against the new version before proceeding.');
    process.exit(1);
}

src = src.replace(importVariant.anchor, importVariant.patched);
src = src.replace(RETURN_ANCHOR, FALLBACK_BLOCK + V3_CAMERA_BLOCK + DIAG_BLOCK + RETURN_ANCHOR);
fs.writeFileSync(target, src);
console.log('[apply-patches] shared-account fix + v3 camera synthesis + diagnostic applied to ' + target);

// --- ring-camera.js: getHealth hardening -------------------------------------
// ring-mqtt calls camera.getHealth() once per camera during initial device
// publication, against the LEGACY per-doorbot health endpoint. v3-synthesized
// shared cameras may not be visible to that endpoint; a rejection there must
// degrade to "no health data" (ring-mqtt guards `if (deviceHealth)`), never
// propagate into device publication.
const HEALTH_MARKER = 'v3-synthesis health guard';
const HEALTH_ANCHOR = `    async getHealth() {
        const response = await this.restClient.request({
            url: this.doorbotUrl('health'),
        });
        return response.device_health;
    }`;
const HEALTH_PATCHED = `    async getHealth() {
        // ${HEALTH_MARKER}: shared cameras synthesized from the v3 device list
        // may not exist on the legacy health endpoint -- degrade, don't throw.
        try {
            const response = await this.restClient.request({
                url: this.doorbotUrl('health'),
            });
            return response.device_health;
        }
        catch (e) {
            logError(\`getHealth failed for camera \${this.id} (returning no health data): \${e.message}\`);
            return undefined;
        }
    }`;

let cameraSrc = fs.readFileSync(cameraTarget, 'utf8');

if (cameraSrc.includes(HEALTH_MARKER)) {
    console.log('[apply-patches] ring-camera getHealth guard already applied, nothing to do');
}
else if (!cameraSrc.includes(HEALTH_ANCHOR)) {
    console.error('[apply-patches] ERROR: getHealth anchor not found in ' + cameraTarget);
    console.error('[apply-patches] The @tsightler/ring-client-api version has likely changed.');
    process.exit(1);
}
else {
    cameraSrc = cameraSrc.replace(HEALTH_ANCHOR, HEALTH_PATCHED);
    fs.writeFileSync(cameraTarget, cameraSrc);
    console.log('[apply-patches] getHealth guard applied to ' + cameraTarget);
}
