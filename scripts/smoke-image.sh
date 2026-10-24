#!/usr/bin/env bash
# Smoke test the production image: start it, wait for the web UI, exercise the
# catch-all route, and check the runtime and production dependency tree.
set -euo pipefail

image="${1:?usage: smoke-image.sh <image>}"

container="isbn-lookup-smoke-$$"
body_file="$(mktemp)"

cleanup() {
    docker rm --force "$container" >/dev/null 2>&1 || true
    rm -f "$body_file"
}
trap cleanup EXIT

docker run --detach --name "$container" --publish 127.0.0.1::8080 "$image" >/dev/null

published="$(docker port "$container" 8080/tcp | head -n 1)"
port="${published##*:}"
case "$port" in
    ''|*[!0-9]*)
        echo "Could not determine the published port from '${published}'" >&2
        exit 1
        ;;
esac

base_url="http://127.0.0.1:${port}"
ready=0
for _ in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 2 "$base_url/" --output "$body_file"; then
        ready=1
        break
    fi
    if ! docker inspect --format '{{.State.Running}}' "$container" | grep -q true; then
        break
    fi
    sleep 1
done

if [ "$ready" -ne 1 ]; then
    echo "Image did not serve the web UI at ${base_url}/" >&2
    docker logs "$container" >&2 || true
    exit 1
fi

grep -q '<title>ISBN Lookup</title>' "$body_file"

status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/definitely-not-a-page")"
if [ "$status" != "404" ]; then
    echo "Expected unknown paths to return 404, got ${status}" >&2
    exit 1
fi

docker exec "$container" node --version
docker exec "$container" npm ls --omit=dev --depth=0 >/dev/null

echo "Smoke test passed for ${image}"
