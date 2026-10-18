# Terraform state uses a GCS backend.
# Actual bucket name and prefix are supplied out-of-band via:
#   terraform init -backend-config=backend.hcl
# Do not commit real bucket names or project IDs to this repository.

terraform {
  backend "gcs" {}
}
