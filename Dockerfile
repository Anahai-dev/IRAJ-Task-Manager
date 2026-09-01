FROM node:20-alpine AS builder

# sqlite3 native module may compile during npm ci on Alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the app (React frontend + Express backend)
RUN npm run build

# Use a smaller runtime image
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package.json and package-lock.json for production install
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the built output from builder
COPY --from=builder /app/dist ./dist

# Copy the sqlite database if it needs to be initialized (optional, usually created dynamically)
# Note: In production you'd likely use Cloud SQL or mount a volume for SQLite,
# but we leave it here just in case.

ARG PORT=3000
ENV PORT=${PORT}

EXPOSE ${PORT}
ENV NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
