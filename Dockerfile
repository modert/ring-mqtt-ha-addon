ARG BUILD_FROM=tsightler/ring-mqtt:5.9.3
FROM ${BUILD_FROM}

# Replace the bundled ring-mqtt with a pinned upstream dev checkout plus the
# shared-account discovery patch (see patches/apply-patches.js for details).
# The 'branch' addon option has been removed from config.yaml, so the service
# always runs this baked, patched tree from /app/ring-mqtt.
ARG RING_MQTT_COMMIT=6ffe272a5ee015c6e77e9b93d13b49c4896b4136
RUN rm -rf /app/ring-mqtt && \
    mkdir -p /app/ring-mqtt && \
    cd /app/ring-mqtt && \
    git init -q && \
    git remote add origin https://github.com/tsightler/ring-mqtt && \
    git fetch -q --depth 1 origin ${RING_MQTT_COMMIT} && \
    git checkout -q FETCH_HEAD

COPY patches/apply-patches.js /app/ring-mqtt/patches/apply-patches.js
COPY token-import.sh /etc/cont-init.d/00-token-import.sh

# npm install (not ci): upstream's package-lock.json is out of sync with its
# package.json (lock pins ring-client-api beta.0, package.json wants beta.1),
# and upstream's own update2branch.sh uses npm install as well. Version drift
# is caught by the patch applier, which fails the build if its anchors miss.
RUN cd /app/ring-mqtt && \
    npm install --no-progress && \
    node ./patches/apply-patches.js && \
    chmod +x ring-mqtt.js init-ring-mqtt.js scripts/*.sh && \
    cp -f init/s6/cont-init.d/ring-mqtt.sh /etc/cont-init.d/ring-mqtt.sh && \
    cp -f init/s6/services.d/ring-mqtt/run /etc/services.d/ring-mqtt/run && \
    chmod +x /etc/cont-init.d/*.sh /etc/services.d/ring-mqtt/run && \
    rm -Rf /root/.npm
