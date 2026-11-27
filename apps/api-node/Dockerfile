FROM node:22-alpine
WORKDIR /app/apps/api-node
COPY apps/api-node/package*.json ./
RUN npm ci --omit=dev
COPY apps/api-node/src ./src
COPY docs/openapi.yaml /app/docs/openapi.yaml
EXPOSE 3000
CMD ["node", "src/server.js"]
