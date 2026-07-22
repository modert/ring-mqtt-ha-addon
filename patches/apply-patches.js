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
// Fix: when ring_devices returns a completely empty directory, probe each
// location's websocket ticket endpoint (app-api clap/tickets) for hub assets
// and synthesize minimal base-station/beams-bridge entries so alarm and smart
// lighting discovery proceeds over the websocket exactly as it would have with
// a working ring_devices response.
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

const MARKER = 'Shared-account fallback';

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

const IMPORT_ANCHOR = 'import { clientApi, RingRestClient } from "./rest-client.js";';
const IMPORT_PATCHED = 'import { appApi, clientApi, RingRestClient } from "./rest-client.js";';

const RETURN_ANCHOR = '        return {\n            doorbots,\n            chimes,\n            authorizedDoorbots,';

let src = fs.readFileSync(target, 'utf8');

if (src.includes(MARKER)) {
    console.log('[apply-patches] ring-client-api shared-account fix already applied, nothing to do');
    process.exit(0);
}

if (!src.includes(IMPORT_ANCHOR) || !src.includes(RETURN_ANCHOR)) {
    console.error('[apply-patches] ERROR: expected code anchors not found in ' + target);
    console.error('[apply-patches] The @tsightler/ring-client-api version has likely changed.');
    console.error('[apply-patches] Review the patch against the new version before proceeding.');
    process.exit(1);
}

src = src.replace(IMPORT_ANCHOR, IMPORT_PATCHED);
src = src.replace(RETURN_ANCHOR, FALLBACK_BLOCK + RETURN_ANCHOR);
fs.writeFileSync(target, src);
console.log('[apply-patches] ring-client-api shared-account fix applied to ' + target);
