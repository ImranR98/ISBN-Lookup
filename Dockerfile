FROM node:lts-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080
CMD ["npm", "start"]

# docker build -t ghcr.io/imranr98/isbn-lookup .
