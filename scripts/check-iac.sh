#!/bin/bash
set -euo pipefail

IAC_DIR="ops/iac/terraform"
DOCKER_IMAGE="${TERRAFORM_DOCKER_IMAGE:-hashicorp/terraform:1.8.5}"

run_local() {
  terraform -chdir="${IAC_DIR}" fmt -check -recursive
  terraform -chdir="${IAC_DIR}" init -backend=false
  terraform -chdir="${IAC_DIR}" validate
}

run_docker() {
  docker run --rm -v "$PWD:/workspace" -w /workspace "${DOCKER_IMAGE}" fmt -check -recursive "${IAC_DIR}"
  docker run --rm -v "$PWD:/workspace" -w /workspace "${DOCKER_IMAGE}" -chdir="${IAC_DIR}" init -backend=false
  docker run --rm -v "$PWD:/workspace" -w /workspace "${DOCKER_IMAGE}" -chdir="${IAC_DIR}" validate
}

cleanup() {
  rm -rf "${IAC_DIR}/.terraform"
}
trap cleanup EXIT

if command -v terraform >/dev/null 2>&1; then
  run_local
elif command -v docker >/dev/null 2>&1; then
  run_docker
else
  echo "[IAC_VALIDATE_FAILED] Neither terraform nor docker is available."
  exit 1
fi

echo "[IAC_VALIDATE_OK] Terraform formatting and validation passed."
