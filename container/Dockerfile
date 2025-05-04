# ---- Build Stage ----
FROM eclipse-temurin:22-jdk AS builder

# Install Node.js LTS and build tools needed for node-pty compilation
RUN apt-get update && \
    apt-get install -y curl build-essential python3 && \
    # Install Node.js (needed for npm)
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    # Clean up apt cache
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build-app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies, including compiling native addons like node-pty
RUN npm install

# ---- Final Stage ----
FROM eclipse-temurin:22-jdk

# Install only Node.js LTS (runtime dependency)
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # Clean up apt cache
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy application files from the host context
COPY package*.json ./
COPY main.js ./
COPY *.js ./

# Copy ONLY the installed node_modules from the builder stage
COPY --from=builder /build-app/node_modules ./node_modules

# Define the command to run the Node.js wrapper
# SERVER_CMD environment variable must be set when running the container
CMD [ "node", "main.js" ]
