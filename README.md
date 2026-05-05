# ☸️ K8s Teaching Demo — Frontend + Backend on Kind

A simple project to teach Kubernetes concepts:
- Deployments
- Services (ClusterIP, NodePort, LoadBalancer)

## 📖 Follow the Tutorial

Open [`tutorial.md`](./tutorial.md) — it covers everything from cluster setup to hands-on exercises.

## 🗂️ What's Inside

| Folder/File | Description |
|---|---|
| `backend/` | Node.js Express API (3 endpoints) |
| `frontend/` | Simple HTML page served by nginx |
| `k8s/` | All Kubernetes YAML manifests |
| `tutorial.md` | Full step-by-step teaching guide |

## ⚡ Quick Start (after cluster setup)

```bash
# Build and load images
docker build -t k8s-demo-backend:latest ./backend
docker build -t k8s-demo-frontend:latest ./frontend
kind load docker-image k8s-demo-backend:latest --name demo
kind load docker-image k8s-demo-frontend:latest --name demo

# Deploy everything
kubectl apply -f k8s/

# Check status
kubectl get pods
kubectl get services
```
