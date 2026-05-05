const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Simple health check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is healthy! 🚀' });
});

// Main API endpoint
app.get('/api/message', (req, res) => {
  const hostname = require('os').hostname();
  res.json({
    message: 'Hello from the Backend!',
    pod: hostname,
    timestamp: new Date().toISOString(),
  });
});

// List of students (dummy data)
app.get('/api/students', (req, res) => {
  res.json({
    students: [
      { id: 1, name: 'Alice', topic: 'Deployments' },
      { id: 2, name: 'Bob',   topic: 'Services' },
      { id: 3, name: 'Carol', topic: 'Networking' },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
