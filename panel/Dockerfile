# Use the official Node.js LTS slim image
FROM node:lts-slim

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Nuxt application
RUN npm run build

# Expose the port the app runs on (default is 3000)
EXPOSE 3000

# Command to run the application
# Use the production server entrypoint directly as recommended by Nuxt
CMD ["node", ".output/server/index.mjs"]
