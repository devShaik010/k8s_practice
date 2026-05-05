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

## ☸️ Step 2 — Create the Kind Cluster

**Kind = Kubernetes IN Docker.** It runs a full K8s cluster inside a Docker container on your machine — perfect for learning.

```bash
kind create cluster --name demo
```

Check the cluster is up:

```bash
kubectl cluster-info --context kind-demo
kubectl get nodes
```

You should see:

```
NAME                 STATUS   ROLES           AGE
demo-control-plane   Ready    control-plane   30s
```

---

## 📦 Step 3 — Clone the Project & Build Images

```bash
git clone <your-repo-url> k8s_practice
cd k8s_practice
```

Build both Docker images:

```bash
docker build -t k8s-demo-backend:latest ./backend
docker build -t k8s-demo-frontend:latest ./frontend
```

Load them into the kind cluster:

```bash
kind load docker-image k8s-demo-backend:latest --name demo
kind load docker-image k8s-demo-frontend:latest --name demo
```

> **Why load?** Kind is isolated — it cannot see your local Docker images. We have to push them in manually.

---

## 🟦 Step 4 — Deployment

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

## 🔌 Step 5 — Services (This Is Where It Gets Real)

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

## 🟨 Step 6 — NodePort (Accessing from Outside)

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

### Before you apply — update the backend URL

Open `frontend/index.html` and find:

```javascript
const BACKEND_URL = window.BACKEND_URL || 'http://localhost:5000';
```

Get your Node IP:

```bash
docker inspect demo-control-plane | grep '"IPAddress"'
```

Replace `localhost:5000` with that IP and port `30500`:

```javascript
const BACKEND_URL = window.BACKEND_URL || 'http://<NODE-IP>:30500';
```

Rebuild and reload the frontend image:

```bash
docker build -t k8s-demo-frontend:latest ./frontend
kind load docker-image k8s-demo-frontend:latest --name demo

# Restart frontend pods to pick up the new image
kubectl rollout restart deployment frontend-deployment
```

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

## 🟥 Step 7 — LoadBalancer (Cloud Production)

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
kind delete cluster --name demo
```
