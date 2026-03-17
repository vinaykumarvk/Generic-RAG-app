# Terraform: PUDA Runtime Baseline

This Terraform module provisions baseline runtime infrastructure for the API:

- Required GCP APIs (Cloud Run, Secret Manager, Monitoring, Logging, Trace, Artifact Registry)
- Runtime service account with minimum required roles for logs/metrics/traces/secret access
- Secret Manager secrets for JWT and payment callback verification
- Cloud Run v2 API service wired to those secrets

## Usage

1. Copy the example vars file and fill values:

```bash
cp ops/iac/terraform/terraform.tfvars.example ops/iac/terraform/terraform.tfvars
```

2. Plan/apply:

```bash
terraform -chdir=ops/iac/terraform init
terraform -chdir=ops/iac/terraform plan
terraform -chdir=ops/iac/terraform apply
```

## CI validation

CI validates format and configuration syntax (no apply) using:

```bash
terraform -chdir=ops/iac/terraform fmt -check -recursive
terraform -chdir=ops/iac/terraform init -backend=false
terraform -chdir=ops/iac/terraform validate
```
