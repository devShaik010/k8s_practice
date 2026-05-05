# Use official Node.js lightweight image
FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy rest of the source code
COPY . .

# Expose the port backend listens on
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]
