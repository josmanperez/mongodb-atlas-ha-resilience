# Project Agent Context & Configuration (GEMINI.md)

This document tracks local authentication, active configurations, and environment-specific troubleshooting steps for AI coding assistants (like Gemini/Antigravity) operating in this workspace.

---

## Active Google Cloud Configuration
* **Configuration Profile:** `ctti-deploy`
* **Account:** `jvillamizar@google.com`
* **Project ID:** `test-mongodb-500214` (test-mongoDB)
* **Region:** `europe-southwest1`

---

## Context-Aware Access (CAA) & ECP Offload

Because this is a corporate-managed workstation environment, accessing Google Cloud APIs using the `jvillamizar@google.com` account requires Context-Aware Access (mTLS/client certificates).

To avoid the `failed to configure ECP Offload SSL context` error caused by incompatibilities between the user-local `gcloud` installation's Python libraries and system-wide ECP libraries, a custom certificate configuration is defined at:
`~/.config/gcloud/user_certificate_config.json`

### Required Environment Variable
Always set this environment variable before executing any `gcloud` commands or local proxies:
```bash
export CLOUDSDK_CONTEXT_AWARE_CERTIFICATE_CONFIG_FILE_PATH="/usr/local/google/home/jvillamizar/.config/gcloud/user_certificate_config.json"
```

---

## Lessons Learned & Agent Guidelines

### 1. Docker Push mTLS / ECP Offload Workaround
* **Symptom:** `docker push` calls the `gcloud` credential helper and fails with `MutualTLSChannelError: failed to configure ECP Offload SSL context`.
* **Resolution:**
  1. Open `~/.docker/config.json` and temporarily remove the `"europe-southwest1-docker.pkg.dev": "gcloud"` helper association.
  2. Authenticate directly via a temporary token:
     ```bash
     gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://europe-southwest1-docker.pkg.dev
     ```
  3. Execute `docker push` normally.

### 2. Accessing Services via Local Proxy
Because of project security policies preventing public ingress to Cloud Run (`allUsers` policy constraint), always access the frontend by initiating a local secure proxy:
```bash
CLOUDSDK_CONTEXT_AWARE_CERTIFICATE_CONFIG_FILE_PATH="/usr/local/google/home/jvillamizar/.config/gcloud/user_certificate_config.json" \
gcloud beta run services proxy resilience-demo-web \
    --region=europe-southwest1 \
    --port=8080 \
    --project=test-mongodb-500214
```
Access the application locally via **http://localhost:8080**.

### 3. Server Startup Sequence Modularity
The backend `apps/api/src/index.ts` is designed with an asynchronous database connection routine. When launching or modifying the API service, ensure the Express server starts listening immediately to satisfy Cloud Run's startup health checks, regardless of current MongoDB availability.

### 4. Direct VPC Egress for MongoDB Atlas PSC
Because the MongoDB connection routes through Private Service Connect (using private IP `10.204.0.2`), the Cloud Run API service (`resilience-demo-api`) must have Direct VPC Egress enabled.
* **Instruction:** When deploying or updating the API service, always include the Direct VPC Egress flags:
  `--network=default --subnet=default --vpc-egress=private-ranges-only`

