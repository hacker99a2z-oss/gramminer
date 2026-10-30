FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node backend ./backend

USER node

EXPOSE 8080

CMD ["npm", "run", "start:api"]
