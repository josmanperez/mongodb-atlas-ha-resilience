# MongoDB Atlas HA Resilience Demo — GCP Deployment Runbook

This runbook documents the complete end-to-end setup, troubleshooting steps, and architectural refactoring executed to deploy the MongoDB Atlas High Availability & Driver Resilience Demo on **Google Cloud Run** using **Private Service Connect (PSC)** for secure database networking.

---

## Architecture Overview

The deployed system consists of a secure, stateless full-stack application running in the Madrid region (`europe-southwest1`), connected privately to MongoDB Atlas:

```mermaid
graph TD
    Client[Browser Client]
    
    subgraph GCP ["Google Cloud Project (test-mongodb-500214)"]
        subgraph CloudRun ["Cloud Run (europe-southwest1)"]
            Web[resilience-demo-web Nginx]
            Api[resilience-demo-api Node.js]
        end
        
        subgraph VPC ["VPC Network (default)"]
            PSC[PSC Forwarding Rule: 10.204.0.2]
        end
    end
    
    subgraph Atlas ["MongoDB Atlas (Madrid region)"]
        SA[Service Attachment]
        DB[("Multi-Region Cluster")]
    end

    Client -- HTTPS --> Web
    Web -- Proxy /api --> Api
    Api -- PSC Link --> PSC
    PSC -- Private Tunnel --> SA
    SA --> DB
```

---

## Detailed Implementation Steps

### Phase 1: Local `gcloud` Profile Setup
To isolate deployment credentials and target settings from global defaults, we created a dedicated named configuration profile:

```bash
# 1. Create and activate a clean profile
gcloud config configurations create ctti-deploy

# 2. Set active target account and project
gcloud config set account jvillamizar@google.com
gcloud config set project test-mongodb-500214
```

---

### Phase 2: Private Service Connect (PSC) Configuration
To link the GCP VPC network securely to MongoDB Atlas in the same region (`europe-southwest1`):

1. **Enable Compute API**:
   ```bash
   gcloud services enable compute.googleapis.com
   ```
2. **Reserve Private IP Address**:
   Reserves an IP address in the `default` subnet of the `default` VPC:
   ```bash
   gcloud compute addresses create hackathon-ctti-gcp-ip \
       --region=europe-southwest1 \
       --subnet=default \
       --project=test-mongodb-500214
   ```
   *Resulting IP:* `10.204.0.2`

3. **Create the Forwarding Rule**:
   Connects the reserved private IP to the Atlas Service Attachment:
   ```bash
   gcloud compute forwarding-rules create hackathon-ctti-gcp-endpoint \
       --region=europe-southwest1 \
       --address=hackathon-ctti-gcp-ip \
       --target-service-attachment=projects/p-hzilahdb321ncnuzkcqbot7b/regions/europe-southwest1/serviceAttachments/sa-europe-southwest1-6a35220c3e6bb999e346b14d \
       --network=default \
       --project=test-mongodb-500214
   ```

---

### Phase 3: Architectural & Code Enhancements

To make the default application suitable for a containerized, serverless cloud environment (Cloud Run), two major refactorings were implemented:

#### 1. Non-Blocking Backend Startup (`apps/api/src/index.ts`)
*   **The Problem:** The default application connected to MongoDB and started change streams *before* starting the Express server. If the connection string was pending approval or invalid, the container crashed instantly with exit code `1`, causing Cloud Run health checks to fail.
*   **The Fix:** We rearranged the startup sequence to start the Express server on port `8080` immediately. The database connection is now initialized asynchronously in the background. If it fails, the container stays alive, allowing configuration changes at runtime.
*   **Code Diff:**
    ```diff
    async function start(): Promise<void> {
    +  const port = Number(config.PORT);
    +  app.listen(port, () => {
    +    console.log(`[Atlas HA Demo] API listening on http://localhost:${port}`);
    +  });
    +
       try {
         await getClient();
         console.log('[Atlas HA Demo] MongoDB connected');
         await startChangeStream();
         console.log('[Atlas HA Demo] Change stream started');
    -
    -    const port = Number(config.PORT);
    -    app.listen(port, () => {
    -      console.log(`[Atlas HA Demo] API listening on http://localhost:${port}`);
    -    });
       } catch (err) {
    -    console.error('[Atlas HA Demo] Failed to start:', err);
    -    process.exit(1);
    +    console.error('[Atlas HA Demo] MongoDB connection failed on startup, but server is running:', err);
       }
     }
    ```

#### 2. Dynamic Frontend API Proxying (`docker/nginx.conf.template`)
*   **The Problem:** The web container's Nginx configuration hardcoded the API backend as `http://api:3001` (intended for Docker Compose networks). Cloud Run services receive unique absolute external URLs.
*   **The Fix:** Renamed `nginx.conf` to `nginx.conf.template` and injected `${API_URL}`. Updated `Dockerfile.web` to copy this file to `/etc/nginx/templates/default.conf.template`. The official Nginx Alpine image dynamically substitutes this environment variable at runtime using `envsubst`.
*   **Nginx Template Configuration:**
    ```nginx
    location /api/ {
        proxy_pass ${API_URL}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    ```

---

### Phase 4: Container Build & Push Bypass

#### 1. Bypassing Cloud Build Permission Block
*   **The Problem:** Running `gcloud builds submit` failed with a `403 Forbidden` because the default Google Cloud Build service account lacks permissions to read/write from the automatically created Cloud Storage staging bucket (due to organization-level security constraint policies on the project).
*   **The Solution:** Leveraged the local workstation's Docker engine to compile images locally, completely bypassing Cloud Build:
    ```bash
    # Build API locally
    docker build -f docker/Dockerfile.api -t europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest .

    # Build Web locally
    docker build -f docker/Dockerfile.web -t europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest .
    ```

#### 2. Resolving Docker Credential Helper mTLS / ECP Offload Error
*   **The Problem:** Running `docker push` invoked the `gcloud` credential helper, which failed with the error:
    `google.auth.exceptions.MutualTLSChannelError: failed to configure ECP Offload SSL context`
    This occurs because the helper lacks local environment context variables.
*   **The Solution:** 
    1. Removed `"europe-southwest1-docker.pkg.dev": "gcloud"` from `credHelpers` in `~/.docker/config.json`.
    2. Printed a temporary access token utilizing context-aware enabled `gcloud` and logged in directly:
       ```bash
       gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://europe-southwest1-docker.pkg.dev
       ```
    3. Successfully pushed both images:
       ```bash
       docker push europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest
       docker push europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest
       ```

---

### Phase 5: Cloud Run Deployments

#### 1. Deploy the API Service
We deployed the API to Cloud Run in Madrid (`europe-southwest1`). Note that because the MongoDB connection uses a private VPC endpoint (PSC), we must attach the service directly to our VPC utilizing **Direct VPC Egress** (`--network=default --subnet=default --vpc-egress=private-ranges-only`):
```bash
gcloud run deploy resilience-demo-api \
    --image europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest \
    --region europe-southwest1 \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars="MONGODB_URI=mongodb+srv://dbGCP:043e9GW8QK7lIomR@hackathon-gcp-psc-0.vwquwo.mongodb.net/?appName=Hackathon-GCP,APP_REGION=europe-southwest1,APP_CLOUD_PROVIDER=gcp" \
    --network=default \
    --subnet=default \
    --vpc-egress=private-ranges-only \
    --project=test-mongodb-500214
```
*   **API Service URL:** `https://resilience-demo-api-43717433608.europe-southwest1.run.app`

#### 2. Deploy the Web Service (Nginx Front-End)
*   **Crucial Correction:** The Web container's internal Nginx is configured to listen on port `80`. Because Cloud Run defaults to expecting container port `8080`, we must override the port to `80` during deployment:
```bash
gcloud run deploy resilience-demo-web \
    --image europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest \
    --region europe-southwest1 \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars="API_URL=https://resilience-demo-api-43717433608.europe-southwest1.run.app" \
    --port 80 \
    --project=test-mongodb-500214
```
*   **Frontend Dashboard URL:** [https://resilience-demo-web-43717433608.europe-southwest1.run.app](https://resilience-demo-web-43717433608.europe-southwest1.run.app)

---

## Accessing Secure (Private) Cloud Run Services

Since organizational policies in this Google Cloud project prevent making Cloud Run services publicly accessible (`allUsers`), the services require authentication. You can access the secure frontend easily using the **Google Cloud Run Local Proxy**:

### 1. Run the local gcloud proxy:
This starts a local development server on your machine, using your active `gcloud` credentials to dynamically authenticate and forward all requests securely to the Cloud Run frontend:
```bash
CLOUDSDK_CONTEXT_AWARE_CERTIFICATE_CONFIG_FILE_PATH="/usr/local/google/home/jvillamizar/.config/gcloud/user_certificate_config.json" \
gcloud beta run services proxy resilience-demo-web \
    --region=europe-southwest1 \
    --port=8080 \
    --project=test-mongodb-500214
```

### 2. Open the app in your browser:
Once the proxy is running, navigate to:
👉 **[http://localhost:8080](http://localhost:8080)**

Your local browser session will load the dashboard, and Nginx inside Cloud Run will automatically proxy all `/api` requests to the secure backend.

---

## Replication Command Cheatsheet

For easy replication, run this sequence of commands:

```bash
# 1. Environment mTLS setup
export CLOUDSDK_CONTEXT_AWARE_CERTIFICATE_CONFIG_FILE_PATH="/usr/local/google/home/jvillamizar/.config/gcloud/user_certificate_config.json"

# 2. Re-login (if token expired)
gcloud auth login jvillamizar@google.com

# 3. Create & link PSC
gcloud compute addresses create hackathon-ctti-gcp-ip --region=europe-southwest1 --subnet=default --project=test-mongodb-500214
gcloud compute forwarding-rules create hackathon-ctti-gcp-endpoint \
    --region=europe-southwest1 \
    --address=hackathon-ctti-gcp-ip \
    --target-service-attachment=projects/p-hzilahdb321ncnuzkcqbot7b/regions/europe-southwest1/serviceAttachments/sa-europe-southwest1-6a35220c3e6bb999e346b14d \
    --network=default \
    --project=test-mongodb-500214

# 4. Build Images
docker build -f docker/Dockerfile.api -t europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest .
docker build -f docker/Dockerfile.web -t europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest .

# 5. Token Authentication & Push
# NOTE: If 'docker push' fails with MutualTLSChannelError (ECP Offload SSL context error),
# temporarily remove `"europe-southwest1-docker.pkg.dev": "gcloud"` from 'credHelpers' in ~/.docker/config.json.
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://europe-southwest1-docker.pkg.dev
docker push europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest
docker push europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest

# 6. Cloud Run Deployments
# Deploy API with Direct VPC Egress to enable access to the private PSC endpoint
gcloud run deploy resilience-demo-api \
    --image europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/api:latest \
    --region europe-southwest1 \
    --platform managed \
    --set-env-vars="MONGODB_URI=mongodb+srv://dbGCP:043e9GW8QK7lIomR@hackathon-gcp-psc-0.vwquwo.mongodb.net/?appName=Hackathon-GCP,APP_REGION=europe-southwest1,APP_CLOUD_PROVIDER=gcp" \
    --network=default \
    --subnet=default \
    --vpc-egress=private-ranges-only \
    --project=test-mongodb-500214

gcloud run deploy resilience-demo-web \
    --image europe-southwest1-docker.pkg.dev/test-mongodb-500214/resilience-demo/web:latest \
    --region europe-southwest1 \
    --platform managed \
    --set-env-vars="API_URL=https://resilience-demo-api-43717433608.europe-southwest1.run.app" \
    --port 80 \
    --project=test-mongodb-500214
```
