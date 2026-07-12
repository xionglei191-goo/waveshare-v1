#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.1}"
NODE_SHA256="${NODE_SHA256:-9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578}"
INSTALL_BASE="${INSTALL_BASE:-/opt}"
INSTALL_DIR="${INSTALL_BASE}/node-v${NODE_VERSION}"
ACTIVE_LINK="${INSTALL_BASE}/node-v22"
ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE}"

if [[ -x "${ACTIVE_LINK}/bin/node" ]] && "${ACTIVE_LINK}/bin/node" --version | grep -qx "v${NODE_VERSION}"; then
  echo "Node runtime already installed: ${ACTIVE_LINK}"
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
curl -fsSL "${URL}" -o "${tmp_dir}/${ARCHIVE}"
printf '%s  %s\n' "${NODE_SHA256}" "${tmp_dir}/${ARCHIVE}" | sha256sum -c -
mkdir -p "${INSTALL_DIR}"
tar -xJf "${tmp_dir}/${ARCHIVE}" --strip-components=1 -C "${INSTALL_DIR}"
ln -sfn "${INSTALL_DIR}" "${ACTIVE_LINK}"
"${ACTIVE_LINK}/bin/node" --version
PATH="${ACTIVE_LINK}/bin:${PATH}" "${ACTIVE_LINK}/bin/npm" --version
