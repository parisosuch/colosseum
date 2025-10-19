# Use a lightweight base
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl git build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies with Bun
RUN bun install --production

# Copy the rest of the app
COPY . .

# Build the Next.js app
RUN bun run build

# Expose the port your Next.js app runs on
EXPOSE 3000

# Start the app
CMD ["bun", "run", "start"]