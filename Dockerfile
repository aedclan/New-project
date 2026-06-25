FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

COPY package.json ./
COPY index.html styles.css ./
COPY assets ./assets
COPY scripts ./scripts
COPY src ./src

EXPOSE 5173

CMD ["npm", "start"]
