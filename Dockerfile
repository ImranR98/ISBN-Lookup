FROM node:lts-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080
CMD ["npm", "start"]

# docker build -t ghcr.io/imranr98/isbn-lookup .
