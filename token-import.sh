#!/command/with-contenv bashio
# One-time refresh token import: if the token_import option is set and no
# state file exists yet, seed the state file so no interactive login is needed.
# ring-mqtt accepts a plain refresh token string and generates systemId itself.
if bashio::config.has_value 'token_import' && [ ! -f /data/ring-state.json ]; then
    echo "Seeding /data/ring-state.json from token_import addon option"
    printf '{"ring_token": "%s"}' "$(bashio::config 'token_import')" > /data/ring-state.json
fi
