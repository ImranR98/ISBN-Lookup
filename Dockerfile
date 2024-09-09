FROM node
COPY package.json .
COPY package-lock.json .
RUN npm i
COPY . .
CMD ["npm", "start"]

# docker build -t imranrdev/isbn-lookup .