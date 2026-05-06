# ☸️ Kubernetes Tutorial: Deploying Frontend & Backend in Kind

---

## 🖥️ Step 1 — Setup EC2 Machine

Spin up an Ubuntu EC2 (t2.medium or higher). Then SSH in and run:

```bash
# Update packages
sudo apt-get update -y

# Install Docker
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# Install kind
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64
chmod +x kind && sudo mv kind /usr/local/bin/

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify everything:

```bash
docker --version
kubectl version --client
kind version
node --version
```

---

## 📦 Step 2 — Clone the Project

Clone the repo first — it contains the `kind-config.yaml` file needed for the next step.

```bash
git clone <your-repo-url> k8s_practice
cd k8s_practice
```

---

## ☸️ Step 3 — Create the Kind Cluster

**Kind = Kubernetes IN Docker.** It runs a full K8s cluster inside a Docker container on your machine.

The repo includes `kind-config.yaml` which uses **extraPortMappings** — this binds NodePorts `30080` and `30500` directly to the EC2 host so your browser can reach them.

```bash
kind create cluster --config kind-config.yaml
```

Verify:

```bash
kind get clusters                      # should show: kind
kubectl cluster-info --context kind-kind
kubectl get nodes
```

You should see:

```
NAME                 STATUS   ROLES           AGE
kind-control-plane   Ready    control-plane   30s
```

---

## 🔧 Step 4 — Update Backend URL & Build Images

> ⚠️ **Do this BEFORE building the frontend image.** The URL is baked in at build time — if you build with `localhost:5000` it will never work from a browser.

### 1. Get your EC2 public IP

```bash
curl -s http://169.254.169.254/latest/meta-data/public-ipv4
```

### 2. Update the backend URL

```bash
# Replace YOUR_EC2_PUBLIC_IP with the actual IP from above
sed -i "s|http://localhost:5000|http://YOUR_EC2_PUBLIC_IP:30500|g" frontend/index.html

# Verify
grep "BACKEND_URL" frontend/index.html
# Must show: http://YOUR_EC2_PUBLIC_IP:30500
```

### 3. Build both Docker images

```bash
docker build -t k8s-demo-backend:latest ./backend
docker build -t k8s-demo-frontend:latest ./frontend
```

### 4. Load images into the Kind cluster

```bash
kind load docker-image k8s-demo-backend:latest --name kind
kind load docker-image k8s-demo-frontend:latest --name kind
```

> **Why load?** Kind is isolated — it cannot see your local Docker images. We have to push them in manually.

---

## 🟦 Step 5 — Deployment

### What is a Deployment?

A **Deployment** is how you tell Kubernetes:
> *"Run 2 copies of my app. If one crashes, restart it automatically."*

That's it. You describe the desired state. Kubernetes makes sure reality matches it.

```
Deployment
│
├── Pod 1 (backend) ← if this crashes, K8s starts a new one
└── Pod 2 (backend) ← always keeping 2 alive
```

### Look at the file

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-deployment
spec:
  replicas: 2                 # Run 2 pods
  selector:
    matchLabels:
      app: backend            # Manage pods with this label
  template:
    metadata:
      labels:
        app: backend          # Label every pod with this
    spec:
      containers:
        - name: backend
          image: k8s-demo-backend:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 5000
```

Key things:
- `replicas: 2` → always keep 2 pods running
- `labels: app: backend` → this is the tag on every pod
- `selector.matchLabels` → tells the Deployment which pods it owns

### Apply it

```bash
kubectl apply -f k8s/backend-deployment.yaml
```

Check it:

```bash
kubectl get pods
```

```
NAME                                  READY   STATUS    RESTARTS   AGE
backend-deployment-5f7d9b8c4-abc12   1/1     Running   0          20s
backend-deployment-5f7d9b8c4-def34   1/1     Running   0          20s
```

Two pods running. Let's also see the deployment:

```bash
kubectl get deployments
```

### 🔥 Kill a pod — watch it come back

```bash
# Copy any pod name from above
kubectl delete pod backend-deployment-5f7d9b8c4-abc12

# Watch immediately
kubectl get pods --watch
```

Kubernetes starts a replacement within seconds. **This is self-healing.**

Now do the same for the frontend:

```bash
kubectl apply -f k8s/frontend-deployment.yaml
kubectl get pods
```

---

## 🔌 Step 6 — Services (This Is Where It Gets Real)

You have 2 backend pods running. Each pod has its own IP address inside the cluster.

**Problem:**
- Pod IPs are temporary — they change every time a pod restarts
- The frontend can't track which pod to talk to
- There's no way to reach pods from outside the cluster yet

```
Frontend → ??? Which pod IP? It keeps changing!
```

**This is exactly the problem Services solve.**

---

### 🟩 ClusterIP — Internal Communication

A **Service** gives you a **permanent address** that always routes to healthy pods. Even when pods restart and get new IPs, the Service IP stays the same.

```
Frontend Pod → backend-service:5000 (permanent)
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
       Backend Pod 1       Backend Pod 2
```

**Type ClusterIP = only accessible inside the cluster.**
Perfect for backend services — they shouldn't be exposed to the internet.

### Look at the file

```yaml
# k8s/backend-service-clusterip.yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service       # Pods call this name to reach the backend
spec:
  type: ClusterIP             # Internal only
  selector:
    app: backend              # Route to pods labelled app=backend
  ports:
    - port: 5000              # Port inside the cluster
      targetPort: 5000        # Port on the pod
```

> The `selector: app: backend` is how the Service finds the right pods — it matches the label we put in the Deployment.

### Apply it

```bash
kubectl apply -f k8s/backend-service-clusterip.yaml
kubectl get services
```

```
NAME              TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
backend-service   ClusterIP   10.96.45.123    <none>        5000/TCP   10s
```

Notice `EXTERNAL-IP` is `<none>` — this service is **internal only**.

### Prove it works inside the cluster

```bash
# Get a backend pod name
kubectl get pods

# Exec into it
kubectl exec -it <backend-pod-name> -- sh

# From inside the pod, curl the service by name
curl http://backend-service:5000/api/message

# Exit
exit
```

It works! Kubernetes has a built-in DNS — pods resolve service names automatically.

---

## 🟨 Step 7 — NodePort (Accessing from Outside)

ClusterIP is great for internal traffic. But right now you can't open the frontend in your browser. There's no way in from outside the cluster.

**Problem:**
```
Your Browser → ??? No way to reach pods from outside!
```

**Solution: NodePort**

A **NodePort** opens a specific port on the cluster node itself (the EC2 machine). Any traffic hitting that port gets routed to your pods.

```
Browser → <EC2-IP>:30080 → frontend pods
```

### Look at the file

```yaml
# k8s/frontend-service-nodeport.yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service-nodeport
spec:
  type: NodePort              # Open a port on the Node
  selector:
    app: frontend
  ports:
    - port: 80                # Port inside the cluster
      targetPort: 80          # Port on the pod (nginx)
      nodePort: 30080         # Port opened on the Node (you access this!)
```

NodePort range is always **30000–32767** — Kubernetes reserves this range.

### ✅ Backend URL — already set in Step 4

You already updated `BACKEND_URL` to your EC2 public IP. Just verify:

```bash
grep "BACKEND_URL" frontend/index.html
# Must show: http://YOUR_EC2_PUBLIC_IP:30500
```

> If it still shows `localhost:5000`, go back to Step 4, run the `sed` command, then rebuild and reload the frontend image.

### Apply the NodePort services

```bash
kubectl apply -f k8s/frontend-service-nodeport.yaml
kubectl apply -f k8s/backend-service-nodeport.yaml
kubectl get services
```

```
NAME                        TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)          AGE
backend-service             ClusterIP   10.96.45.123    <none>        5000/TCP         5m
backend-service-nodeport    NodePort    10.96.78.234    <none>        5000:30500/TCP   10s
frontend-service-nodeport   NodePort    10.96.99.111    <none>        80:30080/TCP     10s
```

### Open in browser

> ⚠️ Make sure EC2 Security Group has ports `30080` and `30500` open for inbound traffic!

```
http://<EC2-PUBLIC-IP>:30080
```

You should see the frontend with data from the backend.

**Test the backend directly:**

```bash
curl http://<EC2-PUBLIC-IP>:30500/api/message
curl http://<EC2-PUBLIC-IP>:30500/api/students
```

Run the curl a few times — notice the `pod` field changes. That's **load balancing** — the Service is spreading requests across both backend pods.

---

## 🌐 Step 7.5 — Actually Accessing via EC2 Public IP (The Kind Gap)

> ⚠️ **This is the most confusing part for beginners. Read this carefully.**

### The Problem with Kind + EC2

Kind runs your K8s cluster **inside a Docker container** on the EC2. So the network stack looks like this:

```
Your Browser
     │
     ▼
EC2 Public IP (e.g. 16.16.251.63)
     │
     ▼
EC2 host (Linux machine)
     │
     ▼
Docker container (kind-control-plane)  ← this is your "Node"
     │
     ▼
Your pods
```

When you create a NodePort at `30080`, that port opens on the **Docker container's network**, NOT on the EC2 host's public NIC. So hitting `http://16.16.251.63:30080` **won't work** out of the box — even if you open it in your EC2 Security Group.

You have **two ways** to fix this:

---

### ✅ Method 1 — `kubectl port-forward` (Quick, works right now)

The simplest approach: forward a port from the EC2 host directly into the cluster service.

```bash
# Terminal 1 — expose frontend on EC2 port 8080
kubectl port-forward svc/frontend-service-nodeport 8080:80 --address 0.0.0.0
```

Now open your browser:

```
http://<EC2-PUBLIC-IP>:8080
```

> `--address 0.0.0.0` is critical — without it, it only listens on localhost and you can't reach it externally.

Also forward the backend (in a separate terminal or use `&` to background it):

```bash
# Terminal 2 — expose backend on EC2 port 5000
kubectl port-forward svc/backend-service-nodeport 5000:5000 --address 0.0.0.0
```

> ⚠️ **EC2 Security Group**: Make sure ports `8080` and `5000` are open for inbound TCP traffic (0.0.0.0/0).

---

### ✅ Method 2 — Kind `extraPortMappings` (Proper, permanent fix)

This binds NodePorts directly to the EC2 host at cluster creation time. **This is the recommended approach.**

```bash
# Step 1: Delete the existing cluster (name defaults to "kind")
kind delete cluster

# Step 2: Create kind-config.yaml
cat <<EOF > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080   # NodePort for frontend
        hostPort: 30080        # Port on EC2 host
        protocol: TCP
      - containerPort: 30500   # NodePort for backend
        hostPort: 30500        # Port on EC2 host
        protocol: TCP
EOF

# Step 3: Create cluster with the config (name will be "kind" by default)
kind create cluster --config kind-config.yaml
```

Verify the cluster is up:

```bash
kind get clusters        # should show: kind
kubectl get nodes        # should show: kind-control-plane   Ready
```

Now when a NodePort opens at `30080` inside the container, Kind **automatically maps it** to port `30080` on the EC2 host.

```bash
# Rebuild and reload images (BACKEND_URL already set in Step 4)
docker build -t k8s-demo-backend:latest ./backend
docker build -t k8s-demo-frontend:latest ./frontend
kind load docker-image k8s-demo-backend:latest --name kind
kind load docker-image k8s-demo-frontend:latest --name kind

# Apply all manifests
kubectl apply -f k8s/

# Verify everything is running
kubectl get pods
kubectl get services
```

Open in browser:

```
http://<EC2-PUBLIC-IP>:30080
```

> ⚠️ **EC2 Security Group**: Open ports `30080` and `30500` for inbound TCP traffic.

---

### Which method should you use?

| Method | Pros | Cons |
|---|---|---|
| `kubectl port-forward` | Works immediately, no cluster recreation | Dies when terminal closes, not persistent |
| `extraPortMappings` | Permanent, survives pod/node restarts | Requires recreating the cluster |

For **learning** → Method 1 is fine.  
For **a running demo** → Method 2 is the right approach.

---

## 🟥 Step 8 — LoadBalancer (Cloud Production)

NodePort works for learning, but it has problems in production:

- You have to expose raw port numbers (`:30080`) — not clean
- You have to know the Node IP — what if you have 10 nodes?
- No automatic traffic distribution at the edge

**Solution: LoadBalancer**

In a real cloud (AWS, GCP, Azure), you set `type: LoadBalancer` and Kubernetes asks the cloud to create a real Load Balancer with a **clean public IP**.

```
Internet → 52.10.15.20:80 (Cloud LB) → K8s Nodes → Pods
```

### Look at the file

```yaml
# k8s/frontend-service-loadbalancer.yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service-lb
spec:
  type: LoadBalancer          # Ask the cloud provider for a real LB
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
```

Simple — just change `type: LoadBalancer`. The cloud provider handles the rest.

### Apply it

```bash
kubectl apply -f k8s/frontend-service-loadbalancer.yaml
kubectl get services frontend-service-lb
```

```
NAME                  TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
frontend-service-lb   LoadBalancer   10.96.200.50    <pending>     80:31xxx/TCP   15s
```

**See `<pending>` in EXTERNAL-IP?** That's expected. Kind has no cloud provider, so nobody assigns an External IP.

On AWS EKS this would show a real IP like `52.10.15.20` within 30 seconds.

---

## 📊 Quick Summary

| Service Type | Who Can Access | When to Use |
|---|---|---|
| **ClusterIP** | Inside cluster only | Backend APIs, databases |
| **NodePort** | Outside via Node IP:Port | Local testing, learning |
| **LoadBalancer** | Outside via clean Public IP | Production on cloud |

---

## 🧪 Useful Commands Cheat Sheet

```bash
# See everything running
kubectl get pods
kubectl get services
kubectl get deployments

# Detailed info on a pod
kubectl describe pod <pod-name>

# Live logs from a pod
kubectl logs -f <pod-name>

# Get inside a pod
kubectl exec -it <pod-name> -- sh

# Scale a deployment
kubectl scale deployment backend-deployment --replicas=4

# Watch pods in real time
kubectl get pods --watch
```

---

## 🧹 Cleanup

```bash
kubectl delete -f k8s/
kind delete cluster
```
